"""Attachment files of Kanban cards: which types are allowed, checking the content, where files live.

Files are kept in <app data>/kanban/<board id>/<random name> (next to the app database, like the
uploaded datasets; included in backups, app/backup.py). The stored name is random and never the
uploaded one. The type is decided here from the file's extension and, for images, PDF and office
files, checked against the first bytes; what the browser claims (Content-Type) is never used.
"""

from __future__ import annotations

import logging
import re
import secrets
import shutil
import time
import unicodedata
from pathlib import Path

logger = logging.getLogger("ncode.kanban")

_OOXML = "application/vnd.openxmlformats-officedocument."
_ODF = "application/vnd.oasis.opendocument."
# extension -> (content type, kind); the kind picks the content check
TYPES: dict[str, tuple[str, str]] = {
    ".jpg": ("image/jpeg", "jpeg"),
    ".jpeg": ("image/jpeg", "jpeg"),
    ".png": ("image/png", "png"),
    ".gif": ("image/gif", "gif"),
    ".webp": ("image/webp", "webp"),
    ".heic": ("image/heic", "heif"),
    ".heif": ("image/heif", "heif"),
    ".pdf": ("application/pdf", "pdf"),
    ".doc": ("application/msword", "ole"),
    ".xls": ("application/vnd.ms-excel", "ole"),
    ".ppt": ("application/vnd.ms-powerpoint", "ole"),
    ".docx": (_OOXML + "wordprocessingml.document", "zip"),
    ".xlsx": (_OOXML + "spreadsheetml.sheet", "zip"),
    ".pptx": (_OOXML + "presentationml.presentation", "zip"),
    ".odt": (_ODF + "text", "zip"),
    ".ods": (_ODF + "spreadsheet", "zip"),
    ".odp": (_ODF + "presentation", "zip"),
    ".txt": ("text/plain", "text"),
    ".log": ("text/plain", "text"),
    ".md": ("text/markdown", "text"),
    ".csv": ("text/csv", "text"),
}
# shown in the browser (Content-Disposition: inline); everything else is downloaded
INLINE = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
THUMB_MAX = 2 * 1024 * 1024
HEAD = 64  # bytes the content checks need
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif"}
_NAME_RE = re.compile(r"^[0-9a-f]{32}(\.[a-z0-9]{1,5})?$")


def extension(filename: str) -> str:
    return Path(filename).suffix.lower()


def type_for(filename: str) -> tuple[str, str] | None:
    return TYPES.get(extension(filename))


def is_image(content_type: str) -> bool:
    return content_type.startswith("image/")


def content_matches(kind: str, head: bytes, sample: bytes) -> bool:
    """Does the start of the file fit its type? `sample` = the first few KB (for text files)."""
    if kind == "jpeg":
        return head[:3] == b"\xff\xd8\xff"
    if kind == "png":
        return head[:8] == b"\x89PNG\r\n\x1a\n"
    if kind == "gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if kind == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if kind == "heif":
        return head[4:8] == b"ftyp" and head[8:12] in _HEIF_BRANDS
    if kind == "pdf":
        return head[:5] == b"%PDF-"
    if kind == "ole":
        return head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
    if kind == "zip":
        return head[:4] == b"PK\x03\x04"
    if kind == "text":
        return b"\x00" not in sample
    return False


def thumb_kind(head: bytes) -> str | None:
    """The extension of a preview image (made by the browser), or None when it is not one."""
    if content_matches("jpeg", head, b""):
        return ".jpg"
    if content_matches("png", head, b""):
        return ".png"
    if content_matches("webp", head, b""):
        return ".webp"
    return None


def clean_filename(raw: str) -> str:
    """The name shown and offered on download: no folders, no control characters, at most 255 chars."""
    name = unicodedata.normalize("NFC", raw or "").replace("\\", "/").split("/")[-1]
    name = "".join(ch for ch in name if unicodedata.category(ch)[0] != "C").strip().strip(".")
    if not name:
        return "file"
    if len(name) > 255:
        ext = extension(name)[:16]
        name = name[: 255 - len(ext)] + ext
    return name


def new_name(ext: str) -> str:
    return secrets.token_hex(16) + ext


def safe_name(stored: str | None) -> bool:
    return bool(stored) and _NAME_RE.match(stored or "") is not None


class FileStore:
    """The files of one server: <root>/<board id>/<name>."""

    def __init__(self, root: Path):
        self.root = root

    def board_dir(self, board_id: int) -> Path:
        return self.root / str(int(board_id))

    def path(self, board_id: int, stored: str) -> Path | None:
        if not safe_name(stored):
            return None
        return self.board_dir(board_id) / stored

    def temp(self, board_id: int) -> Path:
        folder = self.board_dir(board_id)
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f".upload-{secrets.token_hex(8)}.part"

    def remove(self, board_id: int, names: list[str | None]) -> None:
        for stored in names:
            path = self.path(board_id, stored or "")
            if path is None:
                continue
            try:
                path.unlink(missing_ok=True)
            except OSError:  # Windows: still open somewhere; the file stays, nothing points at it
                logger.warning("kanban: could not remove %s", path)

    def remove_board(self, board_id: int) -> None:
        shutil.rmtree(self.board_dir(board_id), ignore_errors=True)

    def sweep_partial(self, min_age_s: float = 3600) -> int:
        """Removes uploads a crash left half-written."""
        if not self.root.is_dir():
            return 0
        removed = 0
        now = time.time()
        for f in self.root.glob("*/.upload-*.part"):
            try:
                if now - f.stat().st_mtime > min_age_s:
                    f.unlink()
                    removed += 1
            except OSError:
                pass
        return removed
