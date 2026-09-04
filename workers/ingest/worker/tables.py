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
    Boolean,
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
    Column("eta_text", String(20), nullable=True),
    Column("draught_m", Numeric, nullable=True),
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

# Only the column the retention sweep actually needs (mmsi, to know which
# vessels are watchlisted) -- deliberately not the full watchlist_vessels
# schema (no FK to a `watchlists` table this metadata doesn't define; the
# worker never writes to this table, only reads from it).
watchlist_vessels = Table(
    "watchlist_vessels",
    metadata,
    Column("id", UUID, primary_key=True),
    Column("mmsi", String(9), nullable=False),
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

# Singleton row (id=1), managed by the API's Admin "Retention & storage"
# controls -- the retention sweep reads it fresh every run so a change
# there takes effect without restarting this worker.
retention_settings = Table(
    "retention_settings",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("default_hours", Integer, nullable=False),
    Column("watchlisted_days", Integer, nullable=False),
    Column("sweep_interval_seconds", Integer, nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

# Admin-configured ingest sources (Admin "Data sources" page) -- see
# worker/sources.py, which reads every enabled row here at this worker's
# own startup and runs one adapter per row.
data_sources = Table(
    "data_sources",
    metadata,
    Column("id", UUID, primary_key=True),
    Column("name", String(120), nullable=False),
    Column("adapter", String(30), nullable=False),
    Column("api_key", Text, nullable=True),
    Column("bounding_boxes", JSONB, nullable=True),
    Column("enabled", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)
