"""Indexes for the queries the app runs most (roadmap M10).

The audit log is filtered by person and action over a time range (Admin → Audit, Usage),
the library lists questions/dashboards/files by archived state, newest first, permissions
are looked up per person and group, and favourites are removed per item.

Idempotent: an index that already exists (made by hand, or by an earlier attempt) is kept.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_audit_log_username_ts", "audit_log", ["username", "ts"]),
    ("ix_audit_log_action_ts", "audit_log", ["action", "ts"]),
    ("ix_permissions_user_id", "permissions", ["user_id"]),
    ("ix_permissions_group_id", "permissions", ["group_id"]),
    ("ix_questions_archived_updated_at", "questions", ["archived", "updated_at"]),
    ("ix_dashboards_archived_updated_at", "dashboards", ["archived", "updated_at"]),
    ("ix_datasets_archived_updated_at", "datasets", ["archived", "updated_at"]),
    ("ix_favorites_item", "favorites", ["item_type", "item_id"]),
]


def _existing(table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    for name, table, columns in INDEXES:
        if name not in _existing(table):
            op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(INDEXES):
        if name in _existing(table):
            op.drop_index(name, table_name=table)
