import uuid
from datetime import datetime, timezone
from email.message import EmailMessage

import aiosmtplib
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_csrf, require_write_access
from ..models import DataSourceConfig, RetentionSettings, SmtpSettings, SourceStatus
from ..schemas import (
    DATA_SOURCE_ADAPTERS,
    DataSourceCreate,
    DataSourceOut,
    DataSourceUpdate,
    RetentionSettingsOut,
    RetentionSettingsUpdate,
    SmtpSettingsOut,
    SmtpSettingsUpdate,
    SmtpTestEmailIn,
    SourceStatusOut,
    StorageStatsOut,
    TableStorageOut,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

_WRITE_GUARD = [Depends(get_current_user), Depends(require_csrf), Depends(require_write_access)]

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
    "data_sources",
    "users",
]


def _data_source_out(row: DataSourceConfig) -> DataSourceOut:
    preview = f"••••{row.api_key[-4:]}" if row.api_key and len(row.api_key) >= 4 else None
    return DataSourceOut(
        id=str(row.id),
        name=row.name,
        adapter=row.adapter,
        has_api_key=bool(row.api_key),
        api_key_preview=preview,
        bounding_boxes=row.bounding_boxes,
        enabled=row.enabled,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


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
    dependencies=_WRITE_GUARD,
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
    dependencies=_WRITE_GUARD,
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


def _smtp_settings_out(row: SmtpSettings) -> SmtpSettingsOut:
    preview = f"••••{row.password[-4:]}" if row.password and len(row.password) >= 4 else None
    return SmtpSettingsOut(
        host=row.host,
        port=row.port,
        username=row.username,
        has_password=bool(row.password),
        password_preview=preview,
        from_address=row.from_address,
        use_tls=row.use_tls,
        updated_at=row.updated_at,
    )


@router.get(
    "/smtp-settings", response_model=SmtpSettingsOut, dependencies=[Depends(get_current_user)]
)
async def get_smtp_settings(db: AsyncSession = Depends(get_db)) -> SmtpSettingsOut:
    row = await db.get(SmtpSettings, 1)
    if row is None:
        # Only reachable if the seed row from the migration was deleted.
        return SmtpSettingsOut(
            host=None,
            port=587,
            username=None,
            has_password=False,
            password_preview=None,
            from_address=None,
            use_tls=True,
            updated_at=datetime.now(timezone.utc),
        )
    return _smtp_settings_out(row)


@router.put(
    "/smtp-settings",
    response_model=SmtpSettingsOut,
    dependencies=_WRITE_GUARD,
)
async def update_smtp_settings(
    body: SmtpSettingsUpdate, db: AsyncSession = Depends(get_db)
) -> SmtpSettingsOut:
    """Takes effect on the ingest worker's next notification-delivery pass
    (it reads this table fresh on every attempt) -- no restart needed."""
    row = await db.get(SmtpSettings, 1)
    if row is None:
        row = SmtpSettings(id=1)
        db.add(row)
    row.host = body.host
    row.port = body.port
    row.username = body.username
    if body.password is not None:
        row.password = body.password
    row.from_address = body.from_address
    row.use_tls = body.use_tls
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _smtp_settings_out(row)


@router.post(
    "/smtp-settings/test-email",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=_WRITE_GUARD,
)
async def send_test_email(body: SmtpTestEmailIn, db: AsyncSession = Depends(get_db)) -> None:
    """Synchronous send for immediate pass/fail feedback in the Admin UI --
    the actual alert-delivery path (workers/ingest/worker/notify.py) is
    async with retries; this is deliberately not that, since an operator
    verifying credentials wants an answer now, not "check back in 15s"."""
    row = await db.get(SmtpSettings, 1)
    if row is None or not row.host or not row.from_address:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "SMTP host and from address must be set first"
        )

    message = EmailMessage()
    message["From"] = row.from_address
    message["To"] = body.to
    message["Subject"] = "Baltic Vessel Tracker — test email"
    message.set_content(
        "This is a test message from your Baltic Vessel Tracker instance's SMTP settings."
    )
    try:
        await aiosmtplib.send(
            message,
            hostname=row.host,
            port=row.port,
            username=row.username or None,
            password=row.password or None,
            start_tls=row.use_tls,
        )
    except Exception as exc:  # noqa: BLE001 - surface the real SMTP error to the operator
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"SMTP send failed: {exc}") from exc


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


def _validate_data_source_create(body: DataSourceCreate) -> None:
    if body.adapter not in DATA_SOURCE_ADAPTERS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown adapter {body.adapter!r}; must be one of {sorted(DATA_SOURCE_ADAPTERS)}",
        )
    if body.adapter == "aisstream" and not body.api_key:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "AISStream needs an API key -- get a free one at https://aisstream.io",
        )


@router.get(
    "/data-sources",
    response_model=list[DataSourceOut],
    dependencies=[Depends(get_current_user)],
)
async def list_data_sources(db: AsyncSession = Depends(get_db)) -> list[DataSourceOut]:
    rows = (
        await db.execute(select(DataSourceConfig).order_by(DataSourceConfig.created_at))
    ).scalars().all()
    return [_data_source_out(row) for row in rows]


@router.post(
    "/data-sources",
    response_model=DataSourceOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=_WRITE_GUARD,
)
async def create_data_source(
    body: DataSourceCreate, db: AsyncSession = Depends(get_db)
) -> DataSourceOut:
    """Takes effect once the ingest worker notices this table changed and
    restarts itself to pick it up (workers/ingest/worker/sources.py) --
    within one watch interval, not instantly."""
    _validate_data_source_create(body)
    now = datetime.now(timezone.utc)
    row = DataSourceConfig(
        id=uuid.uuid4(),
        name=body.name,
        adapter=body.adapter,
        api_key=body.api_key if body.adapter == "aisstream" else None,
        bounding_boxes=body.bounding_boxes,
        enabled=body.enabled,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    await db.commit()
    return _data_source_out(row)


@router.patch(
    "/data-sources/{source_id}",
    response_model=DataSourceOut,
    dependencies=_WRITE_GUARD,
)
async def update_data_source(
    source_id: uuid.UUID, body: DataSourceUpdate, db: AsyncSession = Depends(get_db)
) -> DataSourceOut:
    row = await db.get(DataSourceConfig, source_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Data source not found")
    if body.name is not None:
        row.name = body.name
    if body.api_key is not None:
        row.api_key = body.api_key
    if body.bounding_boxes is not None:
        row.bounding_boxes = body.bounding_boxes
    if body.enabled is not None:
        row.enabled = body.enabled
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _data_source_out(row)


@router.delete(
    "/data-sources/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=_WRITE_GUARD,
)
async def delete_data_source(source_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(delete(DataSourceConfig).where(DataSourceConfig.id == source_id))
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Data source not found")
    await db.commit()
