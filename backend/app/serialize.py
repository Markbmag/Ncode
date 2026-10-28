"""Convert database values into JSON-safe values.

The browser reads numbers as 64-bit floats, so values it would silently change
travel as text: integers beyond ±2^53 and decimals with more digits than a float
keeps. NaN and ±Infinity have no JSON form at all and become null.
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

MAX_VALUE_CHARS = 10_000  # protects the WebSocket payload from giant TEXT columns
MAX_SAFE_INT = 2**53      # Number.MAX_SAFE_INTEGER + 1: still exact, anything beyond may round
FLOAT_DIGITS = 15         # significant digits a float always keeps


class InfiniteDatetime(datetime):
    """PostgreSQL 'infinity' / '-infinity' timestamps (app/db.py). Sorts like the end / start of time."""

    sign = 1

    def isoformat(self, sep: str = "T", timespec: str = "auto") -> str:
        return "infinity" if self.sign > 0 else "-infinity"


class InfiniteDate(date):
    """PostgreSQL 'infinity' / '-infinity' dates."""

    sign = 1

    def isoformat(self) -> str:
        return "infinity" if self.sign > 0 else "-infinity"


def infinite(kind: type, sign: int) -> Any:
    if issubclass(kind, datetime):
        bound = datetime.max if sign > 0 else datetime.min
        value = InfiniteDatetime(bound.year, bound.month, bound.day, bound.hour, bound.minute, bound.second, bound.microsecond)
    else:
        bound = date.max if sign > 0 else date.min
        value = InfiniteDate(bound.year, bound.month, bound.day)
    value.sign = sign
    return value


def serialize_value(value: Any, clip: bool = True) -> Any:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value if -MAX_SAFE_INT <= value <= MAX_SAFE_INT else str(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Decimal):
        return _decimal(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, timedelta):
        return format_duration(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = "0x" + raw.hex()
        return _clip(text) if clip else text
    if isinstance(value, str):
        return _clip(value) if clip else value
    if isinstance(value, (dict, list, tuple)):  # PostgreSQL json / jsonb / arrays
        text = json.dumps(value, ensure_ascii=False, default=_json_default)
        return _clip(text) if clip else text
    return _clip(str(value)) if clip else str(value)


def _decimal(value: Decimal) -> float | str | None:
    if not value.is_finite():  # PostgreSQL numeric 'NaN' / 'Infinity'
        return None
    digits = value.as_tuple().digits
    significant = len(bytes(digits).rstrip(b"\0"))  # trailing zeros don't count
    if significant <= FLOAT_DIGITS:
        number = float(value)
        if math.isfinite(number) and (number != 0 or value.is_zero()):  # no overflow, no underflow to 0
            return number
    # exact text; plain digits unless the exponent is extreme
    return format(value, "f") if abs(value.adjusted()) < 40 else str(value)


def format_duration(value: timedelta) -> str:
    """MySQL / MariaDB TIME and PostgreSQL intervals as [-]H:MM:SS[.ffffff] (TIME goes up to 838:59:59)."""
    total = value // timedelta(microseconds=1)
    sign = "-" if total < 0 else ""
    total = abs(total)
    seconds, micros = divmod(total, 1_000_000)
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    text = f"{sign}{hours:02d}:{minute:02d}:{sec:02d}"
    return f"{text}.{micros:06d}" if micros else text


def _json_default(value: Any) -> Any:
    return serialize_value(value, clip=False)


def _clip(text: str) -> str:
    if len(text) > MAX_VALUE_CHARS:
        return text[:MAX_VALUE_CHARS] + "…"
    return text
