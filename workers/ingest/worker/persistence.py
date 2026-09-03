"""Upsert latest state and append history idempotently (PRD SS8.1 step 5)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from canonical import CanonicalAisObservation
from geoalchemy2.elements import WKTElement
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncConnection

from .tables import position_observations, raw_messages, source_status, vessel_latest, vessels


def _point(lon: float, lat: float) -> WKTElement:
    return WKTElement(f"POINT({lon} {lat})", srid=4326)


async def upsert_vessel_identity(conn: AsyncConnection, mmsi: str, name: Optional[str]) -> None:
    stmt = pg_insert(vessels).values(mmsi=mmsi, name=name)
    stmt = stmt.on_conflict_do_update(
        index_elements=[vessels.c.mmsi],
        set_={"name": stmt.excluded.name},
        where=stmt.excluded.name.is_not(None),
    )
    await conn.execute(stmt)


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
        "quality_flags": [f.value for f in obs.quality_flags],
        "provenance": {"source": obs.source.value, "received_at": obs.received_at.isoformat()},
    }
    stmt = pg_insert(vessel_latest).values(**values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[vessel_latest.c.mmsi],
        set_={k: stmt.excluded[k] for k in values if k != "mmsi"},
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
