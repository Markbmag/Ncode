"""Database errors in plain words (M10 "errors people can act on").

Every driver words its errors differently (SQLite, PostgreSQL/psycopg, MySQL/MariaDB/pymysql,
SQL Server/pymssql, DuckDB). explain() maps the common failures to one sentence with the likely
cause and a fix; the driver's own text stays available as `details` for analysts:

    explain(exc).message   "The column `qty` doesn't exist in `orders` - it may have been renamed ..."
    explain(exc).details   "no such column: orders.qty"

The sentences are templates with {placeholders}; app/i18n_ru.py has their Russian (the i18n test
checks every template in RULES).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException

from .config import ENGINES

_DETAILS_MAX = 2000


@dataclass(frozen=True)
class DbError:
    message: str          # one sentence for everybody
    details: str | None   # the driver's own text, when it differs from the message
    kind: str             # "unknown_column", ... or "other"


@dataclass(frozen=True)
class _Rule:
    kind: str
    pattern: re.Pattern[str]
    templates: tuple[str, ...]  # the first one whose placeholders are all known is used


def _rule(kind: str, patterns: list[str], *templates: str) -> _Rule:
    return _Rule(kind, re.compile("|".join(f"(?:{p})" for p in patterns), re.IGNORECASE | re.DOTALL), templates)


_Q = r"[\"'`\[]?"   # optional opening quote
_E = r"[\"'`\]]?"   # optional closing quote

# Order matters: the first rule that matches wins (specific before general).
RULES: tuple[_Rule, ...] = (
    _rule(
        "driver_missing", [r"no module named"],
        "The database driver is not installed. Run on the server: {pip} - then restart the backend.",
    ),
    # ---------------------------------------------------------------- connecting
    _rule(
        "too_many_connections",
        [r"too many connections", r"too many clients", r"remaining connection slots are reserved",
         r"max_user_connections", r"connection limit exceeded"],
        "The database has too many open connections right now. Try again in a minute; "
        "if it keeps happening, ask your administrator.",
    ),
    _rule(
        "database_denied", [r"access denied for user '(?P<user>[^']*)'@'[^']*' to database '(?P<database>[^']*)'"],
        "The user `{user}` may not open the database `{database}` - the name may be wrong, or access was not "
        "granted. Check the database name in the connection settings or ask your administrator.",
    ),
    _rule(
        "unknown_user", [r"role \"(?P<user>[^\"]+)\" does not exist"],
        "The database user `{user}` doesn't exist on the server - check the username in the connection settings.",
    ),
    _rule(
        "wrong_password",
        [r"password authentication failed for user \"(?P<user>[^\"]+)\"", r"access denied for user '(?P<user2>[^']*)'@",
         r"login failed for user '(?P<user3>[^']*)'", r"authentication failed", r"login failed"],
        "Wrong username or password for the database user `{user}`. Check the login details in the connection settings.",
        "Wrong username or password for the database. Check the login details in the connection settings.",
    ),
    _rule(
        "unknown_database",
        [r"database \"(?P<database>[^\"]+)\" does not exist", r"unknown database '(?P<database2>[^']+)'",
         r"cannot open database \"(?P<database3>[^\"]+)\""],
        "The database `{database}` doesn't exist on the server - check its name in the connection settings.",
    ),
    _rule(
        "file_not_found", [r"unable to open database file", r"cannot open file"],
        "The database file cannot be opened - check that the path is right and that the server may read the file.",
    ),
    _rule(
        "unknown_host",
        [r"failed to resolve host '(?P<host>[^']+)'", r"server on '(?P<host2>[^']+)' \(\[Errno -?\d+\] "
         r"(?:Name or service not known|nodename nor servname|Temporary failure in name resolution)",
         r"could not translate host name \"(?P<host3>[^\"]+)\"", r"name or service not known", r"getaddrinfo failed",
         r"nodename nor servname", r"temporary failure in name resolution", r"no such host is known",
         r"tds server is unavailable or does not exist \((?P<host4>[^)]+)\)\s*$"],
        "The server name `{host}` cannot be found - check the host name, and whether the VPN is on.",
        "The server name cannot be found - check the host name, and whether the VPN is on.",
    ),
    _rule(
        "connection_refused", [r"connection refused", r"actively refused", r"errno 111\b", r"winerror 10061"],
        "The database server refused the connection - check the host and port, and whether the database "
        "service is running.",
    ),
    _rule(
        "login_rejected", [r"tds server connection failed"],
        "SQL Server did not accept the connection - check the database name, username and password in the "
        "connection settings.",
    ),
    _rule(
        "connection_lost",
        [r"server closed the connection unexpectedly", r"lost connection to mysql server during query",
         r"mysql server has gone away", r"connection reset by peer", r"terminating connection"],
        "The connection to the database was lost during the query. Run it again; if it keeps happening, "
        "ask your administrator.",
    ),
    # ---------------------------------------------------------------- time and locks
    _rule(
        "timeout",
        [r"canceling statement due to statement timeout", r"max_statement_time exceeded",
         r"maximum statement execution time exceeded", r"query timeout expired", r"statement timeout"],
        "The query took too long and the database stopped it. Add filters or a shorter date range, or ask your "
        "administrator to raise the time limit.",
    ),
    _rule(
        "deadlock", [r"deadlock"],
        "The query collided with another task working on the same data (a deadlock) and was stopped. Run it again.",
    ),
    _rule(
        "locked",
        [r"lock timeout", r"lock wait timeout", r"lock request time out", r"could not obtain lock",
         r"database is locked", r"database table is locked"],
        "The data is locked by another task right now, so the query waited too long. Try again in a moment.",
    ),
    _rule(
        "connect_timeout",
        [r"timeout expired", r"timed out", r"can't connect", r"cannot connect", r"could not connect",
         r"connection failed", r"no route to host", r"network is unreachable", r"unreachable",
         r"adaptive server connection failed", r"unable to connect"],
        "Cannot reach the database server - check the host and port, whether the VPN is on, and whether a "
        "firewall allows the connection.",
    ),
    # ---------------------------------------------------------------- permissions
    _rule(
        "permission_denied",
        [r"permission denied for (?:table|relation|view|schema|sequence|function) (?P<object>\S+)",
         r"command denied to user '[^']*'@'[^']*' for table (?P<object2>\S+)",
         r"the \w+ permission was denied on the object '(?P<object3>[^']+)'",
         r"permission denied", r"access denied", r"permission was denied", r"insufficient privilege",
         r"permission error"],
        "The database user of this connection may not read `{object}`. Ask your administrator to grant access.",
        "The database refused this because the connection's user lacks a permission. Ask your administrator "
        "to grant access.",
    ),
    # ---------------------------------------------------------------- names
    _rule(
        "ambiguous_column",
        [r"column reference \"(?P<column>[^\"]+)\" is ambiguous", r"column '(?P<column2>[^']+)' in .{0,40}? is ambiguous",
         r"ambiguous column name:? '?(?P<column3>[^'\s.]+)'?", r"ambiguous reference to column name \"(?P<column4>[^\"]+)\""],
        "The column name `{column}` is used by more than one table - put the table name in front of it, "
        "like `table.{column}`.",
    ),
    _rule(
        "grouping",
        [r"column \"(?P<column>[^\"]+)\" must appear in the group by clause",
         r"column '(?P<column2>[^']+)' is invalid in the select list",
         r"'(?P<column3>[^']+)' isn't in group by", r"must appear in the group by clause"],
        "The column `{column}` must be in the GROUP BY list or inside a summary such as SUM() or MAX().",
        "Every column must be in the GROUP BY list or inside a summary such as SUM() or MAX().",
    ),
    _rule(
        "unknown_column",
        [r"column \"?(?P<column>[^\"\s]+?)\"? does not exist", r"unknown column '(?P<column2>[^']+)'",
         r"invalid column name '(?P<column3>[^']+)'", r"no such column: (?P<column4>\S+)",
         r"referenced column \"(?P<column5>[^\"]+)\" not found", r"column with name (?P<column6>\S+) does not exist"],
        "The column `{column}` doesn't exist in `{table}` - it may have been renamed or removed. Open the "
        "question and pick another column, or fix the name in the SQL.",
        "The column `{column}` doesn't exist - it may have been renamed or removed. Open the question and "
        "pick another column, or fix the name in the SQL.",
    ),
    _rule(
        "unknown_table",
        [r"relation \"(?P<table>[^\"]+)\" does not exist", r"table '(?P<table2>[^']+)' doesn't exist",
         r"invalid object name '(?P<table3>[^']+)'", r"no such table: (?P<table4>\S+)",
         r"table with name (?P<table5>\S+) does not exist"],
        "The table `{table}` doesn't exist - it may have been renamed or removed, or this connection's user "
        "can't see it. Pick another table, or fix the name in the SQL.",
    ),
    _rule(
        "unknown_function",
        [r"function (?P<function>[\w.]+)\(.*?\) does not exist", r"function (?P<function2>[\w.`]+) does not exist",
         r"'(?P<function3>[^']+)' is not a recognized (?:built-in )?function name", r"no such function: (?P<function4>\S+)",
         r"function with name (?P<function5>\S+) does not exist"],
        "The database doesn't know the function `{function}`, or not for these kinds of values - check its "
        "spelling and its arguments; every database type has its own function names.",
    ),
    # ---------------------------------------------------------------- values
    _rule(
        "division_by_zero", [r"division by zero", r"divide by zero", r"division by 0"],
        "The query divides by zero. Wrap the divisor in NULLIF(..., 0) so that rows where it is 0 give an empty "
        "value instead.",
    ),
    _rule(
        "out_of_range",
        [r"out of range", r"arithmetic overflow", r"numeric field overflow", r"overflow in"],
        "A number got too big for its data type. Convert it to a larger type (BIGINT or DECIMAL) with CAST.",
    ),
    _rule(
        "bad_value",
        [r"invalid input syntax for type (?P<type>[\w ]+?): \"(?P<value>[^\"]*)\"",
         r"conversion failed when converting the \w+ value '(?P<value2>[^']*)' to data type (?P<type2>\w+)",
         r"could not convert string '(?P<value3>[^']*)' to (?P<type3>\w+)",
         r"incorrect (?P<type4>\w+) value: '(?P<value4>[^']*)'", r"truncated incorrect (?P<type5>\w+) value: '(?P<value5>[^']*)'",
         r"conversion failed", r"error converting data type", r"invalid input syntax", r"conversion error"],
        "The value `{value}` can't be read as {type}. Check the filter value, or convert the column with CAST.",
        "A value can't be converted to the type it is used as. Check the filter value, or convert the column "
        "with CAST.",
    ),
    _rule(
        "type_mismatch",
        [r"operator does not exist: (?P<types>[^\n]+)", r"operand type clash: (?P<types2>[^\n.]+)",
         r"no function matches the given name and argument types '(?P<types3>[^']+)'",
         r"data types (?P<types4>.+?) are incompatible", r"cannot compare values of type", r"incompatible"],
        "Values of different types are compared or combined here ({types}). Compare like with like, or "
        "convert one side with CAST.",
        "Values of different types are compared or combined here. Compare like with like, or convert one side "
        "with CAST.",
    ),
    # ---------------------------------------------------------------- syntax
    _rule(
        "syntax_end",
        [r"syntax error at end of input", r"incomplete input", r"near '' at line", r"unexpected end of"],
        "The SQL ends too early - something is missing at the end (for example a condition after WHERE, or a "
        "closing bracket).",
    ),
    _rule(
        "syntax",
        [r"syntax error at or near \"(?P<near>[^\"]*)\"", r"near '(?P<near2>.*?)' at line (?P<line>\d+)",
         r"incorrect syntax near (?:the keyword )?'(?P<near3>[^']*)'", r"near \"(?P<near4>[^\"]*)\": syntax error",
         r"unrecognized token: \"(?P<near5>[^\"]*)\"", r"syntax error", r"incorrect syntax"],
        "The SQL has a syntax error near `{near}` (line {line}). Check for a missing comma, bracket, quote or keyword.",
        "The SQL has a syntax error near `{near}`. Check for a missing comma, bracket, quote or keyword.",
        "The SQL has a syntax error. Check for a missing comma, bracket, quote or keyword.",
    ),
)

TEMPLATES: tuple[str, ...] = tuple(t for r in RULES for t in r.templates)

_PLACEHOLDER = re.compile(r"\{(\w+)\}")
_DRIVER_MODULES = ("sqlite3", "psycopg", "psycopg2", "pymysql", "MySQLdb", "pymssql", "pyodbc", "duckdb", "_duckdb",
                   "oracledb", "cx_Oracle")


def driver_text(exc: BaseException) -> str:
    """The driver's own message, without wrappers and noise (pymssql bytes, DB-Lib lines, DuckDB prefixes)."""
    orig: Any = getattr(exc, "orig", None) or exc
    args = getattr(orig, "args", ())
    if len(args) == 1 and isinstance(args[0], tuple):  # pymssql while connecting: ((code, message),)
        args = args[0]
    code: Any = None
    if len(args) >= 2 and isinstance(args[0], int) and isinstance(args[1], (bytes, str)):  # pymysql / pymssql
        code, raw = args[0], args[1]
        text = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
    else:
        text = str(orig)
    if "DB-Lib error message" in text:  # pymssql appends the client library's noise
        head = text.split("DB-Lib error message", 1)[0].strip()
        if head:
            text = head
        else:
            lines = [
                line.strip() for line in text.splitlines()
                if line.strip() and not line.startswith("DB-Lib error message")
                and not line.startswith("General SQL Server error")
            ]
            text = "\n".join(dict.fromkeys(lines)) or text
    text = re.sub(r"^\(\w+\.\w+\)\s*", "", text.strip())  # "(sqlite3.OperationalError) ..." from SQLAlchemy
    text = re.sub(r"^[A-Z][a-z]+ Error: ", "", text)          # DuckDB: "Binder Error: ..."
    text = text.split("\n(Background on this error at:")[0].split("\n[SQL:")[0].strip()
    if code is not None and text and not text.startswith(f"({code}"):
        text = f"({code}) {text}"
    return text[:_DETAILS_MAX] or type(exc).__name__


