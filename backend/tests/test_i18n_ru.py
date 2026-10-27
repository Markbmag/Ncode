"""Russian server messages (M10): every message the backend raises has a Russian entry in
app/i18n_ru.py with the same placeholders, and the translation layer applies it."""

from __future__ import annotations

import ast
import re
from pathlib import Path

from app.dberrors import TEMPLATES
from app.errors import SERVER_ERROR
from app.i18n import _TOKEN, localize, parse_language, translate
from app.i18n_ru import PYDANTIC, RU

from .helpers import auth
from .test_query_api import make_client

APP = Path(__file__).resolve().parents[1] / "app"

# Exceptions whose message reaches people (as an HTTP detail, a task error, a validation message).
USER_ERRORS = {
    "HTTPException", "DetailedHTTPException", "ContentError", "NotFound", "ValueError", "CompileError", "GuardError",
    "IngestError", "FederationError", "CombineError", "TransformError", "UnsupportedFeature", "RowSecurityError",
    "TokenError", "CipherError", "BackupError", "DeliveryError", "FederationUnavailable", "PydanticCustomError",
}
# Command-line only (python -m app.manage ...) or start-up configuration: English is fine there.
SKIP_FILES = {"manage.py", "datadesk.py", "migrate.py"}
SKIP_DIRS = {"migrations"}
MESSAGE_KEYS = {"error", "detail", "message"}


