"""Ncode's own database runs in WAL mode (M10); backups and restores stay complete."""

from __future__ import annotations

import sqlite3
import subprocess
import sys

from app.appdb import AppDB
from app.backup import make_backup, restore
from app.security import hash_password


def _users(path):
    con = sqlite3.connect(path)
    try:
        return sorted(r[0] for r in con.execute("SELECT username FROM users"))
    finally:
        con.close()


def test_wal_mode_and_a_restore_over_a_live_log(tmp_path):
    db_path = tmp_path / "data" / "ncode.sqlite"
    db = AppDB(db_path)
    db.create_user("admin", hash_password("admin-pass-1"), "admin")
    with db.engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
    backup = make_backup(db_path)
    db.engine.dispose()
    # a server that stopped abruptly: its last change is only in the write-ahead log
    subprocess.run([sys.executable, "-c", (
        "import os, sqlite3, sys; c = sqlite3.connect(sys.argv[1]); c.execute('PRAGMA wal_autocheckpoint=0'); "
        "c.execute(\"INSERT INTO users (username, password_hash, role, is_active, allowed_connections, created_at) "
        "VALUES ('later', 'x', 'user', 1, '*', 0)\"); c.commit(); os._exit(0)"
    ), str(db_path)], check=True)
    wal = db_path.with_name(db_path.name + "-wal")
    assert wal.exists() and wal.stat().st_size > 0

    restore(backup, db_path)

    assert _users(db_path) == ["admin"]  # the backup, with no old log replayed onto it
    assert not wal.exists() or wal.stat().st_size == 0
    kept = next(p for p in db_path.parent.iterdir() if ".before-restore-" in p.name)
    assert _users(kept) == ["admin", "later"]  # the replaced database is kept complete
