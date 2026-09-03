from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_csrf
from ..models import RetentionSettings, SourceStatus
from ..schemas import (
    RetentionSettingsOut,
    RetentionSettingsUpdate,
    SourceStatusOut,
    StorageStatsOut,
    TableStorageOut,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

# The tables PRD SS10 actually created (0001_initial_schema) -- reported
# even though several (geofences, alert_rules, ...) are empty today since
# those features aren't built yet; an honest zero beats silently omitting
# a table that exists.
_STORAGE_TABLES = [
    "vessels",
    "vessel_latest",
    "position_observations",
    "raw_messages",
    "watchlists",
    "watchlist_vessels",
    "geofences",
    "alert_rules",
    "alert_events",
    "notification_deliveries",
    "source_status",
    "users",
]


@router.get(
    "/sources", response_model=list[SourceStatusOut], dependencies=[Depends(get_current_user)]
)
async def list_source_status(db: AsyncSession = Depends(get_db)) -> list[SourceStatusOut]:
    rows = (await db.execute(select(SourceStatus))).scalars().all()
    return [
        SourceStatusOut(
            source=row.source,
            instance=row.instance,
            state=row.state,
            last_message_at=row.last_message_at,
            message_count=row.message_count,
            error_count=row.error_count,
            reconnect_count=row.reconnect_count,
            error_summary=row.error_summary,
        )
        for row in rows
    ]


@router.delete(
    "/sources/{source}/{instance}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user), Depends(require_csrf)],
)
async def remove_source_status(
    source: str, instance: str, db: AsyncSession = Depends(get_db)
) -> None:
    """Manual cleanup for stale rows -- most commonly a previous worker
    instance whose identity (container hostname) no longer exists, left
    permanently "degraded" once nothing updates it again. Does not affect
    a currently-running instance; it will just reappear on its next
    heartbeat if you delete an active one by mistake."""
    result = await db.execute(
        delete(SourceStatus).where(
            SourceStatus.source == source, SourceStatus.instance == instance
        )
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source instance not found")
    await db.commit()


@router.get(
    "/retention", response_model=RetentionSettingsOut, dependencies=[Depends(get_current_user)]
)
async def get_retention_settings(db: AsyncSession = Depends(get_db)) -> RetentionSettingsOut:
    row = await db.get(RetentionSettings, 1)
    if row is None:
        # Only reachable if the seed row from the migration was somehow
        # deleted -- fall back to the same defaults it was seeded with,
        # rather than erroring the whole Admin page.
        return RetentionSettingsOut(
            default_hours=24,
            watchlisted_days=365,
            sweep_interval_seconds=3600,
            updated_at=datetime.now(timezone.utc),
        )
    return RetentionSettingsOut(
        default_hours=row.default_hours,
        watchlisted_days=row.watchlisted_days,
        sweep_interval_seconds=row.sweep_interval_seconds,
        updated_at=row.updated_at,
    )


@router.put(
    "/retention",
    response_model=RetentionSettingsOut,
    dependencies=[Depends(get_current_user), Depends(require_csrf)],
)
async def update_retention_settings(
    body: RetentionSettingsUpdate, db: AsyncSession = Depends(get_db)
) -> RetentionSettingsOut:
    """Takes effect on the ingest worker's next retention sweep (it reads
    this table fresh every run) -- no restart needed, but changes aren't
    instant either; up to one sweep interval's delay."""
    now = datetime.now(timezone.utc)
    stmt = pg_insert(RetentionSettings.__table__).values(
        id=1,
        default_hours=body.default_hours,
        watchlisted_days=body.watchlisted_days,
        sweep_interval_seconds=body.sweep_interval_seconds,
        updated_at=now,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[RetentionSettings.__table__.c.id],
        set_={
            "default_hours": stmt.excluded.default_hours,
            "watchlisted_days": stmt.excluded.watchlisted_days,
            "sweep_interval_seconds": stmt.excluded.sweep_interval_seconds,
            "updated_at": stmt.excluded.updated_at,
        },
    )
    await db.execute(stmt)
    await db.commit()
    return RetentionSettingsOut(
        default_hours=body.default_hours,
        watchlisted_days=body.watchlisted_days,
        sweep_interval_seconds=body.sweep_interval_seconds,
        updated_at=now,
    )


@router.get(
    "/storage", response_model=StorageStatsOut, dependencies=[Depends(get_current_user)]
)
async def get_storage_stats(db: AsyncSession = Depends(get_db)) -> StorageStatsOut:
    """Row counts are Postgres's own planner estimates (pg_class.reltuples),
    not exact COUNT(*) -- instant regardless of table size, which matters
    once position_observations is large, at the cost of some drift right
    after a big insert/delete burst until the next autovacuum/analyze."""
    db_size = await db.scalar(text("SELECT pg_database_size(current_database())"))

    rows = (
        await db.execute(
            text(
                "SELECT relname, reltuples::bigint FROM pg_class "
                "WHERE relname = ANY(:names) AND relkind = 'r'"
            ),
            {"names": _STORAGE_TABLES},
        )
    ).all()
    counts = {name: max(0, count) for name, count in rows}

    return StorageStatsOut(
        database_size_bytes=db_size or 0,
        tables=[
            TableStorageOut(name=name, estimated_row_count=counts.get(name, 0))
            for name in _STORAGE_TABLES
        ],
    )
