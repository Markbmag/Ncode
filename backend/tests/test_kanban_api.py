"""Ncode - Kanban API (roadmap §8c, K1): permissions, cards, action plan, comments, attachments,
history, live updates and positions."""

from __future__ import annotations

import zipfile
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api import create_app
from app.appdb import AppDB
from app.backup import make_backup, restore
from app.config import Settings
from app.crypto import Cipher, generate_key
from app.security import hash_password

from .helpers import login

PEOPLE = ("admin", "alice", "bob", "carol", "dave")
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 50
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60
PDF = b"%PDF-1.7\n" + b"x" * 100


@pytest.fixture()
def env(tmp_path):
    app_db = AppDB(tmp_path / "app.sqlite", cipher=Cipher(generate_key()))
    for name in PEOPLE:
        app_db.create_user(name, hash_password(f"{name}-pass-1"), "admin" if name == "admin" else "user")
    settings = Settings(search_workers=2, query_workers=2, kanban_max_upload_mb=1, scheduler_enabled=False)
    client = TestClient(create_app(settings, {}, app_db))
    with client:
        tokens = {n: login(client, n, f"{n}-pass-1").json()["token"] for n in PEOPLE}
        yield SimpleNamespace(
            client=client, db=app_db, tokens=tokens, root=tmp_path,
            h={n: {"Authorization": f"Bearer {t}"} for n, t in tokens.items()},
            ids={u.username: u.id for u in app_db.list_users()},
        )


def call(env, method, path, who="alice", status=200, **kw):
    res = env.client.request(method, f"/api/kanban{path}", headers={**env.h[who], **kw.pop("headers", {})}, **kw)
    assert res.status_code == status, res.text
    return res.json() if res.headers.get("content-type", "").startswith("application/json") else res


def new_board(env, who="alice", name="Production"):
    board = call(env, "POST", "/boards", who, json={"name": name})
    detail = call(env, "GET", f"/boards/{board['id']}", who)
    return board, detail


def new_card(env, bid, column_id, who="alice", status=200, **extra):
    return call(env, "POST", f"/boards/{bid}/cards", who, status=status,
                json={"column_id": column_id, "title": "Fix the press", **extra})


def upload(env, card_id, data, filename, who="alice", status=200, **headers):
    return call(env, "POST", f"/cards/{card_id}/attachments", who, status=status, content=data,
                params={"filename": filename, "content_type": headers.pop("ctype", "application/octet-stream")},
                headers={"Content-Type": "application/octet-stream", **headers})


def files_of(env, bid):
    folder = env.root / "kanban" / str(bid)
    return sorted(p.name for p in folder.iterdir() if p.is_file()) if folder.is_dir() else []


# ---------------------------------------------------------------------- boards and permissions
def test_new_board_has_three_columns_in_the_creators_language(env):
    board, detail = new_board(env)
    assert board["role"] == "owner" and board["owner"] == "alice" and board["can_manage"]
    assert [(c["name"], c["is_done"]) for c in detail["columns"]] == [
        ("To do", False), ("In progress", False), ("Done", True)]
    assert detail["members"] == [{"id": detail["members"][0]["id"], "user": env.ids["alice"], "group": None,
                                  "role": "owner", "name": "alice"}]
    assert {p["username"] for p in detail["people"]} == set(PEOPLE)
    ru = call(env, "POST", "/boards", json={"name": "Цех"}, headers={"Accept-Language": "ru"})
    names = [c["name"] for c in call(env, "GET", f"/boards/{ru['id']}")["columns"]]
    assert names == ["К выполнению", "В работе", "Готово"]


