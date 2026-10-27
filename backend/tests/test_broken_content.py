"""Admin → Broken content (M10): saved things that point at tables, columns, questions or files that are gone."""

import sqlite3
import threading

import pytest

from app.db import ConnectionRegistry
from app.content.health import DbShape, check_sql, classify, sql_tables
from app.query.compiler import CompileError

from .test_dashboards_api import card, new_dashboard, put
from .test_federation_api import CUSTOMERS, ORDERS, JOIN_C, upload
from .test_library_api import call, library_env, save_builder, save_sql


@pytest.fixture()
def env(tmp_path):
    for e in library_env(tmp_path):
        e["shop"] = tmp_path / "shop.db"
        yield e


def shop(env, sql):
    con = sqlite3.connect(env["shop"])
    con.executescript(sql)
    con.commit()
    con.close()


def report(env, refresh=True, who="admin"):
    return call(env, who, "GET", "/api/admin/broken-content", params={"refresh": refresh})


def by_name(rep):
    return {i["name"]: i for i in rep["items"]}


def test_nothing_broken_and_admin_only(env):
    save_builder(env, "alice")
    save_sql(env, "alice", "SELECT * FROM q_orders o JOIN q_customers c ON c.id = o.customer_id")
    rep = report(env)
    assert rep["items"] == [] and rep["unchecked"] == [] and rep["counts"]["questions"] == 2
    call(env, "alice", "GET", "/api/admin/broken-content", 403)


def test_renamed_column_and_dropped_table_are_found(env):
    save_builder(env, "alice", name="Revenue")  # uses q_orders.status, total and q_customers.region
    save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_products"}}, name="Products")
    save_sql(env, "alice", "WITH t AS (SELECT 1 AS x) SELECT * FROM q_products, t")
    ok = save_builder(env, "alice", spec={"connection": "shop", "source": {"table": "q_orders"},
                                          "fields": [{"ref": "q_orders.id"}]}, name="Still fine")
    shop(env, """
        ALTER TABLE q_customers RENAME COLUMN region TO area;
        DROP TABLE q_order_items;
        DROP TABLE q_products;
    """)
    rep = report(env)
    items = by_name(rep)
    assert set(items) == {"Revenue", "Products", "SQL q"}
    assert items["Revenue"]["code"] == "missing_column" and "region" in items["Revenue"]["problem"]
    assert items["Revenue"]["owner"] == "alice" and items["Revenue"]["collection"]["name"] == "alice's collection"
    assert items["Revenue"]["link"] == f"/questions/{items['Revenue']['id']}" and items["Revenue"]["kind"] == "question"
    assert items["Products"]["code"] == "missing_table" and items["Products"]["params"]["table"] == "q_products"
    assert items["SQL q"]["code"] == "missing_table" and "q_products" in items["SQL q"]["problem"]
    assert ok["id"] not in [i["id"] for i in rep["items"]]

    # without refresh the last report is returned as it was
    assert report(env, refresh=False)["checked_at"] == rep["checked_at"]


def test_sql_reading_a_view_or_another_schema_is_not_reported(env):
    shop(env, "CREATE VIEW paid AS SELECT * FROM q_orders WHERE status = 'paid';")
    save_sql(env, "alice", "SELECT * FROM paid")
    save_sql(env, "alice", "SELECT * FROM other.some_table")  # another schema: its tables were not read
    save_sql(env, "alice", "SELECT * FROM generate_series(1, 3)")
    assert report(env)["items"] == []


def test_removed_connection_and_unreachable_database(env, monkeypatch):
    save_builder(env, "alice", name="Revenue")
    q = save_sql(env, "alice", "SELECT 1 AS x")
    with env["db"].engine.begin() as conn:  # as if made for a database that was removed later
        conn.exec_driver_sql("UPDATE questions SET connection = 'gone' WHERE id = ?", (q["id"],))
    rep = report(env)
    assert [(i["id"], i["code"]) for i in rep["items"]] == [(q["id"], "missing_connection")]

    # the database cannot be reached: "couldn't check", not broken
    def unreachable(self, key, schema=None, refresh=False):
        raise OSError("connection refused")

    monkeypatch.setattr(ConnectionRegistry, "get_schema", unreachable)
    rep = report(env)
    assert [i["code"] for i in rep["items"]] == ["missing_connection"]
    assert rep["unchecked"] == [{"connection": "shop", "label": rep["unchecked"][0]["label"], "questions": 1,
                                 "reason": rep["unchecked"][0]["reason"]}]
    assert "connection refused" in rep["unchecked"][0]["reason"].lower()


