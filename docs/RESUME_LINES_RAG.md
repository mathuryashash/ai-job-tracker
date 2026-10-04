# Resume lines (numbers from VERIFY.md only)

- Rebuilt a LangGraph resume analyzer's RAG as hybrid BM25 + pgvector retrieval with RRF and cross-encoder reranking; recall@3 1.0, MRR 0.969, 39 labelled requirements.
- Built a 50-case LLM eval harness (adversarial, prompt-injection, LLM-judge faithfulness); cited-evidence guardrails raised claim faithfulness 0.72→0.90 and injection resistance 1/5→5/5.

Keywords this project now proves: RAG, hybrid search, BM25, pgvector, dense embeddings (sentence-transformers),
Reciprocal Rank Fusion, cross-encoder reranking, citations/grounding, refusal on missing evidence, LLM evals,
LLM-as-judge faithfulness (RAGAS-style), retrieval metrics (recall@k, MRR), prompt-injection guardrails,
LangGraph, FastAPI, Groq, PostgreSQL.
