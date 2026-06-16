import os
import psycopg2
from psycopg2.extras import RealDictCursor
import logging

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# pgvector is optional — only available when the extension is installed
_pgvector_available = False
try:
    from pgvector.psycopg2 import register_vector as _register_vector
    _pgvector_available = True
except ImportError:
    pass

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/resume_tracker")

def get_connection():
    """Establishes and returns a database connection."""
    url = DATABASE_URL
    # BOM-safe WSL IP substitution: use utf-8-sig to strip BOM characters
    if "127.0.0.1" in url or "localhost" in url:
        try:
            wsl_ip_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "wsl_ip.txt")
            if os.path.exists(wsl_ip_path):
                with open(wsl_ip_path, "r", encoding="utf-8-sig") as f:
                    wsl_ip = f.read().strip()
                # Only substitute if the WSL IP is reachable (skip on native Windows Postgres)
                if wsl_ip and wsl_ip != "127.0.0.1":
                    import socket
                    try:
                        socket.setdefaulttimeout(0.5)
                        socket.socket().connect((wsl_ip, 5432))
                        url = url.replace("127.0.0.1", wsl_ip).replace("localhost", wsl_ip)
                        logger.info(f"WSL IP active, using: {wsl_ip}")
                    except OSError:
                        logger.info("WSL IP unreachable, using localhost PostgreSQL")
        except Exception as e:
            logger.warning(f"Failed to read wsl_ip.txt: {e}")

    try:
        logger.info(f"psycopg2 connecting to: {url}")
        conn = psycopg2.connect(url)
        return conn
    except Exception as e:
        # Fallback to the original URL if substitution failed
        if url != DATABASE_URL:
            try:
                logger.info(f"Retrying connection with original URL: {DATABASE_URL}")
                return psycopg2.connect(DATABASE_URL)
            except Exception as original_err:
                logger.error(f"Failed to connect to the database with fallback: {original_err}")
        logger.error(f"Failed to connect to the database: {e}")
        import traceback
        traceback.print_exc()
        raise

def init_db():
    """
    Initializes the database. pgvector is optional — tables degrade gracefully without it.
    """
    global _pgvector_available
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # 1. Try to enable pgvector extension (non-fatal if not installed)
            try:
                cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
                conn.commit()
                if _pgvector_available:
                    _register_vector(conn)
                logger.info("pgvector extension enabled.")
            except Exception as e:
                conn.rollback()
                _pgvector_available = False
                logger.warning(f"pgvector not available — embeddings disabled: {e}")

            # 2. Create Resumes table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS resumes (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(255) NOT NULL,
                    extracted_text TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # 3. Create Resume Embeddings table only if pgvector is available
            if _pgvector_available:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS resume_embeddings (
                        id SERIAL PRIMARY KEY,
                        resume_id INTEGER REFERENCES resumes(id) ON DELETE CASCADE,
                        embedding vector(384) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                """)
            
            # 4. Create Job Applications table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS job_applications (
                    id SERIAL PRIMARY KEY,
                    company_name VARCHAR(255) NOT NULL,
                    position_title VARCHAR(255) NOT NULL,
                    job_description TEXT,
                    status VARCHAR(50) DEFAULT 'todo', -- 'todo', 'applied', 'interviewing', 'offer', 'rejected'
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

            # 5. Saved Jobs table (for scraped jobs from job search)
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
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)

            conn.commit()
            logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

# --- Database Helper Functions ---

def save_resume(filename: str, text: str) -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO resumes (filename, extracted_text) VALUES (%s, %s) RETURNING id;",
                (filename, text)
            )
            resume_id = cur.fetchone()[0]
            conn.commit()
            return resume_id
    except Exception as e:
        conn.rollback()
        logger.error(f"Error saving resume: {e}")
        raise
    finally:
        conn.close()

def save_resume_embedding(resume_id: int, embedding) -> None:
    if not _pgvector_available:
        logger.info("pgvector unavailable — skipping embedding storage")
        return
    conn = get_connection()
    try:
        _register_vector(conn)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO resume_embeddings (resume_id, embedding) VALUES (%s, %s);",
                (resume_id, embedding)
            )
            conn.commit()
            logger.info(f"Saved embedding for resume {resume_id}")
    except Exception as e:
        conn.rollback()
        logger.error(f"Error saving resume embedding: {e}")
    finally:
        conn.close()

def get_resume(resume_id: int):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM resumes WHERE id = %s;", (resume_id,))
            return cur.fetchone()
    except Exception as e:
        logger.error(f"Error fetching resume: {e}")
        raise
    finally:
        conn.close()

def search_resumes_by_embedding(query_embedding, limit: int = 5):
    """Uses pgvector cosine distance to find matching resumes. Returns [] if pgvector unavailable."""
    if not _pgvector_available:
        return []
    conn = get_connection()
    try:
        _register_vector(conn)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    r.id, 
                    r.filename, 
                    r.extracted_text,
                    (1 - (re.embedding <=> %s)) as similarity_score
                FROM resume_embeddings re
                JOIN resumes r ON re.resume_id = r.id
                ORDER BY similarity_score DESC
                LIMIT %s;
            """, (query_embedding, limit))
            return cur.fetchall()
    except Exception as e:
        logger.error(f"Error searching resumes by embedding: {e}")
        raise
    finally:
        conn.close()

