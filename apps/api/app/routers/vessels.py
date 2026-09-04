from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_X, ST_Y, ST_MakeEnvelope, ST_Within
from sqlalchemy import cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..models import PositionObservation, Vessel, VesselLatest
from ..schemas import (
    TrackOut,
    TrackPointOut,
    TrackSegmentOut,
    VesselDetailOut,
    VesselListOut,
    VesselOut,
    VesselSearchResultOut,
)

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


@router.get(
    "/search", response_model=list[VesselSearchResultOut], dependencies=[Depends(get_current_user)]
)
async def search_vessels(
    q: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(default=20, le=50),
    db: AsyncSession = Depends(get_db),
) -> list[VesselSearchResultOut]:
    """Search every vessel this instance has ever seen an identity or
    position for -- not just the ones currently live in a viewport (that's
    what the Map screen's search does). Backs the History screen's vessel
    picker (PRD: history review must work for any vessel, not just
    watchlisted ones)."""
    term = q.strip()
    if not term:
        return []

    conditions = [Vessel.name.ilike(f"%{term}%"), Vessel.mmsi.ilike(f"{term}%")]
    if term.isdigit():
        conditions.append(Vessel.imo == int(term))

    query = (
        select(Vessel, VesselLatest.observed_at, VesselLatest.received_at)
        .outerjoin(VesselLatest, VesselLatest.mmsi == Vessel.mmsi)
        .where(or_(*conditions))
        .order_by(VesselLatest.received_at.desc().nulls_last())
        .limit(limit)
    )
    rows = (await db.execute(query)).all()

    return [
        VesselSearchResultOut(
            mmsi=vessel.mmsi,
            name=vessel.name,
            imo=vessel.imo,
            last_observed_at=observed_at,
            last_received_at=received_at,
        )
        for vessel, observed_at, received_at in rows
    ]


@router.get(
    "/ship-types", response_model=dict[str, str], dependencies=[Depends(get_current_user)]
)
async def list_ship_types(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    """mmsi -> category for every vessel whose type is known, so the map's
    type filter can work against the live feed's vessels (which don't
    carry identity fields themselves -- see docs/adr/0005) without a
    per-vessel fetch. `vessels` rows are never pruned by retention, but
    this is one row per vessel ever seen, not per observation, so a full
    scan stays cheap at any realistic self-hosted scale."""
    rows = (
        await db.execute(select(Vessel.mmsi, Vessel.ship_type).where(Vessel.ship_type.is_not(None)))
    ).all()
    return {mmsi: ship_type for mmsi, ship_type in rows}


@router.get(
    "/{mmsi}", response_model=VesselDetailOut, dependencies=[Depends(get_current_user)]
)
async def get_vessel_detail(mmsi: str, db: AsyncSession = Depends(get_db)) -> VesselDetailOut:
    """The identity/voyage sheet (IMO, callsign, type, dimensions,
    destination, ETA, draught) -- kept separate from the live map feed
    and its snapshot/upsert messages on purpose. Those only carry a
    field when the specific message that triggered them mentioned it
    (e.g. a position report never carries a name), so building this
    view from live-feed pushes would make it flicker to "Unknown"
    between the sporadic static-data messages that actually fill it in.
    This endpoint reads the already-merged `vessels`/`vessel_latest`
    rows instead, which never regress a known value (see
    persistence.py's per-field COALESCE)."""
    row = (
        await db.execute(
            select(
                Vessel.mmsi,
                Vessel.imo,
                Vessel.callsign,
                Vessel.ship_type,
                Vessel.dimensions,
                VesselLatest.destination,
                VesselLatest.eta_text,
                VesselLatest.draught_m,
            )
            .outerjoin(VesselLatest, VesselLatest.mmsi == Vessel.mmsi)
            .where(Vessel.mmsi == mmsi)
        )
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vessel not found")

    return VesselDetailOut(
        mmsi=row.mmsi,
        imo=row.imo,
        callsign=row.callsign,
        ship_type=row.ship_type,
        dimensions=row.dimensions,
        destination=row.destination,
        eta_text=row.eta_text,
        draught_m=float(row.draught_m) if row.draught_m is not None else None,
    )


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
            PositionObservation.source,
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
    for lon, lat, observed_at, received_at, sog_kn, quality_flags, source in rows:
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
                source=source,
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
