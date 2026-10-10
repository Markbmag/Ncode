"""Query API (roadmap M1).

    POST   /api/query                 {"spec": QuerySpec, "wait_ms": 2000}   run a question built without SQL
    POST   /api/query/compile         {"spec": QuerySpec}                    the SQL it would run ("View SQL")
    POST   /api/query/sql             {"connection", "sql", "params", "limit", "wait_ms"}   SQL mode
    POST   /api/query/sql/check       {"connection", "sql"}                  guard verdict, {{params}}, tables
    GET    /api/query/tasks/{id}?wait_ms=0
    DELETE /api/query/tasks/{id}      cancel

A run answers with {"task_id", "status", "result", "error", "elapsed_ms"}. When the
query finishes within wait_ms the result (a result envelope) is right there;
otherwise poll the task. Problems with the question itself (unknown column, SQL
that is not read-only ...) are 400 errors with a readable `detail`.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from ..appdb import AppDB, User
from ..config import Settings
from ..db import ConnectionRegistry, describe_error
from ..schema_graph import relationships
from .compiler import CompileError, compile_spec, render_sql
from .runner import QueryRunner, QueryTask, ResultCache, run_sql, run_statement
from .spec import QuerySpec
from .sqlguard import GuardError, check_sql

MAX_WAIT_MS = 15_000
ParamValue = str | int | float | bool | None


class RunSpecRequest(BaseModel):
    spec: QuerySpec
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = Field(default=False, description="ignore cached results")


class CompileRequest(BaseModel):
    spec: QuerySpec


class RunSqlRequest(BaseModel):
    connection: str = Field(min_length=1, max_length=64)
    sql: str = Field(min_length=1, max_length=100_000)
    params: dict[str, ParamValue] = Field(default_factory=dict, max_length=100)
    limit: int | None = Field(default=None, ge=1)
    wait_ms: int = Field(default=2000, ge=0, le=MAX_WAIT_MS)
    refresh: bool = False


class CheckSqlRequest(BaseModel):
    connection: str = Field(min_length=1, max_length=64)
    sql: str = Field(min_length=1, max_length=100_000)


def register_query_routes(
    app: FastAPI,
    *,
    registry: ConnectionRegistry,
    settings: Settings,
    app_db: AppDB,
    runner: QueryRunner,
    current_user: Callable[..., User],
    require_connection: Callable[[str, User], None],
) -> None:
    router = APIRouter(prefix="/api/query", tags=["query"])

    def check_capacity(user: User) -> None:
        if runner.running_count(user.username) >= settings.max_concurrent_queries:
            raise HTTPException(
                status_code=429,
                detail=f"You already have {settings.max_concurrent_queries} queries running. "
                "Wait for one to finish or cancel it.",
            )

    def compile_for(spec: QuerySpec):
        key = spec.connection
        try:
            columns = registry.get_schema(key)
            _primary, foreign = registry.get_keys(key)
        except Exception as exc:
            detail = describe_error(exc, registry.get_config(key).engine)
            raise HTTPException(status_code=502, detail=f"Could not read the database structure: {detail}") from exc
        engine = registry.get_engine(key)
        try:
            compiled = compile_spec(
                spec,
                dialect=engine.dialect,
                tables=columns,
                relationships=relationships(foreign, set(columns)),
                db_schema=registry.get_config(key).schema,
                default_limit=settings.query_default_rows,
                max_limit=settings.query_max_rows,
            )
        except CompileError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return engine, compiled, render_sql(compiled.limited(), engine.dialect)

    def audit_start(user: User, action: str, connection: str, sql: str, options: dict[str, Any]) -> int:
        return app_db.audit(
            user.username, action, connection=connection, phrase=sql[:200],
            options=json.dumps(options, default=str)[:20_000], status="running",
        )

    def audit_finish(audit_id: int) -> Callable[[QueryTask], None]:
        def finish(task: QueryTask) -> None:
            rows = task.result.stats.row_count if task.result is not None else 0
            app_db.audit_finish(
                audit_id, task.status, rows, 1 if task.status == "error" else 0,
                (task.finished_at or time.time()) - task.created_at,
            )

        return finish

    def respond(task: QueryTask, wait_ms: int) -> dict[str, Any]:
        if wait_ms and not task.is_final:
            task.done.wait(wait_ms / 1000)
        return task.snapshot()

    def task_for(task_id: str, user: User) -> QueryTask:
        task = runner.get(task_id)
        if task is None or not (user.is_admin or task.owner == user.username):
            raise HTTPException(status_code=404, detail="Unknown or expired query")
        return task

    # ------------------------------------------------------------------ builder questions
    @router.post("")
    def run_question(body: RunSpecRequest, user: User = Depends(current_user)):
        spec = body.spec
        require_connection(spec.connection, user)
        check_capacity(user)
        engine, compiled, sql = compile_for(spec)
        statement = compiled.limited(1)  # one extra row tells us the result was cut off
        types = [c.type for c in compiled.columns]
        task = QueryTask(owner=user.username, connection=spec.connection, kind="builder")
        audit_id = audit_start(user, "query", spec.connection, sql, {"spec": spec.model_dump(mode="json", by_alias=True)})
        runner.submit(
            task,
            lambda t: run_statement(engine, t, statement, compiled.limit, types, sql),
            cache_key=ResultCache.key("builder", spec.model_dump(mode="json"), compiled.limit),
            read_cache=not body.refresh,
            on_finish=audit_finish(audit_id),
        )
        return respond(task, body.wait_ms)

    @router.post("/compile")
    def compile_question(body: CompileRequest, user: User = Depends(current_user)):
        require_connection(body.spec.connection, user)
        _engine, compiled, sql = compile_for(body.spec)
        return {
            "sql": sql,
            "columns": [{"name": c.name, "type": c.type} for c in compiled.columns],
            "limit": compiled.limit,
        }

    # ------------------------------------------------------------------ SQL mode
    def guard(connection: str, sql: str, user: User):
        engine = registry.get_engine(connection)
        try:
            return engine, check_sql(sql, engine.dialect.name, allow_system=user.is_admin)
        except GuardError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/sql/check")
    def check(body: CheckSqlRequest, user: User = Depends(current_user)):
        require_connection(body.connection, user)
        try:
            _engine, checked = guard(body.connection, body.sql, user)
        except HTTPException as exc:
            return {"ok": False, "error": exc.detail, "params": [], "tables": []}
        return {"ok": True, "error": None, "params": checked.params, "tables": checked.tables}

    @router.post("/sql")
    def run_sql_query(body: RunSqlRequest, user: User = Depends(current_user)):
        require_connection(body.connection, user)
        check_capacity(user)
        engine, checked = guard(body.connection, body.sql, user)
        missing = [p for p in checked.params if p not in body.params]
        if missing:
            raise HTTPException(status_code=400, detail=f"Give a value for {', '.join('{{' + m + '}}' for m in missing)}")
        limit = min(body.limit or settings.query_default_rows, settings.query_max_rows)
        params = {k: v for k, v in body.params.items() if k in checked.params}
        task = QueryTask(owner=user.username, connection=body.connection, kind="sql")
        audit_id = audit_start(user, "sql", body.connection, body.sql, {"params": params, "limit": limit})
        runner.submit(
            task,
            lambda t: run_sql(engine, t, body.sql, params, limit),
            cache_key=ResultCache.key("sql", body.connection, body.sql, params, limit),
            read_cache=not body.refresh,
            on_finish=audit_finish(audit_id),
        )
        return respond(task, body.wait_ms)

    # ------------------------------------------------------------------ tasks
    @router.get("/tasks/{task_id}")
    def get_task(task_id: str, wait_ms: int = Query(0, ge=0, le=MAX_WAIT_MS), user: User = Depends(current_user)):
        return respond(task_for(task_id, user), wait_ms)

    @router.delete("/tasks/{task_id}")
    def cancel_task(task_id: str, user: User = Depends(current_user)):
        task = task_for(task_id, user)
        task.cancel()
        return {"status": "cancelling" if not task.is_final else task.status}

    app.include_router(router)
