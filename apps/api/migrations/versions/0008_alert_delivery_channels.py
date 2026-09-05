"""Add alert delivery channels (email/webhook) and smtp_settings

Alerts previously only ever landed in the in-app event log --
notification_deliveries (0001_initial_schema) already had the
attempt/status/next_attempt_at/error shape a retry log needs, but nothing
ever wrote to it. This adds the per-rule config (email_to, webhook_url,
webhook_secret on alert_rules) and the singleton smtp_settings table
(same pattern as retention_settings) that the worker's new notification
loop reads to actually deliver.

Revision ID: 0008_alert_delivery_channels
Revises: 0007_alert_rule_watchlist_action
Create Date: 2026-09-05

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_alert_delivery_channels"
down_revision: str | None = "0007_alert_rule_watchlist_action"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("alert_rules", sa.Column("email_to", sa.String(255), nullable=True))
    op.add_column("alert_rules", sa.Column("webhook_url", sa.String(500), nullable=True))
    op.add_column("alert_rules", sa.Column("webhook_secret", sa.Text, nullable=True))

    op.create_table(
        "smtp_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("host", sa.String(255), nullable=True),
        sa.Column("port", sa.Integer, nullable=False),
        sa.Column("username", sa.String(255), nullable=True),
        sa.Column("password", sa.Text, nullable=True),
        sa.Column("from_address", sa.String(255), nullable=True),
        sa.Column("use_tls", sa.Boolean, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_smtp_settings_singleton"),
    )
    op.execute(
        """
        INSERT INTO smtp_settings (id, port, use_tls, updated_at)
        VALUES (1, 587, true, now())
        """
    )


def downgrade() -> None:
    op.drop_table("smtp_settings")
    op.drop_column("alert_rules", "webhook_secret")
    op.drop_column("alert_rules", "webhook_url")
    op.drop_column("alert_rules", "email_to")
