"""Glossary (M11): business terms in English and Russian, searchable, linked to metrics, columns and questions."""

import pytest

from app.glossary import Term, fold, search

from .test_library_api import call, library_env, save_builder

OEE = {
    "term": "OEE",
    "definition": "Overall equipment effectiveness: availability × performance × quality",
    "translations": {"ru": {"term": "ОЕЕ", "definition": "Общая эффективность оборудования: доступность × производительность × качество"}},
    "synonyms": ["Overall equipment effectiveness", "Общая эффективность оборудования"],
}
SCRAP = {
    "term": "Scrap rate",
    "definition": "Share of produced parts that had to be thrown away",
    "translations": {"ru": {"term": "Коэффициент брака", "definition": "Доля изготовленных деталей, ушедших в брак"}},
    "synonyms": ["Брак", "defect rate"],
}
PAID = {"name": "Paid revenue", "connection": "shop", "table": "q_orders", "definition": {"fn": "sum", "ref": "total"}}


@pytest.fixture()
def env(tmp_path):
    yield from library_env(tmp_path)


def terms(env, who, **params):
    return call(env, who, "GET", "/api/glossary", params=params)["terms"]


def add(env, body, status=200):
    return call(env, "admin", "POST", "/api/glossary", status, json=body)


# ---------------------------------------------------------------- search (pure)

def _term(tid, term, definition="", synonyms=(), translations=None):
    return Term(tid, term, definition, translations or {}, list(synonyms), [], False, 0.0, 0.0, None)


def test_search_is_unicode_case_insensitive_and_names_come_first():
    items = [
        _term(1, "Takt time", "Available time divided by demand"),
        _term(2, "Downtime", "Time a line stands still; see takt", synonyms=["Простой"]),
        _term(3, "Ёмкость линии", "Сколько деталей линия делает за смену"),
        _term(4, "Scrap rate", "Share of scrap", translations={"ru": {"term": "Коэффициент брака"}}),
    ]
    assert [t.id for t in search(items, None)] == [2, 4, 1, 3]  # alphabetical, Cyrillic after Latin
    assert [t.id for t in search(items, "TAKT")] == [1, 2]       # the name before the definition
    assert [t.id for t in search(items, "ПРОСТОЙ")] == [2]       # a synonym, any case
    assert [t.id for t in search(items, "емкость")] == [3]       # ё = е
    assert [t.id for t in search(items, "БРАКА коэффициент")] == [4]  # every word, any order
    assert search(items, "nothing like it") == []
    assert fold("ÉCOLE Ёлка") == "école елка"


# ---------------------------------------------------------------- the API

def test_everyone_reads_admins_write(env):
    created = add(env, OEE)
    assert created["term"] == "OEE" and created["translations"]["ru"]["term"] == "ОЕЕ"
    assert created["synonyms"] == OEE["synonyms"] and created["related"] == [] and created["archived"] is False
    assert created["updated_by"] == "admin"
    for who in ("alice", "bob", "carol"):
        assert [t["id"] for t in terms(env, who)] == [created["id"]]
    call(env, "alice", "POST", "/api/glossary", 403, json=SCRAP)
    call(env, "alice", "PUT", f"/api/glossary/{created['id']}", 403, json=SCRAP)
    call(env, "alice", "PATCH", f"/api/glossary/{created['id']}", 403, json={"archived": True})
    call(env, "alice", "DELETE", f"/api/glossary/{created['id']}", 403)
    call(env, "alice", "GET", "/api/glossary", 403, params={"archived": True})
    assert env["client"].get("/api/glossary").status_code == 401

    changed = call(env, "admin", "PUT", f"/api/glossary/{created['id']}", json={**OEE, "definition": "A × P × Q"})
    assert changed["definition"] == "A × P × Q" and changed["created_at"] == created["created_at"]
    actions = [r.action for r in env["db"].list_audit(20)]
    assert "glossary_add" in actions and "glossary_edit" in actions


def test_search_both_languages(env):
    add(env, OEE)
    add(env, SCRAP)
    names = lambda **p: [t["term"] for t in terms(env, "alice", **p)]  # noqa: E731
    assert names() == ["OEE", "Scrap rate"]
    assert names(q="КОЭФФИЦИЕНТ") == ["Scrap rate"]       # the Russian term, other case (not SQL LIKE)
    assert names(q="брак") == ["Scrap rate"]              # a synonym
    assert names(q="thrown") == ["Scrap rate"]            # the definition
    assert names(q="эффективность") == ["OEE"]            # the Russian definition / synonym
    assert names(q="DEFECT RATE") == ["Scrap rate"]
    assert names(q="quality") == ["OEE"]
    assert names(q="nothing") == []


def test_clean_values_and_duplicates(env):
    body = {"term": "  Takt  ", "definition": " Available time / demand ", "synonyms": ["takt", " Такт ", "такт", ""],
            "translations": {"ru": {"term": " Такт ", "definition": ""}, "de": {"term": "", "definition": " "}}}
    created = add(env, body)
    assert created["term"] == "Takt" and created["definition"] == "Available time / demand"
    assert created["synonyms"] == ["Такт"]  # the term itself and repeats are left out
    assert created["translations"] == {"ru": {"term": "Такт"}}
    assert "already" in add(env, {**body, "term": "TAKT"}, 409)["detail"]
    add(env, {**body, "definition": "   "}, 400)
    add(env, {**body, "translations": {"russian": {"term": "x"}}}, 422)
    add(env, {**body, "related": [{"kind": "table", "id": 1}]}, 422)


