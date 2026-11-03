"""Excel export of a result shown as a pivot table (M12): the layout, totals and number formats are kept."""

import datetime as dt
import io
import json

import openpyxl  # test-only reader

from app.query.xlsx import PivotLayout, number_format, write_pivot
from app.results import ResultColumn, ResultEnvelope, ResultStats

from .test_query_api import env, post  # noqa: F401  (env is a fixture)
from .test_sharing_api import anon, enable, public_link, run_public
from .test_sharing_api import env as sharing_env  # noqa: F401
from .test_library_api import save_builder

BY_REGION_STATUS = {
    "connection": "shop", "source": {"table": "q_orders"}, "joins": [{"table": "q_customers"}],
    "breakouts": [{"ref": "q_customers.region", "alias": "region"}, {"ref": "q_orders.status", "alias": "status"}],
    "aggregations": [{"fn": "sum", "ref": "q_orders.total", "alias": "revenue"}, {"fn": "count", "alias": "orders"}],
}
LAYOUT = {
    "rows": ["region"], "columns": ["status"],
    "values": [{"column": "revenue", "agg": "sum", "label": "Sum of Revenue", "format": {"style": "currency", "currency": "EUR"}}],
    "totals": True, "titles": {"region": "Region", "status": "Status"},
    "texts": {"total": "Total", "empty": "(empty)"}, "lang": "en",
}


def _sheet(content: bytes):
    return openpyxl.load_workbook(io.BytesIO(content)).active


def _grid(sheet) -> list[tuple]:
    return [tuple(c for c in row) for row in sheet.iter_rows(values_only=True)]


def test_a_pivot_is_written_as_the_pivot_with_totals_and_formats(env):
    client, _, alice, _ = env
    task = post(client, alice, "/api/query", {"spec": BY_REGION_STATUS})
    res = client.get(f"/api/query/tasks/{task['task_id']}/export.xlsx", headers=alice, params={"pivot": json.dumps(LAYOUT)})
    assert res.status_code == 200, res.text
    sheet = _sheet(res.content)
    rows = _grid(sheet)
    # header: the value's name and the column field's name, then the statuses (as they first appear) and Total
    assert rows[0] == ("Sum of Revenue", "Status", None, None, None)
    assert rows[1] == ("Region", "paid", "(empty)", "refunded", "Total")
    assert "B1:D1" in {str(r) for r in sheet.merged_cells.ranges}
    body = {r[0]: r[1:] for r in rows[2:]}
    # regions: no region (customer 3 and the order without a customer), EU, US - all paid / refunded / no status
    assert list(body) == ["(empty)", "EU", "US", "Total"]
    assert body["(empty)"] == (10.0, None, None, 10.0)
    assert body["EU"] == (150.0, 75.5, None, 225.5)
    assert body["US"] == (200.0, None, 30.0, 230.0)
    assert body["Total"] == (360.0, 75.5, 30.0, 465.5)
    assert sheet["B3"].number_format.endswith('"€"') and "#,##0.00" in sheet["B3"].number_format
    assert sheet["E6"].font.bold  # the grand total
    assert sheet.freeze_panes == "B3"


def test_two_values_dates_as_dates_and_no_totals(env):
    client, _, alice, _ = env
    spec = {"connection": "shop", "source": {"table": "q_orders"},
            "breakouts": [{"ref": "created_at", "bucket": "month", "alias": "month"}, {"ref": "status", "alias": "status"}],
            "aggregations": [{"fn": "sum", "ref": "qty", "alias": "pieces"}, {"fn": "count", "alias": "orders"}],
            "filters": {"op": "and", "rules": [{"ref": "status", "op": "=", "value": "paid"}]}}
    task = post(client, alice, "/api/query", {"spec": spec})
    layout = {"rows": ["month"], "columns": ["status"], "totals": False, "dates": {"month": "month"},
              "values": [{"column": "pieces", "agg": "sum", "label": "Sum of pieces"},
                         {"column": "orders", "agg": "sum", "label": "Sum of orders", "format": {"style": "number", "decimals": 1}}]}
    res = client.get(f"/api/query/tasks/{task['task_id']}/export.xlsx", headers=alice, params={"pivot": json.dumps(layout)})
    sheet = _sheet(res.content)
    rows = _grid(sheet)
    assert rows[0][:2] == (None, "status") and rows[1][:3] == (None, "paid", None)
    assert rows[2] == ("month", "Sum of pieces", "Sum of orders")
    assert rows[3] == (dt.datetime(2025, 12, 1), None, 1)  # order 7 has no quantity
    assert rows[4] == (dt.datetime(2026, 1, 1), 13, 2)
    assert sheet["A4"].number_format == "mmm yyyy" and sheet["C4"].number_format == "#,##0.0"
    assert len(rows) == 3 + 4  # Dec, Jan, Feb, Apr; no total row


