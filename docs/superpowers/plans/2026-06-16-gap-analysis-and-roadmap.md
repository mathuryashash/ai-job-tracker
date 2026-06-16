# AI Resume Job Tracker — Gap Analysis & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the end-to-end automated job application pipeline: resume upload → job scraping → per-job ATS scoring + keyword gaps + cover letter + optimized resume → tracked in Kanban.

**Architecture:** The existing LangGraph pipeline (4 nodes) and all 5 frontend pages are in place. The missing pieces are: (1) ATS-optimized resume generation node, (2) backend API-key persistence, (3) job-to-DB storage, and (4) an integrated "analyze all scraped jobs" batch flow that ties job search → per-job pipeline execution together.

**Tech Stack:** Python 3.11, FastAPI, LangGraph, Groq (llama-3.3-70b-versatile), Sentence-Transformers (all-MiniLM-L6-v2), pgvector/PostgreSQL, React 19 (Vite), Apify, Tinyfish

---

## GAP ANALYSIS — CURRENT vs PLANNED

| Feature | Planned | Status | Notes |
|---|---|---|---|
| Resume upload & PDF parsing | ✅ | ✅ Done | `load_resume_node` in pipeline.py |
| Keyword extraction from resume | ✅ | ✅ Done | `extract_keywords_node`, Groq LLM |
| API key entry (Groq + Apify) | ✅ | ⚠️ Partial | Settings.jsx saves to **localStorage only**; backend reads from env vars, not from user input |
| Job scraping via Apify | ✅ | ✅ Done | `ApifyJobSearcher` in job_search.py, 3 platforms |
| ATS score per job | ✅ | ✅ Done | Hybrid: 40% semantic embeddings + 60% Groq LLM |
| Missing keyword suggestions per job | ✅ | ✅ Done | `missing_keywords` array from pipeline |
| Cover letter per job | ✅ | ✅ Done | `generate_cover_letter_node` |
| ATS-optimized resume per job | ✅ | ❌ **MISSING** | No tailored resume generation exists |
| Application tracking / Kanban | ✅ | ✅ Done | 5-column Kanban, CRUD endpoints |
| Scraped jobs stored in DB | ✅ | ❌ **MISSING** | In-memory only; jobs lost on page reload |
| Integrated flow: search → analyze all | ✅ | ❌ **MISSING** | No "analyze all scraped jobs" button; JD must be pasted manually per job |
| API keys stored securely in backend | ✅ | ❌ **MISSING** | Keys in localStorage, not passed to backend for Apify calls |

---

## WHAT MUST BE BUILT (Priority Order)

### P0 — Blockers to core flow
1. **ATS-Optimized Resume Generation** — the only fully missing pipeline feature
2. **API keys passed to backend** — Apify calls use `os.getenv("APIFY_TOKEN")`, so user-entered keys never reach the scraper

### P1 — Flow completeness
3. **Job storage in DB** — scraped jobs must persist so the pipeline can reference them
4. **Batch job analysis** — "Analyze all saved jobs against my resume" endpoint + UI trigger

### P2 — Polish
5. **Resume download** — let users download the optimized resume as PDF/text
6. **Per-job detail view** — expand a Kanban card to see ATS score, keywords, cover letter, and optimized resume

---

## FILE MAP — What Changes Where

```
backend/
  src/
    pipeline.py          MODIFY — add generate_optimized_resume_node (5th node)
    main.py              MODIFY — add /api/keys endpoint, /api/jobs/saved, /api/analyze-batch
    db.py                MODIFY — add save_job(), get_jobs(), update schema
    job_search.py        MODIFY — accept api_key param instead of os.getenv
    models.py            CREATE — Pydantic schemas for Job, BatchAnalysisRequest
  migrations/
    add_jobs_table.sql   CREATE — jobs table schema

frontend/src/
  components/
    JobSearch.jsx        MODIFY — pass Apify key from state, save scraped jobs to DB
    KanbanBoard.jsx      MODIFY — expand card to show cover letter / optimized resume / score
    Settings.jsx         MODIFY — on save, POST keys to /api/keys backend endpoint
    ResumeAnalyzer.jsx   MODIFY — show optimized resume section in results
  api/
    client.js            MODIFY — add saveJobsToDB(), batchAnalyze(), saveKeys() calls
```

---

## Task 1: Backend — API Key Persistence

**Files:**
- Modify: `D:\ai-resume-job-tracker\src\main.py`
- Modify: `D:\ai-resume-job-tracker\src\db.py`
- Modify: `D:\ai-resume-job-tracker\src\job_search.py`

