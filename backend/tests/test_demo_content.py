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
