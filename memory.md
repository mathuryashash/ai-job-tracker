# Project Memory - AI Resume & Job Tracker

Last updated: 2026-04-09
Maintainer: Memory Update Subagent

## 1) Project Identity

- Name: AI Resume & Job Tracker
- Type: Full-stack web app for resume analysis + job application tracking + automation
- Primary users: final-year students and early-career job seekers
- Repository root: `D:\ai-resume-job-tracker`

## 2) Current Technical Reality (Code > Docs)

The docs describe Auth0/Firebase and Claude direct integration, but the current implementation is:

- Frontend: React 18 + Vite + Tailwind + React Query + DnD + Chart.js/Recharts
- Backend: Node.js + Express + TypeScript + Prisma + PostgreSQL + BullMQ + Redis
- AI integration: OpenRouter (`OPENROUTER_API_KEY`) using `anthropic/claude-3-sonnet`
- Auth in code: **Auth0 OIDC/JWKS flow** (migrated from demo-only custom JWT)
- Infra: Docker Compose with PostgreSQL + Redis + backend + frontend

## 3) Implemented Feature Surface

- Resume upload (PDF, 5 MB limit), extraction (`pdf-parse`), persistence
- Async resume analysis via BullMQ + worker + polling endpoint
- Cover letter generation via queue worker
- Job application Kanban tracking with drag/drop and status moves
- Activity timeline CRUD tied to applications
- Automation module that:
  - Searches multiple job sources/APIs/scrapers
  - Uses AI keyword extraction from resume (LangGraph)
  - Matches jobs vs resume
  - Creates applications + optional cover letters

## 4) Data Model Snapshot (Prisma)

Core models:

- `User` (email, name, auth0Sub, preferences JSON)
- `Resume` -> `ResumeAnalysis`
- `JobApplication` -> `Activity`
- `CoverLetter`
- Automation extensions: `JobSource`, `ScrapedJob`

Important note:

- `JobApplication` currently has index on `jobUrl`, but no unique `(userId, jobUrl)` constraint yet (race/dup risk remains).

## 5) Security and Reliability State

Already improved:

- **Auth0 OIDC/JWKS auth** — real credential-based authentication, no demo-only login
- Centralized SSRF guard with 10 protection layers (protocol, private IPs, IPv6, DNS rebinding, DoH, domain allowlist, pattern matching, timeout, size limits)
- JWT-based auth middleware replaced with Auth0 JWKS validation
- Global SSRF allowlist for all external URL fetches via `safeFetch.ts`
- Ownership checks added on many routes
- Zod validation present in many handlers
- Global error handler covers Zod + Prisma error codes
- Rate limiting present (auth/general/automation)
- CI security gates (dependency audit, gitleaks, Prisma schema check, typecheck, build)
- Integration tests for scheduler overlap, route status codes, auth stale-token, SSRF guard

Still incomplete or inconsistent:

- Queue shutdown lifecycle and failure notification path are incomplete
- Dedup race condition on `(userId, jobUrl)` still needs unique constraint

## 6) Documentation Drift

The following docs are strong but partially aspirational compared to code:

- `docs/plans/2026-03-24-ai-resume-job-tracker-prd.md`
- `docs/api/api-reference.md`
- `docs/architecture/system-architecture.md`
- `docs/security/security-best-practices.md`

Drift examples:

- Auth0/Firebase is documented — **now implemented** (was custom JWT before this session).
- Some endpoint behavior/documented contracts differ from live route code.

## 7) Known Open Issues (High Signal)

From implementation and issue docs:

1. Dedup race condition when creating applications from scraped jobs (unique constraint not yet added).
2. Missing robust notification/UX feedback for failed async jobs.
3. Upload lifecycle lacks per-user quota and cleanup policy.
4. Missing strict startup env validation and stronger config typing.
5. Logging correlation can improve (`X-Request-ID` propagation to client + cross-service flow).

## 8) Optimization Opportunities

### Backend

