"""Ingestion worker entrypoint: adapter -> parse -> normalize -> dedupe ->
persist -> publish (PRD SS8.1). Runs the full pipeline for whichever adapter
is configured; only the simulator is wired up in Phase 1.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from canonical import Source
from redis.asyncio import from_url
from sqlalchemy.ext.asyncio import create_async_engine

from .adapters.base import Adapter
from .adapters.simulator import SimulatorAdapter
from .config import load_config
from .dedupe import is_duplicate
from .normalize import parse_and_normalize
from .persistence import (
    insert_position_observation,
    record_raw_message,
    record_source_heartbeat,
    upsert_vessel_identity,
    upsert_vessel_latest,
)
from .publish import publish_vessel_upsert

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_adapter(name: str) -> Adapter:
    if name == "simulator":
        return SimulatorAdapter()
    raise ValueError(
        f"Unknown adapter {name!r}. Only 'simulator' is wired up in Phase 1 "
        "(see docs/data-source-register.md for the others' status)."
    )


async def run() -> None:
    config = load_config()
    adapter = build_adapter(config.adapter)
    source = Source(adapter.source)

    engine = create_async_engine(config.database_url, pool_pre_ping=True)
    redis = from_url(config.redis_url)

    message_count = 0
    error_count = 0
    last_heartbeat = datetime.now(timezone.utc)

    logger.info("Starting ingest worker with adapter=%s", config.adapter)

    async for raw in adapter.stream():
        received_at = datetime.now(timezone.utc)
        try:
            obs = parse_and_normalize(raw, source)
        except Exception as exc:  # noqa: BLE001 - a bad message must not crash the worker
            error_count += 1
            async with engine.begin() as conn:
                await record_raw_message(
                    conn, source.value, raw, "error", str(exc), received_at
                )
            logger.warning("Quarantined malformed message: %s", exc)
        else:
            message_count += 1
            if await is_duplicate(redis, obs.dedupe_key):
                continue

            async with engine.begin() as conn:
                await upsert_vessel_identity(conn, obs.mmsi, obs.name)
                await upsert_vessel_latest(conn, obs)
                inserted = await insert_position_observation(conn, obs)

            if inserted:
                await publish_vessel_upsert(redis, obs)

        now = datetime.now(timezone.utc)
        if (now - last_heartbeat).total_seconds() >= config.heartbeat_interval_seconds:
            async with engine.begin() as conn:
                await record_source_heartbeat(
                    conn,
                    source.value,
                    config.instance_id,
                    "connected",
                    now,
                    message_count,
                    error_count,
                )
            last_heartbeat = now


if __name__ == "__main__":
    asyncio.run(run())
