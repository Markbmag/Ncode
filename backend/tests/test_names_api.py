"""Table names and translations in the data model (M11)."""

import pytest

from .test_federation_api import _logged_in, env_with
from .test_library_api import call
from .test_semantic_api import query

RU = {"ru": {"display_name": " Заказы ", "description": ""}}


@pytest.fixture()
def env(tmp_path):
    client, app_db = env_with(tmp_path)
    with client:
        yield _logged_in(client, app_db)


def test_table_names_are_admin_only_and_show_in_lists_and_schema(env):
    body = {"display_name": "Orders", "description": "One row per order", "translations": RU}
    call(env, "alice", "PUT", "/api/semantic/shop/tables/q_orders", 403, json=body)
    call(env, "admin", "PUT", "/api/semantic/shop/tables/nope", 404, json=body)
    saved = call(env, "admin", "PUT", "/api/semantic/shop/tables/q_orders", json=body)["table"]
    # blanks are dropped, texts trimmed
    assert saved == {"display_name": "Orders", "description": "One row per order", "translations": {"ru": {"display_name": "Заказы"}}}

    assert call(env, "alice", "GET", "/api/semantic/shop/tables")["tables"] == {"q_orders": saved}
    listed = {t["name"]: t for t in call(env, "alice", "GET", "/api/connections/shop/tables")["tables"]}
    assert listed["q_orders"]["display_name"] == "Orders" and listed["q_orders"]["translations"]["ru"]["display_name"] == "Заказы"
    assert "display_name" not in listed["q_customers"]
    schema = call(env, "alice", "GET", "/api/connections/shop/schema")
    table = next(t for t in schema["tables"] if t["name"] == "q_orders")
    assert table["display_name"] == "Orders" and table["description"] == "One row per order"
    assert table["columns"]  # the columns are still there

    call(env, "bob", "GET", "/api/semantic/shop/tables", 404)  # no access to the connection
    # clearing everything removes the entry
    assert call(env, "admin", "PUT", "/api/semantic/shop/tables/q_orders", json={"display_name": " ", "translations": {"ru": {}}})["table"] is None
    assert call(env, "alice", "GET", "/api/semantic/shop/tables")["tables"] == {}


def test_translations_are_checked(env):
    put = "/api/semantic/shop/tables/q_orders"
    call(env, "admin", "PUT", put, 422, json={"translations": {"ru": {"name": "Заказы"}}})  # tables have no "name"
    call(env, "admin", "PUT", put, 422, json={"translations": {"русский": {"display_name": "Заказы"}}})
    call(env, "admin", "PUT", put, 422, json={"translations": {"ru": {"display_name": "x" * 201}}})
    call(env, "admin", "PUT", put, 422, json={"translations": {"ru": "Заказы"}})
    call(env, "admin", "PUT", put, 422, json={"translations": {"ru": {"display_name": 5}}})


def test_column_translations_reach_schema_and_results(env):
    body = {"display_name": "Order total", "translations": {"ru": {"display_name": "Сумма заказа", "description": "С НДС"}}}
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/total", json=body)
    fields = call(env, "alice", "GET", "/api/semantic/shop/fields")["fields"]
    assert fields["q_orders"]["total"]["translations"] == body["translations"]
    schema = call(env, "alice", "GET", "/api/connections/shop/schema")
    cols = {c["name"]: c for c in next(t for t in schema["tables"] if t["name"] == "q_orders")["columns"]}
    assert cols["total"]["translations"]["ru"]["display_name"] == "Сумма заказа"

    result = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}, "limit": 1})["result"]
    total = next(c for c in result["columns"] if c["name"] == "total")
    assert total["translations"]["ru"]["display_name"] == "Сумма заказа"
    summed = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"},
                                  "aggregations": [{"fn": "sum", "ref": "total", "alias": "revenue"}]})["result"]
    assert summed["columns"][0]["translations"] is None  # a sum is not the column itself

    # translations alone keep the entry; removing them clears it
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/total", json={"translations": {"ru": {"display_name": "Сумма"}}})
    assert call(env, "alice", "GET", "/api/semantic/shop/fields")["fields"]["q_orders"]["total"]["display_name"] is None
    call(env, "admin", "PUT", "/api/semantic/shop/fields/q_orders/total", json={"translations": None})
    assert "total" not in call(env, "alice", "GET", "/api/semantic/shop/fields")["fields"].get("q_orders", {})


def test_metric_translations(env):
    body = {"name": "Revenue", "connection": "shop", "table": "q_orders", "definition": {"fn": "sum", "ref": "total"},
            "translations": {"ru": {"name": "Выручка", "description": " "}}}
    call(env, "admin", "POST", "/api/metrics", 422, json={**body, "translations": {"ru": {"display_name": "Выручка"}}})
    metric = call(env, "admin", "POST", "/api/metrics", json=body)
    assert metric["translations"] == {"ru": {"name": "Выручка"}}
    assert call(env, "alice", "GET", "/api/metrics")["metrics"][0]["translations"] == {"ru": {"name": "Выручка"}}
    updated = call(env, "admin", "PUT", f"/api/metrics/{metric['id']}", json={**body, "translations": None})
    assert updated["translations"] is None
