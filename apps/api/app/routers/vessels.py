from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_X, ST_Y, ST_MakeEnvelope, ST_Within
from sqlalchemy import cast, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..models import Vessel, VesselLatest
from ..schemas import VesselListOut, VesselOut

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
    # ST_X/ST_Y only accept `geometry`, but `position` is `geography` --
    # an explicit cast is required (unlike ST_Within below, which PostGIS
    # will implicitly cast for).
    position_geom = cast(VesselLatest.position, Geometry)
    query = (
        select(
            VesselLatest,
            Vessel.name,
            ST_X(position_geom).label("lon"),
            ST_Y(position_geom).label("lat"),
        )
        .join(Vessel, Vessel.mmsi == VesselLatest.mmsi)
        .where(ST_Within(VesselLatest.position, envelope))
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
