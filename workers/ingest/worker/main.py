"""Ingestion worker entrypoint: adapter -> parse -> normalize -> dedupe ->
persist -> publish (PRD SS8.1). Runs one full pipeline per enabled row in
the admin-configured `data_sources` table (worker/sources.py) -- zero, one,
or several adapters concurrently, not exactly one fixed by env vars.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from canonical import Source
from redis.asyncio import Redis, from_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from .adapters.base import Adapter
from .alerts import alerts_loop, evaluate_position_alerts
from .config import load_config
from .dedupe import is_duplicate
from .normalize import IgnorableMessage, parse_and_normalize
from .persistence import (
    get_previous_position,
    insert_position_observation,
    record_raw_message,
    record_source_heartbeat,
    upsert_vessel_identity,
    upsert_vessel_latest,
)
from .publish import publish_vessel_upsert
from .retention import retention_loop
from .sources import build_adapter, load_enabled_sources, sources_fingerprint, watch_for_changes

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def _ingest_loop(
    instance: str,
    heartbeat_interval_seconds: int,
    adapter: Adapter,
    engine: AsyncEngine,
    redis: Redis,
) -> None:
    source = Source(adapter.source)
    message_count = 0
    error_count = 0
    last_heartbeat = datetime.now(timezone.utc)

    logger.info("Starting ingest loop instance=%s adapter=%s", instance, source.value)

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
                await upsert_vessel_identity(
                    conn,
                    obs.mmsi,
                    obs.name,
                    imo=obs.imo,
                    callsign=obs.callsign,
                    ship_type=obs.ship_type,
                    dimensions=obs.dimensions,
                )
                # upsert_vessel_latest COALESCEs every field against the
                # existing row, so calling it even for an identity-only
                # message (no position) is safe -- it can only fill in
                # destination/ETA/draught, never null out a previously
                # known position/speed/heading.
                previous_position = None
                if obs.position is not None:
                    # Must run before the upsert overwrites it -- this is
                    # the "old" point geofence enter/exit needs to detect
                    # a transition against.
                    previous_position = await get_previous_position(conn, obs.mmsi)
                await upsert_vessel_latest(conn, obs)
                if obs.position is not None:
                    inserted = await insert_position_observation(conn, obs)
                    if inserted:
                        # Alerts only evaluate accepted state (PRD/design
                        # principle: a duplicate or rejected observation
                        # never fires a rule) -- gated on the same
                        # `inserted` flag as publishing the live update.
                        await evaluate_position_alerts(
                            conn,
                            obs.mmsi,
                            obs.position.lon,
                            obs.position.lat,
                            obs.sog_kn,
                            obs.received_at,
                            previous_position,
                        )

            if inserted:
                await publish_vessel_upsert(redis, obs)

        now = datetime.now(timezone.utc)
        if (now - last_heartbeat).total_seconds() >= heartbeat_interval_seconds:
            async with engine.begin() as conn:
                await record_source_heartbeat(
                    conn,
                    source.value,
                    instance,
                    "connected",
                    now,
                    message_count,
                    error_count,
                )
            last_heartbeat = now


async def run() -> None:
    config = load_config()
    engine = create_async_engine(config.database_url, pool_pre_ping=True)
    redis = from_url(config.redis_url)

    enabled_sources = await load_enabled_sources(engine)
    if not enabled_sources:
        logger.warning(
            "No enabled data sources configured -- ingestion is idle. "
            "Add one from Admin → Data sources."
        )
    # Captured before building any adapters so a config change made while
    # this worker is still starting up (e.g. during a slow AISStream
    # connect) isn't missed by watch_for_changes below.
    startup_fingerprint = await sources_fingerprint(engine)

    ingest_tasks = []
    for source in enabled_sources:
        try:
            adapter = build_adapter(source)
        except Exception:  # noqa: BLE001 - one bad source must not block the others
            logger.exception("Failed to start data source %r; skipping it", source.name)
            continue
        # Distinct per configured source (not just per adapter type), so
        # e.g. two aisstream rows with different bounding boxes get their
        # own source_status row instead of colliding on the same PK.
        instance = f"{config.instance_id}:{source.id[:8]}"
        ingest_tasks.append(
            _ingest_loop(instance, config.heartbeat_interval_seconds, adapter, engine, redis)
        )

    # Run alongside the ingest loop(s) for the lifetime of the process --
    # one already-continuous worker, no separate cron/service needed.
    await asyncio.gather(
        *ingest_tasks,
        retention_loop(engine, config),
        alerts_loop(engine),
        watch_for_changes(engine, startup_fingerprint),
    )


if __name__ == "__main__":
    asyncio.run(run())
