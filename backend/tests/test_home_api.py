"""Home page per person (M11): recently viewed, "Start here", your dashboards, the new-user checklist
and personal settings."""

import time

import pytest
from sqlalchemy import func, select

from app.appdb import User
from app.content.tables import item_views_table
from app.home import KEEP_VIEWS, record_view

from .test_dashboards_api import COUNT_ORDERS, card, new_dashboard, put, run_card
from .test_library_api import call, library_env, new_collection, run, save_builder, share


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def home(env, who):
    return call(env, who, "GET", "/api/home")


def user(env, name) -> User:
    return env["db"].get_user_by_name(name)


def views_of(env, name) -> int:
    with env["db"].engine.connect() as conn:
        return conn.execute(select(func.count()).select_from(item_views_table).where(item_views_table.c.user_id == user(env, name).id)).scalar()


# ---------------------------------------------------------------- recently viewed

def test_opening_records_a_view_newest_first(env):
    q = save_builder(env, "alice", spec=COUNT_ORDERS, name="Orders")
    d = new_dashboard(env, "alice", name="Sales")
    assert home(env, "alice")["recent"] == []  # saving is not viewing
    call(env, "alice", "GET", f"/api/questions/{q['id']}")
    time.sleep(0.01)
    call(env, "alice", "GET", f"/api/dashboards/{d['id']}")
    recent = home(env, "alice")["recent"]
    assert [(r["type"], r["id"]) for r in recent] == [("dashboard", d["id"]), ("question", q["id"])]
    first = recent[1]
    assert first["name"] == "Orders" and first["kind"] == "builder" and first["verified"] is None
    assert first["collection"] == {"id": q["collection_id"], "name": "alice's collection", "mine": True}
    time.sleep(0.01)
    call(env, "alice", "GET", f"/api/questions/{q['id']}")  # opened again: moves to the top, still one row
    assert [r["type"] for r in home(env, "alice")["recent"]] == ["question", "dashboard"]
    assert views_of(env, "alice") == 2
    assert home(env, "carol")["recent"] == []  # per person


def test_only_the_newest_views_are_kept(env):
    alice = user(env, "alice")
    for i in range(KEEP_VIEWS + 5):
        record_view(env["db"].engine, alice, "question", 1000 + i, now=1000.0 + i)
    assert views_of(env, "alice") == KEEP_VIEWS
    with env["db"].engine.connect() as conn:
        oldest = conn.execute(select(func.min(item_views_table.c.item_id)).where(item_views_table.c.user_id == alice.id)).scalar()
    assert oldest == 1005


def test_home_lists_only_what_the_person_can_still_see(env):
    team = new_collection(env, "alice", "Sales")
    q = save_builder(env, "alice", spec=COUNT_ORDERS, collection=team["id"], name="Shared orders")
    other = save_builder(env, "alice", spec=COUNT_ORDERS, collection=team["id"], name="Archived later")
    share(env, "alice", team["id"], [{"user": "carol", "level": "view"}])
    call(env, "carol", "GET", f"/api/questions/{q['id']}")
    call(env, "carol", "GET", f"/api/questions/{other['id']}")
    assert {r["id"] for r in home(env, "carol")["recent"]} == {q["id"], other["id"]}
    call(env, "alice", "PATCH", f"/api/questions/{other['id']}", json={"archived": True})
    assert [r["id"] for r in home(env, "carol")["recent"]] == [q["id"]]
    share(env, "alice", team["id"], [])  # access taken away
    assert home(env, "carol")["recent"] == []
    call(env, "carol", "GET", f"/api/questions/{q['id']}", 404)  # and a refused open records nothing new
    assert views_of(env, "carol") == 2


