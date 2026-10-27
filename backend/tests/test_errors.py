"""Errors people can act on (M10): JSON 500s with CORS, database errors in plain words with the
driver text as `details`, in English and Russian."""

from __future__ import annotations

import os
import sqlite3

import pytest
from sqlalchemy import create_engine, text

from app.dberrors import driver_text, explain
from app.i18n import translate
from app.i18n_ru import RU

from .helpers import auth
from .test_query_api import make_client, wait_done

ORIGIN = "http://localhost:5173"


def sqlite_error(sql: str) -> Exception:
    engine = create_engine("sqlite://")
    with engine.connect() as conn:
        conn.exec_driver_sql("CREATE TABLE orders (id INTEGER, name TEXT)")
        try:
            conn.exec_driver_sql(sql)
        except Exception as exc:  # the SQLAlchemy wrapper, as the app sees it
            return exc
    raise AssertionError(f"{sql} did not fail")


# ---------------------------------------------------------------------- unexpected errors


def test_unexpected_error_is_json_with_cors_and_an_error_id(tmp_path, caplog):
    client, _ = make_client(tmp_path)
    client.app.add_api_route("/api/boom", lambda: {"value": object()})  # cannot be serialised
    client = type(client)(client.app, raise_server_exceptions=False)
    res = client.get("/api/boom", headers={"Origin": ORIGIN})
    assert res.status_code == 500
    assert res.headers["access-control-allow-origin"] == ORIGIN  # the browser may read it
    body = res.json()
    assert body["error_id"] and f"(error id {body['error_id']})" in body["detail"]
    assert body["error_id"] in caplog.text  # the traceback is in the log under the same id
    ru = client.get("/api/boom", headers={"Origin": ORIGIN, "Accept-Language": "ru"}).json()
    assert ru["detail"].startswith("На сервере что-то пошло не так") and ru["error_id"] in ru["detail"]


def test_http_errors_keep_cors_headers(tmp_path):
    client, _ = make_client(tmp_path)
    res = client.get("/api/auth/me", headers={"Origin": ORIGIN})
    assert res.status_code == 401 and res.headers["access-control-allow-origin"] == ORIGIN


# ---------------------------------------------------------------------- explain()


@pytest.mark.parametrize(
    ("sql", "kind", "words"),
    [
        ("SELECT qty FROM orders", "unknown_column", ["`qty`"]),
        ("SELECT orders.qty FROM orders", "unknown_column", ["`qty`", "`orders`"]),
        ("SELECT * FROM nope", "unknown_table", ["`nope`"]),
        ("SELEC id FROM orders", "syntax", ["`SELEC`"]),
        ("SELECT * FROM orders WHERE", "syntax_end", []),
        ("SELECT nofunc(1)", "unknown_function", ["`nofunc`"]),
        ("SELECT id FROM orders a, orders b", "ambiguous_column", ["`id`"]),
    ],
)
def test_sqlite_errors_in_plain_words(sql, kind, words):
    info = explain(sqlite_error(sql), "sqlite")
    assert info.kind == kind
    for word in words:
        assert word in info.message
    assert info.details and info.details != info.message
    assert translate(info.message, "ru") != info.message  # every sentence has its Russian