def test_everyone_reads_members_write_owners_manage(env):
    board, detail = new_board(env)
    bid, todo = board["id"], detail["columns"][0]["id"]
    # bob is not a member: he sees the board, read only
    listed = {b["id"]: b for b in call(env, "GET", "/boards", "bob")["boards"]}
    assert listed[bid]["role"] is None and listed[bid]["can_edit"] is False
    card = new_card(env, bid, todo)
    assert call(env, "GET", f"/cards/{card['id']}", "bob")["title"] == "Fix the press"
    new_card(env, bid, todo, "bob", status=403)
    call(env, "PATCH", f"/cards/{card['id']}", "bob", status=403, json={"title": "x"})
    call(env, "POST", f"/boards/{bid}/columns", "bob", status=403, json={"name": "Waiting"})
    call(env, "PATCH", f"/boards/{bid}", "bob", status=403, json={"name": "Mine"})

    # bob as an editor writes, but does not manage
    members = call(env, "PUT", f"/boards/{bid}/members", json={"members": [
        {"user": env.ids["alice"], "role": "owner"}, {"user": env.ids["bob"], "role": "editor"}]})["members"]
    assert [(m["name"], m["role"]) for m in members] == [("alice", "owner"), ("bob", "editor")]
    assert call(env, "GET", "/boards", "bob")["boards"][0]["role"] == "editor"
    new_card(env, bid, todo, "bob")
    call(env, "PATCH", f"/boards/{bid}", "bob", status=403, json={"name": "Mine"})
    call(env, "PUT", f"/boards/{bid}/members", "bob", status=403, json={"members": []})
    res = env.client.patch(f"/api/kanban/boards/{bid}", json={"name": "x"}, headers={**env.h["bob"], "Accept-Language": "ru"})
    assert res.json()["detail"] == "Это могут сделать только владельцы доски"

    # carol through a group
    new_card(env, bid, todo, "carol", status=403)
    gid = env.db.save_group(None, "Shift A", None, ())
    env.db.set_group_members(gid, [env.ids["carol"]])
    login_again = login(env.client, "carol", "carol-pass-1").json()["token"]
    env.h["carol"] = {"Authorization": f"Bearer {login_again}"}
    call(env, "PUT", f"/boards/{bid}/members", json={"members": [
        *members, {"group": gid, "role": "owner"}]})
    new_card(env, bid, todo, "carol")
    assert call(env, "GET", f"/boards/{bid}", "carol")["board"]["role"] == "owner"
    call(env, "PATCH", f"/boards/{bid}", "carol", json={"description": "Line 2"})

    # a board keeps an owner; unknown people are refused
    call(env, "PUT", f"/boards/{bid}/members", status=400, json={"members": [{"user": env.ids["bob"], "role": "editor"}]})
    call(env, "PUT", f"/boards/{bid}/members", status=400, json={"members": [{"user": 999, "role": "owner"}]})
    call(env, "PUT", f"/boards/{bid}/members", status=400, json={"members": [{"role": "owner"}]})

    # admins do everything, without being members
    call(env, "PATCH", f"/boards/{bid}", "admin", json={"name": "Renamed by admin"})
    call(env, "PUT", f"/boards/{bid}/members", "admin", json={"members": [{"user": env.ids["dave"], "role": "owner"}]})
    detail = call(env, "GET", f"/boards/{bid}", "dave")
    assert detail["board"]["owner"] == "dave" and detail["board"]["role"] == "owner"
    assert call(env, "GET", f"/boards/{bid}", "alice")["board"]["role"] is None
    # deleting the group takes it off the board
    call(env, "PUT", f"/boards/{bid}/members", "dave", json={"members": [
        {"user": env.ids["dave"], "role": "owner"}, {"group": gid, "role": "editor"}]})
    env.db.delete_group(gid)
    assert [m["name"] for m in call(env, "GET", f"/boards/{bid}")["members"]] == ["dave"]


def test_archive_restore_and_delete_a_board(env):
    board, detail = new_board(env)
    bid = board["id"]
    card = new_card(env, bid, detail["columns"][0]["id"])
    upload(env, card["id"], PNG, "photo.png")
    call(env, "PUT", f"/boards/{bid}/members", json={"members": [
        {"user": env.ids["alice"], "role": "owner"}, {"user": env.ids["bob"], "role": "editor"}]})
    call(env, "DELETE", f"/boards/{bid}", status=409)
    call(env, "PATCH", f"/boards/{bid}", "bob", status=403, json={"archived": True})
    assert call(env, "PATCH", f"/boards/{bid}", json={"archived": True})["archived"] is True
    # archived: gone from the list, visible to members and admins in the archive, read only
    assert bid not in [b["id"] for b in call(env, "GET", "/boards", "dave")["boards"]]
    assert [b["id"] for b in call(env, "GET", "/boards?archived=true", "bob")["boards"]] == [bid]
    assert call(env, "GET", "/boards?archived=true", "dave")["boards"] == []
    assert [b["id"] for b in call(env, "GET", "/boards?archived=true", "admin")["boards"]] == [bid]
    call(env, "GET", f"/boards/{bid}", "dave", status=404)
    call(env, "GET", f"/boards/{bid}", "bob")
    new_card(env, bid, detail["columns"][0]["id"], status=409)
    call(env, "PATCH", f"/boards/{bid}", json={"archived": False})
    call(env, "GET", f"/boards/{bid}", "dave")
    call(env, "PATCH", f"/boards/{bid}", json={"archived": True})
    call(env, "DELETE", f"/boards/{bid}", "bob", status=403)
    assert files_of(env, bid)
    call(env, "DELETE", f"/boards/{bid}")
    call(env, "GET", f"/boards/{bid}", status=404)
    call(env, "GET", f"/cards/{card['id']}", status=404)
    assert not (env.root / "kanban" / str(bid)).exists()