def save_job_application(company_name: str, position_title: str, job_description: str = None, status: str = 'todo', resume_id: int = None, cover_letter: str = None) -> int:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO job_applications (company_name, position_title, job_description, status, resume_id, cover_letter)
                VALUES (%s, %s, %s, %s, %s, %s) RETURNING id;
            """, (company_name, position_title, job_description, status, resume_id, cover_letter))
            app_id = cur.fetchone()[0]
            conn.commit()
            return app_id
    except Exception as e:
        conn.rollback()
        logger.error(f"Error saving job application: {e}")
        raise
    finally:
        conn.close()

def get_job_applications():
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM job_applications ORDER BY created_at DESC;")
            return cur.fetchall()
    except Exception as e:
        logger.error(f"Error fetching job applications: {e}")
        raise
    finally:
        conn.close()

def update_job_application_status(app_id: int, status: str) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE job_applications 
                SET status = %s, updated_at = CURRENT_TIMESTAMP 
                WHERE id = %s;
            """, (status, app_id))
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating job application status: {e}")
        raise
    finally:
        conn.close()

def delete_job_application(app_id: int) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM job_applications WHERE id = %s;", (app_id,))
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error deleting job application: {e}")
        raise
    finally:
        conn.close()

def save_config(key: str, value: str) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_config (key, value, updated_at)
                VALUES (%s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value,
                        updated_at = CURRENT_TIMESTAMP;
            """, (key, value))
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error saving config key={key}: {e}")
        raise
    finally:
        conn.close()

def get_config(key: str) -> str | None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM user_config WHERE key = %s;", (key,))
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.error(f"Error getting config key={key}: {e}")
        return None
    finally:
        conn.close()

def save_jobs(jobs: list) -> int:
    """Insert scraped jobs, skip duplicates by URL. Returns count of newly inserted rows."""
    conn = get_connection()
    saved = 0
    try:
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
                    job.get("posted_date", "")
                ))
                if cur.rowcount:
                    saved += 1
        conn.commit()
        return saved
    except Exception as e:
        conn.rollback()
        logger.error(f"Error saving jobs: {e}")
        raise
    finally:
        conn.close()

def get_saved_jobs() -> list:
    """Return all saved jobs ordered by created_at desc."""
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT id, title, company, location, description, url, platform,
                       employment_type, salary, posted_date,
                       ats_score, missing_keywords, cover_letter, optimized_resume,
                       created_at
                FROM saved_jobs
                ORDER BY created_at DESC;
            """)
            return [dict(row) for row in cur.fetchall()]
    except Exception as e:
        logger.error(f"Error fetching saved jobs: {e}")
        raise
    finally:
        conn.close()

def update_job_analysis(job_id: int, ats_score: float, missing_keywords: list,
                        cover_letter: str, optimized_resume: str) -> None:
    """Update a saved job row with pipeline analysis results."""
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE saved_jobs
                SET ats_score = %s,
                    missing_keywords = %s,
                    cover_letter = %s,
                    optimized_resume = %s
                WHERE id = %s;
            """, (ats_score, missing_keywords, cover_letter, optimized_resume, job_id))
            conn.commit()
    except Exception as e:
        conn.rollback()
        logger.error(f"Error updating job analysis id={job_id}: {e}")
        raise
    finally:
        conn.close()
