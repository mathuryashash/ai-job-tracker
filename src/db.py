import logging
import threading
from contextlib import contextmanager
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import ThreadedConnectionPool

from . import config, crypto

logging.basicConfig(level=getattr(logging, config.LOG_LEVEL))
logger = logging.getLogger(__name__)

try:
    from pgvector.psycopg2 import register_vector as _register_vector
    _pgvector_available = True
except ImportError:
    _pgvector_available = False

_REGISTERED_VECTOR = False
_pool: Optional[ThreadedConnectionPool] = None
_pool_lock = threading.Lock()


def _get_pool() -> ThreadedConnectionPool:
    """Lazily create a thread-safe connection pool."""
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is None:
            logger.info("Creating DB connection pool (min=%d, max=%d)",
                        config.DB_POOL_MIN, config.DB_POOL_MAX)
            _pool = ThreadedConnectionPool(
                minconn=config.DB_POOL_MIN,
                maxconn=config.DB_POOL_MAX,
                dsn=config.DATABASE_URL,
            )
    return _pool


@contextmanager
def get_connection():
    """Borrow a connection from the pool; auto-return on exit.

    Falls back to a fresh psycopg2 connection if the pool can't be reached
    (e.g. DB down at startup, or WSL IP substitution needed).
    """
    pool = None
    try:
        pool = _get_pool()
        conn = pool.getconn()
    except Exception as exc:
        logger.warning("Pool unavailable, falling back to direct connect: %s", exc)
        conn = psycopg2.connect(config.DATABASE_URL)
        yield conn
        conn.close()
        return

    try:
        yield conn
    finally:
        try:
            pool.putconn(conn)
        except Exception as exc:
            logger.warning("Failed to return connection to pool: %s", exc)


def init_db():
    """Initialise the database. pgvector is optional — tables degrade gracefully."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
                conn.commit()
                if _pgvector_available:
                    _register_vector(conn)
                logger.info("pgvector extension enabled.")
            except Exception as e:
                conn.rollback()
                globals()["_pgvector_available"] = False
                logger.warning("pgvector not available — embeddings disabled: %s", e)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS resumes (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(255) NOT NULL,
                    extracted_text TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            if _pgvector_available:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS resume_embeddings (
                        id SERIAL PRIMARY KEY,
                        resume_id INTEGER REFERENCES resumes(id) ON DELETE CASCADE,
                        embedding vector(384) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS job_applications (
                    id SERIAL PRIMARY KEY,
                    company_name VARCHAR(255) NOT NULL,
                    position_title VARCHAR(255) NOT NULL,
                    job_description TEXT,
                    status VARCHAR(50) DEFAULT 'todo',
                    resume_id INTEGER REFERENCES resumes(id) ON DELETE SET NULL,
                    cover_letter TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS user_config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS saved_jobs (
                    id SERIAL PRIMARY KEY,
                    title TEXT,
                    company TEXT,
                    location TEXT,
                    description TEXT,
                    url TEXT UNIQUE,
                    platform TEXT,
                    employment_type TEXT,
                    salary TEXT,
                    posted_date TEXT,
                    ats_score FLOAT,
                    missing_keywords TEXT[],
                    cover_letter TEXT,
                    optimized_resume TEXT,
                    optimized_resume_latex TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cur.execute("""
                ALTER TABLE saved_jobs
                ADD COLUMN IF NOT EXISTS optimized_resume_latex TEXT;
            """)

            conn.commit()
            logger.info("Database initialized successfully.")


# ── Resumes ──────────────────────────────────────────────────────────────────

def save_resume(filename: str, text: str) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO resumes (filename, extracted_text) VALUES (%s, %s) RETURNING id;",
                (filename, text),
            )
            resume_id = cur.fetchone()[0]
            conn.commit()
            return resume_id


def save_resume_embedding(resume_id: int, embedding) -> None:
    global _REGISTERED_VECTOR
    if not _pgvector_available:
        logger.info("pgvector unavailable — skipping embedding storage")
        return
    with get_connection() as conn:
        if not _REGISTERED_VECTOR:
            _register_vector(conn)
            _REGISTERED_VECTOR = True
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO resume_embeddings (resume_id, embedding) VALUES (%s, %s);",
                (resume_id, embedding),
            )
            conn.commit()
            logger.info("Saved embedding for resume %s", resume_id)


def get_resume(resume_id: int):
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM resumes WHERE id = %s;", (resume_id,))
            return cur.fetchone()


def get_resume_embedding(resume_id: int):
    """Retrieve cached resume embedding. Returns None if not found or pgvector unavailable."""
    if not _pgvector_available:
        return None
    with get_connection() as conn:
        _register_vector(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT embedding FROM resume_embeddings WHERE resume_id = %s LIMIT 1;", (resume_id,))
            row = cur.fetchone()
            if row and row[0] is not None:
                return list(row[0])
            return None


def search_resumes_by_embedding(query_embedding, limit: int = 5):
    if not _pgvector_available:
        return []
    with get_connection() as conn:
        _register_vector(conn)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT r.id, r.filename, r.extracted_text,
                       (1 - (re.embedding <=> %s)) AS similarity_score
                FROM resume_embeddings re
                JOIN resumes r ON re.resume_id = r.id
                ORDER BY similarity_score DESC
                LIMIT %s;
            """, (query_embedding, limit))
            return cur.fetchall()


