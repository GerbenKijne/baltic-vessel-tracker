"""Initial canonical schema (PRD SS10)

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-09-02

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "users",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="admin"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    op.create_table(
        "vessels",
        sa.Column("mmsi", sa.String(9), primary_key=True),
        sa.Column("imo", sa.BigInteger, nullable=True),
        sa.Column("name", sa.Text, nullable=True),
        sa.Column("callsign", sa.Text, nullable=True),
        sa.Column("ship_type", sa.String(50), nullable=True),
        sa.Column("dimensions", JSONB, nullable=True),
        sa.Column("identity_updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "vessel_latest",
        sa.Column("mmsi", sa.String(9), sa.ForeignKey("vessels.mmsi"), primary_key=True),
        sa.Column("position", Geography(geometry_type="POINT", srid=4326), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sog_kn", sa.Numeric, nullable=True),
        sa.Column("cog_deg", sa.Numeric, nullable=True),
        sa.Column("heading_deg", sa.Integer, nullable=True),
        sa.Column("nav_status", sa.String(40), nullable=True),
        sa.Column("destination", sa.Text, nullable=True),
        sa.Column(
            "quality_flags",
            sa.ARRAY(sa.Text),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("provenance", JSONB, nullable=False, server_default="{}"),
    )
    op.create_index(
        "ix_vessel_latest_position", "vessel_latest", ["position"], postgresql_using="gist"
    )

    op.create_table(
        "position_observations",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("dedupe_key", sa.String(128), nullable=False),
        sa.Column("mmsi", sa.String(9), sa.ForeignKey("vessels.mmsi"), nullable=False),
        sa.Column("position", Geography(geometry_type="POINT", srid=4326), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column(
            "quality_flags",
            sa.ARRAY(sa.Text),
            nullable=False,
            server_default="{}",
        ),
        sa.UniqueConstraint("dedupe_key", name="uq_position_observations_dedupe_key"),
    )
    op.create_index(
        "ix_position_observations_mmsi_time",
        "position_observations",
        ["mmsi", "received_at"],
    )
    op.create_index(
        "ix_position_observations_position",
        "position_observations",
        ["position"],
        postgresql_using="gist",
    )

    op.create_table(
        "raw_messages",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("source", sa.String(30), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("parse_status", sa.String(20), nullable=False),
        sa.Column("parse_error", sa.Text, nullable=True),
    )
    op.create_index("ix_raw_messages_received_at", "raw_messages", ["received_at"])

    op.create_table(
        "watchlists",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "watchlist_vessels",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("watchlist_id", UUID, sa.ForeignKey("watchlists.id"), nullable=False),
        sa.Column("mmsi", sa.String(9), sa.ForeignKey("vessels.mmsi"), nullable=False),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text, nullable=True),
        sa.UniqueConstraint("watchlist_id", "mmsi", name="uq_watchlist_vessel"),
    )

    op.create_table(
        "geofences",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("geometry", Geography(geometry_type="POLYGON", srid=4326), nullable=False),
        sa.Column("style", JSONB, nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.create_index(
        "ix_geofences_geometry", "geofences", ["geometry"], postgresql_using="gist"
    )

    op.create_table(
        "alert_rules",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("target", JSONB, nullable=False),
        sa.Column("params", JSONB, nullable=False, server_default="{}"),
        sa.Column("cooldown_seconds", sa.Integer, nullable=False, server_default="900"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
    )

    op.create_table(
        "alert_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("rule_id", UUID, sa.ForeignKey("alert_rules.id"), nullable=False),
        sa.Column("mmsi", sa.String(9), sa.ForeignKey("vessels.mmsi"), nullable=False),
        sa.Column("transition_key", sa.String(128), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("context", JSONB, nullable=False, server_default="{}"),
        sa.UniqueConstraint("transition_key", name="uq_alert_event_transition"),
    )

    op.create_table(
        "notification_deliveries",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("event_id", UUID, sa.ForeignKey("alert_events.id"), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("attempt", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text, nullable=True),
    )

    op.create_table(
        "source_status",
        sa.Column("source", sa.String(30), primary_key=True),
        sa.Column("instance", sa.String(60), primary_key=True),
        sa.Column("state", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("message_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("error_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("reconnect_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error_summary", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("source_status")
    op.drop_table("notification_deliveries")
    op.drop_table("alert_events")
    op.drop_table("alert_rules")
    op.drop_table("geofences")
    op.drop_table("watchlist_vessels")
    op.drop_table("watchlists")
    op.drop_table("raw_messages")
    op.drop_table("position_observations")
    op.drop_table("vessel_latest")
    op.drop_table("vessels")
    op.drop_table("users")
