"""Ncode - Kanban API (roadmap §8c, K1). Signed-in users only; the rules are in app/kanban/store.py.

    GET    /api/kanban/boards?archived=false     {"boards": [board]}
    POST   /api/kanban/boards                    {name, description?, color?, template?: "basic"} -> board
    GET    /api/kanban/boards/{id}?archived_cards=false
                                                 {board, columns, labels, members, cards, people, groups}
    PATCH  /api/kanban/boards/{id}               {name?, description?, color?, archived?, private?, done_keep_days?}
                                                 -> board (owners). K4: private = members only; done_keep_days
                                                 0 | 7 | 14 | 30 (0: finished tasks stay on the board)
    DELETE /api/kanban/boards/{id}               an archived board, with its files (owners)
    GET    /api/kanban/boards/{id}/history?limit=100   {"history": [...]} the board's latest changes
    GET    /api/kanban/boards/{id}/finished?q=&limit=50&offset=0   {cards, total, keep_days} tasks that left the
                                                 board because they were finished more than keep_days ago (K4)
    GET    /api/kanban/my?done_days=7            {cards, boards: [{id, name, color, can_edit, columns, labels}], people}
                                                 the caller's tasks on every board they can see (K3)
    PUT    /api/kanban/boards/{id}/members       {members: [{user: id | group: id, role}]} -> {"members"}
    POST   /api/kanban/boards/{id}/columns       {name, color?, is_done?} -> column
    PATCH  /api/kanban/columns/{id}              {name?, color?, is_done?, position?} -> column
    DELETE /api/kanban/columns/{id}              only when no open card is in it (409 otherwise)
    POST   /api/kanban/boards/{id}/labels        {name, color} -> label
    PATCH  /api/kanban/labels/{id}               {name?, color?} -> label
    DELETE /api/kanban/labels/{id}
    POST   /api/kanban/boards/{id}/cards         {column_id, title, description?, priority?, start_date?, due_date?,
                                                  assignees?, assignee_names?, labels?, position?, repeat?} -> card
                                                 (at the top by default; assignee_names: people who are not Ncode users)
    GET    /api/kanban/cards/{id}                -> card
    PATCH  /api/kanban/cards/{id}                {title?, description?, priority?, start_date?, due_date?, assignees?,
                                                  labels?, archived?, repeat?} -> card
                                                 repeat: daily | weekdays | weekly | monthly | null (K3)
    POST   /api/kanban/cards/{id}/move           {column_id, position?} -> card (+ "next": {id, due_date, column}
                                                 when a repeating card is done and its next one was made, K3)
    POST   /api/kanban/cards/{id}/links          {kind: "dashboard" | "question", target_id} -> card (K3)
    DELETE /api/kanban/links/{id}                -> card
    DELETE /api/kanban/cards/{id}                an archived card, with its files
    POST   /api/kanban/cards/{id}/checklist      {text} -> card
    PATCH  /api/kanban/checklist/{id}            {text?, done?, position?} -> card
    DELETE /api/kanban/checklist/{id}            -> card
    POST   /api/kanban/cards/{id}/comments       {body} -> card
    PATCH  /api/kanban/comments/{id}             {body} -> card (the author)
    DELETE /api/kanban/comments/{id}             -> card (the author, owners, admins)
    POST   /api/kanban/cards/{id}/attachments?filename=...   body = the file -> attachment + {"card": card}
    POST   /api/kanban/attachments/{id}/thumb    body = a small JPEG / PNG / WebP made by the browser -> attachment
    GET    /api/kanban/attachments/{id}          the file (images inline, everything else as a download)
    GET    /api/kanban/attachments/{id}/thumb
    DELETE /api/kanban/attachments/{id}          -> card
    WS     /ws/kanban/{board_id}                 first client message {"token": "..."}; the server answers
                                                 {"type": "subscribed"} and then sends {"type": "board_changed",
                                                 "board_id", "card_id"?, "by", "action"} after every change
                                                 ({"type": "ping"} every 30 s keeps proxies from closing it)

Card mutations answer with the whole card (summary fields + description, checklist_items,
comments_list, attachments_list, history), so the drawer can redraw from the answer.
"""

from __future__ import annotations

