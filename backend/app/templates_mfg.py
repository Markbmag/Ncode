"""Dashboard templates for manufacturing (roadmap M15): mapped to real columns once, then ordinary content.

Four ready-made dashboards - "Downtime Pareto", "Scrap by shift and line", "Output vs plan" and
"OEE overview". Each declares the data it needs as roles in plain words ("Which table holds the
downtime events?", "Which column is the duration in minutes?"). An analyst answers them once for
a database - Ncode suggests the answers from column names, types and the data model's display
names (English and Russian) - and "Create" makes ordinary saved questions and a dashboard in a
collection. Nothing stays linked to the template afterwards.

* Roles: a table role names a table; a column role names "table.column" of that table or of a
  table it refers to through foreign keys (the reason's name in downtime_reasons for
  downtime_events.reason_id). Totals ("number" roles that are summed) come only from the table
  itself: summing a column of a related table would count it once per row. A "value" role is a
  number typed in (minutes a line is planned to work per day).
* A template's build function turns a mapping into questions: builder specs, or multi-source
  questions (app/federation) when two tables have to be combined per day - good pieces from the
  output reports against the plan from the work orders. Rates are ratios (M12): all scrap ÷ all
  pieces, so they stay right per line, shift or week. Every spec is compiled before anything is
  saved. Cards whose data is not mapped are left out and the plan says why, in plain words.

    GET  /api/templates?language=en                 the templates and their roles
    POST /api/templates/{id}/suggest                {connection, mapping, language} -> the mapping with
                                                    suggestions filled in, and the choices per role
    POST /api/templates/{id}/preview                {connection, mapping, language, card?, wait_ms} -> the
                                                    plan (cards, what is left out and why) and one card running
    POST /api/templates/{id}/create                 {connection, mapping, collection_id?, language, name?}
"""

from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, ValidationError

from .appdb import User
from .content.dashboards import Definition
from .content.store import ContentError
from .query.spec import QuerySpec
from .schema_graph import normalize_type
from .semantic.labels import label_link

Pair = tuple[str, str]  # (English, Russian)
RoleKind = Literal["table", "number", "date", "label", "value"]
MAX_HOPS = 3
SUGGEST_AT = 2.0  # the least score a column needs to be suggested


@dataclass(frozen=True)
class Role:
    key: str
    kind: RoleKind
    ask: Pair                     # the question in the mapping dialog
    noun: Pair                    # what is missing, in "needs <noun>"
    table: str | None = None      # column roles: the table role they belong to
    words: tuple[str, ...] = ()   # beginnings of words that hint at it (English and Russian)
    semantic: tuple[str, ...] = ()
    required: bool = True         # column roles: when their table is chosen
    help: Pair | None = None
    default: float | None = None  # value roles
    prefer: str | None = None     # table roles: the table of this role first (plan in the output table)
    own: bool = False             # number roles summed: only the table's own columns


@dataclass
class Template:
    id: str
    name: Pair
    description: Pair
    roles: tuple[Role, ...]
    build: Callable[["Ctx"], None]

    def role(self, key: str) -> Role:
        return next(r for r in self.roles if r.key == key)


class MappingError(ValueError):
    """The mapping does not fit the database (unknown column, text where a number is needed ...)."""


# ---------------------------------------------------------------- the database, as the suggestions see it

@dataclass
class Column:
    table: str
    name: str
    type: str           # normalised (schema_graph.TYPES)
    display: str | None
    display_ru: str | None
    semantic: str | None
    key: bool           # primary key or foreign key: an id, not a measure
    fk: tuple[str, str] | None = None  # (related table, its column) when this column refers to another table


@dataclass
class Step:
    """Join `table` from `source` (already in the query) on these column pairs."""

    source: str
    table: str
    on: tuple[tuple[str, str], ...]
    via: str  # the referring column's display name ("Reason"): a hint for what the related table holds


@dataclass
class Schema:
    connection: str
    columns: dict[str, dict[str, Column]]
    tables: dict[str, tuple[str | None, str | None]]   # table -> (display name, Russian display name)
    foreign: dict[str, list[dict[str, Any]]]
    raw_columns: dict[str, list[dict[str, Any]]]
    fields: dict[str, dict[str, dict[str, Any]]]

    def table_of(self, ref: str) -> tuple[str, str]:
        """("table", "column") of a "table.column" reference (table names may hold dots)."""
        for table in sorted(self.columns, key=len, reverse=True):
            if ref.startswith(table + "."):
                column = ref[len(table) + 1:]
                if column in self.columns[table]:
                    return table, column
        raise MappingError(f"There is no column {ref!r} in this database")

    def paths(self, start: str) -> dict[str, list[Step]]:
        """Tables `start` refers to (many rows to one: no row counted twice), with the joins to reach them."""
        out: dict[str, list[Step]] = {start: []}
        queue = deque([start])
        while queue:
            table = queue.popleft()
            if len(out[table]) >= MAX_HOPS:
                continue
            for fk in sorted(self.foreign.get(table, []), key=lambda f: (str(f.get("referred_table")), list(f.get("constrained_columns") or []))):
                target = fk.get("referred_table")
                cols, refs = list(fk.get("constrained_columns") or []), list(fk.get("referred_columns") or [])
                if not target or target in out or target not in self.columns or not cols or len(cols) != len(refs):
                    continue
                via = self.columns[table].get(cols[0])
                step = Step(table, target, tuple(zip(cols, refs)), (via.display or via.name) if via else cols[0])
                out[target] = out[table] + [step]
                queue.append(target)
        return out


def load_schema(connection: str, columns: dict[str, list[dict[str, Any]]], primary: dict[str, list[str]],
                foreign: dict[str, list[dict[str, Any]]], fields: dict[str, dict[str, dict[str, Any]]],
                tables: dict[str, dict[str, Any]]) -> Schema:
    out: dict[str, dict[str, Column]] = {}
    for table, cols in columns.items():
        fk_cols = {c for fk in foreign.get(table, []) for c in fk.get("constrained_columns") or []}
        single = {}
        for fk in foreign.get(table, []):
            cs, rs = list(fk.get("constrained_columns") or []), list(fk.get("referred_columns") or [])
            if len(cs) == 1 and len(rs) == 1 and fk.get("referred_table"):
                single[cs[0]] = (fk["referred_table"], rs[0])
        out[table] = {}
        for c in cols:
            meta = fields.get(table, {}).get(c["name"], {})
            if meta.get("hidden"):
                continue
            kind = "datetime" if meta.get("parse_as_date") else normalize_type(c.get("type"))
            ru = ((meta.get("translations") or {}).get("ru") or {}).get("display_name")
            out[table][c["name"]] = Column(
                table, c["name"], kind, meta.get("display_name"), ru, meta.get("semantic_type"),
                c["name"] in primary.get(table, []) or c["name"] in fk_cols, single.get(c["name"]),
            )
    names = {t: (m.get("display_name"), ((m.get("translations") or {}).get("ru") or {}).get("display_name")) for t, m in tables.items()}
    return Schema(connection, out, names, foreign, columns, fields)


# ---------------------------------------------------------------- suggestions

_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def _tokens(*texts: str | None) -> list[str]:
    out: list[str] = []
    for text in texts:
        if not text:
            continue
        spaced = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)  # camelCase -> camel Case
        out += [w.lower() for w in _WORD.findall(spaced)]
    return out


def _hits(words: tuple[str, ...], tokens: list[str]) -> int:
    return sum(1 for w in words if any(t.startswith(w) for t in tokens))


def _word_score(words: tuple[str, ...], *texts: str | None) -> float:
    hits = _hits(words, _tokens(*texts))
    return 3.0 + (hits - 1) if hits else 0.0


@dataclass
class Candidate:
    ref: str           # "table.column"
    score: float
    column: Column
    depth: int


