"""Server messages in the reader's language (M10).

The code writes every message in English. The browser says which language the UI shows
(`Accept-Language: ru`), and LanguageMiddleware translates the messages of JSON responses
in one place: the string values of "detail", "error", "msg" and "message" keys. The catalog
(app/i18n_ru.py) maps English templates to Russian:

    "Unknown table {table!r}"  ->  "Неизвестная таблица {table!r}"

A template is matched as a regex built from its text: each {placeholder} captures any text,
which goes into the same placeholder of the Russian. A captured sentence is translated too
("Could not read the database structure: {detail}" with a database error as detail).
"""

from __future__ import annotations

import json
import re
from contextvars import ContextVar
from functools import lru_cache
from typing import Any

from .i18n_ru import PYDANTIC, RU, WORDS

LANGS = ("en", "ru")
_KEYS = frozenset({"detail", "error", "msg", "message"})
_SKIP = frozenset({"result", "results", "rows", "row", "input", "details"})  # data, not messages
_TOKEN = re.compile(r"\{[^{}]*\}")
_HAS_MESSAGE = re.compile(rb'"(?:detail|error|msg|message)"\s*:\s*["\[{]')
_MAX_BODY = 4 * 1024 * 1024
_DEPTH = 3

_lang: ContextVar[str] = ContextVar("ncode_lang", default="en")


def current_lang() -> str:
    return _lang.get()


def parse_language(header: str | None) -> str:
    """'ru', 'ru-RU,ru;q=0.9,en;q=0.8' -> 'ru'; anything else -> 'en' (the first tag decides)."""
    first = (header or "").split(",")[0].split(";")[0].strip().lower()
    return "ru" if first.startswith("ru") else "en"


class _Catalog:
    def __init__(self, table: dict[str, str], words: dict[str, str]):
        self.words = words
        self.exact: dict[str, str] = {}
        # (literal prefix, compiled regex, the placeholders in order, Russian)
        self.patterns: list[tuple[str, re.Pattern[str], list[str], str]] = []
        for en, ru in table.items():
            tokens = _TOKEN.findall(en)
            if not tokens:
                self.exact[en] = ru
                continue
            parts = _TOKEN.split(en)
            regex = "(.*?)".join(re.escape(p) for p in parts)
            self.patterns.append((parts[0], re.compile(regex, re.DOTALL), tokens, ru))
        # the most specific template (the most literal text) first
        self.patterns.sort(key=lambda p: -len(_TOKEN.sub("", p[1].pattern)))

    def translate(self, text: str, depth: int = 0) -> str:
        hit = self.exact.get(text)
        if hit is not None:
            return hit
        for prefix, regex, tokens, ru in self.patterns:
            if not text.startswith(prefix):
                continue
            match = regex.fullmatch(text)
            if match is None:
                continue
            values: dict[str, str] = {}
            for token, value in zip(tokens, match.groups()):
                if token not in values:
                    # a captured sentence gets translated as well; a name or a number stays as it is
                    if depth < _DEPTH and " " in value:
                        value = self.translate(value, depth + 1)
                    values[token] = self.words.get(value, value)
            return _TOKEN.sub(lambda m: values.get(m.group(0), m.group(0)), ru)
        if depth < _DEPTH and ": " in text:  # "<a label>: <a known message>"
            head, tail = text.split(": ", 1)
            translated = self.translate(tail, depth + 1)
            if translated != tail:
                return f"{head}: {translated}"
        return text


_CATALOGS = {"ru": _Catalog({**PYDANTIC, **RU}, WORDS)}


@lru_cache(maxsize=4096)
def _cached(text: str, lang: str) -> str:
    return _CATALOGS[lang].translate(text)


def translate(text: str, lang: str | None = None) -> str:
    """The message in `lang` (default: the language of the current request)."""
    lang = lang or _lang.get()
    if lang == "en" or lang not in _CATALOGS or not text:
        return text
    return _cached(text, lang)


def localize(data: Any, lang: str | None = None) -> Any:
    """Translates the message fields of a JSON-like value (returns a new value)."""
    lang = lang or _lang.get()
    if lang == "en":
        return data
    if isinstance(data, dict):
        out = {}
        for key, value in data.items():
            if key in _KEYS and isinstance(value, str):
                out[key] = translate(value, lang)
            elif key in _SKIP or not isinstance(value, (dict, list)):
                out[key] = value
            else:
                out[key] = localize(value, lang)
        return out
    if isinstance(data, list):
        return [localize(item, lang) for item in data]
    return data


class LanguageMiddleware:
    """Sets the request's language and translates the messages of JSON responses (pure ASGI)."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        header = next((v.decode("latin-1") for k, v in scope.get("headers", ()) if k == b"accept-language"), None)
        lang = parse_language(header)
        token = _lang.set(lang)
        try:
            if lang == "en" or scope["type"] != "http":
                await self.app(scope, receive, send)
            else:
                await self.app(scope, receive, _Translating(send, lang))
        finally:
            _lang.reset(token)


class _Translating:
    """Holds back a JSON response until its body is complete, then sends it translated."""

    def __init__(self, send: Any, lang: str):
        self.send, self.lang = send, lang
        self.start: dict[str, Any] | None = None
        self.chunks: list[bytes] = []
        self.size = 0

    async def __call__(self, message: dict[str, Any]) -> None:
        if message["type"] == "http.response.start":
            content_type = next((v for k, v in message.get("headers", ()) if k == b"content-type"), b"")
            if content_type.startswith(b"application/json"):
                self.start = message
                return
        elif message["type"] == "http.response.body" and self.start is not None:
            self.chunks.append(message.get("body", b""))
            self.size += len(self.chunks[-1])
            if self.size > _MAX_BODY:  # too big to rewrite: send as it is
                await self._flush(b"".join(self.chunks), more=message.get("more_body", False))
                return
            if message.get("more_body", False):
                return
            await self._flush(self._translated(b"".join(self.chunks)), more=False)
            return
        await self.send(message)

    async def _flush(self, body: bytes, more: bool) -> None:
        start, self.start, self.chunks = self.start, None, []
        assert start is not None
        headers = [(k, v) for k, v in start.get("headers", ()) if k != b"content-length"]
        if not more:
            headers.append((b"content-length", str(len(body)).encode()))
        await self.send({**start, "headers": headers})
        await self.send({"type": "http.response.body", "body": body, "more_body": more})

    def _translated(self, body: bytes) -> bytes:
        if not _HAS_MESSAGE.search(body):
            return body
        try:
            data = json.loads(body)
        except ValueError:
            return body
        return json.dumps(localize(data, self.lang), ensure_ascii=False, separators=(",", ":")).encode()
