"""Periodic cleanup of position_observations (user policy, 2026-09-03):
a vessel nobody's watching keeps a short window, a watchlisted one keeps
a much longer one. Without this, the table grows unbounded once real AIS
traffic flows continuously -- PRD SS14's "no unbounded in-memory
collections" applies just as much to disk here.

Runs inside worker-ingest rather than as a separate service/cron job --
one already-continuous asyncio process, no extra infrastructure.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine

from .config import WorkerConfig
from .tables import position_observations, watchlist_vessels

logger = logging.getLogger(__name__)


async def run_retention_sweep(engine: AsyncEngine, config: WorkerConfig) -> None:
    now = datetime.now(timezone.utc)
    default_cutoff = now - timedelta(hours=config.retention_default_hours)
    watchlisted_cutoff = now - timedelta(days=config.retention_watchlisted_days)

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
        config.retention_default_hours,
        watchlisted_result.rowcount,
        config.retention_watchlisted_days,
    )


async def retention_loop(engine: AsyncEngine, config: WorkerConfig) -> None:
    while True:
        try:
            await run_retention_sweep(engine, config)
        except Exception:  # noqa: BLE001 - a sweep failure must not crash the worker
            logger.exception("Retention sweep failed; will retry next interval")
        await asyncio.sleep(config.retention_sweep_interval_seconds)