def test_driver_texts_from_live_servers():
    """Errors exactly as pymysql / pymssql / psycopg / DuckDB raised them on the test servers."""
    import pymssql
    import pymysql

    cases = [
        (pymysql.err.OperationalError(1054, "Unknown column 'o.qty' in 'SELECT'"), "unknown_column", "`o`"),
        (pymysql.err.ProgrammingError(1146, "Table 'ncode_test.no_such_table' doesn't exist"), "unknown_table",
         "`no_such_table`"),
        (pymysql.err.ProgrammingError(1064, "You have an error in your SQL syntax; check the manual that corresponds "
                                            "to your MariaDB server version for the right syntax to use near 'SELEC id "
                                            "FROM zz_orders' at line 1"), "syntax", "(line 1)"),
        (pymysql.err.OperationalError(1045, "Access denied for user 'ncode'@'localhost' (using password: YES)"),
         "wrong_password", "`ncode`"),
        (pymysql.err.OperationalError(1044, "Access denied for user 'ncode'@'127.0.0.1' to database 'nodb'"),
         "database_denied", "`nodb`"),
        (pymysql.err.OperationalError(2003, "Can't connect to MySQL server on 'no-such-host.invalid' ([Errno -2] "
                                            "Name or service not known)"), "unknown_host", "`no-such-host.invalid`"),
        (pymysql.err.OperationalError(2003, "Can't connect to MySQL server on '127.0.0.1' ([Errno 111] Connection "
                                            "refused)"), "connection_refused", "refused"),
        (pymysql.err.OperationalError(1205, "Lock wait timeout exceeded; try restarting transaction"), "locked", "locked"),
        (pymysql.err.OperationalError(1969, "Query execution was interrupted (max_statement_time exceeded)"), "timeout",
         "too long"),
        (pymysql.err.OperationalError(1142, "SELECT command denied to user 'ncode'@'localhost' for table `mysql`.`user`"),
         "permission_denied", "`mysql.user`"),
        (pymysql.err.OperationalError(1040, "Too many connections"), "too_many_connections", "too many"),
        (pymssql.exceptions.ProgrammingError(207, b"Invalid column name 'qty'.DB-Lib error message 20018, severity 16:"
                                                  b"\nGeneral SQL Server error: Check messages from the SQL Server\n"),
         "unknown_column", "`qty`"),
        (pymssql.exceptions.OperationalError(8134, b"Divide by zero error encountered.DB-Lib error message 20018, "
                                                   b"severity 16:\nGeneral SQL Server error: Check messages from the "
                                                   b"SQL Server\n"), "division_by_zero", "NULLIF"),
        (pymssql.exceptions.OperationalError(245, b"Conversion failed when converting the varchar value 'abc' to data "
                                                  b"type int.DB-Lib error message 20018"), "bad_value", "`abc`"),
        (pymssql.exceptions.OperationalError((18456, b"Login failed for user 'sa'.DB-Lib error message 20018, severity "
                                                     b"14:\nGeneral SQL Server error: Check messages from the SQL "
                                                     b"Server\n")), "wrong_password", "`sa`"),
        (pymssql.exceptions.OperationalError((18456, b"DB-Lib error message 20009, severity 9:\nUnable to connect: TDS "
                                                     b"server is unavailable or does not exist (no-such-host.invalid)"
                                                     b"\n")), "unknown_host", "`no-such-host.invalid`"),
        (pymssql.exceptions.OperationalError(1222, b"Lock request time out period exceeded.DB-Lib error message 20018"),
         "locked", "locked"),
    ]
    import psycopg

    cases += [
        (psycopg.errors.UndefinedColumn('column "qty" does not exist\nLINE 1: SELECT qty FROM zz_orders\n'
                                        '               ^'), "unknown_column", "`qty`"),
        (psycopg.errors.SyntaxError('syntax error at or near "SELEC"\nLINE 1: SELEC id FROM zz_orders\n        ^'),
         "syntax", "(line 1)"),
        (psycopg.errors.QueryCanceled("canceling statement due to statement timeout"), "timeout", "too long"),
        (psycopg.errors.InsufficientPrivilege("permission denied for table zz_secret"), "permission_denied",
         "`zz_secret`"),
        (psycopg.errors.UndefinedFunction("operator does not exist: integer = text\nLINE 1: ..."), "type_mismatch",
         "(integer = text)"),
        (psycopg.errors.DeadlockDetected("deadlock detected"), "deadlock", "deadlock"),
        (psycopg.OperationalError('connection failed: connection to server on socket "/tmp/.s.PGSQL.5433" failed: '
                                  'FATAL:  database "nodb" does not exist'), "unknown_database", "`nodb`"),
        (psycopg.OperationalError("failed to resolve host 'no-such-host.invalid': [Errno -2] Name or service not "
                                  "known"), "unknown_host", "`no-such-host.invalid`"),
    ]
    for exc, kind, word in cases:
        info = explain(exc)
        assert info.kind == kind, (driver_text(exc), info)
        assert word in info.message, info.message
        assert "DB-Lib" not in (info.details or ""), info.details