import asyncio
import os
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Callable, Literal
from urllib.parse import unquote

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from ..appdb import AppDB, User
from ..config import Settings
from ..i18n import parse_language
from .attachments import (
    HEAD, INLINE, THUMB_MAX, FileStore, clean_filename, content_matches, extension, new_name, thumb_kind, type_for,
)
from .events import BoardEvents
from .store import KanbanStore, LinkNames

PING_SEC = 30
SAMPLE = 8192  # bytes of a text file checked for binary content
SAFE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    "Cache-Control": "private, max-age=300",
    "Referrer-Policy": "no-referrer",
}

Color = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^(#[0-9a-fA-F]{6}|[a-z]{2,10}(\.[0-9]{2,3})?)$")]
Priority = Literal["low", "normal", "high", "urgent"]
Position = Annotated[float, Field(allow_inf_nan=False)]
Repeat = Literal["daily", "weekdays", "weekly", "monthly"]


def _text(max_len: int) -> Any:
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=max_len)]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BoardIn(_In):
    name: _text(120)
    description: str | None = Field(default=None, max_length=5000)
    color: Color | None = None
    template: Literal["basic"] = "basic"
    private: bool = False                # K4: only its members see it


class BoardPatch(_In):
    name: _text(120) | None = None
    description: str | None = Field(default=None, max_length=5000)
    color: Color | None = None
    archived: bool | None = None
    private: bool | None = None                              # K4
    done_keep_days: Literal[0, 7, 14, 30] | None = None      # K4: 0 = finished tasks stay


class MemberIn(BaseModel):  # extra fields (id, name from GET) are ignored: the list can be sent back as read
    user: int | None = None
    group: int | None = None
    role: Literal["editor", "owner"] = "editor"


class MembersIn(_In):
    members: list[MemberIn] = Field(max_length=500)


class ColumnIn(_In):
    name: _text(80)
    color: Color | None = None
    is_done: bool = False


class ColumnPatch(_In):
    name: _text(80) | None = None
    color: Color | None = None
    is_done: bool | None = None
    position: Position | None = None


class LabelIn(_In):
    name: _text(60)
    color: Color


class LabelPatch(_In):
    name: _text(60) | None = None
    color: Color | None = None


class CardIn(_In):
    column_id: int
    title: _text(300)
    description: str | None = Field(default=None, max_length=20000)
    priority: Priority = "normal"
    start_date: date | None = None
    due_date: date | None = None
    assignees: list[int] = Field(default_factory=list, max_length=50)
    labels: list[int] = Field(default_factory=list, max_length=50)
    position: Position | None = None
    repeat: Repeat | None = None
    assignee_names: list[Annotated[str, StringConstraints(max_length=200)]] = Field(default_factory=list, max_length=50)


class CardPatch(_In):
    title: _text(300) | None = None
    description: str | None = Field(default=None, max_length=20000)
    priority: Priority | None = None
    start_date: date | None = None
    due_date: date | None = None
    assignees: list[int] | None = Field(default=None, max_length=50)
    labels: list[int] | None = Field(default=None, max_length=50)
    archived: bool | None = None
    repeat: Repeat | None = None        # null: no longer repeats
    assignee_names: list[Annotated[str, StringConstraints(max_length=200)]] | None = Field(default=None, max_length=50)


class LinkIn(_In):
    kind: Literal["dashboard", "question"]
    target_id: int


class MoveIn(_In):
    column_id: int
    position: Position | None = None


class ItemIn(_In):
    text: _text(500)


class ItemPatch(_In):
    text: _text(500) | None = None
    done: bool | None = None
    position: Position | None = None


class CommentIn(_In):
    body: _text(10000)


async def _receive(request: Request, dest: Path, limit: int, too_big: str) -> tuple[int, bytes, bytes]:
    """Streams the request body into dest; (size, the first bytes, the first SAMPLE bytes)."""
    size = 0
    sample = b""
    with open(dest, "wb") as fh:
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise HTTPException(status_code=413, detail=too_big)
            if len(sample) < SAMPLE:
                sample += chunk[: SAMPLE - len(sample)]
            await asyncio.to_thread(fh.write, chunk)
    return size, sample[:HEAD], sample


def _declared_too_big(request: Request, limit: int, too_big: str) -> None:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail=too_big)


