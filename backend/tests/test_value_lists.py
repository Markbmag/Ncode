"""Value pickers and names in place of ids (M12): /api/connections/{key}/values and "Show values as"."""

import pytest
from sqlalchemy import Integer, String, create_engine, text

from app.semantic.labels import obvious_label

from .test_admin_api import eu_only, group, rule
from .test_dashboards_api import card, new_dashboard, put, rows, run_card
from .test_demo import env as demo_env  # noqa: F401  (fixture)
from .test_library_api import call, library_env, save_builder
from .test_semantic_api import query

BY_CUSTOMER = {
    "connection": "shop", "source": {"table": "q_orders"},
    "breakouts": [{"ref": "q_orders.customer_id"}], "aggregations": [{"fn": "count", "alias": "n"}],
}


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def values(env, who, table, column, status=200, **params):
    return call(env, who, "GET", "/api/connections/shop/values", status, params={"table": table, "column": column, **params})


def show_names(env, table="q_orders", column="customer_id", label="name", status=200, **extra):
    return call(env, "admin", "PUT", f"/api/semantic/shop/fields/{table}/{column}", status, json={"label_column": label, **extra})


# ---------------------------------------------------------------- which column names a row

def test_obvious_label_column():
    col = lambda name, type_=String(50): {"name": name, "type": type_}  # noqa: E731
    assert obvious_label([col("id", Integer()), col("name"), col("hall")], key="id") == "name"
    assert obvious_label([col("id", Integer()), col("line_name"), col("hall")]) == "line_name"
    assert obvious_label([col("id", Integer()), col("order_number"), col("status")]) == "order_number"
    assert obvious_label([col("id", Integer()), col("code"), col("name")]) == "name"  # a name beats a code
    assert obvious_label([col("name"), col("title")]) is None  # two candidates: not obvious
    assert obvious_label([col("id", Integer()), col("vin"), col("model")]) is None
    assert obvious_label([col("id", Integer()), col("name", Integer())]) is None  # not text
    assert obvious_label([col("name"), col("label")], {"label": {"semantic_type": "name"}}) == "label"  # the data model says
    assert obvious_label([col("name"), col("x")], {"name": {"hidden": True}}) is None


# ---------------------------------------------------------------- the data-model setting

def test_show_values_as_is_a_setting_of_foreign_keys(env):
    show_names(env, "q_orders", "status", status=400)                       # not a foreign key
    show_names(env, label="nope", status=400)                                # no such column there
    show_names(env, label="id", status=400)                                  # the key itself
    call(env, "alice", "PUT", "/api/semantic/shop/fields/q_orders/customer_id", 403, json={"label_column": "name"})
    saved = show_names(env, display_name="Customer", format={"style": "plain", "label_column": "ignored"})["field"]
    assert saved["label_column"] == "name" and saved["format"] == {"style": "plain"} and saved["display_name"] == "Customer"
    cols = {c["name"]: c for c in next(t for t in call(env, "alice", "GET", "/api/connections/shop/schema")["tables"]
                                        if t["name"] == "q_orders")["columns"]}
    assert cols["customer_id"]["label_column"] == "name" and cols["customer_id"]["format"] == {"style": "plain"}
    assert cols["customer_id"]["suggested_label"] == "name"  # what the editor offers
    assert cols["customer_id"]["foreign_key"] == {"table": "q_customers", "column": "id"}
    assert "suggested_label" not in cols["status"]
    # clearing it keeps the rest
    again = call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/customer_id",
                 json={"display_name": "Customer", "format": {"style": "plain"}})["field"]
    assert again["label_column"] is None and again["format"] == {"style": "plain"}


def test_a_relationship_added_by_hand_can_show_names_too(env, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'shop.db'}")
    with engine.begin() as c:
        c.execute(text("CREATE TABLE q_notes (order_ref INTEGER, note TEXT)"))
        c.execute(text("INSERT INTO q_notes VALUES (1, 'gift'), (1, 'wrap'), (3, 'urgent'), (99, 'lost')"))
    engine.dispose()
    call(env, "admin", "GET", "/api/connections/shop/schema", params={"refresh": True})
    show_names(env, "q_notes", "order_ref", label="status", status=400)
    call(env, "admin", "POST", "/api/semantic/shop/relationships",
         json={"from_table": "q_notes", "from_columns": ["order_ref"], "to_table": "q_orders", "to_columns": ["id"]})
    show_names(env, "q_notes", "order_ref", label="status")
    spec = {"connection": "shop", "source": {"table": "q_notes"}, "breakouts": [{"ref": "q_notes.order_ref"}],
            "aggregations": [{"fn": "count", "alias": "n"}]}
    # order 99 does not exist: its id is shown (as text) instead of an empty name
    assert query(env, "alice", spec)["result"]["rows"] == [["paid", 2], ["paid", 1], ["99", 1]]


# ---------------------------------------------------------------- names in place of ids

