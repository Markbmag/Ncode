"""Database access: one cached SQLAlchemy engine + schema cache per connection.

SQLAlchemy is what makes the service database-agnostic: the search code only
talks to the generic Engine / Inspector API. The few things that differ between
databases (driver, timeouts, read-only sessions) are isolated in this module.
"""

from __future__ import annotations

import logging
import sqlite3
import struct
import threading
import time
import warnings
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL, Engine, ObjectKind
from sqlalchemy.exc import SAWarning

from .config import ConnectionConfig, Settings
from .dberrors import describe_error  # noqa: F401  (kept importable from here)
from .serialize import infinite

logger = logging.getLogger(__name__)

# Reflection warns about exotic column types it can't map; we don't care.
warnings.filterwarnings("ignore", message="Did not recognize type", category=SAWarning)


@dataclass
class _SchemaEntry:
    loaded_at: float
    tables: dict[str, list[dict[str, Any]]]


@dataclass
class _KeysEntry:
    loaded_at: float
    primary_keys: dict[str, list[str]]
    foreign_keys: dict[str, list[dict[str, Any]]]


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


def _session_statements(cfg: ConnectionConfig, settings: Settings, dbapi_connection: Any) -> list[str]:
    statements: list[str] = []
    if cfg.engine in ("mysql", "mariadb"):
        # Ask the server what it is: a MariaDB server added as "MySQL" (or the other way
        # round) would otherwise get the wrong timeout setting, i.e. no timeout at all.
        try:
            server = str(dbapi_connection.get_server_info() or "")
        except Exception:
            server = ""
        mariadb = "mariadb" in server.lower() if server else cfg.is_mariadb
        timeout = settings.statement_timeout_sec
        if mariadb:
            statements.append(f"SET SESSION max_statement_time = {timeout}")
        else:
            statements.append(f"SET SESSION max_execution_time = {timeout * 1000}")
        if settings.read_only_sessions:
            statements.append("SET SESSION TRANSACTION READ ONLY")
        # The SQL guard treats a backslash before a quote as an escape, as MySQL does by
        # default; make sure the server agrees, or a crafted string could hide SQL from it.
        statements.append("SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'NO_BACKSLASH_ESCAPES', '')")
    elif cfg.engine == "sqlite" and settings.read_only_sessions:
        statements.append("PRAGMA query_only = ON")
    return statements


# SQLite runs inside the backend process: one value (randomblob(1e9), printf('%.*c', ...),
# replace() growing a string) must not be able to take all of its memory.
SQLITE_MAX_VALUE_BYTES = 100 * 1024 * 1024


def _unicode_case(convert):
    """SQLite's own lower()/upper() only know ASCII: 'Иван' would never match 'иван'."""

    def fn(value: Any) -> Any:
        if value is None or isinstance(value, str):
            return value if value is None else convert(value)
        if isinstance(value, bytes):
            try:
                return convert(value.decode("utf-8"))
            except UnicodeDecodeError:
                return value
        return convert(str(value))

    return fn


def _setup_sqlite(dbapi_connection: Any) -> None:
    """Unicode lower()/upper() (ILIKE compiles to lower(x) LIKE lower(y), so search, builder
    filters and Browse use them too) and a cap on the size of one value."""
    for name, convert in (("lower", str.lower), ("upper", str.upper)):
        dbapi_connection.create_function(name, 1, _unicode_case(convert), deterministic=True)
    if hasattr(dbapi_connection, "setlimit"):  # Python 3.11+
        dbapi_connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, SQLITE_MAX_VALUE_BYTES)


def _setup_postgresql(dbapi_connection: Any) -> None:
    """Read 'infinity' / '-infinity' timestamps and dates instead of failing the whole query."""
    adapters = getattr(dbapi_connection, "adapters", None)  # psycopg 3 only
    if adapters is None:
        return
    from psycopg import DataError
    from psycopg.types import datetime as pgdt

    def tolerant(base: type, kind: type, binary_bound: bytes | None, fmt: str) -> type:
        def load(self, data):
            try:
                return base.load(self, data)
            except DataError:
                raw = bytes(data)
                if raw in (b"infinity", b"-infinity"):
                    return infinite(kind, -1 if raw.startswith(b"-") else 1)
                if binary_bound is not None and len(raw) == struct.calcsize(fmt):
                    number = struct.unpack(fmt, raw)[0]
                    top = struct.unpack(fmt, binary_bound)[0]
                    if number in (top, -top - 1):
                        return infinite(kind, 1 if number == top else -1)
                raise

        return type(f"Ncode{base.__name__}", (base,), {"load": load})

    i64, i32 = b"\x7f" + b"\xff" * 7, b"\x7f" + b"\xff" * 3
    for oid_name, text_loader, binary_loader, kind, bound, fmt in (
        ("timestamp", pgdt.TimestampLoader, pgdt.TimestampBinaryLoader, datetime, i64, ">q"),
        ("timestamptz", pgdt.TimestamptzLoader, pgdt.TimestamptzBinaryLoader, datetime, i64, ">q"),
        ("date", pgdt.DateLoader, pgdt.DateBinaryLoader, date, i32, ">i"),
    ):
        adapters.register_loader(oid_name, tolerant(text_loader, kind, None, fmt))
        adapters.register_loader(oid_name, tolerant(binary_loader, kind, bound, fmt))


