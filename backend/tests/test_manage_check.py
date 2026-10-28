"""`python -m app.manage check` (M10, upgrade safety)."""

import sqlite3

import pytest
from alembic import command
from sqlalchemy import create_engine

from app import check as check_module
from app.appdb import AppDB
from app.backup import make_backup
from app.check import FAIL, WARN, Checker, main
from app.config import ConnectionConfig
from app.crypto import Cipher, generate_key
from app.migrate import _config, head_revision


@pytest.fixture()
def install(tmp_path):
    """A working installation: app DB at head, a key file, a UI connection with a password, a backup."""
    data = tmp_path / "data"
    data.mkdir()
    key = generate_key()
    (data / "secret.key").write_text(key, encoding="ascii")
    shop = tmp_path / "shop.db"
    con = sqlite3.connect(shop)
    con.execute("CREATE TABLE t (id INTEGER)")
    con.close()
    db = AppDB(data / "ncode.sqlite", cipher=Cipher(key))
    db.save_connection(ConnectionConfig(key="ui", label="From the UI", engine="sqlite", database=str(shop), password="pw"), "admin")
    db.dispose()
    make_backup(data / "ncode.sqlite")
    env = {"NCODE_APP_DB": str(data / "ncode.sqlite"), "NCODE_CONN_SHOP_ENGINE": "sqlite", "NCODE_CONN_SHOP_DATABASE": str(shop)}
    return {"env": env, "data": data, "key": key, "shop": shop}


def lines(env, **kwargs):
    return [(line.status, line.text) for line in Checker(env, **kwargs).run()]


def find(result, words):
    hits = [line for line in result if words in line[1]]
    assert hits, f"no line with {words!r} in {result}"
    return hits[0]


def test_a_working_installation_passes(install):
    out = []
    assert main(install["env"], out=out.append) == 0
    text = "\n".join(out)
    assert "✓ Python" in text and "✓ Packages: fastapi" in text and "sqlglot" in text
    assert f"up to date (revision {head_revision()})" in text
    assert "reads all 1 saved secret(s)" in text
    assert "✓ Database From the UI (ui) answers: 1 table(s)" in text and "(shop) answers" in text
    assert "is writable" in text and "Last backup ncode-backup-" in text and "free on the disk" in text
    assert "✗" not in text and out[-1] == "All set: the server can be started."


def test_wrong_secret_key_and_unknown_settings(install):
    env = {**install["env"], "NCODE_SECRET_KEY": generate_key(), "NCODE_BACKUP_HOURS": "3", "NCODE_CONN_SHOP_PASWORD": "x"}
    result = lines(env)
    status, text = find(result, "cannot read 1 of 1 saved secret(s)")
    assert status == FAIL and "database ui" in text
    status, text = find(result, "Unknown settings")
    assert status == WARN and "NCODE_BACKUP_HOURS" in text and "NCODE_CONN_SHOP_PASWORD" in text
    assert "NCODE_CONN_SHOP_ENGINE" not in text
    out = []
    assert main(env, out=out.append) == 1 and "Some checks failed" in out[-1]


def test_missing_key_with_saved_secrets_fails(install):
    (install["data"] / "secret.key").unlink()
    status, text = find(lines(install["env"]), "No secret key")
    assert status == FAIL and "1 saved secret(s)" in text


def test_unreachable_and_slow_databases(install, monkeypatch):
    env = {**install["env"], "NCODE_CONN_PG_ENGINE": "postgresql", "NCODE_CONN_PG_HOST": "127.0.0.1",
           "NCODE_CONN_PG_PORT": "1", "NCODE_CONN_PG_DATABASE": "x"}
    status, text = find(lines(env), "(pg)")
    assert status == FAIL and "cannot be reached" in text

    import threading

    release = threading.Event()

    def slow_probe(cfg, settings):
        release.wait(5)
        return 0

    monkeypatch.setattr("app.db.probe", slow_probe)
    try:
        status, text = find(lines(install["env"], connect_budget_sec=0.2), "(shop)")
    finally:
        release.set()
    assert status == FAIL and "did not answer within" in text


def test_bad_settings_fail_without_going_further(install):
    result = lines({**install["env"], "NCODE_PORT": "eighty"})
    assert result[-1][0] == FAIL and "NCODE_PORT must be an integer" in result[-1][1]
    status, text = find(lines({**install["env"], "NCODE_CONN_X_ENGINE": "oracle", "NCODE_CONN_X_DATABASE": "d"}), "connections in .env")
    assert status == FAIL and "oracle" in text


def test_app_database_older_newer_and_missing(install, tmp_path):
    path = install["data"] / "ncode.sqlite"
    engine = create_engine(f"sqlite:///{path}")
    cfg = _config()
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.downgrade(cfg, "0007")
    status, text = find(lines(install["env"]), "App database is at revision 0007")
    assert status == WARN and "upgraded when the server starts" in text
    with engine.begin() as conn:
        conn.exec_driver_sql("UPDATE alembic_version SET version_num = '9999'")
    engine.dispose()
    status, text = find(lines(install["env"]), "revision 9999")
    assert status == FAIL and "newer version" in text

    env = {"NCODE_APP_DB": str(tmp_path / "fresh" / "ncode.sqlite")}
    result = lines(env)
    assert find(result, "does not exist yet")[0] == WARN
    assert find(result, "No secret key yet")[0] == WARN
    assert not (tmp_path / "fresh" / "ncode.sqlite").exists() and not (tmp_path / "fresh" / "secret.key").exists()
    assert find(result, "No backup yet")[0] == WARN
    assert all(s != FAIL for s, _ in result)


def test_old_backup_and_low_disk(install, monkeypatch):
    import os
    import time

    for f in (install["data"] / "backups").iterdir():
        old = time.time() - 5 * 86400
        os.utime(f, (old, old))
    status, text = find(lines(install["env"]), "Last backup")
    assert status == WARN and "5 days old" in text

    class Usage:
        free = 100 * 1024 * 1024

    monkeypatch.setattr(check_module.shutil, "disk_usage", lambda _p: Usage)
    assert find(lines(install["env"]), "free on the disk")[0] == FAIL


def test_manage_command_exit_code(install, monkeypatch, capsys):
    from app import manage

    for name, value in install["env"].items():
        monkeypatch.setenv(name, value)
    with pytest.raises(SystemExit) as stopped:
        manage.main(["check"])
    assert stopped.value.code == 0 and "All set" in capsys.readouterr().out
    monkeypatch.setenv("NCODE_SECRET_KEY", "not-a-key")
    with pytest.raises(SystemExit) as stopped:
        manage.main(["check"])
    assert stopped.value.code == 1 and "secret key" in capsys.readouterr().out.lower()