def _is_driver_error(exc: BaseException) -> bool:
    if isinstance(exc, ModuleNotFoundError) or getattr(exc, "orig", None) is not None:
        return True
    module = type(exc).__module__.split(".")[0]
    return module in _DRIVER_MODULES or module == "sqlalchemy"


def _clean_name(name: str) -> str:
    name = name.strip().strip(".,;")
    return re.sub(r"[\"'`\[\]]", "", name)


def _fill(template: str, values: dict[str, str]) -> str | None:
    names = _PLACEHOLDER.findall(template)
    if any(not values.get(n) for n in names):
        return None
    return _PLACEHOLDER.sub(lambda m: values[m.group(1)], template)


def _values(rule: _Rule, match: re.Match[str], text: str, engine_name: str | None) -> dict[str, str]:
    values: dict[str, str] = {}
    for key, value in match.groupdict().items():
        if value:
            values.setdefault(key.rstrip("0123456789"), value)
    for key in ("column", "table", "function", "object", "database", "user", "host"):
        if key in values:
            values[key] = _clean_name(values[key])
    if rule.kind == "unknown_column" and "." in values.get("column", ""):
        values["table"], values["column"] = values["column"].rsplit(".", 1)
    if rule.kind == "grouping" and "." in values.get("column", ""):
        values["column"] = values["column"].rsplit(".", 1)[1]
    if rule.kind in ("unknown_table", "unknown_function") and "." in values.get("table", ""):
        values["table"] = values["table"].rsplit(".", 1)[1]  # MySQL: 'database.table'
    if rule.kind == "unknown_function" and "." in values.get("function", ""):
        values["function"] = values["function"].rsplit(".", 1)[1]
    if rule.kind == "syntax":
        values["near"] = values.get("near", "").strip()[:40]
        if "line" not in values:
            line = re.search(r"^LINE (\d+):", text, re.MULTILINE)
            if line:
                values["line"] = line.group(1)
    if rule.kind == "type_mismatch" and "types" in values:
        values["types"] = values["types"].strip().rstrip(".")[:60]
    if rule.kind == "driver_missing":
        info = ENGINES.get(engine_name or "")
        values["pip"] = f"pip install {info.pip}" if info and info.pip else "pip install <driver>"
    return values