- Add unique DB constraint on `(userId, jobUrl)` and migrate create flow to `upsert`/transaction.
- Move route handlers toward centralized error semantics (reduce duplicated catch blocks).
- Add queue observability: job metrics, retries, failure reasons, user-facing status.
- Add bounded concurrency and per-source circuit breaker in scraping.
- Normalize cache keys to include `userId` and task context to avoid collisions.

### Frontend

- Replace many `useEffect + axios` calls with React Query `useQuery/useMutation` for cache consistency.
- Add optimistic updates with rollback hooks for Kanban moves.
- Add error boundaries and actionable error toasts instead of `alert()`.

### UX/UI

- Improve visual hierarchy and spacing rhythm on Dashboard/Automation (currently dense + utility-first default look).
- Add persistent status chips and job-source filters in Automation results.
- Add keyboard-accessible drag/drop affordances and better empty states.
- Add mobile-first layout adjustments for Kanban columns (horizontal snap + compact cards).
- Replace emoji-heavy nav with consistent icon set and stronger semantic labels.

## 9) LangChain / LlamaIndex / LangGraph Fit

LangGraph is already integrated for the automation orchestration pipeline. The graph has 6 nodes:
`load_user_resume` → `extract_keywords` → `build_search_queries` → `search_jobs` → `dedupe_jobs` → `process_jobs`.

LlamaIndex is situational — only needed if RAG-heavy features (resume corpus + job corpus retrieval memory) are added.

## 10) Memory Update Protocol

This file is the source-of-truth project memory. After each implementation iteration, update with:
- What changed (files + behavior)
- New decisions and rationale
- New risks/bugs discovered
- What was learned about architecture, UX, or operations

## 11) Iteration Log Template

### Iteration YYYY-MM-DD HH:MM

- Scope:
- Files changed:
- Behavior changes:
- Decisions made:
- Risks introduced:
- Verification performed:
- Learnings:
- Next follow-ups:

## 12) Iteration Log

### Iteration 2026-04-09 00:00

- Scope: Deep repository audit and context consolidation.
- Files changed: `memory.md` (created).
- Behavior changes: None (documentation-only update).
- Decisions made: Treat current implementation as canonical over aspirational docs for future planning.
- Risks introduced: None.
- Verification performed: Cross-checked docs, backend routes/services, frontend pages, Prisma schema, compose config.
- Learnings: Security and architecture improved but consistency and operational hardening remain top priorities.
- Next follow-ups: Start with dedup race fix + queue failure notifications + frontend auth/session reliability improvements.

## 13) Subagent Workflow

- Rule: After any code/doc/config change iteration, update `memory.md` before handoff.
- Required iteration-log fields: Scope, Files changed, Behavior changes, Decisions made, Risks introduced, Verification performed, Learnings, Next follow-ups.
- Reuse this same memory-maintenance subagent pattern after every future implementation iteration.

### Iteration 2026-04-09 00:15

- Scope: Bootstrap a reusable subagent workflow for memory maintenance.
- Files changed: `memory.md`.
- Behavior changes: None (documentation-only update; no runtime behavior changed).
- Decisions made: Standardize post-iteration memory updates via a dedicated subagent workflow.
- Risks introduced: None.
- Verification performed: Confirmed section and entry formatting align with existing memory conventions.
- Learnings: A fixed subagent closeout protocol reduces drift in project memory quality.
- Next follow-ups: Reuse this workflow after each future implementation iteration.

### Iteration 2026-04-09 00:45

