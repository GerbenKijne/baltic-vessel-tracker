import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2 import Geometry
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import cast, delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_csrf, require_write_access
from ..models import User, Vessel, VesselLatest, Watchlist, WatchlistVessel
from ..routers.vessels import freshness_for
from ..schemas import (
    WatchlistCreate,
    WatchlistDetailOut,
    WatchlistOut,
    WatchlistRename,
    WatchlistVesselAdd,
    WatchlistVesselOut,
)

router = APIRouter(prefix="/api/v1/watchlists", tags=["watchlists"])

_WRITE_GUARD = [Depends(require_csrf), Depends(require_write_access)]


async def _get_owned_watchlist(
    db: AsyncSession, watchlist_id: str, user: User
) -> Watchlist:
    try:
        parsed_id = uuid.UUID(watchlist_id)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found") from None

    watchlist = await db.get(Watchlist, parsed_id)
    if watchlist is None or watchlist.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")
    return watchlist


@router.get("", response_model=list[WatchlistOut])
async def list_watchlists(
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[WatchlistOut]:
    query = (
        select(Watchlist, func.count(WatchlistVessel.id))
        .outerjoin(WatchlistVessel, WatchlistVessel.watchlist_id == Watchlist.id)
        .where(Watchlist.user_id == current_user.id)
        .group_by(Watchlist.id)
        .order_by(Watchlist.created_at)
    )
    rows = (await db.execute(query)).all()
    return [
        WatchlistOut(
            id=str(watchlist.id),
            name=watchlist.name,
            created_at=watchlist.created_at,
            vessel_count=count,
        )
        for watchlist, count in rows
    ]


@router.post("", response_model=WatchlistOut, dependencies=_WRITE_GUARD)
async def create_watchlist(
    body: WatchlistCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistOut:
    watchlist = Watchlist(
        id=uuid.uuid4(),
        user_id=current_user.id,
        name=body.name,
        created_at=datetime.now(timezone.utc),
    )
    db.add(watchlist)
    await db.commit()
    return WatchlistOut(
        id=str(watchlist.id), name=watchlist.name, created_at=watchlist.created_at, vessel_count=0
    )


@router.get("/member-mmsis", response_model=list[str], dependencies=[Depends(get_current_user)])
async def list_member_mmsis(
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)
) -> list[str]:
    """Every vessel on any of this user's watchlists, regardless of which
    one -- backs the "already on a list" star shown in search results
    and on the map, which isn't tied to whichever single list happens to
    be selected there."""
    rows = (
        await db.execute(
            select(WatchlistVessel.mmsi)
            .join(Watchlist, Watchlist.id == WatchlistVessel.watchlist_id)
            .where(Watchlist.user_id == current_user.id)
            .distinct()
        )
    ).scalars()
    return list(rows)


@router.get("/{watchlist_id}", response_model=WatchlistDetailOut)
async def get_watchlist(
    watchlist_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistDetailOut:
    watchlist = await _get_owned_watchlist(db, watchlist_id, current_user)

    position_geom = cast(VesselLatest.position, Geometry)
    query = (
        select(
            WatchlistVessel,
            Vessel.name,
            Vessel.imo,
            Vessel.ship_type,
            ST_X(position_geom).label("lon"),
            ST_Y(position_geom).label("lat"),
            VesselLatest.observed_at,
            VesselLatest.received_at,
            VesselLatest.sog_kn,
            VesselLatest.cog_deg,
            VesselLatest.heading_deg,
            VesselLatest.nav_status,
            VesselLatest.destination,
            VesselLatest.quality_flags,
        )
        .join(Vessel, Vessel.mmsi == WatchlistVessel.mmsi)
        .outerjoin(VesselLatest, VesselLatest.mmsi == WatchlistVessel.mmsi)
        .where(WatchlistVessel.watchlist_id == watchlist.id)
        .order_by(WatchlistVessel.added_at)
    )
    rows = (await db.execute(query)).all()

    vessels = []
    for row in rows:
        wv, name, imo, ship_type, lon, lat, observed_at, received_at = row[:8]
        sog_kn, cog_deg, heading_deg, nav_status, destination, quality_flags = row[8:]
        vessels.append(
            WatchlistVesselOut(
                mmsi=wv.mmsi,
                name=name,
                note=wv.note,
                added_at=wv.added_at,
                lon=lon,
                lat=lat,
                observed_at=observed_at,
                received_at=received_at,
                freshness=freshness_for(observed_at, received_at) if received_at else None,
                sog_kn=float(sog_kn) if sog_kn is not None else None,
                cog_deg=float(cog_deg) if cog_deg is not None else None,
                heading_deg=heading_deg,
                nav_status=nav_status,
                quality_flags=quality_flags or [],
                imo=imo,
                ship_type=ship_type,
                destination=destination,
            )
        )

    return WatchlistDetailOut(
        id=str(watchlist.id), name=watchlist.name, created_at=watchlist.created_at, vessels=vessels
    )


@router.patch(
    "/{watchlist_id}", response_model=WatchlistOut, dependencies=_WRITE_GUARD
)
async def rename_watchlist(
    watchlist_id: str,
    body: WatchlistRename,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WatchlistOut:
    watchlist = await _get_owned_watchlist(db, watchlist_id, current_user)
    watchlist.name = body.name
    await db.commit()

    count = await db.scalar(
        select(func.count(WatchlistVessel.id)).where(WatchlistVessel.watchlist_id == watchlist.id)
    )
    return WatchlistOut(
        id=str(watchlist.id),
        name=watchlist.name,
        created_at=watchlist.created_at,
        vessel_count=count or 0,
    )


@router.delete(
    "/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_WRITE_GUARD
)
async def delete_watchlist(
    watchlist_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    watchlist = await _get_owned_watchlist(db, watchlist_id, current_user)
    await db.execute(delete(WatchlistVessel).where(WatchlistVessel.watchlist_id == watchlist.id))
    await db.delete(watchlist)
    await db.commit()


@router.put(
    "/{watchlist_id}/vessels/{mmsi}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=_WRITE_GUARD,
)
async def add_vessel_to_watchlist(
    watchlist_id: str,
    mmsi: str,
    body: Optional[WatchlistVesselAdd] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    watchlist = await _get_owned_watchlist(db, watchlist_id, current_user)

    stmt = pg_insert(WatchlistVessel).values(
        id=uuid.uuid4(),
        watchlist_id=watchlist.id,
        mmsi=mmsi,
        note=body.note if body else None,
        added_at=datetime.now(timezone.utc),
    )
    # A repeat add (e.g. re-importing a CSV) is rejected outright, not
    # merged -- it never updates an existing membership's note.
    stmt = stmt.on_conflict_do_nothing(index_elements=["watchlist_id", "mmsi"])
    try:
        await db.execute(stmt)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vessel not found") from None


@router.delete(
    "/{watchlist_id}/vessels/{mmsi}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=_WRITE_GUARD,
)
async def remove_vessel_from_watchlist(
    watchlist_id: str,
    mmsi: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    watchlist = await _get_owned_watchlist(db, watchlist_id, current_user)
    await db.execute(
        delete(WatchlistVessel).where(
            WatchlistVessel.watchlist_id == watchlist.id, WatchlistVessel.mmsi == mmsi
        )
    )
    await db.commit()
