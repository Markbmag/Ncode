"""Kanban K3: repeating tasks and links from tasks to Search & BI dashboards and questions.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if "repeat" not in {c["name"] for c in insp.get_columns("kanban_cards")}:
        op.add_column("kanban_cards", sa.Column("repeat", sa.String(16)))  # daily | weekdays | weekly | monthly
    if "kanban_card_links" not in set(insp.get_table_names()):
        op.create_table(
            "kanban_card_links",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("card_id", sa.Integer, sa.ForeignKey("kanban_cards.id"), nullable=False, index=True),
            sa.Column("kind", sa.String(16), nullable=False),        # "dashboard" | "question"
            sa.Column("target_id", sa.Integer, nullable=False),
            sa.Column("added_by", sa.Integer),
            sa.Column("created_at", sa.Float, nullable=False),
        )


def downgrade() -> None:
    op.drop_table("kanban_card_links")
    with op.batch_alter_table("kanban_cards") as batch:
        batch.drop_column("repeat")
