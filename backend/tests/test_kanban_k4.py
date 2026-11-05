"""Kanban K4: private boards and finished tasks leaving the board after a while."""

from __future__ import annotations

import time

from sqlalchemy import update

from app.kanban.tables import cards_table

from .test_kanban_api import JPEG, call, env, new_board, new_card, upload  # noqa: F401


def test_a_private_board_is_for_its_members_only(env):
    board, detail = new_board(env, "alice", "Salaries")
    card = new_card(env, board["id"], detail["columns"][0]["id"], title="Raise for the night shift", assignees=[env.ids["bob"]])
    att = upload(env, card["id"], JPEG, "list.jpg", ctype="image/jpeg")
    # open board: everyone sees it
    assert any(b["id"] == board["id"] for b in call(env, "GET", "/boards", "carol")["boards"])
    made_private = call(env, "PATCH", f"/boards/{board['id']}", json={"private": True})
    assert made_private["private"] is True
    # carol (not a member) no longer sees it anywhere
    assert all(b["id"] != board["id"] for b in call(env, "GET", "/boards", "carol")["boards"])
    call(env, "GET", f"/boards/{board['id']}", "carol", status=404)
    call(env, "GET", f"/cards/{card['id']}", "carol", status=404)
    call(env, "GET", f"/attachments/{att['id']}", "carol", status=404)
    call(env, "GET", f"/boards/{board['id']}/history", "carol", status=404)
    call(env, "GET", f"/boards/{board['id']}/finished", "carol", status=404)
    # bob is assigned but no member: the task is not in his list either
    assert call(env, "GET", "/my", "bob")["cards"] == []
    # members and admins see it
    call(env, "PUT", f"/boards/{board['id']}/members", json={"members": [{"user": env.ids["alice"], "role": "owner"}, {"user": env.ids["bob"], "role": "editor"}]})
    assert [c["title"] for c in call(env, "GET", "/my", "bob")["cards"]] == ["Raise for the night shift"]
    assert call(env, "GET", f"/boards/{board['id']}", "admin")["board"]["private"] is True
    assert any(b["id"] == board["id"] for b in call(env, "GET", "/boards", "admin")["boards"])
    # only owners change it; a new board can start private
    call(env, "PATCH", f"/boards/{board['id']}", "bob", status=403, json={"private": False})
    fresh = call(env, "POST", "/boards", "carol", json={"name": "Carol's own", "private": True})
    assert fresh["private"] is True and all(b["id"] != fresh["id"] for b in call(env, "GET", "/boards", "alice")["boards"])


def test_finished_tasks_leave_the_board_after_a_while(env):
    board, detail = new_board(env)
    todo, done = detail["columns"][0]["id"], detail["columns"][-1]["id"]
    assert call(env, "GET", f"/boards/{board['id']}")["board"]["done_keep_days"] == 14
    titles = ["Old filter change", "Old belt check", "Yesterday's oil", "Still open"]
    cards = [new_card(env, board["id"], todo, title=t) for t in titles]
    for c in cards[:3]:
        call(env, "POST", f"/cards/{c['id']}/move", json={"column_id": done})
    with env.db.engine.begin() as conn:  # two of them finished 20 and 30 days ago
        for c, days in ((cards[0], 30), (cards[1], 20)):
            conn.execute(update(cards_table).where(cards_table.c.id == c["id"]).values(completed_at=time.time() - days * 86400))

    on_board = call(env, "GET", f"/boards/{board['id']}")
    assert sorted(c["title"] for c in on_board["cards"]) == ["Still open", "Yesterday's oil"]
    assert on_board["board"]["finished_earlier"] == 2
    earlier = call(env, "GET", f"/boards/{board['id']}/finished")
    assert [c["title"] for c in earlier["cards"]] == ["Old belt check", "Old filter change"] and earlier["total"] == 2
    assert [c["title"] for c in call(env, "GET", f"/boards/{board['id']}/finished", params={"q": "filter"})["cards"]] == ["Old filter change"]
    # still a task: it opens, and moving it back puts it on the board again
    call(env, "GET", f"/cards/{cards[0]['id']}")
    call(env, "POST", f"/cards/{cards[0]['id']}/move", json={"column_id": todo})
    assert call(env, "GET", f"/boards/{board['id']}")["board"]["finished_earlier"] == 1
    # longer, or always
    call(env, "PATCH", f"/boards/{board['id']}", json={"done_keep_days": 30})
    assert call(env, "GET", f"/boards/{board['id']}")["board"]["finished_earlier"] == 0
    call(env, "PATCH", f"/boards/{board['id']}", json={"done_keep_days": 0})
    assert len(call(env, "GET", f"/boards/{board['id']}")["cards"]) == 4
    assert call(env, "GET", f"/boards/{board['id']}/finished")["keep_days"] == 0
    call(env, "PATCH", f"/boards/{board['id']}", json={"done_keep_days": 3}, status=422)


def test_a_board_and_my_tasks_as_excel(env):
    import io

    from openpyxl import load_workbook

    board, detail = new_board(env, "alice", "Press line")
    todo, done = detail["columns"][0]["id"], detail["columns"][-1]["id"]
    new_card(env, board["id"], todo, title="Check the gauge", assignees=[env.ids["bob"]], assignee_names=["Ivan Petrov"],
             due_date="2020-01-10", priority="high")
    finished = new_card(env, board["id"], todo, title="Swept", due_date="2020-01-01")
    call(env, "POST", f"/cards/{finished['id']}/move", json={"column_id": done})
    res = env.client.get(f"/api/kanban/boards/{board['id']}/export.xlsx", headers={**env.h["alice"], "Accept-Language": "ru"})
    assert res.status_code == 200 and "spreadsheetml" in res.headers["content-type"]
    assert "Press%20line" in res.headers["content-disposition"]
    rows = list(load_workbook(io.BytesIO(res.content)).active.iter_rows(values_only=True))
    assert rows[0][:6] == ("Этап", "Задача", "Кто", "Начало", "Срок", "Просрочена")
    gauge = next(r for r in rows if r[1] == "Check the gauge")
    assert gauge[2] == "bob, Ivan Petrov" and gauge[4].date().isoformat() == "2020-01-10" and gauge[5] == "да" and gauge[6] == "Высокий"
    swept = next(r for r in rows if r[1] == "Swept")
    assert swept[5] is None and swept[10] is not None  # finished: not late, with the day it was finished
    # my tasks
    mine = env.client.get("/api/kanban/my/export.xlsx", headers=env.h["bob"])
    my_rows = list(load_workbook(io.BytesIO(mine.content)).active.iter_rows(values_only=True))
    assert my_rows[0][:3] == ("Board", "Stage", "Task") and [r[2] for r in my_rows[1:]] == ["Check the gauge"]
    # a private board: not for others
    call(env, "PATCH", f"/boards/{board['id']}", json={"private": True})
    assert env.client.get(f"/api/kanban/boards/{board['id']}/export.xlsx", headers=env.h["carol"]).status_code == 404
