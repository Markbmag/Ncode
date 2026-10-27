"""Audit viewer, backups and restore, health and metrics (M9)."""

import sqlite3
import zipfile

import pytest

from app.backup import AutoBackup, BackupError, list_backups, make_backup, prune, restore
from app.appdb import AppDB

from app.query.routes import AUDIT_OPTIONS_MAX, audit_options
from app.usage import AuditRetention

from .test_library_api import call, library_env, save_builder
from .test_query_api import make_client


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def test_audit_viewer_filters_and_exports(env):
    save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}]})
    call(env, "alice", "POST", "/api/query", json={"spec": {"connection": "shop", "source": {"table": "q_customers"}}, "wait_ms": 3000})
    all_ = call(env, "admin", "GET", "/api/admin/audit")
    assert all_["total"] >= 5 and "login" in all_["actions"] and "alice" in all_["users"]
    logins = call(env, "admin", "GET", "/api/admin/audit", params={"action": "login", "user": "alice"})
    assert logins["total"] == 1 and logins["entries"][0]["username"] == "alice"
    found = call(env, "admin", "GET", "/api/admin/audit", params={"q": "q_customers"})
    assert found["total"] >= 1 and all(e["action"] in ("query", "sql") for e in found["entries"])
    assert call(env, "admin", "GET", "/api/admin/audit", params={"q": "%%"})["total"] == 0  # typed text, not wildcards
    page = call(env, "admin", "GET", "/api/admin/audit", params={"limit": 2, "offset": 1})
    assert len(page["entries"]) == 2
    csv = env["client"].get("/api/admin/audit.csv", params={"user": "alice"}, headers=env["admin"]).content.decode("utf-8-sig")
    assert csv.splitlines()[0].startswith("time;user;action") and "alice" in csv
    call(env, "alice", "GET", "/api/admin/audit", 403)


def test_backups_through_the_api(env, tmp_path):
    save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_orders"}}, name="Keep me")
    made = call(env, "admin", "POST", "/api/admin/backups")
    assert made["name"].startswith("ncode-backup-") and made["size"] > 0 and not made["auto"]
    assert [b["name"] for b in call(env, "admin", "GET", "/api/admin/backups")["backups"]] == [made["name"]]
    res = env["client"].get(f"/api/admin/backups/{made['name']}", headers=env["admin"])
    assert res.status_code == 200 and res.headers["content-type"] == "application/zip"
    zpath = tmp_path / "dl.zip"
    zpath.write_bytes(res.content)
    with zipfile.ZipFile(zpath) as zf:
        assert {"ncode.sqlite", "manifest.json"} <= set(zf.namelist())
        assert "secret.key" not in zf.namelist()
    env["client"].get("/api/admin/backups/../ncode.sqlite", headers=env["admin"])  # never a file outside the folder
    call(env, "admin", "GET", "/api/admin/backups/ncode.sqlite", 404)
    call(env, "alice", "POST", "/api/admin/backups", 403)
    call(env, "admin", "DELETE", f"/api/admin/backups/{made['name']}")
    assert call(env, "admin", "GET", "/api/admin/backups")["backups"] == []


def test_restore_replaces_the_data(tmp_path):
    db_path = tmp_path / "data" / "ncode.sqlite"
    db = AppDB(db_path)
    db.create_user("before", "x")
    (db_path.parent / "datasets").mkdir()
    (db_path.parent / "datasets" / "a.parquet").write_bytes(b"PAR1")
    backup = make_backup(db_path)
    db.create_user("after", "x")
    db.dispose()
    manifest = restore(backup, db_path)
    assert manifest["datasets"] == 1
    db2 = AppDB(db_path)
    assert db2.get_user_by_name("before") and db2.get_user_by_name("after") is None
    assert (db_path.parent / "datasets" / "a.parquet").read_bytes() == b"PAR1"
    assert list(db_path.parent.glob("ncode.sqlite.before-restore-*"))
    db2.dispose()
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("ncode.sqlite", b"x")
        zf.writestr("manifest.json", "{}")
        zf.writestr("../evil", "x")
    with pytest.raises(BackupError, match="Unsafe"):
        restore(bad, db_path)
    with pytest.raises(BackupError, match="not an Ncode backup"):
        other = tmp_path / "other.zip"
        with zipfile.ZipFile(other, "w") as zf:
            zf.writestr("x.txt", "x")
        restore(other, db_path)