def test_questions_grouped_by_a_foreign_key_show_names(env):
    plain = query(env, "alice", BY_CUSTOMER)["result"]
    assert plain["rows"] == [[None, 1], [1, 2], [2, 2], [3, 1], [4, 1]]  # not set: ids, as before
    show_names(env, display_name="Customer")
    result = query(env, "alice", BY_CUSTOMER)["result"]
    # the order stays the order of the ids; the empty group stays empty
    assert result["rows"] == [[None, 1], ["Anna", 2], ["Bob", 2], ["Chen", 1], ["50% Club", 1]]
    col = result["columns"][0]
    assert (col["name"], col["type"], col["display_name"]) == ("customer_id", "string", "Customer")
    assert col["remapped"] == {"table": "q_customers", "key": "id", "label": "name"}
    assert "ncode_label_1" in result["sql"] and "LEFT OUTER JOIN q_customers" in result["sql"]

    # sorting, "filter the summary" and filters still mean the ids
    ordered = query(env, "alice", {**BY_CUSTOMER, "order": [{"ref": "customer_id", "dir": "desc"}]})["result"]["rows"]
    assert [r[0] for r in ordered][:2] == ["50% Club", "Chen"]
    having = {**BY_CUSTOMER, "having": {"rules": [{"ref": "customer_id", "op": ">=", "value": 3}]}}
    assert query(env, "alice", having)["result"]["rows"] == [["Chen", 1], ["50% Club", 1]]
    where = {**BY_CUSTOMER, "filters": {"rules": [{"ref": "q_orders.customer_id", "op": "in", "value": [1, 2]}]}}
    assert query(env, "alice", where)["result"]["rows"] == [["Anna", 2], ["Bob", 2]]
    # grouped by month, or listing rows: unchanged
    rows_only = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"},
                                     "fields": [{"ref": "q_orders.customer_id"}], "order": [{"ref": "q_orders.id"}]})
    assert rows_only["result"]["rows"][0] == [1]


def test_dashboard_column_filters_still_map_to_the_ids(env):
    show_names(env)
    q = save_builder(env, "alice", spec=BY_CUSTOMER, name="Orders per customer")
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {
        "filters": [{"id": "customer", "label": "Customer", "type": "category"}], "tabs": [], "settings": {},
        "cards": [card("c1", q["id"], mappings={"customer": {"field": "q_orders.customer_id"}})],
    })
    assert rows(run_card(env, "alice", d["id"], "c1", {"customer": ["2", "4"]})) == [["Bob", 2], ["50% Club", 1]]
    assert len(rows(run_card(env, "alice", d["id"], "c1"))) == 5


def test_no_names_from_rows_the_viewer_may_not_see(env):
    show_names(env)
    eu_only(env)  # alice: only customers in the EU (Anna, 50% Club)
    assert query(env, "alice", BY_CUSTOMER)["result"]["rows"] == [[None, 1], [1, 2], [2, 2], [3, 1], [4, 1]]
    assert query(env, "carol", BY_CUSTOMER)["result"]["rows"][1] == ["Anna", 2]
    listed = values(env, "alice", "q_orders", "customer_id")
    assert listed["label"] is None and all("label" not in v for v in listed["values"])
    assert values(env, "carol", "q_orders", "customer_id")["values"][0] == {"value": 1, "label": "Anna", "count": 2}


def test_multi_source_questions_keep_the_ids(env):
    show_names(env)
    spec = {"version": 1, "sources": [{"alias": "o", "type": "builder", "spec": BY_CUSTOMER}]}
    data = call(env, "alice", "POST", "/api/federated/run", json={"spec": spec, "parameters": [], "params": {}, "wait_ms": 10000})
    if data["status"] == "running":
        from .test_query_api import wait_done
        data = wait_done(env["client"], env["alice"], data["task_id"])
    assert sorted(r[0] for r in data["result"]["rows"] if r[0] is not None) == [1, 2, 3, 4]


# ---------------------------------------------------------------- value lists

def test_values_most_frequent_first_with_counts(env):
    listed = values(env, "alice", "q_orders", "status")
    assert listed["values"] == [{"value": "paid", "count": 5}, {"value": "refunded", "count": 1}]  # no NULL
    assert listed["label"] is None and listed["truncated"] is False and listed["cached"] is False
    assert values(env, "alice", "q_orders", "status")["cached"] is True
    cut = values(env, "alice", "q_orders", "status", limit=1)
    assert cut["values"] == [{"value": "paid", "count": 5}] and cut["truncated"] is True
    assert values(env, "alice", "q_orders", "status", q="REF")["values"] == [{"value": "refunded", "count": 1}]
    assert values(env, "alice", "Q_ORDERS", "Status")["values"][0]["value"] == "paid"  # names as typed
    audit = [r for r in env["db"].list_audit(50) if r.action == "values"]
    # the list and the shorter one - not each search, nor a list read from the cache
    assert len(audit) == 2 and {a.phrase for a in audit} == {"q_orders.status"}


