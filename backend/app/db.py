"""Database access: one cached SQLAlchemy engine + schema cache per connection.

SQLAlchemy is what makes the service database-agnostic: the search code only
talks to the generic Engine / Inspector API. The few things that differ between
databases (driver, timeouts, read-only sessions) are isolated in this module.
"""

from __future__ import annotations

import logging
import threading
import time
import warnings
from dataclasses import dataclass
from typing import Any

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL, Engine, ObjectKind
from sqlalchemy.exc import SAWarning

from .config import ConnectionConfig, Settings

logger = logging.getLogger(__name__)

# Reflection warns about exotic column types it can't map; we don't care.
warnings.filterwarnings("ignore", message="Did not recognize type", category=SAWarning)


@dataclass
class _SchemaEntry:
    loaded_at: float
    tables: dict[str, list[dict[str, Any]]]


def _build_url(cfg: ConnectionConfig) -> URL:
    if cfg.engine == "sqlite":
        return URL.create("sqlite", database=cfg.database)
    return URL.create(
        cfg.driver,
        username=cfg.user,
        password=cfg.password,  # URL.create handles special characters safely
        host=cfg.host,
        port=cfg.port,
        database=cfg.database,
    )


def _connect_args(cfg: ConnectionConfig, settings: Settings) -> dict[str, Any]:
    """Driver-level connect options: connect timeout, hard query timeout, read-only."""
    timeout = settings.statement_timeout_sec
    if cfg.engine in ("mysql", "mariadb"):
        # read_timeout is a hard client-side limit and works on MySQL and MariaDB.
        return {"connect_timeout": 10, "read_timeout": timeout}
    if cfg.engine in ("postgresql", "postgres"):
        options = f"-c statement_timeout={timeout * 1000}"
        if settings.read_only_sessions:
            options += " -c default_transaction_read_only=on"
        return {"connect_timeout": 10, "options": options}
    if cfg.engine == "mssql":
        return {"login_timeout": 10, "timeout": timeout}
    if cfg.engine == "sqlite":
        return {"timeout": 10}
    return {}


def _install_session_guards(engine: Engine, cfg: ConnectionConfig, settings: Settings) -> None:
    """Best-effort extras that can only be set with SQL after connecting."""
    statements: list[str] = []
    if cfg.engine in ("mysql", "mariadb"):
        timeout = settings.statement_timeout_sec
        if cfg.is_mariadb:
            statements.append(f"SET SESSION max_statement_time = {timeout}")
        else:
            statements.append(f"SET SESSION max_execution_time = {timeout * 1000}")
        if settings.read_only_sessions:
            statements.append("SET SESSION TRANSACTION READ ONLY")
    elif cfg.engine == "sqlite" and settings.read_only_sessions:
        statements.append("PRAGMA query_only = ON")

    if not statements:
        return

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):  # pragma: no cover - needs a live DB
        cursor = dbapi_connection.cursor()
        try:
            for statement in statements:
                try:
                    cursor.execute(statement)
                except Exception as exc:  # old server versions may not support it
                    logger.warning("[%s] session setup %r failed: %s", cfg.key, statement, exc)
        finally:
            cursor.close()


class ConnectionRegistry:
    """Lazily creates one Engine per configured connection and caches schemas."""

    def __init__(self, configs: dict[str, ConnectionConfig], settings: Settings):
        self.configs = configs
        self.settings = settings
        self._engines: dict[str, Engine] = {}
        self._schemas: dict[tuple[str, str | None], _SchemaEntry] = {}
        self._lock = threading.Lock()

    # -- engines -----------------------------------------------------------
    def get_config(self, key: str) -> ConnectionConfig:
        try:
            return self.configs[key]
        except KeyError:
            raise KeyError(f"Unknown connection {key!r}") from None

    def get_engine(self, key: str) -> Engine:
        cfg = self.get_config(key)
        with self._lock:
            engine = self._engines.get(key)
            if engine is None:
                engine = create_engine(
                    _build_url(cfg),
                    connect_args=_connect_args(cfg, self.settings),
                    pool_size=self.settings.search_workers,
                    max_overflow=0,
                    pool_pre_ping=True,
                    pool_recycle=1800,
                )
                _install_session_guards(engine, cfg, self.settings)
                self._engines[key] = engine
            return engine

    def test(self, key: str) -> None:
        """Raise if the database can't be reached."""
        with self.get_engine(key).connect() as conn:
            conn.execute(text("SELECT 1"))

    def dispose_all(self) -> None:
        with self._lock:
            for engine in self._engines.values():
                engine.dispose()
            self._engines.clear()
            self._schemas.clear()

    # -- schema ------------------------------------------------------------
    def get_schema(
        self, key: str, schema: str | None = None, refresh: bool = False
    ) -> dict[str, list[dict[str, Any]]]:
        """Return {table_name: [column dicts]} for base tables, cached for a while."""
        cfg = self.get_config(key)
        schema = schema or cfg.schema
        cache_key = (key, schema)
        ttl = self.settings.schema_cache_ttl_sec

        with self._lock:
            entry = self._schemas.get(cache_key)
        if entry and not refresh and ttl > 0 and (time.time() - entry.loaded_at) < ttl:
            return entry.tables

        engine = self.get_engine(key)
        with engine.connect() as conn:
            inspector = inspect(conn)
            multi = inspector.get_multi_columns(schema=schema, kind=ObjectKind.TABLE)
        tables = {table_name: cols for (_schema, table_name), cols in multi.items()}

        with self._lock:
            self._schemas[cache_key] = _SchemaEntry(time.time(), tables)
        return tables
