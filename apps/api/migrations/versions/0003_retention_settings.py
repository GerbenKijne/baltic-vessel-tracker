"""Add retention_settings (singleton) table

Backs the Admin "Retention & storage" controls: the ingest worker's
retention sweep reads this table fresh on every run instead of a static
env-loaded value, so changing a setting here takes effect on the next
sweep without restarting anything. Seeded with the defaults that were
previously hardcoded in worker/config.py (24h / 365d / hourly sweep).

Revision ID: 0003_retention_settings
Revises: 0002_add_sog_kn
Create Date: 2026-09-03

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_retention_settings"
down_revision: str | None = "0002_add_sog_kn"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "retention_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("default_hours", sa.Integer, nullable=False),
        sa.Column("watchlisted_days", sa.Integer, nullable=False),
        sa.Column("sweep_interval_seconds", sa.Integer, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_retention_settings_singleton"),
    )
    op.execute(
        """
        INSERT INTO retention_settings
            (id, default_hours, watchlisted_days, sweep_interval_seconds, updated_at)
        VALUES (1, 24, 365, 3600, now())
        """
    )


def downgrade() -> None:
    op.drop_table("retention_settings")
