"""The "Factory demo" database (M11): generator, registration, hiding."""

import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.appdb import AppDB
from app.config import Settings, load_connections
from app.demo import DEMO_KEY, WORK_ORDERS, generate, vin_check_digit
from app.security import hash_password

from .helpers import auth
from .test_federation_api import _logged_in, env_with
from .test_library_api import call
from .test_semantic_api import query

TODAY = date(2026, 10, 28)


def _rows(path, sql):
    con = sqlite3.connect(path)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


# ---------------------------------------------------------------- the generator

def test_generator_is_deterministic(tmp_path):
    a, b, c = tmp_path / "a.sqlite", tmp_path / "b.sqlite", tmp_path / "c.sqlite"
    counts = generate(a, TODAY)
    assert generate(b, TODAY) == counts
    assert counts["work_orders"] == WORK_ORDERS and counts["downtime_events"] == 1500 and counts["scrap_records"] == 800
    assert counts["production_lines"] == 4 and counts["shifts"] == 3 and counts["parts"] == 40
    assert 1200 <= counts["vehicles"] <= 1800 and counts["quality_inspections"] == 240
    for table in ("work_orders", "downtime_events", "vehicles", "scrap_records"):
        assert _rows(a, f"SELECT * FROM {table} ORDER BY id") == _rows(b, f"SELECT * FROM {table} ORDER BY id")
    generate(c, TODAY, seed=7)
    assert _rows(a, "SELECT * FROM vehicles ORDER BY id") != _rows(c, "SELECT * FROM vehicles ORDER BY id")


def test_generated_data_is_consistent_and_ends_today(tmp_path):
    path = tmp_path / "f.sqlite"
    generate(path, TODAY)
    assert _rows(path, "PRAGMA foreign_key_check") == []
    fks = {(r[2], r[3]) for r in _rows(path, "PRAGMA foreign_key_list(work_orders)")}
    assert fks == {("parts", "part_id"), ("production_lines", "line_id"), ("shifts", "shift_id")}
    (first, last), = _rows(path, "SELECT min(production_date), max(production_date) FROM work_orders")
    assert last == "2026-10-28" and first >= "2025-10-29"
    assert _rows(path, "SELECT max(started_at) <= '2026-10-28 23:59:59' FROM downtime_events") == [(1,)]
    assert _rows(path, "SELECT count(*) FROM work_orders WHERE strftime('%w', production_date) = '0'") == [(0,)]  # closed on Sundays
    # scrap records add up to the scrap reported with the output
    assert _rows(path, "SELECT (SELECT sum(qty) FROM scrap_records) = (SELECT sum(scrap_qty) FROM production_output)") == [(1,)]
    # one vehicle per good piece of final assembly, valid VINs
    assert _rows(path, "SELECT count(*) FROM vehicles") == _rows(
        path, "SELECT sum(good_qty) FROM production_output o JOIN work_orders w ON w.id = o.work_order_id WHERE w.line_id = 4")
    for (vin,) in _rows(path, "SELECT vin FROM vehicles LIMIT 50"):
        assert len(vin) == 17 and vin[8] == vin_check_digit(vin) and not set(vin) & set("IOQ")
    # the paint line scraps the most, the night shift more than the day
    rates = dict(_rows(path, """SELECT w.line_id, 1.0 * sum(o.scrap_qty) / sum(o.good_qty + o.scrap_qty)
                                 FROM production_output o JOIN work_orders w ON w.id = o.work_order_id GROUP BY 1"""))
    assert max(rates, key=rates.get) == 3
    # one month with far more downtime than the others
    hours = sorted(h for (h,) in _rows(path, "SELECT sum(minutes) FROM downtime_events GROUP BY substr(started_at, 1, 7)"))
    assert hours[-1] > 2 * hours[-2]


def test_vin_check_digit():
    assert vin_check_digit("1M8GDM9A0KP042788") == "X"  # the textbook example
    assert vin_check_digit("11111111111111111") == "1"


# ---------------------------------------------------------------- the connection

@pytest.fixture()
def env(tmp_path):
    client, app_db = env_with(tmp_path, demo_enabled=True)
    with client:
        yield {**_logged_in(client, app_db), "tmp": tmp_path}


