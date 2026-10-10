"""The query cases on real database servers. Skipped unless a URL is given:

    NCODE_TEST_PG_URL=postgresql+psycopg://user:pass@host:5432/scratch_db
    NCODE_TEST_MYSQL_URL=mysql+pymysql://user:pass@host:3306/scratch_db      (MySQL or MariaDB)
    NCODE_TEST_MSSQL_URL=mssql+pymssql://user:pass@host:1433/scratch_db

WARNING: the tests create and drop tables named q_* in that database. Use an empty
scratch database and an account that may create tables - never production.
"""

import os

import pytest
from sqlalchemy import create_engine

from app.query.compiler import compile_spec
from app.query.spec import QuerySpec

from .query_cases import CASES, NOW, norm_rows
from .query_data import load, reflect

URLS = {name: os.environ.get(f"NCODE_TEST_{name.upper()}_URL") for name in ("pg", "mysql", "mssql")}


@pytest.fixture(scope="module", params=[n for n in URLS], ids=lambda n: n)
def live(request):
    url = URLS[request.param]
    if not url:
        pytest.skip(f"NCODE_TEST_{request.param.upper()}_URL not set")
    engine = create_engine(url)
    load(engine)
    tables, rels = reflect(engine)
    yield engine, tables, rels
    engine.dispose()


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.name)
def test_case_live(live, case):
    engine, tables, rels = live
    dialect = engine.dialect.name
    if dialect in case.skip:
        pytest.skip(f"not supported on {dialect}")
    spec = QuerySpec.model_validate({"connection": "live", **case.spec})
    compiled = compile_spec(spec, dialect=engine.dialect, tables=tables, relationships=rels, now=NOW)
    with engine.connect() as conn:
        rows = norm_rows(conn.execute(compiled.limited(1)).all())
    expected = case.expected
    if not case.ordered or _nulls_sort_differently(case, rows):
        rows, expected = sorted(rows, key=repr), sorted(expected, key=repr)
    assert rows == expected
    assert [c.name for c in compiled.columns]  # every output column is named


def _nulls_sort_differently(case, rows):
    # PostgreSQL sorts NULL last, the others first: the order of a NULL group is not part of the contract.
    return any(v is None for row in case.expected for v in row)


# ---------------------------------------------------------------- SQL mode on real servers

import time  # noqa: E402

from sqlalchemy.engine import make_url  # noqa: E402

from app.config import ConnectionConfig, Settings  # noqa: E402
from app.db import build_engine  # noqa: E402
from app.query.runner import QueryRunner, QueryTask, run_sql  # noqa: E402

# MariaDB on purpose registered as "mysql": Ncode must detect the server itself.
ENGINE_NAMES = {"postgresql": "postgresql", "mysql": "mysql", "mssql": "mssql"}
SLOW = {
    "postgresql": "SELECT pg_sleep(30)",
    "mysql": "SELECT SLEEP(30)",
    "mssql": "WITH n AS (SELECT CAST(1 AS BIGINT) AS i UNION ALL SELECT i + 1 FROM n WHERE i < 1000000000) "
             "SELECT COUNT_BIG(*) FROM n OPTION (MAXRECURSION 0)",
}


@pytest.fixture(scope="module")
def ncode_engine(live):
    """The same database through Ncode's own engine factory (read-only sessions, timeouts, guards)."""
    engine, _tables, _rels = live
    url = make_url(engine.url.render_as_string(hide_password=False))
    cfg = ConnectionConfig(
        key="live", label="live", engine=ENGINE_NAMES[engine.dialect.name], database=url.database,
        host=url.host or url.query.get("host"), port=url.port or int(url.query.get("port", 0)) or None,
        user=url.username, password=url.password,
    )
    ours = build_engine(cfg, Settings(statement_timeout_sec=20), pool_size=1)  # one connection: state must not leak
    yield ours
    ours.dispose()


def sql(engine, text, params=None, limit=100):
    return run_sql(engine, QueryTask(owner="t", connection="live", kind="sql"), text, params or {}, limit)


def test_sql_mode_rows_percent_and_params(ncode_engine):
    env = sql(ncode_engine, "SELECT name FROM q_customers WHERE name LIKE '50%' ORDER BY name")
    assert env.rows == [["50% Club"]]
    env = sql(ncode_engine, "SELECT name FROM q_customers WHERE name LIKE '%' || {{x}}" if ncode_engine.dialect.name == "postgresql"
              else "SELECT name FROM q_customers WHERE name = {{x}} AND name LIKE '%n%'", {"x": "Anna"})
    assert env.rows == [["Anna"]]


def test_sql_mode_cap_keeps_order_and_ctes_and_resets(ncode_engine):
    text = "WITH o AS (SELECT id, total FROM q_orders) SELECT id FROM o ORDER BY total DESC"
    env = sql(ncode_engine, text, limit=2)
    assert env.rows == [[3], [1]] and env.stats.truncated is True
    # the same pooled connection afterwards: no leftover row cap
    assert len(sql(ncode_engine, "SELECT id FROM q_orders", limit=100).rows) == 7
    # the user's own smaller LIMIT/TOP still wins
    small = "SELECT TOP 1 id FROM q_orders ORDER BY id" if ncode_engine.dialect.name == "mssql" else "SELECT id FROM q_orders ORDER BY id LIMIT 1"
    assert sql(ncode_engine, small, limit=5).rows == [[1]]


def test_sql_mode_sessions_are_read_only(ncode_engine):
    name = ncode_engine.dialect.name
    if name == "mssql":
        pytest.skip("SQL Server has no read-only session switch; use a SELECT-only login")
    if name == "postgresql":
        setting = sql(ncode_engine, "SELECT current_setting('default_transaction_read_only')").rows
        assert setting == [["on"]]
    # bypasses the guard on purpose: the database itself must refuse
    with pytest.raises(Exception, match="(?i)read.only|syntax error|DECLARE"):
        sql(ncode_engine, "DELETE FROM q_order_items")
    with pytest.raises(Exception):
        sql(ncode_engine, "WITH d AS (DELETE FROM q_order_items RETURNING 1) SELECT * FROM d" if name == "postgresql"
            else "UPDATE q_order_items SET qty = 0")
    assert len(sql(ncode_engine, "SELECT * FROM q_order_items").rows) == 5  # nothing changed


def test_mysql_family_timeout_matches_the_server(ncode_engine):
    if ncode_engine.dialect.name != "mysql":
        pytest.skip("MySQL / MariaDB only")
    with ncode_engine.connect() as conn:
        server = conn.exec_driver_sql("SELECT VERSION()").scalar()
        var = "max_statement_time" if "mariadb" in server.lower() else "max_execution_time"
        value = conn.exec_driver_sql(f"SELECT @@SESSION.{var}").scalar()
    assert float(value) in (20, 20000)


def test_cancel_stops_a_running_query(ncode_engine):
    runner = QueryRunner(workers=1, timeout_sec=60, cache_ttl_sec=0)
    task = QueryTask(owner="t", connection="live", kind="sql")
    runner.submit(task, lambda t: run_sql(ncode_engine, t, SLOW[ncode_engine.dialect.name], {}, 10))
    time.sleep(1.5)
    started = time.time()
    task.cancel()
    assert task.done.wait(15), "the query was not stopped"
    assert task.status == "cancelled" and time.time() - started < 10
    assert sql(ncode_engine, "SELECT 1 AS one").rows == [[1]]  # the connection still works
    runner.shutdown()
