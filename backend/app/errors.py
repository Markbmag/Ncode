"""Error responses people can act on (M10).

install_error_handling(app) must run before CORSMiddleware is added, so that everything here
sits *inside* CORS: Starlette sends responses for unhandled exceptions from its outermost
ServerErrorMiddleware, outside CORSMiddleware, and the browser then hides them ("server not
reachable"). Here an unexpected exception becomes a JSON 500 with a short error id (and the
traceback in the log), still answered with the CORS headers.

Order (outermost first): ... CORSMiddleware, LanguageMiddleware, CatchAllMiddleware, routes.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from .i18n import LanguageMiddleware

logger = logging.getLogger("ncode.errors")

SERVER_ERROR = (
    "Something went wrong on the server (error id {error_id}). Try again; if it keeps happening, "
    "tell your administrator."
)


class CatchAllMiddleware:
    """Unexpected exceptions -> JSON 500 with an error id (pure ASGI, inside CORS)."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def watch(message: dict[str, Any]) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, watch)
        except Exception:
            error_id = secrets.token_hex(3)
            logger.exception("Unexpected error %s in %s %s", error_id, scope.get("method"), scope.get("path"))
            if started:  # half a response is out already (a stream): nothing better to do
                raise
            response = JSONResponse(
                {"detail": SERVER_ERROR.format(error_id=error_id), "error_id": error_id}, status_code=500
            )
            await response(scope, receive, send)


async def _http_error(_request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    body: dict[str, Any] = {"detail": exc.detail}
    details = getattr(exc, "details", None)
    if details:
        body["details"] = details  # the driver's own text, for analysts
    if exc.status_code in (204, 304):
        return Response(status_code=exc.status_code, headers=exc.headers)
    return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)


def install_error_handling(app: FastAPI) -> None:
    """Call before app.add_middleware(CORSMiddleware, ...)."""
    app.add_middleware(CatchAllMiddleware)
    app.add_middleware(LanguageMiddleware)
    app.add_exception_handler(StarletteHTTPException, _http_error)
