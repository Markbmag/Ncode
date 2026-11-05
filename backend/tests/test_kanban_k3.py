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


# ---------------------------------------------------------------------- repeating tasks
from datetime import date  # noqa: E402

from app.kanban.store import next_due  # noqa: E402


def test_next_dates_of_a_repeating_task():
    wed = date(2026, 11, 4)
    assert next_due("daily", wed, wed) == date(2026, 11, 5)
    assert next_due("weekly", wed, wed) == date(2026, 11, 11)
    assert next_due("weekdays", date(2026, 11, 6), date(2026, 11, 6)) == date(2026, 11, 9)   # Friday -> Monday
    assert next_due("monthly", date(2026, 1, 31), date(2026, 1, 31)) == date(2026, 2, 28)    # short month
    assert next_due("monthly", date(2026, 1, 31), date(2026, 3, 1)) == date(2026, 3, 31)     # back to the 31st
    # done early: one step on from the due date, nothing skipped
    assert next_due("weekly", date(2026, 11, 9), wed) == date(2026, 11, 16)
    # done three weeks late: the next one is in the future, not in the past
    assert next_due("weekly", date(2026, 10, 12), wed) == date(2026, 11, 9)
    # no due date: from today
    assert next_due("daily", None, wed) == date(2026, 11, 5)
    assert next_due("weekdays", None, date(2026, 11, 7)) == date(2026, 11, 9)                # Saturday -> Monday


def test_a_repeating_task_comes_back_when_done(env):
    board, detail = new_board(env)
    todo, doing, done = (c["id"] for c in detail["columns"])
    label = call(env, "POST", f"/boards/{board['id']}/labels", json={"name": "Safety", "color": "red"})
    card = new_card(env, board["id"], doing, title="Weekly safety walk", assignees=[env.ids["bob"]], labels=[label["id"]],
                    due_date="2026-11-02", start_date="2026-10-30", repeat="weekly")
    assert card["repeat"] == "weekly"
    call(env, "POST", f"/cards/{card['id']}/checklist", json={"text": "Fire exits"})
    step = call(env, "POST", f"/cards/{card['id']}/checklist", json={"text": "First aid kit"})["checklist_items"][0]
    call(env, "PATCH", f"/checklist/{step['id']}", json={"done": True})

    moved = call(env, "POST", f"/cards/{card['id']}/move", json={"column_id": done})
    nxt = moved["next"]
    assert nxt["column"] == "To do" and nxt["due_date"] > "2026-11-02"
    assert moved["repeat"] is None  # the series goes on with the new task
    again = call(env, "GET", f"/cards/{nxt['id']}")
    assert (again["title"], again["column_id"], again["repeat"], again["assignees"], again["labels"]) == (
        "Weekly safety walk", todo, "weekly", [env.ids["bob"]], [label["id"]])
    assert [(i["text"], i["done"]) for i in again["checklist_items"]] == [("Fire exits", False), ("First aid kit", False)]
    lead = date.fromisoformat(again["due_date"]) - date.fromisoformat(again["start_date"])
    assert lead.days == 3  # the same lead time as before
    assert any(h["action"] == "card_repeated" for h in again["history"])

    # moving the done one back and to Done again makes no second copy
    call(env, "POST", f"/cards/{card['id']}/move", json={"column_id": doing})
    assert "next" not in call(env, "POST", f"/cards/{card['id']}/move", json={"column_id": done})
    titles = [c["title"] for c in call(env, "GET", f"/boards/{board['id']}")["cards"]]
    assert titles.count("Weekly safety walk") == 2
    # switching it off
    assert call(env, "PATCH", f"/cards/{nxt['id']}", json={"repeat": None})["repeat"] is None
    assert "next" not in call(env, "POST", f"/cards/{nxt['id']}/move", json={"column_id": done})
    call(env, "PATCH", f"/cards/{nxt['id']}", json={"repeat": "yearly"}, status=422)


