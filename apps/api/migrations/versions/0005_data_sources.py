"""Add data_sources table

Replaces the INGEST_ADAPTER/AISSTREAM_API_KEY/AISSTREAM_BOUNDING_BOXES
env vars with an admin-editable table: the ingest worker now reads every
enabled row here at its own startup and runs one adapter per row (see
workers/ingest/worker/sources.py), instead of exactly one adapter fixed
by env vars at container build/start time.

Seeded with a single `simulator` row so a fresh install still shows
moving demo vessels immediately, same as before. This does NOT carry
forward an existing deployment's INGEST_ADAPTER=aisstream / API key --
the migrate container never had those env vars (only worker-ingest did),
and copying a real key out of one container's env into another wasn't
worth the coupling. Anyone already running aisstream needs to re-enter
their API key once via Admin -> Data sources after upgrading.

Revision ID: 0005_data_sources
Revises: 0004_alert_ack
Create Date: 2026-09-04

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0005_data_sources"
down_revision: str | None = "0004_alert_ack"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "data_sources",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("adapter", sa.String(30), nullable=False),
        sa.Column("api_key", sa.Text, nullable=True),
        sa.Column("bounding_boxes", JSONB, nullable=True),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("adapter IN ('simulator', 'aisstream')", name="ck_data_sources_adapter"),
    )
    op.execute(
        """
        INSERT INTO data_sources (id, name, adapter, enabled, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Simulator (demo data)', 'simulator', true, now(), now())
        """
    )


def downgrade() -> None:
    op.drop_table("data_sources")
