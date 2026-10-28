"""Values that JSON or the browser cannot carry as they are, and SQLite engine setup (M10)."""

import json
import sqlite3
import time
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.config import ConnectionConfig, Settings, load_settings
from app.db import build_engine, default_pool_size
from app.query.runner import QueryRunner, QueryTask, run_sql
from app.query.sqlguard import GuardError, bind_params, check_sql, find_params
from app.results import build_envelope, infer_type
from app.serialize import infinite, serialize_value

from .test_query_api import env, post  # noqa: F401  (fixture)


# ---------------------------------------------------------------- serialisation

def test_floats_without_a_json_form_become_null():
    assert [serialize_value(v) for v in (float("nan"), float("inf"), float("-inf"), 1.5)] == [None, None, None, 1.5]
    assert serialize_value(Decimal("NaN")) is None and serialize_value(Decimal("Infinity")) is None
    env = build_envelope(["x"], [(float("nan"),), (2.0,)])
    json.dumps(env.model_dump(), allow_nan=False)  # what the API sends must be valid JSON


def test_big_integers_travel_as_text():
    assert serialize_value(2**53) == 2**53 and serialize_value(-(2**53)) == -(2**53)
    assert serialize_value(2**53 + 1) == "9007199254740993"
    assert serialize_value(-(2**63)) == "-9223372036854775808"
    assert serialize_value(True) is True  # bool is an int, but stays a bool


def test_decimals_are_floats_only_when_exact():
    assert serialize_value(Decimal("0.1")) == 0.1
    assert serialize_value(Decimal("12.50")) == 12.5
    assert serialize_value(Decimal("0.10000000000000000000")) == 0.1  # trailing zeros are not digits
    assert serialize_value(Decimal("1E+300")) == 1e300
    assert serialize_value(Decimal("0")) == 0.0
    assert serialize_value(Decimal("123456789012345")) == 123456789012345.0  # 15 digits
    assert serialize_value(Decimal("1234567890123456")) == "1234567890123456"
    assert serialize_value(Decimal("12345678901234567890.123")) == "12345678901234567890.123"
    assert serialize_value(Decimal("1E+400")) == "1E+400"  # beyond a float: exact text
    assert serialize_value(Decimal("1E-400")) == "1E-400"  # would underflow to 0


def test_json_values_are_json_text():
    assert serialize_value({"a": 1, "b": [True, None], "c": "Привет"}) == '{"a": 1, "b": [true, null], "c": "Привет"}'
    assert serialize_value([1, 2]) == "[1, 2]"
    assert serialize_value({"d": date(2026, 1, 2), "n": Decimal("1.5")}) == '{"d": "2026-01-02", "n": 1.5}'


def test_durations_as_hours_minutes_seconds():
    assert serialize_value(timedelta(hours=838, minutes=59, seconds=59)) == "838:59:59"
    assert serialize_value(-timedelta(hours=838, minutes=59, seconds=59)) == "-838:59:59"
    assert serialize_value(timedelta(seconds=5, microseconds=250)) == "00:00:05.000250"


def test_infinite_dates():
    assert serialize_value(infinite(datetime, 1)) == "infinity"
    assert serialize_value(infinite(date, -1)) == "-infinity"
    assert infer_type([infinite(datetime, 1)]) == "datetime"
    assert infinite(date, -1) < date(1, 1, 2)  # sorts at the start of time


# ---------------------------------------------------------------- result column types

def test_iso_text_columns_are_dates():
    assert infer_type(["2026-01-01", None, "2026-02-01"]) == "date"
    assert infer_type(["2026-01-01", "2026-01-01 10:00:00"]) == "datetime"
    assert infer_type(["2026-01-01T10:00:00.123+05:30", "2026-01-02T00:00Z"]) == "datetime"
    assert infer_type(["2026-01-01", "soon"]) == "string"
    assert infer_type(["2026-13-01"]) == "string"  # looks like a date, isn't one
    assert infer_type(["20260101"]) == "string"
    assert infer_type([1, "2026-01-01"]) == "number"  # the first value decides, as before


# ---------------------------------------------------------------- SQLite engine setup

@pytest.fixture()
def sqlite_engine(tmp_path):
    db = tmp_path / "v.db"
    con = sqlite3.connect(db)
    con.executescript(
        "CREATE TABLE people (id INTEGER, name TEXT, born TEXT);"
        "INSERT INTO people VALUES (1, 'Иван Петров', '2026-01-15'), (2, 'ПЁТР', '2026-02-15'), (3, 'Anna', '2026-03-15');"
    )
    con.commit()
    con.close()
    engine = build_engine(ConnectionConfig(key="v", label="v", engine="sqlite", database=str(db)), Settings())
    yield engine
    engine.dispose()