# ---------------------------------------------------------------------- links to Search & BI
def test_links_to_dashboards_follow_what_each_person_may_see(env):
    board, detail = new_board(env)
    call(env, "PUT", f"/boards/{board['id']}/members", json={"members": [{"user": env.ids["alice"], "role": "owner"}, {"user": env.ids["bob"], "role": "editor"}]})
    card = new_card(env, board["id"], detail["columns"][0]["id"], title="Look into the scrap rise")
    mine = env.client.post("/api/dashboards", headers=env.h["alice"], json={"name": "Scrap overview"}).json()
    linked = call(env, "POST", f"/cards/{card['id']}/links", json={"kind": "dashboard", "target_id": mine["id"]})
    assert [(x["kind"], x["name"], x["url"]) for x in linked["links"]] == [("dashboard", "Scrap overview", f"/dashboards/{mine['id']}")]
    # the same link twice stays one link
    assert len(call(env, "POST", f"/cards/{card['id']}/links", json={"kind": "dashboard", "target_id": mine["id"]})["links"]) == 1
    # bob may not open alice's own dashboard: he sees that there is a link, not its name
    seen = call(env, "GET", f"/cards/{card['id']}", "bob")["links"]
    assert seen[0]["name"] is None and seen[0]["url"] == f"/dashboards/{mine['id']}"
    # and cannot link it himself
    other = new_card(env, board["id"], detail["columns"][0]["id"], "bob", title="Bob's task")
    call(env, "POST", f"/cards/{other['id']}/links", "bob", status=404, json={"kind": "dashboard", "target_id": mine["id"]})
    call(env, "POST", f"/cards/{card['id']}/links", "alice", status=404, json={"kind": "question", "target_id": 999})
    # people who only look at the board cannot change links
    call(env, "POST", f"/cards/{card['id']}/links", "carol", status=403, json={"kind": "dashboard", "target_id": mine["id"]})
    removed = call(env, "DELETE", f"/links/{seen[0]['id']}", "bob")
    assert removed["links"] == []
    assert [h["action"] for h in removed["history"]][:2] == ["link_removed", "link_added"]


# ---------------------------------------------------------------------- people who are not Ncode users
def test_people_by_name_on_a_task(env):
    board, detail = new_board(env)
    todo, done = detail["columns"][0]["id"], detail["columns"][-1]["id"]
    card = new_card(env, board["id"], todo, title="Fix the gate", assignees=[env.ids["bob"]],
                    assignee_names=["  Ivan   Petrov ", "ivan petrov", "Olga (electrician)", ""])
    assert card["assignees"] == [env.ids["bob"]]
    assert card["assignee_names"] == ["Ivan Petrov", "Olga (electrician)"]  # trimmed, once, in order
    changed = call(env, "PATCH", f"/cards/{card['id']}", json={"assignee_names": ["Olga (electrician)", "Sergey"]})
    assert changed["assignee_names"] == ["Olga (electrician)", "Sergey"]
    entry = next(h for h in changed["history"] if h["action"] == "card_updated")
    assert entry["details"]["changes"]["assignees"] == {"added": ["Sergey"], "removed": ["Ivan Petrov"]}
    # the board shows them; a repeating task takes them along
    on_board = next(c for c in call(env, "GET", f"/boards/{board['id']}")["cards"] if c["id"] == card["id"])
    assert on_board["assignee_names"] == ["Olga (electrician)", "Sergey"]
    call(env, "PATCH", f"/cards/{card['id']}", json={"repeat": "daily"})
    nxt = call(env, "POST", f"/cards/{card['id']}/move", json={"column_id": done})["next"]
    assert call(env, "GET", f"/cards/{nxt['id']}")["assignee_names"] == ["Olga (electrician)", "Sergey"]
    # everyone can be taken off; deleting the task removes the names too
    assert call(env, "PATCH", f"/cards/{nxt['id']}", json={"assignee_names": []})["assignee_names"] == []
    call(env, "PATCH", f"/cards/{card['id']}", json={"archived": True})
    call(env, "DELETE", f"/cards/{card['id']}")
    from app.kanban.tables import card_names_table
    from sqlalchemy import select
    with env.db.engine.connect() as conn:
        assert conn.execute(select(card_names_table).where(card_names_table.c.card_id == card["id"])).all() == []