def _fits(role: Role, c: Column) -> bool:
    if role.kind == "number":
        return c.type == "number" and not c.key and c.semantic != "id"
    if role.kind == "date":
        return c.type in ("date", "datetime")
    if role.kind == "label":
        return (c.type == "string" and c.semantic != "description") or c.fk is not None
    return False


def column_candidates(role: Role, schema: Schema, table: str) -> list[Candidate]:
    """The columns that can answer a column role for `table`, best first."""
    if table not in schema.columns:
        return []
    paths = {table: []} if role.own else schema.paths(table)
    found: dict[str, Candidate] = {}
    for tname, path in paths.items():
        depth = len(path)
        via = path[-1].via if path else None
        same_type = [c for c in schema.columns[tname].values() if _fits(role, c)]
        for c in same_type:
            col, d = c, depth
            score = _word_score(role.words, c.name, c.display, c.display_ru)
            score += _word_score(role.words, via) * 0.7 if via else 0.0
            if role.semantic and c.semantic in role.semantic:
                score += 2.0 if role.kind == "date" else 1.0
            if role.kind == "label":
                if c.fk is not None:  # an id: show the related table's name instead, when it has one
                    link = label_link(tname, c.name, columns=schema.raw_columns, foreign=schema.foreign, fields=schema.fields)
                    target = schema.columns.get(link.table, {}).get(link.label) if link else None
                    if target is None:
                        score -= 1.0  # ids only
                    else:
                        col = target
                        # what the data model says names the row (M12 "Show values as") comes first
                        score += _word_score(role.words, target.name, target.display, target.display_ru) * 0.5 + (3.0 if link.explicit else 2.0)
                        d += 1
                elif c.semantic in ("name", "category"):
                    score += 1.5 if c.semantic == "name" else 1.0
            if d == 0 and len(same_type) == 1:
                score += 2.0  # the only date (or number) of the table
            score -= 2.0 * d
            ref = f"{col.table}.{col.name}"
            if col.table not in paths:  # a label beyond the hops: not reachable
                continue
            if ref not in found or found[ref].score < score:
                found[ref] = Candidate(ref, score, col, d)
    return sorted(found.values(), key=lambda c: (-c.score, c.depth, c.ref))


def table_score(template: Template, role: Role, schema: Schema, table: str, chosen: dict[str, Any]) -> float:
    cols = schema.columns.get(table, {})
    if not cols:
        return -100.0
    display, ru = schema.tables.get(table, (None, None))
    score = _word_score(role.words, table, display, ru)
    for r in template.roles:
        if r.table != role.key or r.kind == "value":
            continue
        best = column_candidates(r, schema, table)
        top = best[0].score if best else -5.0
        if r.required:
            score += top if top >= SUGGEST_AT else -5.0
        elif top >= SUGGEST_AT:
            score += top * 0.5
    if role.prefer and chosen.get(role.prefer) == table and score > 0:
        score += 3.0
    return score


def table_candidates(template: Template, role: Role, schema: Schema, chosen: dict[str, Any]) -> list[tuple[str, float]]:
    scored = [(t, table_score(template, role, schema, t, chosen)) for t in schema.columns]
    return sorted(scored, key=lambda x: (-x[1], x[0]))


