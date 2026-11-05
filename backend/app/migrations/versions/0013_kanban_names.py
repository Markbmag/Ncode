"""Kanban: people on a task who are not Ncode users, by name ("Ivan from maintenance").

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "kanban_card_names" not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "kanban_card_names",
            sa.Column("card_id", sa.Integer, sa.ForeignKey("kanban_cards.id"), primary_key=True),
            sa.Column("name", sa.String(80), primary_key=True),
            sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_table("kanban_card_names")