def _install_session_guards(engine: Engine, cfg: ConnectionConfig, settings: Settings) -> None:
    """Best-effort extras that can only be set after connecting."""
    if cfg.engine not in ("mysql", "mariadb", "sqlite", "postgresql", "postgres"):
        return

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        if cfg.engine == "sqlite":
            _setup_sqlite(dbapi_connection)
        elif cfg.engine in ("postgresql", "postgres"):
            try:
                _setup_postgresql(dbapi_connection)
            except Exception as exc:  # another driver or psycopg version: values may still fail, queries work
                logger.warning("[%s] infinity date loaders not installed: %s", cfg.key, exc)
            return
        cursor = dbapi_connection.cursor()
        try:
            for statement in _session_statements(cfg, settings, dbapi_connection):
                try:
                    cursor.execute(statement)
                except Exception as exc:  # old server versions may not support it
                    logger.warning("[%s] session setup %r failed: %s", cfg.key, statement, exc)
        finally:
            cursor.close()


def default_pool_size(settings: Settings) -> int:
    """Queries, search, combine and Browse share one pool per connection."""
    return settings.db_pool_size or max(settings.search_workers, settings.query_workers)


def build_engine(cfg: ConnectionConfig, settings: Settings, pool_size: int | None = None) -> Engine:
    engine = create_engine(
        _build_url(cfg),
        connect_args=_connect_args(cfg, settings),
        pool_size=pool_size or default_pool_size(settings),
        max_overflow=0 if pool_size else settings.db_pool_overflow,
        pool_pre_ping=True,
        pool_recycle=1800,
    )
    _install_session_guards(engine, cfg, settings)
    return engine


def probe(cfg: ConnectionConfig, settings: Settings) -> int:
    """Connect with a throw-away engine and return the number of tables. Raises on failure."""
    engine = build_engine(cfg, settings, pool_size=1)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            return len(inspect(conn).get_table_names(schema=cfg.schema))
    finally:
        engine.dispose()


class ConnectionRegistry:
    """Holds the known connections, lazily creates one Engine per connection and caches schemas.

    Connections can be added, replaced and removed at runtime (UI-managed databases).
    """

    def __init__(self, configs: dict[str, ConnectionConfig], settings: Settings):
        self._configs: dict[str, ConnectionConfig] = dict(configs)
        self.settings = settings
        self._engines: dict[str, Engine] = {}
        self._schemas: dict[tuple[str, str | None], _SchemaEntry] = {}
        self._keys: dict[tuple[str, str | None], _KeysEntry] = {}
        self._lock = threading.Lock()

    # -- configs -----------------------------------------------------------
    @property
    def configs(self) -> dict[str, ConnectionConfig]:
        """A snapshot copy (safe to iterate while connections are being edited)."""
        with self._lock:
            return dict(self._configs)

    def get_config(self, key: str) -> ConnectionConfig:
        with self._lock:
            try:
                return self._configs[key]
            except KeyError:
                raise KeyError(f"Unknown connection {key!r}") from None

    def set_config(self, cfg: ConnectionConfig) -> None:
        """Add or replace a connection; any open pool and cached schema for it is dropped."""
        with self._lock:
            self._drop_locked(cfg.key)
            self._configs[cfg.key] = cfg

    def remove(self, key: str) -> None:
        with self._lock:
            self._drop_locked(key)
            self._configs.pop(key, None)

    def _drop_locked(self, key: str) -> None:
        engine = self._engines.pop(key, None)
        if engine is not None:
            engine.dispose()
        for cache in (self._schemas, self._keys):
            for cache_key in [k for k in cache if k[0] == key]:
                del cache[cache_key]

    # -- engines -----------------------------------------------------------
    def get_engine(self, key: str) -> Engine:
        cfg = self.get_config(key)
        with self._lock:
            engine = self._engines.get(key)
            if engine is None:
                engine = build_engine(cfg, self.settings)
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
            self._keys.clear()

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

    def get_keys(
        self, key: str, schema: str | None = None, refresh: bool = False
    ) -> tuple[dict[str, list[str]], dict[str, list[dict[str, Any]]]]:
        """(primary keys, foreign keys) per base table, cached like get_schema.

        Kept apart from get_schema so that search, which needs only columns, does
        not pay for reflecting constraints. A database account that may not read
        constraint metadata gets empty keys instead of an error.
        """
        cfg = self.get_config(key)
        schema = schema or cfg.schema
        cache_key = (key, schema)
        ttl = self.settings.schema_cache_ttl_sec

        with self._lock:
            entry = self._keys.get(cache_key)
        if entry and not refresh and ttl > 0 and (time.time() - entry.loaded_at) < ttl:
            return entry.primary_keys, entry.foreign_keys

        primary: dict[str, list[str]] = {}
        foreign: dict[str, list[dict[str, Any]]] = {}
        with self.get_engine(key).connect() as conn:
            inspector = inspect(conn)
            try:
                pks = inspector.get_multi_pk_constraint(schema=schema, kind=ObjectKind.TABLE)
                primary = {t: list(pk.get("constrained_columns") or []) for (_s, t), pk in pks.items()}
            except Exception as exc:
                logger.warning("[%s] cannot read primary keys: %s", key, exc)
            try:
                fks = inspector.get_multi_foreign_keys(schema=schema, kind=ObjectKind.TABLE)
                foreign = {t: list(items) for (_s, t), items in fks.items()}
            except Exception as exc:
                logger.warning("[%s] cannot read foreign keys: %s", key, exc)

        with self._lock:
            self._keys[cache_key] = _KeysEntry(time.time(), primary, foreign)
        return primary, foreign
