"""Regressions for bugs found in the live sandbox run against real Groq.

No network: Groq errors are simulated with the real groq SDK exception types.
"""
import unittest.mock

import httpx
import pytest
from fastapi.testclient import TestClient

import src.db as db
from src import config, pipeline
from src.main import app

client = TestClient(app)
import pathlib
PDF_BYTES = (pathlib.Path(__file__).resolve().parents[1] / "test_resume.pdf").read_bytes()


def _groq_error(cls, status):
    import groq
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    resp = httpx.Response(status, request=req, json={"error": {"message": "x"}})
    return getattr(groq, cls)("boom", response=resp, body=None)


# ── Retired default model ──────────────────────────────────────────────────

def test_default_model_is_not_a_retired_llama(monkeypatch):
    monkeypatch.delenv("GROQ_MODEL", raising=False)
    import importlib
    cfg = importlib.reload(config)
    assert "llama-3" not in cfg.GROQ_MODEL
    assert cfg.GROQ_MODEL == cfg.DEFAULT_GROQ_MODEL


def test_empty_groq_model_env_falls_back_to_default(monkeypatch):
    # docker-compose / .env can inject GROQ_MODEL="" — must not become model="".
    monkeypatch.setenv("GROQ_MODEL", "")
    import importlib
    cfg = importlib.reload(config)
    assert cfg.GROQ_MODEL == cfg.DEFAULT_GROQ_MODEL


