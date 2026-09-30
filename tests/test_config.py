"""Tests for centralised configuration."""
import os
import importlib

import pytest


def test_config_defaults():
    from src import config
    assert config.MAX_UPLOAD_SIZE_MB > 0
    assert config.BACKEND_PORT > 0
    assert isinstance(config.CORS_ORIGINS, list)
    assert config.LOG_LEVEL in ("DEBUG", "INFO", "WARNING", "ERROR")


def test_config_env_override(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_xyz")
    monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
    monkeypatch.setenv("MAX_UPLOAD_SIZE_MB", "25")
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example,https://b.example")
    # Reload config to pick up env overrides.
    import src.config
    importlib.reload(src.config)
    cfg = src.config
    assert cfg.GROQ_API_KEY == "gsk_test_xyz"
    assert cfg.GROQ_MODEL == "openai/gpt-oss-20b"
    assert cfg.MAX_UPLOAD_SIZE_MB == 25
    assert cfg.CORS_ORIGINS == ["https://a.example", "https://b.example"]
    assert cfg.CORS_ALLOW_CREDENTIALS is True


def test_cors_wildcard_disables_credentials(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", "*")
    import src.config
    importlib.reload(src.config)
    assert src.config.CORS_ALLOW_CREDENTIALS is False


def test_usajobs_user_agent_contains_email(monkeypatch):
    monkeypatch.setenv("USAJOBS_EMAIL", "test@example.com")
    import src.config
    importlib.reload(src.config)
    assert "test@example.com" in src.config.USAJOBS_USER_AGENT