def suggest(template: Template, schema: Schema, given: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """The mapping with every empty role filled where a good answer exists, and which roles were filled."""
    mapping = {k: v for k, v in given.items() if v not in (None, "")}
    filled: list[str] = []
    for role in template.roles:  # tables first, in order (a later one may prefer an earlier one's table)
        if role.kind != "table" or role.key in given:
            continue  # given as null: the person said "not in my data"
        best = table_candidates(template, role, schema, mapping)
        if best and best[0][1] >= SUGGEST_AT * 2:
            mapping[role.key] = best[0][0]
            filled.append(role.key)
    for role in template.roles:
        if role.kind == "table" or role.key in given:
            continue
        if role.kind == "value":
            if role.default is not None:
                mapping[role.key] = role.default
                filled.append(role.key)
            continue
        table = mapping.get(role.table or "")
        if not table:
            continue
        best = column_candidates(role, schema, table)
        if best and best[0].score >= SUGGEST_AT:
            mapping[role.key] = best[0].ref
            filled.append(role.key)
    return mapping, filled


def _label(schema: Schema, ref: str, language: str) -> str:
    table, column = schema.table_of(ref)
    c = schema.columns[table][column]
    tdisplay, tru = schema.tables.get(table, (None, None))
    cname = (c.display_ru if language == "ru" else None) or c.display or c.name
    tname = (tru if language == "ru" else None) or tdisplay or table
    return f"{tname} → {cname}"


def options(template: Template, schema: Schema, mapping: dict[str, Any], language: str) -> dict[str, list[dict[str, Any]]]:
    """The choices per role for the dialog, best first (the suggestion is the first one)."""
    out: dict[str, list[dict[str, Any]]] = {}
    for role in template.roles:
        if role.kind == "value":
            continue
        if role.kind == "table":
            items = []
            for table, score in table_candidates(template, role, schema, mapping):
                display, ru = schema.tables.get(table, (None, None))
                items.append({"value": table, "label": (ru if language == "ru" else None) or display or table,
                              "detail": table, "good": score >= SUGGEST_AT * 2})
            out[role.key] = items
            continue
        table = mapping.get(role.table or "")
        cands = column_candidates(role, schema, table) if table else []
        out[role.key] = [{"value": c.ref, "label": _label(schema, c.ref, language), "detail": c.ref,
                          "good": c.score >= SUGGEST_AT} for c in cands]
    return out


# ---------------------------------------------------------------- building questions from a mapping

@dataclass
class Draft:
    """A question to make, and how the dashboard's filters reach it."""

    key: str
    kind: Literal["builder", "federated"]
    name: str
    description: str
    spec: dict[str, Any]
    viz: dict[str, Any] | None
    filters: dict[str, str] = field(default_factory=dict)  # dashboard filter id -> field


@dataclass
class CardDraft:
    key: str
    kind: Literal["question", "text"]
    layout: tuple[int, int, int, int]
    question: str | None = None
    text: str | None = None
    title: str | None = None
    viz: dict[str, Any] | None = None  # the card's own chart (several cards showing one question)


class Ctx:
    """What a template's build function works with: the checked mapping, texts in the chosen language."""

    def __init__(self, template: Template, schema: Schema, mapping: dict[str, Any], language: str):
        self.template = template
        self.schema = schema
        self.language = "ru" if language == "ru" else "en"
        self.mapping: dict[str, Any] = {}
        self.questions: dict[str, Draft] = {}
        self.cards: list[CardDraft] = []
        self.missing: list[dict[str, str]] = []  # {"name": what is left out, "reason": why}
        self.filters: list[dict[str, Any]] = []
        self._check(mapping)

    # ---- the mapping
    def _check(self, given: dict[str, Any]) -> None:
        roles = {r.key: r for r in self.template.roles}
        unknown = [k for k in given if k not in roles]
        if unknown:
            raise MappingError(f"Unknown part of the mapping: {', '.join(unknown)}")
        for role in self.template.roles:
            value = given.get(role.key)
            if value in (None, ""):
                continue
            if role.kind == "table":
                if not isinstance(value, str) or value not in self.schema.columns:
                    raise MappingError(self.tr(f"There is no table {value!r} in this database", f"В этой базе нет таблицы {value!r}"))
                self.mapping[role.key] = value
            elif role.kind == "value":
                try:
                    number = float(value)
                except (TypeError, ValueError):
                    raise MappingError(self.tr(f"{self.tr(*role.ask)} - give a number", f"{self.tr(*role.ask)} - укажите число")) from None
                if not 0 < number <= 100_000:
                    raise MappingError(self.tr(f"{self.tr(*role.ask)} - give a number above 0", f"{self.tr(*role.ask)} - укажите число больше 0"))
                self.mapping[role.key] = int(number) if number == int(number) else number
        for role in self.template.roles:
            value = given.get(role.key)
            if role.kind in ("table", "value") or value in (None, ""):
                continue
            table = self.mapping.get(role.table or "")
            if table is None:
                continue  # its table is not used
            if not isinstance(value, str):
                raise MappingError(f"{role.key}: give a column as table.column")
            ref_table, column = self.schema.table_of(value)
            col = self.schema.columns[ref_table][column]
            reach = {table: []} if role.own else self.schema.paths(table)
            what = self.tr(*role.noun)
            if ref_table not in reach:
                raise MappingError(self.tr(
                    f"{what}: {value} is not in the table {table} or a table it refers to",
                    f"{what}: {value} - не из таблицы {table} и не из таблицы, на которую она ссылается"))
            if role.kind == "number" and col.type != "number":
                raise MappingError(self.tr(f"{what}: {value} holds {col.type}, not numbers", f"{what}: в {value} не числа ({col.type})"))
            if role.kind == "date" and col.type not in ("date", "datetime"):
                raise MappingError(self.tr(f"{what}: {value} holds {col.type}, not dates", f"{what}: в {value} не даты ({col.type})"))
            self.mapping[role.key] = value

    def unmapped_required(self) -> list[str]:
        """Plain-word questions still unanswered that the template cannot do without."""
        out = []
        for role in self.template.roles:
            if role.kind == "table":
                needed = role.required and role.key not in self.mapping
            elif role.kind == "value":
                needed = False
            else:
                needed = role.required and role.table in self.mapping and role.key not in self.mapping
                table_role = self.template.role(role.table or "")
                if table_role.required and table_role.key not in self.mapping:
                    needed = False  # asked for the table first
            if needed:
                out.append(self.tr(*role.ask))
        return out

    def tr(self, en: str, ru: str) -> str:
        return ru if self.language == "ru" else en

    def has(self, *keys: str) -> bool:
        return all(k in self.mapping for k in keys)

    def ref(self, key: str) -> str:
        return self.mapping[key]

    def need(self, name: str, *keys: str) -> bool:
        """True when the roles are mapped; otherwise notes that `name` is left out, and why."""
        lacking = [self.tr(*self.template.role(k).noun) for k in keys if k not in self.mapping]
        if lacking:
            self.missing.append({"name": name, "reason": self.tr("needs ", "нужно: ") + ", ".join(lacking)})
            return False
        return True

    # ---- specs
    def builder(self, table_role: str, *, reach: dict[str, str | None] | None = None, **parts: Any) -> dict[str, Any]:
        """A builder spec on the table of `table_role`, with the joins its columns - and the columns the
        dashboard's filters narrow (`reach`: filter id -> column) - need."""
        source = self.mapping[table_role]
        refs = set(_refs(parts)) | {r for r in (reach or {}).values() if r}
        paths = self.schema.paths(source)
        joins: list[dict[str, Any]] = []
        added = {source}
        for ref in sorted(refs):
            try:
                table, _column = self.schema.table_of(ref)
            except MappingError:
                continue  # an output name ("order by Downtime, min")
            for step in paths.get(table, []):
                if step.table in added:
                    continue
                added.add(step.table)
                joins.append({"table": step.table, "on": [{"left": f"{step.source}.{a}", "right": f"{step.table}.{b}"} for a, b in step.on]})
        spec = {"version": 1, "connection": self.schema.connection, "source": {"table": source}, **({"joins": joins} if joins else {})}
        spec.update({k: v for k, v in parts.items() if v})
        return spec

    def question(self, key: str, name: str, description: str, kind: Literal["builder", "federated"], spec: dict[str, Any],
                 viz: dict[str, Any] | None, filters: dict[str, str | None]) -> str:
        self.questions[key] = Draft(key, kind, name, description, spec, viz, {k: v for k, v in filters.items() if v})
        return key

    def card(self, key: str, layout: tuple[int, int, int, int], question: str | None = None, *, text: str | None = None,
             title: str | None = None, viz: dict[str, Any] | None = None) -> None:
        self.cards.append(CardDraft(key, "text" if text is not None else "question", layout, question, text, title, viz))

    def filter(self, fid: str, label: str, ftype: str) -> None:
        self.filters.append({"id": fid, "label": label, "type": ftype})


def _refs(value: Any) -> list[str]:
    if isinstance(value, dict):
        out = [value["ref"]] if isinstance(value.get("ref"), str) else []
        for v in value.values():
            out += _refs(v)
        return out
    if isinstance(value, list):
        return [r for v in value for r in _refs(v)]
    return []


def _sum(ref: str, alias: str) -> dict[str, Any]:
    return {"fn": "sum", "ref": ref, "alias": alias}


def _ratio(num: dict[str, Any], den: dict[str, Any], alias: str) -> dict[str, Any]:
    """A rate that stays right in every group (M12): one total divided by another."""
    return {"fn": "ratio", "numerator": num, "denominator": den, "alias": alias}


def _plus(*refs: str) -> dict[str, Any]:
    expr: dict[str, Any] = {"ref": refs[0]}
    for r in refs[1:]:
        expr = {"op": "+", "args": [expr, {"ref": r}]}
    return expr


def _pct(*columns: str) -> dict[str, Any]:
    return {c: {"style": "percent", "decimals": 1} for c in columns}


def _kpi(value: str, *, up: bool, fmt: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"version": 1, "type": "kpi", "value": value, "kpi": {"compare": False, "sparkline": False, "upIsGood": up},
            **({"format": fmt} if fmt else {})}


def _chart(kind: str, x: str, ys: list[str], **more: Any) -> dict[str, Any]:
    return {"version": 1, "type": kind, "x": x, "series": [{"y": y} for y in ys], **more}


def _federated(sources: list[tuple[str, dict[str, Any]]], keys: list[str], values: dict[str, list[str]],
               post: dict[str, Any]) -> dict[str, Any]:
    """Several builder sources joined per key (a full join: a day with a plan but no output still counts).

    The keys come out once, as custom columns named like the keys (coalesced from both sides), so the
    post step and the dashboard's filters refer to "day" and "line"."""
    first = sources[0][0]
    joins = [{"source": alias, "type": "full", "on": [{"left": f"{first}.{k}", "right": f"{alias}.{k}"} for k in keys]}
             for alias, _spec in sources[1:]]
    columns = [{"ref": f"{alias}.{k}", "alias": f"{alias}_{k}"} for k in keys for alias, _s in sources]
    columns += [{"ref": f"{alias}.{v}", "alias": v} for alias, vs in values.items() for v in vs]
    keyed = [{"name": k, "expr": {"fn": "coalesce", "args": [{"ref": f"{alias}_{k}"} for alias, _s in sources]}} for k in keys]
    filled = [{"name": f"{v}_0", "expr": {"fn": "coalesce", "args": [{"ref": v}, {"value": 0}]}} for vs in values.values() for v in vs]
    post = {**post, "expressions": keyed + filled + list(post.get("expressions", []))}
    return {"version": 1, "sources": [{"alias": a, "type": "builder", "spec": s} for a, s in sources],
            "mode": "join", "joins": joins, "columns": columns, "post": post}


def _intro(c: Ctx, title: str, text: str) -> str:
    parts = [f"**{title}.** {text}"]
    if c.missing:
        parts.append(c.tr("**Not shown, because the data has no column for it:**", "**Не показано: в данных нет нужного столбца.**"))
        parts += [f"- {m['name']}: {m['reason']}" for m in c.missing]
    return "\n\n".join(parts[:1]) + ("\n\n" + "\n".join(parts[1:]) if len(parts) > 1 else "")


# ---------------------------------------------------------------- the templates

_LINE_WORDS = ("line", "machine", "station", "workcent", "work_cent", "cell", "equipment", "линия", "линии", "станок", "участок", "оборудован")
_DATE_WORDS = ("date", "day", "time", "when", "start", "began", "begin", "report", "record", "дата", "день", "время", "начал", "когда")
_SHIFT_WORDS = ("shift", "смен")


def _line_role(table: str) -> Role:
    return Role(f"{table}_line" if table != "events" else "line", "label",
                ("Which column says the line (or machine)?", "В каком столбце линия (или станок)?"),
                ("a line column", "столбец с линией"), table=table, words=_LINE_WORDS, semantic=("name", "category"), required=False,
                help=("Leave empty if the data has no lines: the cards per line are left out.",
                      "Оставьте пустым, если линий в данных нет: карточки по линиям не появятся."))


def _date_role(key: str, table: str, ask: Pair) -> Role:
    return Role(key, "date", ask, ("a date column", "столбец с датой"), table=table, words=_DATE_WORDS, semantic=("created",))


_OUTPUT_TABLE_WORDS = ("output", "production", "produced", "report", "yield", "result", "выпуск", "производств", "сдач", "отчёт", "отчет")
_GOOD_WORDS = ("good", "ok", "pass", "yield", "produced", "output", "годн", "выпуск", "сдан")
_SCRAP_WORDS = ("scrap", "reject", "defect", "bad", "nok", "waste", "брак", "дефект", "отбрак")


def _downtime_roles(required: bool) -> tuple[Role, ...]:
    return (
        Role("events", "table", ("Which table holds the downtime events?", "В какой таблице простои?"),
             ("the downtime table", "таблица простоев"),
             words=("downtime", "stop", "stoppage", "outage", "breakdown", "простой", "простои", "останов"), required=required,
             help=("One row per stop of a line: when, how long, why.", "Одна строка на каждую остановку линии: когда, сколько, почему.")),
        Role("minutes", "number", ("Which column is the duration in minutes?", "В каком столбце длительность в минутах?"),
             ("the duration in minutes", "длительность в минутах"), table="events",
             words=("minute", "min", "duration", "length", "длительн", "мин", "минут", "продолжит"), semantic=("quantity",), own=True),
    )


def _build_downtime(c: Ctx) -> None:
    mins, day = c.ref("minutes"), c.ref("date")
    line = c.mapping.get("line")
    a_min, a_stops = c.tr("Downtime, min", "Простой, мин"), c.tr("Stops", "Остановки")
    a_reason, a_line, a_week = c.tr("Reason", "Причина"), c.tr("Line", "Линия"), c.tr("Week", "Неделя")
    f = {"period": day, "line": line}
    c.filter("period", c.tr("Period", "Период"), "date_range")
    if line:
        c.filter("line", c.tr("Line", "Линия"), "category")
    q = c.question("total", c.tr("Downtime minutes", "Минуты простоя"),
                   c.tr("All minutes the lines stood still.", "Все минуты, которые линии простаивали."), "builder",
                   c.builder("events", aggregations=[_sum(mins, a_min)], reach=f), _kpi(a_min, up=False), f)
    c.card("total", (0, 2, 3, 5), q)
    q = c.question("stops", c.tr("Number of stops", "Число остановок"),
                   c.tr("How many times a line stopped.", "Сколько раз останавливались линии."), "builder",
                   c.builder("events", aggregations=[{"fn": "count", "alias": a_stops}], reach=f), _kpi(a_stops, up=False), f)
    c.card("stops", (3, 2, 3, 5), q)
    q = c.question("week", c.tr("Downtime per week", "Простои по неделям"),
                   c.tr("Minutes of downtime per week: is it getting better?", "Минуты простоя по неделям: становится ли лучше?"), "builder",
                   c.builder("events", aggregations=[_sum(mins, a_min)], breakouts=[{"ref": day, "bucket": "week", "alias": a_week}],
                             order=[{"ref": a_week, "dir": "asc"}], reach=f),
                   _chart("line", a_week, [a_min]), f)
    c.card("week", (6, 2, 6, 5), q)
    q = c.question("pareto", c.tr("Downtime by reason (top 10)", "Простои по причинам (топ-10)"),
                   c.tr("The ten reasons that cost the most minutes, biggest first: fix the top ones first.",
                        "Десять причин, на которые ушло больше всего минут, по убыванию: начинайте с верхних."), "builder",
                   c.builder("events", aggregations=[_sum(mins, a_min)], breakouts=[{"ref": c.ref("reason"), "alias": a_reason}],
                             order=[{"ref": a_min, "dir": "desc"}], limit=10, reach=f),
                   _chart("bar", a_reason, [a_min], horizontal=True, labels=True), f)
    c.card("pareto", (0, 7, 7, 9), q)
    name = c.tr("Downtime by line", "Простои по линиям")
    if c.need(name, "line"):
        q = c.question("by_line", name, c.tr("Minutes of downtime of each line.", "Минуты простоя каждой линии."), "builder",
                       c.builder("events", aggregations=[_sum(mins, a_min)], breakouts=[{"ref": line, "alias": a_line}],
                                 order=[{"ref": a_min, "dir": "desc"}], reach=f),
                       _chart("bar", a_line, [a_min], labels=True), f)
        c.card("by_line", (7, 7, 5, 9), q)
    c.card("intro", (0, 0, 12, 2), text=_intro(c, c.tr("Downtime Pareto", "Парето простоев"), c.tr(
        "The reasons that cost the most minutes come first. Change the *Period* or pick a *Line*: every card follows.",
        "Причины, на которые ушло больше всего минут, идут первыми. Измените *Период* или выберите *Линию* - все карточки обновятся.")))


def _build_scrap(c: Ctx) -> None:
    scrap, day = c.ref("scrap"), c.ref("date")
    good, line, shift = c.mapping.get("good"), c.mapping.get("output_line"), c.mapping.get("shift")
    a_scrap, a_rate = c.tr("Scrapped pieces", "Брак, шт."), c.tr("Scrap rate", "Доля брака")
    a_line, a_shift, a_week = c.tr("Line", "Линия"), c.tr("Shift", "Смена"), c.tr("Week", "Неделя")
    rate = _ratio({"fn": "sum", "ref": scrap}, {"fn": "sum", "expr": _plus(good, scrap)}, a_rate) if good else None
    rate_text = c.tr("Scrapped pieces as a share of all pieces (good and scrapped): all scrap ÷ all pieces.",
                     "Бракованные штуки как доля всех штук (годных и бракованных): весь брак ÷ все штуки.")
    f = {"period": day, "line": line, "shift": shift}
    c.filter("period", c.tr("Period", "Период"), "date_range")
    if line:
        c.filter("line", c.tr("Line", "Линия"), "category")
    if shift:
        c.filter("shift", c.tr("Shift", "Смена"), "category")
    def spec(**p: Any) -> dict[str, Any]:
        order = [{"ref": p["breakouts"][0]["alias"], "dir": "asc"}] if p.get("breakouts") else []
        return c.builder("output", reach=f, order=order, **p)

    q = c.question("total", c.tr("Scrapped pieces", "Бракованные штуки"), c.tr("All pieces that went to scrap.", "Все штуки, ушедшие в брак."),
                   "builder", spec(aggregations=[_sum(scrap, a_scrap)]), _kpi(a_scrap, up=False), f)
    c.card("total", (0, 2, 3, 5), q)
    rate_name = c.tr("Scrap rate", "Доля брака")
    if c.need(rate_name, "good"):
        q = c.question("rate", rate_name, rate_text, "builder", spec(aggregations=[rate]), _kpi(a_rate, up=False, fmt=_pct(a_rate)), f)
        c.card("rate", (3, 2, 3, 5), q)
        q = c.question("rate_week", c.tr("Scrap rate per week", "Доля брака по неделям"), rate_text, "builder",
                       spec(aggregations=[rate], breakouts=[{"ref": day, "bucket": "week", "alias": a_week}]),
                       _chart("line", a_week, [a_rate], format=_pct(a_rate)), f)
    else:
        q = c.question("week", c.tr("Scrapped pieces per week", "Брак по неделям"),
                       c.tr("Scrapped pieces per week.", "Бракованные штуки по неделям."), "builder",
                       spec(aggregations=[_sum(scrap, a_scrap)], breakouts=[{"ref": day, "bucket": "week", "alias": a_week}]),
                       _chart("line", a_week, [a_scrap]), f)
    c.card("week", (6, 2, 6, 5), q)
    groups = [(r, a) for r, a in ((line, a_line), (shift, a_shift)) if r]
    name = c.tr("Scrapped pieces by line and shift", "Брак по линиям и сменам")
    if not groups:
        c.need(name, "output_line", "shift")
    else:
        breakouts = [{"ref": r, "alias": a} for r, a in groups]
        viz = _chart("bar", groups[0][1], [a_scrap], **({"breakout": groups[1][1], "stack": "stacked"} if len(groups) > 1 else {}))
        if len(groups) == 1:
            name = c.tr("Scrapped pieces by line", "Брак по линиям") if line else c.tr("Scrapped pieces by shift", "Брак по сменам")
        q = c.question("pieces", name, c.tr("Which line and shift scrap the most pieces.", "Какие линии и смены дают больше всего брака."),
                       "builder", spec(aggregations=[_sum(scrap, a_scrap)], breakouts=breakouts), viz, f)
        c.card("pieces", (0, 7, 6, 8), q)
    for key, role, ref, alias, x, name in (
        ("rate_line", "output_line", line, a_line, 6, c.tr("Scrap rate by line", "Доля брака по линиям")),
        ("rate_shift", "shift", shift, a_shift, 9, c.tr("Scrap rate by shift", "Доля брака по сменам")),
    ):
        if c.need(name, "good", role) and ref:
            q = c.question(key, name, rate_text, "builder", spec(aggregations=[rate], breakouts=[{"ref": ref, "alias": alias}]),
                           _chart("bar", alias, [a_rate], format=_pct(a_rate), labels=True), f)
            c.card(key, (x, 7, 3, 8), q)
    c.card("intro", (0, 0, 12, 2), text=_intro(c, c.tr("Scrap by shift and line", "Брак по сменам и линиям"), c.tr(
        "Scrapped pieces and the scrap rate (all scrap ÷ all pieces) per line, shift and week. Change the *Period* above: every card follows.",
        "Бракованные штуки и доля брака (весь брак ÷ все штуки) по линиям, сменам и неделям. Измените *Период* выше - все карточки обновятся.")))


def _build_output(c: Ctx) -> None:
    good, plan = c.ref("good"), c.ref("planned")
    out_day, plan_day = c.ref("date"), c.ref("plan_date")
    out_line, plan_line = c.mapping.get("output_line"), c.mapping.get("plan_line")
    same = c.ref("output") == c.ref("plan")
    lined = bool(out_line and plan_line)
    a_good, a_plan, a_pct = c.tr("Good pieces", "Годные, шт."), c.tr("Planned pieces", "План, шт."), c.tr("% of plan", "% плана")
    a_day, a_week, a_line = c.tr("Day", "День"), c.tr("Week", "Неделя"), c.tr("Line", "Линия")
    pct_text = c.tr("Good pieces as a share of the planned quantity: all good ÷ all planned. 100 % means the plan was made.",
                    "Годные штуки как доля плана: все годные ÷ весь план. 100 % - план выполнен.")
    c.filter("period", c.tr("Period", "Период"), "date_range")
    if lined or (same and out_line):
        c.filter("line", c.tr("Line", "Линия"), "category")
    # the totals: each from its own table
    q = c.question("good", c.tr("Good pieces", "Годные штуки"), c.tr("All good pieces reported.", "Все сданные годные штуки."), "builder",
                   c.builder("output", aggregations=[_sum(good, a_good)], reach={"period": out_day, "line": out_line}), _kpi(a_good, up=True),
                   {"period": out_day, "line": out_line})
    c.card("good", (0, 2, 4, 5), q)
    q = c.question("plan", c.tr("Planned pieces", "План, штук"), c.tr("All pieces planned.", "Все запланированные штуки."), "builder",
                   c.builder("plan", aggregations=[_sum(plan, a_plan)], reach={"period": plan_day, "line": plan_line}), _kpi(a_plan, up=True),
                   {"period": plan_day, "line": plan_line})
    c.card("plan", (4, 2, 4, 5), q)

    def per(bucket: str | None, by_line: bool, *, last: int | None = None) -> tuple[str, dict[str, Any], dict[str, str | None]]:
        """(kind, spec, filters): good, planned and % of plan per bucket (and line)."""
        names = [a_day if bucket == "day" else a_week] if bucket else []
        aggs = [_sum(good if same else a_good, a_good), _sum(plan if same else a_plan, a_plan),
                _ratio({"fn": "sum", "ref": good if same else a_good}, {"fn": "sum", "ref": plan if same else a_plan}, a_pct)]
        if same:  # one table holds both: one question
            breakouts = ([{"ref": out_day, "bucket": bucket, "alias": names[0]}] if bucket else []) + (
                [{"ref": out_line, "alias": a_line}] if by_line else [])
            recent = {"filters": {"op": "and", "rules": [{"ref": out_day, "op": "last", "value": {"amount": last, "unit": "day"}}]}} if last else {}
            order = [{"ref": names[0], "dir": "asc"}] if bucket else [{"ref": a_pct, "dir": "asc"}] if by_line else []
            reach = {"period": out_day, "line": out_line}
            return "builder", c.builder("output", aggregations=aggs, breakouts=breakouts, order=order, reach=reach, **recent), reach
        # two tables: good pieces per day (and line) from one, the plan from the other, joined per day
        keys = ["day"] + (["line"] if lined else [])

        def side(role: str, value: str, alias: str, day: str, line: str | None) -> dict[str, Any]:
            breakouts = [{"ref": day, "bucket": "day", "alias": "day"}] + ([{"ref": line, "alias": "line"}] if lined and line else [])
            recent = {"filters": {"op": "and", "rules": [{"ref": day, "op": "last", "value": {"amount": last, "unit": "day"}}]}} if last else {}
            return c.builder(role, aggregations=[_sum(value, alias)], breakouts=breakouts, **recent)

        post_breakouts = ([{"ref": "day", "bucket": bucket, "alias": names[0]}] if bucket else []) + (
            [{"ref": "line", "alias": a_line}] if by_line else [])
        post_aggs = [_sum("good_0", a_good), _sum("planned_0", a_plan),
                     _ratio({"fn": "sum", "ref": "good_0"}, {"fn": "sum", "ref": "planned_0"}, a_pct)]
        order = [{"ref": names[0], "dir": "asc"}] if bucket else [{"ref": a_pct, "dir": "asc"}] if by_line else []
        spec = _federated([("good", side("output", good, "good", out_day, out_line)), ("planned", side("plan", plan, "planned", plan_day, plan_line))],
                          keys, {"good": ["good"], "planned": ["planned"]},
                          {"breakouts": post_breakouts, "aggregations": post_aggs, **({"order": order} if order else {})})
        return "federated", spec, {"period": "day", "line": "line" if lined else None}

    kind, spec, f = per(None, False)
    q = c.question("pct", c.tr("% of plan", "Выполнение плана, %"), pct_text, kind, spec, _kpi(a_pct, up=True, fmt=_pct(a_pct)), f)
    c.card("pct", (8, 2, 4, 5), q)
    kind, spec, f = per("day", False, last=30)
    q = c.question("daily", c.tr("Good pieces vs plan, last 30 days", "Годные и план за последние 30 дней"),
                   c.tr("Bars: good pieces per day. Line: the plan.", "Столбцы: годные штуки по дням. Линия: план."), kind, spec,
                   {"version": 1, "type": "combo", "x": a_day, "series": [{"y": a_good, "kind": "bar"}, {"y": a_plan, "kind": "line"}]}, f)
    c.card("daily", (0, 7, 12, 8), q)
    kind, spec, f = per("week", False)
    q = c.question("weekly", c.tr("% of plan per week", "Выполнение плана по неделям"), pct_text, kind, spec,
                   _chart("line", a_week, [a_pct], format=_pct(a_pct), goal={"value": 1, "label": c.tr("Plan", "План")}), f)
    c.card("weekly", (0, 15, 7, 8), q)
    name = c.tr("% of plan by line", "Выполнение плана по линиям")
    if c.need(name, *(["output_line"] if same else ["output_line", "plan_line"])):
        kind, spec, f = per(None, True)
        q = c.question("by_line", name, pct_text, kind, spec, _chart("bar", a_line, [a_pct], format=_pct(a_pct), labels=True), f)
        c.card("by_line", (7, 15, 5, 8), q)
    c.card("intro", (0, 0, 12, 2), text=_intro(c, c.tr("Output vs plan", "Выпуск и план"), c.tr(
        "Good pieces against the planned quantity: 100 % means the plan was made. Change the *Period* above: every card follows.",
        "Годные штуки против плана: 100 % - план выполнен. Измените *Период* выше - все карточки обновятся.")))


def _build_oee(c: Ctx) -> None:
    good, day = c.ref("good"), c.ref("date")
    scrap, rate, line = c.mapping.get("scrap"), c.mapping.get("rate"), c.mapping.get("output_line")
    has_down = c.has("events", "minutes", "downtime_date")
    planned = c.mapping.get("planned_minutes")
    down_line = c.mapping.get("line")
    lined = bool(line and (not has_down or down_line))
    a = {k: c.tr(*v) for k, v in {"A": ("Availability", "Доступность"), "P": ("Performance", "Производительность"),
                                   "Q": ("Quality", "Качество"), "OEE": ("OEE", "OEE"), "week": ("Week", "Неделя"),
                                   "line": ("Line", "Линия")}.items()}
    texts = {
        "A": c.tr("Availability: the share of the planned time the lines ran = (planned time − downtime) ÷ planned time.",
                  "Доступность: доля планового времени, когда линии работали = (плановое время − простои) ÷ плановое время."),
        "P": c.tr("Performance: pieces made against what the rated speed allows in the time the lines ran.",
                  "Производительность: сделанные штуки против того, что позволяет паспортная скорость за время работы."),
        "Q": c.tr("Quality: good pieces ÷ all pieces (good and scrapped).", "Качество: годные штуки ÷ все штуки (годные и брак)."),
        "OEE": c.tr("OEE = availability × performance × quality: the share of the planned time spent making good pieces at full speed.",
                    "OEE = доступность × производительность × качество: доля планового времени, когда делались годные штуки на полной скорости."),
    }
    # which parts the data supports
    parts: dict[str, bool] = {}
    # OEE itself = good pieces at rated speed ÷ planned time (the same as A × P × Q): it needs neither the
    # downtime nor the scrap
    parts["OEE"] = c.need(a["OEE"], "planned_minutes", "rate")
    parts["A"] = c.need(a["A"], "planned_minutes", "events")
    parts["P"] = c.need(a["P"], "planned_minutes", "rate", "events")
    parts["Q"] = c.need(a["Q"], "scrap")
    shown = [k for k in ("OEE", "A", "P", "Q") if parts[k]]
    c.filter("period", c.tr("Period", "Период"), "date_range")
    if lined:
        c.filter("line", c.tr("Line", "Линия"), "category")
    if not shown:
        raise MappingError(c.tr("OEE needs at least the scrapped pieces (for quality) or the downtime and the planned time (for availability)",
                                "Для OEE нужен хотя бы брак (для качества) или простои и плановое время (для доступности)"))

    def spec(by: str | None) -> tuple[Literal["builder", "federated"], dict[str, Any], dict[str, str | None]]:
        if not parts["A"] and not parts["P"]:  # quality only: one table
            breakouts = [{"ref": day, "bucket": "week", "alias": a["week"]}] if by == "week" else [{"ref": line, "alias": a["line"]}] if by == "line" else []
            q = _ratio({"fn": "sum", "ref": good}, {"fn": "sum", "expr": _plus(good, scrap)}, a["Q"])
            order = [{"ref": breakouts[0]["alias"], "dir": "asc"}] if breakouts else []
            reach = {"period": day, "line": line}
            return "builder", c.builder("output", aggregations=[q], breakouts=breakouts, order=order, reach=reach), reach
        # per day and line: output (and the ideal minutes at rated speed) joined to the downtime; the planned
        # time is the planned minutes for each day a line reported output or downtime
        keys = ["day"] + (["line"] if lined else [])
        out_aggs = [_sum(good, "good")] + ([_sum(scrap, "scrap")] if scrap else [])
        if rate:
            minutes = lambda e: {"op": "/", "args": [{"op": "*", "args": [e, {"value": 60}]}, {"ref": rate}]}  # noqa: E731
            out_aggs += [{"fn": "sum", "expr": minutes(_plus(good, scrap) if scrap else {"ref": good}), "alias": "ideal"},
                         {"fn": "sum", "expr": minutes({"ref": good}), "alias": "good_ideal"}]
        out = c.builder("output", aggregations=out_aggs, breakouts=[{"ref": day, "bucket": "day", "alias": "day"}] + (
            [{"ref": line, "alias": "line"}] if lined else []))
        sources = [("out", out)]
        values = {"out": [x["alias"] for x in out_aggs]}
        if has_down:
            sources.append(("down", c.builder("events", aggregations=[_sum(c.ref("minutes"), "downtime")],
                                               breakouts=[{"ref": c.ref("downtime_date"), "bucket": "day", "alias": "day"}] + (
                                                   [{"ref": down_line, "alias": "line"}] if lined else []))))
            values["down"] = ["downtime"]
        exprs: list[dict[str, Any]] = []
        if planned:
            exprs.append({"name": "planned", "expr": {"value": planned}})
            exprs.append({"name": "run", "expr": {"op": "-", "args": [{"ref": "planned"}, {"ref": "downtime_0"} if has_down else {"value": 0}]}})
        aggs = []
        for k in shown:
            if k == "A":
                aggs.append(_ratio({"fn": "sum", "ref": "run"}, {"fn": "sum", "ref": "planned"}, a["A"]))
            elif k == "P":
                aggs.append(_ratio({"fn": "sum", "ref": "ideal_0"}, {"fn": "sum", "ref": "run"}, a["P"]))
            elif k == "Q":
                aggs.append(_ratio({"fn": "sum", "ref": "good_0"}, {"fn": "sum", "expr": _plus("good_0", "scrap_0")}, a["Q"]))
            else:
                aggs.append(_ratio({"fn": "sum", "ref": "good_ideal_0"}, {"fn": "sum", "ref": "planned"}, a["OEE"]))
        breakouts = [{"ref": "day", "bucket": "week", "alias": a["week"]}] if by == "week" else [{"ref": "line", "alias": a["line"]}] if by == "line" else []
        post = {"expressions": exprs, "breakouts": breakouts, "aggregations": aggs,
                **({"order": [{"ref": breakouts[0]["alias"], "dir": "asc"}]} if breakouts else {})}
        return "federated", _federated(sources, keys, values, post), {"period": "day", "line": "line" if lined else None}

    kind, s, f = spec(None)
    q = c.question("overview", c.tr("OEE overview", "Обзор OEE"), " ".join(texts[k] for k in shown), kind, s,
                   {"version": 1, "type": "table", "format": _pct(*(a[k] for k in shown))}, f)
    for i, k in enumerate(shown):
        c.card(f"kpi_{k.lower()}", (i * 3, 2, 3, 5), q, title=a[k], viz={"mode": "chart", "spec": _kpi(a[k], up=True, fmt=_pct(a[k]))})
    kind, s, f = spec("week")
    q = c.question("week", c.tr("OEE per week", "OEE по неделям"), " ".join(texts[k] for k in shown), kind, s,
                   _chart("line", a["week"], [a[k] for k in shown], format=_pct(*(a[k] for k in shown))), f)
    c.card("week", (0, 7, 12, 8), q)
    name = c.tr("OEE by line", "OEE по линиям")
    if c.need(name, "output_line", *(["line"] if has_down else [])):
        kind, s, f = spec("line")
        q = c.question("by_line", name, " ".join(texts[k] for k in shown), kind, s,
                       _chart("bar", a["line"], [a[k] for k in shown], format=_pct(*(a[k] for k in shown))), f)
        c.card("by_line", (0, 15, 12, 8), q)
    planned_text = c.tr(f" The planned time is {planned} minutes for each day a line worked.",
                        f" Плановое время - {planned} минут на каждый рабочий день линии.") if planned else ""
    c.card("intro", (0, 0, 12, 2), text=_intro(c, c.tr("OEE overview", "Обзор OEE"), c.tr(
        "Overall equipment effectiveness = availability × performance × quality.",
        "Общая эффективность оборудования = доступность × производительность × качество.") + planned_text))


TEMPLATES: list[Template] = [
    Template(
        "downtime_pareto", ("Downtime Pareto", "Парето простоев"),
        ("Downtime minutes by reason, the ten biggest first, and by line.",
         "Минуты простоя по причинам (десять главных) и по линиям."),
        (
            *_downtime_roles(True),
            Role("reason", "label", ("Which column says why the line stopped?", "В каком столбце причина остановки?"),
                 ("a reason column", "столбец с причиной"), table="events",
                 words=("reason", "cause", "why", "причин", "почему"), semantic=("name", "category")),
            _date_role("date", "events", ("Which column says when the stop started?", "В каком столбце начало простоя?")),
            _line_role("events"),
        ),
        _build_downtime,
    ),
    Template(
        "scrap_shift_line", ("Scrap by shift and line", "Брак по сменам и линиям"),
        ("Scrapped pieces and the scrap rate by shift, line and week.", "Бракованные штуки и доля брака по сменам, линиям и неделям."),
        (
            Role("output", "table", ("Which table holds the scrapped (and good) pieces?", "В какой таблице брак (и годные штуки)?"),
                 ("the output table", "таблица выпуска"), words=_OUTPUT_TABLE_WORDS + ("scrap", "брак"),
                 help=("Usually the output reports: one row per report with good and scrapped pieces.",
                       "Обычно отчёты о выпуске: одна строка на отчёт с годными и бракованными штуками.")),
            Role("scrap", "number", ("Which column is the number of scrapped pieces?", "В каком столбце число бракованных штук?"),
                 ("scrapped pieces", "бракованные штуки"), table="output", words=_SCRAP_WORDS, semantic=("quantity",), own=True),
            Role("good", "number", ("Which column is the number of good pieces?", "В каком столбце число годных штук?"),
                 ("good pieces (for the scrap rate)", "годные штуки (для доли брака)"), table="output", words=_GOOD_WORDS,
                 semantic=("quantity",), own=True, required=False,
                 help=("Needed for the scrap rate (scrap ÷ all pieces).", "Нужно для доли брака (брак ÷ все штуки).")),
            _date_role("date", "output", ("Which column says when the pieces were reported?", "В каком столбце дата отчёта?")),
            Role("shift", "label", ("Which column says the shift?", "В каком столбце смена?"), ("a shift column", "столбец со сменой"),
                 table="output", words=_SHIFT_WORDS, semantic=("name", "category"), required=False),
            _line_role("output"),
        ),
        _build_scrap,
    ),
    Template(
        "output_vs_plan", ("Output vs plan", "Выпуск и план"),
        ("Good pieces against the planned quantity per day and week, as % of plan.",
         "Годные штуки против плана по дням и неделям, в % плана."),
        (
            Role("output", "table", ("Which table holds the good pieces made?", "В какой таблице сданные годные штуки?"),
                 ("the output table", "таблица выпуска"), words=_OUTPUT_TABLE_WORDS),
            Role("good", "number", ("Which column is the number of good pieces?", "В каком столбце число годных штук?"),
                 ("good pieces", "годные штуки"), table="output", words=_GOOD_WORDS, semantic=("quantity",), own=True),
            _date_role("date", "output", ("Which column says when the pieces were made?", "В каком столбце дата выпуска?")),
            _line_role("output"),
            Role("plan", "table", ("Which table holds the plan?", "В какой таблице план?"), ("the plan table", "таблица плана"),
                 words=("plan", "order", "schedule", "target", "план", "заказ", "задани"), prefer="output",
                 help=("It may be the same table as the output.", "Это может быть та же таблица, что и выпуск.")),
            Role("planned", "number", ("Which column is the planned quantity?", "В каком столбце плановое количество?"),
                 ("the planned quantity", "плановое количество"), table="plan",
                 words=("plan", "target", "order", "schedul", "план", "задан"), semantic=("quantity",), own=True),
            _date_role("plan_date", "plan", ("Which column says the day the plan is for?", "В каком столбце день, на который план?")),
            Role("plan_line", "label", ("Which column of the plan says the line?", "В каком столбце плана линия?"),
                 ("a line column in the plan", "столбец с линией в плане"), table="plan", words=_LINE_WORDS,
                 semantic=("name", "category"), required=False),
        ),
        _build_output,
    ),
    Template(
        "oee_overview", ("OEE overview", "Обзор OEE"),
        ("Availability, performance, quality and OEE per week and line - the parts your data supports.",
         "Доступность, производительность, качество и OEE по неделям и линиям - то, что позволяют ваши данные."),
        (
            Role("output", "table", ("Which table holds the good (and scrapped) pieces?", "В какой таблице годные (и бракованные) штуки?"),
                 ("the output table", "таблица выпуска"), words=_OUTPUT_TABLE_WORDS),
            Role("good", "number", ("Which column is the number of good pieces?", "В каком столбце число годных штук?"),
                 ("good pieces", "годные штуки"), table="output", words=_GOOD_WORDS, semantic=("quantity",), own=True),
            Role("scrap", "number", ("Which column is the number of scrapped pieces?", "В каком столбце число бракованных штук?"),
                 ("scrapped pieces (for quality)", "бракованные штуки (для качества)"), table="output", words=_SCRAP_WORDS,
                 semantic=("quantity",), own=True, required=False),
            _date_role("date", "output", ("Which column says when the pieces were made?", "В каком столбце дата выпуска?")),
            _line_role("output"),
            Role("rate", "number", ("Which column is the rated speed in pieces per hour?", "В каком столбце паспортная скорость, штук в час?"),
                 ("the rated speed in pieces per hour (for performance)", "паспортная скорость, штук в час (для производительности)"),
                 table="output", words=("rate", "speed", "per", "hour", "capacity", "скорост", "производительн", "час"),
                 semantic=("quantity",), required=False,
                 help=("Often a column of the lines (or machines) table.", "Часто это столбец таблицы линий (или станков).")),
            *_downtime_roles(False),
            _date_role("downtime_date", "events", ("Which column says when the stop started?", "В каком столбце начало простоя?")),
            _line_role("events"),
            Role("planned_minutes", "value", ("How many minutes is a line planned to work on a working day?",
                                              "Сколько минут линия должна работать в рабочий день?"),
                 ("the planned working time per day (for availability)", "плановое время работы в день (для доступности)"),
                 default=480, required=False,
                 help=("For example 480 for one 8-hour shift, 1440 for three shifts. Counted for each day a line reported output or downtime.",
                       "Например, 480 для одной 8-часовой смены, 1440 для трёх смен. Считается за каждый день, когда у линии был выпуск или простой.")),
        ),
        _build_oee,
    ),
]
BY_ID = {t.id: t for t in TEMPLATES}


@dataclass
class Plan:
    template: Template
    ctx: Ctx
    name: str
    description: str


def plan(template: Template, schema: Schema, mapping: dict[str, Any], language: str) -> Plan:
    """The questions and cards for a mapping. MappingError when a required part is missing or wrong."""
    ctx = Ctx(template, schema, mapping, language)
    lacking = ctx.unmapped_required()
    if lacking:
        raise MappingError(ctx.tr("Still to answer: ", "Осталось ответить: ") + "; ".join(lacking))
    template.build(ctx)
    return Plan(template, ctx, ctx.tr(*template.name), ctx.tr(*template.description))


def definition(p: Plan, ids: dict[str, int]) -> Definition:
    """The dashboard for the questions made (ids by question key)."""
    filters = p.ctx.filters
    used = {fid for d in p.ctx.questions.values() for fid in d.filters}
    filters = [f for f in filters if f["id"] in used]
    cards: list[dict[str, Any]] = []
    for card in sorted(p.ctx.cards, key=lambda c: (c.layout[1], c.layout[0])):
        x, y, w, h = card.layout
        item: dict[str, Any] = {"key": card.key, "kind": card.kind, "layout": {"x": x, "y": y, "w": w, "h": h}}
        if card.kind == "text":
            item["text"] = card.text
        else:
            draft = p.ctx.questions[card.question or ""]
            item["question_id"] = ids[draft.key]
            item["mappings"] = {fid: {"field": ref} for fid, ref in draft.filters.items() if any(f["id"] == fid for f in filters)}
            if card.title:
                item["title"] = card.title
            if card.viz:
                item["viz"] = card.viz
        cards.append(item)
    return Definition.model_validate({"filters": filters, "cards": cards})


def viz_state(viz: dict[str, Any] | None) -> dict[str, Any]:
    if viz is None or viz.get("type") == "table":
        return {"mode": "table", "spec": viz}
    return {"mode": "chart", "spec": viz}


def template_json(t: Template, language: str) -> dict[str, Any]:
    tr = (lambda p: p[1]) if language == "ru" else (lambda p: p[0])
    return {
        "id": t.id, "name": tr(t.name), "description": tr(t.description),
        "roles": [{
            "key": r.key, "kind": r.kind, "ask": tr(r.ask), "help": tr(r.help) if r.help else None, "table": r.table,
            "required": r.required, "default": r.default,
        } for r in t.roles],
    }


# ---------------------------------------------------------------- the API

class SuggestIn(BaseModel):
    connection: str = Field(min_length=1, max_length=64)
    mapping: dict[str, Any] = Field(default_factory=dict)
    language: str = Field(default="en", max_length=8)


class PreviewIn(SuggestIn):
    card: str | None = Field(default=None, max_length=40)
    wait_ms: int = Field(default=0, ge=0, le=10_000)


class CreateIn(SuggestIn):
    collection_id: int | None = None
    name: str | None = Field(default=None, max_length=200)


def register_template_routes(
    app: FastAPI, *, registry: Any, semantic: Any, queries: Any, content: Any,
    current_user: Callable[..., User], require_connection: Callable[[str, User], None],
) -> None:
    router = APIRouter(tags=["templates"])

    def template_of(tid: str) -> Template:
        t = BY_ID.get(tid)
        if t is None:
            raise HTTPException(status_code=404, detail="Unknown template")
        return t

    def schema_for(key: str, user: User) -> Schema:
        require_connection(key, user)
        try:
            columns = registry.get_schema(key)
            primary, foreign = registry.get_keys(key)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Unknown connection {key!r}") from None
        except Exception as exc:  # the database is not reachable
            detail = str(exc)
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {detail}") from exc
        manual = semantic.foreign_keys(key)
        if manual:
            foreign = {t: list(foreign.get(t, [])) + manual.get(t, []) for t in set(foreign) | set(manual)}
        return load_schema(key, columns, primary, foreign, semantic.fields(key), semantic.tables(key))

    def planned(user: User, tid: str, body: SuggestIn) -> tuple[Plan, Schema]:
        t = template_of(tid)
        schema = schema_for(body.connection, user)
        try:
            return plan(t, schema, body.mapping, body.language), schema
        except MappingError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from None

    def check(user: User, draft: Draft) -> dict[str, Any]:
        """The spec, compiled as it will run (unknown columns, wrong types ...): the clean spec."""
        try:
            if draft.kind == "builder":
                spec = QuerySpec.model_validate(draft.spec)
                queries.compile_for(spec, user=user)
                return spec.model_dump(mode="json", by_alias=True, exclude_unset=True)
            parsed, _defs = app.state.federation.check(user, draft.spec, [])
            return parsed.model_dump(mode="json", by_alias=True, exclude_unset=True)
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=f"{draft.name}: {exc.errors()[0]['msg']}") from None
        except ContentError as exc:
            raise HTTPException(status_code=400, detail=f"{draft.name}: {exc}") from None
        except HTTPException as exc:
            raise HTTPException(status_code=exc.status_code, detail=f"{draft.name}: {exc.detail}") from None

    def plan_json(p: Plan) -> dict[str, Any]:
        return {
            "name": p.name, "description": p.description,
            "questions": [{"key": d.key, "name": d.name, "description": d.description, "kind": d.kind} for d in p.ctx.questions.values()],
            "cards": [{"key": c.key, "kind": c.kind, "title": c.title or (p.ctx.questions[c.question].name if c.question else None)}
                      for c in p.ctx.cards if c.kind == "question"],
            "missing": p.ctx.missing,
        }

    @router.get("/api/templates")
    def list_templates(language: str = "en", _user: User = Depends(current_user)):
        return {"templates": [template_json(t, language) for t in TEMPLATES]}

    @router.post("/api/templates/{tid}/suggest")
    def suggest_mapping(tid: str, body: SuggestIn, user: User = Depends(current_user)):
        t = template_of(tid)
        schema = schema_for(body.connection, user)
        mapping, filled = suggest(t, schema, body.mapping)
        try:
            ctx = Ctx(t, schema, mapping, body.language)
            lacking, error = ctx.unmapped_required(), None
        except MappingError as exc:
            lacking, error = [], str(exc)
        return {"mapping": mapping, "suggested": filled, "options": options(t, schema, mapping, body.language),
                "lacking": lacking, "error": error, "complete": not lacking and error is None}

    @router.post("/api/templates/{tid}/preview")
    def preview(tid: str, body: PreviewIn, user: User = Depends(current_user)):
        """The plan and one card running: the person sees real numbers before anything is made."""
        p, _schema = planned(user, tid, body)
        cards = [c for c in p.ctx.cards if c.kind == "question"]
        card = next((c for c in cards if c.key == body.card), None) or next(
            (c for c in cards if c.viz is None and (p.ctx.questions[c.question or ""].viz or {}).get("type") not in ("kpi", "table")), cards[0])
        draft = p.ctx.questions[card.question or ""]
        spec = check(user, draft)
        viz = card.viz or viz_state(draft.viz)
        try:
            if draft.kind == "builder":
                task = queries.start_spec(user, QuerySpec.model_validate(spec), body.wait_ms, False)
            else:
                task = app.state.federation.start(user, spec, [], {}, [], body.wait_ms, False)
        except ContentError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from None
        return {**plan_json(p), "preview": {"card": card.key, "name": card.title or draft.name, "viz": viz, "task": task}}

    @router.post("/api/templates/{tid}/create")
    def create(tid: str, body: CreateIn, user: User = Depends(current_user)):
        p, _schema = planned(user, tid, body)
        store, dashboards = app.state.content.store, app.state.content.dashboards
        clean = {key: check(user, d) for key, d in p.ctx.questions.items()}  # all checked before anything is saved
        try:
            cid = body.collection_id if body.collection_id is not None else store.personal_collection(user).id
            ids: dict[str, int] = {}
            for key, d in p.ctx.questions.items():
                ids[key] = store.create_question(
                    user, name=d.name, description=d.description, collection_id=cid,
                    connection=body.connection if d.kind == "builder" else "", kind=d.kind, spec=clean[key], viz=viz_state(d.viz),
                ).id
            board = dashboards.create(user, name=(body.name or "").strip() or p.name, description=p.description,
                                      collection_id=cid, definition=definition(p, ids))
        except ContentError as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from None
        return {"dashboard": {"id": board.id, "name": board.name, "collection_id": board.collection_id},
                "questions": list(ids.values()), "missing": p.ctx.missing}

    app.include_router(router)
