# AI Resume Job Tracker - Technical Architecture & Documentation

> Comprehensive analysis of the application's core functionality, data flow, and potential improvements.

---

## Table of Contents

1. [Core Functionality Overview](#1-core-functionality-overview)
2. [Data Flow Architecture](#2-data-flow-architecture)
3. [PDF Processing Pipeline](#3-pdf-processing-pipeline)
4. [Job Search & Retrieval](#4-job-search--retrieval)
5. [Resume Analysis & Matching](#5-resume-analysis--matching)
6. [Data Storage & Models](#6-data-storage--models)
7. [Job Application Tracking](#7-job-application-tracking)
8. [Automation System](#8-automation-system)
9. [Current Issues & Limitations](#9-current-issues--limitations)
10. [Additional Topics & Recommendations](#10-additional-topics--recommendations)

---

## 1. Core Functionality Overview

The **AI Resume Job Tracker** is a full-stack web application that helps users:
- **Upload & analyze resumes** - Extract text from PDF, analyze skills, match to jobs
- **Search jobs** - Query multiple job boards simultaneously
- **Track applications** - Manage job applications with Kanban-style board
- **Automate job search** - Auto-search, match, and log applications based on resume

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Backend | Express.js, TypeScript, Node.js |
| Database | PostgreSQL, Prisma ORM |
| AI/ML | Claude API (via ai.service), keyword matching |
| Job Sources | 12+ APIs (Remotive, Remote OK, Apify, etc.) |

---

## 2. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React)                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Dashboard  │  │ ResumeAnalyzer│  │  JobTracker │  │ Automation  │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘   │
│         │               │                │                │          │
│         └───────────────┴────────────────┴────────────────┘          │
│                               │                                        │
│                    ┌──────────┴──────────┐                            │
│                    │  AuthContext (JWT)  │                            │
│                    └──────────┬──────────┘                            │
└───────────────────────────────┼───────────────────────────────────────┘
                                │ HTTP + JSON
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BACKEND (Express.js)                             │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                      API Routes                                   │  │
│  │  /api/auth/*  /api/resumes/*  /api/applications/*  /api/jobs/*    │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                               │                                        │
│                    ┌──────────┴──────────┐                            │
│                    │     Middleware      │                            │
│                    │  - Auth (JWT/Auth0) │                            │
│                    │  - Validation (Zod)  │                            │
│                    │  - SSRF Protection   │                            │
│                    └──────────┬──────────┘                            │
│                               │                                        │
│                    ┌──────────┴──────────┐                            │
│                    │     Services Layer   │                            │
│                    │  - resume.service    │                            │
│                    │  - job-scraper       │                            │
│                    │  - job-matching      │                            │
│                    │  - ai.service        │                            │
│                    │  - automation.graph   │                            │
│                    └──────────┬──────────┘                            │
└───────────────────────────────┼───────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      DATABASE (PostgreSQL)                              │
│                              │                                          │
│    ┌────────────────────────┼────────────────────────┐                │
│    │                        │                        │                 │
│    ▼                        ▼                        ▼                │
│ ┌──────┐              ┌──────────┐           ┌──────────────┐        │
│ │ User │              │ Resume   │           │JobApplication│        │
│ └──────┘              └──────────┘           └──────────────┘        │
│    │                        │                        │                │
│    └────────────────────────┴────────────────────────┘                │
│                             │                                         │
│                    ┌────────┴────────┐                                │
│                    │   Prisma ORM    │                                │
│                    └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────────────┘
```

### Authentication Flow

1. **Dev Mode**: User submits email/name → `/api/auth/dev-login` → Returns JWT
2. **Production**: Auth0 redirect → OAuth callback → JWT issued
3. **All Requests**: `Authorization: Bearer <token>` header validated by middleware

---

## 3. PDF Processing Pipeline

### Upload Flow

```
User selects PDF
       │
       ▼
┌──────────────────┐
│  Frontend Axios  │
│  POST /upload    │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────────┐
│           Backend Processing                  │
│  ┌────────────────────────────────────────┐   │
│  │ 1. Multer validates:                   │   │
│  │    - File type = application/pdf        │   │
│  │    - Size < 5MB                         │   │
│  │    - Disk space available               │   │
│  └──────────────┬─────────────────────────┘   │
│                 ▼                             │
│  ┌────────────────────────────────────────┐   │
│  │ 2. pdf-parse extracts text:             │   │
│  │    fs.readFileSync(path)                │   │
│  │    pdf(dataBuffer).text                 │   │
│  └──────────────┬─────────────────────────┘   │
│                 ▼                             │
│  ┌────────────────────────────────────────┐   │
│  │ 3. Prisma stores:                       │   │
│  │    - filename, originalName, size       │   │
│  │    - extractedText                      │   │
│  │    - userId, createdAt                 │   │
│  └──────────────┬─────────────────────────┘   │
└─────────────────┼────────────────────────────┘
                  ▼
         { success: true, data: { id, ... } }
```

### Code Reference

**File:** `backend/src/services/resume.service.ts`
```typescript
export async function extractTextFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  return data.text || '';
}
```

**Limitations:**
- Only supports PDF (not DOCX, images)
- Uses `pdf-parse` which may fail on encrypted/password-protected PDFs
- No OCR for image-based PDFs

---

## 4. Job Search & Retrieval

### Supported Sources

| Source | Type | API Key Required | Status |
|--------|------|------------------|--------|
| Remotive | API | No | ✅ Working |
| Remote OK | API | No | ✅ Working |
| We Work Remotely | API | No | ✅ Working |
| Wellfound | API | No | ✅ Working |
| Remote.co | API | No | ✅ Working |
| Arbeitnow | API | No | ✅ Working |
| Apify | Scraping | Yes | ✅ Working |
| Jooble | API | Yes | ⚠️ Needs key |
| FlexJobs | API | Yes | ⚠️ Needs key |
| Indeed | API | Yes | ⚠️ Needs key |
| Adzuna | API | Yes | ⚠️ Needs key |
| Internshala | Scraping | Yes (via Apify) | ⚠️ Needs key |

### Search Architecture

```typescript
// backend/src/services/job-scraper.service.ts
export async function searchJobs(params: JobSearchParams, userApiKeys?: UserApiKeys) {
  // 12 sources run in parallel (concurrency limit = 3)
  const sources = [
    searchApifyJobs,       // Premium (user's API key or env)
    searchRemotive,        // Free
    searchWeWorkRemotely,   // Free
    searchRemoteOK,        // Free
    // ... etc
  ];
  
  // Concurrent execution with timeout (15s per source)
  const results = await runWithConcurrencyLimit(sources, 3, fn, 15000);
  
  // Filter for remote jobs if requested
  return jobs.filter(job => job.location.includes('remote'));
}
```

### Data Retrieval Flow

```
User enters keywords + location
        │
        ▼
┌─────────────────────────────┐
│ /api/automation/search     │
│ ?keywords=react&remote=true│
└────────────┬────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────┐
│ Fetch user's API keys from database                     │
│ prisma.user.findUnique({ where: { id: userId }})        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Search 12 sources concurrently                         │
│ - Each source has 15s timeout                          │
│ - Failures logged but don't stop others                │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Deduplicate + filter remote jobs                        │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
         [{ title, company, location, description, url, source }]
```

### API Key Management

- User enters API keys in Automation page UI
- Keys stored in `User.preferences` JSON field
- Passed to job scraper on each search request
- Supports: Apify, Jooble, FlexJobs, Indeed, Adzuna, Internshala

---

## 5. Resume Analysis & Matching

### Analysis Flow

```
Resume (extracted text) + Job Description
                │
                ▼
┌─────────────────────────────┐
│  1. Keyword Extraction      │
│  - Extract tech keywords    │
│  - Identify skills          │
│  - Determine role type     │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  2. AI Matching (Claude)   │
│  - Compare resume to job   │
│  - Calculate match %        │
│  - Identify strengths/gaps │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  3. Generate Analysis       │
│  - matchPercentage (0-100) │
│  - matchedSkills []         │
│  - missingSkills []         │
│  - strengths []            │
│  - weaknesses []            │
│  - suggestions []           │
└─────────────────────────────┘
```

### Keyword Matching Algorithm

**File:** `backend/src/services/job-matching.service.ts`

```typescript
export function calculateKeywordMatch(resumeText: string, jobDescription: string): number {
  const jobKeywords = extractKeywords(jobDescription);
  const resumeKeywords = extractKeywords(resumeText);
  
  // Fuzzy matching: keyword in resume OR resume word in keyword
  let matches = 0;
  for (const keyword of jobKeywords) {
    if (resumeKeywords.some(rk => rk.includes(keyword) || keyword.includes(rk))) {
      matches++;
    }
  }
  
  return Math.round((matches / jobKeywords.length) * 100);
}

const techKeywords = [
  'javascript', 'typescript', 'python', 'java', 'react', 'angular', 'vue',
  'node', 'express', 'django', 'aws', 'azure', 'docker', 'kubernetes', ...
];
```

### AI-Powered Matching (Claude)

**File:** `backend/src/services/ai.service.ts`

Uses Claude API to perform deeper analysis:
- Semantic understanding of skills
- Context-aware matching
- Professional level assessment

---

## 6. Data Storage & Models

### Database Schema (PostgreSQL + Prisma)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER                                           │
│  id, email, name, picture, auth0Sub, preferences (JSON), createdAt        │
│  ─────────────────────────────────────────────────────────────────────       │
│  relations: resumes[], applications[], coverLetters[], jobSources[]         │
└─────────────────────────────────────────────────────────────────────────────┘
         │
    ┌─────┴──────────────────────────────────────────────────────────┐
    │                    │                              │               │
    ▼                    ▼                              ▼               ▼
┌─────────┐        ┌─────────────┐              ┌────────────────┐ ┌──────────┐
│ Resume  │        │ JobApplication          │ CoverLetter    │ │ JobSource│
├─────────┤        ├─────────────┤              ├────────────────┤ ├──────────┤
│ id      │        │ id          │              │ id             │ │ id       │
│ userId  │───────▶│ userId      │◀─────────────│ userId         │ │ userId   │
│ filename│        │ companyName │              │ applicationId  │ │ name     │
│ originalName     │ positionTitle              │ content        │ │ keywords │
│ extractedText    │ jobDescription             │ createdAt     │ │ location │
│ createdAt        │ jobUrl    │   ┌───────────▶│                │ │ enabled  │
│         │        │ status (todo/applied/     │               │ │ createdAt│
│ analyses[]       │ interviewing/offer/rejected)            │ │          │
└─────────┘        │ matchScore  │   │          │               │ │          │
    │              │ resumeId    │   │          │               │ │ scrapedJobs[]
    │              │ coverLetterId              │               │ └──────────┘
    │              │ scrapedJobId│   │          │               │
    │              │ createdAt  │   │          │               │
    │              └──────┬─────┘   │          │               │
    │                    │         │          │               │
    │              ┌─────┴───────┐ │          │               │
    │              │ Activity   │ │          │               │
    │              ├────────────┤ │          │               │
    │              │ id         │ │          │               │
    │              │ applicationId─────────────┤               │
    │              │ type (note/status/...)  │               │
    │              │ description             │               │
    │              │ metadata (JSON)         │               │
    │              │ createdAt               │               │
    │              └─────────────────────────┘               │
    │                                                        │
    └────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │   ScrapedJob     │
                    ├──────────────────┤
                    │ id               │
                    │ userId           │
                    │ externalId (src) │
                    │ source           │
                    │ title            │
                    │ company          │
                    │ location        │
                    │ description     │
                    │ url             │
                    │ salary          │
                    │ postedDate      │
                    │ matchScore     │
                    │ status (new/matched/applied/skipped) │
                    │ processedAt     │
                    │ createdAt       │
                    └──────────────────┘
```

### Key Indexes

- `JobApplication: [userId, status]` - Filter by status
- `JobApplication: [userId, createdAt]` - Sort by date
- `JobApplication: [jobUrl]` - Unique constraint with userId
- `ScrapedJob: [source, externalId]` - Prevent duplicate scrapes

---

## 7. Job Application Tracking

### Application States

| Status | Description | Kanban Column |
|--------|-------------|---------------|
| `todo` | Not yet applied | To Do |
| `applied` | Application submitted | Applied |
| `interviewing` | Interview scheduled | Interviewing |
| `offer` | Received offer | Offer |
| `rejected` | Application rejected | Rejected |

### Drag-and-Drop Implementation

**Frontend:** `frontend/src/pages/JobTracker.tsx`
```typescript
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const handleDragEnd = async (result) => {
  const { draggableId, destination } = result;
  const newStatus = destination.droppableId;
  
  // Optimistic update
  setApplications(prev => prev.map(app => 
    app.id === draggableId ? { ...app, status: newStatus } : app
  ));
  
  // Persist to backend
  await axios.post(`/api/applications/${draggableId}/move`, { status: newStatus });
};
```

### Activity Tracking

Every status change creates an `Activity` record:
```typescript
{
  type: 'status_change',
  description: 'Moved to Applied',
  metadata: { from: 'todo', to: 'applied', timestamp: '...' }
}
```

---

## 8. Automation System

### Automation Graph (LangGraph)

**File:** `backend/src/services/automation.graph.ts`

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Automation Pipeline                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐                                                   │
│  │ load_user_resume│ ──▶ Fetch latest resume from DB                  │
│  └────────┬────────┘                                                   │
│           ▼                                                            │
│  ┌─────────────────┐                                                   │
│  │ extract_keywords│ ──▶ AI extract skills, role type, search queries  │
│  └────────┬────────┘                                                   │
│           ▼                                                            │
│  ┌─────────────────┐                                                   │
│  │build_search_    │ ──▶ Combine keywords + location                    │
│  │    queries      │                                                   │
│  └────────┬────────┘                                                   │
│           ▼                                                            │
│  ┌─────────────────┐                                                   │
│  │   search_jobs   │ ──▶ Query 12 job sources (with user's API keys)   │
│  └────────┬────────┘                                                   │
│           ▼                                                            │
│  ┌─────────────────┐                                                   │
│  │   dedupe_jobs  │ ──▶ Remove duplicates by URL                       │
│  └────────┬────────┘                                                   │
│           ▼                                                            │
│  ┌─────────────────┐                                                   │
│  │  process_jobs  │ ──▶ For each job:                                  │
│  │                 │      1. Check if already exists                   │
│  │                 │      2. Get job description (if needed)           │
│  │                 │      3. Match resume to job (AI)                 │
│  │                 │      4. Check threshold                           │
│  │                 │      5. If passed: create application + cover letter │
│  └────────┬────────┘                                                   │
│           ▼                                                            │
│        [RESULTS]                                                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Automation Results

```typescript
interface AutomationResult {
  results: {
    job: Job;
    matchResult: MatchResult;
    applicationCreated: boolean;
    applicationId?: string;
    coverLetter?: string;
    error?: string;
  }[];
  extractedKeywords: {
    searchQueries: string[];
    skills: string[];
    roleType: 'internship' | 'job' | 'both';
  };
  sourceStats: Record<string, number>;
}
```

---

## 9. Current Issues & Limitations

### Critical Issues

| Issue | Severity | Description |
|-------|----------|-------------|
| Disk space check failing on Windows | 🔴 High | `wmic` command fails, causing all uploads to be rejected |
| Auth token expiration not handled | 🔴 High | No token refresh mechanism |
| No rate limiting on job sources | 🟡 Medium | Could get IP-banned by job sites |

### Functional Limitations

| Issue | Severity | Description |
|-------|----------|-------------|
| Only PDF supported | 🟡 Medium | Cannot parse DOCX, images, scanned PDFs |
| No resume parsing for structured data | 🟡 Medium | Skills extracted via simple keyword matching |
| API keys stored in plain JSON | 🟡 Medium | Should be encrypted at rest |
| No job application scheduling | 🟡 Medium | Can't schedule future applications |

### Architecture Concerns

| Issue | Description |
|-------|-------------|
| No caching layer | Same job searches hit APIs repeatedly |
| No message queue | Background jobs processed synchronously |
| Tightly coupled services | Hard to test individual components |
| No WebSocket support | Real-time updates require polling |

### Known Bugs

1. **Upload fails on low disk space** - False positive due to `wmic` failure
2. **Job search timeout not handled gracefully** - Silent failures
3. **Cover letters not linked to applications** - Orphaned records
4. **Source stats incorrect** - Some sources don't return proper counts

---

## 10. Additional Topics & Recommendations

### Additional Topics to Explore

1. **Security Enhancements**
   - Encrypt API keys at rest
   - Add rate limiting per user
   - Implement CSRF protection

2. **Performance Optimization**
   - Add Redis caching for job searches
   - Implement background job queue (BullMQ)
   - Database query optimization (connection pooling)

3. **User Experience Improvements**
   - Real-time WebSocket updates for application status
   - Email notifications for new matches
   - Browser notifications for automation completion

4. **Data & Analytics**
   - Application success rate tracking
   - Time-to-response analytics
   - Source effectiveness comparison

5. **AI/ML Enhancements**
   - Resume parsing with LLM (structured extraction)
   - Job recommendation engine
   - Salary prediction
   - Company research automation

6. **Integration Opportunities**
   - LinkedIn Easy Apply integration
   - Email integration for applications
   - Calendar integration for interviews
   - Slack/Discord notifications

### Recommended Improvements (Priority Order)

| Priority | Improvement | Effort | Impact |
|----------|-------------|--------|--------|
| P0 | Fix disk space check | Low | High |
| P1 | Add token refresh | Medium | High |
| P1 | Implement rate limiting | Medium | High |
| P2 | Add caching layer | Medium | Medium |
| P2 | Support DOCX/OCR | High | Medium |
| P3 | Real-time WebSocket | High | High |

---

## Appendix: API Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/dev-login` | Dev authentication |
| POST | `/api/resumes/upload` | Upload PDF resume |
| GET | `/api/resumes/:id/analysis` | Get resume analysis |
| POST | `/api/resumes/:id/analyze` | Trigger analysis |
| GET | `/api/applications` | List applications |
| POST | `/api/applications` | Create application |
| POST | `/api/applications/:id/move` | Update status |
| GET | `/api/automation/search` | Search jobs |
| POST | `/api/automation/trigger` | Run automation |
| GET | `/api/automation/stats` | Get dashboard stats |
| GET | `/api/automation/sources` | List job sources |
| GET/POST | `/api/automation/api-keys` | Manage API keys |

---

*Document generated from codebase analysis*
*Last updated: April 2026*