def _render(node: ast.AST | None) -> str | None:
    """The text of a string literal / f-string, with {placeholders} written as in the source."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        out = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                out.append(str(value.value))
                continue
            assert isinstance(value, ast.FormattedValue)
            text = "{" + ast.unparse(value.value)
            text += {114: "!r", 115: "!s", 97: "!a"}.get(value.conversion, "")
            if value.format_spec is not None:
                text += ":" + (_render(value.format_spec) or "")
            out.append(text + "}")
        return "".join(out)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _render(node.left), _render(node.right)
        if left is not None and right is not None:
            return left + right
    return None


def _call_name(node: ast.Call) -> str | None:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def scan_messages(root: Path = APP) -> dict[str, str]:
    """English message -> "file:line" for every user-facing message literal in the backend code."""
    found: dict[str, str] = {}

    def add(node: ast.AST | None, where: str, suffix: str = "") -> None:
        text = _render(node)
        if text is None:
            return
        text += suffix
        if not re.search(r"[A-Za-z]{2}", _TOKEN.sub("", text)):  # only placeholders: nothing to translate
            return
        found.setdefault(text, where)

    for path in sorted(root.rglob("*.py")):
        if path.name in SKIP_FILES or SKIP_DIRS & set(path.parts) or path.name.startswith("i18n"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            where = f"{path.relative_to(root.parent)}:{getattr(node, 'lineno', 0)}"
            if isinstance(node, ast.Call):
                name = _call_name(node)
                if name in ("HTTPException", "DetailedHTTPException"):
                    for kw in node.keywords:
                        if kw.arg == "detail":
                            add(kw.value, where)
                    if len(node.args) > 1:
                        add(node.args[1], where)
                elif name == "NotFound" and node.args:
                    add(node.args[0], where, " not found")
                elif name == "__init__" and node.args and isinstance(node.func, ast.Attribute) \
                        and isinstance(node.func.value, ast.Call) and _call_name(node.func.value) == "super":
                    add(node.args[0], where)  # the message of an exception class (NotFound, EditConflict ...)
                elif name in USER_ERRORS and node.args:
                    add(node.args[-1] if name == "PydanticCustomError" else node.args[0], where)
                elif name == "db_http_error" and len(node.args) > 2:
                    add(node.args[2], where, ": {detail}")
                for kw in node.keywords:
                    if kw.arg == "error" and name not in ("HTTPException",):
                        add(kw.value, where)
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Attribute) and target.attr == "error":
                        add(node.value, where)
            elif isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value in MESSAGE_KEYS:
                        add(value, where)
    return found


def _tokens(text: str) -> list[str]:
    return sorted(_TOKEN.findall(text))


def test_the_scan_finds_the_messages():
    found = scan_messages()
    assert len(found) > 250
    assert "Unknown table {table!r}" in found
    assert "Could not read the database structure: {detail}" in found


def test_every_server_message_has_russian():
    wanted = set(scan_messages()) | set(TEMPLATES) | {SERVER_ERROR}
    missing = sorted(m for m in wanted if m not in RU)
    assert missing == [], "add these to app/i18n_ru.py:\n" + "\n".join(f"    {m!r}: ''," for m in missing)


def test_russian_keeps_the_placeholders():
    for table in (RU, PYDANTIC):
        for en, ru in table.items():
            assert ru.strip(), f"empty Russian for {en!r}"
            assert _tokens(ru) == _tokens(en), f"placeholders differ: {en!r} -> {ru!r}"
            assert not re.search(r"[A-Za-z]{4,}", _TOKEN.sub("", ru).replace("SQL", "").replace("Ncode", "")) or en == ru \
                or re.search(r"[А-Яа-яЁё]", ru), f"not translated: {en!r}"


def test_translate_fills_placeholders_and_nested_messages():
    assert translate("Unknown table 'orders'", "ru") == RU["Unknown table {table!r}"].replace("{table!r}", "'orders'")
    assert translate("Unknown table 'orders'", "en") == "Unknown table 'orders'"
    inner = "The column `qty` doesn't exist - it may have been renamed or removed. Open the question and pick another " \
            "column, or fix the name in the SQL."
    nested = translate(f"The query failed: {inner}", "ru")
    assert nested.startswith(RU["The query failed: {detail}"].split("{detail}")[0])
    assert "`qty`" in nested and "column" not in nested
    # a label in front of a known message (federation: "<source>: <message>")
    assert translate(f"Orders 2024: {inner}", "ru").startswith("Orders 2024: ")
    assert translate(f"Orders 2024: {inner}", "ru") != f"Orders 2024: {inner}"
    assert translate("Nobody wrote this text", "ru") == "Nobody wrote this text"


def test_pydantic_messages():
    assert translate("Field required", "ru") == "Обязательное поле"
    assert "64" in translate("String should have at most 64 characters", "ru")
    assert translate("String should have at most 64 characters", "ru") != "String should have at most 64 characters"
    assert translate("Value error, Unknown table 'x'", "ru") == translate("Unknown table 'x'", "ru")


def test_localize_only_touches_messages():
    data = {"detail": "Field required", "rows": [["Field required"]], "label": "Field required",
            "items": [{"msg": "Field required", "input": "Field required"}]}
    out = localize(data, "ru")
    assert out["detail"] == "Обязательное поле"
    assert out["rows"] == [["Field required"]] and out["label"] == "Field required"
    assert out["items"][0] == {"msg": "Обязательное поле", "input": "Field required"}


def test_accept_language():
    assert parse_language("ru") == "ru"
    assert parse_language("ru-RU,ru;q=0.9,en;q=0.8") == "ru"
    assert parse_language("en-US,ru;q=0.5") == "en"
    assert parse_language(None) == "en"


def test_api_answers_in_russian(tmp_path):
    client, _app_db = make_client(tmp_path)
    admin_headers = auth(client, "admin", "admin-pass-1")
    res = client.get("/api/connections/nope/tables", headers={**admin_headers, "Accept-Language": "ru"})
    assert res.status_code == 404
    assert res.json()["detail"] == RU["Unknown connection {key!r}"].replace("{key!r}", "'nope'")
    assert int(res.headers["content-length"]) == len(res.content)
    res = client.get("/api/connections/nope/tables", headers=admin_headers)
    assert res.json()["detail"] == "Unknown connection 'nope'"
    res = client.post("/api/auth/login", json={"username": "x"}, headers={"Accept-Language": "ru"})
    assert res.status_code == 422
    assert res.json()["detail"][0]["msg"] == "Обязательное поле"
