"""Kanban K3: my tasks across boards, repeating tasks, links to BI."""

from __future__ import annotations

import time

from sqlalchemy import update

from app.kanban.tables import cards_table

from .test_kanban_api import call, env, new_board, new_card  # noqa: F401


def test_my_tasks_across_boards(env):
    bob = env.ids["bob"]
    a, da = new_board(env, "alice", "Press line")
    b, db = new_board(env, "carol", "Paint shop")
    todo_a, done_a = da["columns"][0]["id"], da["columns"][-1]["id"]
    open_a = new_card(env, a["id"], todo_a, title="Check the gauge", assignees=[bob], due_date="2026-11-10")
    new_card(env, a["id"], todo_a, title="Someone else's", assignees=[env.ids["dave"]])
    finished = new_card(env, a["id"], todo_a, title="Finished today", assignees=[bob])
    call(env, "POST", f"/cards/{finished['id']}/move", "alice", json={"column_id": done_a})
    old = new_card(env, a["id"], todo_a, title="Finished long ago", assignees=[bob])
    call(env, "POST", f"/cards/{old['id']}/move", "alice", json={"column_id": done_a})
    with env.db.engine.begin() as conn:
        conn.execute(update(cards_table).where(cards_table.c.id == old["id"]).values(completed_at=time.time() - 30 * 86400))
    removed = new_card(env, a["id"], todo_a, title="Taken off the board", assignees=[bob])
    call(env, "PATCH", f"/cards/{removed['id']}", "alice", json={"archived": True})
    other = new_card(env, b["id"], db["columns"][1]["id"], "carol", title="Mix the paint", assignees=[bob, env.ids["carol"]])
    hidden, dh = new_board(env, "alice", "Old board")
    new_card(env, hidden["id"], dh["columns"][0]["id"], title="On a hidden board", assignees=[bob])
    call(env, "PATCH", f"/boards/{hidden['id']}", "alice", json={"archived": True})

    mine = call(env, "GET", "/my", "bob")
    assert sorted(c["title"] for c in mine["cards"]) == ["Check the gauge", "Finished today", "Mix the paint"]
    assert {bd["name"] for bd in mine["boards"]} == {"Press line", "Paint shop"}
    press = next(bd for bd in mine["boards"] if bd["id"] == a["id"])
    assert [c["name"] for c in press["columns"]] == [c["name"] for c in da["columns"]]
    assert press["can_edit"] is False  # bob sees the board but is not a member
    assert {p["username"] for p in mine["people"]} == {"bob", "carol"}
    by_title = {c["title"]: c for c in mine["cards"]}
    assert by_title["Check the gauge"]["due_date"] == "2026-11-10" and by_title["Check the gauge"]["board_id"] == a["id"]
    assert by_title["Mix the paint"]["id"] == other["id"] and by_title["Finished today"]["completed_at"]
    # nothing finished: only open ones
    assert sorted(c["title"] for c in call(env, "GET", "/my", "bob", params={"done_days": 0})["cards"]) == ["Check the gauge", "Mix the paint"]
    # members can edit from the list
    call(env, "PUT", f"/boards/{a['id']}/members", "alice", json={"members": [{"user": env.ids["alice"], "role": "owner"}, {"user": bob, "role": "editor"}]})
    assert next(bd for bd in call(env, "GET", "/my", "bob")["boards"] if bd["id"] == a["id"])["can_edit"] is True
    assert call(env, "GET", "/my", "dave")["cards"][0]["title"] == "Someone else's"
    assert call(env, "GET", "/my", "admin") == {"cards": [], "boards": [], "people": []}
