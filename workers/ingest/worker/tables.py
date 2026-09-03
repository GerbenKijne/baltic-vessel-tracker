"""SQLAlchemy Core table definitions mirroring apps/api/app/models.py.

The worker deliberately does not import the API's ORM models package (they
live in a separate Docker build) or own migrations — Alembic in apps/api is
the single source of truth for schema (docs/adr/0001). These Core tables
must be kept in sync with that schema by hand; a drift test belongs in
packages/test-fixtures before Phase 2.
"""
from __future__ import annotations

from geoalchemy2 import Geography
from sqlalchemy import (
    ARRAY,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    Numeric,
    String,
    Table,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

metadata = MetaData()

vessels = Table(
    "vessels",
    metadata,
    Column("mmsi", String(9), primary_key=True),
    Column("imo", Integer, nullable=True),
    Column("name", Text, nullable=True),
    Column("callsign", Text, nullable=True),
    Column("ship_type", String(50), nullable=True),
    Column("dimensions", JSONB, nullable=True),
    Column("identity_updated_at", DateTime(timezone=True), nullable=True),
)

vessel_latest = Table(
    "vessel_latest",
    metadata,
    Column("mmsi", String(9), ForeignKey("vessels.mmsi"), primary_key=True),
    Column("position", Geography(geometry_type="POINT", srid=4326), nullable=True),
    Column("observed_at", DateTime(timezone=True), nullable=True),
    Column("received_at", DateTime(timezone=True), nullable=False),
    Column("sog_kn", Numeric, nullable=True),
    Column("cog_deg", Numeric, nullable=True),
    Column("heading_deg", Integer, nullable=True),
    Column("nav_status", String(40), nullable=True),
    Column("destination", Text, nullable=True),
    Column("quality_flags", ARRAY(Text), nullable=False),
    Column("provenance", JSONB, nullable=False),
)

position_observations = Table(
    "position_observations",
    metadata,
    Column("id", UUID, primary_key=True),
    Column("dedupe_key", String(128), nullable=False, unique=True),
    Column("mmsi", String(9), ForeignKey("vessels.mmsi"), nullable=False),
    Column("position", Geography(geometry_type="POINT", srid=4326), nullable=True),
    Column("observed_at", DateTime(timezone=True), nullable=True),
    Column("received_at", DateTime(timezone=True), nullable=False),
    Column("source", String(30), nullable=False),
    Column("quality_flags", ARRAY(Text), nullable=False),
    Column("sog_kn", Numeric, nullable=True),
)

raw_messages = Table(
    "raw_messages",
    metadata,
    Column("id", UUID, primary_key=True),
    Column("source", String(30), nullable=False),
    Column("received_at", DateTime(timezone=True), nullable=False),
    Column("payload", JSONB, nullable=False),
    Column("parse_status", String(20), nullable=False),
    Column("parse_error", Text, nullable=True),
)

source_status = Table(
    "source_status",
    metadata,
    Column("source", String(30), primary_key=True),
    Column("instance", String(60), primary_key=True),
    Column("state", String(20), nullable=False),
    Column("last_message_at", DateTime(timezone=True), nullable=True),
    Column("message_count", Integer, nullable=False),
    Column("error_count", Integer, nullable=False),
    Column("reconnect_count", Integer, nullable=False),
    Column("error_summary", Text, nullable=True),
)