# ── Job applications ────────────────────────────────────────────────────────

def save_job_application(company_name: str, position_title: str,
                          job_description: str = None, status: str = 'todo',
                          resume_id: int = None, cover_letter: str = None) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO job_applications (company_name, position_title, job_description, status, resume_id, cover_letter)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;
            """, (company_name, position_title, job_description, status, resume_id, cover_letter))
            app_id = cur.fetchone()[0]
            conn.commit()
            return app_id


def get_job_applications():
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM job_applications ORDER BY created_at DESC;")
            return cur.fetchall()


def update_job_application_status(app_id: int, status: str) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE job_applications SET status = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s;",
                (status, app_id),
            )
            conn.commit()
            if cur.rowcount == 0:
                raise ValueError(f"Application {app_id} not found")


def delete_job_application(app_id: int) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM job_applications WHERE id = %s;", (app_id,))
            conn.commit()
            if cur.rowcount == 0:
                raise ValueError(f"Application {app_id} not found")


# ── User config (encrypted secrets) ─────────────────────────────────────────

def save_config(key: str, value: str) -> None:
    """Save a config value. Secrets (groq_api_key, apify_token, tinyfish_api_key)
    are encrypted at rest when FERNET_KEY is set."""
    stored = crypto.encrypt(value) if _is_secret(key) else value
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_config (key, value, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value,
                        updated_at = CURRENT_TIMESTAMP;
            """, (key, stored))
            conn.commit()


def get_config(key: str) -> Optional[str]:
    """Get a config value. Secrets are decrypted automatically."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM user_config WHERE key = %s;", (key,))
            row = cur.fetchone()
            if not row:
                return None
            value = row[0]
            if _is_secret(key):
                return crypto.decrypt(value)
            return value


_SECRET_KEYS = frozenset({"groq_api_key", "apify_token", "tinyfish_api_key"})


def _is_secret(key: str) -> bool:
    return key in _SECRET_KEYS


# ── Saved jobs ───────────────────────────────────────────────────────────────

def save_jobs(jobs: list) -> int:
    """Insert scraped jobs, skip duplicates by URL. Returns count of new rows."""
    with get_connection() as conn:
        saved = 0
        with conn.cursor() as cur:
            for job in jobs:
                cur.execute("""
                    INSERT INTO saved_jobs (title, company, location, description, url, platform, employment_type, salary, posted_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (url) DO NOTHING;
                """, (
                    job.get("title"), job.get("company"), job.get("location"),
                    job.get("description"), job.get("url"), job.get("platform"),
                    job.get("employment_type", ""), job.get("salary", ""),
                    job.get("posted_date", ""),
                ))
                if cur.rowcount:
                    saved += 1
        conn.commit()
        return saved


def get_saved_jobs() -> list:
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, title, company, location, description, url, platform,
                       employment_type, salary, posted_date,
                       ats_score, missing_keywords, cover_letter, optimized_resume,
                       optimized_resume_latex, created_at
                FROM saved_jobs
                ORDER BY created_at DESC;
            """)
            return [dict(row) for row in cur.fetchall()]


def update_job_analysis(job_id: int, ats_score: float, missing_keywords: list,
                        cover_letter: str, optimized_resume: str,
                        optimized_resume_latex: str = "") -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE saved_jobs
                SET ats_score = %s,
                    missing_keywords = %s,
                    cover_letter = %s,
                    optimized_resume = %s,
                    optimized_resume_latex = %s
                WHERE id = %s;
            """, (ats_score, missing_keywords, cover_letter, optimized_resume,
                  optimized_resume_latex, job_id))
            conn.commit()


def close_pool() -> None:
    """Close all pooled connections (call at shutdown)."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None