- Scope: Frontend reliability and UX iteration focused on auth session restore, route loading performance, global error containment, and mobile usability.
- Files changed: `frontend/src/context/AuthContext.tsx`, `frontend/src/App.tsx`, `frontend/src/components/ErrorBoundary.tsx`, `frontend/src/main.tsx`, `frontend/src/pages/JobTracker.tsx`, `frontend/src/pages/ResumeAnalyzer.tsx`.
- Behavior changes: Auth now attempts token-based session restoration via `/api/auth/me` and clears invalid token/session state with explicit loading handling; page routes now load with `React.lazy` + `Suspense`; app now has a global UI error boundary with retry/refresh actions; Job Tracker mobile columns now use horizontal snap scrolling and improved delete-button accessibility; Resume Analyzer removed unused auth state and uses frontend-safe `ReturnType<typeof setInterval>` typing.
- Decisions made: Prefer server-validated session restoration over token-only local restore; adopt route-level code splitting for initial load performance; add a top-level error boundary for graceful recovery from unexpected render/runtime errors.
- Risks introduced: Suspense fallbacks may briefly mask slow-loading routes; stricter invalid-token clearing can sign users out more aggressively when backend auth responses fail; frontend linting remains unguarded because no ESLint config is present.
- Verification performed: Frontend build passed via `npm run build`; frontend lint check failed due to missing ESLint configuration in the frontend project.
- Learnings: Session restoration is more trustworthy when user identity is revalidated from backend on app bootstrap; global error boundaries and lazy loading improve resilience/perceived performance with low code surface area; `NodeJS.Timeout` should be avoided in browser-only TypeScript codepaths.
- Next follow-ups: Add/standardize frontend ESLint config and lint script; add tests for auth-restore invalid-token path and error-boundary actions; monitor route fallback UX and tune loading states if transitions feel abrupt on slower networks.

### Iteration 2026-04-09 01:20

- Scope: LangGraph scaffolding iteration for backend auto-apply orchestration with a minimal runnable workflow and test-first validation.
- Files changed: `backend/jest.config.cjs` (added), `backend/src/services/automation.graph.test.ts` (added), `backend/src/services/automation.graph.ts` (added), `backend/src/services/auto-apply.service.ts` (updated), backend dependencies `@langchain/langgraph` and `@langchain/core` (installed).
- Behavior changes: `runAutoApply` now routes through a LangGraph `invoke` path and executes legacy automation logic via an executor callback node; graph state now has explicit annotation and default initial-state coverage.
- Decisions made: Introduce LangGraph as a scaffold first (single execution node) to preserve current behavior while establishing typed workflow/state structure; validate graph contract with TDD red->green tests before wiring broader node branching.
- Risks introduced: New dependency surface area and orchestration layer add integration complexity; graph shell currently relies on legacy callback internals, so partial migration could hide boundary issues until more nodes are added.
- Verification performed: `npm test -- automation.graph.test.ts` passed; `npm run build` in backend still fails due to pre-existing unrelated TypeScript issues (auth typing, Prisma drift, routes).
- Learnings: A thin LangGraph wrapper can be introduced without immediate behavioral regression when legacy execution is encapsulated as a callback node; state-default tests are useful guardrails for incremental graph expansion.
- Next follow-ups: Expand graph beyond single node (search/match/tailor/generate/persist steps), add integration tests around callback error propagation/retries, and resolve existing unrelated backend TypeScript build failures blocking clean CI.

### Iteration 2026-04-09 01:45

- Scope: Expand LangGraph automation orchestration from a single executor node to include graph-level pre-processing of resume/context inputs before legacy execution.
- Files changed: `backend/src/services/automation.graph.ts`, `backend/src/services/auto-apply.service.ts`, `backend/src/services/automation.graph.test.ts`.
- Behavior changes: LangGraph now includes `load_user_resume`, `extract_keywords`, and `build_search_queries` nodes before execution; `auto-apply.service.ts` now runs the legacy executor against graph-prepared state (`resumeText`, `searchQueries`, `extractedKeywords`) instead of recomputing those steps in the service path.
- Decisions made: Export helper node functions from `automation.graph.ts` (`loadUserResumeNode`, `extractKeywordsNode`, `buildSearchQueries`) to improve testability/reuse; extend `AutomationGraphState` with `resumeText` and update graph annotations/edges to make pre-processing outputs explicit in state.
- Risks introduced: Hybrid architecture (graph pre-processing + legacy executor) can drift if logic changes in one layer without corresponding updates in the other; fallback query behavior may hide upstream keyword extraction quality issues.
- Verification performed: `npm test -- automation.graph.test.ts` passed (4 tests); `npm run build` in backend still fails due to pre-existing unrelated TypeScript issues (auth typing, Prisma model drift, some routes).
- Learnings: Incremental graph expansion with explicit state fields and exported helper nodes enables TDD coverage for node ordering and fallback query behavior while preserving existing execution internals.
- Next follow-ups: Continue migrating legacy executor internals into first-class LangGraph nodes, add broader integration coverage around graph-to-executor state handoff, and resolve unrelated backend TypeScript build blockers for clean CI.

