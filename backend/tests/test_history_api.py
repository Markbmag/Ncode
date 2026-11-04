"""History of questions and dashboards (M15): every save keeps a version; versions can be
opened, run and restored."""

import json

import pytest
from sqlalchemy import select, update

from app.content.history import dashboard_changes, describe, question_changes
from app.content.tables import content_versions_table, questions_table
from app.security import hash_password

from .helpers import auth
from .test_dashboards_api import COUNT_ORDERS, card, new_dashboard, put
from .test_library_api import REVENUE, call, library_env, save_builder, save_sql, share
from .test_query_api import make_client, wait_done


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def versions(env, who, kind, item_id, status=200):
    return call(env, who, "GET", f"/api/{kind}/{item_id}/versions", status)


def summaries(env, kind, item_id, who="alice"):
    return [(v["version"], v["summary"]) for v in versions(env, who, kind, item_id)["versions"]]


# ---------------------------------------------------------------- summaries in plain words

def test_summaries_in_plain_words_in_english_and_russian():
    before = {"name": "Q", "description": None, "kind": "builder", "connection": "shop", "spec": REVENUE, "viz": None, "parameters": []}
    after = {**before, "spec": {**REVENUE, "filters": None}, "viz": {"mode": "table"}}
    changes = question_changes(before, after)
    assert changes == [["changed", ["filters", "chart"]]]
    assert describe(changes, "en") == "Changed the filters and the chart"
    assert describe(changes, "ru") == "Изменили фильтры и график"
    renamed = question_changes(before, {**before, "name": "R", "spec": {**REVENUE, "order": [], "limit": 5}})
    assert describe(renamed, "en") == "Renamed, changed the sorting and the row limit"
    sql = {**before, "kind": "sql", "spec": {"sql": "SELECT 1"}}
    assert describe(question_changes(sql, {**sql, "spec": {"sql": "SELECT 2"}}), "en") == "Changed the SQL"

    board = {"name": "D", "description": None, "filters": [], "tabs": [], "settings": {}, "cards": [
        card("a", kind="text", text="x"), card("b", 1),
    ]}
    two_more = {**board, "cards": board["cards"] + [card("c", 2), card("d", 3)]}
    assert describe(dashboard_changes(board, two_more), "en") == "Added 2 cards"
    assert describe(dashboard_changes(board, two_more), "ru") == "Добавили 2 карточки"
    five = {**board, "cards": board["cards"] + [card(k, 1) for k in "cdefg"]}
    assert describe(dashboard_changes(five, board), "ru") == "Убрали 5 карточек"
    moved = {**board, "filters": [{"id": "f", "label": "F", "type": "text"}],
             "cards": [card("a", kind="text", text="y", y=3), card("b", 1, viz={"mode": "table"})]}
    assert describe(dashboard_changes(board, moved), "en") == "Changed the filters, the layout, the texts and the card settings"
    assert describe(dashboard_changes(board, {**board, "cards": board["cards"][:1]}), "en") == "Removed 1 card"
    assert describe([["restored", 3]], "ru") == "Восстановили версию 3"
    assert describe("written by hand") == "written by hand"


# ---------------------------------------------------------------- questions

def test_every_save_of_a_question_keeps_a_version(env):
    q = save_builder(env, "alice")
    assert summaries(env, "questions", q["id"]) == [(1, "Created")]
    changed = {**REVENUE, "filters": {"rules": [{"ref": "q_orders.status", "op": "=", "value": "open"}]}}
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"kind": "builder", "spec": changed, "viz": {"mode": "table"}})
    # moving, archiving and saving the same again are not new versions
    full = call(env, "alice", "GET", f"/api/questions/{q['id']}")
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"kind": "builder", "spec": full["spec"], "viz": full["viz"]})
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": False})
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"name": "Open revenue", "description": "Open orders"})
    listed = versions(env, "alice", "questions", q["id"])
    assert listed["keep"] == 50
    assert [(v["version"], v["summary"], v["saved_by"], v["current"]) for v in listed["versions"]] == [
        (3, "Renamed, changed the description", "alice", True),
        (2, "Changed the filters and the chart", "alice", False),
        (1, "Created", "alice", False),
    ]
    first = call(env, "alice", "GET", f"/api/questions/{q['id']}/versions/1")
    assert first["data"]["spec"]["filters"]["rules"][0]["value"] == "paid"
    assert first["data"]["name"] == "Revenue by region" and first["data"]["viz"] == {"mode": "chart", "spec": {"type": "bar"}}
    assert first["saved_at"] > 0 and first["current"] is False
    call(env, "alice", "GET", f"/api/questions/{q['id']}/versions/9", 404)
    ru = env["client"].get(f"/api/questions/{q['id']}/versions", headers={**env["alice"], "Accept-Language": "ru"}).json()
    assert ru["versions"][1]["summary"] == "Изменили фильтры и график"
    missing = env["client"].get(f"/api/questions/{q['id']}/versions/9", headers={**env["alice"], "Accept-Language": "ru"})
    assert missing.json()["detail"] == "Версия не найдена"