def sql(engine, query, params=None):
    return run_sql(engine, QueryTask(owner="t", connection="v", kind="sql"), query, params or {}, 100)


def test_sqlite_lower_and_upper_know_unicode(sqlite_engine):
    env = sql(sqlite_engine, "SELECT lower('Иван ПЁТР Straße'), upper('иван'), lower('ABC'), lower(5), lower(NULL)")
    assert env.rows == [["иван пётр straße", "ИВАН", "abc", "5", None]]
    env = sql(sqlite_engine, "SELECT id FROM people WHERE lower(name) LIKE lower('%иван%') OR lower(name) LIKE '%пётр%'")
    assert sorted(r[0] for r in env.rows) == [1, 2]


def test_sqlite_refuses_giant_values_quickly(sqlite_engine):
    for query in ("SELECT length(randomblob(1000000000))", "SELECT length(zeroblob(1000000000))"):
        started = time.monotonic()
        with pytest.raises(Exception, match="too big"):
            sql(sqlite_engine, query)
        assert time.monotonic() - started < 2
    # the runner shows it in words
    runner = QueryRunner(workers=1, timeout_sec=10, cache_ttl_sec=0)
    task = runner.submit(QueryTask(owner="t", connection="v", kind="sql"),
                         lambda t: run_sql(sqlite_engine, t, "SELECT randomblob(1000000000)", {}, 10))
    task.done.wait(5)
    assert task.status == "error" and "larger than 100 MB" in task.error
    runner.shutdown()
    with sqlite_engine.connect() as conn:  # an ordinary big value still works
        assert conn.execute(text("SELECT length(randomblob(10000000))")).scalar() == 10_000_000


def test_sqlite_sql_mode_types_text_dates(sqlite_engine):
    env = sql(sqlite_engine, "SELECT born, name FROM people ORDER BY id")
    assert [c.type for c in env.columns] == ["date", "string"]


def test_number_parameters_must_fit_a_bigint(sqlite_engine):
    with pytest.raises(GuardError, match="too large"):
        sql(sqlite_engine, "SELECT {{n}} AS n", {"n": 10**30})
    with pytest.raises(GuardError, match="finite"):
        bind_params("SELECT {{n}}", {"n": float("inf")}, "qmark")
    assert sql(sqlite_engine, "SELECT {{n}} AS n", {"n": 2**63 - 1}).rows == [["9223372036854775807"]]
    assert sql(sqlite_engine, "SELECT {{n}} AS n", {"n": 1e30}).rows == [[1e30]]


# ---------------------------------------------------------------- placeholders in strings and comments

def test_placeholders_in_strings_and_comments_are_text():
    query = "SELECT '{{a}}' AS s, \"{{b}}\" AS q, {{c}} AS c -- {{d}}\n/* {{e}} */ FROM t WHERE x = {{f}}"
    assert find_params(query) == ["c", "f"]
    text_, params = bind_params(query, {"c": 1, "f": 2}, "qmark")
    assert text_ == "SELECT '{{a}}' AS s, \"{{b}}\" AS q, ? AS c -- {{d}}\n/* {{e}} */ FROM t WHERE x = ?"
    assert params == (1, 2)
    assert check_sql(query, "sqlite").params == ["c", "f"]


def test_placeholder_quoting_per_dialect():
    doubled = "SELECT 'it''s {{a}}', {{b}}"
    assert find_params(doubled, "sqlite") == ["b"]
    # MySQL: a backslash escapes the quote, so the string goes on
    backslash = "SELECT 'it\\' {{a}}', {{b}}"
    assert find_params(backslash, "mysql") == ["b"]
    assert find_params(backslash, "postgresql") == ["a"]  # standard SQL: 'it\' ends the string, ', {{b}}' is one
    assert find_params("SELECT E'\\' {{a}}', {{b}}", "postgresql") == ["b"]
    assert find_params("SELECT $$ {{a}} $$, $t$ {{b}} $t$, {{c}}", "postgresql") == ["c"]
    assert find_params("SELECT 1 /* a /* {{a}} */ {{b}} */, {{c}}", "postgresql") == ["c"]
    assert find_params("SELECT 1 # {{a}}\n, {{b}}", "mysql") == ["b"]
    assert find_params("SELECT 1 --{{a}}\n", "mysql") == ["a"]  # not a comment in MySQL
    assert find_params("SELECT `{{a}}`, [{{b}}], {{c}}", "mssql") == ["a", "c"]


