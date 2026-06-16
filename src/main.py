import asyncio
import os
import shutil
from typing import Optional, List
from fastapi import BackgroundTasks, FastAPI, UploadFile, File, Form, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import logging

import db
import pipeline
import job_search as job_search_module

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Resume & Job Tracker API", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Database on Startup
@app.on_event("startup")
async def startup_event():
    logger.info("Initializing database...")
    try:
        db.init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.warning(f"Database initialization failed at startup (will retry on first request): {e}")

@app.get("/health")
async def health_check():
    db_status = "offline"
    try:
        conn = db.get_connection()
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
        conn.close()
        db_status = "connected"
    except Exception as e:
        logger.error(f"Health check DB error: {e}")
        db_status = f"error: {str(e)}"

    return {
        "status": "healthy",
        "service": "AI Resume & Job Tracker API",
        "database": db_status,
        "db_url": db.DATABASE_URL,
        "groq_model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "keys_configured": {
            "groq": bool(db.get_config("groq_api_key") or os.getenv("GROQ_API_KEY")),
            "apify": bool(db.get_config("apify_token") or os.getenv("APIFY_TOKEN")),
            "tinyfish": bool(db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY")),
        }
    }

# --- Resume Analysis Endpoint ---

@app.post("/api/analyze")
async def analyze_resume(
    file: UploadFile = File(...),
    job_description: str = Form(...),
    x_groq_api_key: Optional[str] = Header(None)
):
    """
    Uploads a resume PDF, runs the LangGraph agentic pipeline, 
    and returns match metrics and tailored cover letter.
    """
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF resumes are supported.")

    # Create temporary directory if not exists
    temp_dir = "temp_uploads"
    os.makedirs(temp_dir, exist_ok=True)
    temp_path = os.path.join(temp_dir, file.filename)
    
    try:
        # Save uploaded file temporarily
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
            
        # Run LangGraph pipeline
        result = pipeline.run_analysis_pipeline(
            resume_path=temp_path,
            filename=file.filename,
            job_description=job_description,
            groq_api_key=x_groq_api_key
        )
        
        # Save job application automatically to Kanban as a placeholder 'todo' application
        # Users can specify details or update them in the Streamlit app later.
        # We try to extract company/position from JD or use placeholders.
        db.save_job_application(
            company_name="Analyzed Target",
            position_title="Matched Role",
            job_description=job_description,
            status="todo",
            resume_id=result["resume_id"],
            cover_letter=result["cover_letter"]
        )
        
        return JSONResponse({
            "success": True,
            "resume_id": result["resume_id"],
            "match_score": result["match_score"],
            "extracted_keywords": result["extracted_keywords"],
            "missing_keywords": result["missing_keywords"],
            "cover_letter": result["cover_letter"],
            "optimized_resume": result["optimized_resume"]
        })
        
    except Exception as e:
        logger.error(f"Error in analysis pipeline: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Pipeline error: {str(e)}")
    finally:
        # Clean up temporary file
        if os.path.exists(temp_path):
            os.remove(temp_path)

# --- Job Applications (Kanban) CRUD Endpoints ---

class ApplicationCreate(BaseModel):
    company_name: str
    position_title: str
    job_description: str = None
    status: str = "todo"
    resume_id: int = None
    cover_letter: str = None

class ApplicationUpdateStatus(BaseModel):
    status: str

class KeysPayload(BaseModel):
    groq_api_key: Optional[str] = None
    apify_token: Optional[str] = None
    tinyfish_api_key: Optional[str] = None

@app.post("/api/keys")
async def save_keys(payload: KeysPayload):
    if payload.groq_api_key:
        db.save_config("groq_api_key", payload.groq_api_key)
    if payload.apify_token:
        db.save_config("apify_token", payload.apify_token)
    if payload.tinyfish_api_key:
        db.save_config("tinyfish_api_key", payload.tinyfish_api_key)
    return {"saved": True}

@app.get("/api/keys")
async def get_keys():
    groq = db.get_config("groq_api_key")
    apify = db.get_config("apify_token")
    tinyfish = db.get_config("tinyfish_api_key")
    def mask(v): return f"...{v[-4:]}" if v and len(v) > 4 else ("set" if v else None)
    return {
        "groq_api_key": mask(groq),
        "apify_token": mask(apify),
        "tinyfish_api_key": mask(tinyfish),
        "keys_configured": {
            "groq": bool(groq or os.getenv("GROQ_API_KEY")),
            "apify": bool(apify or os.getenv("APIFY_TOKEN")),
            "tinyfish": bool(tinyfish or os.getenv("TINYFISH_API_KEY")),
        }
    }

@app.get("/api/applications")
async def get_applications():
    try:
        apps = db.get_job_applications()
        return {"success": True, "data": apps}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/applications")
