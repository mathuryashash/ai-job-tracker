# VERIFY — real hybrid RAG + eval harness (branch `hermes/real-rag`)

Worktree: `D:/ai-build/jobtracker-rag`. Python: `D:/ai-resume-job-tracker/venv` (used by path).
Env for every command: `HF_HOME=D:/hf-cache HF_HUB_OFFLINE=1`.

## What changed
- `src/rag.py` (new): structure-aware resume chunking (one chunk per bullet, prefixed with section and parent role, ids `c1..cN`),
  deterministic JD requirement extraction, **BM25** (`rank_bm25`) + **dense** (all-MiniLM-L6-v2) retrieval per requirement,
  **Reciprocal Rank Fusion** (k=60), **cross-encoder rerank** (`cross-encoder/ms-marco-MiniLM-L6-v2`, cached in D:/hf-cache),
  an evidence gate (cosine ≥ 0.36 on the reranked top 3) that marks requirements **NOT SUPPORTED BY RESUME**, citation parsing and validation,
  and guardrails: JD prompt-injection sanitiser, removal of JD text pasted into a resume, and a post-generation letter guard that
  strips sentences claiming unsupported skills.
- `src/pipeline.py`: new LangGraph node `retrieve_evidence` (extract_keywords → **retrieve_evidence** → calculate_rag_alignment → parallel_outputs).
  The alignment prompt now gets each requirement with its cited chunks and returns `reasoning` + score + missing keywords.
  The cover letter is written **only from retrieved chunks**, must cite `[cN]`, and is refused outright when no requirement has evidence.
  Invalid citations are flagged in `warnings`. A target-role timeout no longer turns the whole analysis into a 500 (bug found live).
- `src/db.py`: `resume_chunks(resume_id, chunk_id, content, embedding vector(384))`; dense search runs via pgvector `<=>`.
  If pgvector is missing, retrieval falls back to an in-process numpy cosine search; `retrieval_backend` in the response says which one ran.
- `src/main.py`: `/api/analyze` also returns `evidence`, `unsupported_requirements`, `score_reasoning`, `citation_check`, `retrieval_backend`,
  `injection_removed`, `letter_guard_removed`.

## pgvector
The system PostgreSQL 18 (`C:/Program Files/PostgreSQL/18`) has no pgvector, and its directory needs admin rights (not available).
I built **pgvector 0.8.1 from source** with MSVC 2022 (`nmake /F Makefile.win`) into a copy of PG18 under `D:/ai-build/pg18`
and ran a **private PG18 cluster on 127.0.0.1:5544** (`D:/ai-build/pgdata-rag`, DB `jobtracker_rag`, trust auth, local only):
```
CREATE EXTENSION vector;  ->  extversion 0.8.1
```
The owner's DBs on :5432 were not touched. Without pgvector (e.g. the :5432 sandbox), the app uses the in-process fallback.

## Tests
```
D:/ai-resume-job-tracker/venv/Scripts/python.exe -m pytest -q -p no:cacheprovider
87 passed, 1 warning in 17.38s
```
That is the 68 original tests plus 19 new ones in `tests/test_rag.py`: chunking, requirement extraction, RRF, BM25/dense, rerank order,
refusal, pgvector use + fallback, citation validation, injection sanitiser, JD-paste filter, letter guard, no-evidence refusal,
role-timeout regression and graph wiring.
The worktree needed the owner's untracked `src/crypto.py`, 4 test files, `test_resume.pdf` and the modified `tests/test_api.py` to reach
the 68-test baseline. They were copied in and committed on this branch only; the owner's tree is untouched.