def test_everyone_may_use_the_demo(env):
    assert (env["tmp"] / "demo" / "factory.sqlite").is_file()
    # bob may only use "other" - the demo is open to everyone
    listed = {c["key"]: c for c in call(env, "bob", "GET", "/api/connections")}
    assert listed[DEMO_KEY]["label"] == "Factory demo" and listed[DEMO_KEY]["engine"] == "sqlite"
    assert listed[DEMO_KEY]["database"] == ""  # no file paths for non-admins
    assert listed[DEMO_KEY]["source"] == "demo"  # says what it is, also to non-admins
    assert "shop" not in listed
    admin = {c["key"]: c for c in call(env, "admin", "GET", "/api/connections")}
    assert admin[DEMO_KEY]["source"] == "demo" and admin[DEMO_KEY]["editable"] is False
    call(env, "admin", "DELETE", f"/api/connections/{DEMO_KEY}", 400)

    schema = call(env, "bob", "GET", f"/api/connections/{DEMO_KEY}/schema")
    tables = {t["name"]: t for t in schema["tables"]}
    assert tables["work_orders"]["display_name"] == "Work orders"
    assert tables["work_orders"]["translations"]["ru"]["display_name"] == "Производственные заказы"
    for t in tables.values():  # every table and column is named in both languages
        assert t["display_name"] and t["translations"]["ru"]["display_name"] and t["translations"]["ru"]["description"]
        for c in t["columns"]:
            assert c["display_name"] and c["description"] and c["translations"]["ru"]["display_name"], (t["name"], c["name"])
    assert {"from_table": "work_orders", "from_columns": ["part_id"], "to_table": "parts", "to_columns": ["id"],
            "manual": False} in schema["relationships"]

    metrics = {m["name"]: m for m in call(env, "bob", "GET", "/api/metrics", params={"connection": DEMO_KEY})["metrics"]}
    assert set(metrics) == {"Output", "Scrap rate", "Downtime hours"}
    assert metrics["Scrap rate"]["translations"]["ru"]["name"] == "Доля брака"
    spec = {"connection": DEMO_KEY, "source": {"table": "downtime_events"}, "joins": [{"table": "production_lines"}],
            "breakouts": [{"ref": "production_lines.name", "alias": "line"}],
            "aggregations": [{"fn": "metric", "metric": metrics["Downtime hours"]["id"]}], "order": [{"ref": "line"}]}
    rows = query(env, "bob", spec)["result"]["rows"]
    assert [r[0] for r in rows] == ["Final assembly", "Paint line", "Press line", "Welding line"] and all(r[1] > 0 for r in rows)
    rate = query(env, "bob", {"connection": DEMO_KEY, "source": {"table": "production_output"},
                              "aggregations": [{"fn": "metric", "metric": metrics["Scrap rate"]["id"]}]})["result"]
    assert 0 < rate["rows"][0][0] < 0.1 and rate["columns"][0]["format"]["style"] == "percent"


def test_admin_hides_the_demo_for_everyone(env, tmp_path):
    call(env, "alice", "PUT", "/api/admin/demo", 403, json={"hidden": True})
    assert call(env, "admin", "GET", "/api/admin/demo")["hidden"] is False
    status = call(env, "admin", "PUT", "/api/admin/demo", json={"hidden": True})
    assert status["hidden"] is True and status["available"] is True
    for who in ("admin", "alice", "bob"):
        assert DEMO_KEY not in [c["key"] for c in call(env, who, "GET", "/api/connections")]
    call(env, "bob", "GET", f"/api/connections/{DEMO_KEY}/schema", 404)

    # still hidden after a restart; showing it again brings it back
    client = TestClient(create_app(Settings(search_workers=2, demo_enabled=True), _shop(tmp_path), env["db"]))
    with client:
        bob = auth(client, "bob", "bob-pass-123")
        assert DEMO_KEY not in [c["key"] for c in client.get("/api/connections", headers=bob).json()]
        admin = auth(client, "admin", "admin-pass-1")
        assert client.put("/api/admin/demo", json={"hidden": False}, headers=admin).json()["hidden"] is False
        assert DEMO_KEY in [c["key"] for c in client.get("/api/connections", headers=bob).json()]


def _shop(tmp_path):
    return load_connections({"NCODE_CONN_SHOP_ENGINE": "sqlite", "NCODE_CONN_SHOP_DATABASE": str(tmp_path / "shop.db")})


