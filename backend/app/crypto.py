"""Encryption for database passwords entered in the UI.

Passwords are stored encrypted (Fernet = AES-128-CBC + HMAC) in Ncode's own
database. The key comes from, in this order:

1. the NCODE_SECRET_KEY environment variable / .env entry, or
2. a key file that is created automatically on first use
   (backend/data/secret.key, readable only by the current user).

LOSING THE KEY MEANS LOSING THE SAVED PASSWORDS - back up the key file (or keep
NCODE_SECRET_KEY somewhere safe). Generate a key yourself with:

    python -m app.manage generate-key
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from .config import ConfigError

logger = logging.getLogger(__name__)


class CipherError(Exception):
    """Raised when a stored secret can't be decrypted (wrong or lost key)."""


class Cipher:
    def __init__(self, key: bytes | str):
        try:
            self._fernet = Fernet(key)
        except (ValueError, TypeError) as exc:
            raise ConfigError(
                "The secret key is not valid. Generate one with: python -m app.manage generate-key"
            ) from exc

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str) -> str:
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise CipherError("Cannot decrypt the saved password - was the secret key changed or lost?") from exc


def generate_key() -> str:
    return Fernet.generate_key().decode("ascii")


def load_cipher(env_key: str, key_file: Path) -> Cipher:
    """Use NCODE_SECRET_KEY if set, otherwise read or create the key file."""
    if env_key:
        return Cipher(env_key)

    if key_file.exists():
        return Cipher(key_file.read_text(encoding="ascii").strip())

    key_file.parent.mkdir(parents=True, exist_ok=True)
    key = generate_key()
    # O_EXCL: never overwrite an existing key; 0o600: owner-only (ignored on Windows).
    fd = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as handle:
        handle.write(key)
    logger.warning("Created a new encryption key at %s - BACK IT UP, it cannot be recovered.", key_file)
    return Cipher(key)