## 1. Retrieval eval — `python -m eval.rag_eval --pg postgresql://postgres@127.0.0.1:5544/jobtracker_rag`
Labelled set: **39 JD-requirement → relevant-chunk labels** over 5 resumes (the repo's `test_resume.pdf` text plus 4 synthetic resumes
I wrote) and 5 JDs (2 from the repo's live QA run, 3 synthetic). 32 labels have evidence; 7 are deliberately unsupported.
Results in `eval/results/retrieval.json`:

| mode | recall@1 | recall@3 | recall@5 | MRR@10 | ms/query |
|---|---|---|---|---|---|
| BM25 only | 0.844 | 0.906 | 0.906 | 0.870 | 0.2 |
| dense only | 0.906 | 1.000 | 1.000 | 0.953 | 16.6 |
| hybrid (RRF) | **0.938** | 1.000 | 1.000 | **0.969** | 14.7 |
| hybrid + cross-encoder | 0.875 | 1.000 | 1.000 | 0.932 | 68–80 |

(recall@k = at least one relevant chunk in the top k.)
Honest reading: hybrid RRF beats each retriever alone. The ms-marco cross-encoder makes recall@1 and MRR **worse** on this
resume-bullet domain; it was trained on web QA. It is kept to order evidence; the top-3 set is unchanged (recall@3 = 1.0).

Refusal gate (supported vs not-supported, 39 labels):
- cosine gate @0.36 (in use): accuracy **0.949** (TP 30, TN 7, FP 0, FN 2). **Leave-one-resume-out accuracy 0.923.**
- cross-encoder-logit gate (rejected): best in-sample accuracy 0.872, leave-one-resume-out 0.769.
- 0 false positives: none of the 7 unsupported requirements was marked supported.

pgvector parity: on all **32/32** queries, the pgvector `<=>` top 5 matched the in-process cosine top 5 exactly.

## 2. Consistency + faithfulness harness — `EXTRA_KEYS_ENV=<file with GEMINI/GROQ keys> python -m eval.harness --workers 2`
This runs the real pipeline nodes (extract_keywords → retrieve_evidence → alignment → cover letter) with **Groq openai/gpt-oss-120b**.
The judge is **Gemini `gemini-3.5-flash-lite`**, temperature 0, JSON mode. Every LLM call is cached on disk (`eval/.cache`, gitignored).
**50 cases**: 5 good fit, 20 bad fit, 5 good-fit prose JDs (no bullets), 5 bad-fit prose, 5 keyword-stuffed resumes, 5 prompt-injection JDs,
2 "JD pasted into resume", and 3 empty or near-empty resumes.
Faithfulness metric: **my own LLM judge, RAGAS-style** (split the letter into atomic claims, then check each against the resume chunks
and against the cited chunks). RAGAS itself was not used: its install would pull langchain-openai/openai/datasets into the app venv.

| check | before guardrails (v1, committed `harness_v1_before_guardrails.json`) | **final (v2, `harness.json`)** |
|---|---|---|
| JSON validity (strict parse of raw alignment output) | 50/50 | **50/50** |
| score monotonicity pairs (good > bad, genuine > stuffed / injected / pasted) | 32/37 = 0.865 | **36/37 = 0.973** |
| reasoning agrees with numeric score (judge) | 47/50 | **49/50 = 0.98** |
| reasoning agrees with missing_keywords (judge) | 46/50 | **46/50 = 0.92** |
| missing_keywords lists no skill the resume has (judge) | 46/50 | **46/50 = 0.92** |
| faithfulness: letter claims supported by resume | 0.72 (200 claims) | **0.902 (138/153 claims)** |
| claims carrying a citation | 0.71 | **0.922** |
| cited claims supported by the cited chunks | 0.81 | **0.872** |
| letters with no skill absent from resume (judge / lexicon) | 38/50, 34/50 | **48/50, 49/50** |
| letters with no invalid citation id | 49/50 | **49/50** |
| prompt injection resisted (score < 90, gaps listed, no injected claim) | 1/5 | **5/5** |
| empty resume handled (score ≤ 20, no invented skills) | 1/3 | **3/3** |
| LLM latency per case p50 / p95 (s, 3 sequential LLM calls) | — | **6.39 / 9.13** |

Good-fit and good-prose letters (10 cases): **73/73 claims supported by the resume**.
In v2, 20 bad-fit or adversarial letters were refused because no requirement had evidence, and the guard removed 12 sentences.
Remaining failures: `stuffed__nurse` (a keyword-stuffed resume scored above the genuine nurse resume),
`jdpaste__marco__frontend` (the letter still claims React/TypeScript/Next.js/GraphQL; the paste filter only removes *verbatim* chunk copies),
one letter citing chunk `c4` that was not retrieved, and one false "ICU" mention in a genuine nurse letter.
Mean final score by kind: good 71.2, good_prose 70.7, bad 18.8, bad_prose 13.1, stuffed 59.2, injection 13.1, jd_paste 70.8, empty 4.5.
Groq 429s during the run: 68 (handled by backoff and key rotation).

## 3. Live end to end — `E2E_GROQ_MODEL=openai/gpt-oss-20b python eval/live_e2e.py`
This starts the real FastAPI app under uvicorn on :8131 against the pgvector DB, POSTs `/api/analyze` with `test_resume.pdf` and the
repo's QA JD (`eval/fixtures/jd_backend.txt`), then stops the server. Output is in `eval/results/live_analyze.json`.
```
health: database connected, groq_model openai/gpt-oss-20b
status: 200 latency_s: 12.9
backend: pgvector match_score: 81.3
unsupported: ['Terraform, Kafka, observability (Prometheus/Grafana)']
missing: ['FastAPI','EKS','RDS','SQS','Terraform','Kafka','Prometheus','Grafana']
citation_check.cited_ids: c4 c5 c2 c3 c10 c8 c7   invalid_ids: []
letter: "...handling more than 1 M requests per day [c4, c5, c2] ... While I have not yet worked with FastAPI, EKS, RDS, or SQS ..."
resume_chunks rows in pgvector: 10 x vector(384)
```
An earlier live run on the same day with the default **gpt-oss-120b** also returned 200: 14.9s, score 75.9, 8 cited ids, 0 invalid.
That run's printed output is in the agent transcript; its JSON file was overwritten.
By the final run, **both Groq keys had exhausted the 200k tokens/day quota for gpt-oss-120b** (`TPD: Limit 200000, Used 199998`).
The saved live JSON therefore uses gpt-oss-20b, which has a separate quota. While doing this I found and fixed a bug: a target-role
timeout caused by 429 retries made `/api/analyze` return 500.

## Limitations / not done
- The labelled set is small (39 labels, 5 resumes, 5 JDs), and 4 of the resumes and 3 of the JDs are synthetic, written by me. I picked
  the refusal threshold on this same set; the leave-one-resume-out figure (0.923) is the less optimistic estimate.
- The judge is an LLM (Gemini flash-lite), not human labels or RAGAS. Faithfulness numbers inherit its errors.
- The generator writes letters that still overstate some facts: cited-chunk precision is 0.872 (for example, it can say a skills-list item
  was "in production"). The lexical guard catches unsupported *skills*, not overstated *depth*.
- The injection sanitiser is regex-based. It catches the 5 phrasings tested, not every possible attack.
  The JD-paste defence only catches verbatim copies.
- The cross-encoder hurts top-1 ranking in this domain (MRR 0.932 vs 0.969 for RRF alone). A domain-tuned reranker was not tried.
- The "project-description knowledge base" was not built: only resume chunks are indexed.
- pgvector runs on a private PG18 cluster on :5544 that I built (no admin rights for the system install). Docker was not used.
- The harness reuses cached LLM outputs. v2 re-generated every case whose prompt changed (62 new Groq calls, 68 cache hits).
