import os
import shutil
from typing import Optional, List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header
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
            "groq": bool(os.getenv("GROQ_API_KEY")),
            "apify": bool(os.getenv("APIFY_TOKEN")),
            "tinyfish": bool(os.getenv("TINYFISH_API_KEY")),
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
            "cover_letter": result["cover_letter"]
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
            apify_token=os.getenv("APIFY_TOKEN"),
            tinyfish_key=os.getenv("TINYFISH_API_KEY"),
        )
        return {"success": True, **results}
    except Exception as e:
        logger.error(f"Job search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/search/platforms")
async def get_platforms():
    """Returns available job search platforms and their configuration status."""
    return {
        "platforms": [
            {"id": "linkedin",  "name": "LinkedIn",  "provider": "Apify",    "enabled": bool(os.getenv("APIFY_TOKEN"))},
            {"id": "indeed",    "name": "Indeed",    "provider": "Apify",    "enabled": bool(os.getenv("APIFY_TOKEN"))},
            {"id": "glassdoor", "name": "Glassdoor", "provider": "Apify",    "enabled": bool(os.getenv("APIFY_TOKEN"))},
            {"id": "tinyfish",  "name": "Tinyfish",  "provider": "Tinyfish", "enabled": bool(os.getenv("TINYFISH_API_KEY"))},
        ]
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BACKEND_PORT", 8000))
    host = os.getenv("BACKEND_HOST", "0.0.0.0")
    uvicorn.run("main:app", host=host, port=port, reload=False)
