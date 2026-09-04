"""Add alert_rules.add_to_watchlist_id

Lets an alert rule do more than just fire an event -- when it also names
a watchlist, a newly-fired (non-duplicate) event auto-adds that vessel to
it. ON DELETE SET NULL rather than blocking watchlist deletion (like
geofences do for rules that reference them): losing the auto-add target
just turns the rule back into a plain alert, which is a reasonable
fallback rather than something worth blocking a delete over.

Revision ID: 0007_alert_rule_watchlist_action
Revises: 0006_voyage_fields
Create Date: 2026-09-06

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0007_alert_rule_watchlist_action"
down_revision: str | None = "0006_voyage_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "alert_rules",
        sa.Column(
            "add_to_watchlist_id",
            UUID,
            sa.ForeignKey("watchlists.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("alert_rules", "add_to_watchlist_id")
