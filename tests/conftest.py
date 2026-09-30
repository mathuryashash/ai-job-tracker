"""Shared pytest fixtures for all test files."""
import os
import sys
import unittest.mock

import pytest

# Ensure src/ is importable as a package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch):
    """Each test gets a clean environment with deterministic defaults."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@127.0.0.1:5432/test_resume_tracker")
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test_key")
    monkeypatch.setenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")


@pytest.fixture
def mock_ml_deps():
    """Mock heavy ML deps so tests don't pull model weights or hit the network."""
    ml_modules = [
        "sentence_transformers",
        "langchain_groq",
        "langchain_core",
        "langchain_core.prompts",
        "langchain_core.output_parsers",
        "langgraph",
        "langgraph.graph",
    ]
    for name in ml_modules:
        sys.modules[name] = unittest.mock.MagicMock()
    yield
    for name in ml_modules:
        sys.modules.pop(name, None)
