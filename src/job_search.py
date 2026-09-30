"""Automated job search across free and paid providers.

Active providers (always wired in): RemoteOK, USAJOBS.
Optional providers (only when API key configured): JSearch, Adzuna.

Dead-code removal: the Playwright scraper was unreachable from the FastAPI
route (deadlock detection prevents asyncio.run inside an event loop). The
classes are removed and Apify/Tinyfish integration is intentionally not
re-implemented — only providers that the orchestrator actually calls remain.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Dict, List, Optional

import requests

from . import config

logger = logging.getLogger(__name__)


# ── Searchers ────────────────────────────────────────────────────────────────

class JSearchAPISearcher:
    """JSearch via RapidAPI. Free tier available."""

    BASE_URL = "https://jsearch.p.rapidapi.com"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "X-RapidAPI-Key": api_key,
            "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
        }

    def search(self, query: str, location: str = "", limit: int = 20) -> List[Dict]:
        try:
            params = {
                "query": f"{query} {location}".strip(),
                "page": "1",
                "num_pages": "1",
                "date_posted": "all",
            }
            if location:
                params["location"] = location
            resp = requests.get(
                f"{self.BASE_URL}/search", headers=self.headers,
                params=params, timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            jobs = data.get("data", []) or []
            return [self._normalize(j) for j in jobs[:limit]]
        except Exception as exc:
            logger.error("JSearch search error: %s", exc)
            return []

    @staticmethod
    def _normalize(item: dict) -> dict:
        city = item.get("job_city", "") or ""
        state = item.get("job_state", "") or ""
        country = item.get("job_country", "") or ""
        loc = ", ".join(p for p in (city, state, country) if p)
        return {
            "title": item.get("job_title", "Unknown Position"),
            "company": item.get("employer_name", "Unknown Company"),
            "location": loc,
            "description": (item.get("job_description", "") or "")[:2000],
            "url": item.get("job_apply_link") or item.get("job_google_link") or "",
            "posted_date": item.get("job_posted_at_datetime_utc", ""),
            "employment_type": item.get("job_employment_type", "") or "",
            "salary": _salary_range(item.get("job_min_salary"), item.get("job_max_salary")),
            "platform": "JSearch",
            "logo": item.get("employer_logo", ""),
        }


class AdzunaAPISearcher:
    """Adzuna job search. Free tier available."""

    BASE_URL = "https://api.adzuna.com/v1/api/jobs"

    def __init__(self, app_id: str, api_key: str):
        self.app_id = app_id
        self.api_key = api_key

    def search(self, query: str, location: str = "", limit: int = 20) -> List[Dict]:
        try:
            params = {
                "app_id": self.app_id, "app_key": self.api_key,
                "results_per_page": min(limit, 50), "what": query,
                "where": location, "content-type": "application/json",
            }
            resp = requests.get(
                f"{self.BASE_URL}/us/search/1", params=params, timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            jobs = data.get("results", []) or []
            return [self._normalize(j) for j in jobs[:limit]]
        except Exception as exc:
            logger.error("Adzuna search error: %s", exc)
            return []

    @staticmethod
    def _normalize(item: dict) -> dict:
        return {
            "title": item.get("title", "Unknown Position"),
            "company": (item.get("company") or {}).get("display_name", "Unknown Company"),
            "location": (item.get("location") or {}).get("display_name", ""),
            "description": (item.get("description", "") or "")[:2000],
            "url": item.get("redirect_url", ""),
            "posted_date": item.get("created", ""),
            "employment_type": item.get("contract_type", "") or "",
            "salary": _salary_range(item.get("salary_min"), item.get("salary_max")),
            "platform": "Adzuna",
            "logo": "",
        }


class USAJOBSAPISearcher:
    """USAJOBS federal job search. Free, but every request needs an
    Authorization-Key (free API key) plus the registered email as User-Agent —
    see https://developer.usajobs.gov/guides/authentication. Without the key
    the API answers 401."""

    BASE_URL = "https://data.usajobs.gov/api/search"

    def __init__(self, api_key: str, user_agent: Optional[str] = None):
        self.headers = {
            "User-Agent": user_agent or config.USAJOBS_USER_AGENT,
            "Authorization-Key": api_key,
            "Accept": "application/json",
        }

    def search(self, query: str, location: str = "", limit: int = 20) -> List[Dict]:
        try:
            params = {
                "Keyword": query,
                "LocationName": location or "United States",
                "ResultsPerPage": min(limit, 50),
                "Page": 1,
            }
            resp = requests.get(
                self.BASE_URL, headers=self.headers, params=params, timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            jobs = (data.get("SearchResult") or {}).get("SearchResultItems", []) or []
            return [self._normalize(j) for j in jobs[:limit]]
        except Exception as exc:
            logger.error("USAJOBS search error: %s", exc)
            return []

    @staticmethod
    def _normalize(item: dict) -> dict:
        desc = item.get("MatchedObjectDescriptor", {}) or {}
        salary = ""
        rem = (desc.get("PositionRemuneration") or [{}])
        if rem:
            mn = rem[0].get("MinimumRange", "")
            mx = rem[0].get("MaximumRange", "")
            if mn or mx:
                salary = f"{mn} - {mx}"
        return {
            "title": desc.get("PositionTitle", "Unknown Position"),
            "company": desc.get("OrganizationName", "Unknown Company"),
            "location": desc.get("PositionLocationDisplay", ""),
            "description": (desc.get("UserArea", {}).get("Details", {}).get("JobSummary", "") or "")[:2000],
            "url": desc.get("PositionURI", ""),
            "posted_date": desc.get("PublicationStartDate", ""),
            "employment_type": (desc.get("PositionSchedule") or {}).get("Name", ""),
            "salary": salary,
            "platform": "USAJOBS",
            "logo": "",
        }


class RemoteOKSearcher:
    """RemoteOK free public JSON feed."""

    BASE_URL = "https://remoteok.io/api"

    def search(self, query: str = "", location: str = "", limit: int = 20) -> List[Dict]:
        try:
            resp = requests.get(self.BASE_URL, timeout=30)
            resp.raise_for_status()
            jobs = resp.json() or []
            if isinstance(jobs, list) and jobs and isinstance(jobs[0], dict) and "slug" not in jobs[0]:
                jobs = jobs[1:]
            query_lower = (query or "").lower().strip()
            query_words = [w for w in query_lower.split() if len(w) > 2]
            filtered = []
            for job in jobs:
                if not isinstance(job, dict):
                    continue
                haystack = f"{job.get('position','')} {' '.join(job.get('tags', []) or [])} {(job.get('description','') or '')[:500]}".lower()
                if not query_lower or query_lower in haystack or any(w in haystack for w in query_words):
                    filtered.append(job)
                if len(filtered) >= limit:
                    break
            return [self._normalize(j) for j in filtered[:limit]]
        except Exception as exc:
            logger.error("RemoteOK search error: %s", exc)
            return []

    @staticmethod
    def _normalize(item: dict) -> dict:
        loc = item.get("location", "")
        return {
            "title": item.get("position", "Unknown Position"),
            "company": item.get("company", "Unknown Company"),
            "location": "Remote" + (f", {loc}" if loc else ""),
            "description": (item.get("description", "") or "")[:2000],
            "url": item.get("url", ""),
            "posted_date": item.get("date", ""),
            "employment_type": item.get("contract", "") or "",
            "salary": _salary_range(item.get("salary_min"), item.get("salary_max"), prefix="$"),
            "platform": "RemoteOK",
            "logo": item.get("company_logo", ""),
        }


def _salary_range(mn, mx, prefix: str = "") -> str:
    mn_s = f"{prefix}{mn}" if mn not in (None, "") else ""
    mx_s = f"{prefix}{mx}" if mx not in (None, "") else ""
    if mn_s or mx_s:
        return f"{mn_s} - {mx_s}".strip(" -")
    return ""


# ── Orchestrator ─────────────────────────────────────────────────────────────

def _search_sync_free(query: str, location: str, platforms: List[str],
                      limit: int, api_keys: Dict[str, str]) -> Dict:
    """Synchronous free-API search. Safe to call inside a running event loop."""
    all_jobs: List[Dict] = []
    sources_used: List[str] = []

    if "remoteok" in platforms:
        try:
            jobs = RemoteOKSearcher().search(query, location, limit)
            all_jobs.extend(jobs)
            if jobs:
                sources_used.append("RemoteOK")
        except Exception as e:
            logger.warning("RemoteOK failed: %s", e)

    if "usajobs" in platforms and api_keys.get("usajobs_key"):
        try:
            jobs = USAJOBSAPISearcher(api_keys["usajobs_key"]).search(query, location, limit)
            all_jobs.extend(jobs)
            if jobs:
                sources_used.append("USAJOBS")
        except Exception as e:
            logger.warning("USAJOBS failed: %s", e)

    if "jsearch" in platforms and api_keys.get("jsearch_key"):
        try:
            jobs = JSearchAPISearcher(api_keys["jsearch_key"]).search(query, location, limit)
            all_jobs.extend(jobs)
            if jobs:
                sources_used.append("JSearch")
        except Exception as e:
            logger.warning("JSearch failed: %s", e)

    if "adzuna" in platforms and api_keys.get("adzuna_app_id") and api_keys.get("adzuna_key"):
        try:
            jobs = AdzunaAPISearcher(api_keys["adzuna_app_id"], api_keys["adzuna_key"]).search(query, location, limit)
            all_jobs.extend(jobs)
            if jobs:
                sources_used.append("Adzuna")
        except Exception as e:
            logger.warning("Adzuna failed: %s", e)

    return _dedupe_and_rank(all_jobs, query, limit, sources_used)


def _dedupe_and_rank(jobs: List[Dict], query: str, limit: int, sources: List[str]) -> Dict:
    q_words = [w for w in query.lower().split() if len(w) > 2] if query else []
    seen: set = set()
    scored: List[tuple] = []
    for job in jobs:
        url = job.get("url", "") or ""
        if url and url in seen:
            continue
        if url:
            seen.add(url)
        if q_words:
            hay = f"{job.get('title','')} {job.get('description','')} {job.get('company','')}".lower()
            s = sum(1 for w in q_words if w in hay)
            if s == 0:
                continue
        else:
            s = 1
        scored.append((s, job))
    scored.sort(key=lambda x: x[0], reverse=True)
    unique = [j for _, j in scored]
    return {"jobs": unique[:limit], "total": len(unique), "sources": sources, "errors": []}


def search_jobs_unified(query: str, location: str = "",
                         platforms: Optional[List[str]] = None,
                         limit: int = 20,
                         apify_token: Optional[str] = None,
                         tinyfish_key: Optional[str] = None,
                         api_keys: Optional[Dict[str, str]] = None,
                         jsearch_key: Optional[str] = None,
                         adzuna_app_id: Optional[str] = None,
                         adzuna_key: Optional[str] = None,
                         usajobs_key: Optional[str] = None) -> Dict:
    """Unified job search — free APIs first, optional paid providers when keys set.

    Returns: {jobs, total, sources, errors}
    """
    if platforms is None:
        platforms = ["remoteok", "usajobs"]

    keys = dict(api_keys or {})
    if jsearch_key:
        keys["jsearch_key"] = jsearch_key
    if adzuna_app_id and adzuna_key:
        keys["adzuna_app_id"] = adzuna_app_id
        keys["adzuna_key"] = adzuna_key
    if usajobs_key:
        keys["usajobs_key"] = usajobs_key

    errors: List[str] = []

    if "usajobs" in platforms and not keys.get("usajobs_key"):
        errors.append("USAJOBS requires USAJOBS_API_KEY (free at developer.usajobs.gov); skipped.")

    # If user requests paid platforms without keys, fall back to free sources
    paid = {"linkedin", "indeed", "glassdoor"}
    if any(p in paid for p in platforms) and not apify_token:
        errors.append(
            "LinkedIn/Indeed/Glassdoor require an Apify token. Falling back to free sources."
        )
        platforms = [p for p in platforms if p not in paid]
        if not platforms:
            platforms = ["remoteok", "usajobs"]

    # Always run sync (safe inside FastAPI event loop). Playwright async path
    # is intentionally not exposed — would deadlock the event loop.
    try:
        result = _search_sync_free(query, location, platforms, limit, keys)
    except Exception as exc:
        logger.error("Job search failed: %s", exc)
        return {"jobs": [], "total": 0, "sources": [], "errors": [str(exc)]}

    result["errors"] = errors + result.get("errors", [])
    if not result["jobs"] and not result["errors"]:
        result["errors"] = ["No jobs found. Try broader keywords or different location."]
    return result