def explain(exc: BaseException, engine_name: str | None = None) -> DbError:
    """Map a driver exception to a plain sentence; anything unknown keeps the driver's first line."""
    own_details = getattr(exc, "details", None)  # an error that already carries the driver text (e.g. federation)
    if not _is_driver_error(exc):
        text = exc.detail if isinstance(exc, HTTPException) and isinstance(exc.detail, str) else str(exc).strip()
        return DbError((text.splitlines()[0] if text else type(exc).__name__)[:500], own_details, "other")
    text = driver_text(exc)
    for rule in RULES:
        match = rule.pattern.search(text)
        if match is None:
            continue
        values = _values(rule, match, text, engine_name)
        for template in rule.templates:
            message = _fill(template, values)
            if message is not None:
                return DbError(message, text, rule.kind)
    first = text.splitlines()[0][:500]
    return DbError(first, text if text != first else None, "other")


def describe_error(exc: BaseException, engine_name: str | None = None) -> str:
    """Turn a driver exception into a short, actionable message (shown in the UI)."""
    return explain(exc, engine_name).message


class DetailedHTTPException(HTTPException):
    """An HTTPException whose response also carries `details` (the driver's own text)."""

    def __init__(self, status_code: int, detail: str, details: str | None = None, headers: dict[str, str] | None = None):
        super().__init__(status_code=status_code, detail=detail, headers=headers)
        self.details = details


def db_http_error(exc: BaseException, engine_name: str | None, prefix: str, status_code: int = 502) -> DetailedHTTPException:
    """`raise db_http_error(exc, cfg.engine, "The query failed") from exc` -> "The query failed: <plain sentence>"."""
    info = explain(exc, engine_name)
    return DetailedHTTPException(status_code, f"{prefix}: {info.message}", info.details)
