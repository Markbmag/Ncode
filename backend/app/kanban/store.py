"""Kanban data and permission rules (roadmap §8c, K1).

Who may do what:
    read    every signed-in user, every board that is not archived (archived boards: members, admins)
    write   members of the board (a person, or through a group; role "editor" or "owner") and admins:
            columns, labels, cards, the action plan, comments, attachments
    manage  owners (role "owner", also through a group) and admins: rename / describe / colour,
            members, archive / restore, delete (archived boards only)
    comments: the author edits; the author, an owner or an admin deletes

Every change writes a history row (kanban_activity: who, what, JSON details) in the same
transaction and, after the commit, pushes {"type": "board_changed", ...} to the board's watchers
(app/kanban/events.py). Positions are floats: the client sends one between the neighbours, and a
column (or an action plan) is renumbered when two of them get too close.

Deleted users: their cards, comments, files and history stay and keep showing their name. Ids can
be reused by a later user, so these rows are moved to a negative id with a "user_deleted"
tombstone (in kanban_activity, board 0) that keeps the name; assignments and memberships go.
"""

from __future__ import annotations

import calendar
import json
import time
from datetime import date, timedelta
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Iterator

from fastapi import HTTPException
from sqlalchemy import case, delete, func, insert, or_, select, update
from sqlalchemy.engine import Connection, Engine

from ..appdb import User, groups_table, users_table
from .attachments import INLINE, FileStore, is_image
from .events import BoardEvents
from .tables import (
    activity_table, attachments_table, board_members_table, boards_table, card_assignees_table, card_labels_table,
    card_links_table, card_names_table, cards_table, checklist_table, columns_table, comments_table, labels_table,
)

API = "/api/kanban"
STEP = 1024.0
MIN_GAP = 1e-3      # neighbours closer than this: the column is renumbered
MAX_ABS = 1e12      # positions beyond this: renumbered as well
PRIORITIES = ("low", "normal", "high", "urgent")
ROLES = ("editor", "owner")
HISTORY_LIMIT = 200
TOMBSTONE = "user_deleted"
REPEATS = ("daily", "weekdays", "weekly", "monthly")   # K3: how often a task comes back
LINK_KINDS = ("dashboard", "question")                  # K3: what a task may point at in Search & BI

# K3: names of Search & BI items as one person may see them: {(kind, id): name, or None when hidden or gone}
LinkNames = Callable[[User, list[tuple[str, int]]], dict[tuple[str, int], str | None]]


MAX_NAMES = 20  # people by name on one task


def clean_names(names: Iterable[str] | None) -> list[str]:
    """Names of people who are not Ncode users, as typed: trimmed, inner spaces collapsed, each once
    (whatever the capitals), in the order given."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in names or []:
        name = " ".join(str(raw).split())[:80]
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            out.append(name)
    return out[:MAX_NAMES]


def next_due(rule: str, due: date | None, today: date) -> date:
    """The next date of a repeating task after it is done: one step on from its due date (from today when
    it had none), then on until it is in the future, so a task finished late is not due in the past."""
    def step(d: date) -> date:
        if rule == "daily":
            return d + timedelta(days=1)
        if rule == "weekdays":
            d += timedelta(days=1)
            while d.weekday() >= 5:
                d += timedelta(days=1)
            return d
        if rule == "weekly":
            return d + timedelta(days=7)
        # monthly: the same day next month, the last day when the month is shorter (31 Jan -> 28 Feb)
        y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
        return date(y, m, min(anchor, calendar.monthrange(y, m)[1]))

    start = due or today
    anchor = start.day
    nxt = step(start)
    while nxt <= today:
        nxt = step(nxt)
    return nxt

# The columns of a new board, in the creator's UI language
BASIC_COLUMNS = {
    "en": (("To do", False), ("In progress", False), ("Done", True)),
    "ru": (("К выполнению", False), ("В работе", False), ("Готово", True)),
}


@dataclass(frozen=True)
class Access:
    board: Any
    role: str | None
    admin: bool

    @property
    def can_edit(self) -> bool:
        return self.admin or self.role is not None

    @property
    def can_manage(self) -> bool:
        return self.admin or self.role == "owner"


class _Tx:
    """One write: the connection, plus what to do after the commit (events, files to remove)."""

    def __init__(self, conn: Connection, user: User):
        self.conn, self.user = conn, user
        self.now = time.time()
        self.events: list[dict[str, Any]] = []
        self.files: list[tuple[int, list[str | None]]] = []
        self.boards_removed: list[int] = []

    def log(self, board_id: int, action: str, card_id: int | None = None, **details: Any) -> None:
        self.conn.execute(insert(activity_table).values(
            board_id=board_id, card_id=card_id, user_id=self.user.id, action=action, created_at=self.now,
            details=json.dumps(details, ensure_ascii=False, default=str) if details else None,
        ))
        self.conn.execute(update(boards_table).where(boards_table.c.id == board_id)
                          .values(updated_at=self.now, updated_by=self.user.username))
        if card_id is not None:
            self.conn.execute(update(cards_table).where(cards_table.c.id == card_id)
                              .values(updated_at=self.now, updated_by=self.user.username))
        self.event(board_id, action, card_id)

    def event(self, board_id: int, action: str, card_id: int | None = None) -> None:
        ev: dict[str, Any] = {"type": "board_changed", "board_id": board_id, "by": self.user.username, "action": action}
        if card_id is not None:
            ev["card_id"] = card_id
        self.events.append(ev)


def _roles(conn: Connection, user: User, board_ids: Iterable[int] | None = None) -> dict[int, str]:
    """board id -> the user's role there (the higher one when they are a member twice)."""
    m = board_members_table
    cond = m.c.user_id == user.id
    if user.group_ids:
        cond = or_(cond, m.c.group_id.in_(list(user.group_ids)))
    stmt = select(m.c.board_id, m.c.role).where(cond)
    if board_ids is not None:
        stmt = stmt.where(m.c.board_id.in_(list(board_ids)))
    out: dict[int, str] = {}
    for r in conn.execute(stmt):
        if r.role == "owner" or r.board_id not in out:
            out[r.board_id] = r.role
    return out


def _names(conn: Connection, ids: Iterable[int | None]) -> dict[int, str]:
    """user id -> username, deleted users (negative ids) included."""
    wanted = {i for i in ids if i is not None}
    out: dict[int, str] = {0: "anonymous"} if 0 in wanted else {}
    pos = [i for i in wanted if i > 0]
    neg = [i for i in wanted if i < 0]
    if pos:
        out.update({r.id: r.username for r in conn.execute(
            select(users_table.c.id, users_table.c.username).where(users_table.c.id.in_(pos)))})
    if neg:
        for r in conn.execute(select(activity_table.c.user_id, activity_table.c.details).where(
                activity_table.c.action == TOMBSTONE, activity_table.c.user_id.in_(neg))):
            try:
                out[r.user_id] = json.loads(r.details or "{}").get("username") or "?"
            except ValueError:
                out[r.user_id] = "?"
    return out


