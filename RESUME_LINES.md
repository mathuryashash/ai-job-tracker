# Resume lines (numbers from VERIFY.md only)

- Built a LangGraph job-search agent with 5 typed tools, retries, reflection and SQLite-checkpointed human approval; 0 unapproved writes, 28/29 trajectory-eval tasks passed.
- Grounded resume tailoring in hybrid-RAG evidence, with chunk citations on every bullet and injection-resistant writes: 7/7 bullets judged faithful, 0 writes from 3 prompt-injection JDs.

Keywords this project now proves: AI agents, LangGraph (StateGraph, conditional edges, interrupt / human-in-the-loop, checkpointer),
tool calling (OpenAI-format function schemas, pydantic), tool-error recovery (retry with exponential backoff, structured errors,
circuit breaker), reflection / self-check, step budgets, LLM provider fallback (Groq → Gemini), LLM response caching,
trajectory evals (task success, tool-sequence checks, write-safety, latency p50/p95, tokens), LLM-as-judge faithfulness,
prompt-injection defence, fault injection, RAG (hybrid BM25 + dense, RRF, cross-encoder), FastAPI streaming (NDJSON), React, PostgreSQL.

The real-RAG lines from the previous branch are in `docs/RESUME_LINES_RAG.md`.