# ---------------------------------------------------------------------- columns and labels
def test_columns_and_labels(env):
    board, detail = new_board(env)
    bid = board["id"]
    todo, doing, done = (c["id"] for c in detail["columns"])
    waiting = call(env, "POST", f"/boards/{bid}/columns", json={"name": "Waiting", "color": "orange"})
    assert waiting["position"] > max(c["position"] for c in detail["columns"])
    call(env, "PATCH", f"/columns/{waiting['id']}", json={"name": "Waiting for parts", "position": 1500})
    names = [c["name"] for c in call(env, "GET", f"/boards/{bid}")["columns"]]
    assert names == ["To do", "Waiting for parts", "In progress", "Done"]
    call(env, "POST", f"/boards/{bid}/columns", status=422, json={"name": "x", "color": "url(javascript:1)"})

    card = new_card(env, bid, waiting["id"])
    res = env.client.delete(f"/api/kanban/columns/{waiting['id']}", headers={**env.h["alice"], "Accept-Language": "ru"})
    assert res.status_code == 409 and res.json()["detail"] == "Сначала перенесите её карточки"
    call(env, "POST", f"/cards/{card['id']}/move", json={"column_id": todo})
    call(env, "DELETE", f"/columns/{waiting['id']}")
    # archived cards do not keep a column: they move to the first other one
    call(env, "PATCH", f"/cards/{card['id']}", json={"archived": True})
    call(env, "DELETE", f"/columns/{todo}")
    assert call(env, "GET", f"/cards/{card['id']}")["column_id"] == doing
    call(env, "DELETE", f"/columns/{doing}")
    call(env, "DELETE", f"/columns/{done}", status=409)  # the last one

    urgent = call(env, "POST", f"/boards/{bid}/labels", json={"name": "Safety", "color": "red"})
    other, other_detail = new_board(env, name="Other")
    foreign = call(env, "POST", f"/boards/{other['id']}/labels", json={"name": "Other", "color": "blue"})
    card2 = new_card(env, bid, done, labels=[urgent["id"]])
    assert card2["labels"] == [urgent["id"]]
    new_card(env, bid, done, labels=[foreign["id"]], status=400)
    assert call(env, "PATCH", f"/labels/{urgent['id']}", json={"color": "#aa0000"})["color"] == "#aa0000"
    call(env, "DELETE", f"/labels/{urgent['id']}")
    assert call(env, "GET", f"/cards/{card2['id']}")["labels"] == []
    assert call(env, "GET", f"/boards/{bid}")["labels"] == []


