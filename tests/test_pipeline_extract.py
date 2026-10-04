"""Tests for extract_company_and_role helper."""
from src import pipeline


def test_extract_company_from_labelled_jd():
    jd = """Role: Senior Backend Engineer
Company: Acme Corp
Location: Remote

About the role:
We are looking for..."""
    company, role = pipeline._extract_company_and_role(jd)
    assert "Acme Corp" in company
    assert "Senior Backend Engineer" in role


def test_extract_role_from_first_line():
    jd = """Senior Python Developer
Remote | Full-time

We're hiring..."""
    company, role = pipeline._extract_company_and_role(jd)
    assert "Senior Python Developer" in role


def test_fallback_to_placeholders():
    jd = "Some random job description with no labels."
    company, role = pipeline._extract_company_and_role(jd)
    assert company == "Analyzed Target"
    assert role == "Matched Role"


def test_empty_jd_returns_placeholders():
    company, role = pipeline._extract_company_and_role("")
    assert company == "Analyzed Target"
    assert role == "Matched Role"


def test_heuristic_candidate_name_returns_first_line():
    """Regression test: _heuristic_candidate_name used to reference an
    undefined name (resume_text instead of text). This test would have
    raised NameError on the old buggy code."""
    assert pipeline._heuristic_candidate_name("") is None
    assert pipeline._heuristic_candidate_name(None) is None  # type: ignore[arg-type]
    assert pipeline._heuristic_candidate_name("John Smith\nEngineer") == "John Smith"
    # Skip lines that look like header markers.
    assert pipeline._heuristic_candidate_name("Resume\nJohn Smith\nEngineer") == "John Smith"
    # Single word is not a name.
    assert pipeline._heuristic_candidate_name("hello\nworld") is None
