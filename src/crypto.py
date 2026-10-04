"""At-rest encryption for user_config values.

Uses Fernet (AES-128-CBC + HMAC) from the cryptography package. The master
key comes from the FERNET_KEY env var (see config.py). When FERNET_KEY is
empty (dev mode), values are stored as plaintext so the local flow keeps
working — but a warning is logged on every read/write.
"""
from __future__ import annotations

import logging
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from . import config as _config

logger = logging.getLogger(__name__)

# Encrypted values are stored with this prefix so we know to decrypt on read.
_PREFIX = "enc:v1:"

_cipher: Optional[Fernet] = None
_encryption_enabled: Optional[bool] = None


def _get_cipher() -> Optional[Fernet]:
    """Return a Fernet instance or None if FERNET_KEY is not set."""
    global _cipher
    if _cipher is None and _config.FERNET_KEY:
        try:
            _cipher = Fernet(_config.FERNET_KEY.encode())
        except Exception as exc:
            logger.error("Invalid FERNET_KEY — disabling encryption: %s", exc)
            _cipher = None
    return _cipher


def is_enabled() -> bool:
    """Whether secret encryption is active. False in dev when FERNET_KEY unset."""
    global _encryption_enabled
    if _encryption_enabled is None:
        _encryption_enabled = _get_cipher() is not None
        if not _encryption_enabled:
            logger.warning(
                "FERNET_KEY is not set — user_config secrets stored in plaintext. "
                "Set FERNET_KEY in production (see src/config.py)."
            )
    return _encryption_enabled


def encrypt(value: str) -> str:
    """Encrypt a string for DB storage. Returns encrypted token with prefix."""
    cipher = _get_cipher()
    if cipher is None or not value:
        return value
    token = cipher.encrypt(value.encode()).decode()
    return f"{_PREFIX}{token}"


def decrypt(value: Optional[str]) -> Optional[str]:
    """Decrypt a stored value. Plaintext (legacy) values pass through unchanged."""
    if value is None:
        return None
    if not value.startswith(_PREFIX):
        return value
    cipher = _get_cipher()
    if cipher is None:
        logger.error(
            "Stored value is encrypted but FERNET_KEY is not set — "
            "returning None. Set FERNET_KEY to recover."
        )
        return None
    try:
        return cipher.decrypt(value[len(_PREFIX):].encode()).decode()
    except InvalidToken as exc:
        logger.error("Failed to decrypt stored value (key mismatch?): %s", exc)
        return None
