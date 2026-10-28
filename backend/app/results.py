"""The result envelope: what every query (builder, SQL, federated) returns from M1 on.

    {"columns": [{"name", "type", "role"}], "rows": [[...], ...],
     "stats": {"duration_ms", "row_count", "truncated", "cached"}, "sql": "..."}

Rows are arrays, not objects: smaller payloads, and duplicate column names (two
joined tables both having "id") survive. Charts and formatting rely on the column
type and role, so every column always has both.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Iterable, Literal, Sequence

from pydantic import BaseModel

from .schema_graph import normalize_type, python_type_name
from .serialize import serialize_value

ColumnRole = Literal["dimension", "measure"]

# Numbers that identify things rather than measure them: never summed by default.
_ID_NAME = re.compile(r"(^id$|_id$|^id_|code$|_no$|^year$)", re.IGNORECASE)


class ResultColumn(BaseModel):
    name: str
    type: str          # see schema_graph.TYPES
    role: ColumnRole
    # from the data model (M7), when the column is a table column or a sum/min/max/avg of one
    display_name: str | None = None
    description: str | None = None
    semantic_type: str | None = None
    format: dict[str, Any] | None = None
    generated: bool = False  # added by a transform (running total ...)


class ResultStats(BaseModel):
    duration_ms: int
    row_count: int
    truncated: bool = False
    cached: bool = False


class ResultEnvelope(BaseModel):
    columns: list[ResultColumn]
    rows: list[list[Any]]
    stats: ResultStats
    sql: str | None = None
    federation: dict[str, Any] | None = None  # multi-source questions: sources read, join statistics (M6)
    analysis: dict[str, Any] | None = None    # profiles and X-rays (M7)


def column_role(name: str, type_: str) -> ColumnRole:
    if type_ == "number" and not _ID_NAME.search(name):
        return "measure"
    return "dimension"


def infer_type(values: Iterable[Any]) -> str:
    """Type of a result column from its (raw, not yet serialised) values; first non-null wins.

    Text that is all ISO dates or date-times is a date / datetime column: SQLite has no
    date type, so its dates arrive as text, and "vs. previous period" needs to know.
    """
    values = list(values)
    for value in values:
        if value is not None:
            found = python_type_name(type(value))
            return _text_date_type(values) if found == "string" else found
    return "unknown"


_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_ISO_DATETIME = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?")


def _text_date_type(values: list[Any]) -> str:
    kind = "date"
    for value in values:
        if value is None:
            continue
        if not isinstance(value, str):
            return "string"
        try:
            if _ISO_DATE.fullmatch(value):
                date.fromisoformat(value)
            elif _ISO_DATETIME.fullmatch(value):
                datetime.fromisoformat(value)
                kind = "datetime"
            else:
                return "string"
        except ValueError:
            return "string"
    return kind


def build_envelope(
    names: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    db_types: Sequence[Any] | None = None,
    column_types: Sequence[str] | None = None,
    duration_ms: float = 0,
    truncated: bool = False,
    cached: bool = False,
    sql: str | None = None,
) -> ResultEnvelope:
    """Builds the envelope from raw driver rows.

    column_types (already normalised, e.g. from the query compiler) or db_types
    (SQLAlchemy types) win where they are known; otherwise the type is inferred from
    the values, because a DB-API cursor does not reliably say what a column of a raw
    SQL query is.
    """
    columns = []
    for i, name in enumerate(names):
        if column_types is not None and i < len(column_types):
            type_ = column_types[i]
        elif db_types is not None and i < len(db_types):
            type_ = normalize_type(db_types[i])
        else:
            type_ = "unknown"
        if type_ == "unknown":
            type_ = infer_type(row[i] for row in rows)
        columns.append(ResultColumn(name=name, type=type_, role=column_role(name, type_)))
    return ResultEnvelope(
        columns=columns,
        rows=[[serialize_value(v) for v in row] for row in rows],
        stats=ResultStats(duration_ms=round(duration_ms), row_count=len(rows), truncated=truncated, cached=cached),
        sql=sql,
    )