def test_admin_edits_of_the_demo_data_model_survive_a_restart(env, tmp_path):
    call(env, "admin", "PUT", f"/api/semantic/{DEMO_KEY}/tables/vehicles", json={"display_name": "Cars"})
    client = TestClient(create_app(Settings(search_workers=2, demo_enabled=True), _shop(tmp_path), env["db"]))
    with client:
        admin = auth(client, "admin", "admin-pass-1")
        names = client.get(f"/api/semantic/{DEMO_KEY}/tables", headers=admin).json()["tables"]
        assert names["vehicles"] == {"display_name": "Cars", "description": None, "translations": None}
        metrics = client.get("/api/metrics", params={"connection": DEMO_KEY}, headers=admin).json()["metrics"]
        assert len(metrics) == 3  # not added twice


def test_row_rules_apply_to_the_demo(env):
    g = call(env, "admin", "POST", "/api/admin/groups", json={"name": "Export team", "connections": "", "members": ["carol"]})
    call(env, "admin", "POST", "/api/admin/row-rules", json={"group_id": g["id"], "connection": DEMO_KEY, "table": "vehicles",
                                                             "column": "market", "values": ["Export EU"]})
    spec = {"connection": DEMO_KEY, "source": {"table": "vehicles"}, "breakouts": [{"ref": "vehicles.market", "alias": "market"}],
            "aggregations": [{"fn": "count", "alias": "n"}]}
    assert [r[0] for r in query(env, "carol", spec)["result"]["rows"]] == ["Export EU"]
    assert len(query(env, "alice", spec)["result"]["rows"]) == 3


def test_a_new_connection_does_not_take_the_demo_key(env, tmp_path):
    other = tmp_path / "other.sqlite"
    sqlite3.connect(other).execute("CREATE TABLE t (id INTEGER)").connection.close()
    made = call(env, "admin", "POST", "/api/connections", 201, json={"label": "Demo", "engine": "sqlite", "database": str(other)})
    assert made["key"] != DEMO_KEY


def test_no_demo_when_turned_off(tmp_path):
    client, app_db = env_with(tmp_path)  # Settings() without demo_enabled, as NCODE_DEMO=0
    with client:
        env = _logged_in(client, app_db)
        assert DEMO_KEY not in [c["key"] for c in call(env, "admin", "GET", "/api/connections")]
        assert call(env, "admin", "GET", "/api/admin/demo")["enabled"] is False
        call(env, "admin", "PUT", "/api/admin/demo", 400, json={"hidden": False})
    assert not (tmp_path / "demo").exists()


def test_a_connection_with_the_same_key_wins(tmp_path):
    own = tmp_path / "own.sqlite"
    sqlite3.connect(own).execute("CREATE TABLE mine (id INTEGER)").connection.close()
    connections = load_connections({"NCODE_CONN_DEMO_ENGINE": "sqlite", "NCODE_CONN_DEMO_DATABASE": str(own)})
    app_db = AppDB(tmp_path / "app.sqlite")
    app_db.create_user("admin", hash_password("admin-pass-1"), "admin")
    app_db.create_user("bob", hash_password("bob-pass-123"), allowed=("other",))
    with TestClient(create_app(Settings(search_workers=2, demo_enabled=True), connections, app_db)) as c:
        admin = auth(c, "admin", "admin-pass-1")
        assert c.get("/api/admin/demo", headers=admin).json()["reason"] == "conflict"
        names = [t["name"] for t in c.get(f"/api/connections/{DEMO_KEY}/tables", headers=admin).json()["tables"]]
        assert names == ["mine"]
        assert c.get(f"/api/semantic/{DEMO_KEY}/tables", headers=admin).json()["tables"] == {}  # no demo names on it
        bob = auth(c, "bob", "bob-pass-123")
        assert c.get("/api/connections", headers=bob).json() == []  # not open to everyone
        # showing the demo cannot replace it either
        assert c.put("/api/admin/demo", json={"hidden": False}, headers=admin).json()["available"] is False
        assert c.get(f"/api/connections/{DEMO_KEY}/tables", headers=admin).json()["tables"][0]["name"] == "mine"
    assert not (tmp_path / "demo").exists()


def test_ncode_demo_setting():
    from app.config import load_settings

    assert load_settings({}).demo_enabled is True  # on when the server starts ...
    assert load_settings({"NCODE_DEMO": "0"}).demo_enabled is False
    assert Settings().demo_enabled is False  # ... off for tests and tools that build Settings themselves
