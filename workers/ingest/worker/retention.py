"""Periodic cleanup of position_observations (user policy, 2026-09-03):
a vessel nobody's watching keeps a short window, a watchlisted one keeps
a much longer one. Without this, the table grows unbounded once real AIS
traffic flows continuously -- PRD SS14's "no unbounded in-memory
collections" applies just as much to disk here.

Runs inside worker-ingest rather than as a separate service/cron job --
one already-continuous asyncio process, no extra infrastructure. Reads
its settings fresh from retention_settings (a singleton row the API's
Admin "Retention & storage" controls write to) on every sweep, rather
than a static env-loaded value -- so an admin can change the policy
without restarting this worker; the config defaults only matter if that
row is somehow missing.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine

from .config import WorkerConfig
from .tables import position_observations, retention_settings, watchlist_vessels

logger = logging.getLogger(__name__)


class RetentionSettings(NamedTuple):
    default_hours: int
    watchlisted_days: int
    sweep_interval_seconds: int


async def _load_settings(engine: AsyncEngine, config: WorkerConfig) -> RetentionSettings:
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(
                    retention_settings.c.default_hours,
                    retention_settings.c.watchlisted_days,
                    retention_settings.c.sweep_interval_seconds,
                ).where(retention_settings.c.id == 1)
            )
        ).first()
    if row is None:
        # Only reachable if the migration's seed row was somehow deleted.
        return RetentionSettings(
            config.retention_default_hours,
            config.retention_watchlisted_days,
            config.retention_sweep_interval_seconds,
        )
    return RetentionSettings(*row)


async def run_retention_sweep(engine: AsyncEngine, config: WorkerConfig) -> RetentionSettings:
    settings = await _load_settings(engine, config)
    now = datetime.now(timezone.utc)
    default_cutoff = now - timedelta(hours=settings.default_hours)
    watchlisted_cutoff = now - timedelta(days=settings.watchlisted_days)

    watchlisted_mmsi = select(watchlist_vessels.c.mmsi).distinct()

    async with engine.begin() as conn:
        default_result = await conn.execute(
            delete(position_observations).where(
                position_observations.c.received_at < default_cutoff,
                position_observations.c.mmsi.not_in(watchlisted_mmsi),
            )
        )
        watchlisted_result = await conn.execute(
            delete(position_observations).where(
                position_observations.c.received_at < watchlisted_cutoff,
                position_observations.c.mmsi.in_(watchlisted_mmsi),
            )
        )

    logger.info(
        "Retention sweep: removed %d row(s) older than %dh (not watchlisted), "
        "%d row(s) older than %dd (watchlisted)",
        default_result.rowcount,
        settings.default_hours,
        watchlisted_result.rowcount,
        settings.watchlisted_days,
    )
    return settings


async def retention_loop(engine: AsyncEngine, config: WorkerConfig) -> None:
    while True:
        try:
            settings = await run_retention_sweep(engine, config)
            interval = settings.sweep_interval_seconds
        except Exception:  # noqa: BLE001 - a sweep failure must not crash the worker
            logger.exception("Retention sweep failed; will retry next interval")
            interval = config.retention_sweep_interval_seconds
        await asyncio.sleep(interval)