def test_a_slow_database_is_given_up_on(env, monkeypatch):
    save_builder(env, "alice", name="Revenue")
    release = threading.Event()

    def slow(self, key, schema=None, refresh=False):
        release.wait(5)
        return {}

    monkeypatch.setattr(ConnectionRegistry, "get_schema", slow)
    env["client"].app.state.content_health.budget_sec = 0.3
    try:
        rep = report(env)
    finally:
        release.set()
    assert rep["items"] == [] and "longer than" in rep["unchecked"][0]["reason"]


def test_dashboards_subscriptions_and_multi_source(env):
    q = save_builder(env, "alice", name="Revenue")
    d = new_dashboard(env, "alice", name="Board")
    put(env, "alice", d["id"], {"cards": [card("c1", q["id"], title="Money")], "filters": [], "tabs": []})
    call(env, "alice", "POST", "/api/subscriptions", json={
        "name": "Daily board", "target_type": "dashboard", "target_id": d["id"],
        "schedule": {"every": "day", "hour": 7}, "recipients": {"users": ["alice"]},
    })
    fed = call(env, "alice", "POST", "/api/questions", json={
        "name": "Combined", "kind": "federated",
        "spec": {"sources": [ORDERS, CUSTOMERS], "joins": [JOIN_C]}, "parameters": [],
    })
    assert report(env)["items"] == []

    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    items = by_name(report(env))
    assert items["Board"]["kind"] == "dashboard" and items["Board"]["code"] == "archived_question"
    assert items["Board"]["params"]["card"] == "Money" and items["Board"]["link"] == f"/dashboards/{d['id']}"

    shop(env, "ALTER TABLE q_customers RENAME TO clients;")
    items = by_name(report(env))
    assert items["Combined"]["code"] == "missing_table" and items["Combined"]["params"]["source"] == "Customers"
    assert fed["id"] == items["Combined"]["id"]

    with env["db"].engine.begin() as conn:  # a subscription left behind by an older version
        conn.exec_driver_sql("DELETE FROM dashboards WHERE id = ?", (d["id"],))
    items = by_name(report(env))
    assert items["Daily board"]["kind"] == "subscription" and items["Daily board"]["code"] == "deleted_dashboard"


def test_missing_uploaded_file(env, tmp_path):
    upload(env, "alice", "targets.csv", b"a;b\n1;2\n")
    assert report(env)["items"] == []
    for f in (env["db"].path.parent / "datasets").iterdir():
        f.unlink()
    items = report(env)["items"]
    assert [(i["kind"], i["code"]) for i in items] == [("dataset", "missing_file")]


# ---------------------------------------------------------------- the pieces

def test_classify_compile_errors():
    assert classify(CompileError("Unknown column 'q_orders.qty'")).params == {"column": "q_orders.qty"}
    assert classify(CompileError("Unknown table 'x'")).code == "missing_table"
    assert classify(CompileError("sum needs a number column; a is string")).code == "cannot_build"


def test_sql_tables_skip_ctes_functions_and_temp_tables():
    assert sql_tables("WITH a AS (SELECT 1) SELECT * FROM a JOIN b ON 1=1 WHERE x = {{p}}", "sqlite") == [("", "b")]
    assert sql_tables("SELECT * FROM #tmp JOIN dbo.orders o ON 1=1 JOIN db2.dbo.x ON 1=1", "mssql") == [("dbo", "orders")]
    assert sql_tables("SELECT * FROM (", "sqlite") is None
    shape = DbShape("m", "mssql", None, "dbo", {}, {}, {"orders"})
    assert check_sql("SELECT * FROM dbo.Orders", shape) is None
    assert check_sql("SELECT * FROM sales.gone", shape) is None
    assert check_sql("SELECT * FROM dbo.gone", shape).params["table"] == "dbo.gone"
