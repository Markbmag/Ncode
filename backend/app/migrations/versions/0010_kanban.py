"""Ncode - Kanban (roadmap §8c, K1): boards, members, columns, labels, cards, assignees, card labels,
action plan items, comments, attachments, history.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

TABLES = ["kanban_boards", "kanban_board_members", "kanban_columns", "kanban_labels", "kanban_cards",
          "kanban_card_assignees", "kanban_card_labels", "kanban_checklist_items", "kanban_comments",
          "kanban_attachments", "kanban_activity"]


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "kanban_boards" not in existing:
        op.create_table(
            "kanban_boards",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("description", sa.Text),
            sa.Column("color", sa.String(16)),
            sa.Column("owner_id", sa.Integer, nullable=False),
            sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Column("updated_at", sa.Float, nullable=False),
            sa.Column("updated_by", sa.String(64)),
        )
    if "kanban_board_members" not in existing:
        op.create_table(
            "kanban_board_members",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("board_id", sa.Integer, sa.ForeignKey("kanban_boards.id"), nullable=False, index=True),
            sa.Column("user_id", sa.Integer),
            sa.Column("group_id", sa.Integer),
            sa.Column("role", sa.String(8), nullable=False),
        )
    if "kanban_columns" not in existing:
        op.create_table(
            "kanban_columns",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("board_id", sa.Integer, sa.ForeignKey("kanban_boards.id"), nullable=False, index=True),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("color", sa.String(16)),
            sa.Column("position", sa.Float, nullable=False),
            sa.Column("is_done", sa.Boolean, nullable=False, server_default=sa.false()),
        )
    if "kanban_labels" not in existing:
        op.create_table(
            "kanban_labels",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("board_id", sa.Integer, sa.ForeignKey("kanban_boards.id"), nullable=False, index=True),
            sa.Column("name", sa.String(60), nullable=False),
            sa.Column("color", sa.String(16), nullable=False),
        )
    if "kanban_cards" not in existing:
        op.create_table(
            "kanban_cards",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("board_id", sa.Integer, sa.ForeignKey("kanban_boards.id"), nullable=False),
            sa.Column("column_id", sa.Integer, sa.ForeignKey("kanban_columns.id"), nullable=False),
            sa.Column("title", sa.String(300), nullable=False),
            sa.Column("description", sa.Text),
            sa.Column("priority", sa.String(8), nullable=False, server_default="normal"),
            sa.Column("start_date", sa.String(10)),
            sa.Column("due_date", sa.String(10)),
            sa.Column("position", sa.Float, nullable=False),
            sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("completed_at", sa.Float),
            sa.Column("created_by", sa.Integer),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Column("updated_at", sa.Float, nullable=False),
            sa.Column("updated_by", sa.String(64)),
            sa.Index("ix_kanban_cards_board_column", "board_id", "column_id", "position"),
        )
    if "kanban_card_assignees" not in existing:
        op.create_table(
            "kanban_card_assignees",
            sa.Column("card_id", sa.Integer, primary_key=True),
            sa.Column("user_id", sa.Integer, primary_key=True, index=True),
        )
    if "kanban_card_labels" not in existing:
        op.create_table(
            "kanban_card_labels",
            sa.Column("card_id", sa.Integer, primary_key=True),
            sa.Column("label_id", sa.Integer, primary_key=True),
        )
    if "kanban_checklist_items" not in existing:
        op.create_table(
            "kanban_checklist_items",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("card_id", sa.Integer, sa.ForeignKey("kanban_cards.id"), nullable=False, index=True),
            sa.Column("text", sa.String(500), nullable=False),
            sa.Column("done", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("done_by", sa.String(64)),
            sa.Column("done_at", sa.Float),
            sa.Column("position", sa.Float, nullable=False),
            sa.Column("created_at", sa.Float, nullable=False),
        )
    if "kanban_comments" not in existing:
        op.create_table(
            "kanban_comments",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("card_id", sa.Integer, sa.ForeignKey("kanban_cards.id"), nullable=False, index=True),
            sa.Column("user_id", sa.Integer, nullable=False),
            sa.Column("body", sa.Text, nullable=False),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Column("edited_at", sa.Float),
        )
    if "kanban_attachments" not in existing:
        op.create_table(
            "kanban_attachments",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("card_id", sa.Integer, sa.ForeignKey("kanban_cards.id"), nullable=False, index=True),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False),
            sa.Column("size", sa.Integer, nullable=False),
            sa.Column("file", sa.String(80), nullable=False),
            sa.Column("thumb", sa.String(80)),
            sa.Column("uploaded_by", sa.Integer),
            sa.Column("created_at", sa.Float, nullable=False),
        )
    if "kanban_activity" not in existing:
        op.create_table(
            "kanban_activity",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("board_id", sa.Integer, nullable=False),
            sa.Column("card_id", sa.Integer),
            sa.Column("user_id", sa.Integer),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("details", sa.Text),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Index("ix_kanban_activity_board_time", "board_id", "created_at"),
            sa.Index("ix_kanban_activity_card_time", "card_id", "created_at"),
        )


def downgrade() -> None:
    for name in reversed(TABLES):
        op.drop_table(name)