# ---------------------------------------------------------------------- cards
def test_card_lifecycle_done_and_history(env):
    board, detail = new_board(env)
    bid = board["id"]
    todo, doing, done = (c["id"] for c in detail["columns"])
    first = new_card(env, bid, todo, title="First")
    second = new_card(env, bid, todo, title="Second", priority="high", due_date="2026-11-30",
                      assignees=[env.ids["alice"], env.ids["bob"]], description="**Check** the valve")
    cards = [c for c in call(env, "GET", f"/boards/{bid}")["cards"] if c["column_id"] == todo]
    assert [c["title"] for c in sorted(cards, key=lambda c: c["position"])] == ["Second", "First"]  # new on top
    assert second["assignees"] == sorted([env.ids["alice"], env.ids["bob"]]) and second["priority"] == "high"
    assert second["created_by"] == "alice" and second["description"] == "**Check** the valve"
    assert second["completed_at"] is None

    new_card(env, bid, todo, status=400, start_date="2026-12-01", due_date="2026-11-01")
    new_card(env, bid, todo, status=400, assignees=[999])
    new_card(env, bid, todo, status=422, priority="whenever")
    other, other_detail = new_board(env, name="Other")
    new_card(env, bid, other_detail["columns"][0]["id"], status=400)

    patched = call(env, "PATCH", f"/cards/{first['id']}", json={
        "title": "First, renamed", "priority": "urgent", "due_date": "2026-11-10", "assignees": [env.ids["carol"]]})
    assert patched["title"] == "First, renamed" and patched["assignees"] == [env.ids["carol"]]
    patched = call(env, "PATCH", f"/cards/{first['id']}", json={"due_date": None})
    assert patched["due_date"] is None

    moved = call(env, "POST", f"/cards/{first['id']}/move", json={"column_id": done, "position": 100})
    assert moved["column_id"] == done and moved["completed_at"] is not None
    summary = call(env, "GET", "/boards")["boards"][0]
    assert summary["id"] == bid and (summary["cards_open"], summary["cards_done"]) == (1, 1)
    moved = call(env, "POST", f"/cards/{first['id']}/move", json={"column_id": doing})
    assert moved["completed_at"] is None
    # a column that starts counting as done completes its cards
    call(env, "PATCH", f"/columns/{doing}", json={"is_done": True})
    assert call(env, "GET", f"/cards/{first['id']}")["completed_at"] is not None
    call(env, "PATCH", f"/columns/{doing}", json={"is_done": False})
    assert call(env, "GET", f"/cards/{first['id']}")["completed_at"] is None
    created_in_done = new_card(env, bid, done)
    assert created_in_done["completed_at"] is not None

    history = call(env, "GET", f"/cards/{first['id']}")["history"]
    actions = [h["action"] for h in history]
    assert actions[-1] == "card_created" and actions.count("card_moved") == 2 and "card_updated" in actions
    assert all(h["user"] == "alice" for h in history)
    move = next(h for h in history if h["action"] == "card_moved")
    assert move["details"] == {"from": "Done", "to": "In progress"}
    update = next(h for h in reversed(history) if h["action"] == "card_updated")
    assert update["details"]["changes"]["title"] == ["First", "First, renamed"]
    assert update["details"]["changes"]["assignees"] == {"added": ["carol"], "removed": []}
    board_history = call(env, "GET", f"/boards/{bid}/history")["history"]
    assert board_history[-1]["action"] == "board_created"

    # archive, then delete
    call(env, "DELETE", f"/cards/{first['id']}", status=409)
    call(env, "PATCH", f"/cards/{first['id']}", json={"archived": True})
    assert first["id"] not in [c["id"] for c in call(env, "GET", f"/boards/{bid}")["cards"]]
    archived = call(env, "GET", f"/boards/{bid}?archived_cards=true")["cards"]
    assert [c["id"] for c in archived] == [first["id"]] and archived[0]["archived"] is True
    call(env, "DELETE", f"/cards/{first['id']}")
    call(env, "GET", f"/cards/{first['id']}", status=404)
    assert call(env, "GET", f"/boards/{bid}/history")["history"][0]["details"] == {"title": "First, renamed"}


def test_positions_are_renumbered_when_too_close(env):
    board, detail = new_board(env)
    bid, todo = board["id"], detail["columns"][0]["id"]
    a = new_card(env, bid, todo, title="A", position=1.0)
    b = new_card(env, bid, todo, title="B", position=2.0)
    c = new_card(env, bid, todo, title="C", position=3.0)
    # the client puts C between A and B, much too close to A
    call(env, "POST", f"/cards/{c['id']}/move", json={"column_id": todo, "position": 1.0001})
    cards = sorted((x for x in call(env, "GET", f"/boards/{bid}")["cards"]), key=lambda x: x["position"])
    assert [x["title"] for x in cards] == ["A", "C", "B"]
    assert [x["position"] for x in cards] == [1024.0, 2048.0, 3072.0]
    # a normal move between neighbours keeps the client's position
    moved = call(env, "POST", f"/cards/{a['id']}/move", json={"column_id": todo, "position": 2500.0})
    assert moved["position"] == 2500.0
    assert b["id"]


