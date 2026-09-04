"""Upsert latest state and append history idempotently (PRD SS8.1 step 5)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from canonical import CanonicalAisObservation
from geoalchemy2 import Geometry
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_X, ST_Y
from sqlalchemy import cast, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import position_observations, raw_messages, source_status, vessel_latest, vessels


def _point(lon: float, lat: float) -> WKTElement:
    return WKTElement(f"POINT({lon} {lat})", srid=4326)


async def get_previous_position(
    conn: AsyncConnection, mmsi: str
) -> Optional[tuple[float, float]]:
    """The vessel's position *before* this message's upsert overwrites it
    -- alert geofence enter/exit evaluation needs the prior point to
    detect a transition, so this must be called before upsert_vessel_latest.
    """
    position_geom = cast(vessel_latest.c.position, Geometry)
    row = (
        await conn.execute(
            select(ST_X(position_geom), ST_Y(position_geom)).where(
                vessel_latest.c.mmsi == mmsi, vessel_latest.c.position.is_not(None)
            )
        )
    ).first()
    if row is None:
        return None
    return (row[0], row[1])


async def upsert_vessel_identity(
    conn: AsyncConnection,
    mmsi: str,
    name: Optional[str],
    imo: Optional[int] = None,
    callsign: Optional[str] = None,
    ship_type: Optional[str] = None,
    dimensions: Optional[dict] = None,
) -> None:
    """Each field is only overwritten when the new message actually
    carries a value for it (COALESCE against the existing row) -- name,
    IMO, callsign, type, and dimensions arrive on different message
    types at different times, so a message that only knows the name
    must not null out a type learned from an earlier message."""
    values = {
        "mmsi": mmsi,
        "name": name,
        "imo": imo,
        "callsign": callsign,
        "ship_type": ship_type,
        "dimensions": dimensions,
    }
    stmt = pg_insert(vessels).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[vessels.c.mmsi],
        set_={
            k: func.coalesce(stmt.excluded[k], vessels.c[k]) for k in values if k != "mmsi"
        },
    )
    await conn.execute(stmt)


# Fields describing the vessel's current attributes -- a message that
# doesn't mention one (e.g. a position report carries no destination)
# must not erase a value learned from an earlier message. Fields NOT in
# this set (received_at, observed_at, quality_flags, provenance) describe
# facts about *this specific message* and are always overwritten flat.
_VESSEL_LATEST_COALESCE_FIELDS = frozenset(
    {
        "position",
        "sog_kn",
        "cog_deg",
        "heading_deg",
        "nav_status",
        "destination",
        "eta_text",
        "draught_m",
    }
)


async def upsert_vessel_latest(conn: AsyncConnection, obs: CanonicalAisObservation) -> None:
    position = _point(obs.position.lon, obs.position.lat) if obs.position else None
    values = {
        "mmsi": obs.mmsi,
        "position": position,
        "observed_at": obs.observed_at,
        "received_at": obs.received_at,
        "sog_kn": obs.sog_kn,
        "cog_deg": obs.cog_deg,
        "heading_deg": obs.heading_deg,
        "nav_status": obs.nav_status.value if obs.nav_status else None,
        "destination": obs.destination,
        "eta_text": obs.eta_text,
        "draught_m": obs.draught_m,
        "quality_flags": [f.value for f in obs.quality_flags],
        "provenance": {"source": obs.source.value, "received_at": obs.received_at.isoformat()},
    }
    stmt = pg_insert(vessel_latest).values(**values)
    set_ = {
        k: (
            func.coalesce(stmt.excluded[k], vessel_latest.c[k])
            if k in _VESSEL_LATEST_COALESCE_FIELDS
            else stmt.excluded[k]
        )
        for k in values
        if k != "mmsi"
    }
    stmt = stmt.on_conflict_do_update(
        index_elements=[vessel_latest.c.mmsi],
        set_=set_,
        where=(vessel_latest.c.received_at < stmt.excluded.received_at),
    )
    await conn.execute(stmt)


async def insert_position_observation(conn: AsyncConnection, obs: CanonicalAisObservation) -> bool:
    """Returns True if a new row was inserted, False if it was a replay."""
    position = _point(obs.position.lon, obs.position.lat) if obs.position else None
    stmt = pg_insert(position_observations).values(
        id=uuid.uuid4(),
        dedupe_key=obs.dedupe_key,
        mmsi=obs.mmsi,
        position=position,
        observed_at=obs.observed_at,
        received_at=obs.received_at,
        source=obs.source.value,
        quality_flags=[f.value for f in obs.quality_flags],
        sog_kn=obs.sog_kn,
    )
    stmt = stmt.on_conflict_do_nothing(index_elements=[position_observations.c.dedupe_key])
    result = await conn.execute(stmt)
    return result.rowcount > 0


async def record_raw_message(
    conn: AsyncConnection,
    source: str,
    payload: dict,
    parse_status: str,
    parse_error: Optional[str],
    received_at: datetime,
) -> uuid.UUID:
    message_id = uuid.uuid4()
    await conn.execute(
        raw_messages.insert().values(
            id=message_id,
            source=source,
            received_at=received_at,
            payload=payload,
            parse_status=parse_status,
            parse_error=parse_error,
        )
    )
    return message_id


async def record_source_heartbeat(
    conn: AsyncConnection,
    source: str,
    instance: str,
    state: str,
    last_message_at: Optional[datetime],
    message_count: int,
    error_count: int,
) -> None:
    stmt = pg_insert(source_status).values(
        source=source,
        instance=instance,
        state=state,
        last_message_at=last_message_at,
        message_count=message_count,
        error_count=error_count,
        reconnect_count=0,
        error_summary=None,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[source_status.c.source, source_status.c.instance],
        set_={
            "state": stmt.excluded.state,
            "last_message_at": stmt.excluded.last_message_at,
            "message_count": stmt.excluded.message_count,
            "error_count": stmt.excluded.error_count,
        },
    )
    await conn.execute(stmt)
