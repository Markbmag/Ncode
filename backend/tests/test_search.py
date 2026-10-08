"""Run with:  cd backend && pip install -r requirements-dev.txt && pytest

Uses a throw-away SQLite file, so no real database is needed.
"""

import pytest

from app.config import ConfigError, Settings, load_connections
from app.db import ConnectionRegistry
from app.search import SearchOptions, escape_like, filter_tables, run_search
from app.tasks import SearchTask


@pytest.fixture()
def registry(sample_db):
    env = {
        "NCODE_CONN_T_ENGINE": "sqlite",
        "NCODE_CONN_T_DATABASE": str(sample_db),
        "NCODE_CONN_T_ID_HINTS": "vin",
    }
    reg = ConnectionRegistry(load_connections(env), Settings(search_workers=2))
    yield reg
    reg.dispose_all()


def search(registry, phrase, **kwargs):
    opts = SearchOptions(phrase=phrase, **kwargs)
    task = SearchTask("t", phrase, max_results=1000)
    run_search(task, registry, opts, registry.settings)
    return task


def tables_hit(task):
    return sorted({r["table"] for r in task.results})


def test_contains_is_case_insensitive_by_default(registry):
    task = search(registry, "PASSAT")
    assert task.status == "completed"
    assert tables_hit(task) == ["log_2024", "notes", "vehicles"]


def test_id_column_and_matched_columns(registry):
    task = search(registry, "passat", include_tables=["vehicles"])
    (hit,) = task.results
    assert hit["id_column"] == "vin"
    assert hit["matched_columns"] == ["model"]


def test_blob_columns_are_not_returned(registry):
    task = search(registry, "passat", include_tables=["vehicles"])
    assert "photo" not in task.results[0]["row"]


def test_like_wildcards_are_escaped(registry):
    # "100%" must match only the literal percent sign, not "100 items"
    task = search(registry, "100%", include_tables=["notes"])
    assert [r["row"]["body"] for r in task.results] == ["100% done"]


def test_exact_and_starts_with(registry):
    assert tables_hit(search(registry, "golf", match_mode="exact")) == ["vehicles"]
    assert tables_hit(search(registry, "gol", match_mode="exact")) == []
    assert tables_hit(search(registry, "lsvaa", match_mode="starts_with")) == ["vehicles"]
    assert tables_hit(search(registry, "xyz", match_mode="starts_with")) == []


def test_numeric_and_date_columns_only_when_requested(registry):
    assert tables_hit(search(registry, "120345")) == []
    assert tables_hit(search(registry, "120345", include_numeric=True)) == ["vehicles"]
    assert tables_hit(search(registry, "2024-05", include_dates=True)) == ["vehicles"]


def test_row_limit_and_truncation(registry):
    task = search(registry, "100", include_tables=["notes"], row_limit=1)
    assert len(task.results) == 1
    assert task.truncated_tables == ["notes"]


def test_table_filters_support_globs(registry):
    opts = SearchOptions(phrase="x", include_tables=["LOG_*"], exclude_tables=["*_2023"])
    assert filter_tables(["log_2024", "log_2023", "notes"], opts) == ["log_2024"]


def test_tables_without_searchable_columns_are_skipped(registry):
    task = search(registry, "abc")
    assert task.skipped == 1  # empty_numbers
    assert task.errors == []


def test_cancelled_task_stops(registry):
    opts = SearchOptions(phrase="passat")
    task = SearchTask("t", "passat", max_results=10)
    task.cancel()
    run_search(task, registry, opts, registry.settings)
    assert task.status == "cancelled"


def test_escape_like():
    assert escape_like("50%_[x]!") == "50!%!_![x]!!"


def test_config_requires_host_for_network_engines():
    with pytest.raises(ConfigError):
        load_connections({"NCODE_CONN_A_ENGINE": "mysql", "NCODE_CONN_A_DATABASE": "d"})
    with pytest.raises(ConfigError):
        load_connections({"NCODE_CONN_A_ENGINE": "oracle", "NCODE_CONN_A_DATABASE": "d"})


def test_config_password_with_special_characters_is_kept_verbatim():
    env = {
        "NCODE_CONN_MES_ENGINE": "mysql",
        "NCODE_CONN_MES_HOST": "db.local",
        "NCODE_CONN_MES_DATABASE": "d",
        "NCODE_CONN_MES_PASSWORD": "a)b(c@d/e#f",
        "NCODE_CONN_MES_ID_HINTS": "VIN, serial",
    }
    cfg = load_connections(env)["mes"]
    assert cfg.password == "a)b(c@d/e#f"
    assert cfg.port == 3306
    assert cfg.id_hints == ("vin", "serial")
    assert "a)b(c" not in repr(cfg)