# ---------------------------------------------------------------------- action plan
def test_action_plan_counts_and_who_ticked(env):
    board, detail = new_board(env)
    bid = board["id"]
    card = new_card(env, bid, detail["columns"][0]["id"])
    for text in ("Stop the line", "Change the seal", "Test run"):
        card = call(env, "POST", f"/cards/{card['id']}/checklist", json={"text": text})
    items = card["checklist_items"]
    assert [i["text"] for i in items] == ["Stop the line", "Change the seal", "Test run"]
    assert card["checklist"] == {"done": 0, "total": 3}
    call(env, "PATCH", f"/checklist/{items[0]['id']}", json={"done": True})
    card = call(env, "PATCH", f"/checklist/{items[1]['id']}", json={"done": True})
    assert card["checklist"] == {"done": 2, "total": 3}
    assert card["checklist_items"][0]["done_by"] == "alice" and card["checklist_items"][0]["done_at"]
    summary = next(c for c in call(env, "GET", f"/boards/{bid}")["cards"] if c["id"] == card["id"])
    assert summary["checklist"] == {"done": 2, "total": 3}
    card = call(env, "PATCH", f"/checklist/{items[1]['id']}", json={"done": False, "text": "Change both seals"})
    assert card["checklist_items"][1] == {**card["checklist_items"][1], "done": False, "done_by": None,
                                          "text": "Change both seals"}
    card = call(env, "PATCH", f"/checklist/{items[2]['id']}", json={"position": 0})
    assert card["checklist_items"][0]["text"] == "Test run"
    card = call(env, "DELETE", f"/checklist/{items[0]['id']}")
    assert card["checklist"] == {"done": 0, "total": 2}
    call(env, "PATCH", f"/checklist/{items[1]['id']}", "bob", status=403, json={"done": True})
    actions = [h["action"] for h in card["history"]]
    assert actions.count("item_added") == 3 and actions.count("item_done") == 2 and "item_undone" in actions
    assert "item_deleted" in actions


# ---------------------------------------------------------------------- comments
def test_comment_rules(env):
    board, detail = new_board(env)
    bid = board["id"]
    call(env, "PUT", f"/boards/{bid}/members", json={"members": [
        {"user": env.ids["alice"], "role": "owner"}, {"user": env.ids["bob"], "role": "editor"},
        {"user": env.ids["carol"], "role": "editor"}]})
    card = new_card(env, bid, detail["columns"][0]["id"])
    call(env, "POST", f"/cards/{card['id']}/comments", "dave", status=403, json={"body": "hi"})
    call(env, "POST", f"/cards/{card['id']}/comments", "bob", status=422, json={"body": "   "})
    card = call(env, "POST", f"/cards/{card['id']}/comments", "bob", json={"body": "Parts ordered"})
    comment = card["comments_list"][0]
    assert comment["user"] == "bob" and comment["edited_at"] is None and card["comments"] == 1
    call(env, "PATCH", f"/comments/{comment['id']}", "carol", status=403, json={"body": "changed"})
    call(env, "PATCH", f"/comments/{comment['id']}", "alice", status=403, json={"body": "changed"})
    card = call(env, "PATCH", f"/comments/{comment['id']}", "bob", json={"body": "Parts ordered, arrive Friday"})
    assert card["comments_list"][0]["body"] == "Parts ordered, arrive Friday" and card["comments_list"][0]["edited_at"]
    call(env, "DELETE", f"/comments/{comment['id']}", "carol", status=403)   # another editor
    card = call(env, "DELETE", f"/comments/{comment['id']}", "alice")        # the owner
    assert card["comments_list"] == [] and card["comments"] == 0
    card = call(env, "POST", f"/cards/{card['id']}/comments", "carol", json={"body": "Mine"})
    card = call(env, "DELETE", f"/comments/{card['comments_list'][0]['id']}", "carol")  # the author
    card = call(env, "POST", f"/cards/{card['id']}/comments", "carol", json={"body": "Again"})
    call(env, "DELETE", f"/comments/{card['comments_list'][0]['id']}", "admin")
    actions = [h["action"] for h in call(env, "GET", f"/cards/{card['id']}")["history"]]
    assert actions.count("comment_added") == 3 and actions.count("comment_deleted") == 3 and "comment_edited" in actions


