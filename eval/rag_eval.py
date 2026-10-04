"""Retrieval eval: recall@k / MRR for BM25 vs dense vs hybrid (RRF) vs
hybrid+cross-encoder rerank on the hand-labelled set in eval/data.py, plus
the supported/unsupported (refusal) decision accuracy across thresholds, plus
a pgvector-vs-in-process dense parity check.

Usage: python -m eval.rag_eval [--pg DATABASE_URL]
Writes eval/results/retrieval.json.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import numpy as np

from eval.data import LABELLED, RESUMES
from src import rag

MODES = ["bm25", "dense", "hybrid", "hybrid_rerank"]
KS = [1, 3, 5]


def build(embedder, ce):
    out = {}
    for name, text in RESUMES.items():
        chunks = rag.chunk_resume(text)
        out[name] = rag.HybridRetriever(chunks, embedder, cross_encoder=ce)
    return out


def relevant_ids(retriever, needles):
    return {c.id for c in retriever.chunks if any(n in c.text for n in needles)}


def ranked(retriever, query, mode):
    if mode == "hybrid_rerank":
        hyb = retriever.hybrid(query)
        rr = [cid for cid, _ in retriever.rerank(query, hyb[:rag.RERANK_POOL])]
        return rr + [c for c in hyb if c not in rr]
    return [cid for cid, _ in retriever.search(query, mode, k=10)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", default=os.getenv("RAG_EVAL_PG"))
    args = ap.parse_args()

    from sentence_transformers import SentenceTransformer
    embedder = SentenceTransformer("all-MiniLM-L6-v2")
    ce = rag.get_cross_encoder()
    rets = build(embedder, ce)

    supported_q, missing_labels = [], []
    for res, req, needles in LABELLED:
        if needles:
            rel = relevant_ids(rets[res], needles)
            if not rel:
                missing_labels.append((res, req))
            supported_q.append((res, req, rel))
    if missing_labels:
        sys.exit(f"labels match no chunk: {missing_labels}")

    metrics = {}
    for mode in MODES:
        t0 = time.perf_counter()
        hits = {k: 0 for k in KS}
        rr_sum = 0.0
        for res, req, rel in supported_q:
            r = ranked(rets[res], req, mode)
            for k in KS:
                hits[k] += bool(set(r[:k]) & rel)  # hit@k: >=1 relevant chunk in top k
            rr_sum += next((1.0 / (i + 1) for i, c in enumerate(r[:10]) if c in rel), 0.0)
        n = len(supported_q)
        metrics[mode] = {**{f"recall@{k}": round(hits[k] / n, 3) for k in KS},
                         "mrr@10": round(rr_sum / n, 3),
                         "ms_per_query": round((time.perf_counter() - t0) * 1000 / n, 1)}

    # Refusal decision. Gate A (in use): max dense cosine among the reranked
    # top-k evidence chunks. Gate B (rejected): top cross-encoder logit.
    rows, rows_ce, names = [], [], []
    for res, req, needles in LABELLED:
        r = rets[res]
        top = r.search(req, "hybrid_rerank", k=rag.TOP_K)
        q = r.encode_query(req)
        rows.append((bool(needles), max((r.cosine(q, c) for c, _ in top), default=-1.0)))
        rows_ce.append((bool(needles), top[0][1] if top else -99.0))
        names.append(res)

    def acc(rs, t):
        return sum((sup and s >= t) or (not sup and s < t) for sup, s in rs)

    def confusion(rs, t):
        return {"accuracy": round(acc(rs, t) / len(rs), 3),
                "tp": sum(1 for sup, s in rs if sup and s >= t), "tn": sum(1 for sup, s in rs if not sup and s < t),
                "fp": sum(1 for sup, s in rs if not sup and s >= t), "fn": sum(1 for sup, s in rs if sup and s < t)}

    def loro(rs, ths, default):
        # leave-one-resume-out: tune threshold on 4 resumes, test on the 5th
        correct = 0
        for held in RESUMES:
            train = [x for x, n in zip(rs, names) if n != held]
            best = max(ths, key=lambda t: (acc(train, t), -abs(t - default)))
            correct += acc([x for x, n in zip(rs, names) if n == held], best)
        return round(correct / len(rs), 3)

    cos_ths = [round(0.20 + 0.02 * i, 2) for i in range(16)]
    ce_ths = [x / 2 for x in range(-24, 1)]
    refusal = {
        "cosine_gate_in_use": {"threshold": rag.SUPPORT_THRESHOLD,
                               **confusion(rows, rag.SUPPORT_THRESHOLD),
                               "leave_one_resume_out_accuracy": loro(rows, cos_ths, rag.SUPPORT_THRESHOLD),
                               "sweep": {str(t): round(acc(rows, t) / len(rows), 3) for t in cos_ths}},
        "cross_encoder_gate_rejected": {"best_in_sample_accuracy": round(max(acc(rows_ce, t) for t in ce_ths) / len(rows_ce), 3),
                                        "leave_one_resume_out_accuracy": loro(rows_ce, ce_ths, -8.0)},
    }

    parity = None
    if args.pg:
        parity = pg_parity(args.pg, rets, supported_q)

    out = {"n_labelled": len(LABELLED), "n_with_evidence": len(supported_q),
           "n_unsupported": len(LABELLED) - len(supported_q), "metrics": metrics,
           "refusal": refusal,
           "pgvector_parity": parity,
           "models": {"dense": "all-MiniLM-L6-v2", "reranker": rag.CROSS_ENCODER_MODEL}}
    os.makedirs("eval/results", exist_ok=True)
    json.dump(out, open("eval/results/retrieval.json", "w"), indent=2)
    print(json.dumps(out, indent=2))


def pg_parity(url, rets, supported_q):
    """Index every resume in pgvector and check the dense top-5 matches the
    in-process cosine ranking."""
    import psycopg2
    from pgvector.psycopg2 import register_vector
    conn = psycopg2.connect(url)
    register_vector(conn)
    cur = conn.cursor()
    cur.execute("CREATE TEMP TABLE ev_chunks (resume TEXT, chunk_id TEXT, embedding vector(384))")
    for name, r in rets.items():
        for c, e in zip(r.chunks, r.embeddings):
            cur.execute("INSERT INTO ev_chunks VALUES (%s,%s,%s)", (name, c.id, np.asarray(e, dtype=np.float32)))
    same = 0
    for res, req, _ in supported_q:
        q = rets[res].encode_query(req).astype(np.float32)
        cur.execute("SELECT chunk_id FROM ev_chunks WHERE resume=%s ORDER BY embedding <=> %s LIMIT 5", (res, q))
        pg_ids = [x[0] for x in cur.fetchall()]
        same += pg_ids == rets[res].dense(req, 5)
    conn.close()
    return {"queries": len(supported_q), "identical_top5": same}


if __name__ == "__main__":
    main()
