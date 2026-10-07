"""Ncode API.

    GET    /api/health
    GET    /api/connections
    POST   /api/connections/{key}/test
    GET    /api/connections/{key}/tables?refresh=false
    POST   /api/search                  -> {"task_id": ...}
    GET    /api/search/{task_id}        -> progress (+ results when finished)
    DELETE /api/search/{task_id}        -> cancel
    WS     /ws/{task_id}                -> live progress, final message has results
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import ConfigError, init_environment, load_connections, load_settings
from .db import ConnectionRegistry
from .models import ConnectionInfo, SearchRequest
from .search import SearchOptions, start_search_thread
from .tasks import TaskStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ncode")

init_environment()
settings = load_settings()
try:
    connections = load_connections()
except ConfigError as exc:  # fail fast with a readable message
    raise SystemExit(f"Configuration error: {exc}") from exc

if not connections:
    logger.warning(
        "No database connections configured. Copy backend/.env.example to backend/.env and fill it in."
    )

registry = ConnectionRegistry(connections, settings)
store = TaskStore(ttl_sec=settings.task_ttl_sec)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    registry.dispose_all()


app = FastAPI(title="Ncode", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


def _require_connection(key: str) -> None:
    if key not in registry.configs:
        raise HTTPException(status_code=404, detail=f"Unknown connection {key!r}")


@app.get("/api/health")
def health():
    return {"status": "ok", "connections": len(registry.configs)}


@app.get("/api/connections", response_model=list[ConnectionInfo])
def list_connections():
    # Host, user and password are intentionally never exposed.
    return [
        ConnectionInfo(
            key=c.key, label=c.label, engine=c.engine, database=c.database, id_hints=list(c.id_hints)
        )
        for c in registry.configs.values()
    ]


@app.post("/api/connections/{key}/test")
def test_connection(key: str):
    _require_connection(key)
    try:
        registry.test(key)
    except Exception as exc:
        message = str(getattr(exc, "orig", None) or exc).strip().splitlines()[0][:300]
        return {"ok": False, "error": message}
    return {"ok": True}


@app.get("/api/connections/{key}/tables")
def list_tables(key: str, refresh: bool = Query(False)):
    _require_connection(key)
    try:
        schema = registry.get_schema(key, refresh=refresh)
    except Exception as exc:
        message = str(getattr(exc, "orig", None) or exc).strip().splitlines()[0][:300]
        raise HTTPException(status_code=502, detail=f"Cannot read schema: {message}") from exc
    return {
        "tables": [
            {"name": name, "columns": [c["name"] for c in cols]} for name, cols in sorted(schema.items())
        ]
    }


@app.post("/api/search", status_code=202)
def start_search(payload: SearchRequest):
    _require_connection(payload.connection)
    row_limit = min(payload.row_limit or settings.default_row_limit, settings.max_row_limit)
    opts = SearchOptions(
        phrase=payload.phrase,
        match_mode=payload.match_mode,
        case_sensitive=payload.case_sensitive,
        include_numeric=payload.include_numeric,
        include_dates=payload.include_dates,
        row_limit=row_limit,
        include_tables=payload.include_tables,
        exclude_tables=payload.exclude_tables,
        schema=payload.schema_name,
        refresh_schema=payload.refresh_schema,
    )
    task = store.create(payload.connection, payload.phrase, settings.max_total_results)
    start_search_thread(task, registry, opts, settings)
    return {"task_id": task.id}


@app.get("/api/search/{task_id}")
def get_search(task_id: str, include_results: bool = Query(True)):
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown or expired task")
    return task.snapshot(include_results=include_results and task.is_final)


@app.delete("/api/search/{task_id}")
def cancel_search(task_id: str):
    task = store.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Unknown or expired task")
    task.cancel()
    return {"status": "cancelling"}


@app.websocket("/ws/{task_id}")
async def search_progress(websocket: WebSocket, task_id: str):
    await websocket.accept()
    try:
        last_sent = None
        while True:
            task = store.get(task_id)
            if task is None:
                await websocket.send_json({"status": "unknown"})
                break
            if task.is_final:
                # One final message that already contains everything.
                await websocket.send_json(task.snapshot(include_results=True))
                break
            progress = task.progress()
            if progress != last_sent:
                await websocket.send_json(progress)
                last_sent = progress
            await asyncio.sleep(0.3)
    except WebSocketDisconnect:
        # The browser went away: stop wasting DB resources on this search.
        task = store.get(task_id)
        if task is not None and not task.is_final:
            task.cancel()
    finally:
        try:
            await websocket.close()
        except RuntimeError:
            pass  # already closed


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
