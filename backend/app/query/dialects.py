"""SQL that differs between databases: date buckets, number bins, a few functions.

Constants inside these expressions are rendered as literals (literal_column), never
as bound parameters: the same expression appears in SELECT and GROUP BY, and
PostgreSQL rejects `GROUP BY date_trunc($1, x)` when $1 and the SELECT's $2 are
different parameters. Every literal here comes from a fixed list, not from users.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Date, DateTime, Float, Integer, Numeric, String, cast, func, literal_column
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.expression import ColumnElement

MYSQL_FAMILY = ("mysql", "mariadb")

# Which buckets give a date and which a date-time.
DATE_BUCKETS = ("day", "week", "month", "quarter", "year")
TIME_BUCKETS = ("minute", "hour")


class UnsupportedFeature(ValueError):
    """The question is valid but this database cannot run it (e.g. FULL JOIN on MySQL)."""


def _lit(sql: str) -> Any:
    return literal_column(sql)


class _MySQLInterval(ColumnElement):
    """MySQL's `INTERVAL <expr> <UNIT>` (not a function, so func.* cannot build it)."""

    inherit_cache = True

    def __init__(self, amount: Any, unit: str):
        self.amount = amount
        self.unit = unit


@compiles(_MySQLInterval)
def _compile_interval(element: _MySQLInterval, compiler: Any, **kw: Any) -> str:
    return f"INTERVAL {compiler.process(element.amount, **kw)} {element.unit}"


def date_bucket(expr: Any, unit: str, dialect: str) -> tuple[Any, str]:
    """(expression, result type) truncating a date/datetime to the start of its unit.

    Weeks start on Monday everywhere (ISO 8601).
    """
    out_type = "date" if unit in DATE_BUCKETS else "datetime"
    sa_type = Date() if out_type == "date" else DateTime()

    if dialect == "postgresql":
        truncated = func.date_trunc(_lit(f"'{unit}'"), expr, type_=DateTime())
        return (cast(truncated, Date) if out_type == "date" else truncated), out_type

    if dialect in MYSQL_FAMILY:
        day = func.date(expr, type_=Date())
        one = _lit("1")
        if unit == "day":
            result = day
        elif unit == "week":
            result = func.date_sub(day, _MySQLInterval(func.weekday(expr), "DAY"), type_=Date())
        elif unit == "month":
            result = func.date_sub(day, _MySQLInterval(func.dayofmonth(expr) - one, "DAY"), type_=Date())
        elif unit == "quarter":
            result = func.date_add(
                func.makedate(func.year(expr), one), _MySQLInterval(func.quarter(expr) - one, "QUARTER"), type_=Date()
            )
        elif unit == "year":
            result = func.makedate(func.year(expr), one, type_=Date())
        elif unit == "hour":
            result = func.date_add(day, _MySQLInterval(func.hour(expr), "HOUR"), type_=DateTime())
        else:  # minute
            minutes = func.hour(expr) * _lit("60") + func.minute(expr)
            result = func.date_add(day, _MySQLInterval(minutes, "MINUTE"), type_=DateTime())
        return result, out_type

    if dialect == "mssql":
        zero, one = _lit("0"), _lit("1")
        if unit == "day":
            result = cast(expr, Date)
        elif unit == "week":
            # 0 is 1900-01-01, a Monday; DATEDIFF(week) counts Sunday boundaries, hence the -1 day.
            monday = func.dateadd(
                _lit("week"),
                func.datediff(_lit("week"), zero, func.dateadd(_lit("day"), _lit("-1"), expr)),
                zero,
            )
            result = cast(monday, Date)
        elif unit == "month":
            result = func.datefromparts(func.year(expr), func.month(expr), one, type_=Date())
        elif unit == "quarter":
            first_month = (func.datepart(_lit("quarter"), expr) - one) * _lit("3") + one
            result = func.datefromparts(func.year(expr), first_month, one, type_=Date())
        elif unit == "year":
            result = func.datefromparts(func.year(expr), one, one, type_=Date())
        else:  # hour / minute
            part = _lit(unit)
            result = func.dateadd(part, func.datediff(part, zero, expr), zero, type_=DateTime())
        return result, out_type

    if dialect == "sqlite":
        if unit == "day":
            result = func.date(expr, type_=sa_type)
        elif unit == "week":
            result = func.date(expr, _lit("'-6 days'"), _lit("'weekday 1'"), type_=sa_type)
        elif unit == "month":
            result = func.date(expr, _lit("'start of month'"), type_=sa_type)
        elif unit == "year":
            result = func.date(expr, _lit("'start of year'"), type_=sa_type)
        elif unit == "quarter":
            # .op("/") keeps SQLite's integer division (SQLAlchemy's "/" would make it true division)
            months = (cast(func.strftime(_lit("'%m'"), expr), Integer) - _lit("1")).self_group().op("/")(_lit("3")) * _lit("3")
            shift = _lit("'+'").op("||")(cast(months, String)).op("||")(_lit("' months'"))
            result = func.date(expr, _lit("'start of year'"), shift, type_=sa_type)
        elif unit == "hour":
            result = func.strftime(_lit("'%Y-%m-%d %H:00:00'"), expr, type_=sa_type)
        else:  # minute
            result = func.strftime(_lit("'%Y-%m-%d %H:%M:00'"), expr, type_=sa_type)
        return result, out_type

    raise UnsupportedFeature(f"Grouping by {unit} is not supported on {dialect}")


def number_bin(expr: Any, width: float, dialect: str) -> Any:
    """Lower edge of the bin a number falls into: floor(x / width) * width."""
    w = _lit(repr(float(width)))  # validated positive float: a safe literal
    ratio = expr / w
    if dialect == "sqlite":
        # SQLite's floor() needs a build option Python's sqlite3 may lack.
        whole = cast(ratio, Integer)
        floored = whole - (ratio < whole)
        return cast(floored, Float) * w
    return func.floor(ratio, type_=Float()) * w


def avg(expr: Any, dialect: str) -> Any:
    # SQL Server averages integers as integers (AVG(1,2) = 1); average as float there.
    if dialect == "mssql":
        return func.avg(cast(expr, Float), type_=Float())
    return func.avg(expr, type_=Numeric())


def round_(expr: Any, digits: int, dialect: str) -> Any:
    # PostgreSQL has round(numeric, int) but no round(double precision, int).
    if dialect == "postgresql":
        expr = cast(expr, Numeric)
    return func.round(expr, _lit(str(int(digits))), type_=Numeric())


def supports_full_join(dialect: str) -> bool:
    return dialect not in MYSQL_FAMILY
