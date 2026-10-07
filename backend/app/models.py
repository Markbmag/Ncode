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