### Iteration 2026-04-09 02:05

- Scope: Complete LangGraph full-node migration for core automation execution path.
- Files changed: `backend/src/services/automation.graph.ts`, `backend/src/services/auto-apply.service.ts`, `backend/src/services/automation.graph.test.ts`.
- Behavior changes: Graph now includes `search_jobs`, `dedupe_jobs`, and `process_jobs`; business logic moved from the auto-apply legacy executor into `automation.graph` node helpers with dependency injection; `runAutoApply` simplified to a pure graph `invoke` path.
- Decisions made: Finalize migration by promoting execution steps to first-class graph nodes and inject dependencies into node helpers to keep orchestration deterministic and testable.
- Risks introduced: Dependency wiring errors in injected node helpers could cause runtime failures; tighter graph coupling may surface hidden assumptions previously masked in the legacy executor.
- Verification performed: Expanded `automation.graph` tests and confirmed they pass.
- Learnings: Moving orchestration and business logic fully into graph nodes reduces service complexity and makes execution flow easier to reason about and validate.
- Next follow-ups: Add broader integration coverage across graph error/retry branches and continue hardening dependency contracts for node helper inputs.

### Iteration 2026-04-09 02:20

- Scope: Parallel subagent debugging pass to stabilize backend TypeScript build and LangGraph test path.
- Files changed: `backend/src/middleware/auth.ts`, `backend/src/routes/automation.routes.ts`, `backend/src/routes/scraper.routes.ts`, `backend/src/services/scheduler.service.ts`, Prisma client artifacts.
- Behavior changes: TypeScript build blockers were fixed in `auth.ts`, `automation.routes.ts`, `scraper.routes.ts`, and `scheduler.service.ts`; backend build now passes; Prisma client was regenerated; targeted LangGraph tests pass.
- Decisions made: Use parallel subagents to isolate and resolve independent TypeScript failures quickly, then converge on a single validated build/test state.
- Risks introduced: Concurrent fixes can introduce subtle cross-file regression risk if assumptions diverge; regenerated Prisma client can drift again if schema changes without synchronized regeneration.
- Verification performed: Ran backend build successfully, regenerated Prisma client, and confirmed targeted LangGraph tests pass.
- Learnings: Parallelized debugging is effective for independent compilation failures when merged with disciplined final verification.
- Next follow-ups: Add CI guards for Prisma client/schema sync and expand TypeScript + LangGraph regression coverage to catch future cross-file breakage earlier.

### Iteration 2026-04-09 02:50

- Scope: Parallel subagent security/code review and hardening pass across frontend auth/session flow, ResumeAnalyzer interaction lifecycle, automation/scraper route validation, and scheduler execution safety.
- Files changed: `frontend/src/context/AuthContext.tsx`, `frontend/src/pages/ResumeAnalyzer.tsx`, `backend/src/routes/automation.routes.ts`, `backend/src/routes/scraper.routes.ts`, `backend/src/services/scheduler.service.ts`, related backend/frontend build and test-touched files.
- Behavior changes: Frontend auth/session handling is more robust in `AuthContext`; ResumeAnalyzer polling lifecycle is stabilized and keyboard accessibility interactions improved; automation routes now enforce SSRF DNS/IP checks, query boolean coercion, payload max lengths, and auth guard on `/tailor`; scraper routes now propagate upstream status codes and enforce tighter preferences schema limits; scheduler now guards overlap, executes with frequency/nextRun awareness, and performs strict boolean/string extraction in config.
- Decisions made: Run security and code review in parallel subagents to accelerate hardening; prioritize defensive input/network validation for automation endpoints; make scheduler execution idempotence and timing awareness explicit rather than implicit.
- Risks introduced: Stricter validation and auth guards can reject previously accepted loose inputs; tighter scheduler overlap/frequency handling may surface latent config inconsistencies; upstream status propagation could expose more non-2xx paths to clients that previously saw generic responses.
- Verification performed: Backend build succeeded; frontend build succeeded; backend automation graph tests passed; changes were committed in three commits.
- Learnings: Coordinated parallel review plus targeted hardening reduces reliability/security gaps quickly when followed by explicit build and test verification.
- Next follow-ups: Add regression tests for SSRF guard edge cases and boolean coercion paths, add scheduler concurrency/timing integration tests, and monitor client handling for newly propagated scraper status codes.

