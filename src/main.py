"""FastAPI backend for AI Resume & Job Tracker.

Endpoints:
  GET    /health                          — health + key configuration flags
  POST   /api/analyze                     — full resume ↔ JD analysis pipeline
  POST   /api/analyze-batch               — batch-analyse all saved jobs for a resume
  GET    /api/applications                — list Kanban cards
  POST   /api/applications                — create one
  PUT    /api/applications/{id}           — change status
  DELETE /api/applications/{id}           — delete
  POST   /api/keys                        — save API keys (encrypted at rest)
  GET    /api/keys                        — masked key tails only (never plaintext)
  POST   /api/search/jobs                 — multi-provider job search
  GET    /api/search/platforms            — list providers + config status
  POST   /api/jobs/save                   — persist scraped jobs
  GET    /api/jobs/saved                  — list persisted jobs
"""
from __future__ import annotations

import asyncio
import functools
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from pydantic import BaseModel

from . import config, db, job_search as job_search_module, pipeline

logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing database...")
    try:
        db.init_db()
        logger.info("Database initialized.")
    except Exception as e:
        logger.warning("DB init failed at startup (will retry on first request): %s", e)

    try:
        pipeline.preload_embedding_model()
    except Exception as e:
        logger.warning("Could not preload embedding model: %s", e)

    yield

    try:
        db.close_pool()
    except Exception:
        pass


app = FastAPI(title="AI Resume & Job Tracker API", version="2.0.0", lifespan=lifespan)


