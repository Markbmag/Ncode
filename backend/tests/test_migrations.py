"""Ncode's own database is created and upgraded by Alembic migrations."""

import sqlite3

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.content.tables import collections_table  # also registers the library tables in `metadata`
from app.appdb import AppDB, metadata, users_table
from app.migrate import current_revision, head_revision, upgrade
from app.security import hash_password


def tables(path):
    con = sqlite3.connect(path)
    try:
        return {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        con.close()


def test_fresh_database_is_created_at_head(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    assert current_revision(db.engine) == head_revision()
    assert {"users", "sessions", "connections", "audit_log", "alembic_version"} <= tables(db.path)
    assert {collections_table.name, "questions", "permissions", "favorites"} <= tables(db.path)
    db.dispose()


def test_migrated_schema_matches_the_models(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    with db.engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), metadata)
    # Server-side defaults are not used; only Python-side ones, which are not schema.
    assert diff == []
    db.dispose()


def test_existing_v5_database_keeps_its_data(tmp_path):
    path = tmp_path / "app.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    v5 = [metadata.tables[t] for t in ("users", "sessions", "connections", "audit_log")]
    metadata.create_all(engine, tables=v5)  # how v5 created its tables, without migrations
    with engine.begin() as conn:
        conn.execute(
            users_table.insert().values(
                username="old", password_hash=hash_password("old-password-1"), role="admin",
                is_active=True, allowed_connections="*", created_at=1.0,
            )
        )
    engine.dispose()

    db = AppDB(path)
    assert current_revision(db.engine) == head_revision()
    assert db.get_user_by_name("old").is_admin
    db.dispose()


def test_older_database_without_connections_table_gets_it(tmp_path):
    path = tmp_path / "app.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    metadata.create_all(engine, tables=[metadata.tables["users"], metadata.tables["sessions"]])
    engine.dispose()

    db = AppDB(path)
    assert {"connections", "audit_log"} <= set(inspect(db.engine).get_table_names())
    db.dispose()


def test_upgrade_twice_is_harmless(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    db.create_user("bob", hash_password("bob-password-1"))
    upgrade(db.engine)
    db.dispose()
    again = AppDB(tmp_path / "app.sqlite")
    assert again.get_user_by_name("bob") is not None
    again.dispose()


def test_0008_indexes_are_made_and_an_existing_one_is_kept(tmp_path):
    from alembic import command

    from app.migrate import _config

    path = tmp_path / "app.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    cfg = _config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "0007")
        conn.exec_driver_sql("CREATE INDEX ix_permissions_user_id ON permissions (user_id)")  # made by hand earlier
    upgrade(engine)  # must not fail on the index that is there already
    assert current_revision(engine) == head_revision()
    names = {i["name"] for t in ("audit_log", "permissions", "questions", "favorites") for i in inspect(engine).get_indexes(t)}
    assert {"ix_audit_log_username_ts", "ix_audit_log_action_ts", "ix_permissions_user_id", "ix_permissions_group_id",
            "ix_questions_archived_updated_at", "ix_favorites_item"} <= names
    with engine.connect() as conn:  # Admin → Audit filtered by person uses the index
        plan = " ".join(str(r[-1]) for r in conn.exec_driver_sql(
            "EXPLAIN QUERY PLAN SELECT * FROM audit_log WHERE username = 'a' AND ts >= 0"))
    assert "ix_audit_log_username_ts" in plan
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.downgrade(cfg, "0007")
    assert "ix_audit_log_username_ts" not in {i["name"] for i in inspect(engine).get_indexes("audit_log")}
    engine.dispose()