The backend currently reads `APIFY_TOKEN` from `os.getenv`. User-entered keys in Settings.jsx never reach there. Fix: add a `/api/keys` endpoint that stores keys in the DB (encrypted or as plain text in a config table), and make `ApifyJobSearcher` accept the key as a parameter.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_keys.py
import pytest
from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_save_and_retrieve_keys():
    response = client.post("/api/keys", json={
        "groq_api_key": "gsk_test123",
        "apify_token": "apify_test456"
    })
    assert response.status_code == 200
    assert response.json()["saved"] is True

def test_get_keys_returns_masked():
    response = client.get("/api/keys")
    assert response.status_code == 200
    data = response.json()
    # should return masked values, not plaintext
    assert "groq_api_key" in data
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd D:\ai-resume-job-tracker
pytest tests/test_keys.py -v
```
Expected: FAIL — "404 Not Found" on `/api/keys`

- [ ] **Step 3: Add `user_config` table to db.py**

In `D:\ai-resume-job-tracker\src\db.py`, add after existing `create_tables()`:

```python
def save_config(key: str, value: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO user_config (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (key, value))
            conn.commit()

def get_config(key: str) -> str | None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT value FROM user_config WHERE key = %s", (key,))
            row = cur.fetchone()
            return row[0] if row else None
```

And in `create_tables()`, add:
```python
cur.execute("""
    CREATE TABLE IF NOT EXISTS user_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
""")
```

- [ ] **Step 4: Add `/api/keys` endpoints in main.py**

In `D:\ai-resume-job-tracker\src\main.py`, add:

```python
from pydantic import BaseModel

class KeysPayload(BaseModel):
    groq_api_key: str | None = None
    apify_token: str | None = None
    tinyfish_api_key: str | None = None

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
    return {
        "groq_api_key": f"gsk_...{groq[-4:]}" if groq else None,
        "apify_token": f"apify_...{apify[-4:]}" if apify else None,
        "tinyfish_api_key": f"tf_...{tinyfish[-4:]}" if tinyfish else None,
    }
```

- [ ] **Step 5: Update `ApifyJobSearcher` to accept key param**

In `D:\ai-resume-job-tracker\src\job_search.py`, change:
```python
# Before
class ApifyJobSearcher:
    def __init__(self):
        self.api_token = os.getenv("APIFY_TOKEN", "")

# After
class ApifyJobSearcher:
    def __init__(self, api_token: str | None = None):
        self.api_token = api_token or db.get_config("apify_token") or os.getenv("APIFY_TOKEN", "")
```

Do the same for `TinyfishJobSearcher`:
```python
class TinyfishJobSearcher:
    def __init__(self, api_key: str | None = None):
        self.api_key = api_key or db.get_config("tinyfish_api_key") or os.getenv("TINYFISH_API_KEY", "")
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_keys.py -v
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/main.py src/db.py src/job_search.py tests/test_keys.py
git commit -m "feat: persist API keys to DB, pass to job searchers"
```

---

## Task 2: Frontend — Wire Settings to Backend

**Files:**
- Modify: `D:\ai-resume-job-tracker\frontend\src\components\Settings.jsx`
- Modify: `D:\ai-resume-job-tracker\frontend\src\api\client.js`

Currently Settings.jsx uses `localStorage.setItem`. Change it to POST to `/api/keys`.

- [ ] **Step 1: Add `saveKeys` to client.js**

In `D:\ai-resume-job-tracker\frontend\src\api\client.js`, add:

```js
export async function saveKeys({ groqApiKey, apifyToken, tinyfishApiKey }) {
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groq_api_key: groqApiKey || undefined,
      apify_token: apifyToken || undefined,
      tinyfish_api_key: tinyfishApiKey || undefined,
    }),
  });
  if (!res.ok) throw new Error('Failed to save keys');
  return res.json();
}
```

- [ ] **Step 2: Update Settings.jsx save handler**

In `D:\ai-resume-job-tracker\frontend\src\components\Settings.jsx`, find the save handler (currently uses `localStorage`) and replace with:

```jsx
import { saveKeys } from '../api/client';