def test_duckdb_errors():
    duckdb = pytest.importorskip("duckdb")
    con = duckdb.connect()
    con.execute("CREATE TABLE t (id INTEGER, name VARCHAR)")
    for sql, kind in [("SELECT qty FROM t", "unknown_column"), ("SELECT * FROM nope", "unknown_table"),
                      ("SELECT CAST('abc' AS INTEGER)", "bad_value"), ("SELECT name + 1 FROM t", "type_mismatch")]:
        with pytest.raises(duckdb.Error) as caught:
            con.execute(sql)
        assert explain(caught.value).kind == kind, sql


def test_other_errors_keep_their_text():
    info = explain(ValueError("Unknown table 'x'"))
    assert (info.message, info.details, info.kind) == ("Unknown table 'x'", None, "other")
    plain = explain(sqlite3.OperationalError("something nobody planned for"))
    assert plain.message == "something nobody planned for" and plain.details is None


# ---------------------------------------------------------------------- through the API


@pytest.fixture()
def env(tmp_path):
    client, app_db = make_client(tmp_path)
    with client:
        yield client, auth(client, "admin", "admin-pass-1")


def test_sql_error_is_explained_with_details(env):
    client, headers = env
    started = client.post("/api/query/sql", json={"connection": "shop", "sql": "SELECT gone FROM q_orders"},
                          headers=headers).json()
    done = wait_done(client, headers, started["task_id"])
    assert done["status"] == "error"
    assert done["error"].startswith("The column `gone` doesn't exist")
    assert done["error_details"] == "no such column: gone"
    res = client.get(f"/api/query/tasks/{started['task_id']}", headers={**headers, "Accept-Language": "ru"}).json()
    assert res["error"].startswith("Столбца `gone` нет")
    assert res["error_details"] == "no such column: gone"  # the driver's text stays as it is


def test_browse_error_has_details(env, monkeypatch):
    client, headers = env
    from sqlalchemy.exc import OperationalError

    def broken(*_a, **_k):
        raise OperationalError("SELECT", {}, sqlite3.OperationalError("no such column: q_orders.qty"))

    monkeypatch.setattr("app.api.browse_table", broken)
    res = client.get("/api/connections/shop/browse", params={"table": "q_orders"}, headers=headers)
    assert res.status_code == 502
    assert res.json()["detail"].startswith("The query failed: The column `qty` doesn't exist in `q_orders`")
    assert res.json()["details"] == "no such column: q_orders.qty"
    ru = client.get("/api/connections/shop/browse", params={"table": "q_orders"},
                    headers={**headers, "Accept-Language": "ru"}).json()
    assert ru["detail"].startswith(RU["The query failed: {detail}"].split("{")[0] + "Столбца `qty` нет в `q_orders`")


@pytest.mark.skipif(not os.environ.get("NCODE_TEST_PG_URL"), reason="needs NCODE_TEST_PG_URL")
@pytest.mark.parametrize("env_var", ["NCODE_TEST_PG_URL", "NCODE_TEST_MYSQL_URL", "NCODE_TEST_MSSQL_URL"])
def test_live_servers(env_var):
    url = os.environ.get(env_var)
    if not url:
        pytest.skip(env_var)
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            for sql, kinds in [("SELECT no_such_column_x FROM no_such_table_x", {"unknown_table"}),
                               ("SELECT 1 AS a WHERE no_such_column_x = 1", {"unknown_column"}),
                               ("SELECT * FROM", {"syntax", "syntax_end"})]:
                try:
                    conn.execute(text(sql))
                except Exception as exc:
                    assert explain(exc).kind in kinds, (sql, driver_text(exc))
                    conn.rollback()
                else:
                    raise AssertionError(sql)
    finally:
        engine.dispose()
