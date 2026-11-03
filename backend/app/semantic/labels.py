"""Names in place of ids (M12): "Show values as: Line → name".

A foreign-key column (a real foreign key or a relationship added in the data model) holds ids
of another table: downtime_events.line_id holds 1 ... 4, production_lines.name says what they
are. The data model keeps, per such column, which column of the related table names a row
("label_column", Admin -> Data model). Then

* questions grouped by the column show the name instead of the id: the compiler joins the
  related table and groups by id and name (app/query/compiler.py); filters, sorting and
  "filter the summary" still work on the id, so saved questions keep their meaning and order;
* value pickers list each id with its name ("3 · Paint line", app/query/values.py). Pickers
  also use an obvious label column when none is set, because a label there changes no result.

obvious_label() is the suggestion the data model editor offers and the pickers fall back to:
one column of the related table that clearly names a row - marked "name" in the data model,
called name / title / label, ending in _name, a code or a number.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_EXACT = ("name", "title", "label", "display_name", "full_name")


@dataclass(frozen=True)
class LabelLink:
    """table.key is what the column holds; table.label names it."""

    table: str
    key: str
    label: str
    label_type: str  # normalised type of the label column (see schema_graph.TYPES)
    explicit: bool   # set in the data model (else only an obvious column, used by pickers)

    def json(self) -> dict[str, Any]:
        return {"table": self.table, "key": self.key, "label": self.label}


def _type(col: dict[str, Any]) -> str:
    from ..schema_graph import normalize_type  # schema_graph imports this module

    return normalize_type(col.get("type"))


def obvious_label(columns: list[dict[str, Any]], meta: dict[str, dict[str, Any]] | None = None, *, key: str | None = None) -> str | None:
    """The one text column that clearly names a row of the table, or None when there is none or several."""
    meta = meta or {}
    usable = [
        c["name"] for c in columns
        if c["name"] != key and _type(c) == "string"
        and not meta.get(c["name"], {}).get("hidden") and not meta.get(c["name"], {}).get("parse_as_date")
    ]
    tiers = (
        lambda n: meta.get(n, {}).get("semantic_type") == "name",
        lambda n: n.lower() in _EXACT,
        lambda n: n.lower().endswith(("name", "title")),
        lambda n: n.lower().endswith("code"),
        lambda n: n.lower().endswith(("number", "_no")),
    )
    for fits in tiers:
        found = [n for n in usable if fits(n)]
        if found:
            return found[0] if len(found) == 1 else None  # two candidates: not obvious
    return None


def foreign_target(foreign: dict[str, list[dict[str, Any]]], table: str, column: str) -> tuple[str, str] | None:
    """(related table, its key column) when `column` alone references another table."""
    for fk in foreign.get(table, []):
        cols, refs = list(fk.get("constrained_columns") or []), list(fk.get("referred_columns") or [])
        if cols == [column] and len(refs) == 1 and fk.get("referred_table"):
            return fk["referred_table"], refs[0]
    return None


def label_link(
    table: str, column: str, *, columns: dict[str, list[dict[str, Any]]], foreign: dict[str, list[dict[str, Any]]],
    fields: dict[str, dict[str, dict[str, Any]]], explicit_only: bool = False,
) -> LabelLink | None:
    """How the values of table.column are named: the data-model setting, else (unless explicit_only) an obvious column."""
    target = foreign_target(foreign, table, column)
    if target is None or target[0] not in columns:
        return None
    to_table, key = target
    by_name = {c["name"]: c for c in columns[to_table]}
    if key not in by_name:
        return None
    setting = fields.get(table, {}).get(column, {}).get("label_column")
    if setting:
        if setting not in by_name or setting == key:
            return None  # the column was renamed or dropped: show the ids (Admin -> Broken content tells)
        return LabelLink(to_table, key, setting, _type(by_name[setting]), True)
    if explicit_only:
        return None
    label = obvious_label(columns[to_table], fields.get(to_table, {}), key=key)
    return LabelLink(to_table, key, label, "string", False) if label else None


def breakout_labels(
    columns: dict[str, list[dict[str, Any]]], foreign: dict[str, list[dict[str, Any]]],
    fields: dict[str, dict[str, dict[str, Any]]], restricted: set[str] | frozenset[str] = frozenset(),
) -> dict[tuple[str, str], LabelLink]:
    """The columns whose names the compiler shows: those with a data-model setting.

    `restricted`: tables (lower case) with row-level rules for the viewer. Their names are not
    looked up - the join would show names of rows the viewer may not see - so ids are shown.
    """
    out: dict[tuple[str, str], LabelLink] = {}
    for table, cols in fields.items():
        for column, info in cols.items():
            if not info.get("label_column"):
                continue
            link = label_link(table, column, columns=columns, foreign=foreign, fields=fields, explicit_only=True)
            if link is not None and link.table.lower() not in restricted:
                out[(table, column)] = link
    return out
