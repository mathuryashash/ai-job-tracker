"""Centralised application configuration.

Single source of truth for defaults, env-var wiring, and runtime feature flags.
"""
from __future__ import annotations

import os
from typing import List


def _split_csv(value: str, default: List[str]) -> List[str]:
    if not value:
        return default
    return [v.strip() for v in value.split(",") if v.strip()]


# ── LLM ──────────────────────────────────────────────────────────────────────
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
# Default model — must exist on Groq and support tool-free JSON output.
# Override via env var. Used by pipeline.py and main.py.
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
LLM_TIMEOUT_SECONDS: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "30"))

# ── HTTP / Server ────────────────────────────────────────────────────────────
BACKEND_HOST: str = os.getenv("BACKEND_HOST", "0.0.0.0")
BACKEND_PORT: int = int(os.getenv("BACKEND_PORT", "8000"))

# CORS: explicit allowlist. "*" disables credentials and is rejected in prod.
_raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_ORIGINS: List[str] = _split_csv(_raw_origins, ["http://localhost:5173"])
CORS_ALLOW_CREDENTIALS: bool = "*" not in CORS_ORIGINS

# ── Uploads ──────────────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))

# ── Database ─────────────────────────────────────────────────────────────────
# Sensible local-dev default; production deployments MUST set DATABASE_URL
# explicitly via environment. The pool itself will fail fast at first query
# if the URL is wrong, surfacing the misconfig in logs.
DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/resume_tracker")
DB_POOL_MIN: int = int(os.getenv("DB_POOL_MIN", "1"))
DB_POOL_MAX: int = int(os.getenv("DB_POOL_MAX", "10"))

# ── Secret encryption ────────────────────────────────────────────────────────
# Fernet key for encrypting user_config values at rest.
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# If unset, encryption is disabled and values are stored plaintext (dev only).
FERNET_KEY: str = os.getenv("FERNET_KEY", "")

# ── Job search integrations ──────────────────────────────────────────────────
APIFY_TOKEN: str = os.getenv("APIFY_TOKEN", "")
TINYFISH_API_KEY: str = os.getenv("TINYFISH_API_KEY", "")

# USAJOBS requires the User-Agent to contain a real contact email.
# https://developer.usajobs.gov/APIRequest/
USAJOBS_EMAIL: str = os.getenv("USAJOBS_EMAIL", "contact@example.com")
USAJOBS_USER_AGENT: str = os.getenv(
    "USAJOBS_USER_AGENT",
    f"AI-Resume-Job-Tracker/1.0 ({USAJOBS_EMAIL})",
)

# ── Logging ──────────────────────────────────────────────────────────────────
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
