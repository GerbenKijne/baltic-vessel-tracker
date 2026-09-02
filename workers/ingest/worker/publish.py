"""Publish accepted observations to the vessel-updates stream (PRD SS8.1 step 6).

Consumed by apps/api/app/realtime/manager.py, which fans it out to
subscribed WebSocket clients.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from canonical import SCHEMA_VERSION, CanonicalAisObservation
from redis.asyncio import Redis

STREAM_NAME = "vessel-updates"
STREAM_MAXLEN = 100_000


async def publish_vessel_upsert(redis: Redis, obs: CanonicalAisObservation) -> None:
    message = {
        "type": "vessel.upsert",
        "schema_version": SCHEMA_VERSION,
        "server_time": datetime.now(timezone.utc).isoformat(),
        "mmsi": obs.mmsi,
        "position": {"lon": obs.position.lon, "lat": obs.position.lat} if obs.position else None,
        "sog_kn": obs.sog_kn,
        "cog_deg": obs.cog_deg,
        "heading_deg": obs.heading_deg,
        "nav_status": obs.nav_status.value if obs.nav_status else None,
        "observed_at": obs.observed_at.isoformat() if obs.observed_at else None,
        "received_at": obs.received_at.isoformat(),
        "source": obs.source.value,
        "quality_flags": [f.value for f in obs.quality_flags],
    }
    await redis.xadd(
        STREAM_NAME, {"payload": json.dumps(message)}, maxlen=STREAM_MAXLEN, approximate=True
    )
