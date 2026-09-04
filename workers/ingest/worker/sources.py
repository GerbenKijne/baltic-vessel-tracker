"""Admin-configured data sources (Admin "Data sources" page in apps/web).

Replaces the old INGEST_ADAPTER/AISSTREAM_API_KEY/AISSTREAM_BOUNDING_BOXES
env vars, which fixed exactly one adapter at container build/start time.
`run()` in main.py now reads every enabled row in `data_sources` once at
its own startup and runs one `_ingest_loop` per row concurrently.

Picking up a config change (a row added, edited, enabled, or disabled)
still needs a worker restart -- rather than building live task
start/stop/supervision into one long-running process, `watch_for_changes`
below just notices the table changed and exits the process, and
docker-compose's `restart: unless-stopped` brings it back up already
reading the new config. Simpler and more robust than the alternative for
a self-hosted, single-operator app where a brief ingestion gap on change
doesn't matter.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from .adapters.aisstream import AISStreamAdapter
from .adapters.base import Adapter
from .adapters.simulator import SimulatorAdapter
from .config import DEFAULT_BOUNDING_BOXES
from .tables import data_sources

logger = logging.getLogger(__name__)

WATCH_INTERVAL_SECONDS = 20


@dataclass(frozen=True)
class SourceConfig:
    id: str
    name: str
    adapter: str
    api_key: Optional[str]
    bounding_boxes: Optional[list]


async def load_enabled_sources(engine: AsyncEngine) -> list[SourceConfig]:
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                select(
                    data_sources.c.id,
                    data_sources.c.name,
                    data_sources.c.adapter,
                    data_sources.c.api_key,
                    data_sources.c.bounding_boxes,
                )
                .where(data_sources.c.enabled.is_(True))
                .order_by(data_sources.c.created_at)
            )
        ).all()
    return [
        SourceConfig(
            id=str(row.id),
            name=row.name,
            adapter=row.adapter,
            api_key=row.api_key,
            bounding_boxes=row.bounding_boxes,
        )
        for row in rows
    ]


def build_adapter(source: SourceConfig) -> Adapter:
    if source.adapter == "simulator":
        return SimulatorAdapter()
    if source.adapter == "aisstream":
        if not source.api_key:
            raise ValueError(f"Data source {source.name!r} is aisstream but has no API key set")
        return AISStreamAdapter(
            api_key=source.api_key,
            bounding_boxes=source.bounding_boxes or DEFAULT_BOUNDING_BOXES,
        )
    raise ValueError(f"Unknown adapter {source.adapter!r} for data source {source.name!r}")


async def sources_fingerprint(engine: AsyncEngine) -> tuple[int, Optional[str]]:
    """Cheap "has anything about the enabled sources changed" check -- a
    count plus the newest updated_at among enabled rows. Doesn't need to
    identify *what* changed, only *that* something did."""
    async with engine.connect() as conn:
        row = (
            await conn.execute(
                select(func.count(), func.max(data_sources.c.updated_at)).where(
                    data_sources.c.enabled.is_(True)
                )
            )
        ).first()
    count, latest = row[0], row[1]
    return (count, latest.isoformat() if latest else None)


async def watch_for_changes(
    engine: AsyncEngine, startup_fingerprint: tuple[int, Optional[str]]
) -> None:
    while True:
        await asyncio.sleep(WATCH_INTERVAL_SECONDS)
        try:
            current = await sources_fingerprint(engine)
        except Exception:  # noqa: BLE001 - a failed check must not crash the worker
            logger.exception("Failed to check data_sources for changes")
            continue
        if current != startup_fingerprint:
            logger.info("data_sources changed -- restarting to apply the new configuration")
            os._exit(0)
