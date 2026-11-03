"""Live updates of Kanban boards: an in-process fan-out (one server process).

Every WebSocket watching a board has a queue on its own event loop; the store publishes from
the worker threads the routes run in, so a message is handed over with call_soon_threadsafe.
A slow or stuck browser only loses events (its queue is bounded): it refetches the board on
the next one anyway, since every event means "the board changed, read it again".
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

logger = logging.getLogger("ncode.kanban")

QUEUE_SIZE = 200


class BoardEvents:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: dict[int, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}

    def subscribe(self, board_id: int) -> asyncio.Queue:
        """Call from the WebSocket's event loop."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        with self._lock:
            self._subs.setdefault(board_id, set()).add((asyncio.get_running_loop(), queue))
        return queue

    def unsubscribe(self, board_id: int, queue: asyncio.Queue) -> None:
        with self._lock:
            subs = self._subs.get(board_id)
            if not subs:
                return
            for entry in [e for e in subs if e[1] is queue]:
                subs.discard(entry)
            if not subs:
                del self._subs[board_id]

    def watchers(self, board_id: int) -> int:
        with self._lock:
            return len(self._subs.get(board_id, ()))

    def publish(self, board_id: int, event: dict[str, Any]) -> None:
        """Safe from any thread."""
        with self._lock:
            targets = list(self._subs.get(board_id, ()))
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(_put, queue, event)
            except RuntimeError:  # the loop is closed: the socket is going away
                self.unsubscribe(board_id, queue)


def _put(queue: asyncio.Queue, event: dict[str, Any]) -> None:
    try:
        queue.put_nowait(event)
    except asyncio.QueueFull:
        logger.debug("kanban: a watcher's queue is full, event dropped")
