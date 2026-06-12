import os
import psycopg2
from psycopg2.extras import RealDictCursor
from pgvector.psycopg2 import register_vector
import logging

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import subprocess
import urllib.parse

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5434/resume_tracker")

def get_connection():
    """
    Establishes and returns a database connection.
    """
    url = DATABASE_URL
    # If using localhost/127.0.0.1 and we have wsl_ip.txt, resolve to WSL IP to avoid flaky port-forwarding issues
    if "127.0.0.1" in url or "localhost" in url:
        try:
            # Check if wsl_ip.txt exists in the workspace
            wsl_ip_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "wsl_ip.txt")
            if os.path.exists(wsl_ip_path):
                with open(wsl_ip_path, "r") as f:
                    wsl_ip = f.read().strip()
                if wsl_ip:
                    url = url.replace("127.0.0.1", wsl_ip).replace("localhost", wsl_ip)
                    logger.info(f"WSL IP resolved from wsl_ip.txt: {wsl_ip}. Using URL: {url}")
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
    Initializes the database: enables pgvector and creates necessary tables.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            # 1. Enable pgvector extension
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            conn.commit()
            
            # Register pgvector for this connection
            register_vector(conn)
            
            # 2. Create Resumes table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS resumes (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(255) NOT NULL,
                    extracted_text TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            
            # 3. Create Resume Embeddings table
            # Using 384 dimensions for sentence-transformers 'all-MiniLM-L6-v2' model
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
    conn = get_connection()
    try:
        # Register pgvector
        register_vector(conn)
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
        raise
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
    """
    Uses pgvector cosine distance (<=> operator) to find matching resumes.
    1 - (embedding <=> query_embedding) gives the cosine similarity.
    """
    conn = get_connection()
    try:
        register_vector(conn)
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
