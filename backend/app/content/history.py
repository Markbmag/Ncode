"""History of questions and dashboards (roadmap M15, table content_versions, migration 0011).

Every save that changes what an item is - a question's name, description, query, chart or
parameters; a dashboard's name, description, filters, tabs, cards or settings - keeps the
item as it was saved, numbered per item (1, 2, 3 ...), with who saved it, when, and what
changed. Moving, archiving, starring or verifying an item is not a new version.

Items saved before history existed get their old state as the first version on their next
save ("As it was before history was kept"), so that save can be undone too. The newest
`keep` versions of an item are kept (NCODE_HISTORY_KEEP); the versions go when the item is
deleted (store.forget_items).

What changed is stored as a short list of codes in the `summary` column and put into words
when it is read, in the reader's language:

    [["changed", ["filters", "chart"]]]          "Changed the filters and the chart"
    [["added", 2], ["changed", ["layout"]]]      "Added 2 cards, changed the layout"
    [["restored", 3]]                            "Restored version 3"
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import delete, func, insert, select

from ..i18n import current_lang
from ..i18n_ru import HISTORY as HISTORY_RU
from .tables import content_versions_table

DEFAULT_KEEP = 50
Change = list[Any]  # ["changed", ["filters", "chart"]] | ["added", 2] | ["removed", 1] | ["renamed"] | ["restored", 3] | ...

QUESTION_FIELDS = ("name", "description", "kind", "connection", "spec", "viz", "parameters")
DASHBOARD_FIELDS = ("name", "description", "filters", "tabs", "cards", "settings")


def _same(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


# ---------------------------------------------------------------- what changed

# Parts of a builder query, in the words people use for them.
_BUILDER_PARTS = {
    "source": "tables", "joins": "tables", "expressions": "custom columns", "fields": "columns",
    "aggregations": "totals", "breakouts": "grouping", "filters": "filters", "having": "filters",
    "order": "sorting", "limit": "row limit", "transforms": "calculations",
}
_SQL_PARTS = {"sql": "SQL", "limit": "row limit", "transforms": "calculations"}


def _spec_nouns(kind: str, before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    parts = _BUILDER_PARTS if kind == "builder" else _SQL_PARTS if kind == "sql" else {}
    nouns: list[str] = []
    keys = set(before) | set(after)
    for key in [k for k in parts if k in keys] + sorted(keys - set(parts)):  # in the order of the editor
        if key in ("version", "connection", "result_columns") or _same(before.get(key), after.get(key)):
            continue
        noun = parts.get(key, "query")
        if noun not in nouns:
            nouns.append(noun)
    return nouns


def question_changes(before: dict[str, Any], after: dict[str, Any]) -> list[Change]:
    out: list[Change] = []
    if before.get("name") != after.get("name"):
        out.append(["renamed"])
    nouns: list[str] = []
    if before.get("description") != after.get("description"):
        nouns.append("description")
    if before.get("kind") != after.get("kind"):
        nouns.append("query")
    elif not _same(before.get("spec"), after.get("spec")):
        nouns += _spec_nouns(after.get("kind") or "", before.get("spec") or {}, after.get("spec") or {})
    if before.get("connection") != after.get("connection") and after.get("kind") != "federated":
        nouns.append("database")
    if not _same(before.get("parameters"), after.get("parameters")):
        nouns.append("parameters")
    if not _same(before.get("viz"), after.get("viz")):
        nouns.append("chart")
    if nouns:
        out.append(["changed", list(dict.fromkeys(nouns))])
    return out or [["saved"]]


def dashboard_changes(before: dict[str, Any], after: dict[str, Any]) -> list[Change]:
    out: list[Change] = []
    if before.get("name") != after.get("name"):
        out.append(["renamed"])
    old = {c["key"]: c for c in before.get("cards") or []}
    new = {c["key"]: c for c in after.get("cards") or []}
    added = [k for k in new if k not in old]
    removed = [k for k in old if k not in new]
    if added:
        out.append(["added", len(added)])
    if removed:
        out.append(["removed", len(removed)])
    nouns: list[str] = []
    if before.get("description") != after.get("description"):
        nouns.append("description")
    if not _same(before.get("filters"), after.get("filters")):
        nouns.append("filters")
    if not _same(before.get("tabs"), after.get("tabs")):
        nouns.append("tabs")
    common = [k for k in new if k in old]
    order_old = [k for k in old if k in new]
    if order_old != common or any(not _same(old[k].get("layout"), new[k].get("layout")) or old[k].get("tab") != new[k].get("tab") for k in common):
        nouns.append("layout")
    if any(old[k].get("text") != new[k].get("text") for k in common):
        nouns.append("texts")
    if any(
        not _same({f: old[k].get(f) for f in ("question_id", "viz", "title", "mappings", "kind")},
                  {f: new[k].get(f) for f in ("question_id", "viz", "title", "mappings", "kind")})
        for k in common
    ):
        nouns.append("card settings")
    if not _same(before.get("settings"), after.get("settings")):
        nouns.append("auto-refresh")
    if nouns:
        out.append(["changed", nouns])
    return out or [["saved"]]


# ---------------------------------------------------------------- in words

_EN = {
    "created": "Created", "baseline": "As it was before history was kept", "saved": "Saved",
    "renamed": "renamed", "restored": "restored version {n}", "changed": "changed {what}",
    "added": ("added {n} card", "added {n} cards"), "removed": ("removed {n} card", "removed {n} cards"),
}
_EN_NOUNS = {
    "description": "the description", "query": "the query", "tables": "the tables", "custom columns": "the custom columns",
    "columns": "the columns", "totals": "the totals", "grouping": "the grouping", "filters": "the filters",
    "sorting": "the sorting", "row limit": "the row limit", "calculations": "the calculations", "SQL": "the SQL",
    "database": "the database", "parameters": "the parameters", "chart": "the chart", "tabs": "the tabs",
    "layout": "the layout", "texts": "the texts", "card settings": "the card settings", "auto-refresh": "the auto-refresh",
}


def _ru_plural(n: int, forms: tuple[str, str, str]) -> str:
    """forms: one (1, 21), few (2-4, 22-24), many (5-20, 25 ...)."""
    if n % 10 == 1 and n % 100 != 11:
        return forms[0]
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return forms[1]
    return forms[2]


def _join(items: list[str], word: str) -> str:
    return items[0] if len(items) == 1 else f"{', '.join(items[:-1])} {word} {items[-1]}"


def describe(changes: Any, lang: str | None = None) -> str:
    """The stored change codes in plain words; text that is not a code list is shown as it is."""
    lang = lang or current_lang()
    if isinstance(changes, str):
        try:
            changes = json.loads(changes)
        except ValueError:
            return changes
    if not isinstance(changes, list) or not changes:
        return ""
    words = HISTORY_RU if lang == "ru" else None
    phrases: list[str] = []
    for change in changes:
        if not isinstance(change, list) or not change:
            continue
        code, arg = change[0], change[1] if len(change) > 1 else None
        if words is not None:
            if code == "changed":
                nouns = [words["nouns"].get(n, n) for n in arg or []]
                phrases.append(words["changed"].format(what=_join(nouns, "и")))
            elif code in ("added", "removed"):
                phrases.append(_ru_plural(int(arg), words[code]).format(n=arg))
            elif code in words:
                phrases.append(str(words[code]).format(n=arg))
        else:
            if code == "changed":
                phrases.append(_EN["changed"].format(what=_join([_EN_NOUNS.get(n, n) for n in arg or []], "and")))
            elif code in ("added", "removed"):
                phrases.append(_EN[code][0 if int(arg) == 1 else 1].format(n=arg))
            elif code in _EN:
                phrases.append(str(_EN[code]).format(n=arg))
    text = ", ".join(p for p in phrases if p)
    return text[:1].upper() + text[1:]


# ---------------------------------------------------------------- the table

def latest(conn: Any, item_type: str, item_id: int) -> Any:
    return conn.execute(
        select(content_versions_table)
        .where(content_versions_table.c.item_type == item_type, content_versions_table.c.item_id == item_id)
        .order_by(content_versions_table.c.version.desc())
        .limit(1)
    ).first()


def record(
    conn: Any, item_type: str, item_id: int, data: dict[str, Any], changes: list[Change], *,
    saved_by: str | None, saved_at: float, keep: int = DEFAULT_KEEP, before: dict[str, Any] | None = None,
    before_by: str | None = None, before_at: float | None = None,
) -> int | None:
    """Keep `data` as the item's next version (inside the transaction that saves it). Returns the
    new version number, or None when the item is the same as its newest version.

    `before` is the item as it was: an item with no history yet keeps that first."""
    last = latest(conn, item_type, item_id)
    if last is not None and _same(json.loads(last.data), data):
        return None
    number = last.version + 1 if last is not None else 1
    if last is None and before is not None and not _same(before, data):
        conn.execute(insert(content_versions_table).values(
            item_type=item_type, item_id=item_id, version=number, data=json.dumps(before, default=str),
            summary=json.dumps([["baseline"]]), saved_by=before_by, saved_at=before_at if before_at is not None else saved_at,
        ))
        number += 1
    conn.execute(insert(content_versions_table).values(
        item_type=item_type, item_id=item_id, version=number, data=json.dumps(data, default=str),
        summary=json.dumps(changes)[:300], saved_by=saved_by, saved_at=saved_at,
    ))
    if keep > 0:
        conn.execute(delete(content_versions_table).where(
            content_versions_table.c.item_type == item_type, content_versions_table.c.item_id == item_id,
            content_versions_table.c.version <= number - keep,
        ))
    return number


def forget(conn: Any, item_type: str, ids: list[int]) -> None:
    conn.execute(delete(content_versions_table).where(
        content_versions_table.c.item_type == item_type, content_versions_table.c.item_id.in_(ids)
    ))


def _row(r: Any, newest: int | None, with_data: bool = False) -> dict[str, Any]:
    out = {
        "version": r.version, "saved_by": r.saved_by, "saved_at": r.saved_at,
        "summary": describe(r.summary or ""), "current": r.version == newest,
    }
    if with_data:
        out["data"] = json.loads(r.data)
    return out


def versions(engine: Any, item_type: str, item_id: int) -> list[dict[str, Any]]:
    """The item's versions, newest first (without the saved data)."""
    c = content_versions_table.c
    with engine.connect() as conn:
        rows = conn.execute(
            select(c.version, c.saved_by, c.saved_at, c.summary)
            .where(c.item_type == item_type, c.item_id == item_id).order_by(c.version.desc())
        ).all()
    newest = rows[0].version if rows else None
    return [_row(r, newest) for r in rows]


def version(engine: Any, item_type: str, item_id: int, number: int) -> dict[str, Any] | None:
    """One version with the item as it was saved, or None."""
    c = content_versions_table.c
    with engine.connect() as conn:
        row = conn.execute(
            select(content_versions_table).where(c.item_type == item_type, c.item_id == item_id, c.version == number)
        ).first()
        newest = conn.execute(select(func.max(c.version)).where(c.item_type == item_type, c.item_id == item_id)).scalar()
    return _row(row, newest, with_data=True) if row is not None else None