def test_model_from_settings_overrides_env(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
    monkeypatch.setattr(db, "get_config", lambda k: "qwen/qwen3.8-27b" if k == "groq_model" else None)
    assert pipeline.current_model() == "qwen/qwen3.8-27b"


def test_model_falls_back_to_env_when_db_unavailable(monkeypatch):
    monkeypatch.setenv("GROQ_MODEL", "openai/gpt-oss-20b")
    def boom(k):
        raise RuntimeError("db down")
    monkeypatch.setattr(db, "get_config", boom)
    assert pipeline.current_model() == "openai/gpt-oss-20b"


def test_save_keys_persists_model(monkeypatch):
    saved = {}
    monkeypatch.setattr(db, "save_config", lambda k, v: saved.__setitem__(k, v))
    r = client.post("/api/keys", json={"groq_model": "openai/gpt-oss-20b"})
    assert r.status_code == 200 and saved == {"groq_model": "openai/gpt-oss-20b"}


@pytest.fixture
def real_langchain_core(monkeypatch):
    """test_api/test_endpoints stub langchain_core in sys.modules at import
    time; these tests need the real ChatPromptTemplate parser."""
    import sys
    for k in [k for k in list(sys.modules) if k == "langchain_core" or k.startswith("langchain_core.")]:
        if isinstance(sys.modules[k], unittest.mock.MagicMock):
            monkeypatch.delitem(sys.modules, k)
    from langchain_core.prompts import ChatPromptTemplate
    assert not isinstance(ChatPromptTemplate, unittest.mock.MagicMock)
    return ChatPromptTemplate


# ── Optimized-resume prompt had literal LaTeX braces parsed as variables ──

def test_optimized_resume_prompt_formats_without_missing_variables(real_langchain_core):
    ChatPromptTemplate = real_langchain_core
    prompt = ChatPromptTemplate.from_messages([
        ("system", pipeline._escape_braces(pipeline.OPTIMIZED_RESUME_SYSTEM_PROMPT)),
        ("human", "{resume}|{jd}|{keywords}"),
    ])
    assert set(prompt.input_variables) == {"resume", "jd", "keywords"}
    msgs = prompt.format_messages(resume="r", jd="j", keywords="k")
    assert r"\documentclass[10pt]{article}" in msgs[0].content


def test_unescaped_prompt_would_have_failed(real_langchain_core):
    # Documents the original bug: the raw text yields bogus template variables.
    ChatPromptTemplate = real_langchain_core
    p = ChatPromptTemplate.from_messages([("system", pipeline.OPTIMIZED_RESUME_SYSTEM_PROMPT)])
    assert "article" in p.input_variables


# ── Fatal Groq errors must abort, not be returned as a 200 "success" ──────

@pytest.mark.parametrize("cls,status,needle", [
    ("AuthenticationError", 401, "API key"),
    ("NotFoundError", 404, "not available"),
])
def test_fatal_groq_errors_raise_llm_config_error(cls, status, needle):
    with pytest.raises(pipeline.LLMConfigError, match=needle):
        pipeline._raise_if_fatal(_groq_error(cls, status))


def test_transient_groq_errors_are_not_fatal():
    pipeline._raise_if_fatal(_groq_error("RateLimitError", 429))  # no raise
    pipeline._raise_if_fatal(ValueError("json parse"))            # no raise


def test_analyze_returns_400_on_llm_config_error(monkeypatch):
    def fake(*a, **k):
        raise pipeline.LLMConfigError("Groq rejected the API key (401). Check the key in Settings.")
    monkeypatch.setattr(pipeline, "run_analysis_pipeline", fake)
    save_app = unittest.mock.Mock()
    monkeypatch.setattr(db, "save_job_application", save_app)
    r = client.post("/api/analyze",
                    files={"file": ("cv.pdf", PDF_BYTES, "application/pdf")},
                    data={"job_description": "Python dev"},
                    headers={"X-Groq-Api-Key": "gsk_bad"})
    assert r.status_code == 400
    assert "401" in r.json()["detail"]
    save_app.assert_not_called()


def test_load_resume_bad_key_aborts_before_saving_resume(monkeypatch, tmp_path):
    pdf = tmp_path / "cv.pdf"
    pdf.write_bytes(PDF_BYTES)
    save_resume = unittest.mock.Mock(return_value=1)
    monkeypatch.setattr(db, "save_resume", save_resume)
    def bad_llm(*a, **k):
        raise _groq_error("AuthenticationError", 401)
    monkeypatch.setattr(pipeline, "get_llm", bad_llm)
    with pytest.raises(pipeline.LLMConfigError):
        pipeline.load_resume_node({"resume_path": str(pdf), "filename": "cv.pdf",
                                   "groq_api_key": "gsk_bad"})
    save_resume.assert_not_called()


def test_batch_stops_after_llm_config_error(monkeypatch):
    import asyncio
    monkeypatch.setattr(db, "get_resume", lambda i: {"id": i, "extracted_text": "cv"})
    monkeypatch.setattr(db, "get_saved_jobs", lambda: [
        {"id": n, "description": "jd", "title": "t"} for n in range(5)])
    monkeypatch.setattr(db, "update_job_analysis", lambda **kw: None)
    monkeypatch.setattr(asyncio, "sleep", unittest.mock.AsyncMock())
    calls = []
    def fake(**kw):
        calls.append(1)
        raise pipeline.LLMConfigError("bad key")
    monkeypatch.setattr(pipeline, "run_batch_pipeline", fake)
    r = client.post("/api/analyze-batch", json={"resume_id": 1, "groq_api_key": "gsk_x"})
    assert r.status_code == 200
    assert len(calls) == 1


# ── Provider descriptions: HTML + double-encoded UTF-8 (RemoteOK) ─────────

def test_clean_description_strips_html_and_fixes_mojibake():
    from src.job_search import clean_description
    raw = "<h3>Full Stack \u00e2\u0080\u0093 Python</h3><p>We\u00e2\u0080\u0099re hiring &amp; growing</p>"
    out = clean_description(raw)
    assert "<" not in out
    assert "Full Stack \u2013 Python" in out
    assert "We\u2019re hiring & growing" in out


def test_clean_description_leaves_real_accents_alone():
    from src.job_search import clean_description
    assert clean_description("Caf\u00e9 in S\u00e3o Paulo, na\u00efve") == "Caf\u00e9 in S\u00e3o Paulo, na\u00efve"
    assert clean_description(None) == ""


def test_dedupe_drops_same_title_company_with_different_urls():
    from src.job_search import _dedupe_and_rank
    jobs = [
        {"title": "Frontend Engineer", "company": "Bjak ", "url": "https://a/1", "description": "python"},
        {"title": "Frontend  Engineer", "company": "bjak", "url": "https://a/2", "description": "python"},
        {"title": "Backend Engineer", "company": "Bjak", "url": "https://a/3", "description": "python"},
    ]
    out = _dedupe_and_rank(jobs, "python", 10, [])
    assert [j["url"] for j in out["jobs"]] == ["https://a/1", "https://a/3"]


# ── Failed generation must not be stored/shown as the cover letter ────────

def test_rate_limited_branch_yields_warning_not_error_text(monkeypatch):
    class FakeLLM:
        def __init__(self, fail):
            self.fail = fail
    def fake_get_llm(api_key=None, timeout=None, model=None):
        return object()
    # Drive the branches through a fake chain: prompt | llm -> object with invoke.
    import types
    class Chain:
        def __init__(self, kind): self.kind = kind
        def invoke(self, _):
            if self.kind == "rl":
                raise _groq_error("RateLimitError", 429)
            return types.SimpleNamespace(content="Senior Backend Engineer")
    calls = {"n": 0}
    class Prompt:
        def __or__(self, llm):
            calls["n"] += 1
            # cover letter + optimized resume rate-limited, role succeeds
            return Chain("ok" if calls["n"] == 3 else "rl")
    class CPT:
        @staticmethod
        def from_messages(msgs): return Prompt()
    monkeypatch.setattr(pipeline, "_get_chat_prompt_template", lambda: CPT)
    monkeypatch.setattr(pipeline, "get_llm", fake_get_llm)
    out = pipeline.parallel_outputs_node({
        "resume_text": "cv", "job_description": "jd", "missing_keywords": [],
        "extracted_keywords": [], "candidate_name": "J",
    })
    assert out["cover_letter"] == "" and out["optimized_resume_latex"] == ""
    assert len(out["warnings"]) == 2
    assert all(pipeline.is_rate_limit_warning(w) for w in out["warnings"])


def test_batch_backs_off_and_retries_once_on_rate_limit(monkeypatch):
    import asyncio
    import src.main as main
    monkeypatch.setattr(db, "get_resume", lambda i: {"id": i, "extracted_text": "cv"})
    monkeypatch.setattr(db, "get_saved_jobs", lambda: [{"id": 9, "description": "jd", "title": "t"}])
    stored = []
    monkeypatch.setattr(db, "update_job_analysis", lambda **kw: stored.append(kw))
    sleeps = []
    async def fake_sleep(s):
        sleeps.append(s)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    results = iter([
        {"match_score": 50, "cover_letter": "", "warnings": ["Cover letter generation failed: Groq rate limit reached (429); retry in a minute."]},
        {"match_score": 55, "cover_letter": "Dear team", "warnings": []},
    ])
    monkeypatch.setattr(pipeline, "run_batch_pipeline", lambda **kw: next(results))
    r = client.post("/api/analyze-batch", json={"resume_id": 1, "groq_api_key": "gsk_x"})
    assert r.status_code == 200
    assert main.BATCH_RATE_LIMIT_BACKOFF_S in sleeps
    assert stored and stored[0]["cover_letter"] == "Dear team" and stored[0]["ats_score"] == 55


def test_get_saved_jobs_selects_latex_column():
    # Batch stores optimized_resume_latex but the listing never selected it,
    # so the UI always showed an empty optimized resume for saved jobs.
    import pathlib
    import re
    src = (pathlib.Path(__file__).resolve().parents[1] / "src" / "db.py").read_text(encoding="utf-8")
    body = re.search(r"def get_saved_jobs\(.*?\n(?=def )", src, re.S).group(0)
    assert "optimized_resume_latex" in body


# ── Image-only / textless PDFs are rejected before any LLM spend ─────────

def _blank_pdf_bytes():
    import io
    import pypdf
    w = pypdf.PdfWriter()
    w.add_blank_page(612, 792)
    b = io.BytesIO()
    w.write(b)
    return b.getvalue()


def test_analyze_rejects_pdf_without_text(monkeypatch):
    run = unittest.mock.Mock()
    monkeypatch.setattr(pipeline, "run_analysis_pipeline", run)
    r = client.post("/api/analyze",
                    files={"file": ("scan.pdf", _blank_pdf_bytes(), "application/pdf")},
                    data={"job_description": "Python dev"},
                    headers={"X-Groq-Api-Key": "gsk_x"})
    assert r.status_code == 422
    assert "No text" in r.json()["detail"]
    run.assert_not_called()


def test_analyze_rejects_corrupt_pdf(monkeypatch):
    run = unittest.mock.Mock()
    monkeypatch.setattr(pipeline, "run_analysis_pipeline", run)
    r = client.post("/api/analyze",
                    files={"file": ("cv.pdf", b"%PDF-1.4\ngarbage", "application/pdf")},
                    data={"job_description": "Python dev"},
                    headers={"X-Groq-Api-Key": "gsk_x"})
    assert r.status_code == 422
    run.assert_not_called()


def test_cover_letter_prompt_forbids_fabrication():
    p = pipeline.COVER_LETTER_SYSTEM_PROMPT.lower()
    assert "only" in p and "never invent" in p
    assert "{" not in pipeline.COVER_LETTER_SYSTEM_PROMPT  # no stray template vars


def test_batch_retry_keeps_outputs_from_first_attempt(monkeypatch):
    import asyncio
    monkeypatch.setattr(db, "get_resume", lambda i: {"id": i, "extracted_text": "cv"})
    monkeypatch.setattr(db, "get_saved_jobs", lambda: [{"id": 9, "description": "jd", "title": "t"}])
    stored = []
    monkeypatch.setattr(db, "update_job_analysis", lambda **kw: stored.append(kw))
    monkeypatch.setattr(asyncio, "sleep", unittest.mock.AsyncMock())
    rl = "Optimized resume generation failed: Groq rate limit reached (429); retry in a minute."
    results = iter([
        {"match_score": 50, "cover_letter": "Dear team", "optimized_resume_latex": "", "warnings": [rl]},
        {"match_score": 51, "cover_letter": "", "optimized_resume_latex": "\\documentclass{article}",
         "warnings": ["Cover letter generation failed: Groq rate limit reached (429); retry in a minute."]},
    ])
    monkeypatch.setattr(pipeline, "run_batch_pipeline", lambda **kw: next(results))
    client.post("/api/analyze-batch", json={"resume_id": 1, "groq_api_key": "gsk_x"})
    assert stored[0]["cover_letter"] == "Dear team"
    assert stored[0]["optimized_resume_latex"].startswith("\\documentclass")


def test_salary_range_treats_zero_as_undisclosed():
    from src.job_search import _salary_range
    assert _salary_range(0, 0, prefix="$") == ""
    assert _salary_range(None, "", prefix="$") == ""
    assert _salary_range(90000, 0, prefix="$") == "$90000"
    assert _salary_range(90000, 120000, prefix="$") == "$90000 - $120000"