def test_a_version_can_be_run_without_restoring_it(env):
    s = save_sql(env, "alice", "SELECT COUNT(*) AS n FROM q_orders")
    call(env, "alice", "PATCH", f"/api/questions/{s['id']}", json={"spec": {"sql": "SELECT 42 AS n"}})
    data = call(env, "alice", "POST", f"/api/questions/{s['id']}/versions/1/run", json={"wait_ms": 5000})
    if data["status"] == "running":
        data = wait_done(env["client"], env["alice"], data["task_id"])
    assert data["result"]["rows"][0][0] != 42
    assert call(env, "alice", "GET", f"/api/questions/{s['id']}")["spec"]["sql"] == "SELECT 42 AS n"


def test_restore_is_a_new_version_and_needs_edit_rights(env):
    col = call(env, "alice", "POST", "/api/collections", json={"name": "Team"})["id"]
    share(env, "alice", col, [{"user": "carol", "level": "view"}])
    q = save_builder(env, "alice", collection=col)
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"name": "Second", "viz": {"mode": "table"}})
    # people who may view see the history; only editors restore
    assert len(versions(env, "carol", "questions", q["id"])["versions"]) == 2
    call(env, "carol", "POST", f"/api/questions/{q['id']}/versions/1/restore", 403)
    versions(env, "bob", "questions", q["id"], 404)
    call(env, "bob", "GET", f"/api/questions/{q['id']}/versions/1", 404)

    restored = call(env, "alice", "POST", f"/api/questions/{q['id']}/versions/1/restore")
    assert restored["name"] == "Revenue by region" and restored["viz"] == {"mode": "chart", "spec": {"type": "bar"}}
    assert summaries(env, "questions", q["id"])[0] == (3, "Restored version 1")
    assert ("question_restore", f"question {q['id']}: version 1") in [(r.action, r.phrase) for r in env["db"].list_audit(20)]


def test_restoring_a_different_query_takes_the_verified_mark_away(env):
    col = call(env, "admin", "POST", "/api/collections", json={"name": "Official"})["id"]
    call(env, "admin", "PUT", f"/api/collections/{col}/permissions", json={"grants": [{"role": "all", "level": "edit"}]})
    q = save_builder(env, "alice", collection=col)
    changed = {**REVENUE, "filters": {"rules": [{"ref": "q_orders.status", "op": "=", "value": "open"}]}}
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"kind": "builder", "spec": changed})  # v2
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"viz": {"mode": "table"}})          # v3: same query
    call(env, "admin", "POST", f"/api/questions/{q['id']}/verify")
    # v2 computes the same: the mark stays
    assert call(env, "alice", "POST", f"/api/questions/{q['id']}/versions/2/restore")["verified"] is not None
    # v1 computes something else: the mark goes
    assert call(env, "alice", "POST", f"/api/questions/{q['id']}/versions/1/restore")["verified"] is None
    assert ("question_unverify", f"question {q['id']}: the query changed") in [(r.action, r.phrase) for r in env["db"].list_audit(20)]


def test_items_saved_before_history_keep_their_old_state_first(env):
    q = save_builder(env, "alice")
    with env["db"].engine.begin() as conn:  # as if saved before M15
        conn.execute(content_versions_table.delete())
        conn.execute(update(questions_table).where(questions_table.c.id == q["id"]).values(updated_by="old-editor"))
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"viz": {"mode": "table"}})
    listed = versions(env, "alice", "questions", q["id"])["versions"]
    assert [(v["version"], v["summary"], v["saved_by"]) for v in listed] == [
        (2, "Changed the chart", "alice"), (1, "As it was before history was kept", "old-editor"),
    ]


def test_versions_go_with_the_item(env):
    q = save_builder(env, "alice")
    d = new_dashboard(env, "alice")
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"name": "Other"})
    for kind, item in (("questions", q), ("dashboards", d)):
        call(env, "alice", "PATCH", f"/api/{kind}/{item['id']}", json={"archived": True})
        call(env, "alice", "DELETE", f"/api/{kind}/{item['id']}")
    with env["db"].engine.connect() as conn:
        assert conn.execute(select(content_versions_table)).all() == []


def test_only_the_newest_versions_are_kept(tmp_path):
    client, app_db = make_client(tmp_path, history_keep=3)
    with client:
        alice = auth(client, "alice", "alice-pass-1")
        d = client.post("/api/dashboards", json={"name": "Board"}, headers=alice).json()
        for i in range(5):
            assert client.patch(f"/api/dashboards/{d['id']}", json={"name": f"Board {i}"}, headers=alice).status_code == 200
        listed = client.get(f"/api/dashboards/{d['id']}/versions", headers=alice).json()
        assert listed["keep"] == 3
        assert [v["version"] for v in listed["versions"]] == [6, 5, 4]
        assert client.get(f"/api/dashboards/{d['id']}/versions/1", headers=alice).status_code == 404