# ---------------------------------------------------------------------- attachments
def test_attachments_upload_types_and_download(env):
    board, detail = new_board(env)
    bid = board["id"]
    card = new_card(env, bid, detail["columns"][0]["id"])
    cid = card["id"]
    # the type comes from the extension and the content, never from what the client says
    photo = upload(env, cid, PNG, "../../etc/Фото 1.PNG", ctype="text/html")
    assert photo["content_type"] == "image/png" and photo["filename"] == "Фото 1.PNG" and photo["size"] == len(PNG)
    assert photo["thumb_url"] is None and photo["card"]["attachments"] == 1 and photo["uploaded_by"] == "alice"
    res = call(env, "GET", f"/attachments/{photo['id']}", "dave")  # everyone who reads the board
    assert res.content == PNG and res.headers["content-type"] == "image/png"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["content-disposition"].startswith("inline;") and "filename*=utf-8''" in res.headers["content-disposition"]
    assert "sandbox" in res.headers["content-security-policy"]

    doc = upload(env, cid, PDF, "report.pdf")
    res = call(env, "GET", f"/attachments/{doc['id']}")
    assert res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"] == 'attachment; filename="report.pdf"'
    note = upload(env, cid, "Ölwechsel erledigt\n".encode(), "notes.txt")
    res = call(env, "GET", f"/attachments/{note['id']}")
    assert res.headers["content-type"] == "text/plain; charset=utf-8" and res.headers["content-disposition"].startswith("attachment")

    upload(env, cid, b"MZ\x90\x00", "tool.exe", status=400)
    upload(env, cid, b"<svg onload=alert(1)>", "x.svg", status=400)
    upload(env, cid, b"<html><script>alert(1)</script>", "fake.png", status=400)   # not a PNG inside
    upload(env, cid, b"\x00\x01binary", "notes.txt", status=400)
    upload(env, cid, b"", "empty.png", status=400)
    upload(env, cid, PNG, "photo.png", "bob", status=403)                            # not a member
    res = env.client.post(f"/api/kanban/cards/{cid}/attachments", params={"filename": "big.jpg"},
                          content=JPEG + b"\x00" * (1024 * 1024), headers={**env.h["alice"], "Accept-Language": "ru"})
    assert res.status_code == 413 and res.json()["detail"] == "Файл больше 1 МБ"
    assert len(files_of(env, bid)) == 3  # nothing left behind by the refused ones

    # the preview the browser made
    call(env, "POST", f"/attachments/{doc['id']}/thumb", status=400, content=JPEG)
    call(env, "POST", f"/attachments/{photo['id']}/thumb", status=400, content=b"GIF89a....")
    call(env, "GET", f"/attachments/{photo['id']}/thumb", status=404)
    thumb = call(env, "POST", f"/attachments/{photo['id']}/thumb", content=JPEG)
    assert thumb["thumb_url"] == f"/api/kanban/attachments/{photo['id']}/thumb"
    res = call(env, "GET", f"/attachments/{photo['id']}/thumb", "bob")
    assert res.content == JPEG and res.headers["content-type"] == "image/jpeg"
    call(env, "POST", f"/attachments/{photo['id']}/thumb", content=JPEG + b"\x01")  # replaces the old one
    assert len(files_of(env, bid)) == 4
    summary = next(c for c in call(env, "GET", f"/boards/{bid}")["cards"] if c["id"] == cid)
    assert summary["cover"] == thumb["thumb_url"] and summary["attachments"] == 3

    # in the backup, and back after a restore
    backup = make_backup(env.db.path, out_dir=env.root / "out")
    with zipfile.ZipFile(backup) as zf:
        names = zf.namelist()
    assert sum(n.startswith(f"kanban/{bid}/") for n in names) == 4
    restored_db = env.root / "restored" / "ncode.sqlite"
    manifest = restore(backup, restored_db)
    assert manifest["kanban_files"] == 4
    assert sorted(p.name for p in (restored_db.parent / "kanban" / str(bid)).iterdir()) == files_of(env, bid)

    card = call(env, "DELETE", f"/attachments/{photo['id']}")
    assert [a["id"] for a in card["attachments_list"]] == [doc["id"], note["id"]] and card["cover"] is None
    assert len(files_of(env, bid)) == 2
    call(env, "GET", f"/attachments/{photo['id']}", status=404)
    actions = [h["action"] for h in card["history"]]
    assert actions.count("attachment_added") == 3 and "attachment_deleted" in actions
    # deleting the card removes its files
    call(env, "PATCH", f"/cards/{cid}", json={"archived": True})
    call(env, "DELETE", f"/cards/{cid}")
    assert files_of(env, bid) == []


