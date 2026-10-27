"""Broken content (roadmap M10): saved things that point at something that is gone.

    GET  /api/admin/broken-content            the last report (made on first use)
    GET  /api/admin/broken-content?refresh=1  check again (reads each database structure anew)

What is checked, against the structure each database has now:
- builder questions: compiled like a run (tables, joins, fields, filters, breakouts, sort,
  custom columns, metrics); a CompileError about a table or column is the problem;
- SQL questions: the tables they read (parsed with sqlglot); only a table that certainly
  does not exist is reported (other schemas/databases, temp tables, functions are left alone);
- multi-source questions: every source (saved question, builder, SQL, uploaded file);
- dashboards: cards whose question was deleted or archived;
- subscriptions: a deleted question or dashboard;
- uploaded files whose data file is missing on disk.

Each database is read once per check, in parallel, within a time budget. A database that
cannot be reached (or is too slow) is reported as "couldn't check", never as broken.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import sqlglot
from fastapi import APIRouter, Depends, FastAPI, Query
from pydantic import ValidationError
from sqlalchemy import inspect as sa_inspect, select
from sqlglot import exp

from ..appdb import AppDB, User, users_table
from ..backup import datasets_dir as uploads_dir
from ..db import ConnectionRegistry, describe_error
from ..federation.spec import FederatedSpec
from ..query.compiler import CompileError, compile_spec
from ..query.spec import QuerySpec
from ..query.sqlguard import PARAM, SQLGLOT_DIALECT, _is_system
from ..schema_graph import relationships
from .params import ParameterDef, bind_spec, sample_values
from .store import ContentError
from .tables import (
    collections_table, dashboard_cards_table, dashboards_table, datasets_table, questions_table, subscriptions_table,
)

logger = logging.getLogger(__name__)

CONNECTION_BUDGET_SEC = 60.0   # per database: reading its structure and checking its questions

# CompileError messages that mean "the database changed" (the rest are reported as cannot_build)
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^Unknown table '(?P<table>.+)'$"), "missing_table"),
    (re.compile(r"^Unknown column '(?P<column>.+)'$"), "missing_column"),
    (re.compile(r"^Unknown join column in (?P<detail>.+)$"), "missing_join_column"),
    (re.compile(r"^No relationship \(foreign key\) connects '(?P<table>.+?)' "), "no_relationship"),
    (re.compile(r"^'(?P<column>.+)' exists in several tables"), "ambiguous_column"),
]
_SCHEMA_CODES = {"missing_table", "missing_column", "missing_join_column", "ambiguous_column"}

SENTENCES = {
    "missing_table": "The table {table} no longer exists in {connection}.",
    "missing_column": "The column {column} no longer exists.",
    "missing_join_column": "A join uses a column that no longer exists ({detail}).",
    "no_relationship": "The join to {table} relied on a relationship that no longer exists.",
    "ambiguous_column": "The column {column} now exists in several tables of the question.",
    "cannot_build": "The question cannot be built any more: {detail}",
    "missing_metric": "It uses a metric that was deleted.",
    "invalid_spec": "The saved question is not valid any more: {detail}",
    "missing_connection": "The database {connection} was removed.",
    "deleted_question": "It shows a question that was deleted.",
    "archived_question": "It shows the question {question}, which is in the archive.",
    "deleted_dashboard": "It sends a dashboard that was deleted.",
    "deleted_dataset": "It reads an uploaded file that was deleted.",
    "missing_file": "The uploaded file's data is missing on the server ({file}).",
}


@dataclass
class Problem:
    code: str
    params: dict[str, Any] = field(default_factory=dict)

    @property
    def sentence(self) -> str:
        return SENTENCES[self.code].format(**{k: v for k, v in self.params.items()})


def classify(exc: CompileError) -> Problem:
    message = str(exc)
    for pattern, code in _PATTERNS:
        m = pattern.match(message)
        if m:
            return Problem(code, m.groupdict())
    return Problem("cannot_build", {"detail": message})


# ---------------------------------------------------------------- one database's structure

@dataclass
class DbShape:
    key: str
    dialect: str
    db_schema: str | None
    default_schema: str | None
    columns: dict[str, list[dict[str, Any]]]
    foreign: dict[str, list[dict[str, Any]]]
    names: set[str]  # lower-case tables and views (SQL can read views too)
    fields: dict[str, Any] = field(default_factory=dict)


def read_shape(registry: ConnectionRegistry, key: str, *, refresh: bool, semantic: Any = None) -> DbShape:
    cfg = registry.get_config(key)
    columns = registry.get_schema(key, refresh=refresh)
    _primary, foreign = registry.get_keys(key, refresh=refresh)
    engine = registry.get_engine(key)
    names = {t.lower() for t in columns}
    default_schema = None
    with engine.connect() as conn:
        inspector = sa_inspect(conn)
        default_schema = inspector.default_schema_name
        for method in ("get_view_names", "get_materialized_view_names", "get_foreign_table_names"):
            fn = getattr(inspector, method, None)
            if fn is None:
                continue
            try:
                names.update(n.lower() for n in fn(schema=cfg.schema))
            except Exception:  # not every dialect has every kind
                pass
    fields: dict[str, Any] = {}
    if semantic is not None:
        fields = semantic.fields(key)
        manual = semantic.foreign_keys(key)
        if manual:
            foreign = {t: list(foreign.get(t, [])) + manual.get(t, []) for t in set(foreign) | set(manual)}
    return DbShape(key, engine.dialect.name, cfg.schema, default_schema, columns, foreign, names, fields)


def check_builder(spec: QuerySpec, defs: list[ParameterDef], shape: DbShape, semantic: Any = None) -> Problem | None:
    if semantic is not None:
        try:
            spec, _formats = semantic.expand_metrics(spec)
        except ContentError:
            return Problem("missing_metric")

    def attempt(values: dict[str, Any]) -> Problem | None:
        try:
            compile_spec(
                bind_spec(spec, values), dialect=shape.dialect, tables=shape.columns,
                relationships=relationships(shape.foreign, set(shape.columns)), db_schema=shape.db_schema,
                fields=shape.fields,
            )
        except CompileError as exc:
            return classify(exc)
        return None

    found = attempt({})  # conditions on parameters left out: no sample value can get in the way
    if found is not None:
        if found.code == "missing_table":
            found.params.setdefault("connection", shape.key)
        return found
    if defs:  # the columns of parameter conditions; only a missing column counts here
        found = attempt(sample_values(defs))
        if found is not None and found.code in _SCHEMA_CODES:
            found.params.setdefault("connection", shape.key)
            return found
    return None


def sql_tables(sql: str, dialect: str) -> list[tuple[str, str]] | None:
    """(schema, table) read by the SQL; None if it cannot be parsed (then nothing is reported)."""
    read = SQLGLOT_DIALECT.get(dialect)
    if read is None:
        return None
    try:
        statements = [s for s in sqlglot.parse(PARAM.sub("NULL", sql), read=read) if s is not None]
    except Exception:
        return None
    out: list[tuple[str, str]] = []
    for tree in statements:
        ctes = {c.alias_or_name.lower() for c in tree.find_all(exp.CTE)}
        for node in tree.find_all(exp.Table):
            if not isinstance(node.this, exp.Identifier) or not node.name:
                continue  # a table function (generate_series(), OPENJSON() ...)
            name = node.name
            if node.catalog or (not node.db and name.lower() in ctes) or node.this.args.get("temporary") or name.startswith(("#", "@")) or _is_system(node):
                continue
            if (node.db, name) not in out:
                out.append((node.db, name))
    return out


def check_sql(sql: str, shape: DbShape) -> Problem | None:
    tables = sql_tables(sql, shape.dialect)
    for schema, name in tables or []:
        if schema and schema.lower() not in {s.lower() for s in (shape.db_schema, shape.default_schema) if s}:
            continue  # another schema: its tables were not read
        if name.lower() not in shape.names:
            label = f"{schema}.{name}" if schema else name
            return Problem("missing_table", {"table": label, "connection": shape.key})
    return None


# ---------------------------------------------------------------- the whole check

@dataclass
class Report:
    checked_at: float
    duration_sec: float
    items: list[dict[str, Any]]
    unchecked: list[dict[str, Any]]
    counts: dict[str, int]

    def json(self) -> dict[str, Any]:
        return {"checked_at": self.checked_at, "duration_sec": round(self.duration_sec, 2), "items": self.items,
                "unchecked": self.unchecked, "counts": self.counts}


def _loads(raw: Any, default: Any) -> Any:
    try:
        return json.loads(raw) if raw else default
    except ValueError:
        return default


class ContentHealth:
    def __init__(self, app_db: AppDB, registry: ConnectionRegistry, *, semantic: Any = None,
                 datasets_dir: Path | None = None, budget_sec: float = CONNECTION_BUDGET_SEC):
        self.app_db = app_db
        self.registry = registry
        self.semantic = semantic
        self.datasets_dir = datasets_dir if datasets_dir is not None else uploads_dir(Path(app_db.path))
        self.budget_sec = budget_sec
        self._lock = threading.Lock()
        self.last: Report | None = None
        self._runs = 0

    def report(self, refresh: bool = False) -> Report:
        asked = self._runs
        with self._lock:  # one check at a time; whoever waited for one gets its fresh report
            if self.last is not None and (not refresh or self._runs != asked):
                return self.last
            self.last = self._check(refresh)
            self._runs += 1
            return self.last

    # -------------------------------------------------------------- reading the library
    def _load(self) -> dict[str, Any]:
        with self.app_db.engine.connect() as conn:
            return {
                "users": {r.id: r.username for r in conn.execute(select(users_table.c.id, users_table.c.username))},
                "collections": {r.id: r.name for r in conn.execute(select(collections_table.c.id, collections_table.c.name))},
                "questions": conn.execute(select(questions_table)).all(),
                "dashboards": conn.execute(select(dashboards_table)).all(),
                "cards": conn.execute(select(dashboard_cards_table).where(dashboard_cards_table.c.kind == "question")
                                      .order_by(dashboard_cards_table.c.position)).all(),
                "subscriptions": conn.execute(select(subscriptions_table)).all(),
                "datasets": conn.execute(select(datasets_table)).all(),
            }

    def _check(self, refresh: bool) -> Report:
        started = time.time()
        data = self._load()
        questions = {q.id: q for q in data["questions"]}
        live_questions = [q for q in data["questions"] if not q.archived]
        datasets = {d.id: d for d in data["datasets"]}
        items: list[dict[str, Any]] = []

        def item(kind: str, row: Any, problem: Problem, link: str, connection: str | None = None, **extra: Any) -> None:
            collection_id = getattr(row, "collection_id", None)
            items.append({
                "kind": kind, "id": row.id, "name": row.name,
                "owner": data["users"].get(row.owner_id) if row.owner_id is not None else None,
                "collection": {"id": collection_id, "name": data["collections"].get(collection_id)} if collection_id else None,
                "problem": problem.sentence, "code": problem.code, "params": problem.params,
                "link": link, "connection": connection, **extra,
            })

        # which databases each question needs (multi-source: every builder / SQL source)
        needs: dict[str, list[Any]] = {}
        parsed_fed: dict[int, FederatedSpec] = {}
        for q in live_questions:
            if q.kind == "federated":
                try:
                    fed = FederatedSpec.model_validate(_loads(q.spec, {}))
                except ValidationError as exc:
                    item("question", q, Problem("invalid_spec", {"detail": exc.errors()[0]["msg"]}), f"/questions/{q.id}")
                    continue
                parsed_fed[q.id] = fed
                for s in fed.sources:
                    key = s.spec.connection if s.type == "builder" and s.spec else s.connection if s.type == "sql" else None
                    if key:
                        needs.setdefault(key, []).append(q)
            elif q.connection:
                needs.setdefault(q.connection, []).append(q)

        known = self.registry.configs
        shapes: dict[str, DbShape] = {}
        unchecked: list[dict[str, Any]] = []
        wanted = sorted(k for k in needs if k in known)
        if wanted:
            pool = ThreadPoolExecutor(max_workers=min(4, len(wanted)), thread_name_prefix="ncode-health")
            futures = {k: pool.submit(read_shape, self.registry, k, refresh=refresh, semantic=self.semantic) for k in wanted}
            deadline = time.time() + self.budget_sec
            for key, fut in futures.items():
                try:
                    shapes[key] = fut.result(timeout=max(0.1, deadline - time.time()))
                except FutureTimeout:
                    unchecked.append({"connection": key, "label": known[key].label, "questions": len(needs[key]),
                                      "reason": f"Reading the database structure took longer than {int(self.budget_sec)} seconds."})
                except Exception as exc:
                    unchecked.append({"connection": key, "label": known[key].label, "questions": len(needs[key]),
                                      "reason": describe_error(exc, known[key].engine)})
            pool.shutdown(wait=False, cancel_futures=True)  # a hung database must not hold the answer

        def against(key: str) -> DbShape | Problem | None:
            """The structure to check with, a missing-connection problem, or None (couldn't check)."""
            if key not in known:
                return Problem("missing_connection", {"connection": key})
            return shapes.get(key)

        def check_one(kind: str, connection: str, spec: Any, defs: list[ParameterDef]) -> Problem | None:
            target = against(connection)
            if not isinstance(target, DbShape):
                return target
            if kind == "builder":
                try:
                    parsed = QuerySpec.model_validate(spec)
                except ValidationError as exc:
                    return Problem("invalid_spec", {"detail": exc.errors()[0]["msg"]})
                return check_builder(parsed, defs, target, self.semantic)
            return check_sql(str(spec.get("sql") or ""), target)

        for q in live_questions:
            link = f"/questions/{q.id}"
            defs = []
            try:
                defs = [ParameterDef(**p) for p in _loads(q.parameters, [])]
            except (TypeError, ValidationError):
                pass
            problem: Problem | None = None
            if q.kind in ("builder", "sql"):
                problem = check_one(q.kind, q.connection, _loads(q.spec, {}), defs)
            elif q.id in parsed_fed:
                for s in parsed_fed[q.id].sources:
                    if s.type == "question":
                        src = questions.get(s.question_id or 0)
                        if src is None:
                            problem = Problem("deleted_question")
                        elif src.archived:
                            problem = Problem("archived_question", {"question": src.name})
                    elif s.type == "dataset":
                        d = datasets.get(s.dataset_id or 0)
                        if d is None:
                            problem = Problem("deleted_dataset")
                        elif not (self.datasets_dir / d.file).is_file():
                            problem = Problem("missing_file", {"file": d.name})
                    elif s.type == "builder" and s.spec is not None:
                        problem = check_one("builder", s.spec.connection, s.spec.model_dump(mode="json", by_alias=True, exclude_unset=True), defs)
                    elif s.type == "sql":
                        problem = check_one("sql", s.connection or "", {"sql": s.sql}, defs)
                    if problem is not None:
                        problem.params.setdefault("source", s.label or s.alias)
                        break
            if problem is not None:
                item("question", q, problem, link, q.connection or None, question_kind=q.kind)

        dashboards = {d.id: d for d in data["dashboards"]}
        reported: set[int] = set()
        for c in data["cards"]:
            d = dashboards.get(c.dashboard_id)
            if d is None or d.archived or d.id in reported:
                continue
            src = questions.get(c.question_id) if c.question_id is not None else None
            if src is None:
                problem = Problem("deleted_question")
            elif src.archived:
                problem = Problem("archived_question", {"question": src.name})
            else:
                continue
            reported.add(d.id)  # one line per dashboard is enough
            if c.title:
                problem.params["card"] = c.title
            item("dashboard", d, problem, f"/dashboards/{d.id}")

        for s in data["subscriptions"]:
            if s.target_type == "question" and s.target_id not in questions:
                problem = Problem("deleted_question")
            elif s.target_type == "dashboard" and s.target_id not in dashboards:
                problem = Problem("deleted_dashboard")
            else:
                continue
            item("subscription", s, problem, "/subscriptions", enabled=bool(s.enabled))

        for d in data["datasets"]:
            if not d.archived and not (self.datasets_dir / d.file).is_file():
                item("dataset", d, Problem("missing_file", {"file": d.name}), "/datasets")

        counts = {"questions": len(live_questions), "dashboards": sum(1 for d in dashboards.values() if not d.archived),
                  "subscriptions": len(data["subscriptions"]), "datasets": sum(1 for d in data["datasets"] if not d.archived)}
        return Report(time.time(), time.time() - started, items, unchecked, counts)


def register_broken_content_routes(
    app: FastAPI, *, app_db: AppDB, registry: ConnectionRegistry, semantic: Any, require_admin: Callable[..., User],
) -> ContentHealth:
    health = ContentHealth(app_db, registry, semantic=semantic)
    router = APIRouter(tags=["admin"])

    @router.get("/api/admin/broken-content")
    def broken_content(refresh: bool = Query(False), _admin: User = Depends(require_admin)):
        return health.report(refresh=refresh).json()

    app.include_router(router)
    return health