@app.middleware("http")
async def enforce_max_content_length(request: Request, call_next):
    """Defence-in-depth: reject requests that advertise an oversized
    Content-Length header before we read any bytes. Chunked transfers
    (no Content-Length) still fall through to per-endpoint checks."""
    cl = request.headers.get("content-length")
    if cl is not None:
        try:
            if int(cl) > config.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    status_code=413,
                    content={"detail": f"Request too large. Max {config.MAX_UPLOAD_SIZE_MB}MB."},
                )
        except ValueError:
            pass
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=config.CORS_ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    db_status = "offline"
    groq = apify = tinyfish = False
    try:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
        db_status = "connected"
        groq = bool(db.get_config("groq_api_key") or os.getenv("GROQ_API_KEY"))
        apify = bool(db.get_config("apify_token") or os.getenv("APIFY_TOKEN"))
        tinyfish = bool(db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY"))
    except Exception as e:
        logger.error("Health DB error: %s", e)
        db_status = f"error: {e}"
        groq = bool(os.getenv("GROQ_API_KEY"))
        apify = bool(os.getenv("APIFY_TOKEN"))
        tinyfish = bool(os.getenv("TINYFISH_API_KEY"))

    return {
        "status": "healthy",
        "service": "AI Resume & Job Tracker API",
        "version": app.version,
        "database": db_status,
        "groq_model": pipeline.current_model(),
        "encryption_enabled": _encryption_enabled(),
        "keys_configured": {"groq": groq, "apify": apify, "tinyfish": tinyfish},
    }


def _encryption_enabled() -> bool:
    from . import crypto
    return crypto.is_enabled()


# ── Models ───────────────────────────────────────────────────────────────────

class ApplicationCreate(BaseModel):
    company_name: str
    position_title: str
    job_description: Optional[str] = None
    status: str = "todo"
    resume_id: Optional[int] = None
    cover_letter: Optional[str] = None


class ApplicationUpdateStatus(BaseModel):
    status: str


class KeysPayload(BaseModel):
    groq_api_key: Optional[str] = None
    groq_model: Optional[str] = None
    apify_token: Optional[str] = None
    tinyfish_api_key: Optional[str] = None


class JobSearchRequest(BaseModel):
    query: str
    location: str = ""
    platforms: List[str] = ["linkedin", "indeed"]
    limit: int = 20


class JobSaveItem(BaseModel):
    title: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    url: Optional[str] = None
    platform: Optional[str] = None
    employment_type: Optional[str] = None
    salary: Optional[str] = None
    posted_date: Optional[str] = None


class BatchAnalyzeRequest(BaseModel):
    resume_id: int
    groq_api_key: Optional[str] = None


BATCH_RATE_LIMIT_BACKOFF_S = float(os.getenv("BATCH_RATE_LIMIT_BACKOFF_S", "30"))

VALID_STATUSES = ["todo", "applied", "interviewing", "offer", "rejected"]


# ── /api/keys (B2: drop unmask, never return plaintext) ──────────────────────

@app.post("/api/keys")
async def save_keys(payload: KeysPayload):
    count = 0
    if payload.groq_api_key and payload.groq_api_key.strip():
        db.save_config("groq_api_key", payload.groq_api_key.strip())
        count += 1
    if payload.apify_token and payload.apify_token.strip():
        db.save_config("apify_token", payload.apify_token.strip())
        count += 1
    if payload.tinyfish_api_key and payload.tinyfish_api_key.strip():
        db.save_config("tinyfish_api_key", payload.tinyfish_api_key.strip())
        count += 1
    if payload.groq_model and payload.groq_model.strip():
        # Not a secret; read back by pipeline.current_model().
        db.save_config("groq_model", payload.groq_model.strip())
        count += 1
    return {"saved": True, "keys_updated": count}


@app.get("/api/keys")
async def get_keys():
    """Return only masked key tails. Plaintext is never exposed via the API."""
    def mask(v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        return f"...{v[-4:]}" if len(v) > 4 else "set"

    groq = db.get_config("groq_api_key")
    apify = db.get_config("apify_token")
    tinyfish = db.get_config("tinyfish_api_key")
    return {
        "groq_api_key": mask(groq),
        "apify_token": mask(apify),
        "tinyfish_api_key": mask(tinyfish),
        "groq_model": pipeline.current_model(),
        "keys_configured": {
            "groq": bool(groq or os.getenv("GROQ_API_KEY")),
            "apify": bool(apify or os.getenv("APIFY_TOKEN")),
            "tinyfish": bool(tinyfish or os.getenv("TINYFISH_API_KEY")),
        },
    }


# ── /api/analyze (B4: tempfile, B5: cancel, B9: async wrapper) ─────────────

@app.post("/api/analyze")
async def analyze_resume(
    request: Request,
    file: UploadFile = File(...),
    job_description: str = Form(...),
    x_groq_api_key: Optional[str] = Header(None),
):
    """Upload a resume PDF, run the LangGraph pipeline, return metrics + outputs."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")

    max_bytes = config.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    contents = await file.read()
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max {config.MAX_UPLOAD_SIZE_MB}MB.",
        )
    if not contents.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF.")

    # Fail fast before touching disk/DB: without a key every LLM node fails,
    # the pipeline would still persist an orphan resume row, then 500.
    groq_key = (
        x_groq_api_key
        or db.get_config("groq_api_key")
        or os.getenv("GROQ_API_KEY")
    )
    if not groq_key:
        raise HTTPException(
            status_code=400,
            detail="Groq API key not configured. Add it in Settings or set GROQ_API_KEY.",
        )

    # A scanned/image-only or corrupt PDF has no extractable text: without
    # this check the LLM is paid to "analyse" nothing and returns a generic
    # placeholder cover letter with a near-zero score (seen live).
    if not _pdf_has_text(contents):
        raise HTTPException(
            status_code=422,
            detail="No text could be extracted from this PDF (scanned image or corrupt?). "
                   "Upload a text-based PDF.",
        )

    # B4: write to a sanitized tempfile, not the project dir + user-supplied name.
    safe_name = os.path.basename(file.filename).replace("..", "_")
    fd, temp_path = tempfile.mkstemp(suffix=".pdf", prefix="resume_", dir=tempfile.gettempdir())
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(contents)

        # B9: run the (still-sync) LangGraph pipeline in an executor so we don't
        # block the event loop. B16: monitor request.is_disconnected() so we
        # can short-circuit if the client cancels mid-pipeline.
        try:
            result = await _run_pipeline_with_cancel(
                request,
                temp_path,
                safe_name,
                job_description,
                groq_key,
            )
        except asyncio.CancelledError:
            logger.info("Analyse cancelled by client disconnect")
            raise HTTPException(status_code=499, detail="Client cancelled request")

        company, role = pipeline._extract_company_and_role(job_description)
        db.save_job_application(
            company_name=company,
            position_title=role,
            job_description=job_description,
            status="todo",
            resume_id=result["resume_id"],
            cover_letter=result["cover_letter"],
        )

        return {
            "success": True,
            "resume_id": result["resume_id"],
            "match_score": result["match_score"],
            "extracted_keywords": result.get("extracted_keywords", []),
            "missing_keywords": result.get("missing_keywords", []),
            "cover_letter": result.get("cover_letter", ""),
            "optimized_resume": result.get("optimized_resume", ""),
            "optimized_resume_latex": result.get("optimized_resume_latex", ""),
            "candidate_name": result.get("candidate_name", ""),
            "candidate_email": result.get("candidate_email", ""),
            "candidate_phone": result.get("candidate_phone", ""),
            "target_role": result.get("target_role", ""),
            "warnings": result.get("warnings", []),
            "matched_jobs": [],
        }
    except HTTPException:
        raise
    except pipeline.LLMConfigError as e:
        # Bad key / retired model: no retry helps, and returning 200 with
        # "generation failed" strings in place of results misleads the user.
        logger.error("Analyse aborted: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Pipeline error")
        raise HTTPException(status_code=500, detail=f"Pipeline error: {e}")
    finally:
        try:
            os.remove(temp_path)
        except OSError:
            pass


def _pdf_has_text(contents: bytes) -> bool:
    import io
    import pypdf
    try:
        reader = pypdf.PdfReader(io.BytesIO(contents))
        return any((page.extract_text() or "").strip() for page in reader.pages)
    except Exception:
        return False


async def _run_pipeline_with_cancel(request: Request, temp_path: str,
                                     safe_name: str, job_description: str,
                                     groq_key: Optional[str]):
    """Run the sync pipeline in an executor; raise if client disconnects first."""
    loop = asyncio.get_running_loop()
    fut = loop.run_in_executor(
        None,
        pipeline.run_analysis_pipeline,
        temp_path, safe_name, job_description, groq_key,
    )
    # Poll for disconnect every 500ms while the pipeline runs.
    while not fut.done():
        if await request.is_disconnected():
            fut.cancel()
            raise asyncio.CancelledError()
        await asyncio.sleep(0.5)
    return await fut


# ── /api/applications (Kanban) ───────────────────────────────────────────────

@app.get("/api/applications")
async def get_applications():
    try:
        return {"success": True, "data": db.get_job_applications()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/applications")
async def create_application(app_data: ApplicationCreate):
    if app_data.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {VALID_STATUSES}")
    try:
        app_id = db.save_job_application(
            company_name=app_data.company_name,
            position_title=app_data.position_title,
            job_description=app_data.job_description,
            status=app_data.status,
            resume_id=app_data.resume_id,
            cover_letter=app_data.cover_letter,
        )
        return {"success": True, "application_id": app_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/applications/{app_id}")
async def update_application_status(app_id: int, status_data: ApplicationUpdateStatus):
    if status_data.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {VALID_STATUSES}")
    try:
        db.update_job_application_status(app_id, status_data.status)
        return {"success": True, "message": "Application status updated."}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/applications/{app_id}")
async def delete_application(app_id: int):
    try:
        db.delete_job_application(app_id)
        return {"success": True, "message": "Application deleted."}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── /api/search ─────────────────────────────────────────────────────────────

@app.post("/api/search/jobs")
async def search_jobs(req: JobSearchRequest):
    try:
        results = job_search_module.search_jobs_unified(
            query=req.query,
            location=req.location,
            platforms=req.platforms,
            limit=req.limit,
            apify_token=db.get_config("apify_token") or os.getenv("APIFY_TOKEN"),
            tinyfish_key=db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY"),
            # Optional providers advertised by /api/search/platforms from env —
            # they must actually be forwarded or they're silently never queried.
            jsearch_key=os.getenv("JSEARCH_KEY"),
            adzuna_app_id=os.getenv("ADZUNA_APP_ID"),
            adzuna_key=os.getenv("ADZUNA_KEY"),
            usajobs_key=os.getenv("USAJOBS_API_KEY"),
        )
        return {"success": True, **results}
    except Exception as e:
        logger.exception("Job search error")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search/platforms")
async def get_platforms():
    has_apify = bool(db.get_config("apify_token") or os.getenv("APIFY_TOKEN"))
    has_tinyfish = bool(db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY"))
    return {
        "platforms": [
            {"id": "remoteok",  "name": "RemoteOK",  "provider": "Free",     "enabled": True},
            {"id": "usajobs",   "name": "USAJOBS",   "provider": "Free",     "enabled": bool(os.getenv("USAJOBS_API_KEY"))},
            {"id": "jsearch",   "name": "JSearch",   "provider": "RapidAPI", "enabled": bool(os.getenv("JSEARCH_KEY"))},
            {"id": "adzuna",    "name": "Adzuna",    "provider": "Adzuna",   "enabled": bool(os.getenv("ADZUNA_APP_ID") and os.getenv("ADZUNA_KEY"))},
            {"id": "linkedin",  "name": "LinkedIn",  "provider": "Apify",    "enabled": has_apify},
            {"id": "indeed",    "name": "Indeed",    "provider": "Apify",    "enabled": has_apify},
            {"id": "glassdoor", "name": "Glassdoor", "provider": "Apify",    "enabled": has_apify},
            {"id": "tinyfish",  "name": "Tinyfish",  "provider": "Tinyfish", "enabled": has_tinyfish},
        ],
    }


@app.post("/api/jobs/save")
async def save_jobs_endpoint(jobs: List[JobSaveItem]):
    try:
        saved = db.save_jobs([j.model_dump(exclude_none=True) for j in jobs])
        return {"success": True, "saved": saved, "total": len(jobs)}
    except Exception as e:
        logger.exception("Error saving jobs")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/jobs/saved")
async def get_saved_jobs():
    try:
        jobs = db.get_saved_jobs()
        return {"success": True, "jobs": jobs, "total": len(jobs)}
    except Exception as e:
        logger.exception("Error fetching saved jobs")
        raise HTTPException(status_code=500, detail=str(e))


# ── /api/analyze-batch ───────────────────────────────────────────────────────

@app.post("/api/analyze-batch")
async def analyze_batch(request: BatchAnalyzeRequest, background_tasks: BackgroundTasks):
    resume = db.get_resume(request.resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail=f"Resume {request.resume_id} not found")

    groq_key = request.groq_api_key or db.get_config("groq_api_key") or os.getenv("GROQ_API_KEY")
    if not groq_key:
        # Otherwise every queued job fails in the background and the client
        # is told the batch "started" successfully.
        raise HTTPException(
            status_code=400,
            detail="Groq API key not configured. Add it in Settings or set GROQ_API_KEY.",
        )

    jobs = db.get_saved_jobs()
    jobs_with_jd = [j for j in jobs if j.get("description")]

    async def process_jobs():
        processed = errors = 0
        loop = asyncio.get_running_loop()
        run_one = functools.partial(
            pipeline.run_batch_pipeline,
            resume_id=resume["id"],
            resume_text=resume["extracted_text"],
            groq_api_key=groq_key,
        )
        for job in jobs_with_jd:
            try:
                # The LangGraph pipeline is synchronous (LLM + embedding calls);
                # run it in the default executor so the event loop keeps
                # serving other requests while the batch runs.
                result = await loop.run_in_executor(
                    None, functools.partial(run_one, job_description=job["description"]))
                if any(pipeline.is_rate_limit_warning(w) for w in result.get("warnings") or []):
                    # Groq free tier is tokens-per-minute limited; each job is
                    # ~5 LLM calls. Let the window roll over, retry once.
                    logger.warning("Batch: rate limited on job %s; backing off %ss",
                                   job["id"], BATCH_RATE_LIMIT_BACKOFF_S)
                    await asyncio.sleep(BATCH_RATE_LIMIT_BACKOFF_S)
                    first = result
                    result = await loop.run_in_executor(
                        None, functools.partial(run_one, job_description=job["description"]))
                    # Keep whatever the first attempt did produce if the retry
                    # was rate limited on a different branch.
                    for k in ("cover_letter", "optimized_resume", "optimized_resume_latex"):
                        if not result.get(k) and first.get(k):
                            result[k] = first[k]
                for w in result.get("warnings") or []:
                    logger.warning("Batch: job %s: %s", job["id"], w)
                db.update_job_analysis(
                    job_id=job["id"],
                    ats_score=result.get("match_score", 0.0),
                    missing_keywords=result.get("missing_keywords", []),
                    cover_letter=result.get("cover_letter", ""),
                    optimized_resume=result.get("optimized_resume", ""),
                    optimized_resume_latex=result.get("optimized_resume_latex", ""),
                )
                processed += 1
                logger.info("Batch: processed job %s (%s) score=%s",
                            job["id"], job.get("title", "?"), result.get("match_score"))
            except pipeline.LLMConfigError as e:
                # Same failure for every remaining job — stop instead of
                # burning N doomed requests.
                errors += 1
                logger.error("Batch aborted at job %s: %s", job["id"], e)
                break
            except Exception as e:
                errors += 1
                logger.error("Batch: failed job %s: %s", job["id"], e)
            await asyncio.sleep(1.5)  # Groq free-tier throttle
        logger.info("Batch analysis complete: %s processed, %s errors", processed, errors)

    background_tasks.add_task(process_jobs)
    return {
        "success": True,
        "message": "Batch analysis started in background",
        "resume_id": request.resume_id,
        "jobs_queued": len(jobs_with_jd),
    }


# ── Entrypoint ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=config.BACKEND_HOST,
        port=config.BACKEND_PORT,
        reload=False,
        workers=1,  # pipeline holds module-level singletons; multi-worker duplicates them
    )