def test_deleting_an_item_or_a_user_forgets_the_views(env):
    q = save_builder(env, "carol", spec=COUNT_ORDERS)
    call(env, "carol", "GET", f"/api/questions/{q['id']}")
    call(env, "admin", "GET", f"/api/questions/{q['id']}")
    call(env, "carol", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    call(env, "carol", "DELETE", f"/api/questions/{q['id']}")
    assert views_of(env, "carol") == 0 and views_of(env, "admin") == 0
    d = new_dashboard(env, "carol")
    call(env, "carol", "GET", f"/api/dashboards/{d['id']}")
    carol_id = user(env, "carol").id
    assert env["db"].delete_user("carol")
    with env["db"].engine.connect() as conn:
        left = conn.execute(select(func.count()).select_from(item_views_table).where(item_views_table.c.user_id == carol_id)).scalar()
    assert left == 0


# ---------------------------------------------------------------- your dashboards

def test_your_dashboards_favourites_then_opened_then_your_own(env):
    team = new_collection(env, "admin", "Plant")
    share(env, "admin", team["id"], [{"role": "all", "level": "view"}])
    shared = new_dashboard(env, "admin", name="Plant overview", collection=team["id"])
    starred = new_dashboard(env, "admin", name="Starred", collection=team["id"])
    own = new_dashboard(env, "alice", name="My own")
    call(env, "alice", "GET", f"/api/dashboards/{shared['id']}")
    call(env, "alice", "PUT", f"/api/dashboards/{starred['id']}/favorite")
    mine = home(env, "alice")["dashboards"]
    assert [d["name"] for d in mine] == ["Starred", "Plant overview", "My own"]
    assert mine[0]["favorite"] and not mine[1]["favorite"] and mine[1]["viewed_at"] and mine[2]["viewed_at"] is None
    call(env, "admin", "PATCH", f"/api/dashboards/{starred['id']}", json={"archived": True})
    assert [d["name"] for d in home(env, "alice")["dashboards"]] == ["Plant overview", "My own"]
    assert own["id"] in [d["id"] for d in home(env, "alice")["dashboards"]]


# ---------------------------------------------------------------- start here

def test_start_here_set_by_an_admin_and_seen_by_everyone_it_is_shared_with(env):
    assert home(env, "alice")["start_here"] is None
    start = new_collection(env, "admin", "Start here")
    call(env, "alice", "PUT", "/api/admin/start-here", 403, json={"collection_id": start["id"]})
    plain = save_builder(env, "admin", spec=COUNT_ORDERS, collection=start["id"], name="A plain question")
    official = save_builder(env, "admin", spec=COUNT_ORDERS, collection=start["id"], name="Official orders")
    call(env, "admin", "POST", f"/api/questions/{official['id']}/verify")
    d = new_dashboard(env, "admin", name="Overview", collection=start["id"])
    archived = save_builder(env, "admin", spec=COUNT_ORDERS, collection=start["id"], name="Old")
    call(env, "admin", "PATCH", f"/api/questions/{archived['id']}", json={"archived": True})

    got = call(env, "admin", "PUT", "/api/admin/start-here", json={"collection_id": start["id"]})["start_here"]
    assert got["name"] == "Start here" and got["shared"] is False and got["total"] == 3
    # the official answer first, then dashboards, then questions by name
    assert [(i["type"], i["id"]) for i in got["items"]] == [("question", official["id"]), ("dashboard", d["id"]), ("question", plain["id"])]
    assert got["items"][0]["verified"]["by"] == "admin"
    assert home(env, "alice")["start_here"] is None  # not shared yet: only admins see it

    share(env, "admin", start["id"], [{"role": "all", "level": "view"}])
    seen = home(env, "alice")["start_here"]
    assert seen["id"] == start["id"] and seen["shared"] is True and len(seen["items"]) == 3
    call(env, "admin", "PUT", "/api/admin/start-here", json={"collection_id": None})
    assert home(env, "alice")["start_here"] is None


def test_start_here_must_be_a_shared_open_collection(env):
    call(env, "admin", "PUT", "/api/admin/start-here", 404, json={"collection_id": 9999})
    personal = call(env, "alice", "GET", "/api/collections")["personal_id"]
    call(env, "admin", "PUT", "/api/admin/start-here", 400, json={"collection_id": personal})
    old = new_collection(env, "admin", "Old")
    call(env, "admin", "PATCH", f"/api/collections/{old['id']}", json={"archived": True})
    call(env, "admin", "PUT", "/api/admin/start-here", 409, json={"collection_id": old["id"]})


def test_a_deleted_start_here_collection_is_not_confused_with_a_new_one(env):
    first = new_collection(env, "admin", "First")
    call(env, "admin", "PUT", "/api/admin/start-here", json={"collection_id": first["id"]})
    call(env, "admin", "PATCH", f"/api/collections/{first['id']}", json={"archived": True})
    assert home(env, "admin")["start_here"] is None  # archived: hidden
    call(env, "admin", "DELETE", f"/api/collections/{first['id']}")
    again = new_collection(env, "admin", "Second")  # SQLite may hand out the same id again
    assert again["id"] == first["id"]
    assert home(env, "admin")["start_here"] is None


# ---------------------------------------------------------------- personal settings

def test_prefs_round_trip_and_merge(env):
    assert call(env, "alice", "GET", "/api/account/prefs") == {}
    call(env, "alice", "PUT", "/api/account/prefs", json={"checklist": {"done": ["open_dashboard"], "hidden": False}})
    both = call(env, "alice", "PUT", "/api/account/prefs", json={"builder": {"simple": True}})
    assert both == {"checklist": {"done": ["open_dashboard"], "hidden": False}, "builder": {"simple": True}}
    assert call(env, "alice", "PUT", "/api/account/prefs", json={"builder": None}) == {"checklist": {"done": ["open_dashboard"], "hidden": False}}
    assert call(env, "alice", "GET", "/api/account/prefs")["checklist"]["done"] == ["open_dashboard"]
    assert call(env, "carol", "GET", "/api/account/prefs") == {}


@pytest.mark.parametrize("body, status", [
    ({"notes": "x" * 9000}, 400),
    ({"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}}, 400),
    ({"checklist": ["open_dashboard"]}, 400),
    ({"checklist": {"done": ["fly_to_the_moon"]}}, 400),
    ({"checklist": {"done": "open_dashboard"}}, 400),
    ({"checklist": {"done": [], "hidden": "yes"}}, 400),
    ([1, 2, 3], 422),
])
def test_prefs_are_validated(env, body, status):
    call(env, "alice", "PUT", "/api/account/prefs", status, json=body)
    assert call(env, "alice", "GET", "/api/account/prefs") == {}


# ---------------------------------------------------------------- the checklist

def done(env, who):
    return home(env, who)["checklist"]["done"]


def test_checklist_ticks_itself_from_what_the_person_did(env):
    assert home(env, "carol")["checklist"] == {
        "steps": ["open_dashboard", "change_filter", "find_record", "ask_question", "save_question"], "done": [], "hidden": False,
    }
    # running someone else's saved question or a dashboard card is not "asking a question"
    team = new_collection(env, "admin", "Shared")
    share(env, "admin", team["id"], [{"role": "all", "level": "view"}])
    q = save_builder(env, "admin", spec=COUNT_ORDERS, collection=team["id"])
    d = new_dashboard(env, "admin", collection=team["id"])
    put(env, "admin", d["id"], {"cards": [card("c1", q["id"])]})
    assert run(env, "carol", q["id"])["status"] == "completed"
    assert run_card(env, "carol", d["id"], "c1")["status"] == "completed"
    assert done(env, "carol") == []

    call(env, "carol", "GET", f"/api/dashboards/{d['id']}")
    assert done(env, "carol") == ["open_dashboard"]
    res = env["client"].get("/api/connections/shop/browse", params={"table": "q_orders"}, headers=env["carol"])
    assert res.status_code == 200
    assert done(env, "carol") == ["open_dashboard", "find_record"]
    call(env, "carol", "POST", "/api/query", json={"spec": COUNT_ORDERS, "wait_ms": 5000})
    assert done(env, "carol") == ["open_dashboard", "find_record", "ask_question"]
    save_builder(env, "carol", spec=COUNT_ORDERS)
    assert done(env, "carol") == ["open_dashboard", "find_record", "ask_question", "save_question"]
    # the browser marks the filter step; what the server found is kept with it
    prefs = call(env, "carol", "GET", "/api/account/prefs")
    assert prefs["checklist"]["done"] == ["open_dashboard", "find_record", "ask_question", "save_question"]
    call(env, "carol", "PUT", "/api/account/prefs", json={"checklist": {"done": [*prefs["checklist"]["done"], "change_filter"]}})
    assert done(env, "carol") == ["open_dashboard", "change_filter", "find_record", "ask_question", "save_question"]


def test_a_hidden_checklist_stays_hidden(env):
    call(env, "alice", "PUT", "/api/account/prefs", json={"checklist": {"done": [], "hidden": True}})
    save_builder(env, "alice", spec=COUNT_ORDERS)
    assert home(env, "alice")["checklist"] == {
        "steps": ["open_dashboard", "change_filter", "find_record", "ask_question", "save_question"], "done": [], "hidden": True,
    }
