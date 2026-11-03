"""Question and dashboard history (roadmap M15): every save keeps the previous version, so it can
be looked at and restored.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "content_versions" not in set(sa.inspect(op.get_bind()).get_table_names()):
        op.create_table(
            "content_versions",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("item_type", sa.String(16), nullable=False),     # "question" | "dashboard"
            sa.Column("item_id", sa.Integer, nullable=False),
            sa.Column("version", sa.Integer, nullable=False),          # 1, 2, 3 ... per item
            sa.Column("data", sa.Text, nullable=False),                # JSON: the item as it was saved
            sa.Column("summary", sa.String(300)),                      # "changed the filters" ...
            sa.Column("saved_by", sa.String(64)),
            sa.Column("saved_at", sa.Float, nullable=False),
            sa.Index("ix_content_versions_item", "item_type", "item_id", "version"),
        )


def downgrade() -> None:
    op.drop_table("content_versions")
