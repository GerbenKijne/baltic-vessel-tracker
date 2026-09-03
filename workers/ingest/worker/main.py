"""Ingestion worker entrypoint: adapter -> parse -> normalize -> dedupe ->
persist -> publish (PRD SS8.1). Runs the full pipeline for whichever adapter
is configured.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from canonical import Source
from redis.asyncio import Redis, from_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .adapters.aisstream import AISStreamAdapter
from .adapters.base import Adapter
from .adapters.simulator import SimulatorAdapter
from .config import WorkerConfig, load_config
from .dedupe import is_duplicate
from .normalize import IgnorableMessage, parse_and_normalize
from .persistence import (
    insert_position_observation,
    record_raw_message,
    record_source_heartbeat,
    upsert_vessel_identity,
    upsert_vessel_latest,
)
from .publish import publish_vessel_upsert
from .retention import retention_loop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def build_adapter(config: WorkerConfig) -> Adapter:
    name = config.adapter
    if name == "simulator":
        return SimulatorAdapter()
    if name == "aisstream":
        if not config.aisstream_api_key:
            raise ValueError(
                "AISSTREAM_API_KEY is not set. Get a key at https://aisstream.io "
                "and complete the review in docs/data-source-register.md before "
                "enabling this adapter."
            )
        return AISStreamAdapter(
            api_key=config.aisstream_api_key,
            bounding_boxes=config.aisstream_bounding_boxes,
        )
    raise ValueError(
        f"Unknown adapter {name!r}. See docs/data-source-register.md for "
        "which adapters are actually ready to enable."
    )


async def _ingest_loop(
    config: WorkerConfig, adapter: Adapter, engine: AsyncEngine, redis: Redis
) -> None:
    source = Source(adapter.source)
    message_count = 0
    error_count = 0
    last_heartbeat = datetime.now(timezone.utc)

    logger.info("Starting ingest worker with adapter=%s", config.adapter)

    async for raw in adapter.stream():
        received_at = datetime.now(timezone.utc)
        try:
            obs = parse_and_normalize(raw, source)
        except IgnorableMessage:
            continue
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

            inserted = False
            async with engine.begin() as conn:
                await upsert_vessel_identity(conn, obs.mmsi, obs.name)
                # Identity-only messages (e.g. AISStream ShipStaticData)
                # carry no position -- upsert_vessel_latest would otherwise
                # null out a vessel's last known position/kinematics.
                if obs.position is not None:
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


async def run() -> None:
    config = load_config()
    adapter = build_adapter(config)
    engine = create_async_engine(config.database_url, pool_pre_ping=True)
    redis = from_url(config.redis_url)

    # Runs alongside the ingest loop for the lifetime of the process --
    # one already-continuous worker, no separate cron/service needed.
    await asyncio.gather(
        _ingest_loop(config, adapter, engine, redis),
        retention_loop(engine, config),
    )


if __name__ == "__main__":
    asyncio.run(run())
