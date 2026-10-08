from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

MatchMode = Literal["contains", "exact", "starts_with"]


class SearchRequest(BaseModel):
    connection: str = Field(min_length=1, description="Connection key from GET /api/connections")
    phrase: str = Field(min_length=1, max_length=200)
    match_mode: MatchMode = "contains"
    case_sensitive: bool = False
    include_numeric: bool = False     # also search integer/decimal columns
    include_dates: bool = False       # also search date/time columns
    row_limit: int | None = Field(default=None, ge=1, description="Max rows returned per table")
    tables: list[str] = Field(
        default_factory=list, max_length=5000, description="Exact table names to search; empty = all tables"
    )
    include_tables: list[str] = Field(default_factory=list, description="Glob patterns; empty = all")
    exclude_tables: list[str] = Field(default_factory=list, description="Glob patterns")
    schema_name: str | None = Field(default=None, description="Override the connection's schema")
    refresh_schema: bool = False

    @field_validator("phrase")
    @classmethod
    def _strip_phrase(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("phrase must not be empty")
        return value


class ConnectionInfo(BaseModel):
    key: str
    label: str
    engine: str
    database: str
    id_hints: list[str]
    source: str = "env"        # "env" (from .env, read-only) | "ui" (managed in the interface)
    editable: bool = False     # true only for admins looking at a UI-managed connection


class EngineOption(BaseModel):
    name: str
    label: str
    default_port: int | None
    available: bool            # is the Python driver installed?
    pip: str | None            # what to install when it is not
    file_based: bool


class ConnectionPayload(BaseModel):
    """Create / update / test-draft body for a UI-managed connection."""

    label: str = Field(min_length=1, max_length=120)
    engine: str
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = Field(default=None, max_length=128)
    password: str | None = Field(default=None, max_length=512, description="Empty on update = keep the saved one")
    database: str = Field(min_length=1, max_length=500)
    schema_name: str | None = Field(default=None, max_length=128)
    id_hints: list[str] = Field(default_factory=list, max_length=20)
    key: str | None = Field(default=None, description="test-draft only: reuse the saved password of this connection")

    @field_validator("label", "database")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be empty")
        return value


class ConnectionDetails(BaseModel):
    """What an admin sees when editing a connection. The password itself is never returned."""

    key: str
    label: str
    engine: str
    host: str | None
    port: int | None
    username: str | None
    has_password: bool
    database: str
    schema_name: str | None
    id_hints: list[str]
    source: str
    editable: bool