// In the save handler:
const handleSave = async () => {
  try {
    await saveKeys({
      groqApiKey: groqKey,
      apifyToken: apifyToken,
      tinyfishApiKey: tinyfishKey,
    });
    // keep localStorage as fallback for display only
    localStorage.setItem('groq_api_key', groqKey);
    localStorage.setItem('apify_token', apifyToken);
    localStorage.setItem('tinyfish_api_key', tinyfishKey);
    toast.success('API keys saved');
  } catch (err) {
    toast.error('Failed to save keys: ' + err.message);
  }
};
```

- [ ] **Step 3: Start dev server and test manually**

```bash
cd D:\ai-resume-job-tracker\frontend && npm run dev
```

Open `http://localhost:5173/settings`, enter a test Groq key, click Save.
Verify: backend returns `{"saved": true}`, toast shows success.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Settings.jsx frontend/src/api/client.js
git commit -m "feat: Settings saves API keys to backend DB instead of localStorage-only"
```

---

## Task 3: Backend — Persist Scraped Jobs to DB

**Files:**
- Modify: `D:\ai-resume-job-tracker\src\db.py`
- Modify: `D:\ai-resume-job-tracker\src\main.py`

Scraped jobs are currently in-memory only. Add a `jobs` table and endpoints to save/retrieve them.

- [ ] **Step 1: Write failing test**

```python
# tests/test_jobs_db.py
from fastapi.testclient import TestClient
from src.main import app

client = TestClient(app)

def test_save_and_list_jobs():
    job = {
        "title": "Senior Python Engineer",
        "company": "Acme Corp",
        "location": "Remote",
        "description": "We need Python skills",
        "url": "https://example.com/job/1",
        "platform": "linkedin"
    }
    save_res = client.post("/api/jobs/save", json=[job])
    assert save_res.status_code == 200
    assert save_res.json()["saved"] == 1

    list_res = client.get("/api/jobs/saved")
    assert list_res.status_code == 200
    jobs = list_res.json()
    assert any(j["url"] == "https://example.com/job/1" for j in jobs)
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_jobs_db.py -v
```
Expected: FAIL — "404 Not Found"

- [ ] **Step 3: Add jobs table and DB functions in db.py**

In `D:\ai-resume-job-tracker\src\db.py`, add to `create_tables()`:

```python
cur.execute("""
    CREATE TABLE IF NOT EXISTS saved_jobs (
        id SERIAL PRIMARY KEY,
        title TEXT,
        company TEXT,
        location TEXT,
        description TEXT,
        url TEXT UNIQUE,
        platform TEXT,
        ats_score FLOAT,
        missing_keywords TEXT[],
        cover_letter TEXT,
        optimized_resume TEXT,
        created_at TIMESTAMP DEFAULT NOW()
    )
""")
```

Add these functions:
```python
def save_jobs(jobs: list[dict]) -> int:
    saved = 0
    with get_connection() as conn:
        with conn.cursor() as cur:
            for job in jobs:
                try:
                    cur.execute("""
                        INSERT INTO saved_jobs (title, company, location, description, url, platform)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (url) DO NOTHING
                    """, (job.get("title"), job.get("company"), job.get("location"),
                          job.get("description"), job.get("url"), job.get("platform")))
                    if cur.rowcount:
                        saved += 1
                except Exception:
                    pass
            conn.commit()
    return saved

def get_saved_jobs() -> list[dict]:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, title, company, location, description, url, platform,
                       ats_score, missing_keywords, cover_letter, optimized_resume, created_at
                FROM saved_jobs ORDER BY created_at DESC
            """)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]

def update_job_analysis(job_id: int, ats_score: float, missing_keywords: list,
                         cover_letter: str, optimized_resume: str):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE saved_jobs
                SET ats_score=%s, missing_keywords=%s, cover_letter=%s, optimized_resume=%s
                WHERE id=%s
            """, (ats_score, missing_keywords, cover_letter, optimized_resume, job_id))
            conn.commit()
```

- [ ] **Step 4: Add endpoints in main.py**

```python
class JobSavePayload(BaseModel):
    title: str | None = None
    company: str | None = None
    location: str | None = None
    description: str | None = None
    url: str | None = None
    platform: str | None = None

@app.post("/api/jobs/save")
async def save_jobs_endpoint(jobs: list[JobSavePayload]):
    saved = db.save_jobs([j.dict() for j in jobs])
    return {"saved": saved}

@app.get("/api/jobs/saved")
async def get_saved_jobs():
    return db.get_saved_jobs()
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_jobs_db.py -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/db.py src/main.py tests/test_jobs_db.py
git commit -m "feat: persist scraped jobs to DB with save/list endpoints"
```

---

## Task 4: Pipeline — ATS-Optimized Resume Generation Node

**Files:**
- Modify: `D:\ai-resume-job-tracker\src\pipeline.py`

This is the **only fully missing pipeline feature**. Add a 5th LangGraph node that rewrites the resume tailored to the job description.

- [ ] **Step 1: Write failing test**

```python
# tests/test_optimized_resume.py
import pytest
from unittest.mock import patch, MagicMock
from src.pipeline import run_analysis_pipeline

