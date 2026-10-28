"""Stopping a task never reaches a connection it no longer holds (roadmap M10, audit bug 2)."""

from __future__ import annotations

import threading
import time

from sqlalchemy import create_engine, text

from app.query.runner import QueryTask, fetch_sql, fetch_statement

LONG = "WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3000000) SELECT count(*) FROM r"


def test_a_late_stop_does_not_interrupt_the_next_user_of_the_connection(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'c.db'}", pool_size=1, max_overflow=0)
    first = QueryTask(owner="alice", connection="x", kind="xray")
    fetch_statement(engine, first, text("SELECT 1"), 10)  # done; the connection is back in the pool
    second = QueryTask(owner="bob", connection="x", kind="sql")
    out: dict[str, object] = {}

    def other() -> None:
        try:
            out["rows"] = fetch_sql(engine, second, LONG, {}, 10)[1]
        except Exception as exc:  # noqa: BLE001 - the test reports it
            out["error"] = repr(exc)

    thread = threading.Thread(target=other)
    thread.start()
    time.sleep(0.2)
    first.cancel()  # alice stops her X-ray while it works in DuckDB (or it times out)
    thread.join()
    assert out == {"rows": [(3000000,)]}


def test_a_stop_while_holding_the_connection_still_interrupts(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'c.db'}")
    task = QueryTask(owner="alice", connection="x", kind="sql")
    threading.Timer(0.2, task.cancel).start()
    try:
        fetch_sql(engine, task, LONG.replace("3000000", "300000000"), {}, 10)
    except Exception as exc:  # noqa: BLE001
        assert "interrupt" in str(exc).lower()
    else:
        raise AssertionError("the query was not interrupted")
