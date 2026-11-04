"""Dashboard templates for manufacturing (M15): mapped once, then ordinary questions and a dashboard."""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import DateTime, Integer, String

from app.api import create_app
from app.appdb import AppDB
from app.config import ConnectionConfig, Settings
from app.crypto import Cipher, generate_key
from app.demo import DOWNTIME_REASONS
from app.security import hash_password
from app.templates_mfg import BY_ID, MappingError, load_schema, plan, suggest

from .helpers import auth
from .test_query_api import wait_done

TEMPLATES = ["downtime_pareto", "scrap_shift_line", "output_vs_plan", "oee_overview"]


def _shop(path):
    """A plant database without foreign keys or a data model: one table per day and line, one of stops."""
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE daily_output (id INTEGER PRIMARY KEY, prod_day DATE, line TEXT, good_qty INTEGER, scrap_qty INTEGER, plan_qty INTEGER);
        CREATE TABLE line_stops (id INTEGER PRIMARY KEY, started_at DATETIME, line TEXT, duration_min INTEGER, cause TEXT, note TEXT);
    """)
    con.executemany("INSERT INTO daily_output VALUES (?, ?, ?, ?, ?, ?)", [
        (1, "2026-10-01", "A", 90, 10, 100), (2, "2026-10-01", "B", 40, 0, 50), (3, "2026-10-02", "A", 110, 0, 100),
    ])
    con.executemany("INSERT INTO line_stops VALUES (?, ?, ?, ?, ?, ?)", [
        (1, "2026-10-01 08:00:00", "A", 30, "Jam", None), (2, "2026-10-01 09:00:00", "A", 10, "Tool", None),
        (3, "2026-10-02 10:00:00", "B", 45, "Jam", "x"),
    ])
    con.commit()
    con.close()


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("templates")
    _shop(tmp / "shop.sqlite")
    app_db = AppDB(tmp / "data" / "app.sqlite", cipher=Cipher(generate_key()))
    app_db.create_user("admin", hash_password("admin-pass-1"), "admin")
    app_db.create_user("carol", hash_password("carol-pass-1"))
    app_db.create_user("dave", hash_password("dave-pass-1"))
    shop = ConnectionConfig(key="shop", label="Shop", engine="sqlite", database=str(tmp / "shop.sqlite"))
    with TestClient(create_app(Settings(demo_enabled=True, search_workers=2, query_workers=4), {"shop": shop}, app_db)) as c:
        yield c


def _done(client, headers, task):
    return wait_done(client, headers, task["task_id"]) if task["status"] == "running" else task


def _suggest(client, headers, tid, connection="demo", mapping=None, language="en"):
    res = client.post(f"/api/templates/{tid}/suggest", headers=headers,
                      json={"connection": connection, "mapping": mapping or {}, "language": language})
    assert res.status_code == 200, res.text
    return res.json()


def test_the_templates_and_their_roles_in_plain_words(client):
    carol = auth(client, "carol", "carol-pass-1")
    found = client.get("/api/templates", headers=carol).json()["templates"]
    assert [t["id"] for t in found] == TEMPLATES
    pareto = found[0]
    assert pareto["name"] == "Downtime Pareto"
    asks = {r["key"]: r["ask"] for r in pareto["roles"]}
    assert asks["events"] == "Which table holds the downtime events?"
    assert asks["minutes"] == "Which column is the duration in minutes?"
    ru = client.get("/api/templates", params={"language": "ru"}, headers=carol).json()["templates"]
    assert ru[0]["name"] == "Парето простоев" and ru[0]["roles"][0]["ask"] == "В какой таблице простои?"


@pytest.mark.parametrize("tid", TEMPLATES)
def test_each_template_maps_onto_the_demo_by_itself_and_every_card_runs(client, tid):
    carol = auth(client, "carol", "carol-pass-1")
    s = _suggest(client, carol, tid)
    assert s["complete"], s
    t = BY_ID[tid]
    assert set(s["mapping"]) == {r.key for r in t.roles}  # every part found, nothing left to answer
    assert s["options"][t.roles[0].key][0]["value"] == s["mapping"][t.roles[0].key]  # the suggestion comes first
    preview = client.post(f"/api/templates/{tid}/preview", headers=carol,
                          json={"connection": "demo", "mapping": s["mapping"], "wait_ms": 5000}).json()
    assert preview["missing"] == []
    task = _done(client, carol, preview["preview"]["task"])
    assert task["status"] == "completed" and task["result"]["rows"], task.get("error")
    made = client.post(f"/api/templates/{tid}/create", headers=carol, json={"connection": "demo", "mapping": s["mapping"]}).json()
    board = client.get(f"/api/dashboards/{made['dashboard']['id']}", headers=carol).json()
    assert board["name"] == t.name[0]
    personal = client.get("/api/collections", headers=carol).json()["personal_id"]
    assert board["collection_id"] == personal  # the person's own collection by default
    cards = [c for c in board["cards"] if c["kind"] == "question"]
    assert len(cards) >= 4
    for card in cards:
        res = client.post(f"/api/dashboards/{board['id']}/cards/{card['key']}/run", headers=carol,
                          json={"filters": {"line": ["Paint line"], "period": ["2026-01-01", "2026-12-31"]}, "wait_ms": 8000}).json()
        res = _done(client, carol, res)
        assert res["status"] == "completed", (card["key"], res.get("error"))
        assert res["result"]["rows"], card["key"]
        assert card["mappings"]["period"]  # the period filter reaches every card


def test_downtime_pareto_shows_the_top_reasons_with_their_names(client):
    carol = auth(client, "carol", "carol-pass-1")
    s = _suggest(client, carol, "downtime_pareto")
    assert s["mapping"]["reason"] == "downtime_reasons.name"  # the name, not the id or the code
    assert s["mapping"]["line"] == "production_lines.name"
    made = client.post("/api/templates/downtime_pareto/create", headers=carol, json={"connection": "demo", "mapping": s["mapping"]}).json()
    res = _done(client, carol, client.post(f"/api/dashboards/{made['dashboard']['id']}/cards/pareto/run", headers=carol,
                                           json={"wait_ms": 5000}).json())
    rows = res["result"]["rows"]
    assert len(rows) == 10 and {r[0] for r in rows} <= {name for _c, name, *_rest in DOWNTIME_REASONS}  # names, not ids
    assert [r[1] for r in rows] == sorted((r[1] for r in rows), reverse=True)


def test_rates_are_true_ratios(client):
    """Scrap rate = all scrap ÷ all pieces (M12 ratio); % of plan = all good ÷ all planned over two tables."""
    carol = auth(client, "carol", "carol-pass-1")
    s = _suggest(client, carol, "scrap_shift_line")
    made = client.post("/api/templates/scrap_shift_line/create", headers=carol, json={"connection": "demo", "mapping": s["mapping"]}).json()
    q = client.get(f"/api/dashboards/{made['dashboard']['id']}", headers=carol).json()
    rate = next(c for c in q["cards"] if c["key"] == "rate_line")
    assert rate["question"]["spec"]["aggregations"][0]["fn"] == "ratio"
    res = _done(client, carol, client.post(f"/api/dashboards/{q['id']}/cards/rate_line/run", headers=carol, json={"wait_ms": 5000}).json())
    rates = dict(res["result"]["rows"])
    assert max(rates, key=rates.get) == "Paint line" and all(0 < v < 0.2 for v in rates.values())
    s = _suggest(client, carol, "output_vs_plan")
    assert (s["mapping"]["output"], s["mapping"]["plan"]) == ("production_output", "work_orders")
    made = client.post("/api/templates/output_vs_plan/create", headers=carol, json={"connection": "demo", "mapping": s["mapping"]}).json()
    pct = _done(client, carol, client.post(f"/api/dashboards/{made['dashboard']['id']}/cards/pct/run", headers=carol, json={"wait_ms": 8000}).json())
    good, planned, share = pct["result"]["rows"][0]
    assert share == pytest.approx(good / planned) and 0.8 < share < 1.1


def test_russian_names(client):
    carol = auth(client, "carol", "carol-pass-1")
    s = _suggest(client, carol, "downtime_pareto", language="ru")
    made = client.post("/api/templates/downtime_pareto/create", headers=carol,
                       json={"connection": "demo", "mapping": s["mapping"], "language": "ru"}).json()
    board = client.get(f"/api/dashboards/{made['dashboard']['id']}", headers=carol).json()
    assert board["name"] == "Парето простоев"
    assert {f["label"] for f in board["filters"]} == {"Период", "Линия"}
    names = {c["question"]["name"] for c in board["cards"] if c["kind"] == "question"}
    assert "Простои по причинам (топ-10)" in names


def test_missing_parts_are_reported_in_plain_words(client):
    carol = auth(client, "carol", "carol-pass-1")
    s = _suggest(client, carol, "downtime_pareto", mapping={"line": None})  # "not in my data"
    assert "line" not in s["mapping"] and s["complete"]
    p = client.post("/api/templates/downtime_pareto/preview", headers=carol,
                    json={"connection": "demo", "mapping": s["mapping"]}).json()
    assert p["missing"] == [{"name": "Downtime by line", "reason": "needs a line column"}]
    assert "by_line" not in [c["key"] for c in p["cards"]]
    # a required part left out: the question still to answer
    partial = {k: v for k, v in s["mapping"].items() if k != "minutes"}
    res = client.post("/api/templates/downtime_pareto/preview", headers=carol, json={"connection": "demo", "mapping": partial})
    assert res.status_code == 400 and res.json()["detail"] == "Still to answer: Which column is the duration in minutes?"
    # a text column where minutes are needed
    wrong = {**s["mapping"], "minutes": "downtime_events.comment"}
    res = client.post("/api/templates/downtime_pareto/create", headers=carol, json={"connection": "demo", "mapping": wrong})
    assert res.status_code == 400 and "not numbers" in res.json()["detail"]
    # a column of an unrelated table
    res = client.post("/api/templates/downtime_pareto/preview", headers=carol,
                      json={"connection": "demo", "mapping": {**s["mapping"], "reason": "scrap_reasons.name"}})
    assert res.status_code == 400 and "not in the table downtime_events" in res.json()["detail"]


def test_oee_says_which_parts_are_missing(client):
    carol = auth(client, "carol", "carol-pass-1")
    s = _suggest(client, carol, "oee_overview", mapping={"rate": None, "events": None})
    p = client.post("/api/templates/oee_overview/preview", headers=carol,
                    json={"connection": "demo", "mapping": s["mapping"], "wait_ms": 5000}).json()
    missing = {m["name"]: m["reason"] for m in p["missing"]}
    assert set(missing) >= {"OEE", "Availability", "Performance"}
    assert "rated speed" in missing["OEE"] and "downtime table" in missing["Availability"]
    assert [c["title"] for c in p["cards"]][:1] == ["Quality"]
    made = client.post("/api/templates/oee_overview/create", headers=carol, json={"connection": "demo", "mapping": s["mapping"]}).json()
    board = client.get(f"/api/dashboards/{made['dashboard']['id']}", headers=carol).json()
    intro = next(c for c in board["cards"] if c["key"] == "intro")
    assert "Not shown" in intro["text"] and "rated speed" in intro["text"]  # said on the dashboard too
    res = _done(client, carol, client.post(f"/api/dashboards/{board['id']}/cards/week/run", headers=carol, json={"wait_ms": 5000}).json())
    assert [c["name"] for c in res["result"]["columns"]] == ["Week", "Quality"]


def test_items_follow_the_collection_permissions(client):
    admin, carol, dave = (auth(client, u, f"{u}-pass-1") for u in ("admin", "carol", "dave"))
    team = client.post("/api/collections", headers=admin, json={"name": "Plant"}).json()
    client.put(f"/api/collections/{team['id']}/permissions", headers=admin,
               json={"grants": [{"user": "carol", "level": "view"}, {"user": "dave", "level": "edit"}]})
    s = _suggest(client, carol, "scrap_shift_line")
    body = {"connection": "demo", "mapping": s["mapping"], "collection_id": team["id"]}
    assert client.post("/api/templates/scrap_shift_line/create", headers=carol, json=body).status_code == 403
    made = client.post("/api/templates/scrap_shift_line/create", headers=dave, json={**body, "name": "Scrap, hall B"}).json()
    board = client.get(f"/api/dashboards/{made['dashboard']['id']}", headers=carol).json()
    assert board["name"] == "Scrap, hall B" and board["access"] == "view"  # carol reads it, as the collection says
    for qid in made["questions"]:
        q = client.get(f"/api/questions/{qid}", headers=carol).json()
        assert q["collection_id"] == team["id"] and q["access"] == "view"


def test_a_database_without_a_data_model_maps_from_column_names(client):
    """No foreign keys, no display names: the names alone; plan and output in one table make one question."""
    admin = auth(client, "admin", "admin-pass-1")
    s = _suggest(client, admin, "output_vs_plan", connection="shop")
    assert s["complete"], s
    m = s["mapping"]
    assert (m["output"], m["plan"], m["good"], m["planned"], m["date"]) == (
        "daily_output", "daily_output", "daily_output.good_qty", "daily_output.plan_qty", "daily_output.prod_day")
    made = client.post("/api/templates/output_vs_plan/create", headers=admin, json={"connection": "shop", "mapping": m}).json()
    board = client.get(f"/api/dashboards/{made['dashboard']['id']}", headers=admin).json()
    by_line = next(c for c in board["cards"] if c["key"] == "by_line")
    assert by_line["question"]["kind"] == "builder"
    res = _done(client, admin, client.post(f"/api/dashboards/{board['id']}/cards/by_line/run", headers=admin, json={"wait_ms": 5000}).json())
    assert res["result"]["rows"] == [["B", 40, 50, 0.8], ["A", 200, 200, 1.0]]
    s = _suggest(client, admin, "downtime_pareto", connection="shop")
    assert {k: s["mapping"].get(k) for k in ("events", "minutes", "reason", "date", "line")} == {
        "events": "line_stops", "minutes": "line_stops.duration_min", "reason": "line_stops.cause",
        "date": "line_stops.started_at", "line": "line_stops.line"}


def test_russian_display_names_guide_the_suggestions():
    """Columns named only in Russian in the data model (an MES with transliterated names)."""
    columns = {
        "prostoi": [{"name": "id", "type": Integer()}, {"name": "nachalo", "type": DateTime()}, {"name": "dlit", "type": Integer()},
                    {"name": "kolvo", "type": Integer()}, {"name": "prichina", "type": String()}, {"name": "uchastok", "type": String()}],
        "spravka": [{"name": "id", "type": Integer()}, {"name": "tekst", "type": String()}],
    }
    ru = lambda name: {"translations": {"ru": {"display_name": name}}}  # noqa: E731
    fields = {"prostoi": {"dlit": ru("Длительность, мин"), "kolvo": ru("Количество"), "prichina": ru("Причина"),
                          "uchastok": ru("Участок"), "nachalo": ru("Начало простоя")}}
    tables = {"prostoi": ru("Простои")}
    schema = load_schema("x", columns, {"prostoi": ["id"], "spravka": ["id"]}, {}, fields, tables)
    mapping, _filled = suggest(BY_ID["downtime_pareto"], schema, {})
    assert mapping == {"events": "prostoi", "minutes": "prostoi.dlit", "reason": "prostoi.prichina",
                       "date": "prostoi.nachalo", "line": "prostoi.uchastok"}
    p = plan(BY_ID["downtime_pareto"], schema, mapping, "ru")
    assert p.name == "Парето простоев" and "by_line" in p.ctx.questions
    with pytest.raises(MappingError, match="Осталось ответить"):
        plan(BY_ID["downtime_pareto"], schema, {"events": "prostoi"}, "ru")
