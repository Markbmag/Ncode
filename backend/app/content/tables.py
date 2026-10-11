"""Table definitions for the library. They mirror migration 0002 (app/migrations/versions)."""

from __future__ import annotations

from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Table, Text

from ..appdb import metadata  # one MetaData for the whole app DB (the migration test compares it)

collections_table = Table(
    "collections",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(120), nullable=False),
    Column("description", Text),
    Column("parent_id", Integer, ForeignKey("collections.id"), index=True),
    Column("owner_id", Integer),
    Column("personal_owner_id", Integer, unique=True),
    Column("archived", Boolean, nullable=False, default=False),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

questions_table = Table(
    "questions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("name", String(200), nullable=False),
    Column("description", Text),
    Column("collection_id", Integer, ForeignKey("collections.id"), nullable=False, index=True),
    Column("connection", String(64), nullable=False),
    Column("kind", String(16), nullable=False),
    Column("spec", Text, nullable=False),
    Column("viz", Text),
    Column("parameters", Text, nullable=False, default="[]"),
    Column("owner_id", Integer),
    Column("archived", Boolean, nullable=False, default=False),
    Column("import_key", String(120), unique=True),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
    Column("updated_by", String(64)),
)

permissions_table = Table(
    "permissions",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("collection_id", Integer, ForeignKey("collections.id"), nullable=False, index=True),
    Column("user_id", Integer),
    Column("role", String(16)),
    Column("level", String(8), nullable=False),
)

favorites_table = Table(
    "favorites",
    metadata,
    Column("user_id", Integer, primary_key=True),
    Column("item_type", String(16), primary_key=True),
    Column("item_id", Integer, primary_key=True),
    Column("created_at", Float, nullable=False),
)
