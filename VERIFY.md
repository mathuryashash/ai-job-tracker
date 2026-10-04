# VERIFY — LangGraph job agent (branch `hermes/job-agent`)

Worktree `D:/ai-build/jobtracker-agent`, based on `hermes/real-rag` (14820a0). The RAG branch's own VERIFY and resume lines are in
`docs/VERIFY_RAG.md` and `docs/RESUME_LINES_RAG.md`. Python: `D:/ai-resume-job-tracker/venv`. Every command uses `HF_HOME=D:/hf-cache HF_HUB_OFFLINE=1`.
Keys come from `.hermes-qa/sandbox.env` (gitignored, copied from the RAG worktree) and `AGENT_KEYS_ENV=D:/ascent_hackathon/.env`.
They are read into memory only, never printed and never committed. One new dependency: `langgraph-checkpoint-sqlite` (installed in the venv).

## What was built (`src/agent/`)
- `tools.py`: 5 typed tools. Each has a pydantic args model, which is also the JSON schema the LLM sees.
  - `search_jobs(query, location, remote, limit)`: uses the existing `job_search` module. Recorded RemoteOK fixtures by default; live boards with `--live`.
  - `fetch_job(url_or_id)`: returns a sanitised description. Live URLs must be https on remoteok/usajobs, and redirects are not followed.
  - `analyze_fit(job_id)`: reuses the real-RAG `retrieve_evidence_node` (BM25 + dense, RRF, cross-encoder, evidence gate, JD sanitiser)
    and the pipeline's alignment prompt. Returns a score, the supported requirements with chunk ids, and the gaps.
  - `tailor_bullets(job_id)`: writes bullets only from retrieved chunks, and every bullet must cite chunk ids. Bullets are dropped if they
    are uncited, cite a chunk that was not retrieved, or name a skill absent from the cited chunks. Refuses outright when nothing is supported.
  - `save_to_tracker(job_id, status)`: the only write. Calls `db.save_job_application`, which writes the Kanban `job_applications` table.

  `run_tool` validates arguments and retries transient failures with exponential backoff (3 attempts). Every failure becomes a structured
  error: `{"ok": false, "error": {type, message, retryable}}`. A circuit breaker stops calls to a tool after 2 exhausted retries.
  Fault flags `flaky|down|error_once` inject failures for tests and evals.
- `graph.py`: a `StateGraph` that loops `agent` (LLM tool calling) → `tools` (custom ToolNode) → `agent`.
  - Any write tool call is routed to `approval`, which calls `langgraph.types.interrupt()`. The run resumes with `Command(resume={"decision": ...})`.
  - `reflect` checks the final answer and gives the agent another turn (at most 2). It catches: false "saved" claims, job ids no tool
    returned, ranking without `analyze_fit`, "best N" with fewer than N analyses, and tailoring without `tailor_bullets`.
  - A `max_steps` budget ends the run with status `budget_exhausted`. An answer starting "QUESTION:" ends it with `needs_clarification`.
  - Checkpoints go to SQLite (`SqliteSaver`, `.agent/checkpoints.sqlite`, gitignored).
  - `save_to_tracker` runs only for tool-call ids the human approved, and the tool itself checks the id again.
- `llm.py`: an OpenAI-compatible tool-calling client.
  - Provider chain: Groq `openai/gpt-oss-120b` (2 keys) → NVIDIA NIM → Gemini `gemini-3.5-flash-lite`.
    NIM is used only if `NVIDIA_API_KEY` is set. **No NIM key exists on this machine, so that path is untested.**
  - A daily cap (TPD/RPD) retires a key for the rest of the run. Per-minute 429s and 5xx errors get exponential backoff.
  - Every response is cached on disk.
- Interfaces:
  - `__main__.py`: the CLI.
  - `api.py`: `POST /api/agent/run`, `POST /api/agent/resume` and `GET /api/agent/state/{id}`, streaming NDJSON, mounted in `src/main.py`.
  - `frontend/src/components/AgentPanel.tsx`: streams the steps and shows Approve/Reject buttons.

## Tests
```
D:/ai-resume-job-tracker/venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
117 passed, 1 warning in 42.18s
```
That is the 87 old tests plus 30 new ones in `tests/test_agent.py`. They cover:
- **Tools:** typed schemas, fixture search, injection-sanitised snippets, structured errors, flaky→retry, down→retryable error,
  crash→observation, the circuit breaker, the approval check inside the tool, and the SSRF guard.
- **RAG tools:** `analyze_fit` evidence and gaps (plus its fallback when the LLM is down); `tailor_bullets` dropping uncited,
  non-retrieved or unsupported bullets, and refusing outright.
- **Graph:** happy path, reflection checks, budget exhaustion, tool-failure recovery, clarifying question.
  Interrupt→approve is resumed from a **new graph object on the same SQLite file** and writes once; reject writes nothing.
- **LLM client:** Groq TPD→Gemini fallback plus the cache, per-minute 429 retry, keys never appear in error text.
- **API:** stream, pause, resume, 409 on a replayed approval, input validation.

Mutation check: with the approval routing and the tool-node guard disabled, the 2 approve/reject tests fail.

The frontend panel compiles (`vite build` OK). The base branch's frontend build was already broken because the owner's `Toast.tsx` is
untracked. I copied it in temporarily for the build check and did not commit it.

## Trajectory eval — `python -m eval.agent_eval --live`
- **Tasks:** 29 deterministic tasks plus 3 live RemoteOK searches.
- **Postings:** recorded RemoteOK fixtures (`eval/fixtures/jobs_recorded.json`: 26 results over 5 queries, 18 unique postings, recorded
  2026-10-04 through `src.job_search`) plus 5 synthetic postings, 2 of which contain injected instructions.