def register_kanban_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    settings: Settings,
    current_user: Callable[..., User],
    user_from_token: Callable[[str | None], User | None],
    link_names: LinkNames | None = None,
) -> KanbanStore:
    files = FileStore(Path(app_db.path).parent / "kanban")
    files.sweep_partial()
    events = BoardEvents()
    store = KanbanStore(app_db.engine, files, events, link_names)
    router = APIRouter(prefix="/api/kanban", tags=["kanban"])

    # ------------------------------------------------------------------ boards
    @router.get("/boards")
    def list_boards(archived: bool = False, user: User = Depends(current_user)):
        return {"boards": store.list_boards(user, archived)}

    @router.post("/boards")
    def create_board(body: BoardIn, request: Request, user: User = Depends(current_user)):
        lang = parse_language(request.headers.get("accept-language"))
        return store.create_board(user, name=body.name, description=body.description, color=body.color,
                                  template=body.template, lang=lang, private=body.private)

    @router.get("/boards/{board_id}")
    def get_board(board_id: int, archived_cards: bool = False, user: User = Depends(current_user)):
        return store.get_board(user, board_id, archived_cards)

    @router.patch("/boards/{board_id}")
    def patch_board(board_id: int, body: BoardPatch, user: User = Depends(current_user)):
        changes = body.model_dump(exclude_unset=True)
        for key in ("name", "archived", "private", "done_keep_days"):
            if key in changes and changes[key] is None:
                del changes[key]
        return store.update_board(user, board_id, changes)

    @router.delete("/boards/{board_id}")
    def delete_board(board_id: int, user: User = Depends(current_user)):
        name = store.delete_board(user, board_id)
        app_db.audit(user.username, "kanban_board_delete", phrase=f"{name} (board {board_id})", status="ok")
        return {"deleted": board_id}

    @router.get("/boards/{board_id}/finished")
    def finished_earlier(board_id: int, q: str = Query("", max_length=200), limit: int = Query(50, ge=1, le=200),
                         offset: int = Query(0, ge=0), user: User = Depends(current_user)):
        return store.finished_earlier(user, board_id, q, limit, offset)

    @router.get("/my")
    def my_tasks(done_days: int = Query(7, ge=0, le=60), user: User = Depends(current_user)):
        return store.my_cards(user, done_days)

    @router.get("/boards/{board_id}/history")
    def board_history(board_id: int, limit: int = Query(100, ge=1, le=500), user: User = Depends(current_user)):
        return {"history": store.board_history(user, board_id, limit)}

    @router.put("/boards/{board_id}/members")
    def set_members(board_id: int, body: MembersIn, user: User = Depends(current_user)):
        entries = [(m.user, m.group, m.role) for m in body.members]
        return {"members": store.set_members(user, board_id, entries)}

    # ------------------------------------------------------------------ columns and labels
    @router.post("/boards/{board_id}/columns")
    def create_column(board_id: int, body: ColumnIn, user: User = Depends(current_user)):
        return store.create_column(user, board_id, name=body.name, color=body.color, is_done=body.is_done)

    @router.patch("/columns/{column_id}")
    def patch_column(column_id: int, body: ColumnPatch, user: User = Depends(current_user)):
        changes = body.model_dump(exclude_unset=True)
        for key in ("name", "is_done", "position"):
            if key in changes and changes[key] is None:
                del changes[key]
        return store.update_column(user, column_id, changes)

    @router.delete("/columns/{column_id}")
    def delete_column(column_id: int, user: User = Depends(current_user)):
        store.delete_column(user, column_id)
        return {"deleted": column_id}

    @router.post("/boards/{board_id}/labels")
    def create_label(board_id: int, body: LabelIn, user: User = Depends(current_user)):
        return store.create_label(user, board_id, name=body.name, color=body.color)

    @router.patch("/labels/{label_id}")
    def patch_label(label_id: int, body: LabelPatch, user: User = Depends(current_user)):
        return store.update_label(user, label_id, body.model_dump(exclude_unset=True))

    @router.delete("/labels/{label_id}")
    def delete_label(label_id: int, user: User = Depends(current_user)):
        store.delete_label(user, label_id)
        return {"deleted": label_id}

    # ------------------------------------------------------------------ cards
    @router.post("/boards/{board_id}/cards")
    def create_card(board_id: int, body: CardIn, user: User = Depends(current_user)):
        return store.create_card(user, board_id, **body.model_dump())

    @router.get("/cards/{card_id}")
    def get_card(card_id: int, user: User = Depends(current_user)):
        return store.get_card(user, card_id)

    @router.patch("/cards/{card_id}")
    def patch_card(card_id: int, body: CardPatch, user: User = Depends(current_user)):
        changes = body.model_dump(exclude_unset=True)
        for key in ("title", "priority", "archived"):
            if key in changes and changes[key] is None:
                del changes[key]
        return store.update_card(user, card_id, changes)

    @router.post("/cards/{card_id}/links")
    def add_link(card_id: int, body: LinkIn, user: User = Depends(current_user)):
        return store.add_link(user, card_id, body.kind, body.target_id)

    @router.delete("/links/{link_id}")
    def remove_link(link_id: int, user: User = Depends(current_user)):
        return store.remove_link(user, link_id)

    @router.post("/cards/{card_id}/move")
    def move_card(card_id: int, body: MoveIn, user: User = Depends(current_user)):
        return store.move_card(user, card_id, body.column_id, body.position)

    @router.delete("/cards/{card_id}")
    def delete_card(card_id: int, user: User = Depends(current_user)):
        store.delete_card(user, card_id)
        return {"deleted": card_id}

    @router.post("/cards/{card_id}/checklist")
    def add_item(card_id: int, body: ItemIn, user: User = Depends(current_user)):
        return store.add_item(user, card_id, body.text)

    @router.patch("/checklist/{item_id}")
    def patch_item(item_id: int, body: ItemPatch, user: User = Depends(current_user)):
        return store.update_item(user, item_id, body.model_dump(exclude_unset=True))

    @router.delete("/checklist/{item_id}")
    def delete_item(item_id: int, user: User = Depends(current_user)):
        return store.delete_item(user, item_id)

    @router.post("/cards/{card_id}/comments")
    def add_comment(card_id: int, body: CommentIn, user: User = Depends(current_user)):
        return store.add_comment(user, card_id, body.body)

    @router.patch("/comments/{comment_id}")
    def edit_comment(comment_id: int, body: CommentIn, user: User = Depends(current_user)):
        return store.edit_comment(user, comment_id, body.body)

    @router.delete("/comments/{comment_id}")
    def delete_comment(comment_id: int, user: User = Depends(current_user)):
        return store.delete_comment(user, comment_id)

    # ------------------------------------------------------------------ attachments
    @router.post("/cards/{card_id}/attachments")
    async def upload_attachment(
        card_id: int,
        request: Request,
        filename: str | None = Query(None, max_length=1000),
        content_type: str | None = Query(None, max_length=200),  # accepted, never used: the server decides the type
        user: User = Depends(current_user),
    ):
        raw = filename or unquote(request.headers.get("x-filename") or "")
        if not raw.strip():
            raise HTTPException(status_code=400, detail="Give the file's name (filename)")
        name = clean_filename(raw)
        known = type_for(name)
        if known is None:
            raise HTTPException(status_code=400, detail=(
                f"Files of this type cannot be attached ({extension(name) or name}). "
                "Allowed: images, PDF, office documents and text files"))
        mime, kind = known
        board_id = await run_in_threadpool(store.check_card_edit, user, card_id)
        mb = settings.kanban_max_upload_mb
        limit = mb * 1024 * 1024
        too_big = f"The file is larger than {mb} MB"
        _declared_too_big(request, limit, too_big)
        tmp = files.temp(board_id)
        stored = new_name(extension(name))
        try:
            size, head, sample = await _receive(request, tmp, limit, too_big)
            if size == 0:
                raise HTTPException(status_code=400, detail="The file is empty")
            if not content_matches(kind, head, sample):
                raise HTTPException(status_code=400, detail=f"The file's content does not match its type ({extension(name)})")
            os.replace(tmp, files.board_dir(board_id) / stored)
        finally:
            tmp.unlink(missing_ok=True)
        try:
            return await run_in_threadpool(lambda: store.add_attachment(
                user, card_id, filename=name, content_type=mime, size=size, stored=stored))
        except BaseException:
            files.remove(board_id, [stored])
            raise

    @router.post("/attachments/{att_id}/thumb")
    async def upload_thumb(att_id: int, request: Request, user: User = Depends(current_user)):
        board_id = await run_in_threadpool(store.attachment_for_thumb, user, att_id)
        too_big = "The preview is too large"
        _declared_too_big(request, THUMB_MAX, too_big)
        tmp = files.temp(board_id)
        stored = None
        try:
            size, head, _sample = await _receive(request, tmp, THUMB_MAX, too_big)
            ext = thumb_kind(head) if size else None
            if ext is None:
                raise HTTPException(status_code=400, detail="The preview must be a JPEG, PNG or WebP image")
            stored = new_name(ext)
            os.replace(tmp, files.board_dir(board_id) / stored)
        finally:
            tmp.unlink(missing_ok=True)
        try:
            return await run_in_threadpool(store.set_thumb, user, att_id, stored)
        except BaseException:
            files.remove(board_id, [stored])
            raise

    def _send(att_id: int, user: User, thumb: bool) -> FileResponse:
        row, board_id = store.attachment_file(user, att_id, thumb)
        path = files.path(board_id, row.thumb if thumb else row.file)
        if path is None or not path.is_file():
            raise HTTPException(status_code=404, detail="The file is missing on the server")
        if thumb:
            ext = extension(row.thumb)
            media = {".png": "image/png", ".webp": "image/webp"}.get(ext, "image/jpeg")
            return FileResponse(path, media_type=media, headers=SAFE_HEADERS, content_disposition_type="inline",
                                filename=f"{Path(row.filename).stem or 'preview'}-preview{ext}")
        return FileResponse(path, media_type=row.content_type, headers=SAFE_HEADERS, filename=row.filename,
                            content_disposition_type="inline" if row.content_type in INLINE else "attachment")

    @router.get("/attachments/{att_id}")
    def download_attachment(att_id: int, user: User = Depends(current_user)):
        return _send(att_id, user, thumb=False)

    @router.get("/attachments/{att_id}/thumb")
    def download_thumb(att_id: int, user: User = Depends(current_user)):
        return _send(att_id, user, thumb=True)

    @router.delete("/attachments/{att_id}")
    def delete_attachment(att_id: int, user: User = Depends(current_user)):
        return store.delete_attachment(user, att_id)

    app.include_router(router)

    # ------------------------------------------------------------------ live updates
    @app.websocket("/ws/kanban/{board_id}")
    async def board_socket(websocket: WebSocket, board_id: int):
        await websocket.accept()
        queue: asyncio.Queue | None = None
        tasks: list[asyncio.Future] = []
        try:
            # like the search WebSocket (app/api.py): the token comes as the first message, not in the URL
            try:
                first = await asyncio.wait_for(websocket.receive_json(), timeout=5)
                token = first.get("token") if isinstance(first, dict) else None
            except (asyncio.TimeoutError, ValueError, KeyError):
                token = None
            user = await asyncio.to_thread(user_from_token, token)
            if user is None:
                await websocket.send_json({"type": "error", "status": "unauthorized"})
                return
            if not await asyncio.to_thread(store.readable, user, board_id):
                await websocket.send_json({"type": "error", "status": "unknown"})
                return
            queue = events.subscribe(board_id)
            await websocket.send_json({"type": "subscribed", "board_id": board_id})
            receiver = asyncio.ensure_future(websocket.receive())
            getter = asyncio.ensure_future(queue.get())
            tasks = [receiver, getter]
            while True:
                done, _pending = await asyncio.wait({receiver, getter}, timeout=PING_SEC,
                                                    return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    await websocket.send_json({"type": "ping"})
                    continue
                if getter in done:
                    await websocket.send_json(getter.result())
                    getter = asyncio.ensure_future(queue.get())
                if receiver in done:
                    if receiver.result().get("type") == "websocket.disconnect":
                        break
                    receiver = asyncio.ensure_future(websocket.receive())  # client messages are not used
                tasks = [receiver, getter]
        except (WebSocketDisconnect, OSError):  # the tab was closed (uvicorn's ClientDisconnected is an OSError)
            pass
        finally:
            for t in tasks:
                t.cancel()
            if queue is not None:
                events.unsubscribe(board_id, queue)
            try:
                await websocket.close()
            except (RuntimeError, WebSocketDisconnect, OSError):
                pass  # already closed, or the other side is gone

    app.state.kanban = store
    return store
