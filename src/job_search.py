"""
Automated Job Search Module
Integrates Apify (LinkedIn, Indeed, Glassdoor) and Tinyfish job search APIs.
"""
import os
import logging
import requests
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


class ApifyJobSearcher:
    """Search jobs via Apify actors (LinkedIn, Indeed, Glassdoor)."""

    BASE_URL = "https://api.apify.com/v2"

    # Apify actor slugs for each platform
    ACTORS = {
        "linkedin": "bebity/linkedin-jobs-scraper",
        "indeed": "misceres/indeed-scraper",
        "glassdoor": "webautomation-dev/glassdoor-jobs-scraper",
    }

    def __init__(self, api_token: str):
        self.api_token = api_token

    def search(
        self, query: str, location: str = "", platform: str = "linkedin", limit: int = 20
    ) -> List[Dict]:
        actor_id = self.ACTORS.get(platform, self.ACTORS["linkedin"])

        # Build actor-specific input payloads
        if platform == "linkedin":
            actor_input = {
                "searchQueries": [f"{query} {location}".strip()],
                "maxResults": limit,
                "contractType": "fulltime",
            }
        elif platform == "indeed":
            actor_input = {
                "position": query,
                "country": "US",
                "location": location or "Remote",
                "maxItems": limit,
            }
        else:
            actor_input = {
                "query": f"{query} {location}".strip(),
                "maxItems": limit,
            }

        url = f"{self.BASE_URL}/acts/{actor_id}/run-sync-get-dataset-items"
        try:
            resp = requests.post(
                url,
                json=actor_input,
                params={"token": self.api_token},
                timeout=90,
            )
            resp.raise_for_status()
            items = resp.json()
            return [self._normalize(item, platform) for item in items[:limit]]
        except requests.exceptions.Timeout:
            logger.warning("Apify request timed out for %s", platform)
            return []
        except Exception as exc:
            logger.error("Apify search error [%s]: %s", platform, exc)
            return []

    def _normalize(self, item: dict, platform: str) -> dict:
        """Normalize platform-specific fields into a unified job dict."""
        if platform == "linkedin":
            return {
                "title": item.get("title", "Unknown Position"),
                "company": item.get("companyName", "Unknown Company"),
                "location": item.get("location", ""),
                "description": item.get("descriptionText", ""),
                "url": item.get("applyUrl") or item.get("url", ""),
                "posted_date": item.get("postedAt", ""),
                "employment_type": item.get("employmentType", ""),
                "salary": item.get("salary", ""),
                "platform": "LinkedIn",
                "logo": item.get("companyLogo", ""),
            }
        elif platform == "indeed":
            return {
                "title": item.get("positionName", "Unknown Position"),
                "company": item.get("company", "Unknown Company"),
                "location": item.get("location", ""),
                "description": item.get("description", ""),
                "url": item.get("url", ""),
                "posted_date": item.get("date", ""),
                "employment_type": item.get("jobType", ""),
                "salary": item.get("salary", ""),
                "platform": "Indeed",
                "logo": "",
            }
        else:
            return {
                "title": item.get("title", item.get("jobTitle", "Unknown Position")),
                "company": item.get("company", item.get("companyName", "Unknown Company")),
                "location": item.get("location", ""),
                "description": item.get("description", item.get("jobDescription", "")),
                "url": item.get("url", item.get("jobUrl", "")),
                "posted_date": item.get("date", item.get("postedAt", "")),
                "employment_type": "",
                "salary": item.get("salary", ""),
                "platform": platform.capitalize(),
                "logo": "",
            }


class TinyfishJobSearcher:
    """Search jobs via Tinyfish API (tinyfish.io)."""

    BASE_URL = "https://api.tinyfish.io/v1"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def search(self, query: str, location: str = "", limit: int = 20) -> List[Dict]:
        try:
            resp = requests.post(
                f"{self.BASE_URL}/jobs/search",
                json={"query": query, "location": location, "limit": limit},
                headers=self.headers,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            jobs = data.get("jobs", data.get("results", []))
            return [self._normalize(j) for j in jobs[:limit]]
        except Exception as exc:
            logger.error("Tinyfish search error: %s", exc)
            return []

    def _normalize(self, item: dict) -> dict:
        return {
            "title": item.get("title", "Unknown Position"),
            "company": item.get("company", "Unknown Company"),
            "location": item.get("location", ""),
            "description": item.get("description", ""),
            "url": item.get("url", item.get("apply_url", "")),
            "posted_date": item.get("posted_at", item.get("date", "")),
            "employment_type": item.get("type", ""),
            "salary": item.get("salary", item.get("compensation", "")),
            "platform": "Tinyfish",
            "logo": "",
        }


def search_jobs_unified(
    query: str,
    location: str = "",
    platforms: List[str] = None,
    limit: int = 20,
    apify_token: Optional[str] = None,
    tinyfish_key: Optional[str] = None,
) -> Dict:
    """
    Aggregate job search results from all configured platforms.
    Falls back gracefully when API keys are missing.
    """
    if platforms is None:
        platforms = ["linkedin", "indeed"]

    all_jobs: List[Dict] = []
    errors: List[str] = []
    sources_used: List[str] = []

    apify_platforms = [p for p in platforms if p in ("linkedin", "indeed", "glassdoor")]
    if apify_token and apify_platforms:
        searcher = ApifyJobSearcher(apify_token)
        per_platform = max(1, limit // len(apify_platforms))
        for platform in apify_platforms:
            jobs = searcher.search(query, location, platform, per_platform)
            all_jobs.extend(jobs)
            if jobs:
                sources_used.append(platform.capitalize())
    elif apify_platforms:
        errors.append("APIFY_TOKEN not configured — LinkedIn/Indeed/Glassdoor search skipped.")

    if "tinyfish" in platforms:
        if tinyfish_key:
            searcher = TinyfishJobSearcher(tinyfish_key)
            jobs = searcher.search(query, location, limit)
            all_jobs.extend(jobs)
            if jobs:
                sources_used.append("Tinyfish")
        else:
            errors.append("TINYFISH_API_KEY not configured — Tinyfish search skipped.")

    # Deduplicate by URL
    seen_urls: set = set()
    unique_jobs: List[Dict] = []
    for job in all_jobs:
        url = job.get("url", "")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        unique_jobs.append(job)

    return {
        "jobs": unique_jobs[:limit],
        "total": len(unique_jobs),
        "sources": sources_used,
        "errors": errors,
    }