def test_automatic_backups_once_a_day_and_pruned(tmp_path):
    from datetime import datetime
    db_path = tmp_path / "ncode.sqlite"
    sqlite3.connect(db_path).close()
    auto = AutoBackup(db_path, hour=2, keep=2)
    at_two = datetime(2026, 10, 12, 2, 5).timestamp()
    assert auto.tick(datetime(2026, 10, 12, 3, 0).timestamp()) is None   # not the hour
    assert auto.tick(at_two) is not None
    assert auto.tick(at_two + 60) is None                                # once a day
    for _ in range(3):
        make_backup(db_path, auto=True)
    prune(db_path, 2)
    assert len([b for b in list_backups(db_path) if b["auto"]]) == 2
    assert AutoBackup(db_path, hour=-1, keep=2).tick(at_two) is None    # switched off


def test_health_and_metrics(tmp_path):
    client, _db = make_client(tmp_path, metrics_token="scrape-me")
    with client:
        assert client.get("/api/health").json() == {"status": "ok"}
        ready = client.get("/api/health/ready").json()
        assert ready["status"] == "ok" and ready["checks"]["app_db"] == "ok"
        assert client.get("/metrics").status_code == 401
        assert client.get("/metrics", headers={"Authorization": "Bearer wrong"}).status_code == 401
        token = client.post("/api/auth/login", json={"username": "alice", "password": "alice-pass-1"}).json()["token"]
        assert client.get("/metrics", headers={"Authorization": f"Bearer {token}"}).status_code == 403
        text = client.get("/metrics", headers={"Authorization": "Bearer scrape-me"}).text
        assert "ncode_http_requests_total" in text and 'route="/api/health"' in text and "ncode_users 3" in text
        assert "/api/auth/login" in text and "alice" not in text


def test_audit_log_is_pruned_daily(tmp_path):
    db = AppDB(tmp_path / "app.sqlite")
    now = 2_000_000_000.0
    for age_days in (400, 366, 10, 0):
        aid = db.audit("alice", "query", options="{}")
        with db.engine.begin() as conn:
            conn.exec_driver_sql("UPDATE audit_log SET ts = ? WHERE id = ?", (now - age_days * 86400, aid))
    chore = AuditRetention(db, keep_days=365)
    assert chore.tick(now) == 2
    db.audit("alice", "query")  # a new old entry is left until the next day
    with db.engine.begin() as conn:
        conn.exec_driver_sql("UPDATE audit_log SET ts = ?", (now - 500 * 86400,))
    assert chore.tick(now + 3600) is None
    assert chore.tick(now + 86400) == 3
    assert AuditRetention(db, keep_days=0).tick(now) is None  # 0 = keep forever
    db.dispose()


def test_audit_options_stay_small_and_readable():
    import json
    spec = {"connection": "shop", "source": {"table": "t"}, "filters": {"op": "in", "value": ["x" * 50] * 1000}}
    saved = json.loads(audit_options({"spec": spec, "question_id": 3, "dashboard_id": 5}))
    assert saved == {"question_id": 3, "dashboard_id": 5}  # the id says what ran
    big = audit_options({"spec": spec, "subscription_id": 7})
    assert len(big) <= AUDIT_OPTIONS_MAX and json.loads(big) == {"subscription_id": 7, "truncated": True}
    small = {"spec": {"connection": "shop", "source": {"table": "t"}}}
    assert json.loads(audit_options(small)) == small


def test_usage_still_counts_dashboard_runs(env):
    from .test_dashboards_api import card, new_dashboard, put, run_card
    q = save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [{"fn": "count", "alias": "n"}]})
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {"cards": [card("c", q["id"])]})
    run_card(env, "alice", d["id"], "c")
    usage = call(env, "admin", "GET", "/api/admin/usage")
    assert usage["dashboards"][0]["id"] == d["id"] and usage["questions"][0]["id"] == q["id"]
    entry = call(env, "admin", "GET", "/api/admin/audit", params={"action": "query"})["entries"][0]
    assert '"spec"' not in entry["options"]