# ---------------------------------------------------------------- dashboards

def test_dashboard_history_and_restore(env):
    a = save_builder(env, "alice", spec=COUNT_ORDERS, name="Orders")
    b = save_builder(env, "alice", name="Revenue")
    d = new_dashboard(env, "alice")
    put(env, "alice", d["id"], {"cards": [card("c1", a["id"]), card("c2", b["id"], x=6), card("n", kind="text", text="Hi", y=4)]})
    put(env, "alice", d["id"], {
        "filters": [{"id": "status", "label": "Status", "type": "category"}],
        "cards": [card("c1", a["id"], w=12, mappings={"status": {"field": "q_orders.status"}}), card("n", kind="text", text="Hi", y=4)],
    })
    call(env, "alice", "PATCH", f"/api/dashboards/{d['id']}", json={"name": "Plant"})
    assert summaries(env, "dashboards", d["id"]) == [
        (4, "Renamed"),
        (3, "Removed 1 card, changed the filters, the layout and the card settings"),
        (2, "Added 3 cards"),
        (1, "Created"),
    ]
    two = call(env, "alice", "GET", f"/api/dashboards/{d['id']}/versions/2")
    assert [c["key"] for c in two["data"]["cards"]] == ["c1", "c2", "n"]
    assert two["questions"][str(b["id"])] == {"state": "ok", "id": b["id"], "name": "Revenue", "kind": "builder"}

    restored = call(env, "alice", "POST", f"/api/dashboards/{d['id']}/versions/2/restore")
    assert restored["name"] == "Sales overview" and restored["filters"] == []
    assert [c["key"] for c in restored["cards"]] == ["c1", "c2", "n"]
    assert restored["cards"][1]["question"]["name"] == "Revenue"
    assert summaries(env, "dashboards", d["id"])[0] == (5, "Restored version 2")


def test_dashboard_restore_permissions_and_missing_questions(env):
    col = call(env, "alice", "POST", "/api/collections", json={"name": "Team"})["id"]
    share(env, "alice", col, [{"user": "carol", "level": "edit"}])
    mine = save_builder(env, "alice", spec=COUNT_ORDERS, name="Private")  # in alice's own collection
    gone = save_builder(env, "alice", name="Gone", collection=col)
    d = new_dashboard(env, "alice", collection=col)
    put(env, "alice", d["id"], {"cards": [card("p", mine["id"]), card("g", gone["id"], x=6)]})
    put(env, "alice", d["id"], {"cards": []})
    call(env, "alice", "PATCH", f"/api/questions/{gone['id']}", json={"archived": True})
    call(env, "alice", "DELETE", f"/api/questions/{gone['id']}")

    # carol may edit the dashboard but not see alice's private question: no restore that shows it
    refused = call(env, "carol", "POST", f"/api/dashboards/{d['id']}/versions/2/restore", 403)
    assert "not shared with you" in refused["detail"]
    hidden = call(env, "carol", "GET", f"/api/dashboards/{d['id']}/versions/2")["questions"]
    assert hidden[str(mine["id"])] == {"state": "hidden", "id": None, "name": None, "kind": None}
    # alice can: the deleted question's card says "deleted"
    restored = call(env, "alice", "POST", f"/api/dashboards/{d['id']}/versions/2/restore")
    assert [(c["key"], c["question"]["state"]) for c in restored["cards"]] == [("p", "ok"), ("g", "deleted")]
    # a viewer cannot restore at all
    share(env, "alice", col, [{"user": "carol", "level": "view"}])
    call(env, "carol", "POST", f"/api/dashboards/{d['id']}/versions/1/restore", 403)


def test_stored_summary_is_a_short_code_list(env):
    q = save_builder(env, "alice")
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"viz": {"mode": "table"}})
    with env["db"].engine.connect() as conn:
        rows = conn.execute(select(content_versions_table.c.summary).order_by(content_versions_table.c.version)).all()
    assert [json.loads(r.summary) for r in rows] == [[["created"]], [["changed", ["chart"]]]]


def test_new_user_can_read_russian_dashboard_history(tmp_path):
    client, app_db = make_client(tmp_path)
    app_db.create_user("dmitry", hash_password("dmitry-pass-1"))
    with client:
        h = {**auth(client, "dmitry", "dmitry-pass-1"), "Accept-Language": "ru"}
        d = client.post("/api/dashboards", json={"name": "Утро"}, headers=h).json()
        cards = [card(k, kind="text", text="x", y=i) for i, k in enumerate("abcde")]
        assert client.put(f"/api/dashboards/{d['id']}", json={"cards": cards}, headers=h).status_code == 200
        listed = client.get(f"/api/dashboards/{d['id']}/versions", headers=h).json()["versions"]
        assert [v["summary"] for v in listed] == ["Добавили 5 карточек", "Создали"]
