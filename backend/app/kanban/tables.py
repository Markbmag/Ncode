"""Kanban tables (migrations 0010, 0012, 0013). In the app's one MetaData so the migration test compares them."""

from __future__ import annotations

from sqlalchemy import Boolean, Column, Float, ForeignKey, Index, Integer, String, Table, Text

from ..appdb import metadata

boards_table = Table(
    "kanban_boards",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("color", String(16)),                     # accent of the board ("indigo", "teal" ...)
    Column("owner_id", Integer, nullable=False),
    Column("archived", Boolean, nullable=False, default=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
)

board_members_table = Table(  # everyone signed in sees every board; members (people or groups) edit
    "kanban_board_members",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("board_id", Integer, ForeignKey("kanban_boards.id"), nullable=False, index=True),
    Column("user_id", Integer),
    Column("group_id", Integer),
    Column("role", String(8), nullable=False),       # "editor" | "owner"
)

columns_table = Table(
    "kanban_columns",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("board_id", Integer, ForeignKey("kanban_boards.id"), nullable=False, index=True),
    Column("name", String(80), nullable=False),
    Column("color", String(16)),
    Column("position", Float, nullable=False),
    Column("is_done", Boolean, nullable=False, default=False),   # cards here count as done
)

labels_table = Table(
    "kanban_labels",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("board_id", Integer, ForeignKey("kanban_boards.id"), nullable=False, index=True),
    Column("name", String(60), nullable=False),
    Column("color", String(16), nullable=False),
)

cards_table = Table(
    "kanban_cards",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("board_id", Integer, ForeignKey("kanban_boards.id"), nullable=False),
    Column("column_id", Integer, ForeignKey("kanban_columns.id"), nullable=False),
    Column("title", String(300), nullable=False),
    Column("description", Text),
    Column("priority", String(8), nullable=False, default="normal"),  # low | normal | high | urgent
    Column("start_date", String(10)),                # ISO dates "2026-11-03"
    Column("due_date", String(10)),
    Column("position", Float, nullable=False),
    Column("archived", Boolean, nullable=False, default=False),
    Column("completed_at", Float),
    Column("repeat", String(16)),                    # K3: daily | weekdays | weekly | monthly (migration 0012)
    Column("created_by", Integer),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
    Index("ix_kanban_cards_board_column", "board_id", "column_id", "position"),
)

card_assignees_table = Table(
    "kanban_card_assignees",
    metadata,
    Column("card_id", Integer, primary_key=True),
    Column("user_id", Integer, primary_key=True, index=True),
)

card_labels_table = Table(
    "kanban_card_labels",
    metadata,
    Column("card_id", Integer, primary_key=True),
    Column("label_id", Integer, primary_key=True),
)

checklist_table = Table(  # the card's action plan
    "kanban_checklist_items",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("card_id", Integer, ForeignKey("kanban_cards.id"), nullable=False, index=True),
    Column("text", String(500), nullable=False),
    Column("done", Boolean, nullable=False, default=False),
    Column("done_by", String(64)),
    Column("done_at", Float),
    Column("position", Float, nullable=False),
    Column("created_at", Float, nullable=False),
)

comments_table = Table(
    "kanban_comments",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("card_id", Integer, ForeignKey("kanban_cards.id"), nullable=False, index=True),
    Column("user_id", Integer, nullable=False),
    Column("body", Text, nullable=False),
    Column("created_at", Float, nullable=False),
    Column("edited_at", Float),
)

attachments_table = Table(  # files in data/kanban/<board>/ (photos from the phone, documents)
    "kanban_attachments",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("card_id", Integer, ForeignKey("kanban_cards.id"), nullable=False, index=True),
    Column("filename", String(255), nullable=False),
    Column("content_type", String(100), nullable=False),
    Column("size", Integer, nullable=False),
    Column("file", String(80), nullable=False),      # stored name (random), never the uploaded one
    Column("thumb", String(80)),                     # small preview for images (made in the browser)
    Column("uploaded_by", Integer),
    Column("created_at", Float, nullable=False),
)

activity_table = Table(  # history: who did what, when
    "kanban_activity",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("board_id", Integer, nullable=False),
    Column("card_id", Integer),
    Column("user_id", Integer),
    Column("action", String(40), nullable=False),    # "card_created", "card_moved", "item_done" ...
    Column("details", Text),                         # JSON
    Column("created_at", Float, nullable=False),
    Index("ix_kanban_activity_board_time", "board_id", "created_at"),
    Index("ix_kanban_activity_card_time", "card_id", "created_at"),
)

card_links_table = Table(  # K3: a task points at a Search & BI dashboard or question (migration 0012)
    "kanban_card_links",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("card_id", Integer, ForeignKey("kanban_cards.id"), nullable=False, index=True),
    Column("kind", String(16), nullable=False),      # "dashboard" | "question"
    Column("target_id", Integer, nullable=False),
    Column("added_by", Integer),
    Column("created_at", Float, nullable=False),
)

card_names_table = Table(  # people on a task who are not Ncode users, by name (migration 0013)
    "kanban_card_names",
    metadata,
    Column("card_id", Integer, ForeignKey("kanban_cards.id"), primary_key=True),
    Column("name", String(80), primary_key=True),
    Column("position", Integer, nullable=False, server_default="0"),
)
