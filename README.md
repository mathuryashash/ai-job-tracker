# AI Resume & Job Tracker

## Hybrid RAG + LangGraph agent (new)

The tracker now grounds everything it writes in retrieved resume evidence and includes a tool-using agent. Commands and raw output are in [VERIFY.md](VERIFY.md).

- **Hybrid retrieval:** BM25 + pgvector dense search, Reciprocal Rank Fusion, cross-encoder rerank. On 39 labelled requirements: recall@3 1.0, MRR 0.969.
- **Cited, evidence-gated generation:** cover letters cite chunk ids; requirements without evidence are listed as gaps, never claimed. On a 50-case eval harness, claim faithfulness rose 0.72 -> 0.90 and prompt-injection resistance 1/5 -> 5/5.
- **LangGraph agent** (`python -m src.agent "find remote python backend jobs and shortlist the best 3"`): 5 typed tools (search, fetch, analyze_fit, tailor_bullets, save_to_tracker), retries with backoff, reflection, step budget, SQLite checkpoints, and a human-in-the-loop interrupt before any write. Streaming API at `/api/agent/run` and `/api/agent/resume`.
- **Trajectory evals:** 27/29 tasks passed on fresh runs, 0 writes without approval (including 3 prompt-injection job posts), 3/3 live searches.

Caveats: small, partly synthetic eval sets; most agent runs used Gemini flash-lite because the Groq daily limit was reached.


An AI-powered application that analyzes resumes against job descriptions, generates tailored cover letters, searches live job postings, and tracks applications through a Kanban pipeline.

## Features

- 📄 **Resume Analysis (ATS Fit Score)**: Upload a PDF resume and a job description to get a 0-100 match score combining semantic similarity (embeddings) and LLM-based keyword analysis.
- 🔑 **Keyword Gap Detection**: Identifies skills/keywords present in the job description but missing from the resume.
- 💌 **AI Cover Letter Generation**: Drafts a tailored cover letter based on the resume, job description, and identified skill gaps.
- 🔍 **Job Search**: Searches live job postings across LinkedIn, Indeed, and Glassdoor (via Apify) and Tinyfish.
- 📋 **Kanban Application Tracker**: Track applications through `todo`, `applied`, `interviewing`, `offer`, and `rejected` stages.
- 🖥️ **Two UIs**: A React (Vite) single-page app and a Streamlit dashboard, both backed by the same FastAPI service.

## Technology Stack

### Backend (`src/`)
- FastAPI (`src/main.py`) — REST API
- LangGraph pipeline (`src/pipeline.py`) — orchestrates resume parsing, keyword extraction, RAG alignment scoring, and cover letter generation
- Groq (Llama 3.3 70B via `langchain-groq`) for keyword extraction, match scoring, and cover letter generation
- `sentence-transformers` (`all-MiniLM-L6-v2`) for resume/job description embeddings
- PostgreSQL + `pgvector` for storage and similarity search (`src/db.py`)
- Job search integrations via Apify and Tinyfish (`src/job_search.py`)
- `pypdf` for resume text extraction

### Frontends
- **React + Vite** (`frontend/`) — primary SPA (Dashboard, Resume Analyzer, Job Search, Kanban Board, Settings)
- **Streamlit** (`src/app.py`) — alternative dashboard UI

### Infrastructure
- Docker Compose: `pgvector/pgvector` Postgres image, FastAPI backend, Streamlit frontend

## Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+ (for the React frontend)
- Docker & Docker Compose (optional, for containerized setup)
- A [Groq API key](https://console.groq.com/) (required for AI features)

### Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `GROQ_API_KEY` | Groq API key for LLM calls |
| `GROQ_MODEL` | Groq model name (default: `openai/gpt-oss-120b`; also selectable in Settings) |
| `APIFY_TOKEN` | Apify token for LinkedIn/Indeed/Glassdoor job search |
| `TINYFISH_API_KEY` | Tinyfish API key for job search |
| `BACKEND_HOST` / `BACKEND_PORT` | FastAPI host/port (default `0.0.0.0:8000`) |
| `BACKEND_URL` | Backend URL used by the Streamlit/React frontends |

### Run with Docker Compose

```bash
docker compose up --build
```

This starts:
- PostgreSQL with `pgvector` on port `5433`
- FastAPI backend on port `8000`
- Streamlit dashboard on port `8501`

### Run Locally

**Backend:**
```bash
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8000
```

**Streamlit dashboard:**
```bash
streamlit run src/app.py
```

**React frontend:**
```bash
cd frontend
npm install
npm run dev
```

### Run Tests

```bash
pytest
```

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service and database health check |
| `/api/analyze` | POST | Upload resume + job description, returns match score, keywords, and cover letter |
| `/api/applications` | GET/POST | List or create Kanban applications |
| `/api/applications/{id}` | PUT/DELETE | Update status or delete an application |
| `/api/search/jobs` | POST | Search jobs across configured platforms |
| `/api/search/platforms` | GET | List available job search platforms and their config status |
