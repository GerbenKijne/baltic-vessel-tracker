"""Add sog_kn to position_observations

The track-history endpoint (get_vessel_track) has referenced
PositionObservation.sog_kn since it was built, but this table never
actually had that column -- only vessel_latest does. Every track request
has been raising an AttributeError before the query even ran, which the
frontend silently displayed as "no observations" instead of an error.
Existing rows get NULL (their per-point speed was genuinely never
recorded), and the ingest worker starts writing it going forward.

Revision ID: 0002_add_sog_kn
Revises: 0001_initial_schema
Create Date: 2026-09-03

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# Keep this <=32 chars: alembic_version.version_num is varchar(32) and
# a too-long id fails the migration transaction (found live -- the
# original id here was one character over).
revision: str = "0002_add_sog_kn"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("position_observations", sa.Column("sog_kn", sa.Numeric, nullable=True))


def downgrade() -> None:
    op.drop_column("position_observations", "sog_kn")