def test_bound_sql_keeps_strings_and_doubles_percent():
    sql_, params = bind_params("SELECT '50% {{a}}' WHERE b = {{b}}", {"b": 1}, "pyformat", "postgresql")
    assert sql_ == "SELECT '50%% {{a}}' WHERE b = %(p_b)s" and params == {"p_b": 1}


def test_api_placeholder_in_string_needs_no_value(env):  # noqa: F811
    client, _, alice, _ = env
    data = post(client, alice, "/api/query/sql", {"connection": "shop", "sql": "SELECT '{{x}}' AS q -- {{y}}"})
    assert data["status"] == "completed", data
    assert data["result"]["rows"] == [["{{x}}"]]


# ---------------------------------------------------------------- settings

def test_task_ttl_and_pool_settings_reach_their_users(tmp_path):
    settings = load_settings({"NCODE_TASK_TTL_SEC": "120", "NCODE_DB_POOL_SIZE": "12", "NCODE_DB_POOL_OVERFLOW": "6"})
    assert settings.task_ttl_sec == 120 and default_pool_size(settings) == 12
    cfg = ConnectionConfig(key="v", label="v", engine="sqlite", database=str(tmp_path / "p.db"))
    engine = build_engine(cfg, settings)
    assert engine.pool.size() == 12 and engine.pool._max_overflow == 6
    engine.dispose()
    auto = Settings(search_workers=3, query_workers=8)
    assert default_pool_size(auto) == 8 and auto.db_pool_overflow > 0
    assert build_engine(cfg, auto, pool_size=1).pool._max_overflow == 0  # one-off probes stay at one connection


def test_api_passes_task_ttl_to_the_query_runner(tmp_path, monkeypatch):
    import app.api

    from .test_query_api import make_client

    made = []

    class Recorder(QueryRunner):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            made.append(self)

    monkeypatch.setattr(app.api, "QueryRunner", Recorder)
    client, _ = make_client(tmp_path, task_ttl_sec=120)
    with client:
        assert made and made[0].task_ttl == 120


# ---------------------------------------------------------------- the same through the API (SQLite)

@pytest.fixture()
def cyrillic(tmp_path):
    from .helpers import auth
    from .test_query_api import make_client

    client, _ = make_client(tmp_path)
    con = sqlite3.connect(tmp_path / "shop.db")
    con.executescript(
        "CREATE TABLE people (id INTEGER, name TEXT);"
        "INSERT INTO people VALUES (1, 'Иван Петров'), (2, 'ПЁТР'), (3, 'Ivan');"
        "CREATE TABLE monthly (month TEXT, revenue REAL);"
        "INSERT INTO monthly VALUES ('2026-01-01', 10), ('2026-02-01', 15), ('2026-03-01', 12);"
    )
    con.commit()
    con.close()
    with client:
        yield client, auth(client, "admin", "admin-pass-1")


@pytest.mark.parametrize("phrase,ids", [("иван", [1]), ("ИВАН", [1]), ("пётр", [2]), ("ivan", [3]), ("IVAN", [3])])
def test_case_insensitive_matching_knows_cyrillic(cyrillic, phrase, ids):
    client, admin = cyrillic
    spec = {"connection": "shop", "source": {"table": "people"}, "fields": [{"ref": "people.id"}],
            "filters": {"rules": [{"ref": "people.name", "op": "contains", "value": phrase}]}}
    assert [r[0] for r in post(client, admin, "/api/query", {"spec": spec})["result"]["rows"]] == ids
    spec["filters"]["rules"][0]["op"] = "starts_with"
    assert [r[0] for r in post(client, admin, "/api/query", {"spec": spec})["result"]["rows"]] == ids

    res = client.get("/api/connections/shop/browse", params={"table": "people", "q": phrase}, headers=admin)
    assert res.status_code == 200, res.text
    assert sorted(r["values"]["id"] for r in res.json()["rows"]) == ids

    task = client.post("/api/search", json={"connection": "shop", "phrase": phrase, "tables": ["people"]}, headers=admin).json()
    deadline = time.time() + 10
    while (data := client.get(f"/api/search/{task['task_id']}", headers=admin).json())["status"] == "running":
        assert time.time() < deadline
        time.sleep(0.05)
    assert sorted(r["row"]["id"] for r in data["results"]) == ids


def test_previous_period_on_sqlite_sql_mode(cyrillic):
    client, admin = cyrillic
    data = post(client, admin, "/api/query/sql", {
        "connection": "shop", "sql": "SELECT month, revenue FROM monthly ORDER BY month",
        "transforms": [{"type": "previous_period", "column": "revenue", "by": "month"}],
    })
    assert data["status"] == "completed", data
    result = data["result"]
    assert result["columns"][0]["type"] == "date"
    assert [r[2] for r in result["rows"]] == [None, 10, 15]