def _renumber_if_needed(conn: Connection, table: Any, cond: Any) -> bool:
    rows = conn.execute(select(table.c.id, table.c.position).where(cond).order_by(table.c.position, table.c.id)).all()
    pos = [r.position for r in rows]
    tight = any(b - a < MIN_GAP for a, b in zip(pos, pos[1:])) or any(abs(p) > MAX_ABS for p in pos)
    if not tight:
        return False
    for i, r in enumerate(rows):
        conn.execute(update(table).where(table.c.id == r.id).values(position=(i + 1) * STEP))
    return True


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _check_dates(start: str | None, due: str | None) -> None:
    if start and due and start > due:
        raise HTTPException(status_code=400, detail="The start date is after the due date")


def attachment_json(a: Any, names: dict[int, str]) -> dict[str, Any]:
    return {
        "id": a.id, "card_id": a.card_id, "filename": a.filename, "content_type": a.content_type, "size": a.size,
        "is_image": is_image(a.content_type), "inline": a.content_type in INLINE,
        "url": f"{API}/attachments/{a.id}", "thumb_url": f"{API}/attachments/{a.id}/thumb" if a.thumb else None,
        "uploaded_by": names.get(a.uploaded_by) if a.uploaded_by is not None else None,
        "created_at": a.created_at,
    }


