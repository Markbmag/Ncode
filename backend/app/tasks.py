"""Search task state shared between the worker threads and the API layer."""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

FINAL_STATUSES = ("completed", "cancelled", "error")


class SearchTask:
    def __init__(self, connection: str, phrase: str, max_results: int):
        self.id = str(uuid.uuid4())
        self.connection = connection
        self.phrase = phrase
        self.max_results = max_results
        self.created_at = time.time()
        self.finished_at: float | None = None
        self.cancel_event = threading.Event()
        self._lock = threading.Lock()

        self.status = "pending"
        self.message: str | None = None   # fatal error text, if any
        self.total = 0
        self.processed = 0
        self.found = 0
        self.skipped = 0                  # tables with nothing searchable
        self.results: list[dict[str, Any]] = []
        self.results_capped = False
        self.truncated_tables: list[str] = []  # more rows existed than row_limit
        self.errors: list[dict[str, str]] = []  # per-table failures

    # -- mutations (called from worker threads) ----------------------------
    def start(self, total: int) -> None:
        with self._lock:
            self.total = total
            self.status = "running"

    def add_table(
        self,
        table: str,
        rows: list[dict[str, Any]],
        truncated: bool,
        skipped: bool,
        error: str | None,
    ) -> None:
        with self._lock:
            self.processed += 1
            if skipped:
                self.skipped += 1
            if error:
                self.errors.append({"table": table, "error": error})
            if truncated:
                self.truncated_tables.append(table)
            self.found += len(rows)
            room = self.max_results - len(self.results)
            if len(rows) > room:
                self.results_capped = True
            if room > 0:
                self.results.extend(rows[:room])

    def finish(self, status: str, message: str | None = None) -> None:
        with self._lock:
            self.status = status
            self.message = message
            self.finished_at = time.time()

    def cancel(self) -> None:
        self.cancel_event.set()

    # -- reads ---------------------------------------------------------------
    @property
    def is_final(self) -> bool:
        return self.status in FINAL_STATUSES

    def progress(self) -> dict[str, Any]:
        """Lightweight snapshot without the (possibly large) result list."""
        with self._lock:
            return {
                "task_id": self.id,
                "status": self.status,
                "message": self.message,
                "total": self.total,
                "processed": self.processed,
                "found": self.found,
                "skipped": self.skipped,
                "error_count": len(self.errors),
            }

    def snapshot(self, include_results: bool = True) -> dict[str, Any]:
        with self._lock:
            data: dict[str, Any] = {
                "task_id": self.id,
                "connection": self.connection,
                "phrase": self.phrase,
                "status": self.status,
                "message": self.message,
                "total": self.total,
                "processed": self.processed,
                "found": self.found,
                "skipped": self.skipped,
                "error_count": len(self.errors),
                "errors": list(self.errors),
                "truncated_tables": list(self.truncated_tables),
                "results_capped": self.results_capped,
            }
            if include_results:
                data["results"] = list(self.results)
            return data


class TaskStore:
    def __init__(self, ttl_sec: int, max_tasks: int = 200):
        self.ttl_sec = ttl_sec
        self.max_tasks = max_tasks
        self._tasks: dict[str, SearchTask] = {}
        self._lock = threading.Lock()

    def create(self, connection: str, phrase: str, max_results: int) -> SearchTask:
        task = SearchTask(connection, phrase, max_results)
        with self._lock:
            self._cleanup_locked()
            self._tasks[task.id] = task
        return task

    def get(self, task_id: str) -> SearchTask | None:
        with self._lock:
            return self._tasks.get(task_id)

    def _cleanup_locked(self) -> None:
        now = time.time()
        expired = [
            tid
            for tid, t in self._tasks.items()
            if t.finished_at is not None and now - t.finished_at > self.ttl_sec
        ]
        for tid in expired:
            del self._tasks[tid]
        # Hard cap: drop the oldest finished tasks first.
        if len(self._tasks) >= self.max_tasks:
            finished = sorted(
                (t for t in self._tasks.values() if t.is_final), key=lambda t: t.created_at
            )
            for t in finished[: len(self._tasks) - self.max_tasks + 1]:
                del self._tasks[t.id]