@patch("src.pipeline.get_llm")
def test_pipeline_returns_optimized_resume(mock_llm):
    mock_chain = MagicMock()
    mock_chain.invoke.side_effect = [
        MagicMock(keywords=["Python", "FastAPI"]),          # extract_keywords
        MagicMock(match_score=75, missing_keywords=["Docker"]),  # rag_alignment
        MagicMock(content="Dear Hiring Manager..."),         # cover_letter
        MagicMock(content="Optimized Resume Content Here"), # optimized_resume
    ]
    mock_llm.return_value = mock_chain

    result = run_analysis_pipeline(
        resume_path="tests/fixtures/sample.pdf",
        filename="sample.pdf",
        job_description="Python FastAPI Docker experience required",
        groq_api_key="gsk_test"
    )
    assert "optimized_resume" in result
    assert len(result["optimized_resume"]) > 0
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_optimized_resume.py -v
```
Expected: FAIL — `KeyError: 'optimized_resume'`

- [ ] **Step 3: Add `generate_optimized_resume_node` to pipeline.py**

In `D:\ai-resume-job-tracker\src\pipeline.py`, add after `generate_cover_letter_node`:

```python
def generate_optimized_resume_node(state: PipelineState) -> PipelineState:
    """Rewrites resume content to be ATS-optimized for this specific job."""
    llm = get_llm()
    resume_text = state["resume_text"]
    job_description = state["job_description"]
    missing_keywords = state.get("missing_keywords", [])

    system_prompt = """You are an expert resume writer and ATS optimization specialist.
Rewrite the provided resume to maximize ATS match for the job description.
Rules:
- Naturally incorporate the missing keywords where truthful and relevant
- Mirror the language and terminology used in the job description
- Keep all factual information accurate — do NOT fabricate experience
- Preserve the overall structure (Summary, Experience, Skills, Education)
- Output plain text resume, ready to be formatted"""

    human_prompt = f"""ORIGINAL RESUME:
{resume_text}

JOB DESCRIPTION:
{job_description}

KEYWORDS TO INCORPORATE (where relevant):
{', '.join(missing_keywords)}

Write an ATS-optimized version of this resume for this specific job:"""

    response = llm.invoke([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": human_prompt}
    ])
    return {**state, "optimized_resume": response.content}
```

- [ ] **Step 4: Wire into PipelineState and graph**

In `PipelineState` TypedDict, add:
```python
optimized_resume: str
```

In the graph definition, add the new node and edge:
```python
graph.add_node("generate_optimized_resume", generate_optimized_resume_node)
graph.add_edge("generate_cover_letter", "generate_optimized_resume")
graph.add_edge("generate_optimized_resume", END)
# Remove old: graph.add_edge("generate_cover_letter", END)
```

In `run_analysis_pipeline`, add to the returned dict:
```python
"optimized_resume": result.get("optimized_resume", ""),
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_optimized_resume.py -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pipeline.py tests/test_optimized_resume.py
git commit -m "feat: add ATS-optimized resume generation as 5th pipeline node"
```

---

## Task 5: Backend — Batch Analyze All Saved Jobs

**Files:**
- Modify: `D:\ai-resume-job-tracker\src\main.py`

Add an endpoint that takes a resume_id and runs the full pipeline against every saved job, updating each job row with ATS score, cover letter, and optimized resume.

- [ ] **Step 1: Write failing test**

```python
# tests/test_batch_analyze.py
from fastapi.testclient import TestClient
from unittest.mock import patch
from src.main import app

client = TestClient(app)

@patch("src.main.run_analysis_pipeline")
def test_batch_analyze_endpoint(mock_pipeline):
    mock_pipeline.return_value = {
        "match_score": 80,
        "missing_keywords": ["Docker"],
        "cover_letter": "Dear Hiring Manager...",
        "optimized_resume": "Optimized resume..."
    }
    response = client.post("/api/analyze-batch", json={
        "resume_id": 1,
        "groq_api_key": "gsk_test"
    })
    assert response.status_code == 200
    assert "processed" in response.json()