class KanbanStore:
    def __init__(self, engine: Engine, files: FileStore, events: BoardEvents, link_names: LinkNames | None = None):
        self.engine, self.files, self.events = engine, files, events
        self.link_names = link_names

    @contextmanager
    def _write(self, user: User) -> Iterator[_Tx]:
        with self.engine.begin() as conn:
            tx = _Tx(conn, user)
            yield tx
        for board_id, names in tx.files:
            self.files.remove(board_id, names)
        for board_id in tx.boards_removed:
            self.files.remove_board(board_id)
        for ev in tx.events:
            self.events.publish(ev["board_id"], ev)

    # ------------------------------------------------------------------ access
    def _access(self, conn: Connection, user: User, board_id: int, need: str = "read", archived_ok: bool = False) -> Access:
        row = conn.execute(select(boards_table).where(boards_table.c.id == board_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Board not found")
        acc = Access(row, _roles(conn, user, [board_id]).get(board_id), user.is_admin)
        if row.archived and not acc.can_edit:
            raise HTTPException(status_code=404, detail="Board not found")
        if need == "read":
            return acc
        if need == "edit" and not acc.can_edit:
            raise HTTPException(status_code=403, detail="Only members of this board can change it")
        if need == "manage" and not acc.can_manage:
            raise HTTPException(status_code=403, detail="Only the board's owners can do this")
        if row.archived and not archived_ok:
            raise HTTPException(status_code=409, detail="The board is archived: restore it first")
        return acc

    def readable(self, user: User, board_id: int) -> bool:
        with self.engine.connect() as conn:
            try:
                self._access(conn, user, board_id)
            except HTTPException:
                return False
        return True

    def _card_row(self, conn: Connection, card_id: int) -> Any:
        row = conn.execute(select(cards_table).where(cards_table.c.id == card_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Card not found")
        return row

    def _card(self, conn: Connection, user: User, card_id: int, need: str = "read") -> tuple[Any, Access]:
        row = self._card_row(conn, card_id)
        try:
            acc = self._access(conn, user, row.board_id, need)
        except HTTPException as exc:
            if exc.status_code == 404:
                raise HTTPException(status_code=404, detail="Card not found") from None
            raise
        return row, acc

    def _column(self, conn: Connection, column_id: int) -> Any:
        row = conn.execute(select(columns_table).where(columns_table.c.id == column_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Column not found")
        return row

    def _board_column(self, conn: Connection, board_id: int, column_id: int) -> Any:
        row = conn.execute(select(columns_table).where(columns_table.c.id == column_id)).first()
        if row is None or row.board_id != board_id:
            raise HTTPException(status_code=400, detail="The column is not on this board")
        return row

    # ------------------------------------------------------------------ boards
    def _board_summaries(self, conn: Connection, user: User, rows: list[Any]) -> list[dict[str, Any]]:
        ids = [r.id for r in rows]
        if not ids:
            return []
        roles = _roles(conn, user, ids)
        m = board_members_table
        members = {r[0]: r[1] for r in conn.execute(
            select(m.c.board_id, func.count()).where(m.c.board_id.in_(ids)).group_by(m.c.board_id))}
        counts: dict[tuple[int, bool], int] = {}
        for r in conn.execute(
            select(cards_table.c.board_id, columns_table.c.is_done, func.count())
            .join(columns_table, columns_table.c.id == cards_table.c.column_id)
            .where(cards_table.c.board_id.in_(ids), cards_table.c.archived.is_(False))
            .group_by(cards_table.c.board_id, columns_table.c.is_done)
        ):
            counts[(r[0], bool(r[1]))] = r[2]
        # who is on each board, in words on the boards page ("carol, alice and 2 others")
        member_rows = conn.execute(select(m.c.board_id, m.c.user_id, m.c.group_id).where(m.c.board_id.in_(ids))).all()
        names = _names(conn, [r.owner_id for r in rows] + [r.user_id for r in member_rows if r.user_id is not None])
        group_names = {g.id: g.name for g in conn.execute(select(groups_table.c.id, groups_table.c.name).where(
            groups_table.c.id.in_({r.group_id for r in member_rows if r.group_id is not None})))}
        member_names: dict[int, list[str]] = {}
        for r in member_rows:
            label = names.get(r.user_id) if r.user_id is not None else group_names.get(r.group_id)
            if label:
                member_names.setdefault(r.board_id, []).append(label)
        out = []
        for r in rows:
            acc = Access(r, roles.get(r.id), user.is_admin)
            out.append({
                "id": r.id, "name": r.name, "description": r.description, "color": r.color,
                "owner": names.get(r.owner_id), "owner_id": r.owner_id if r.owner_id >= 0 else None,
                "role": acc.role, "can_edit": acc.can_edit, "can_manage": acc.can_manage,
                "members_count": members.get(r.id, 0),
                "member_names": sorted(member_names.get(r.id, []), key=str.lower)[:6],
                "cards_open": counts.get((r.id, False), 0), "cards_done": counts.get((r.id, True), 0),
                "created_at": r.created_at, "updated_at": r.updated_at, "updated_by": r.updated_by,
                "archived": bool(r.archived),
            })
        return out

    def _board_summary(self, conn: Connection, user: User, board_id: int) -> dict[str, Any]:
        row = conn.execute(select(boards_table).where(boards_table.c.id == board_id)).first()
        return self._board_summaries(conn, user, [row])[0]

    def list_boards(self, user: User, archived: bool = False) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(boards_table).where(boards_table.c.archived.is_(archived))
                                .order_by(boards_table.c.updated_at.desc(), boards_table.c.id.desc())).all()
            if archived and not user.is_admin:
                mine = _roles(conn, user)
                rows = [r for r in rows if r.id in mine]
            return self._board_summaries(conn, user, rows)

    def create_board(self, user: User, *, name: str, description: str | None, color: str | None,
                     template: str = "basic", lang: str = "en") -> dict[str, Any]:
        with self._write(user) as tx:
            bid = int(tx.conn.execute(insert(boards_table).values(
                name=name, description=description, color=color, owner_id=user.id, archived=False,
                created_at=tx.now, updated_at=tx.now, updated_by=user.username,
            )).inserted_primary_key[0])
            tx.conn.execute(insert(board_members_table).values(board_id=bid, user_id=user.id, role="owner"))
            if template == "basic":
                for i, (col, done) in enumerate(BASIC_COLUMNS.get(lang, BASIC_COLUMNS["en"])):
                    tx.conn.execute(insert(columns_table).values(
                        board_id=bid, name=col, position=(i + 1) * STEP, is_done=done))
            tx.log(bid, "board_created", name=name)
            return self._board_summary(tx.conn, user, bid)

    def get_board(self, user: User, board_id: int, archived_cards: bool = False) -> dict[str, Any]:
        with self.engine.connect() as conn:
            acc = self._access(conn, user, board_id)
            columns = conn.execute(select(columns_table).where(columns_table.c.board_id == board_id)
                                   .order_by(columns_table.c.position, columns_table.c.id)).all()
            labels = conn.execute(select(labels_table).where(labels_table.c.board_id == board_id)
                                  .order_by(labels_table.c.name, labels_table.c.id)).all()
            cards = conn.execute(select(cards_table).where(
                cards_table.c.board_id == board_id, cards_table.c.archived.is_(archived_cards),
            ).order_by(cards_table.c.column_id, cards_table.c.position, cards_table.c.id)).all()
            summaries = self._summaries(conn, cards, board_id=board_id)
            assigned = {uid for c in summaries for uid in c["assignees"]}
            # everyone who can be assigned (active users), plus disabled ones still assigned here
            people = conn.execute(select(users_table.c.id, users_table.c.username, users_table.c.is_active).where(
                or_(users_table.c.is_active.is_(True), users_table.c.id.in_(sorted(assigned))),
            ).order_by(users_table.c.username)).all()
            groups = conn.execute(select(groups_table.c.id, groups_table.c.name).order_by(groups_table.c.name)).all()
            return {
                "board": self._board_summaries(conn, user, [acc.board])[0],
                "columns": [_column_json(c) for c in columns],
                "labels": [{"id": lb.id, "name": lb.name, "color": lb.color} for lb in labels],
                "members": self._members(conn, board_id),
                "cards": summaries,
                "people": [{"id": p.id, "username": p.username, **({} if p.is_active else {"active": False})}
                           for p in people],
                "groups": [{"id": g.id, "name": g.name} for g in groups],
            }

    def update_board(self, user: User, board_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        with self._write(user) as tx:
            acc = self._access(tx.conn, user, board_id, "manage", archived_ok="archived" in changes)
            b = acc.board
            diff = {k: [getattr(b, k), v] for k, v in changes.items() if k != "archived" and getattr(b, k) != v}
            if diff:
                tx.conn.execute(update(boards_table).where(boards_table.c.id == board_id)
                                .values(**{k: v[1] for k, v in diff.items()}))
                tx.log(board_id, "board_updated", changes=diff)
            if "archived" in changes and bool(changes["archived"]) != bool(b.archived):
                tx.conn.execute(update(boards_table).where(boards_table.c.id == board_id)
                                .values(archived=bool(changes["archived"])))
                tx.log(board_id, "board_archived" if changes["archived"] else "board_restored")
            return self._board_summary(tx.conn, user, board_id)

    def delete_board(self, user: User, board_id: int) -> str:
        with self._write(user) as tx:
            acc = self._access(tx.conn, user, board_id, "manage", archived_ok=True)
            if not acc.board.archived:
                raise HTTPException(status_code=409, detail="Archive the board first")
            conn = tx.conn
            card_ids = select(cards_table.c.id).where(cards_table.c.board_id == board_id)
            for table in (attachments_table, comments_table, checklist_table):
                conn.execute(delete(table).where(table.c.card_id.in_(card_ids)))
            for table in (card_assignees_table, card_labels_table, card_links_table, card_names_table):
                conn.execute(delete(table).where(table.c.card_id.in_(card_ids)))
            for table in (cards_table, labels_table, columns_table, board_members_table, activity_table):
                conn.execute(delete(table).where(table.c.board_id == board_id))
            conn.execute(delete(boards_table).where(boards_table.c.id == board_id))
            tx.boards_removed.append(board_id)
            tx.event(board_id, "board_deleted")
            return acc.board.name

    # ------------------------------------------------------------------ members
    def _members(self, conn: Connection, board_id: int) -> list[dict[str, Any]]:
        m = board_members_table
        rows = conn.execute(select(m).where(m.c.board_id == board_id).order_by(m.c.id)).all()
        names = _names(conn, [r.user_id for r in rows if r.user_id is not None])
        gids = [r.group_id for r in rows if r.group_id is not None]
        groups = {g.id: g.name for g in conn.execute(
            select(groups_table.c.id, groups_table.c.name).where(groups_table.c.id.in_(gids)))} if gids else {}
        out = [{
            "id": r.id, "user": r.user_id, "group": r.group_id, "role": r.role,
            "name": names.get(r.user_id) if r.user_id is not None else groups.get(r.group_id),
        } for r in rows]
        return sorted(out, key=lambda x: (x["role"] != "owner", x["group"] is not None, (x["name"] or "").lower()))

    def set_members(self, user: User, board_id: int, entries: list[tuple[int | None, int | None, str]]) -> list[dict[str, Any]]:
        with self._write(user) as tx:
            acc = self._access(tx.conn, user, board_id, "manage")
            conn = tx.conn
            wanted: dict[tuple[str, int], str] = {}
            for uid, gid, role in entries:
                if (uid is None) == (gid is None):
                    raise HTTPException(status_code=400, detail="Each member is either a user or a group")
                key = ("user", uid) if uid is not None else ("group", gid)
                if wanted.get(key) != "owner":  # twice: the higher role counts
                    wanted[key] = role
            uids = [k[1] for k in wanted if k[0] == "user"]
            gids = [k[1] for k in wanted if k[0] == "group"]
            known_users = {r.id for r in conn.execute(select(users_table.c.id).where(users_table.c.id.in_(uids)))}
            for uid in uids:
                if uid not in known_users:
                    raise HTTPException(status_code=400, detail=f"Unknown user id {uid}")
            known_groups = {r.id for r in conn.execute(select(groups_table.c.id).where(groups_table.c.id.in_(gids)))}
            for gid in gids:
                if gid not in known_groups:
                    raise HTTPException(status_code=400, detail=f"Unknown group id {gid}")
            if "owner" not in wanted.values():
                raise HTTPException(status_code=400, detail="A board needs at least one owner")
            m = board_members_table
            conn.execute(delete(m).where(m.c.board_id == board_id))
            for (kind, ident), role in wanted.items():
                conn.execute(insert(m).values(board_id=board_id, role=role,
                                              user_id=ident if kind == "user" else None,
                                              group_id=ident if kind == "group" else None))
            owners = [ident for (kind, ident), role in wanted.items() if kind == "user" and role == "owner"]
            if owners and acc.board.owner_id not in owners:
                conn.execute(update(boards_table).where(boards_table.c.id == board_id).values(owner_id=owners[0]))
            members = self._members(conn, board_id)
            tx.log(board_id, "members_changed", members=[
                {"name": x["name"], "kind": "group" if x["group"] is not None else "user", "role": x["role"]} for x in members
            ])
            return members

    # ------------------------------------------------------------------ columns
    def create_column(self, user: User, board_id: int, *, name: str, color: str | None, is_done: bool) -> dict[str, Any]:
        with self._write(user) as tx:
            self._access(tx.conn, user, board_id, "edit")
            top = tx.conn.execute(select(func.max(columns_table.c.position))
                                  .where(columns_table.c.board_id == board_id)).scalar()
            cid = int(tx.conn.execute(insert(columns_table).values(
                board_id=board_id, name=name, color=color, is_done=is_done, position=(top or 0) + STEP,
            )).inserted_primary_key[0])
            tx.log(board_id, "column_created", name=name)
            return _column_json(self._column(tx.conn, cid))

    def update_column(self, user: User, column_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        with self._write(user) as tx:
            col = self._column(tx.conn, column_id)
            self._access(tx.conn, user, col.board_id, "edit")
            diff = {k: [getattr(col, k), v] for k, v in changes.items() if getattr(col, k) != v}
            if not diff:
                return _column_json(col)
            tx.conn.execute(update(columns_table).where(columns_table.c.id == column_id)
                            .values(**{k: v[1] for k, v in diff.items()}))
            if "is_done" in diff:  # the cards in it are done now (or no longer)
                cards = cards_table
                if diff["is_done"][1]:
                    tx.conn.execute(update(cards).where(cards.c.column_id == column_id, cards.c.completed_at.is_(None))
                                    .values(completed_at=tx.now))
                else:
                    tx.conn.execute(update(cards).where(cards.c.column_id == column_id).values(completed_at=None))
            if "position" in diff:
                _renumber_if_needed(tx.conn, columns_table, columns_table.c.board_id == col.board_id)
            shown = {k: v for k, v in diff.items() if k != "position"}
            if shown:
                tx.log(col.board_id, "column_updated", column=col.name, changes=shown)
            else:
                tx.log(col.board_id, "column_moved", column=col.name)
            return _column_json(self._column(tx.conn, column_id))

    def delete_column(self, user: User, column_id: int) -> None:
        with self._write(user) as tx:
            col = self._column(tx.conn, column_id)
            self._access(tx.conn, user, col.board_id, "edit")
            conn = tx.conn
            open_cards = conn.execute(select(func.count()).select_from(cards_table).where(
                cards_table.c.column_id == column_id, cards_table.c.archived.is_(False))).scalar_one()
            if open_cards:
                raise HTTPException(status_code=409, detail="Move its cards first")
            other = conn.execute(select(columns_table).where(
                columns_table.c.board_id == col.board_id, columns_table.c.id != column_id,
            ).order_by(columns_table.c.position, columns_table.c.id)).first()
            if other is None:
                raise HTTPException(status_code=409, detail="A board needs at least one column")
            # archived cards (not shown on the board) move to the first other column
            conn.execute(update(cards_table).where(cards_table.c.column_id == column_id).values(
                column_id=other.id, completed_at=tx.now if other.is_done else None))
            conn.execute(delete(columns_table).where(columns_table.c.id == column_id))
            tx.log(col.board_id, "column_deleted", name=col.name)

    # ------------------------------------------------------------------ labels
    def _label(self, conn: Connection, label_id: int) -> Any:
        row = conn.execute(select(labels_table).where(labels_table.c.id == label_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Label not found")
        return row

    def create_label(self, user: User, board_id: int, *, name: str, color: str) -> dict[str, Any]:
        with self._write(user) as tx:
            self._access(tx.conn, user, board_id, "edit")
            lid = int(tx.conn.execute(insert(labels_table).values(board_id=board_id, name=name, color=color))
                      .inserted_primary_key[0])
            tx.log(board_id, "label_created", name=name, color=color)
            return {"id": lid, "name": name, "color": color}

    def update_label(self, user: User, label_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        with self._write(user) as tx:
            lb = self._label(tx.conn, label_id)
            self._access(tx.conn, user, lb.board_id, "edit")
            diff = {k: [getattr(lb, k), v] for k, v in changes.items() if v is not None and getattr(lb, k) != v}
            if diff:
                tx.conn.execute(update(labels_table).where(labels_table.c.id == label_id)
                                .values(**{k: v[1] for k, v in diff.items()}))
                tx.log(lb.board_id, "label_updated", label=lb.name, changes=diff)
            lb = self._label(tx.conn, label_id)
            return {"id": lb.id, "name": lb.name, "color": lb.color}

    def delete_label(self, user: User, label_id: int) -> None:
        with self._write(user) as tx:
            lb = self._label(tx.conn, label_id)
            self._access(tx.conn, user, lb.board_id, "edit")
            tx.conn.execute(delete(card_labels_table).where(card_labels_table.c.label_id == label_id))
            tx.conn.execute(delete(labels_table).where(labels_table.c.id == label_id))
            tx.log(lb.board_id, "label_deleted", name=lb.name)

    # ------------------------------------------------------------------ cards
    def _summaries(self, conn: Connection, rows: list[Any], board_id: int | None = None) -> list[dict[str, Any]]:
        if not rows:
            return []
        if board_id is not None:
            scope: Any = select(cards_table.c.id).where(cards_table.c.board_id == board_id)
        else:
            scope = [r.id for r in rows]
        assignees: dict[int, list[int]] = {}
        for r in conn.execute(select(card_assignees_table).where(card_assignees_table.c.card_id.in_(scope))
                              .order_by(card_assignees_table.c.user_id)):
            assignees.setdefault(r.card_id, []).append(r.user_id)
        named: dict[int, list[str]] = {}
        for r in conn.execute(select(card_names_table).where(card_names_table.c.card_id.in_(scope))
                              .order_by(card_names_table.c.position, card_names_table.c.name)):
            named.setdefault(r.card_id, []).append(r.name)
        labels: dict[int, list[int]] = {}
        for r in conn.execute(select(card_labels_table).where(card_labels_table.c.card_id.in_(scope))
                              .order_by(card_labels_table.c.label_id)):
            labels.setdefault(r.card_id, []).append(r.label_id)
        checklist = {r[0]: (int(r[1] or 0), r[2]) for r in conn.execute(
            select(checklist_table.c.card_id, func.sum(case((checklist_table.c.done.is_(True), 1), else_=0)), func.count())
            .where(checklist_table.c.card_id.in_(scope)).group_by(checklist_table.c.card_id))}
        comments = {r[0]: r[1] for r in conn.execute(
            select(comments_table.c.card_id, func.count()).where(comments_table.c.card_id.in_(scope))
            .group_by(comments_table.c.card_id))}
        files: dict[int, int] = {}
        covers: dict[int, str] = {}
        a = attachments_table
        for r in conn.execute(select(a.c.id, a.c.card_id, a.c.content_type, a.c.thumb)
                              .where(a.c.card_id.in_(scope)).order_by(a.c.id)):
            files[r.card_id] = files.get(r.card_id, 0) + 1
            if r.card_id not in covers and r.thumb and is_image(r.content_type):
                covers[r.card_id] = f"{API}/attachments/{r.id}/thumb"
        out = []
        for c in rows:
            done, total = checklist.get(c.id, (0, 0))
            out.append({
                "id": c.id, "board_id": c.board_id, "column_id": c.column_id, "title": c.title, "priority": c.priority,
                "start_date": c.start_date, "due_date": c.due_date, "position": c.position, "archived": bool(c.archived),
                "assignees": assignees.get(c.id, []), "assignee_names": named.get(c.id, []), "labels": labels.get(c.id, []),
                "checklist": {"done": done, "total": total}, "comments": comments.get(c.id, 0),
                "attachments": files.get(c.id, 0), "cover": covers.get(c.id),
                "completed_at": c.completed_at, "updated_at": c.updated_at, "updated_by": c.updated_by,
                "repeat": c.repeat,
            })
        return out

    def _card_full(self, conn: Connection, user: User, card_id: int) -> dict[str, Any]:
        c = self._card_row(conn, card_id)
        out = self._summaries(conn, [c])[0]
        items = conn.execute(select(checklist_table).where(checklist_table.c.card_id == card_id)
                             .order_by(checklist_table.c.position, checklist_table.c.id)).all()
        comments = conn.execute(select(comments_table).where(comments_table.c.card_id == card_id)
                                .order_by(comments_table.c.created_at, comments_table.c.id)).all()
        files = conn.execute(select(attachments_table).where(attachments_table.c.card_id == card_id)
                             .order_by(attachments_table.c.id)).all()
        history = conn.execute(select(activity_table).where(activity_table.c.card_id == card_id)
                               .order_by(activity_table.c.created_at.desc(), activity_table.c.id.desc())
                               .limit(HISTORY_LIMIT)).all()
        names = _names(conn, [c.created_by, *(x.user_id for x in comments), *(f.uploaded_by for f in files),
                              *(h.user_id for h in history)])
        out.update({
            "description": c.description,
            "created_by": names.get(c.created_by) if c.created_by is not None else None,
            "created_at": c.created_at,
            "checklist_items": [{"id": i.id, "text": i.text, "done": bool(i.done), "done_by": i.done_by,
                                 "done_at": i.done_at, "position": i.position} for i in items],
            "comments_list": [{"id": x.id, "user": names.get(x.user_id), "user_id": x.user_id if x.user_id >= 0 else None,
                               "body": x.body, "created_at": x.created_at, "edited_at": x.edited_at} for x in comments],
            "attachments_list": [attachment_json(f, names) for f in files],
            "history": [_history_json(h, names) for h in history],
            "links": self._links(conn, user, card_id),
        })
        return out

    def _links(self, conn: Connection, user: User, card_id: int) -> list[dict[str, Any]]:
        """K3: the task's Search & BI links; names only for what this person may open."""
        rows = conn.execute(select(card_links_table).where(card_links_table.c.card_id == card_id)
                            .order_by(card_links_table.c.id)).all()
        if not rows:
            return []
        wanted = [(r.kind, r.target_id) for r in rows]
        names = self.link_names(user, wanted) if self.link_names else {}
        return [{"id": r.id, "kind": r.kind, "target_id": r.target_id, "name": names.get((r.kind, r.target_id)),
                 "url": f"/{'dashboards' if r.kind == 'dashboard' else 'questions'}/{r.target_id}"} for r in rows]

    def add_link(self, user: User, card_id: int, kind: str, target_id: int) -> dict[str, Any]:
        with self._write(user) as tx:
            conn = tx.conn
            c, _acc = self._card(conn, user, card_id, "edit")
            if kind not in LINK_KINDS:
                raise HTTPException(status_code=400, detail="Unknown link")
            name = (self.link_names(user, [(kind, target_id)]) if self.link_names else {}).get((kind, target_id))
            if name is None:  # only what the person adding it may open
                raise HTTPException(status_code=404, detail="Dashboard not found" if kind == "dashboard" else "Question not found")
            exists = conn.execute(select(card_links_table.c.id).where(
                card_links_table.c.card_id == card_id, card_links_table.c.kind == kind,
                card_links_table.c.target_id == target_id)).first()
            if exists is None:
                conn.execute(insert(card_links_table).values(card_id=card_id, kind=kind, target_id=target_id,
                                                             added_by=user.id, created_at=tx.now))
                tx.log(c.board_id, "link_added", card_id, kind=kind, name=name)
            return self._card_full(conn, user, card_id)

    def remove_link(self, user: User, link_id: int) -> dict[str, Any]:
        with self._write(user) as tx:
            conn = tx.conn
            row = conn.execute(select(card_links_table).where(card_links_table.c.id == link_id)).first()
            if row is None:
                raise HTTPException(status_code=404, detail="Link not found")
            c, _acc = self._card(conn, user, row.card_id, "edit")
            conn.execute(delete(card_links_table).where(card_links_table.c.id == link_id))
            tx.log(c.board_id, "link_removed", c.id, kind=row.kind)
            return self._card_full(conn, user, c.id)

    def get_card(self, user: User, card_id: int) -> dict[str, Any]:
        with self.engine.connect() as conn:
            self._card(conn, user, card_id)
            return self._card_full(conn, user, card_id)

    def my_cards(self, user: User, done_days: int = 7) -> dict[str, Any]:
        """The person's tasks on every board they can see (K3 "My tasks"): open ones, and the ones finished
        in the last done_days days. With each board's stages, so a task can be moved from the list."""
        with self.engine.connect() as conn:
            since = time.time() - done_days * 86400
            a, c, b = card_assignees_table.c, cards_table.c, boards_table.c
            rows = conn.execute(
                select(cards_table).join(card_assignees_table, a.card_id == c.id).join(boards_table, b.id == c.board_id).where(
                    a.user_id == user.id, c.archived.is_(False), b.archived.is_(False),
                    or_(c.completed_at.is_(None), c.completed_at >= since),
                ).order_by(c.due_date, c.board_id, c.position, c.id)
            ).all()
            board_ids = sorted({r.board_id for r in rows})
            boards = conn.execute(select(boards_table).where(b.id.in_(board_ids))).all() if board_ids else []
            roles = _roles(conn, user, board_ids)
            columns = conn.execute(select(columns_table).where(columns_table.c.board_id.in_(board_ids))
                                   .order_by(columns_table.c.position, columns_table.c.id)).all() if board_ids else []
            done_cols = {col.id for col in columns if col.is_done}
            # a task in a "done" stage without a finish time counts as done long ago
            cards = [s for s in self._summaries(conn, rows) if not (s["column_id"] in done_cols and s["completed_at"] is None)]
            people = sorted({uid for s in cards for uid in s["assignees"]})
            names = _names(conn, people)
            by_board: dict[int, list[dict[str, Any]]] = {}
            for col in columns:
                by_board.setdefault(col.board_id, []).append(_column_json(col))
            labels: dict[int, list[dict[str, Any]]] = {}
            for lb in conn.execute(select(labels_table).where(labels_table.c.board_id.in_(board_ids))
                                   .order_by(labels_table.c.name, labels_table.c.id)).all() if board_ids else []:
                labels.setdefault(lb.board_id, []).append({"id": lb.id, "name": lb.name, "color": lb.color})
            return {
                "cards": cards,
                "boards": [{"id": bd.id, "name": bd.name, "color": bd.color,
                            "can_edit": Access(bd, roles.get(bd.id), user.is_admin).can_edit,
                            "columns": by_board.get(bd.id, []), "labels": labels.get(bd.id, [])} for bd in boards],
                "people": [{"id": uid, "username": names.get(uid, "?")} for uid in people],
            }

    def board_history(self, user: User, board_id: int, limit: int = 100) -> list[dict[str, Any]]:
        with self.engine.connect() as conn:
            self._access(conn, user, board_id)
            rows = conn.execute(select(activity_table).where(activity_table.c.board_id == board_id)
                                .order_by(activity_table.c.created_at.desc(), activity_table.c.id.desc())
                                .limit(limit)).all()
            names = _names(conn, [h.user_id for h in rows])
            return [_history_json(h, names) for h in rows]

    def _check_people(self, conn: Connection, ids: list[int]) -> None:
        active = {r.id for r in conn.execute(select(users_table.c.id).where(
            users_table.c.id.in_(ids), users_table.c.is_active.is_(True)))}
        for uid in ids:
            if uid not in active:
                raise HTTPException(status_code=400, detail=f"Unknown user id {uid}")

    def _check_labels(self, conn: Connection, board_id: int, ids: list[int]) -> dict[int, str]:
        mine = {r.id: r.name for r in conn.execute(select(labels_table.c.id, labels_table.c.name).where(
            labels_table.c.board_id == board_id))}
        for lid in ids:
            if lid not in mine:
                raise HTTPException(status_code=400, detail=f"Unknown label id {lid}")
        return mine

    def _top(self, conn: Connection, column_id: int) -> float:
        low = conn.execute(select(func.min(cards_table.c.position)).where(cards_table.c.column_id == column_id)).scalar()
        return STEP if low is None else low - STEP

    def create_card(self, user: User, board_id: int, *, column_id: int, title: str, description: str | None = None,
                    priority: str = "normal", start_date: Any = None, due_date: Any = None,
                    assignees: list[int] | None = None, labels: list[int] | None = None,
                    position: float | None = None, repeat: str | None = None,
                    assignee_names: list[str] | None = None) -> dict[str, Any]:
        with self._write(user) as tx:
            conn = tx.conn
            self._access(conn, user, board_id, "edit")
            col = self._board_column(conn, board_id, column_id)
            start, due = _iso(start_date), _iso(due_date)
            _check_dates(start, due)
            people = sorted(set(assignees or []))
            tags = sorted(set(labels or []))
            self._check_people(conn, people)
            self._check_labels(conn, board_id, tags)
            cid = int(conn.execute(insert(cards_table).values(
                board_id=board_id, column_id=column_id, title=title, description=description, priority=priority,
                start_date=start, due_date=due, position=self._top(conn, column_id) if position is None else position,
                archived=False, completed_at=tx.now if col.is_done else None, created_by=user.id,
                repeat=repeat if repeat in REPEATS else None,
                created_at=tx.now, updated_at=tx.now, updated_by=user.username,
            )).inserted_primary_key[0])
            for uid in people:
                conn.execute(insert(card_assignees_table).values(card_id=cid, user_id=uid))
            for i, name in enumerate(clean_names(assignee_names)):
                conn.execute(insert(card_names_table).values(card_id=cid, name=name, position=i))
            for lid in tags:
                conn.execute(insert(card_labels_table).values(card_id=cid, label_id=lid))
            if position is not None:
                _renumber_if_needed(conn, cards_table, cards_table.c.column_id == column_id)
            tx.log(board_id, "card_created", cid, title=title, column=col.name)
            return self._card_full(conn, user, cid)

    def update_card(self, user: User, card_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        with self._write(user) as tx:
            conn = tx.conn
            c, _acc = self._card(conn, user, card_id, "edit")
            diff: dict[str, Any] = {}
            values: dict[str, Any] = {}
            for key in ("title", "priority", "start_date", "due_date"):
                if key in changes:
                    new = _iso(changes[key]) if key.endswith("_date") else changes[key]
                    if key == "title" and new is None:
                        continue
                    if getattr(c, key) != new:
                        diff[key] = [getattr(c, key), new]
                        values[key] = new
            if "description" in changes and (changes["description"] or None) != (c.description or None):
                diff["description"] = True  # the text itself can be long: the card has it
                values["description"] = changes["description"]
            if "repeat" in changes:
                new_repeat = changes["repeat"] if changes["repeat"] in REPEATS else None
                if new_repeat != c.repeat:
                    diff["repeat"] = [c.repeat, new_repeat]
                    values["repeat"] = new_repeat
            _check_dates(values.get("start_date", c.start_date), values.get("due_date", c.due_date))
            if values:
                conn.execute(update(cards_table).where(cards_table.c.id == card_id).values(**values))
            if changes.get("assignees") is not None:
                new_people = set(changes["assignees"])
                old_people = {r.user_id for r in conn.execute(select(card_assignees_table.c.user_id)
                                                              .where(card_assignees_table.c.card_id == card_id))}
                added, removed = sorted(new_people - old_people), sorted(old_people - new_people)
                self._check_people(conn, added)
                if added or removed:
                    conn.execute(delete(card_assignees_table).where(card_assignees_table.c.card_id == card_id,
                                                                    card_assignees_table.c.user_id.in_(removed)))
                    for uid in added:
                        conn.execute(insert(card_assignees_table).values(card_id=card_id, user_id=uid))
                    names = _names(conn, added + removed)
                    diff["assignees"] = {"added": [names.get(u) for u in added], "removed": [names.get(u) for u in removed]}
            if changes.get("assignee_names") is not None:
                new_names = clean_names(changes["assignee_names"])
                old_names = [r.name for r in conn.execute(select(card_names_table.c.name).where(card_names_table.c.card_id == card_id)
                                                          .order_by(card_names_table.c.position, card_names_table.c.name))]
                if new_names != old_names:
                    conn.execute(delete(card_names_table).where(card_names_table.c.card_id == card_id))
                    for i, name in enumerate(new_names):
                        conn.execute(insert(card_names_table).values(card_id=card_id, name=name, position=i))
                    old_keys, new_keys = {n.casefold() for n in old_names}, {n.casefold() for n in new_names}
                    added = [n for n in new_names if n.casefold() not in old_keys]
                    removed = [n for n in old_names if n.casefold() not in new_keys]
                    if added or removed:
                        prev = diff.get("assignees", {"added": [], "removed": []})
                        diff["assignees"] = {"added": prev["added"] + added, "removed": prev["removed"] + removed}
            if changes.get("labels") is not None:
                new_tags = set(changes["labels"])
                old_tags = {r.label_id for r in conn.execute(select(card_labels_table.c.label_id)
                                                             .where(card_labels_table.c.card_id == card_id))}
                added, removed = sorted(new_tags - old_tags), sorted(old_tags - new_tags)
                label_names = self._check_labels(conn, c.board_id, added)
                if added or removed:
                    conn.execute(delete(card_labels_table).where(card_labels_table.c.card_id == card_id,
                                                                 card_labels_table.c.label_id.in_(removed)))
                    for lid in added:
                        conn.execute(insert(card_labels_table).values(card_id=card_id, label_id=lid))
                    diff["labels"] = {"added": [label_names.get(x) for x in added],
                                      "removed": [label_names.get(x) for x in removed]}
            if diff:
                tx.log(c.board_id, "card_updated", card_id, changes=diff)
            if changes.get("archived") is not None and bool(changes["archived"]) != bool(c.archived):
                conn.execute(update(cards_table).where(cards_table.c.id == card_id)
                             .values(archived=bool(changes["archived"])))
                tx.log(c.board_id, "card_archived" if changes["archived"] else "card_restored", card_id)
            return self._card_full(conn, user, card_id)

    def move_card(self, user: User, card_id: int, column_id: int, position: float | None) -> dict[str, Any]:
        with self._write(user) as tx:
            conn = tx.conn
            c, _acc = self._card(conn, user, card_id, "edit")
            target = self._board_column(conn, c.board_id, column_id)
            source = self._column(conn, c.column_id)
            values: dict[str, Any] = {"column_id": column_id,
                                      "position": self._top(conn, column_id) if position is None else position}
            if target.is_done and not source.is_done or target.is_done and c.completed_at is None:
                values["completed_at"] = tx.now
            elif not target.is_done:
                values["completed_at"] = None
            conn.execute(update(cards_table).where(cards_table.c.id == card_id).values(**values))
            _renumber_if_needed(conn, cards_table, cards_table.c.column_id == column_id)
            tx.log(c.board_id, "card_moved", card_id, **{"from": source.name, "to": target.name})
            nxt = self._repeat(tx, c) if c.repeat and target.is_done and not source.is_done else None
            out = self._card_full(conn, user, card_id)
            if nxt:
                out["next"] = nxt
            return out

    def _repeat(self, tx: _Tx, c: Any) -> dict[str, Any] | None:
        """K3: a repeating task that is done comes back as a new task in the board's first open stage, with
        the same people, labels and steps (none ticked) and its next date. The done one stops repeating:
        the series goes on with the new task, so moving the old one back and forth makes no copies."""
        conn = tx.conn
        first = conn.execute(select(columns_table).where(columns_table.c.board_id == c.board_id,
                                                         columns_table.c.is_done.is_(False))
                             .order_by(columns_table.c.position, columns_table.c.id)).first()
        if first is None:
            return None
        today = date.fromtimestamp(tx.now)
        old_due = date.fromisoformat(c.due_date) if c.due_date else None
        due = next_due(c.repeat, old_due, today)
        start = None
        if c.start_date and c.due_date:  # keep the same lead time
            start = (due - (old_due - date.fromisoformat(c.start_date))).isoformat()
        nid = int(conn.execute(insert(cards_table).values(
            board_id=c.board_id, column_id=first.id, title=c.title, description=c.description, priority=c.priority,
            start_date=start, due_date=due.isoformat(), position=self._top(conn, first.id), archived=False,
            completed_at=None, repeat=c.repeat, created_by=tx.user.id, created_at=tx.now, updated_at=tx.now,
            updated_by=tx.user.username,
        )).inserted_primary_key[0])
        for r in conn.execute(select(card_assignees_table.c.user_id).where(card_assignees_table.c.card_id == c.id)):
            conn.execute(insert(card_assignees_table).values(card_id=nid, user_id=r.user_id))
        for r in conn.execute(select(card_names_table).where(card_names_table.c.card_id == c.id)):
            conn.execute(insert(card_names_table).values(card_id=nid, name=r.name, position=r.position))
        for r in conn.execute(select(card_labels_table.c.label_id).where(card_labels_table.c.card_id == c.id)):
            conn.execute(insert(card_labels_table).values(card_id=nid, label_id=r.label_id))
        for i in conn.execute(select(checklist_table).where(checklist_table.c.card_id == c.id)
                              .order_by(checklist_table.c.position, checklist_table.c.id)):
            conn.execute(insert(checklist_table).values(card_id=nid, text=i.text, done=False, position=i.position,
                                                        created_at=tx.now))
        for r in conn.execute(select(card_links_table).where(card_links_table.c.card_id == c.id)):
            conn.execute(insert(card_links_table).values(card_id=nid, kind=r.kind, target_id=r.target_id,
                                                         added_by=r.added_by, created_at=tx.now))
        conn.execute(update(cards_table).where(cards_table.c.id == c.id).values(repeat=None))
        tx.log(c.board_id, "card_repeated", nid, title=c.title, due=due.isoformat(), column=first.name)
        return {"id": nid, "due_date": due.isoformat(), "column": first.name}

    def delete_card(self, user: User, card_id: int) -> None:
        with self._write(user) as tx:
            conn = tx.conn
            c, _acc = self._card(conn, user, card_id, "edit")
            if not c.archived:
                raise HTTPException(status_code=409, detail="Archive the card first")
            files = conn.execute(select(attachments_table.c.file, attachments_table.c.thumb)
                                 .where(attachments_table.c.card_id == card_id)).all()
            for table in (attachments_table, comments_table, checklist_table, card_assignees_table,
                          card_labels_table, card_links_table, card_names_table, activity_table):
                conn.execute(delete(table).where(table.c.card_id == card_id))
            conn.execute(delete(cards_table).where(cards_table.c.id == card_id))
            tx.files.append((c.board_id, [n for f in files for n in (f.file, f.thumb)]))
            # the history row stays on the board, not on the card: a later card may get the same id
            tx.log(c.board_id, "card_deleted", title=c.title)
            tx.events[-1]["card_id"] = card_id

    # ------------------------------------------------------------------ action plan
    def _item(self, conn: Connection, user: User, item_id: int, need: str) -> tuple[Any, Any]:
        row = conn.execute(select(checklist_table).where(checklist_table.c.id == item_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Step not found")
        card, _acc = self._card(conn, user, row.card_id, need)
        return row, card

    def add_item(self, user: User, card_id: int, text: str) -> dict[str, Any]:
        with self._write(user) as tx:
            c, _acc = self._card(tx.conn, user, card_id, "edit")
            last = tx.conn.execute(select(func.max(checklist_table.c.position))
                                   .where(checklist_table.c.card_id == card_id)).scalar()
            tx.conn.execute(insert(checklist_table).values(
                card_id=card_id, text=text, done=False, position=(last or 0) + STEP, created_at=tx.now))
            tx.log(c.board_id, "item_added", card_id, text=text)
            return self._card_full(tx.conn, user, card_id)

    def update_item(self, user: User, item_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        with self._write(user) as tx:
            conn = tx.conn
            item, c = self._item(conn, user, item_id, "edit")
            values: dict[str, Any] = {}
            if changes.get("text") is not None and changes["text"] != item.text:
                values["text"] = changes["text"]
                tx.log(c.board_id, "item_updated", c.id, text=changes["text"], before=item.text)
            if changes.get("done") is not None and bool(changes["done"]) != bool(item.done):
                done = bool(changes["done"])
                values.update(done=done, done_by=user.username if done else None, done_at=tx.now if done else None)
                tx.log(c.board_id, "item_done" if done else "item_undone", c.id, text=values.get("text", item.text))
            if changes.get("position") is not None and changes["position"] != item.position:
                values["position"] = changes["position"]
                tx.log(c.board_id, "item_moved", c.id, text=values.get("text", item.text))
            if values:
                conn.execute(update(checklist_table).where(checklist_table.c.id == item_id).values(**values))
                if "position" in values:
                    _renumber_if_needed(conn, checklist_table, checklist_table.c.card_id == c.id)
            return self._card_full(conn, user, c.id)

    def delete_item(self, user: User, item_id: int) -> dict[str, Any]:
        with self._write(user) as tx:
            item, c = self._item(tx.conn, user, item_id, "edit")
            tx.conn.execute(delete(checklist_table).where(checklist_table.c.id == item_id))
            tx.log(c.board_id, "item_deleted", c.id, text=item.text)
            return self._card_full(tx.conn, user, c.id)

    # ------------------------------------------------------------------ comments
    def _comment(self, conn: Connection, user: User, comment_id: int, need: str) -> tuple[Any, Any, Access]:
        row = conn.execute(select(comments_table).where(comments_table.c.id == comment_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Comment not found")
        card, acc = self._card(conn, user, row.card_id, need)
        return row, card, acc

    def add_comment(self, user: User, card_id: int, body: str) -> dict[str, Any]:
        with self._write(user) as tx:
            c, _acc = self._card(tx.conn, user, card_id, "edit")
            cid = int(tx.conn.execute(insert(comments_table).values(
                card_id=card_id, user_id=user.id, body=body, created_at=tx.now)).inserted_primary_key[0])
            tx.log(c.board_id, "comment_added", card_id, comment_id=cid, excerpt=body[:120])
            return self._card_full(tx.conn, user, card_id)

    def edit_comment(self, user: User, comment_id: int, body: str) -> dict[str, Any]:
        with self._write(user) as tx:
            row, c, acc = self._comment(tx.conn, user, comment_id, "read")
            if row.user_id != user.id:
                raise HTTPException(status_code=403, detail="Only the author can edit a comment")
            if acc.board.archived:
                raise HTTPException(status_code=409, detail="The board is archived: restore it first")
            if body != row.body:
                tx.conn.execute(update(comments_table).where(comments_table.c.id == comment_id)
                                .values(body=body, edited_at=tx.now))
                tx.log(c.board_id, "comment_edited", c.id, comment_id=comment_id, excerpt=body[:120])
            return self._card_full(tx.conn, user, c.id)

    def delete_comment(self, user: User, comment_id: int) -> dict[str, Any]:
        with self._write(user) as tx:
            row, c, acc = self._comment(tx.conn, user, comment_id, "read")
            if row.user_id != user.id and not acc.can_manage:
                raise HTTPException(status_code=403, detail="Only the author or the board's owners can delete a comment")
            if acc.board.archived:
                raise HTTPException(status_code=409, detail="The board is archived: restore it first")
            tx.conn.execute(delete(comments_table).where(comments_table.c.id == comment_id))
            tx.log(c.board_id, "comment_deleted", c.id, comment_id=comment_id, excerpt=row.body[:120])
            return self._card_full(tx.conn, user, c.id)

    # ------------------------------------------------------------------ attachments
    def check_card_edit(self, user: User, card_id: int) -> int:
        """The card's board id when the user may add files to it (before the upload is read)."""
        with self.engine.connect() as conn:
            c, _acc = self._card(conn, user, card_id, "edit")
            return int(c.board_id)

    def _attachment(self, conn: Connection, user: User, att_id: int, need: str) -> tuple[Any, Any]:
        row = conn.execute(select(attachments_table).where(attachments_table.c.id == att_id)).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Attachment not found")
        try:
            card, _acc = self._card(conn, user, row.card_id, need)
        except HTTPException as exc:
            if exc.status_code == 404:
                raise HTTPException(status_code=404, detail="Attachment not found") from None
            raise
        return row, card

    def add_attachment(self, user: User, card_id: int, *, filename: str, content_type: str, size: int,
                       stored: str) -> dict[str, Any]:
        with self._write(user) as tx:
            c, _acc = self._card(tx.conn, user, card_id, "edit")
            aid = int(tx.conn.execute(insert(attachments_table).values(
                card_id=card_id, filename=filename, content_type=content_type, size=size, file=stored,
                uploaded_by=user.id, created_at=tx.now,
            )).inserted_primary_key[0])
            tx.log(c.board_id, "attachment_added", card_id, attachment_id=aid, filename=filename)
            row = tx.conn.execute(select(attachments_table).where(attachments_table.c.id == aid)).one()
            return {**attachment_json(row, _names(tx.conn, [user.id])), "card": self._card_full(tx.conn, user, card_id)}

    def attachment_for_thumb(self, user: User, att_id: int) -> int:
        """The board id when the user may give this attachment a preview."""
        with self.engine.connect() as conn:
            row, card = self._attachment(conn, user, att_id, "edit")
            if not is_image(row.content_type):
                raise HTTPException(status_code=400, detail="Only images have a preview")
            return int(card.board_id)

    def set_thumb(self, user: User, att_id: int, stored: str) -> dict[str, Any]:
        with self._write(user) as tx:
            row, c = self._attachment(tx.conn, user, att_id, "edit")
            tx.conn.execute(update(attachments_table).where(attachments_table.c.id == att_id).values(thumb=stored))
            if row.thumb:
                tx.files.append((c.board_id, [row.thumb]))
            tx.event(c.board_id, "attachment_preview", c.id)  # not a change worth a history row
            new = tx.conn.execute(select(attachments_table).where(attachments_table.c.id == att_id)).one()
            return attachment_json(new, _names(tx.conn, [new.uploaded_by]))

    def delete_attachment(self, user: User, att_id: int) -> dict[str, Any]:
        with self._write(user) as tx:
            row, c = self._attachment(tx.conn, user, att_id, "edit")
            tx.conn.execute(delete(attachments_table).where(attachments_table.c.id == att_id))
            tx.files.append((c.board_id, [row.file, row.thumb]))
            tx.log(c.board_id, "attachment_deleted", c.id, filename=row.filename)
            return self._card_full(tx.conn, user, c.id)

    def attachment_file(self, user: User, att_id: int, thumb: bool = False) -> tuple[Any, int]:
        with self.engine.connect() as conn:
            row, card = self._attachment(conn, user, att_id, "read")
            if thumb and not row.thumb:
                raise HTTPException(status_code=404, detail="This attachment has no preview")
            return row, int(card.board_id)


def _column_json(c: Any) -> dict[str, Any]:
    return {"id": c.id, "name": c.name, "color": c.color, "position": c.position, "is_done": bool(c.is_done)}


def _history_json(h: Any, names: dict[int, str]) -> dict[str, Any]:
    try:
        details = json.loads(h.details) if h.details else {}
    except ValueError:
        details = {}
    return {"id": h.id, "card_id": h.card_id, "user": names.get(h.user_id) if h.user_id is not None else None,
            "action": h.action, "details": details, "created_at": h.created_at}


# ---------------------------------------------------------------------- users and groups going away
def forget_user(conn: Connection, user_id: int, username: str) -> None:
    """Inside the transaction that deletes a user (AppDB.delete_user): their cards, comments, files
    and history stay under a tombstone id that keeps the name; assignments and memberships go."""
    conn.execute(delete(card_assignees_table).where(card_assignees_table.c.user_id == user_id))
    conn.execute(delete(board_members_table).where(board_members_table.c.user_id == user_id))
    refs = [(comments_table, comments_table.c.user_id), (cards_table, cards_table.c.created_by),
            (attachments_table, attachments_table.c.uploaded_by), (activity_table, activity_table.c.user_id),
            (boards_table, boards_table.c.owner_id)]
    if not any(conn.execute(select(col).where(col == user_id).limit(1)).first() for _t, col in refs):
        return
    lowest = conn.execute(select(func.min(activity_table.c.user_id)).where(activity_table.c.action == TOMBSTONE)).scalar()
    tomb = min(lowest or 0, 0) - 1
    conn.execute(insert(activity_table).values(
        board_id=0, user_id=tomb, action=TOMBSTONE, created_at=time.time(),
        details=json.dumps({"username": username}, ensure_ascii=False),
    ))
    for table, col in refs:
        conn.execute(update(table).where(col == user_id).values({col.name: tomb}))


def forget_group(conn: Connection, group_id: int) -> None:
    """Inside the transaction that deletes a group: its board memberships go."""
    conn.execute(delete(board_members_table).where(board_members_table.c.group_id == group_id))
