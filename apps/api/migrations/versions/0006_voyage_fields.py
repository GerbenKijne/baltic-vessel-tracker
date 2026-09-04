"""Add eta_text and draught_m to vessel_latest

`vessels.imo/callsign/ship_type/dimensions` already existed unused since
0001_initial_schema -- ship type, IMO, callsign, and dimensions were
already storable, just never written by the ingest worker. Destination
was already storable on `vessel_latest` too. Only ETA and draught need
new columns; both are voyage-specific (change per trip, like
destination) rather than static vessel identity, hence `vessel_latest`
not `vessels`. See docs/adr/0005-vessel-identity-sheet.md.

Revision ID: 0006_voyage_fields
Revises: 0005_data_sources
Create Date: 2026-09-05

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_voyage_fields"
down_revision: str | None = "0005_data_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("vessel_latest", sa.Column("eta_text", sa.String(20), nullable=True))
    op.add_column("vessel_latest", sa.Column("draught_m", sa.Numeric, nullable=True))


def downgrade() -> None:
    op.drop_column("vessel_latest", "draught_m")
    op.drop_column("vessel_latest", "eta_text")