# ---------------------------------------------------------------------- live updates
def test_websocket_gets_an_event_after_a_change(env):
    board, detail = new_board(env)
    bid = board["id"]
    with env.client.websocket_connect(f"/ws/kanban/{bid}") as ws:
        ws.send_json({"token": env.tokens["bob"]})  # a reader is told about changes too
        assert ws.receive_json() == {"type": "subscribed", "board_id": bid}
        card = new_card(env, bid, detail["columns"][0]["id"])
        assert ws.receive_json() == {"type": "board_changed", "board_id": bid, "card_id": card["id"],
                                     "by": "alice", "action": "card_created"}
        call(env, "POST", f"/cards/{card['id']}/comments", json={"body": "Done?"})
        assert ws.receive_json()["action"] == "comment_added"
        call(env, "PATCH", f"/boards/{bid}", json={"name": "Renamed"})
        event = ws.receive_json()
        assert event["action"] == "board_updated" and "card_id" not in event
    assert env.client.app.state.kanban.events.watchers(bid) == 0

    with env.client.websocket_connect(f"/ws/kanban/{bid}") as ws:
        ws.send_json({"token": "wrong"})
        assert ws.receive_json() == {"type": "error", "status": "unauthorized"}
    with env.client.websocket_connect("/ws/kanban/9999") as ws:
        ws.send_json({"token": env.tokens["bob"]})
        assert ws.receive_json() == {"type": "error", "status": "unknown"}


# ---------------------------------------------------------------------- deleted users
def test_deleting_a_user_keeps_their_work(env):
    board, detail = new_board(env)
    bid = board["id"]
    call(env, "PUT", f"/boards/{bid}/members", json={"members": [
        {"user": env.ids["alice"], "role": "owner"}, {"user": env.ids["dave"], "role": "editor"}]})
    card = new_card(env, bid, detail["columns"][0]["id"], "dave", assignees=[env.ids["dave"], env.ids["alice"]])
    call(env, "POST", f"/cards/{card['id']}/comments", "dave", json={"body": "I'll take it"})
    upload(env, card["id"], PNG, "p.png", "dave")
    assert env.client.delete("/api/admin/users/dave", headers=env.h["admin"]).status_code == 200
    # a new user may get the same id: the old work must not become theirs
    env.db.create_user("erin", hash_password("erin-pass-1"))
    card = call(env, "GET", f"/cards/{card['id']}")
    assert card["assignees"] == [env.ids["alice"]]
    assert card["created_by"] == "dave" and card["comments_list"][0]["user"] == "dave"
    assert card["comments_list"][0]["user_id"] is None
    assert card["attachments_list"][0]["uploaded_by"] == "dave"
    assert {h["user"] for h in card["history"]} == {"dave"}
    detail = call(env, "GET", f"/boards/{bid}")
    assert [m["name"] for m in detail["members"]] == ["alice"]
    assert "dave" not in [p["username"] for p in detail["people"]]
    # dave's board, if he owned one, keeps his name too; a second deleted user gets their own id
    env.db.create_user("frank", hash_password("frank-pass-1"))
    frank = login(env.client, "frank", "frank-pass-1").json()["token"]
    fb = env.client.post("/api/kanban/boards", json={"name": "Frank's"}, headers={"Authorization": f"Bearer {frank}"}).json()
    env.db.delete_user("frank")
    assert call(env, "GET", "/boards?archived=false", "admin")["boards"][0]["owner"] == "frank"
    assert call(env, "GET", f"/boards/{fb['id']}")["board"]["owner"] == "frank"
    assert call(env, "GET", f"/cards/{card['id']}")["created_by"] == "dave"
