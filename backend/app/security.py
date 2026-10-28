"""Password hashing, session tokens and brute-force protection.

Only the Python standard library is used (scrypt, with a PBKDF2 fallback for
Python builds without scrypt), so there is nothing extra to install.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
_PBKDF2_ITERATIONS = 600_000
MIN_PASSWORD_LENGTH = 8

# Each scrypt run needs 16 MB (128 * n * r bytes) and a CPU core. Hashing runs on a few
# threads of its own: a burst of sign-ins is no slower that way, and memory stays bounded.
# (With every request thread hashing, the allocator kept 16 MB per thread: 50 parallel
# sign-ins left the process at about 900 MB; a flood of attempts could exhaust memory.)
_HASHING = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ncode-hash")


def _scrypt(raw: bytes, salt: bytes, n: int, r: int, p: int) -> bytes:
    return _HASHING.submit(
        hashlib.scrypt, raw, salt=salt, n=n, r=r, p=p, maxmem=64 * 1024 * 1024, dklen=32
    ).result()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    raw = password.encode("utf-8")
    if hasattr(hashlib, "scrypt"):
        key = _scrypt(raw, salt, _SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
        return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64(salt)}${_b64(key)}"
    key = hashlib.pbkdf2_hmac("sha256", raw, salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2${_PBKDF2_ITERATIONS}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check; returns False (never raises) on malformed hashes."""
    try:
        raw = password.encode("utf-8")
        parts = stored.split("$")
        if parts[0] == "scrypt":
            _, n, r, p, salt, expected = parts
            key = _scrypt(raw, _unb64(salt), int(n), int(r), int(p))
        elif parts[0] == "pbkdf2":
            _, iterations, salt, expected = parts
            key = _HASHING.submit(hashlib.pbkdf2_hmac, "sha256", raw, _unb64(salt), int(iterations)).result()
        else:
            return False
        return hmac.compare_digest(key, _unb64(expected))
    except Exception:
        return False


def new_token() -> str:
    """Random session token handed to the browser. Only its hash is stored."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class LoginThrottle:
    """Temporarily blocks a (username, ip) pair after too many failed logins."""

    def __init__(self, max_failures: int = 5, lock_sec: int = 300):
        self.max_failures = max_failures
        self.lock_sec = lock_sec
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> list[float]:
        recent = [t for t in self._failures.get(key, []) if now - t < self.lock_sec]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return recent

    def locked_for(self, key: str) -> int:
        """Seconds the caller must still wait (0 = allowed to try)."""
        now = time.time()
        with self._lock:
            recent = self._recent(key, now)
            if len(recent) >= self.max_failures:
                return max(1, int(self.lock_sec - (now - recent[0])))
            return 0

    def fail(self, key: str) -> None:
        now = time.time()
        with self._lock:
            recent = self._recent(key, now)
            recent.append(now)
            self._failures[key] = recent

    def success(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
