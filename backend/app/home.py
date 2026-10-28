"""The home page per person (roadmap M11).

    GET  /api/home               recently viewed, the "Start here" collection, your dashboards and
                                 the new-user checklist
    PUT  /api/admin/start-here   {"collection_id": 3} (admins; null = none): the collection everyone
                                 sees first on the home page (app setting "start_here_collection")
    GET  /api/account/prefs      your personal settings: a JSON object of at most 8 KB
    PUT  /api/account/prefs      {"checklist": {"done": [...], "hidden": false}}: sets the keys given
                                 (null removes one) and keeps the others, so two parts of the app
                                 never overwrite each other's settings

Opening a question or a dashboard (their GET handlers) calls record_view(): one row per person
and item in item_views, usually a single UPDATE; the newest 50 per person are kept. The home page
applies the library's access rules when it is read, so it only lists what the person can still see.

The checklist ticks itself. The browser marks what only it sees (a dashboard filter changed) in
the settings; the other steps are read from what the person did - a dashboard opened, a search
or a table browsed, a question run in the editor, a question saved - and then kept in the
settings too (the audit log they come from is pruned after a while).
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, delete, insert, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .appdb import AppDB, User, audit_table, users_table
from .content.store import ContentStore, Snapshot
from .content.tables import (
    app_settings_table, dashboards_table, favorites_table, item_views_table, questions_table,
)

logger = logging.getLogger(__name__)

KEEP_VIEWS = 50          # per person
RECENT_SHOWN = 12
DASHBOARDS_SHOWN = 6
START_HERE_SHOWN = 24
PREFS_MAX_BYTES = 8 * 1024
PREFS_MAX_DEPTH = 6
START_HERE_KEY = "start_here_collection"
STEPS = ("open_dashboard", "change_filter", "find_record", "ask_question", "save_question")

# a question run in the builder or the SQL editor: not a saved question, a dashboard card or a subscription
_EDITOR_RUN = text(
    "(CASE WHEN json_valid(options) THEN coalesce(json_extract(options, '$.question_id'), "
    "json_extract(options, '$.dashboard_id'), json_extract(options, '$.subscription_id')) END) IS NULL"
)


# ---------------------------------------------------------------- recently viewed

def record_view(engine: Engine, user: User, item_type: str, item_id: int, now: float | None = None) -> None:
    """Remember that `user` opened the item. Never fails the request that opened it."""
    now = time.time() if now is None else now
    t = item_views_table
    key = and_(t.c.user_id == user.id, t.c.item_type == item_type, t.c.item_id == item_id)
    try:
        with engine.begin() as conn:
            if conn.execute(update(t).where(key).values(viewed_at=now)).rowcount:
                return  # opened before: the usual case
            conn.execute(insert(t).values(user_id=user.id, item_type=item_type, item_id=item_id, viewed_at=now))
            # a new row: keep the newest KEEP_VIEWS (the subquery is NULL - nothing to delete - below that)
            cutoff = (
                select(t.c.viewed_at).where(t.c.user_id == user.id)
                .order_by(t.c.viewed_at.desc()).offset(KEEP_VIEWS - 1).limit(1).scalar_subquery()
            )
            conn.execute(delete(t).where(t.c.user_id == user.id, t.c.viewed_at < cutoff))
    except IntegrityError:
        pass  # a parallel request (another tab) recorded the same view
    except SQLAlchemyError:
        logger.warning("could not record that %s opened %s %s", user.username, item_type, item_id, exc_info=True)


# ---------------------------------------------------------------- personal settings

def _depth(value: Any, level: int = 0) -> int:
    if isinstance(value, dict):
        return max([_depth(v, level + 1) for v in value.values()] or [level + 1])
    if isinstance(value, list):
        return max([_depth(v, level + 1) for v in value] or [level + 1])
    return level


def check_prefs(prefs: dict[str, Any]) -> None:
    """A JSON object of at most PREFS_MAX_BYTES; the keys Ncode itself reads have the right shape."""
    if _depth(prefs) > PREFS_MAX_DEPTH:
        raise HTTPException(status_code=400, detail="Personal settings are nested too deeply")
    if len(json.dumps(prefs, separators=(",", ":"), ensure_ascii=False).encode()) > PREFS_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Personal settings are limited to 8 KB")
    checklist = prefs.get("checklist")
    if checklist is None:
        return
    if not isinstance(checklist, dict):
        raise HTTPException(status_code=400, detail="checklist must be an object")
    done = checklist.get("done", [])
    if not isinstance(done, list) or not all(isinstance(s, str) for s in done):
        raise HTTPException(status_code=400, detail="checklist.done must be a list of step names")
    unknown = [s for s in done if s not in STEPS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown checklist step {unknown[0]!r}")
    if not isinstance(checklist.get("hidden", False), bool):
        raise HTTPException(status_code=400, detail="checklist.hidden must be true or false")


def read_prefs(engine: Engine, user: User) -> dict[str, Any]:
    with engine.connect() as conn:
        raw = conn.execute(select(users_table.c.prefs).where(users_table.c.id == user.id)).scalar()
    try:
        prefs = json.loads(raw) if raw else {}
    except ValueError:
        prefs = {}
    return prefs if isinstance(prefs, dict) else {}


def write_prefs(engine: Engine, user: User, prefs: dict[str, Any]) -> None:
    """(Without a users row - sign-in turned off - the settings last for this answer only.)"""
    with engine.begin() as conn:
        conn.execute(update(users_table).where(users_table.c.id == user.id).values(prefs=json.dumps(prefs, ensure_ascii=False)))


def merge_prefs(current: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    out = dict(current)
    for key, value in changes.items():
        if value is None:
            out.pop(key, None)
        else:
            out[key] = value
    return out


# ---------------------------------------------------------------- the page

def _visible(snap: Snapshot, user: User, cid: int) -> bool:
    return snap.access(user, cid) is not None and not snap.hidden(cid)


def _item(item_type: str, row: Any, snap: Snapshot, user: User) -> dict[str, Any]:
    col = snap.collections.get(row.collection_id)
    out = {
        "type": item_type,
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "collection": {"id": col.id, "name": col.name, "mine": col.personal_owner_id == user.id} if col else None,
        "verified": {"by": row.verified_by, "at": row.verified_at} if row.verified_by else None,
    }
    if item_type == "question":
        out["kind"] = row.kind
    return out


_QUESTION_COLS = (
    questions_table.c.id, questions_table.c.name, questions_table.c.description, questions_table.c.collection_id,
    questions_table.c.archived, questions_table.c.kind, questions_table.c.verified_by, questions_table.c.verified_at,
)
_DASHBOARD_COLS = (
    dashboards_table.c.id, dashboards_table.c.name, dashboards_table.c.description, dashboards_table.c.collection_id,
    dashboards_table.c.archived, dashboards_table.c.verified_by, dashboards_table.c.verified_at,
    dashboards_table.c.owner_id, dashboards_table.c.updated_at,
)


class Home:
    def __init__(self, app_db: AppDB, content: ContentStore):
        self.app_db = app_db
        self.engine = app_db.engine
        self.content = content

    # ------------------------------------------------------------------ start here (an app setting)
    def start_here_id(self, snap: Snapshot) -> int | None:
        """The collection, while it exists (its creation time tells a new one with a reused id apart)."""
        with self.engine.connect() as conn:
            raw = conn.execute(select(app_settings_table.c.value).where(app_settings_table.c.key == START_HERE_KEY)).scalar()
        try:
            stored = json.loads(raw) if raw else {}
            cid, created = stored.get("collection_id"), stored.get("created_at")
        except (ValueError, AttributeError):
            return None
        col = snap.collections.get(cid) if isinstance(cid, int) else None
        return cid if col is not None and (created is None or abs(col.created_at - created) < 1e-6) else None

    def set_start_here(self, snap: Snapshot, cid: int | None, by: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(app_settings_table).where(app_settings_table.c.key == START_HERE_KEY))
            if cid is not None:
                value = json.dumps({"collection_id": cid, "created_at": snap.get(cid).created_at})
                conn.execute(insert(app_settings_table).values(key=START_HERE_KEY, value=value, secret=None, updated_at=time.time(), updated_by=by))

    def start_here(self, user: User, snap: Snapshot) -> dict[str, Any] | None:
        cid = self.start_here_id(snap)
        if cid is None or not _visible(snap, user, cid):
            return None
        col = snap.get(cid)
        with self.engine.connect() as conn:
            dashboards = conn.execute(select(*_DASHBOARD_COLS).where(
                dashboards_table.c.collection_id == cid, dashboards_table.c.archived.is_(False))).all()
            questions = conn.execute(select(*_QUESTION_COLS).where(
                questions_table.c.collection_id == cid, questions_table.c.archived.is_(False))).all()
        items = [_item("dashboard", r, snap, user) for r in dashboards] + [_item("question", r, snap, user) for r in questions]
        # the official answers first, then dashboards before questions, then by name
        items.sort(key=lambda i: (i["verified"] is None, i["type"] != "dashboard", i["name"].lower()))
        return {
            "id": col.id,
            "name": col.name,
            "description": col.description,
            "items": items[:START_HERE_SHOWN],
            "total": len(items),
            # people other than admins see it only when the collection (or one above it) is shared
            "shared": any(snap.grants.get(c.id) for c in snap.chain(cid)),
        }

    # ------------------------------------------------------------------ recently viewed, your dashboards
    def _views(self, user: User) -> list[Any]:
        t = item_views_table
        with self.engine.connect() as conn:
            return conn.execute(
                select(t.c.item_type, t.c.item_id, t.c.viewed_at).where(t.c.user_id == user.id)
                .order_by(t.c.viewed_at.desc()).limit(KEEP_VIEWS)
            ).all()

    def lists(self, user: User, snap: Snapshot, views: list[Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """(recently viewed, your dashboards: favourites, then recently opened, then your own)."""
        qids = [v.item_id for v in views if v.item_type == "question"]
        viewed_dids = [v.item_id for v in views if v.item_type == "dashboard"]
        with self.engine.connect() as conn:
            fav_rows = conn.execute(
                select(favorites_table.c.item_id).where(favorites_table.c.user_id == user.id, favorites_table.c.item_type == "dashboard")
                .order_by(favorites_table.c.created_at.desc())
            ).all()
            favs = [r.item_id for r in fav_rows]
            questions = {r.id: r for r in conn.execute(select(*_QUESTION_COLS).where(questions_table.c.id.in_(qids))).all()} if qids else {}
            wanted = viewed_dids + favs
            dashboards = {r.id: r for r in conn.execute(select(*_DASHBOARD_COLS).where(dashboards_table.c.id.in_(wanted))).all()} if wanted else {}
            own_rows = conn.execute(
                select(*_DASHBOARD_COLS).where(dashboards_table.c.owner_id == user.id, dashboards_table.c.archived.is_(False))
                .order_by(dashboards_table.c.updated_at.desc()).limit(KEEP_VIEWS)
            ).all()
        dashboards.update({r.id: r for r in own_rows})

        def usable(row: Any) -> bool:
            return row is not None and not row.archived and _visible(snap, user, row.collection_id)

        viewed_at = {(v.item_type, v.item_id): v.viewed_at for v in views}
        recent = []
        for v in views:
            row = (questions if v.item_type == "question" else dashboards).get(v.item_id)
            if usable(row):
                recent.append({**_item(v.item_type, row, snap, user), "viewed_at": v.viewed_at})
            if len(recent) >= RECENT_SHOWN:
                break

        fav_set = set(favs)
        own = [r.id for r in own_rows]
        mine, seen = [], set()
        for did in [*favs, *viewed_dids, *own]:
            row = dashboards.get(did)
            if did in seen or not usable(row):
                continue
            seen.add(did)
            mine.append({**_item("dashboard", row, snap, user), "favorite": did in fav_set, "viewed_at": viewed_at.get(("dashboard", did))})
            if len(mine) >= DASHBOARDS_SHOWN:
                break
        return recent, mine

    # ------------------------------------------------------------------ the checklist
    def _did(self, user: User, step: str, views: list[Any]) -> bool:
        """Whether the person has done `step` (as far as the server can tell)."""
        with self.engine.connect() as conn:
            if step == "open_dashboard":  # (views: the newest KEEP_VIEWS, all there are)
                return any(v.item_type == "dashboard" for v in views)
            if step == "save_question":
                return conn.execute(select(questions_table.c.id).where(questions_table.c.owner_id == user.id).limit(1)).first() is not None
            if step == "find_record":
                actions: tuple[str, ...] = ("search", "browse")
                extra: Any = None
            elif step == "ask_question":
                actions, extra = ("query", "sql", "federated"), _EDITOR_RUN
            else:
                return False  # only the browser sees it (a dashboard filter changed)
            stmt = select(audit_table.c.id).where(audit_table.c.username == user.username, audit_table.c.action.in_(actions))
            if extra is not None:
                stmt = stmt.where(extra)
            return conn.execute(stmt.limit(1)).first() is not None

    def checklist(self, user: User, prefs: dict[str, Any], views: list[Any]) -> dict[str, Any]:
        stored = prefs.get("checklist") if isinstance(prefs.get("checklist"), dict) else {}
        done = {s for s in stored.get("done", []) if s in STEPS} if isinstance(stored.get("done"), list) else set()
        hidden = stored.get("hidden") is True
        if not hidden:
            found = {s for s in STEPS if s not in done and self._did(user, s, views)}
            if found:
                done |= found
                try:  # kept, so pruning the audit log never unticks a step
                    write_prefs(self.engine, user, {**prefs, "checklist": {**stored, "done": [s for s in STEPS if s in done]}})
                except SQLAlchemyError:
                    logger.warning("could not keep the checklist of %s", user.username, exc_info=True)
        return {"steps": list(STEPS), "done": [s for s in STEPS if s in done], "hidden": hidden}

    def page(self, user: User) -> dict[str, Any]:
        snap = self.content.snapshot()
        views = self._views(user)
        recent, dashboards = self.lists(user, snap, views)
        return {
            "recent": recent,
            "start_here": self.start_here(user, snap),
            "dashboards": dashboards,
            "checklist": self.checklist(user, read_prefs(self.engine, user), views),
        }


class StartHereIn(BaseModel):
    collection_id: int | None = None


def register_home_routes(
    app: FastAPI,
    *,
    app_db: AppDB,
    content: ContentStore,
    current_user: Callable[..., User],
    require_admin: Callable[..., User],
) -> Home:
    home = Home(app_db, content)
    router = APIRouter(tags=["home"])

    @router.get("/api/home")
    def get_home(user: User = Depends(current_user)):
        return home.page(user)

    @router.put("/api/admin/start-here")
    def put_start_here(body: StartHereIn, admin: User = Depends(require_admin)):
        cid = body.collection_id
        snap = content.snapshot()
        if cid is not None:
            col = snap.collections.get(cid)
            if col is None:
                raise HTTPException(status_code=404, detail="Collection not found")
            if snap.personal_root(cid) is not None:
                raise HTTPException(status_code=400, detail="A personal collection is private: choose a shared collection")
            if snap.hidden(cid):
                raise HTTPException(status_code=409, detail=f"The collection {col.name!r} is archived. Restore it first, or choose another collection")
        home.set_start_here(snap, cid, admin.username)
        app_db.audit(admin.username, "settings", phrase=f"start here: collection {cid}" if cid else "start here: none", status="ok")
        return {"start_here": home.start_here(admin, content.snapshot())}

    @router.get("/api/account/prefs")
    def get_prefs(user: User = Depends(current_user)):
        return read_prefs(app_db.engine, user)

    @router.put("/api/account/prefs")
    def put_prefs(changes: dict[str, Any] = Body(...), user: User = Depends(current_user)):
        prefs = merge_prefs(read_prefs(app_db.engine, user), changes)
        check_prefs(prefs)
        write_prefs(app_db.engine, user, prefs)
        return prefs

    app.include_router(router)
    return home
