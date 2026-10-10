"""Ncode's own small database (SQLite): users, login sessions and the audit log.

This is NOT one of the databases you search; it only stores who may use Ncode
and who searched for what.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from sqlalchemy import (
    Boolean, Column, Float, Integer, MetaData, String, Table, Text,
    create_engine, delete, func, insert, select, update,
)
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError

from .config import ConnectionConfig
from .crypto import Cipher, CipherError
from .migrate import upgrade

logger = logging.getLogger(__name__)

# Mirrors the latest migration (app/migrations/versions); the queries below use it.
# Schema changes go into a new migration first, then here.
metadata = MetaData()

users_table = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("username", String(64), unique=True, nullable=False),
    Column("password_hash", String(255), nullable=False),
    Column("role", String(16), nullable=False, default="user"),          # "admin" | "user"
    Column("is_active", Boolean, nullable=False, default=True),
    Column("allowed_connections", String(500), nullable=False, default="*"),  # "*" or "mes,les"
    Column("created_at", Float, nullable=False),
)

sessions_table = Table(
    "sessions",
    metadata,
    Column("token_hash", String(64), primary_key=True),
    Column("user_id", Integer, nullable=False, index=True),
    Column("created_at", Float, nullable=False),
    Column("expires_at", Float, nullable=False, index=True),
)

connections_table = Table(
    "connections",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("slug", String(64), unique=True, nullable=False),   # the connection key used in the API
    Column("label", String(120), nullable=False),
    Column("engine", String(16), nullable=False),
    Column("host", String(255)),
    Column("port", Integer),
    Column("username", String(128)),
    Column("password_enc", Text),                              # Fernet token, never plain text
    Column("db_name", String(500), nullable=False),
    Column("db_schema", String(128)),
    Column("id_hints", String(500), nullable=False, default=""),
    Column("created_by", String(64)),
    Column("created_at", Float, nullable=False),
    Column("updated_at", Float, nullable=False),
)

audit_table = Table(
    "audit_log",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("ts", Float, nullable=False, index=True),
    Column("username", String(64)),
    Column("action", String(32), nullable=False),        # login | login_failed | search
    Column("connection", String(64)),
    Column("phrase", String(200)),
    Column("options", Text),
    Column("status", String(16)),
    Column("found", Integer),
    Column("error_count", Integer),
    Column("duration_sec", Float),
)


@dataclass(frozen=True)
class User:
    id: int
    username: str
    role: str = "user"
    is_active: bool = True
    # None = every connection; otherwise only these connection keys
    allowed_connections: tuple[str, ...] | None = None
    password_hash: str = field(default="", repr=False)

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def can_use(self, connection_key: str) -> bool:
        return self.is_admin or self.allowed_connections is None or connection_key in self.allowed_connections


def resolve_app_db_path(configured: str) -> Path:
    """Where Ncode keeps its own users/audit database (default: backend/data/ncode.sqlite)."""
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parent.parent / "data" / "ncode.sqlite"


ANONYMOUS = User(id=0, username="anonymous", role="admin")  # used only when auth is disabled


def parse_allowed(raw: str) -> tuple[str, ...] | None:
    raw = (raw or "").strip()
    if raw == "*":
        return None
    return tuple(p.strip().lower() for p in raw.split(",") if p.strip())


def format_allowed(allowed: tuple[str, ...] | None) -> str:
    return "*" if allowed is None else ",".join(allowed)


def _to_user(row: Any) -> User:
    return User(
        id=row.id,
        username=row.username,
        role=row.role,
        is_active=bool(row.is_active),
        allowed_connections=parse_allowed(row.allowed_connections),
        password_hash=row.password_hash,
    )


class AppDB:
    def __init__(self, path: str | Path, cipher: Cipher | None = None):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.cipher = cipher
        self.engine = create_engine(
            URL.create("sqlite", database=str(path)), connect_args={"timeout": 15}
        )
        upgrade(self.engine)  # creates or migrates the tables (app/migrations)

    def dispose(self) -> None:
        self.engine.dispose()

    # -- users ---------------------------------------------------------------
    def user_count(self) -> int:
        with self.engine.connect() as conn:
            return conn.execute(select(func.count()).select_from(users_table)).scalar_one()

    def create_user(
        self, username: str, password_hash: str, role: str = "user", allowed: tuple[str, ...] | None = None
    ) -> User:
        try:
            with self.engine.begin() as conn:
                conn.execute(
                    insert(users_table).values(
                        username=username,
                        password_hash=password_hash,
                        role=role,
                        is_active=True,
                        allowed_connections=format_allowed(allowed),
                        created_at=time.time(),
                    )
                )
        except IntegrityError:
            raise ValueError(f"User {username!r} already exists") from None
        user = self.get_user_by_name(username)
        assert user is not None
        return user

    def get_user_by_name(self, username: str) -> User | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(users_table).where(users_table.c.username == username)).first()
        return _to_user(row) if row else None

    def list_users(self) -> list[User]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(users_table).order_by(users_table.c.username)).all()
        return [_to_user(r) for r in rows]

    def update_user(self, username: str, **values: Any) -> bool:
        """Update columns of a user. Returns False if the user doesn't exist."""
        with self.engine.begin() as conn:
            result = conn.execute(update(users_table).where(users_table.c.username == username).values(**values))
            if result.rowcount == 0:
                return False
            # Password change / disabling must kick the user out everywhere.
            if "password_hash" in values or values.get("is_active") is False:
                uid = conn.execute(select(users_table.c.id).where(users_table.c.username == username)).scalar_one()
                conn.execute(delete(sessions_table).where(sessions_table.c.user_id == uid))
        return True

    def delete_user(self, username: str) -> bool:
        with self.engine.begin() as conn:
            uid = conn.execute(select(users_table.c.id).where(users_table.c.username == username)).scalar()
            if uid is None:
                return False
            conn.execute(delete(sessions_table).where(sessions_table.c.user_id == uid))
            conn.execute(delete(users_table).where(users_table.c.id == uid))
        return True

    # -- sessions ------------------------------------------------------------
    def create_session(self, user_id: int, token_hash: str, ttl_sec: int) -> float:
        now = time.time()
        expires = now + ttl_sec
        with self.engine.begin() as conn:
            conn.execute(delete(sessions_table).where(sessions_table.c.expires_at < now))  # housekeeping
            conn.execute(
                insert(sessions_table).values(
                    token_hash=token_hash, user_id=user_id, created_at=now, expires_at=expires
                )
            )
        return expires

    def user_for_token(self, token_hash: str) -> User | None:
        stmt = (
            select(users_table)
            .join(sessions_table, sessions_table.c.user_id == users_table.c.id)
            .where(
                sessions_table.c.token_hash == token_hash,
                sessions_table.c.expires_at > time.time(),
                users_table.c.is_active.is_(True),
            )
        )
        with self.engine.connect() as conn:
            row = conn.execute(stmt).first()
        return _to_user(row) if row else None

    def delete_session(self, token_hash: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(delete(sessions_table).where(sessions_table.c.token_hash == token_hash))

    # -- saved database connections (created in the UI) ------------------------
    def _row_to_config(self, row: Any) -> ConnectionConfig:
        password = None
        if row.password_enc:
            if self.cipher is None:
                raise CipherError("No encryption key configured")
            password = self.cipher.decrypt(row.password_enc)
        return ConnectionConfig(
            key=row.slug,
            label=row.label,
            engine=row.engine,
            database=row.db_name,
            host=row.host,
            port=row.port,
            user=row.username,
            password=password,
            schema=row.db_schema,
            id_hints=tuple(h for h in (row.id_hints or "").split(",") if h),
            source="ui",
        )

    def list_connections(self) -> list[ConnectionConfig]:
        """All UI-created connections. Ones whose password can't be decrypted are skipped (and logged)."""
        with self.engine.connect() as conn:
            rows = conn.execute(select(connections_table).order_by(connections_table.c.label)).all()
        configs = []
        for row in rows:
            try:
                configs.append(self._row_to_config(row))
            except CipherError as exc:
                logger.error("Connection %r skipped: %s", row.slug, exc)
        return configs

    def get_connection(self, slug: str) -> ConnectionConfig | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(connections_table).where(connections_table.c.slug == slug)).first()
        return self._row_to_config(row) if row else None

    def _config_values(self, cfg: ConnectionConfig) -> dict[str, Any]:
        encrypted = None
        if cfg.password:
            if self.cipher is None:
                raise CipherError("No encryption key configured")
            encrypted = self.cipher.encrypt(cfg.password)
        return {
            "label": cfg.label,
            "engine": cfg.engine,
            "host": cfg.host,
            "port": cfg.port,
            "username": cfg.user,
            "password_enc": encrypted,
            "db_name": cfg.database,
            "db_schema": cfg.schema,
            "id_hints": ",".join(cfg.id_hints),
        }

    def save_connection(self, cfg: ConnectionConfig, created_by: str | None) -> ConnectionConfig:
        now = time.time()
        try:
            with self.engine.begin() as conn:
                conn.execute(
                    insert(connections_table).values(
                        slug=cfg.key, created_by=created_by, created_at=now, updated_at=now, **self._config_values(cfg)
                    )
                )
        except IntegrityError:
            raise ValueError(f"Connection {cfg.key!r} already exists") from None
        return replace(cfg, source="ui")

    def update_connection(self, cfg: ConnectionConfig) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(
                update(connections_table)
                .where(connections_table.c.slug == cfg.key)
                .values(updated_at=time.time(), **self._config_values(cfg))
            )
        return result.rowcount > 0

    def delete_connection(self, slug: str) -> bool:
        with self.engine.begin() as conn:
            result = conn.execute(delete(connections_table).where(connections_table.c.slug == slug))
        return result.rowcount > 0

    # -- audit log -----------------------------------------------------------
    def audit(
        self,
        username: str | None,
        action: str,
        connection: str | None = None,
        phrase: str | None = None,
        options: str | None = None,
        status: str | None = None,
    ) -> int:
        with self.engine.begin() as conn:
            result = conn.execute(
                insert(audit_table).values(
                    ts=time.time(),
                    username=username,
                    action=action,
                    connection=connection,
                    phrase=(phrase or "")[:200] or None,
                    options=options,
                    status=status,
                )
            )
            return int(result.inserted_primary_key[0])

    def audit_finish(self, audit_id: int, status: str, found: int, error_count: int, duration_sec: float) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                update(audit_table)
                .where(audit_table.c.id == audit_id)
                .values(status=status, found=found, error_count=error_count, duration_sec=duration_sec)
            )

    def list_audit(self, limit: int = 50) -> list[Any]:
        with self.engine.connect() as conn:
            return list(conn.execute(select(audit_table).order_by(audit_table.c.id.desc()).limit(limit)).all())