async def create_application(app_data: ApplicationCreate):
    try:
        app_id = db.save_job_application(
            company_name=app_data.company_name,
            position_title=app_data.position_title,
            job_description=app_data.job_description,
            status=app_data.status,
            resume_id=app_data.resume_id,
            cover_letter=app_data.cover_letter
        )
        return {"success": True, "application_id": app_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/applications/{app_id}")
async def update_application_status(app_id: int, status_data: ApplicationUpdateStatus):
    valid_statuses = ["todo", "applied", "interviewing", "offer", "rejected"]
    if status_data.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")
    try:
        db.update_job_application_status(app_id, status_data.status)
        return {"success": True, "message": "Application status updated successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/applications/{app_id}")
async def delete_application(app_id: int):
    try:
        db.delete_job_application(app_id)
        return {"success": True, "message": "Application deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Job Search Endpoints ---

class JobSearchRequest(BaseModel):
    query: str
    location: str = ""
    platforms: List[str] = ["linkedin", "indeed"]
    limit: int = 20

@app.post("/api/search/jobs")
async def search_jobs(req: JobSearchRequest):
    """
    Unified job search across Apify (LinkedIn, Indeed, Glassdoor) and Tinyfish.
    API tokens are read from environment variables.
    """
    try:
        results = job_search_module.search_jobs_unified(
            query=req.query,
            location=req.location,
            platforms=req.platforms,
            limit=req.limit,
            apify_token=db.get_config("apify_token") or os.getenv("APIFY_TOKEN"),
            tinyfish_key=db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY"),
        )
        return {"success": True, **results}
    except Exception as e:
        logger.error(f"Job search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search/platforms")
async def get_platforms():
    """Returns available job search platforms and their configuration status."""
    has_apify = bool(db.get_config("apify_token") or os.getenv("APIFY_TOKEN"))
    has_tinyfish = bool(db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY"))
    return {
        "platforms": [
            {"id": "linkedin",  "name": "LinkedIn",  "provider": "Apify",    "enabled": has_apify},
            {"id": "indeed",    "name": "Indeed",    "provider": "Apify",    "enabled": has_apify},
            {"id": "glassdoor", "name": "Glassdoor", "provider": "Apify",    "enabled": has_apify},
            {"id": "tinyfish",  "name": "Tinyfish",  "provider": "Tinyfish", "enabled": has_tinyfish},
        ]
    }

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

@app.post("/api/jobs/save")
async def save_jobs_endpoint(jobs: List[JobSaveItem]):
    """Save scraped jobs to the database (deduplicates by URL)."""
    try:
        saved = db.save_jobs([j.dict() for j in jobs])
        return {"success": True, "saved": saved, "total": len(jobs)}
    except Exception as e:
        logger.error(f"Error saving jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/jobs/saved")
async def get_saved_jobs():
    """Return all saved jobs including any analysis results."""
    try:
        jobs = db.get_saved_jobs()
        return {"success": True, "jobs": jobs, "total": len(jobs)}
    except Exception as e:
        logger.error(f"Error fetching saved jobs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class BatchAnalyzeRequest(BaseModel):
    resume_id: int
    groq_api_key: Optional[str] = None

@app.post("/api/analyze-batch")
async def analyze_batch(request: BatchAnalyzeRequest, background_tasks: BackgroundTasks):
    """
    Runs the analysis pipeline against all saved jobs for a given resume.
    Uses background tasks and 1.5s throttle between Groq calls (free-tier safe).
    """
    resume = db.get_resume(request.resume_id)
    if not resume:
        raise HTTPException(status_code=404, detail=f"Resume {request.resume_id} not found")

    jobs = db.get_saved_jobs()
    # Only process jobs that have a job description
    jobs_with_jd = [j for j in jobs if j.get("description")]

    groq_key = request.groq_api_key or db.get_config("groq_api_key") or os.getenv("GROQ_API_KEY")

    async def process_jobs():
        processed = 0
        errors = 0
        for job in jobs_with_jd:
            try:
                result = pipeline.run_batch_pipeline(
                    resume_id=resume["id"],
                    resume_text=resume["extracted_text"],
                    job_description=job["description"],
                    groq_api_key=groq_key,
                )
                db.update_job_analysis(
                    job_id=job["id"],
                    ats_score=result.get("match_score", 0.0),
                    missing_keywords=result.get("missing_keywords", []),
                    cover_letter=result.get("cover_letter", ""),
                    optimized_resume=result.get("optimized_resume", ""),
                )
                processed += 1
                logger.info(f"Batch: processed job {job['id']} ({job.get('title','?')}) score={result.get('match_score')}")
            except Exception as e:
                errors += 1
                logger.error(f"Batch: failed job {job['id']}: {e}")
            # Rate-limit throttle: 1.5s between jobs = ~2.7 calls/sec across 4 Groq calls
            await asyncio.sleep(1.5)
        logger.info(f"Batch analysis complete: {processed} processed, {errors} errors")

    background_tasks.add_task(process_jobs)
    return {
        "success": True,
        "message": "Batch analysis started in background",
        "resume_id": request.resume_id,
        "jobs_queued": len(jobs_with_jd),
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BACKEND_PORT", 8000))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=False)
