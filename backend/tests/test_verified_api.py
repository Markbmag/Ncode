"""Verified content (M11): admins mark questions and dashboards as the official answer."""

import pytest

from .test_library_api import REVENUE, call, library_env, new_collection, save_builder, save_sql


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def shared_collection(env, name="Official"):
    col = new_collection(env, "admin", name)
    call(env, "admin", "PUT", f"/api/collections/{col['id']}/permissions", json={"grants": [{"role": "all", "level": "edit"}]})
    return col["id"]


def audit_actions(env):
    return [(r.action, r.phrase) for r in env["db"].list_audit(50)]


def test_only_admins_verify_and_every_response_says_so(env):
    col = shared_collection(env)
    q = save_builder(env, "alice", collection=col)
    assert q["verified"] is None
    call(env, "alice", "POST", f"/api/questions/{q['id']}/verify", 403)
    done = call(env, "admin", "POST", f"/api/questions/{q['id']}/verify")
    assert done["verified"]["by"] == "admin" and done["verified"]["at"] > 0
    assert done["updated_at"] == q["updated_at"]  # not a new version: nobody gets an edit conflict
    assert call(env, "carol", "GET", f"/api/questions/{q['id']}")["verified"]["by"] == "admin"
    listed = call(env, "carol", "GET", "/api/questions", params={"q": "revenue"})["questions"]
    assert listed[0]["verified"]["by"] == "admin"
    in_collection = call(env, "carol", "GET", f"/api/collections/{col}")["questions"]
    assert in_collection[0]["verified"]["by"] == "admin"

    call(env, "alice", "DELETE", f"/api/questions/{q['id']}/verify", 403)
    assert call(env, "admin", "DELETE", f"/api/questions/{q['id']}/verify")["verified"] is None
    assert ("question_verify", f"question {q['id']}") in audit_actions(env)
    assert ("question_unverify", f"question {q['id']}") in audit_actions(env)
    # what people may not see stays hidden: a private question is "not found", not "forbidden"
    private = save_builder(env, "carol")
    call(env, "admin", "POST", f"/api/questions/{private['id']}/verify")  # admins see everything
    call(env, "alice", "GET", f"/api/questions/{private['id']}", 404)


def test_changing_the_query_removes_the_mark_renaming_does_not(env):
    col = shared_collection(env)
    other = shared_collection(env, "Elsewhere")
    q = save_builder(env, "alice", collection=col)
    call(env, "admin", "POST", f"/api/questions/{q['id']}/verify")
    full = call(env, "alice", "GET", f"/api/questions/{q['id']}")
    # the editor sends everything on save: same query, new chart and name -> still verified
    same = {"kind": "builder", "spec": full["spec"], "parameters": full["parameters"], "viz": {"mode": "table"}, "name": "Renamed"}
    assert call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json=same)["verified"] is not None
    assert call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"collection_id": other})["verified"] is not None
    assert call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"description": "Paid only"})["verified"] is not None

    changed = {**REVENUE, "filters": {"rules": [{"ref": "q_orders.status", "op": "=", "value": "open"}]}}
    after = call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"kind": "builder", "spec": changed})
    assert after["verified"] is None
    assert ("question_unverify", f"question {q['id']}: the query changed") in audit_actions(env)

    # SQL questions: the SQL counts, the chart does not
    s = save_sql(env, "alice", "SELECT status, COUNT(*) AS n FROM q_orders GROUP BY status", collection=col)
    call(env, "admin", "POST", f"/api/questions/{s['id']}/verify")
    kept = call(env, "alice", "PATCH", f"/api/questions/{s['id']}", json={"kind": "sql", "connection": "shop", "spec": s["spec"], "viz": {"mode": "chart"}})
    assert kept["verified"] is not None
    gone = call(env, "alice", "PATCH", f"/api/questions/{s['id']}", json={"spec": {**s["spec"], "sql": "SELECT 1 AS one"}})
    assert gone["verified"] is None


