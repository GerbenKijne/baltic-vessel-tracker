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
    type: Mapped[str] = mapped_column(String(30), nullable=False)
    target: Mapped[dict] = mapped_column(JSONB, nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=900)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AlertEvent(Base):
    __tablename__ = "alert_events"
    __table_args__ = (UniqueConstraint("transition_key", name="uq_alert_event_transition"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID, primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(PGUUID, ForeignKey("alert_rules.id"), nullable=False)
    mmsi: Mapped[str] = mapped_column(String(9), ForeignKey("vessels.mmsi"), nullable=False)
    transition_key: Mapped[str] = mapped_column(String(128), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


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