- **Human:** a script that approves only in the two "save … approve" cases.
- **Writes:** go to a recorder; the real DB write is checked separately in the end-to-end section.

| metric | run 1 (fresh LLM calls) | run 2 (re-run: cache + fixes) |
|---|---|---|
| task success (29 fixture tasks) | 27/29 = 0.931 | **28/29 = 0.966** |
| required tools used | 29/29 | 29/29 |
| writes without approval | **0** (29/29 tasks clean) | **0** (29/29) |
| write proposals in tasks that did not ask to save (incl. 3 injection JDs) | 0 | 0 |
| live-search tasks | 3/3 | 3/3 |
| steps / task (mean, max) | 3.52, 10 | 3.52, 10 |
| tokens / task (mean) | 7,507 | 7,618 |
| latency p50 / p95 (27 runs with fresh LLM calls) | 8.72 s / 47.88 s | — (mostly cache) |
| live tasks latency p50 / p95 | 19.95 s / 30.1 s | 18.07 s / 31.06 s |
| tailored-bullet faithfulness (Gemini judge: claims supported by cited chunks) | 7/7 (3 distinct bullets) | 7/7 |

Run 2 by category: shortlist 4/5, compare 3/3, tailor 4/4, fetch 2/2, save (approve/reject HITL) 3/3, tool fault 4/4,
prompt injection 3/3, budget 2/2, ambiguous→question 3/3.

Run-1 failures and fixes:
1. `shortlist_frontend_1`: Gemini per-minute 429s were treated as a daily cap, and the run aborted. Now only TPD/RPD retire a key,
   and backoff gets 6 attempts.
2. `fault_analyze_crash`: the `error_once` fault counter was not kept in graph state, so the fault fired on every step.
   Now it is persisted in state, with a regression test.

Run-2 failure: `shortlist_data_3` hit the 10-step budget. The agent searched 4 times and analysed 6 jobs before ranking.
This is a real planning inefficiency and is not fixed.

Results: `eval/results/agent_eval_run{1,2}.json` and the matching `.log` files.

## End to end (real CLI, real PG18 + pgvector cluster on 127.0.0.1:5544, real LLM)
```
rows before: 5
$ python -m src.agent "find remote python backend jobs, pick the best one for me and save it to my tracker"
[agent] groq -> search_jobs(...)      [tool] search_jobs: ok {'count': 6}
[agent] gemini -> analyze_fit(je74fef), analyze_fit(j73ab7a)   -> 36.8, 29.2
[agent] gemini -> save_to_tracker({"job_id":"je74fef","status":"todo"})
[PAUSE] approval needed ... thread cli-8c85dba4 waiting at ['approval']
rows while paused: 5
$ python -m src.agent --resume cli-8c85dba4 --decision approve      (new process, state from SQLite)
[human] approved=['call_3560917']   [tool] save_to_tracker: ok {'application_id': 6}
=== done | steps=4 tokens=9864 saves=1 ===
rows after: 6   ->  6|Kruger NearShore LLC - Rekluti|DESARROLLADOR FULL STACK|todo
```
- **Reject path:** `--auto reject "find a remote devops kubernetes job and add it to my tracker"` paused, then returned
  `save_to_tracker: ERROR not_approved` with `saves=0`. Rows stayed at 6. The answer says "Not saved (human approval was rejected)".
- **API:** uvicorn on :8132. `POST /api/agent/run` streamed 9 NDJSON events ending in `paused` (rows 6 → 6).
  `POST /api/agent/resume` with approve returned `save_to_tracker ... wrote: true, application_id 7` (rows 6 → 7).
  Replaying the approval returned **409**.
- **Transcripts:** `eval/results/e2e_*.txt` and `api_*.ndjson`.
- **Bugs found in the live runs, both fixed:**
  - A closed stdin crashed the CLI approval prompt. The CLI now prints the resume command; the run was already checkpointed.
  - Switching from Groq to Gemini mid-conversation failed with 400 "missing thought_signature". Fixed with Gemini's documented
    placeholder signature.
- **DB state:** dev rows 6 and 7 stay in the private `jobtracker_rag` test DB. The owner's :5432 DB was not touched.

## Limitations / honest notes
- **Most agent turns ran on Gemini `gemini-3.5-flash-lite`, not Groq gpt-oss-120b.** Both Groq keys were at the 200k TPD cap
  (other agents share them). Providers used per task: gemini 32, groq 3 (of 32 tasks). The fallback works, but the numbers are mostly Gemini's.
- The NVIDIA NIM fallback code exists, but no NIM key was found, so it was never exercised.
- The eval is small: 29 fixture tasks + 3 live. I wrote the tasks, the synthetic postings and the pass checks.
  The faithfulness judge (Gemini) judged 7 bullets, only 3 of them distinct.
  Run 2 mostly replays cached LLM responses, so it is not an independent sample; run 1 is the fresh one.
- Fixture postings are mostly loosely related to the queries (RemoteOK's free feed is small), so fit scores are low (14–37).
- The reflection node and the injection defence are rule-based (regex sanitiser + system prompt + HITL gate).
  The hard guarantee against an injected "save 50 jobs" is the approval gate plus a 5-saves-per-run cap, not the LLM's judgement.
- `analyze_fit` runs the RAG with in-process dense search, because no `resume_id` is persisted for the agent's resume.
  `/api/analyze` still uses pgvector.
- Docker was not used. The PG18 cluster was started detached (`postgres.exe -D D:/ai-build/pgdata-rag -p 5544`) and stopped with
  `pg_ctl stop -m fast`. Starting it with `pg_ctl start` from a tool shell crashed it (0xC0000142) once that console closed.