def test_verified_first_in_lists_and_search(env):
    col = shared_collection(env)
    old = save_builder(env, "alice", collection=col, name="Revenue (official)")
    save_builder(env, "alice", collection=col, name="Revenue draft")
    newest = save_builder(env, "alice", collection=col, name="Revenue scratch")
    names = lambda: [x["name"] for x in call(env, "carol", "GET", "/api/questions", params={"q": "revenue"})["questions"]]  # noqa: E731
    assert names()[0] == "Revenue scratch"  # newest first ...
    call(env, "admin", "POST", f"/api/questions/{old['id']}/verify")
    assert names() == ["Revenue (official)", "Revenue scratch", "Revenue draft"]  # ... but the official answer leads
    assert call(env, "carol", "GET", f"/api/collections/{col}")["questions"][0]["id"] == old["id"]
    assert call(env, "carol", "GET", "/api/questions", params={"limit": 1})["questions"][0]["id"] == old["id"]
    assert newest["verified"] is None

    first = call(env, "alice", "POST", "/api/dashboards", json={"name": "Plant overview", "collection_id": col})
    call(env, "alice", "POST", "/api/dashboards", json={"name": "Plant scratch", "collection_id": col})
    boards = lambda **p: [d["name"] for d in call(env, "carol", "GET", "/api/dashboards", params=p)["dashboards"]]  # noqa: E731
    assert boards() == ["Plant scratch", "Plant overview"]
    call(env, "admin", "POST", f"/api/dashboards/{first['id']}/verify")
    assert boards() == ["Plant overview", "Plant scratch"]
    assert boards(q="plant") == ["Plant overview", "Plant scratch"]


def test_dashboards(env):
    col = shared_collection(env)
    q = save_builder(env, "alice", collection=col)
    d = call(env, "alice", "POST", "/api/dashboards", json={"name": "Plant", "collection_id": col})
    assert d["verified"] is None
    call(env, "alice", "POST", f"/api/dashboards/{d['id']}/verify", 403)
    done = call(env, "admin", "POST", f"/api/dashboards/{d['id']}/verify")
    assert done["verified"]["by"] == "admin" and done["updated_at"] == d["updated_at"]
    layout = {"cards": [{"key": "a", "kind": "question", "question_id": q["id"], "layout": {"x": 0, "y": 0, "w": 6, "h": 4}}]}
    assert call(env, "alice", "PUT", f"/api/dashboards/{d['id']}", json=layout)["verified"] is not None
    assert call(env, "carol", "GET", f"/api/collections/{col}")["dashboards"][0]["verified"]["by"] == "admin"
    copy = call(env, "alice", "POST", f"/api/dashboards/{d['id']}/duplicate", json={})
    assert copy["verified"] is None  # a copy is not what was checked
    assert call(env, "admin", "DELETE", f"/api/dashboards/{d['id']}/verify")["verified"] is None
    assert {("dashboard_verify", f"dashboard {d['id']}"), ("dashboard_unverify", f"dashboard {d['id']}")} <= set(audit_actions(env))


def test_archived_items_cannot_be_verified_and_copies_start_unverified(env):
    col = shared_collection(env)
    q = save_builder(env, "alice", collection=col)
    call(env, "admin", "POST", f"/api/questions/{q['id']}/verify")
    copy = call(env, "alice", "POST", f"/api/questions/{q['id']}/duplicate", json={})
    assert copy["verified"] is None
    call(env, "alice", "PATCH", f"/api/questions/{copy['id']}", json={"archived": True})
    assert "Restore it first" in call(env, "admin", "POST", f"/api/questions/{copy['id']}/verify", 409)["detail"]
    d = call(env, "alice", "POST", "/api/dashboards", json={"name": "Old", "collection_id": col})
    call(env, "alice", "PATCH", f"/api/dashboards/{d['id']}", json={"archived": True})
    call(env, "admin", "POST", f"/api/dashboards/{d['id']}/verify", 409)
    archive = call(env, "alice", "GET", "/api/library/archive")
    assert archive["questions"][0]["verified"] is None and archive["dashboards"][0]["verified"] is None
