"""Ratio metrics (M12): one total divided by another, right at every grouping."""

from .test_federation_api import fed_run
from .test_library_api import call, run
from .test_query_api import wait_done
from .test_semantic_api import PAID, env, query  # noqa: F401  (env is a fixture)

PAID_SHARE = {
    "name": "Paid share", "connection": "shop", "table": "q_orders",
    "definition": {"fn": "ratio", "numerator": {"fn": "count", "where": PAID}, "denominator": {"fn": "count"}},
    "format": {"style": "percent", "decimals": 1},
    "translations": {"ru": {"name": "Доля оплаченных"}},
}
BY_REGION = {"connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}],
             "breakouts": [{"ref": "q_customers.region", "alias": "region"}]}


def test_a_ratio_metric_is_right_in_every_group_and_in_total(env):
    metric = call(env, "admin", "POST", "/api/metrics", json=PAID_SHARE)
    assert metric["definition"]["fn"] == "ratio" and metric["definition"]["denominator"] == {"fn": "count"}
    agg = [{"fn": "metric", "metric": metric["id"]}, {"fn": "count", "alias": "orders"}]

    grouped = query(env, "alice", {**BY_REGION, "aggregations": agg, "order": [{"ref": "region"}]})["result"]
    assert [c["name"] for c in grouped["columns"]] == ["region", "paid_share", "orders"]
    # EU: 2 of 3 orders paid, US: 1 of 2, no region (customer 3 and the order without a customer): 2 of 2
    rows = {r[0]: (round(r[1], 4), r[2]) for r in grouped["rows"]}
    assert rows == {"EU": (0.6667, 3), "US": (0.5, 2), None: (1.0, 2)}
    assert grouped["columns"][1]["format"] == {"style": "percent", "decimals": 1}

    # the total is 5 of 7, not the average of the three shares (0.72)
    total = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": agg})["result"]
    assert round(total["rows"][0][0], 4) == round(5 / 7, 4)

    # sorting and "having" by the ratio's result name
    top = query(env, "alice", {**BY_REGION, "aggregations": agg, "order": [{"ref": "paid_share", "dir": "desc"}],
                               "having": [{"ref": "paid_share", "op": "<", "value": 1}]})["result"]
    assert [r[0] for r in top["rows"]] == ["EU", "US"]


def test_ratio_metrics_in_saved_questions_dashboards_and_multi_source(env):
    metric = call(env, "admin", "POST", "/api/metrics", json=PAID_SHARE)
    spec = {**BY_REGION, "aggregations": [{"fn": "metric", "metric": metric["id"], "alias": "share"}]}
    q = call(env, "alice", "POST", "/api/questions", json={"name": "Paid share by region", "kind": "builder", "spec": spec})
    assert sorted(round(r[1], 2) for r in run(env, "alice", q["id"])["result"]["rows"]) == [0.5, 0.67, 1.0]

    board = call(env, "alice", "POST", "/api/dashboards", json={"name": "Shares"})
    call(env, "alice", "PUT", f"/api/dashboards/{board['id']}", json={
        "cards": [{"key": "a", "kind": "question", "question_id": q["id"], "layout": {"x": 0, "y": 0, "w": 6, "h": 4}}]})
    card = call(env, "alice", "POST", f"/api/dashboards/{board['id']}/cards/a/run", json={"wait_ms": 8000})
    if card["status"] == "running":
        card = wait_done(env["client"], env["alice"], card["task_id"])
    assert sorted(round(r[1], 2) for r in card["result"]["rows"]) == [0.5, 0.67, 1.0]

    # a builder source of a multi-source question expands the metric like any question
    source = {"alias": "s", "type": "builder", "spec": spec}
    data = fed_run(env, "alice", {"sources": [source]})
    assert data["status"] == "completed", data["error"]
    assert sorted(round(r[1], 2) for r in data["result"]["rows"]) == [0.5, 0.67, 1.0]

    # a changed definition applies everywhere: now paid money ÷ all money
    money = {**PAID_SHARE, "definition": {"fn": "ratio", "numerator": {"fn": "sum", "ref": "total", "where": PAID},
                                          "denominator": {"fn": "sum", "ref": "q_orders.total"}}}
    call(env, "admin", "PUT", f"/api/metrics/{metric['id']}", json=money)
    rows = {r[0]: round(r[1], 4) for r in run(env, "alice", q["id"])["result"]["rows"]}
    assert rows == {"EU": round(150 / 225.5, 4), "US": round(200 / 230, 4), None: 1.0}


def test_a_ratio_in_a_question_without_a_saved_metric(env):
    """What the metric editor's live example runs: the definition as an aggregation of the table."""
    ratio = {"fn": "ratio", "numerator": {"fn": "sum", "ref": "qty"}, "denominator": {"fn": "count"}, "alias": "value"}
    out = query(env, "alice", {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [ratio]})
    assert out["result"]["rows"] == [[19 / 7]]  # integers, divided as numbers: 2.71, not 2


def test_ratio_definitions_are_checked(env):
    def refused(definition, status=422):
        return call(env, "admin", "POST", "/api/metrics", status, json={**PAID_SHARE, "definition": definition})

    refused({"fn": "ratio", "numerator": {"fn": "count"}})  # no denominator
    refused({"fn": "ratio", "ref": "total", "numerator": {"fn": "count"}, "denominator": {"fn": "count"}})
    refused({"fn": "ratio", "numerator": {"fn": "metric"}, "denominator": {"fn": "count"}})
    refused({"fn": "ratio", "numerator": {"fn": "count"}, "denominator": {"fn": "ratio"}})
    refused({"fn": "sum", "ref": "total", "numerator": {"fn": "count"}})  # parts without fn "ratio"
    refused({"fn": "ratio", "numerator": {"fn": "sum"}, "denominator": {"fn": "count"}})  # sum of what?
    detail = refused({"fn": "ratio", "numerator": {"fn": "sum", "ref": "status"}, "denominator": {"fn": "count"}}, 400)
    assert "number" in detail["detail"]
    assert call(env, "admin", "GET", "/api/metrics")["metrics"] == []
    # the same rules for a ratio written straight into a question
    bad = {"fn": "ratio", "numerator": {"fn": "count"}, "alias": "x"}
    call(env, "alice", "POST", "/api/query", 422,
         json={"spec": {"connection": "shop", "source": {"table": "q_orders"}, "aggregations": [bad]}})