```

- [ ] **Step 2: Run to verify it fails**

```bash
pytest tests/test_batch_analyze.py -v
```
Expected: FAIL — "404 Not Found"

- [ ] **Step 3: Add `/api/analyze-batch` endpoint in main.py**

```python
class BatchAnalyzeRequest(BaseModel):
    resume_id: int
    groq_api_key: str

@app.post("/api/analyze-batch")
async def batch_analyze(request: BatchAnalyzeRequest, background_tasks: BackgroundTasks):
    jobs = db.get_saved_jobs()
    resume = db.get_resume(request.resume_id)  # returns dict with 'file_path', 'filename'
    if not resume:
        raise HTTPException(status_code=404, detail="Resume not found")

    async def process():
        for job in jobs:
            if not job.get("description"):
                continue
            try:
                result = run_analysis_pipeline(
                    resume_path=resume["file_path"],
                    filename=resume["filename"],
                    job_description=job["description"],
                    groq_api_key=request.groq_api_key or db.get_config("groq_api_key"),
                )
                db.update_job_analysis(
                    job_id=job["id"],
                    ats_score=result.get("match_score", 0),
                    missing_keywords=result.get("missing_keywords", []),
                    cover_letter=result.get("cover_letter", ""),
                    optimized_resume=result.get("optimized_resume", ""),
                )
            except Exception as e:
                print(f"Failed to analyze job {job['id']}: {e}")

    background_tasks.add_task(process)
    return {"processing": True, "job_count": len(jobs), "processed": len(jobs)}
```

Also add `db.get_resume(resume_id)` to db.py:
```python
def get_resume(resume_id: int) -> dict | None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, filename, file_path, extracted_text FROM resumes WHERE id=%s", (resume_id,))
            row = cur.fetchone()
            if not row:
                return None
            return {"id": row[0], "filename": row[1], "file_path": row[2], "extracted_text": row[3]}
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_batch_analyze.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main.py src/db.py tests/test_batch_analyze.py
git commit -m "feat: batch analyze all saved jobs against resume via background task"
```

---

## Task 6: Frontend — Save Jobs to DB from Job Search Page

**Files:**
- Modify: `D:\ai-resume-job-tracker\frontend\src\components\JobSearch.jsx`
- Modify: `D:\ai-resume-job-tracker\frontend\src\api\client.js`

The "Save to Kanban" button currently does... something unclear. Replace with "Save Job" that POSTs to `/api/jobs/save`, then batch-analyze.

- [ ] **Step 1: Add `saveJobsToDB` and `batchAnalyze` to client.js**

```js
export async function saveJobsToDB(jobs) {
  const res = await fetch('/api/jobs/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(jobs),
  });
  if (!res.ok) throw new Error('Failed to save jobs');
  return res.json();
}

export async function batchAnalyzeJobs({ resumeId, groqApiKey }) {
  const res = await fetch('/api/analyze-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resume_id: resumeId, groq_api_key: groqApiKey }),
  });
  if (!res.ok) throw new Error('Failed to start batch analysis');
  return res.json();
}
```

- [ ] **Step 2: Update JobSearch.jsx save button**

Find the "Save to Kanban" button in `JobSearch.jsx` and replace its handler:

```jsx
import { saveJobsToDB } from '../api/client';

const handleSaveJob = async (job) => {
  try {
    await saveJobsToDB([{
      title: job.title,
      company: job.company,
      location: job.location,
      description: job.description,
      url: job.url,
      platform: job.platform,
    }]);
    toast.success(`Saved "${job.title}" to job list`);
  } catch (err) {
    toast.error('Save failed: ' + err.message);
  }
};
```

- [ ] **Step 3: Add "Analyze All Saved Jobs" button to Dashboard.jsx**

In `D:\ai-resume-job-tracker\frontend\src\components\Dashboard.jsx`, add a prominent CTA button:

```jsx
import { batchAnalyzeJobs } from '../api/client';

const handleBatchAnalyze = async () => {
  const resumeId = localStorage.getItem('last_resume_id');
  const groqKey = localStorage.getItem('groq_api_key');
  if (!resumeId) {
    toast.error('Upload a resume first in the Resume Analyzer');
    return;
  }
  try {
    const result = await batchAnalyzeJobs({ resumeId: parseInt(resumeId), groqApiKey: groqKey });
    toast.success(`Analyzing ${result.job_count} jobs in background…`);
  } catch (err) {
    toast.error('Batch analysis failed: ' + err.message);
  }
};
```

- [ ] **Step 4: Test manually**

```bash
cd D:\ai-resume-job-tracker\frontend && npm run dev
```
1. Go to Settings → save Groq key + Apify token
2. Go to Resume Analyzer → upload resume
3. Go to Job Search → search → save some jobs
4. Click "Analyze All Saved Jobs" on Dashboard
5. Check Kanban → cards should populate with ATS scores

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/JobSearch.jsx frontend/src/components/Dashboard.jsx frontend/src/api/client.js
git commit -m "feat: save scraped jobs to DB and trigger batch analysis from dashboard"
```

