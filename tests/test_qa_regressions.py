"""Regression tests for bugs found in the QA loop (no real DB / LLM / network)."""
import asyncio
import unittest.mock

import pytest
from fastapi.testclient import TestClient

import src.db as db
from src import job_search, pipeline
from src.main import app

client = TestClient(app)

PDF_BYTES = b"%PDF-1.4\n%fake minimal pdf for upload validation\n"


@pytest.fixture
def no_groq_key(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(db, "get_config", lambda k: None)


# ── POST /api/applications status allowlist ──────────────────────────────────

def test_create_application_rejects_invalid_status(monkeypatch):
    called = unittest.mock.Mock(return_value=1)
    monkeypatch.setattr(db, "save_job_application", called)
    r = client.post("/api/applications", json={
        "company_name": "X", "position_title": "Y", "status": "frobnicated",
    })
    assert r.status_code == 400
    assert "Invalid status" in r.json()["detail"]
    called.assert_not_called()


def test_create_application_accepts_valid_status(monkeypatch):
    monkeypatch.setattr(db, "save_job_application", lambda **kw: 7)
    r = client.post("/api/applications", json={
        "company_name": "X", "position_title": "Y", "status": "applied",
    })
    assert r.status_code == 200 and r.json()["application_id"] == 7


# ── Missing Groq key fails fast (no orphan rows, no doomed batch) ───────────

def test_analyze_without_groq_key_returns_400_and_skips_pipeline(no_groq_key, monkeypatch):
    run = unittest.mock.Mock()
    monkeypatch.setattr(pipeline, "run_analysis_pipeline", run)
    r = client.post(
        "/api/analyze",
        files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
        data={"job_description": "Python developer"},
    )
    assert r.status_code == 400
    assert "Groq API key" in r.json()["detail"]
    run.assert_not_called()


def test_analyze_batch_without_groq_key_returns_400(no_groq_key, monkeypatch):
    monkeypatch.setattr(db, "get_resume", lambda i: {"id": i, "extracted_text": "cv"})
    monkeypatch.setattr(db, "get_saved_jobs", lambda: [{"id": 1, "description": "jd"}])
    r = client.post("/api/analyze-batch", json={"resume_id": 1})
    assert r.status_code == 400
    assert "Groq API key" in r.json()["detail"]


# ── Batch pipeline must not run on the event-loop thread ────────────────────

def test_analyze_batch_runs_pipeline_off_event_loop(monkeypatch):
    monkeypatch.setattr(db, "get_resume", lambda i: {"id": i, "extracted_text": "cv"})
    monkeypatch.setattr(db, "get_saved_jobs", lambda: [{"id": 5, "description": "jd", "title": "t"}])
    monkeypatch.setattr(db, "update_job_analysis", lambda **kw: None)
    monkeypatch.setattr(asyncio, "sleep", unittest.mock.AsyncMock())  # skip throttle

    seen = {}

    def fake_batch(**kw):
        # A sync call made directly from the async task would see the running
        # loop; one dispatched to an executor thread has none.
        try:
            asyncio.get_running_loop()
            seen["on_loop"] = True
        except RuntimeError:
            seen["on_loop"] = False
        seen["kw"] = kw
        return {"match_score": 80.0}

    monkeypatch.setattr(pipeline, "run_batch_pipeline", fake_batch)

    r = client.post("/api/analyze-batch", json={"resume_id": 1, "groq_api_key": "gsk_x"})
    assert r.status_code == 200 and r.json()["jobs_queued"] == 1
    # TestClient runs background tasks before returning.
    assert "on_loop" in seen, "batch pipeline was never invoked"
    assert seen["on_loop"] is False
    assert seen["kw"]["groq_api_key"] == "gsk_x"


# ── USAJOBS requires an Authorization-Key ────────────────────────────────────

def test_usajobs_skipped_without_key(monkeypatch):
    get = unittest.mock.Mock()
    monkeypatch.setattr(job_search.requests, "get", get)
    res = job_search.search_jobs_unified("python", platforms=["usajobs"])
    get.assert_not_called()
    assert any("USAJOBS_API_KEY" in e for e in res["errors"])


def test_usajobs_sends_authorization_key(monkeypatch):
    resp = unittest.mock.Mock()
    resp.json.return_value = {"SearchResult": {"SearchResultItems": []}}
    resp.raise_for_status.return_value = None
    get = unittest.mock.Mock(return_value=resp)
    monkeypatch.setattr(job_search.requests, "get", get)
    job_search.search_jobs_unified("python", platforms=["usajobs"], usajobs_key="k-123")
    get.assert_called_once()
    assert get.call_args.kwargs["headers"]["Authorization-Key"] == "k-123"


def test_platforms_reports_usajobs_disabled_without_key(monkeypatch):
    monkeypatch.delenv("USAJOBS_API_KEY", raising=False)
    monkeypatch.setattr(db, "get_config", lambda k: None)
    r = client.get("/api/search/platforms")
    usajobs = next(p for p in r.json()["platforms"] if p["id"] == "usajobs")
    assert usajobs["enabled"] is False