### Iteration 2026-04-09 03:15

- Scope: Second parallel hardening batch — real Auth0/OIDC auth, CI security gates, centralized SSRF policy, and integration tests.
- Files changed:
  - Created: `backend/src/middleware/auth0.ts`, `backend/src/config/ssrf.config.ts`, `backend/src/utils/ssrf.ts`, `backend/src/utils/safeFetch.ts`, `backend/src/utils/ssrf.test.ts`, `backend/tsconfig.build.json`, `.github/workflows/security.yml`, `security-allowlist.json`, `.gitleaks.toml`, `.gitleaksignore`, `.git/hooks/pre-commit`, `backend/src/__tests__/integration/scheduler.integration.test.ts`, `backend/src/__tests__/integration/routes.status-codes.integration.test.ts`, `backend/src/__tests__/integration/auth.stale-token.integration.test.ts`, `frontend/src/__tests__/AuthContext.integration.test.tsx`
  - Modified: `backend/src/middleware/auth.ts`, `backend/src/routes/auth.routes.ts`, `backend/prisma/schema.prisma`, `backend/.env.example`, `frontend/.env.example`, `frontend/src/context/AuthContext.tsx`, `frontend/src/pages/Login.tsx`, `frontend/src/App.tsx`, `backend/src/routes/automation.routes.ts`, `backend/src/services/job-scraper.service.ts`, `backend/src/__tests__/unit/ssrf.test.ts`, `backend/package.json`, `backend/jest.config.cjs`, `frontend/package.json`
- Behavior changes:
  - **Auth**: Demo-only login replaced with Auth0 OIDC/JWKS flow; `/login` and `/register` endpoints removed; `auth0Sub` field added to User model; frontend now uses `@auth0/auth0-spa-js` PKCE flow; scheduler marked with TODO for post-Auth0 user lookup.
  - **CI**: 5 parallel security jobs added (dep audit, gitleaks, Prisma schema check, backend typecheck, frontend build); gitleaks pre-commit hook added; `security-allowlist.json` mechanism for documented accepted vulnerabilities.
  - **SSRF**: Centralized `ssrf.ts` guard with 10 protection layers (protocol, hostname, private IPs, IPv6, DNS rebinding, DoH fallback, domain allowlist, pattern matching, timeout, size limits); `safeFetch.ts` wrapper; all external URL fetches now use centralized guard.
  - **Integration tests**: 5 test files covering scheduler overlap/cadence, route 4xx status codes, auth stale-token session clearing, SSRF guard blocking, and frontend AuthContext logout flow; MSW for frontend HTTP mocking.
- Decisions made: Auth0 was chosen because it was already documented and fits the PKCE SPA flow without needing a backend session; CI uses parallel jobs to keep total runtime under 5 min; SSRF guard uses DNS-over-HTTPS fallback to prevent DNS rebinding; integration tests use mocked Prisma/Redis to stay deterministic.
- Risks introduced: Auth0 migration requires env vars and tenant setup before the app is functional; gitleaks pre-commit requires local installation; SSRF guard DNS checks add latency on every external URL; test mocking may drift from real behavior if dependencies change.
- Verification performed: Backend `npm run build` passes; frontend `npm run build` passes; SSRF unit tests (47 tests) pass.
- Learnings: Auth0 PKCE flow eliminates the need for backend session management but requires tenant configuration; centralized SSRF guards are far easier to audit than inline checks scattered across routes; integration tests with mocked deps catch regressions without requiring full Docker infra in every test run.
- Next follow-ups: Run `npx prisma migrate dev` to apply `auth0Sub` schema change; configure Auth0 tenant with redirect URI; set up GitHub Actions secrets; install gitleaks locally; add E2E tests (Playwright) for auth flow.
