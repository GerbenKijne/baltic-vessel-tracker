from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_X, ST_Y, ST_MakeEnvelope, ST_Within
from sqlalchemy import cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..models import PositionObservation, Vessel, VesselLatest
from ..schemas import TrackOut, TrackPointOut, TrackSegmentOut, VesselListOut, VesselOut

router = APIRouter(prefix="/api/v1/vessels", tags=["vessels"])
settings = get_settings()


def freshness_for(observed_at: Optional[datetime], received_at: datetime) -> str:
    reference = observed_at or received_at
    age = (datetime.now(timezone.utc) - reference).total_seconds()
    if age <= settings.live_fresh_seconds:
        return "live"
    if age <= settings.stale_seconds:
        return "delayed"
    return "stale"


@router.get("", response_model=VesselListOut, dependencies=[Depends(get_current_user)])
async def list_vessels(
    min_lon: float = Query(...),
    min_lat: float = Query(...),
    max_lon: float = Query(...),
    max_lat: float = Query(...),
    limit: int = Query(default=2000, le=20000),
    db: AsyncSession = Depends(get_db),
) -> VesselListOut:
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid bounding box")

    envelope = ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    # ST_X/ST_Y/ST_Within only accept `geometry`, but `position` is
    # `geography` -- PostGIS does not cast between them implicitly.
    position_geom = cast(VesselLatest.position, Geometry)
    query = (
        select(
            VesselLatest,
            Vessel.name,
            ST_X(position_geom).label("lon"),
            ST_Y(position_geom).label("lat"),
        )
        .join(Vessel, Vessel.mmsi == VesselLatest.mmsi)
        .where(ST_Within(position_geom, envelope))
        .limit(min(limit, settings.viewport_max_results) + 1)
    )
    rows = (await db.execute(query)).all()

    truncated = len(rows) > min(limit, settings.viewport_max_results)
    rows = rows[: min(limit, settings.viewport_max_results)]

    vessels = [
        VesselOut(
            mmsi=latest.mmsi,
            name=name,
            lon=lon,
            lat=lat,
            sog_kn=float(latest.sog_kn) if latest.sog_kn is not None else None,
            cog_deg=float(latest.cog_deg) if latest.cog_deg is not None else None,
            heading_deg=latest.heading_deg,
            nav_status=latest.nav_status,
            observed_at=latest.observed_at,
            received_at=latest.received_at,
            freshness=freshness_for(latest.observed_at, latest.received_at),
            quality_flags=latest.quality_flags,
        )
        for latest, name, lon, lat in rows
    ]

    return VesselListOut(vessels=vessels, truncated=truncated)


# Hard safety cap independent of the query window -- a wide time window on a
# very active vessel must not pull an unbounded number of rows into memory
# before decimation (PRD SS14: "No unbounded in-memory collections").
_TRACK_QUERY_ROW_CAP = 50_000


@router.get(
    "/{mmsi}/track", response_model=TrackOut, dependencies=[Depends(get_current_user)]
)
async def get_vessel_track(
    mmsi: str,
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = Query(default=None),
    max_points: int = Query(default=settings.track_max_points, le=settings.track_max_points),
    db: AsyncSession = Depends(get_db),
) -> TrackOut:
    now = datetime.now(timezone.utc)
    window_end = to or now
    window_start = from_ or (window_end - timedelta(hours=settings.track_default_window_hours))
    if window_start >= window_end:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "from must be before to")

    position_geom = cast(PositionObservation.position, Geometry)
    query = (
        select(
            ST_X(position_geom).label("lon"),
            ST_Y(position_geom).label("lat"),
            PositionObservation.observed_at,
            PositionObservation.received_at,
            PositionObservation.sog_kn,
            PositionObservation.quality_flags,
        )
        .where(
            PositionObservation.mmsi == mmsi,
            PositionObservation.received_at >= window_start,
            PositionObservation.received_at <= window_end,
            PositionObservation.position.is_not(None),
        )
        .order_by(PositionObservation.received_at)
        .limit(_TRACK_QUERY_ROW_CAP + 1)
    )
    rows = (await db.execute(query)).all()

    truncated_by_cap = len(rows) > _TRACK_QUERY_ROW_CAP
    rows = rows[:_TRACK_QUERY_ROW_CAP]

    # Server-side simplification (PRD FR-008): even decimation rather than a
    # true line-simplification algorithm (e.g. Douglas-Peucker) -- a
    # deliberate scope cut, not a claim of geometric accuracy.
    truncated = truncated_by_cap
    if len(rows) > max_points:
        step = len(rows) / max_points
        rows = [rows[int(i * step)] for i in range(max_points)]
        truncated = True

    gap_threshold = timedelta(minutes=settings.track_gap_minutes)
    segments: list[list[TrackPointOut]] = []
    previous_time: Optional[datetime] = None
    for lon, lat, observed_at, received_at, sog_kn, quality_flags in rows:
        point_time = observed_at or received_at
        if previous_time is None or (point_time - previous_time) > gap_threshold:
            segments.append([])
        previous_time = point_time
        segments[-1].append(
            TrackPointOut(
                lon=lon,
                lat=lat,
                time=point_time,
                time_source="observed" if observed_at else "received",
                sog_kn=float(sog_kn) if sog_kn is not None else None,
                quality_flags=quality_flags,
            )
        )

    return TrackOut(
        mmsi=mmsi,
        window_start=window_start,
        window_end=window_end,
        segments=[TrackSegmentOut(points=points) for points in segments],
        point_count=len(rows),
        truncated=truncated,
    )
