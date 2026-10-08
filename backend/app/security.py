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

_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2**14, 8, 1
_PBKDF2_ITERATIONS = 600_000
MIN_PASSWORD_LENGTH = 8


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    raw = password.encode("utf-8")
    if hasattr(hashlib, "scrypt"):
        key = hashlib.scrypt(
            raw, salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, maxmem=64 * 1024 * 1024, dklen=32
        )
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
            key = hashlib.scrypt(
                raw, salt=_unb64(salt), n=int(n), r=int(r), p=int(p), maxmem=64 * 1024 * 1024, dklen=32
            )
        elif parts[0] == "pbkdf2":
            _, iterations, salt, expected = parts
            key = hashlib.pbkdf2_hmac("sha256", raw, _unb64(salt), int(iterations))
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
