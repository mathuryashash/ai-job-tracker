"""Integration-style endpoint tests covering all FastAPI routes."""
import unittest.mock

import pytest
from fastapi.testclient import TestClient

import src.db as db

# Mock heavy ML deps before importing the app.
import sys
sys.modules.setdefault("sentence_transformers", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_groq", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_core", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_core.prompts", unittest.mock.MagicMock())
sys.modules.setdefault("langchain_core.output_parsers", unittest.mock.MagicMock())
sys.modules.setdefault("langgraph", unittest.mock.MagicMock())
sys.modules.setdefault("langgraph.graph", unittest.mock.MagicMock())

db.init_db = lambda: None
db.get_config = lambda k: None
db.save_config = lambda k, v: None
db.save_job_application = lambda **kw: 99
db.get_job_applications = lambda: []
db.update_job_application_status = lambda i, s: None
db.delete_job_application = lambda i: None
db.save_jobs = lambda j: len(j)
db.get_saved_jobs = lambda: []
db.get_resume = lambda i: None

from src.main import app  # noqa: E402

client = TestClient(app)


def test_health_returns_metadata():
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "healthy"
    assert data["service"] == "AI Resume & Job Tracker API"
    assert "groq_model" in data
    assert "encryption_enabled" in data


def test_applications_get_and_create():
    r = client.get("/api/applications")
    assert r.status_code == 200 and r.json()["success"]

    r = client.post("/api/applications", json={
        "company_name": "TestCo", "position_title": "Engineer",
    })
    assert r.status_code == 200 and r.json()["success"]


def test_applications_update_and_delete():
    r = client.put("/api/applications/1", json={"status": "applied"})
    assert r.status_code == 200 and r.json()["success"]

    r = client.delete("/api/applications/1")
    assert r.status_code == 200 and r.json()["success"]


def test_keys_save_with_payload():
    r = client.post("/api/keys", json={
        "groq_api_key": "gsk_test",
        "apify_token": "apify_test",
    })
    assert r.status_code == 200
    assert r.json()["saved"] is True
    assert r.json()["keys_updated"] == 2


def test_keys_save_rejects_empty_strings():
    r = client.post("/api/keys", json={"groq_api_key": "  ", "apify_token": ""})
    assert r.status_code == 200
    assert r.json()["keys_updated"] == 0


def test_keys_get_returns_masked():
    r = client.get("/api/keys")
    assert r.status_code == 200
    assert "groq_api_key" in r.json()


def test_search_platforms_lists_providers():
    r = client.get("/api/search/platforms")
    assert r.status_code == 200
    assert "platforms" in r.json()
    platform_ids = {p["id"] for p in r.json()["platforms"]}
    assert {"remoteok", "usajobs", "linkedin"} <= platform_ids


def test_search_jobs_with_no_platforms():
    r = client.post("/api/search/jobs", json={"query": "python dev", "platforms": []})
    assert r.status_code == 200
    assert r.json()["success"] is True


def test_saved_jobs_get():
    r = client.get("/api/jobs/saved")
    assert r.status_code == 200 and r.json()["success"]


def test_saved_jobs_save_empty_list():
    r = client.post("/api/jobs/save", json=[])
    assert r.status_code == 200 and r.json()["success"]


def test_analyze_batch_returns_404_when_resume_missing():
    r = client.post("/api/analyze-batch", json={"resume_id": 1})
    assert r.status_code == 404


def test_analyze_without_file_returns_422():
    r = client.post("/api/analyze", data={"job_description": "test"})
    assert r.status_code == 422
