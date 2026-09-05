"""SQLAlchemy models for the canonical schema (PRD SS10).

Only `users`, `vessels`, `vessel_latest`, `position_observations`, and
`raw_messages` are populated/read by the Phase 1 walking skeleton.
`watchlists`, `geofences`, `alert_rules`, `alert_events`,
`notification_deliveries`, and `source_status` are created now so later
phases don't need a disruptive migration, per docs/adr/0001.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from geoalchemy2 import Geography
from sqlalchemy import (
    ARRAY,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="admin")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Vessel(Base):
    __tablename__ = "vessels"

    mmsi: Mapped[str] = mapped_column(String(9), primary_key=True)
    imo: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    callsign: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ship_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    dimensions: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    identity_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class VesselLatest(Base):
    __tablename__ = "vessel_latest"

    mmsi: Mapped[str] = mapped_column(String(9), ForeignKey("vessels.mmsi"), primary_key=True)
    position: Mapped[Optional[str]] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True
    )
    observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    sog_kn: Mapped[Optional[float]] = mapped_column(Numeric, nullable=True)
    cog_deg: Mapped[Optional[float]] = mapped_column(Numeric, nullable=True)
    heading_deg: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    nav_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    destination: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    eta_text: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    draught_m: Mapped[Optional[float]] = mapped_column(Numeric, nullable=True)
    quality_flags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    provenance: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class PositionObservation(Base):
    __tablename__ = "position_observations"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    dedupe_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    mmsi: Mapped[str] = mapped_column(String(9), ForeignKey("vessels.mmsi"), nullable=False)
    position: Mapped[Optional[str]] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True
    )
    observed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    quality_flags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    sog_kn: Mapped[Optional[float]] = mapped_column(Numeric, nullable=True)


class RawMessage(Base):
    __tablename__ = "raw_messages"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String(30), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    parse_status: Mapped[str] = mapped_column(String(20), nullable=False)
    parse_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class Watchlist(Base):
    __tablename__ = "watchlists"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(PGUUID, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    vessels: Mapped[list[WatchlistVessel]] = relationship(back_populates="watchlist")


class WatchlistVessel(Base):
    __tablename__ = "watchlist_vessels"
    __table_args__ = (UniqueConstraint("watchlist_id", "mmsi", name="uq_watchlist_vessel"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    watchlist_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID, ForeignKey("watchlists.id"), nullable=False
    )
    mmsi: Mapped[str] = mapped_column(String(9), ForeignKey("vessels.mmsi"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    watchlist: Mapped[Watchlist] = relationship(back_populates="vessels")


class Geofence(Base):
    __tablename__ = "geofences"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(PGUUID, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    geometry: Mapped[str] = mapped_column(
        Geography(geometry_type="POLYGON", srid=4326), nullable=False
    )
    style: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AlertRule(Base):
    __tablename__ = "alert_rules"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(PGUUID, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    target: Mapped[dict] = mapped_column(JSONB, nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # When set, a newly-fired (non-duplicate) event for this rule also
    # adds the vessel to this watchlist -- e.g. auto-curate a list from a
    # geofence_enter rule. ON DELETE SET NULL: deleting the target
    # watchlist just turns this back into a plain alert.
    add_to_watchlist_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        PGUUID, ForeignKey("watchlists.id", ondelete="SET NULL"), nullable=True
    )
    # Delivery channels beyond the always-on in-app event log. Both are
    # optional and independent -- a rule can email, webhook, both, or
    # neither. webhook_secret is plaintext (same trust model as
    # DataSourceConfig.api_key) but never echoed back by the API; see
    # AlertRuleOut.has_webhook_secret/webhook_secret_preview.
    email_to: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    webhook_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    webhook_secret: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class AlertEvent(Base):
    __tablename__ = "alert_events"
    __table_args__ = (UniqueConstraint("transition_key", name="uq_alert_event_transition"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(PGUUID, ForeignKey("alert_rules.id"), nullable=False)
    mmsi: Mapped[str] = mapped_column(String(9), ForeignKey("vessels.mmsi"), nullable=False)
    transition_key: Mapped[str] = mapped_column(String(128), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID, ForeignKey("alert_events.id"), nullable=False
    )
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    attempt: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    next_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class SourceStatus(Base):
    __tablename__ = "source_status"

    source: Mapped[str] = mapped_column(String(30), primary_key=True)
    instance: Mapped[str] = mapped_column(String(60), primary_key=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False, default="unknown")
    last_message_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    message_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    reconnect_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class RetentionSettings(Base):
    """Singleton row (id is always 1) -- the ingest worker's retention
    sweep (workers/ingest/worker/retention.py) reads this table fresh on
    every sweep instead of a static env-loaded value, so an admin change
    here takes effect on the next sweep without restarting the worker."""

    __tablename__ = "retention_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    default_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24)
    watchlisted_days: Mapped[int] = mapped_column(Integer, nullable=False, default=365)
    sweep_interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=3600)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class SmtpSettings(Base):
    """Singleton row (id is always 1), same pattern as RetentionSettings --
    the ingest worker's notification loop (workers/ingest/worker/notify.py)
    reads this table fresh on every delivery attempt instead of a static
    env-loaded value, so an admin change here takes effect on the next
    attempt without restarting the worker."""

    __tablename__ = "smtp_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_smtp_settings_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    port: Mapped[int] = mapped_column(Integer, nullable=False, default=587)
    username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Plaintext, same trust model as DataSourceConfig.api_key.
    password: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    from_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    use_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DataSourceConfig(Base):
    """Admin-configured ingest source (Admin "Data sources" page) --
    replaces the old INGEST_ADAPTER/AISSTREAM_* env vars. The ingest
    worker (workers/ingest/worker/sources.py) reads every enabled row
    here at its own startup and runs one adapter per row; it also
    watches this table for changes and restarts itself (docker-compose's
    `restart: unless-stopped` brings it back up already reading the new
    config) when a row is added, edited, enabled, or disabled -- so a
    change here takes effect within one watch interval, not instantly,
    and not without a brief ingestion gap while it restarts."""

    __tablename__ = "data_sources"
    __table_args__ = (
        CheckConstraint("adapter IN ('simulator', 'aisstream')", name="ck_data_sources_adapter"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    adapter: Mapped[str] = mapped_column(String(30), nullable=False)
    # Plaintext, same trust model as the .env file it replaces -- whoever
    # can reach this database or the Admin UI already has full admin
    # access to this single-operator app.
    api_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    bounding_boxes: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
