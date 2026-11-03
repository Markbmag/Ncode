"""Value lists for pickers (M12): the values of a column to choose from in filters.

    GET /api/connections/{key}/values?table=&column=&q=&limit=200
        -> {"values": [{"value": 3, "label": "Paint line", "count": 375}, ...],
            "label": {"table": "production_lines", "key": "id", "label": "name"} | null,
            "truncated": false, "cached": false}

The list is a small question built without SQL - group by the column, count the rows, the most
frequent first - compiled like any other (app/query/routes.compile_for), so permissions and
row-level security apply exactly as to the person's own questions. When the column refers to
another table that has a label column (the data model's "Show values as", else an obvious one
such as name / title / code, app/semantic/labels.py), each value carries its label and `q`
also searches the labels. Empty values (NULL) are left out: "is one of" cannot pick them.

Lists are cached briefly (per SQL statement, so per set of row rules); the first, unsearched
read of a list is audited like opening a table in Browse.
"""

from __future__ import annotations

import threading
from typing import Any, Callable

from fastapi import Depends, FastAPI, HTTPException, Query

from ..appdb import AppDB, User
from ..config import Settings
from ..db import ConnectionRegistry
from ..dberrors import db_http_error
from ..schema_graph import normalize_type
from ..semantic.labels import LabelLink, label_link
from ..serialize import serialize_value
from .compiler import fingerprint
from .routes import QueryService
from .runner import QueryTask, ResultCache, fetch_statement
from .spec import QuerySpec

DEFAULT_VALUES = 200
MAX_VALUES = 1000
LISTABLE = ("string", "number", "boolean", "unknown")
LABEL_ALIAS = "ncode_values_label"  # the related table, joined for the labels


def _number(text: str) -> float | None:
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def value_spec(connection: str, table: str, column: str, kind: str, link: LabelLink | None, q: str, limit: int) -> QuerySpec | None:
    """The question behind a value list; None when `q` cannot match anything (letters in a number column)."""
    ref = f"{table}.{column}"
    data: dict[str, Any] = {
        "connection": connection, "source": {"table": table},
        "breakouts": [{"ref": ref, "alias": "value"}],
        "aggregations": [{"fn": "count", "alias": "count"}],
        "order": [{"ref": "count", "dir": "desc"}, {"ref": "value"}],
        "limit": limit,
    }
    label_ref = f"{LABEL_ALIAS}.{link.label}" if link else None
    if link is not None:
        data["joins"] = [{"table": link.table, "alias": LABEL_ALIAS, "type": "left",
                          "on": [{"left": ref, "right": f"{LABEL_ALIAS}.{link.key}"}]}]
        data["breakouts"].append({"ref": label_ref, "alias": "label"})
    rules: list[dict[str, Any]] = [{"ref": ref, "op": "not_null"}]
    if q:
        search: list[dict[str, Any]] = []
        if kind in ("string", "unknown"):
            search.append({"ref": ref, "op": "contains", "value": q})
        elif kind == "number" and _number(q) is not None:
            search.append({"ref": ref, "op": "=", "value": q})
        if link is not None and link.label_type in ("string", "unknown"):
            search.append({"ref": label_ref, "op": "contains", "value": q})
        if not search:
            return None
        rules.append({"op": "or", "rules": search})
    data["filters"] = {"op": "and", "rules": rules}
    return QuerySpec.model_validate(data)


def register_value_routes(
    app: FastAPI,
    *,
    registry: ConnectionRegistry,
    settings: Settings,
    app_db: AppDB,
    queries: QueryService,
    semantic: Any,
    rowsec: Any,
    current_user: Callable[..., User],
    require_connection: Callable[[str, User], None],
) -> None:
    cache = ResultCache(min(settings.query_cache_ttl_sec, 300), max_entries=256)

    @app.get("/api/connections/{key}/values", tags=["query"])
    def column_values(
        key: str,
        table: str = Query(..., min_length=1, max_length=255),
        column: str = Query(..., min_length=1, max_length=255),
        q: str | None = Query(None, max_length=200),
        limit: int = Query(DEFAULT_VALUES, ge=1, le=MAX_VALUES),
        user: User = Depends(current_user),
    ):
        require_connection(key, user)
        try:
            schema = registry.get_schema(key)
            _primary, foreign = registry.get_keys(key)
        except Exception as exc:
            raise db_http_error(exc, registry.get_config(key).engine, "Could not read the database structure") from exc
        real = table if table in schema else next((t for t in schema if t.lower() == table.lower()), None)
        if real is None:
            raise HTTPException(status_code=404, detail=f"Unknown table {table!r}")
        col = next((c for c in schema[real] if c["name"] == column), None) or next(
            (c for c in schema[real] if c["name"].lower() == column.lower()), None)
        if col is None:
            raise HTTPException(status_code=404, detail=f"{table!r} has no column {column!r}")
        name = col["name"]
        fields = semantic.fields(key) if semantic is not None else {}
        kind = "datetime" if fields.get(real, {}).get(name, {}).get("parse_as_date") else normalize_type(col["type"])
        if kind not in LISTABLE:
            raise HTTPException(status_code=400, detail=f"Values are listed for text, number and yes/no columns; {name!r} is {kind}")

        manual = semantic.foreign_keys(key) if semantic is not None else {}
        link = label_link(real, name, columns=schema, foreign={real: list(foreign.get(real, [])) + manual.get(real, [])}, fields=fields)
        if link is not None and rowsec is not None and link.table.lower() in rowsec.for_user(user, key):
            link = None  # no names from rows the viewer may not see: the ids only
        text = (q or "").strip()
        spec = value_spec(key, real, name, kind, link, text, limit)
        if spec is None:
            return {"values": [], "label": link.json() if link else None, "truncated": False, "cached": False}

        engine, compiled, _sql = queries.compile_for(spec, user=user, default_limit=limit, max_limit=limit, labels=False)
        statement = compiled.limited(1)  # one more row tells the list was cut off
        cache_key = ResultCache.key("values", key, fingerprint(statement, engine.dialect))
        hit = cache.get(cache_key)
        if hit is not None:
            return {**hit, "cached": True}  # type: ignore[dict-item]

        task = QueryTask(owner=user.username, connection=key, kind="values")
        timer = threading.Timer(settings.statement_timeout_sec + 2, task.cancel, kwargs={"timed_out": True})
        timer.daemon = True
        timer.start()
        try:
            _names, rows, truncated = fetch_statement(engine, task, statement, compiled.limit)
        except Exception as exc:
            if task.timed_out:
                raise HTTPException(status_code=504, detail="Listing the values took too long; type a few letters to search instead") from exc
            raise db_http_error(exc, registry.get_config(key).engine, "Could not list the values") from exc
        finally:
            timer.cancel()
            task.finish("completed")
        out = {
            "values": [
                {"value": serialize_value(r[0]), **({"label": serialize_value(r[1])} if link else {}), "count": int(r[-1] or 0)}
                for r in rows
            ],
            "label": link.json() if link else None,
            "truncated": truncated,
        }
        cache.put(cache_key, out)  # type: ignore[arg-type]
        if not text:  # opening a list, not every letter typed
            app_db.audit(user.username, "values", connection=key, phrase=f"{real}.{name}"[:200], status="ok")
        return {**out, "cached": False}
