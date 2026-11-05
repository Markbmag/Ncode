"""Kanban K4: private boards and how long finished tasks stay on a board.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-05
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    have = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("kanban_boards")}
    with op.batch_alter_table("kanban_boards") as batch:
        if "private" not in have:  # only members (and admins) see a private board
            batch.add_column(sa.Column("private", sa.Boolean, nullable=False, server_default=sa.false()))
        if "done_keep_days" not in have:  # finished tasks leave the board after this many days; 0 = never; null = 14
            batch.add_column(sa.Column("done_keep_days", sa.Integer))


def downgrade() -> None:
    with op.batch_alter_table("kanban_boards") as batch:
        batch.drop_column("done_keep_days")
        batch.drop_column("private")
