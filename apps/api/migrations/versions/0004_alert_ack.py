"""Add acknowledged_at to alert_events, name to alert_rules

Backs the Alerts feature: acknowledged_at (NULL = unacknowledged) drives
the inbox's acknowledge action; alert_rules never actually had a name
column in the original SS10 schema, which doesn't work once rules are
something a user creates and needs to tell apart in a list.
alert_rules.name backfills existing rows (none exist yet in practice)
with a placeholder before being made non-nullable.

Revision ID: 0004_alert_ack
Revises: 0003_retention_settings
Create Date: 2026-09-03

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_alert_ack"
down_revision: str | None = "0003_retention_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "alert_events", sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "alert_rules", sa.Column("name", sa.String(120), nullable=True)
    )
    op.execute("UPDATE alert_rules SET name = 'Unnamed rule' WHERE name IS NULL")
    op.alter_column("alert_rules", "name", nullable=False)


def downgrade() -> None:
    op.drop_column("alert_rules", "name")
    op.drop_column("alert_events", "acknowledged_at")
