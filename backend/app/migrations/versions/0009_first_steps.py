"""First steps and plain language (roadmap M11).

- table_metadata: display names and descriptions of tables (columns already have them).
- translations (JSON, e.g. {"ru": {"display_name": "...", "description": "..."}}) for table and
  column metadata and for metrics: names people read in either UI language.
- item_views: what each person opened last (home page "recently viewed").
- users.prefs (JSON): per-person settings such as the new-user checklist.
- glossary_terms: business terms (OEE, scrap rate) in English and Russian, linked to metrics/columns.
- verified_by / verified_at on questions and dashboards: "the official answer" badge.

Idempotent like 0007: columns that already exist are kept.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

COLUMNS = [
    ("field_metadata", sa.Column("translations", sa.Text)),
    ("metrics", sa.Column("translations", sa.Text)),
    ("users", sa.Column("prefs", sa.Text)),
    ("questions", sa.Column("verified_by", sa.String(64))),
    ("questions", sa.Column("verified_at", sa.Float)),
    ("dashboards", sa.Column("verified_by", sa.String(64))),
    ("dashboards", sa.Column("verified_at", sa.Float)),
]


def _inspector():
    return sa.inspect(op.get_bind())


def _has(table: str, column: str) -> bool:
    return column in {c["name"] for c in _inspector().get_columns(table)}


def upgrade() -> None:
    tables = set(_inspector().get_table_names())
    if "table_metadata" not in tables:
        op.create_table(
            "table_metadata",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("connection", sa.String(64), nullable=False),
            sa.Column("table_name", sa.String(255), nullable=False),
            sa.Column("display_name", sa.String(200)),
            sa.Column("description", sa.Text),
            sa.Column("translations", sa.Text),
            sa.Column("updated_at", sa.Float, nullable=False),
            sa.Column("updated_by", sa.String(64)),
            sa.UniqueConstraint("connection", "table_name", name="uq_table_metadata_table"),
        )
    if "item_views" not in tables:
        op.create_table(
            "item_views",
            sa.Column("user_id", sa.Integer, primary_key=True),
            sa.Column("item_type", sa.String(16), primary_key=True),   # "question" | "dashboard"
            sa.Column("item_id", sa.Integer, primary_key=True),
            sa.Column("viewed_at", sa.Float, nullable=False),
            sa.Index("ix_item_views_user_viewed", "user_id", "viewed_at"),
        )
    if "glossary_terms" not in tables:
        op.create_table(
            "glossary_terms",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("term", sa.String(120), nullable=False),
            sa.Column("definition", sa.Text, nullable=False),
            sa.Column("translations", sa.Text),   # {"ru": {"term": "...", "definition": "..."}}
            sa.Column("synonyms", sa.Text),       # JSON list, both languages (search, M14)
            sa.Column("related", sa.Text),        # JSON list of links: metrics, columns, questions
            sa.Column("archived", sa.Boolean, nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.Float, nullable=False),
            sa.Column("updated_at", sa.Float, nullable=False),
            sa.Column("updated_by", sa.String(64)),
        )
    for table, column in COLUMNS:
        if not _has(table, column.name):
            with op.batch_alter_table(table) as batch:
                batch.add_column(column.copy())


def downgrade() -> None:
    for table, column in reversed(COLUMNS):
        if _has(table, column.name):
            with op.batch_alter_table(table) as batch:
                batch.drop_column(column.name)
    op.drop_table("glossary_terms")
    op.drop_table("item_views")
    op.drop_table("table_metadata")
