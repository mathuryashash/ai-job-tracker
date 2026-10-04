"""Tests for at-rest secret encryption."""
import os

import pytest


def test_encryption_disabled_without_key():
    """Without FERNET_KEY, is_enabled() is False and values pass through."""
    os.environ.pop("FERNET_KEY", None)
    from src import crypto
    # The module caches is_enabled; reset for this test.
    crypto._encryption_enabled = None
    crypto._cipher = None
    assert crypto.is_enabled() is False
    assert crypto.encrypt("hello") == "hello"
    assert crypto.decrypt("plaintext-value") == "plaintext-value"


def test_encryption_roundtrip():
    os.environ["FERNET_KEY"] = "c2FtcGxlLWtleS1mb3ItdGVzdGluZy1vbmx5LTMyLWJ5dGVz"  # not valid Fernet
    from src import crypto
    crypto._encryption_enabled = None
    crypto._cipher = None
    # Invalid key → encryption disabled (graceful fallback), value still works.
    assert crypto.is_enabled() is False


def test_encryption_roundtrip_with_valid_key():
    """Generate a real Fernet key, encrypt + decrypt roundtrip."""
    from cryptography.fernet import Fernet
    key = Fernet.generate_key().decode()
    os.environ["FERNET_KEY"] = key
    # Reload modules to pick up the env var (config.py reads at import time).
    import importlib
    import src.config
    importlib.reload(src.config)
    import src.crypto
    importlib.reload(src.crypto)
    assert src.crypto.is_enabled() is True
    token = src.crypto.encrypt("super-secret-groq-key")
    assert token.startswith("enc:v1:")
    assert token != "super-secret-groq-key"
    assert src.crypto.decrypt(token) == "super-secret-groq-key"


def test_decrypt_handles_legacy_plaintext():
    """Old rows stored as plaintext should decrypt back to themselves."""
    os.environ["FERNET_KEY"] = ""
    from src import crypto
    crypto._encryption_enabled = None
    crypto._cipher = None
    assert crypto.decrypt("legacy-plaintext-value") == "legacy-plaintext-value"


def test_decrypt_returns_none_for_input_none():
    assert __import__("src").crypto.decrypt(None) is None