def test_related_links_are_checked_when_added(env):
    metric = call(env, "admin", "POST", "/api/metrics", json=PAID)
    q = save_builder(env, "alice")
    related = [
        {"kind": "metric", "id": metric["id"]},
        {"kind": "column", "connection": "shop", "table": "q_orders", "column": "total"},
        {"kind": "question", "id": q["id"]},
        {"kind": "metric", "id": metric["id"]},  # twice: kept once
    ]
    created = add(env, {**SCRAP, "related": related})
    assert [link["kind"] for link in created["related"]] == ["metric", "column", "question"]
    assert created["related"][0]["name"] == "Paid revenue" and created["related"][2]["name"] == q["name"]

    assert "Metric 999" in add(env, {**OEE, "related": [{"kind": "metric", "id": 999}]}, 400)["detail"]
    assert "Question 999" in add(env, {**OEE, "related": [{"kind": "question", "id": 999}]}, 400)["detail"]
    col = {"kind": "column", "connection": "shop", "table": "q_orders", "column": "nope"}
    assert "has no column" in add(env, {**OEE, "related": [col]}, 400)["detail"]
    assert "Unknown table" in add(env, {**OEE, "related": [{**col, "table": "nope"}]}, 400)["detail"]
    assert "Unknown connection" in add(env, {**OEE, "related": [{**col, "connection": "nope"}]}, 400)["detail"]

    # a link the term already has stays when the term is saved again, even if its target is gone
    call(env, "alice", "PATCH", f"/api/questions/{q['id']}", json={"archived": True})
    call(env, "alice", "DELETE", f"/api/questions/{q['id']}")
    saved = call(env, "admin", "PUT", f"/api/glossary/{created['id']}", json={**SCRAP, "related": related[:3]})
    assert saved["related"][2] == {"kind": "question", "id": q["id"], "missing": True}  # admins see it is broken
    assert [link["kind"] for link in terms(env, "alice")[0]["related"]] == ["metric", "column"]  # others don't see it


def test_people_only_see_links_they_may_open(env):
    metric = call(env, "admin", "POST", "/api/metrics", json=PAID)
    private = save_builder(env, "alice", name="Alice's own")
    shared_col = call(env, "admin", "POST", "/api/collections", json={"name": "Shared"})
    call(env, "admin", "PUT", f"/api/collections/{shared_col['id']}/permissions", json={"grants": [{"role": "all", "level": "view"}]})
    shared = save_builder(env, "admin", collection=shared_col["id"], name="Official scrap")
    add(env, {**SCRAP, "related": [
        {"kind": "metric", "id": metric["id"]},
        {"kind": "column", "connection": "shop", "table": "q_orders", "column": "qty"},
        {"kind": "question", "id": private["id"]},
        {"kind": "question", "id": shared["id"]},
    ]})
    seen = lambda who: [(x["kind"], x.get("name") or x.get("column")) for x in terms(env, who)[0]["related"]]  # noqa: E731
    assert seen("alice") == [("metric", "Paid revenue"), ("column", "qty"), ("question", "Alice's own"), ("question", "Official scrap")]
    assert seen("carol") == [("metric", "Paid revenue"), ("column", "qty"), ("question", "Official scrap")]
    assert seen("bob") == [("question", "Official scrap")]  # bob may not use the "shop" database

    # archived things disappear for people, admins see the flag
    call(env, "admin", "PATCH", f"/api/metrics/{metric['id']}", json={"archived": True})
    call(env, "admin", "PATCH", f"/api/questions/{shared['id']}", json={"archived": True})
    assert seen("carol") == [("column", "qty")]
    flags = [(x["kind"], x.get("archived", False)) for x in terms(env, "admin")[0]["related"]]
    assert flags == [("metric", True), ("column", False), ("question", False), ("question", True)]


def test_archive_restore_delete(env):
    oee = add(env, OEE)
    call(env, "admin", "DELETE", f"/api/glossary/{oee['id']}", 409)  # archive it first
    assert call(env, "admin", "PATCH", f"/api/glossary/{oee['id']}", json={"archived": True})["archived"] is True
    assert terms(env, "alice") == []
    assert [t["id"] for t in terms(env, "admin", archived=True)] == [oee["id"]]
    assert "restore it" in add(env, {**OEE, "term": "oee"}, 409)["detail"]
    call(env, "admin", "PATCH", f"/api/glossary/{oee['id']}", json={"archived": False})
    assert [t["id"] for t in terms(env, "alice")] == [oee["id"]]
    call(env, "admin", "PATCH", f"/api/glossary/{oee['id']}", json={"archived": True})
    assert call(env, "admin", "DELETE", f"/api/glossary/{oee['id']}") == {"deleted": oee["id"]}
    call(env, "admin", "PATCH", f"/api/glossary/{oee['id']}", 404, json={"archived": False})
    actions = [r.action for r in env["db"].list_audit(20)]
    assert {"glossary_archive", "glossary_restore", "glossary_delete"} <= set(actions)


def test_messages_in_russian(env):
    add(env, OEE)
    res = env["client"].post("/api/glossary", json={**OEE, "term": "oee"}, headers={**env["admin"], "Accept-Language": "ru"})
    assert res.status_code == 409 and res.json()["detail"] == "Термин 'OEE' уже есть"
