"""Tests for the FastAPI application endpoints (no real DB needed)."""
import unittest.mock

import pytest
from fastapi.testclient import TestClient

import src.db as db

# Mock heavy deps before importing the app.
import sys
sys.modules.setdefault("sentence_transformers", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_groq", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_core", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_core.prompts", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_core.output_parsers", unittest.mock.MagicMock())
sys.modules.setdefault("langgraph", unittest.mock.MagicMock())
sys.modules.setdefault("langgraph.graph", unittest.mock.MagicMock())

db.init_db = lambda: None

from src.main import app  # noqa: E402

client = TestClient(app)


def test_health_endpoint():
    """The /health endpoint returns the expected metadata."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "AI Resume & Job Tracker API"
    assert "groq_model" in data
    assert "encryption_enabled" in data


def test_db_helper_functions_are_callable():
    """Sanity check that DB helper functions exist and are callable."""
    assert callable(db.get_connection)
    assert callable(db.init_db)
    assert callable(db.save_resume)
    assert callable(db.save_job_application)


def test_applications_crud(monkeypatch):
    """GET / POST / PUT / DELETE /api/applications all work with mocked DB."""
    mock_id = 99
    mock_apps = [
        {"id": 1, "company_name": "Google", "position_title": "SWE",
         "status": "todo", "cover_letter": "Dear Hirer", "job_description": "We need SEs"},
    ]

    monkeypatch.setattr(db, "save_job_application", lambda **kw: mock_id)
    monkeypatch.setattr(db, "get_job_applications", lambda: mock_apps)
    monkeypatch.setattr(db, "update_job_application_status", lambda *a: None)
    monkeypatch.setattr(db, "delete_job_application", lambda *a: None)

    # GET
    r = client.get("/api/applications")
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert r.json()["data"] == mock_apps

    # POST
    r = client.post("/api/applications", json={
        "company_name": "Netflix", "position_title": "Senior developer",
        "job_description": "Coding python", "status": "todo",
    })
    assert r.status_code == 200
    assert r.json()["application_id"] == mock_id

    # PUT
    r = client.put(f"/api/applications/{mock_id}", json={"status": "applied"})
    assert r.status_code == 200
    assert r.json()["success"] is True

    # DELETE
    r = client.delete(f"/api/applications/{mock_id}")
    assert r.status_code == 200


def test_invalid_status_rejected():
    """PUT /api/applications/{id} rejects statuses outside the allowlist."""
    r = client.put("/api/applications/1", json={"status": "frobnicated"})
    assert r.status_code == 400
    assert "Invalid status" in r.json()["detail"]


def test_keys_endpoint_masks_secrets(monkeypatch):
    """GET /api/keys must never expose plaintext — only masked tails."""
    monkeypatch.setattr(db, "get_config", lambda k: "gsk_supersecretvalue1234567890" if k == "groq_api_key" else None)
    r = client.get("/api/keys")
    assert r.status_code == 200
    body = r.json()
    # Must be masked, NOT the plaintext.
    assert "supersecretvalue1234567890" not in str(body)
    assert body["groq_api_key"].startswith("...")


def test_content_length_middleware_rejects_oversized(monkeypatch):
    """Middleware rejects requests advertising too-large Content-Length."""
    # Send a Content-Length header that massively exceeds any plausible limit
    # regardless of what MAX_UPLOAD_SIZE_MB is set to.
    r = client.post(
        "/api/applications",
        json={"company_name": "x", "position_title": "y"},
        headers={"Content-Length": "9999999999"},
    )
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()