def test_a_ratio_metric_keeps_its_percent_format_in_the_pivot(env):
    client, _, alice, admin = env
    paid = {"op": "and", "rules": [{"ref": "q_orders.status", "op": "=", "value": "paid"}]}
    metric = client.post("/api/metrics", headers=admin, json={
        "name": "Paid share", "connection": "shop", "table": "q_orders", "format": {"style": "percent", "decimals": 1},
        "definition": {"fn": "ratio", "numerator": {"fn": "count", "where": paid}, "denominator": {"fn": "count"}}}).json()
    spec = {**BY_REGION_STATUS, "breakouts": BY_REGION_STATUS["breakouts"][:1],
            "aggregations": [{"fn": "metric", "metric": metric["id"], "alias": "share"}]}
    task = post(client, alice, "/api/query", {"spec": spec})
    fmt = task["result"]["columns"][1]["format"]
    layout = {"rows": ["region"], "columns": [], "values": [{"column": "share", "agg": "avg", "label": "Paid share", "format": fmt}]}
    sheet = _sheet(client.get(f"/api/query/tasks/{task['task_id']}/export.xlsx", headers=alice, params={"pivot": json.dumps(layout)}).content)
    rows = _grid(sheet)
    assert rows[0] == ("region", "Paid share")
    assert {r[0]: round(r[1], 4) for r in rows[1:-1]} == {"(empty)": 1.0, "EU": 0.6667, "US": 0.5}
    assert sheet["B2"].number_format == "0.0%"


def test_without_a_layout_the_rows_are_written_as_they_are_and_a_bad_layout_is_refused(env):
    client, _, alice, _ = env
    task = post(client, alice, "/api/query", {"spec": BY_REGION_STATUS})
    plain = _grid(_sheet(client.get(f"/api/query/tasks/{task['task_id']}/export.xlsx", headers=alice).content))
    assert plain[0] == ("region", "status", "revenue", "orders")
    bad = client.get(f"/api/query/tasks/{task['task_id']}/export.xlsx", headers=alice, params={"pivot": '{"values": []}'})
    assert bad.status_code == 400 and "pivot" in bad.json()["detail"]
    ru = client.get(f"/api/query/tasks/{task['task_id']}/export.xlsx", params={"pivot": "not json"},
                    headers={**alice, "Accept-Language": "ru"})
    assert ru.status_code == 400 and "сводной" in ru.json()["detail"]


def test_a_public_link_exports_the_pivot_too(sharing_env):
    enable(sharing_env)
    q = save_builder(sharing_env, "admin", spec=BY_REGION_STATUS)
    link = public_link(sharing_env, "question", q["id"], allow_download=True)
    snap = run_public(sharing_env, f"/api/public/{link['token']}", "/run", {})
    res = anon(sharing_env, "GET", f"/api/public/{link['token']}/tasks/{snap['task_id']}/export.xlsx", params={"pivot": json.dumps(LAYOUT)})
    assert _grid(_sheet(res.content))[1] == ("Region", "paid", "(empty)", "refunded", "Total")


def test_layout_rules_without_a_server():
    """No row fields: one row; no column fields: no total column; nested rows: the outer label once."""
    cols = [ResultColumn(name="line", type="string", role="dimension"), ResultColumn(name="shift", type="string", role="dimension"),
            ResultColumn(name="n", type="number", role="measure")]
    result = ResultEnvelope(columns=cols, stats=ResultStats(duration_ms=1, row_count=4), rows=[
        ["Paint", "Day", 5], ["Press", "Day", 2], ["Paint", "Night", 7], ["Press", "Night", "1"]])

    def grid(**layout):
        buf = io.BytesIO()
        write_pivot(result, buf, PivotLayout.model_validate({"values": [{"column": "n", "agg": "sum", "label": "N"}], **layout}))
        return _grid(_sheet(buf.getvalue()))

    assert grid(columns=["line"]) == [("N", "line", None, None), (None, "Paint", "Press", "Total"), ("Total", 12, 3, 15)]
    assert grid(rows=["line", "shift"]) == [
        ("line", "shift", "N"), ("Paint", "Day", 5), (None, "Night", 7), ("Press", "Day", 2), (None, "Night", 1), ("Total", None, 15)]


def test_number_formats_follow_the_screen():
    assert number_format({}, True) == "#,##0"
    assert number_format({}, False) == "#,##0.00"
    assert number_format({"style": "percent"}, False) == "0.0%"
    assert number_format({"style": "percent", "decimals": 2}, False) == "0.00%"
    assert number_format({"style": "currency", "currency": "USD"}, False) == '"$"#,##0.00'
    assert number_format({"style": "currency", "currency": "CHF", "decimals": 0}, True) == '#,##0 "CHF"'
    assert number_format({"style": "plain"}, True) == "0"
    assert number_format({"decimals": 1, "prefix": "≈ ", "suffix": ' "pcs"'}, True) == '"≈ "#,##0.0" pcs"'


def test_the_same_grid_as_the_screen():
    """The fixture of frontend/tests/pivot.test.ts ('rows × columns with totals'): the same cells here."""
    cols = [ResultColumn(name="Week", type="string", role="dimension"), ResultColumn(name="Line", type="string", role="dimension"),
            ResultColumn(name="Scrapped", type="number", role="measure")]
    rows = [["2026-09-07", "Paint", 5], ["2026-09-07", "Press", 2], ["2026-09-14", "Paint", 7], ["2026-09-14", "Press", 1],
            ["2026-09-14", "Weld", 4]]
    result = ResultEnvelope(columns=cols, rows=rows, stats=ResultStats(duration_ms=1, row_count=5))
    buf = io.BytesIO()
    write_pivot(result, buf, PivotLayout.model_validate({
        "rows": ["Week"], "columns": ["Line"], "values": [{"column": "Scrapped", "agg": "sum", "label": "Sum of Scrapped pieces"}]}))
    assert _grid(_sheet(buf.getvalue())) == [
        ("Sum of Scrapped pieces", "Line", None, None, None),
        ("Week", "Paint", "Press", "Weld", "Total"),
        ("2026-09-07", 5, 2, None, 7),
        ("2026-09-14", 7, 1, 4, 12),
        ("Total", 12, 3, 4, 19),
    ]