def test_values_carry_labels_of_the_related_table(env):
    # no setting: an obvious label column (name) is used for pickers - it changes no result
    listed = values(env, "alice", "q_orders", "customer_id")
    assert listed["label"] == {"table": "q_customers", "key": "id", "label": "name"}
    assert listed["values"][:2] == [{"value": 1, "label": "Anna", "count": 2}, {"value": 2, "label": "Bob", "count": 2}]
    assert [v["value"] for v in values(env, "alice", "q_orders", "customer_id", q="club")["values"]] == [4]
    assert [v["value"] for v in values(env, "alice", "q_orders", "customer_id", q="3")["values"]] == [3]  # the id itself
    assert values(env, "alice", "q_orders", "qty", q="many")["values"] == []  # letters in a number column
    # a text key with the setting pointing at another column
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_order_items/sku", json={"label_column": "title"})
    assert values(env, "alice", "q_order_items", "sku")["values"][0] == {"value": "A", "label": "Apple", "count": 2}


def test_values_follow_permissions_and_row_rules(env):
    values(env, "bob", "q_orders", "status", 404)  # bob may not use the connection
    values(env, "alice", "q_nope", "status", 404)
    values(env, "alice", "q_orders", "nope", 404)
    values(env, "alice", "q_orders", "created_at", 400)  # dates are picked with a calendar
    before = values(env, "carol", "q_customers", "region")["values"]
    assert [v["value"] for v in before] == ["EU", "US"]
    eu_only(env, "carol")
    assert [v["value"] for v in values(env, "carol", "q_customers", "name")["values"]] == ["50% Club", "Anna"]
    # a cached list is never served to someone with other row rules
    assert values(env, "carol", "q_customers", "region")["values"] == [{"value": "EU", "count": 2}]
    assert [v["value"] for v in values(env, "alice", "q_customers", "region")["values"]] == ["EU", "US"]
    g = group(env, "Paid only", ["alice"])
    rule(env, g["id"], "q_orders", "status", ["paid"])
    assert values(env, "alice", "q_orders", "status")["values"] == [{"value": "paid", "count": 5}]


# ---------------------------------------------------------------- the demo

def test_the_demo_shows_line_names(demo_env):  # noqa: F811
    env = demo_env
    spec = {"connection": "demo", "source": {"table": "downtime_events"}, "breakouts": [{"ref": "downtime_events.line_id"}],
            "aggregations": [{"fn": "count", "alias": "stops"}]}
    result = query(env, "bob", spec)["result"]
    assert [r[0] for r in result["rows"]] == ["Press line", "Welding line", "Paint line", "Final assembly"]  # in line order
    schema = call(env, "bob", "GET", "/api/connections/demo/schema")
    fks = [(t["name"], c["name"], c.get("label_column")) for t in schema["tables"] for c in t["columns"] if c["foreign_key"]]
    assert fks and all(label for _t, _c, label in fks), fks  # every foreign key shows a name
    listed = call(env, "bob", "GET", "/api/connections/demo/values", params={"table": "downtime_events", "column": "line_id"})
    assert {v["label"] for v in listed["values"]} == {"Press line", "Welding line", "Paint line", "Final assembly"}
    assert call(env, "bob", "GET", "/api/connections/demo/values",
                params={"table": "downtime_events", "column": "line_id", "q": "paint"})["values"][0]["value"] == 3


def test_a_demo_filled_before_gets_the_names(tmp_path):
    from fastapi.testclient import TestClient

    from app.api import create_app
    from app.config import Settings
    from app.demo import DEMO_KEY, SEEDED_SETTING

    from .test_federation_api import _logged_in, env_with

    client, app_db = env_with(tmp_path, demo_enabled=True)
    with client:  # as a data model filled by M11: no "Show values as" yet, one column changed by an admin
        env = _logged_in(client, app_db)
        call(env, "admin", "PUT", f"/api/semantic/{DEMO_KEY}/fields/downtime_events/line_id", json={"display_name": "Line"})
        call(env, "admin", "PUT", f"/api/semantic/{DEMO_KEY}/fields/downtime_events/shift_id", json={"display_name": "Shift (own)"})
    with app_db.engine.begin() as conn:
        conn.execute(text("UPDATE app_settings SET value = '1' WHERE key = :k"), {"k": SEEDED_SETTING})
    with TestClient(create_app(Settings(search_workers=2, demo_enabled=True), {}, app_db)) as again:
        env = _logged_in(again, app_db)
        cols = {c["name"]: c for c in next(t for t in call(env, "admin", "GET", f"/api/connections/{DEMO_KEY}/schema")["tables"]
                                            if t["name"] == "downtime_events")["columns"]}
        assert cols["line_id"]["label_column"] == "name" and cols["shift_id"]["label_column"] == "name"
        assert cols["shift_id"]["display_name"] == "Shift (own)"  # what the admin set stays
        # filled once: an admin's "show the id" stays after the next start
        call(env, "admin", "PUT", f"/api/semantic/{DEMO_KEY}/fields/downtime_events/line_id", json={"display_name": "Line"})
    with TestClient(create_app(Settings(search_workers=2, demo_enabled=True), {}, app_db)) as third:
        env = _logged_in(third, app_db)
        cols = {c["name"]: c for c in next(t for t in call(env, "admin", "GET", f"/api/connections/{DEMO_KEY}/schema")["tables"]
                                            if t["name"] == "downtime_events")["columns"]}
        assert cols["line_id"]["label_column"] is None