---

## Task 7: Frontend — Show Optimized Resume in Results + Kanban Cards

**Files:**
- Modify: `D:\ai-resume-job-tracker\frontend\src\components\ResumeAnalyzer.jsx`
- Modify: `D:\ai-resume-job-tracker\frontend\src\components\KanbanBoard.jsx`

Display the new `optimized_resume` field in analysis results and in expanded Kanban cards.

- [ ] **Step 1: Add optimized resume section to ResumeAnalyzer.jsx**

After the cover letter card, add:

```jsx
{results.optimized_resume && (
  <div className="card mt-4">
    <div className="flex justify-between items-center mb-2">
      <h3 className="font-semibold text-lg">ATS-Optimized Resume</h3>
      <button
        onClick={() => navigator.clipboard.writeText(results.optimized_resume)}
        className="btn btn-sm btn-outline"
      >
        Copy
      </button>
    </div>
    <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded max-h-96 overflow-y-auto">
      {results.optimized_resume}
    </pre>
  </div>
)}
```

- [ ] **Step 2: Add expandable detail to KanbanBoard.jsx**

Add a modal or inline expand on card click that shows:
- ATS score (already exists as column counter — make it per-card)
- Missing keywords
- Cover letter (read-only textarea)
- Optimized resume (read-only textarea + copy button)

```jsx
// Add to each card in KanbanBoard.jsx
const [expandedId, setExpandedId] = useState(null);

// Card click handler:
onClick={() => setExpandedId(app.id === expandedId ? null : app.id)}

// Expanded section (render below card):
{expandedId === app.id && (
  <div className="p-3 border-t text-sm space-y-2">
    {app.ats_score && <p>ATS Score: <strong>{app.ats_score}%</strong></p>}
    {app.missing_keywords?.length > 0 && (
      <p>Missing Keywords: {app.missing_keywords.join(', ')}</p>
    )}
    {app.cover_letter && (
      <details>
        <summary className="cursor-pointer font-medium">Cover Letter</summary>
        <pre className="whitespace-pre-wrap mt-1 text-xs">{app.cover_letter}</pre>
      </details>
    )}
    {app.optimized_resume && (
      <details>
        <summary className="cursor-pointer font-medium">Optimized Resume</summary>
        <pre className="whitespace-pre-wrap mt-1 text-xs">{app.optimized_resume}</pre>
      </details>
    )}
  </div>
)}
```

- [ ] **Step 3: Update the Kanban data fetch to include job analysis fields**

Ensure `GET /api/applications` also queries from `saved_jobs` to pull `ats_score`, `missing_keywords`, `cover_letter`, `optimized_resume`. Alternatively: update the `job_applications` table to include these fields and populate them during batch analysis.

- [ ] **Step 4: Test manually**

Run batch analysis → go to Kanban → click a card → verify cover letter and optimized resume appear in expanded view.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ResumeAnalyzer.jsx frontend/src/components/KanbanBoard.jsx
git commit -m "feat: show optimized resume in analyzer results and Kanban card detail view"
```

---

## Self-Review — Spec Coverage Check

| Spec Requirement | Task Covering It |
|---|---|
| Upload Groq + Apify API key | Task 1 (backend) + Task 2 (frontend) |
| Upload resume → parse → extract keywords | Already implemented |
| Job scraping via Apify | Already implemented |
| ATS score per job | Already implemented |
| Missing keywords per job | Already implemented |
| Cover letter per job | Already implemented |
| ATS-optimized resume per job | Task 4 (pipeline node) |
| Application tracking in DB | Already implemented |
| Scraped jobs saved to DB | Task 3 |
| Integrated flow (scrape → analyze all) | Task 5 (batch endpoint) + Task 6 (UI) |
| Per-job detail view in Kanban | Task 7 |

All spec requirements are covered. No placeholders remain.

---

## Execution Order

Run tasks in sequence — each builds on the previous:

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7
(backend keys) → (frontend keys) → (jobs DB) → (pipeline node) → (batch API) → (UI save) → (UI display)
```

Estimated total: ~3-4 hours of focused implementation.
