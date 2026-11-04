"""The Factory demo brings examples to start from (M11): a shared collection, questions, a dashboard."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.api import create_app
from app.appdb import AppDB
from app.config import Settings
from app.crypto import Cipher, generate_key
from app.security import hash_password

from .helpers import auth
from .test_query_api import wait_done


def _client(tmp_path, **settings):
    app_db = AppDB(tmp_path / "data" / "app.sqlite", cipher=Cipher(generate_key()))
    if not app_db.user_count():
        app_db.create_user("admin", hash_password("admin-pass-1"), "admin")
        app_db.create_user("carol", hash_password("carol-pass-1"))
    return TestClient(create_app(Settings(demo_enabled=True, search_workers=2, query_workers=4, **settings), {}, app_db))


def test_examples_are_made_once_shared_and_start_here(tmp_path):
    with _client(tmp_path) as client:
        carol = auth(client, "carol", "carol-pass-1")
        home = client.get("/api/home", headers=carol).json()
        start = home["start_here"]
        assert start is not None and start["name"] == "Factory demo"
        boards = client.get("/api/dashboards", headers=carol).json()["dashboards"]
        assert [d["name"] for d in boards] == ["Production overview"]
        board = client.get(f"/api/dashboards/{boards[0]['id']}", headers=carol).json()
        assert {f["id"] for f in board["filters"]} == {"period", "line"}
        charts = {c["key"]: c["question"]["viz"] for c in board["cards"] if c["kind"] == "question"}
        assert charts["downtime"]["mode"] == "chart" and charts["downtime"]["spec"]["horizontal"] is True
        assert charts["vehicles"] == {"mode": "table", "spec": None}
        for card in [c for c in board["cards"] if c["kind"] == "question"]:  # every example runs for a normal user
            res = client.post(f"/api/dashboards/{board['id']}/cards/{card['key']}/run", headers=carol,
                              json={"filters": {"line": ["Final assembly"]}, "wait_ms": 5000}).json()
            if res["status"] == "running":
                res = wait_done(client, carol, res["task_id"])
            assert res["status"] == "completed", (card["key"], res.get("error"))
            assert res["result"]["rows"], card["key"]
        admin = auth(client, "admin", "admin-pass-1")
        client.delete(f"/api/dashboards/{boards[0]['id']}", headers=admin)  # an admin tidies up ...
    with _client(tmp_path) as client:  # ... and a restart does not bring the examples back twice
        carol = auth(client, "carol", "carol-pass-1")
        assert len(client.get("/api/questions", params={"q": "per week"}, headers=carol).json()["questions"]) == 1


def test_russian_names(tmp_path):
    with _client(tmp_path, demo_language="ru") as client:
        carol = auth(client, "carol", "carol-pass-1")
        assert client.get("/api/home", headers=carol).json()["start_here"]["name"] == "Демо: завод"


def test_the_scrap_rate_example_uses_the_ratio_metric(tmp_path):
    """M12: "Scrap rate per line" on the dashboard, a true ratio (all scrap ÷ all pieces), shown as percent."""
    with _client(tmp_path) as client:
        carol = auth(client, "carol", "carol-pass-1")
        board_id = client.get("/api/dashboards", headers=carol).json()["dashboards"][0]["id"]
        board = client.get(f"/api/dashboards/{board_id}", headers=carol).json()
        card = next(c for c in board["cards"] if c.get("key") == "rate")
        assert card["question"]["name"] == "Scrap rate per line"
        assert card["question"]["viz"]["spec"]["type"] == "bar"
        res = client.post(f"/api/dashboards/{board_id}/cards/rate/run", headers=carol, json={"wait_ms": 5000}).json()
        if res["status"] == "running":
            res = wait_done(client, carol, res["task_id"])
        result = res["result"]
        assert [c["name"] for c in result["columns"]] == ["Line", "Scrap rate"]
        assert result["columns"][1]["format"]["style"] == "percent"
        rates = dict(result["rows"])
        assert max(rates, key=rates.get) == "Paint line" and all(0 < v < 0.2 for v in rates.values())


def test_number_cards_compare_weeks_and_the_scrap_rate_has_a_target(tmp_path):
    """M15: the dashboard's number cards are grouped by week (the card compares the last full week
    with the week before); the scrap rate card says lower is better and has a 2 % target."""
    with _client(tmp_path) as client:
        carol = auth(client, "carol", "carol-pass-1")
        board_id = client.get("/api/dashboards", headers=carol).json()["dashboards"][0]["id"]
        board = client.get(f"/api/dashboards/{board_id}", headers=carol).json()
        cards = {c["key"]: c for c in board["cards"]}
        orders, scrap = cards["orders"]["question"]["viz"]["spec"], cards["scrap_kpi"]["question"]["viz"]["spec"]
        assert orders["type"] == scrap["type"] == "kpi"
        assert orders["x"] == "Week" and orders["kpi"]["upIsGood"] is True
        assert scrap["kpi"] == {"compare": True, "sparkline": True, "upIsGood": False, "target": 0.02}
        # side by side above the weekly chart, so a phone shows them two per row
        assert (cards["orders"]["layout"]["y"], cards["scrap_kpi"]["layout"]["y"]) == (2, 2)
        for key in ("orders", "scrap_kpi"):
            res = client.post(f"/api/dashboards/{board_id}/cards/{key}/run", headers=carol, json={"wait_ms": 5000}).json()
            if res["status"] == "running":
                res = wait_done(client, carol, res["task_id"])
            cols = res["result"]["columns"]
            assert cols[0]["name"] == "Week" and cols[0]["type"] == "date", key
            assert len(res["result"]["rows"]) > 40, key  # a year of weeks for the trend line
        rates = [r[1] for r in res["result"]["rows"]]
        assert cols[1]["format"]["style"] == "percent" and all(0 <= v < 0.1 for v in rates)
