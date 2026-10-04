"""Hybrid retrieval over resume chunks: BM25 + dense (pgvector or in-process),
Reciprocal Rank Fusion, cross-encoder rerank, and an evidence threshold that
decides whether a JD requirement is *supported* by the resume at all.

Everything downstream (gap analysis, cover letter) only sees retrieved chunks
tagged with stable ids ([c1], [c2] ...) so claims can be cited and checked.
Requirements whose best reranked chunk falls below SUPPORT_THRESHOLD are
returned as unsupported: the LLM is told never to claim them.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

CROSS_ENCODER_MODEL = "cross-encoder/ms-marco-MiniLM-L6-v2"
RRF_K = 60
CANDIDATES_PER_RETRIEVER = 10
RERANK_POOL = 8
TOP_K = 3
# Evidence gate: a reranked chunk counts as evidence only if its dense cosine
# similarity to the requirement is >= this. On the labelled set the ms-marco
# cross-encoder logit separated supported/unsupported requirements worse than
# cosine did (eval/rag_eval.py prints both sweeps + a leave-one-resume-out
# estimate), so the cross-encoder orders evidence and cosine gates it.
SUPPORT_THRESHOLD = 0.36
MAX_REQUIREMENTS = 20

_BULLET_RE = re.compile(r"^\s*([-*•·–▪◦●]|\d+[.)])\s+")
_SUB_BULLET_RE = re.compile(r"^\s*([*•·▪◦●]|\s{2,}[-–])\s*")
_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+#./-]*")
_STOP = set("""a an and or the of to in on for with at by from as is are be been being
this that these those it its our we you your their they i me my will can
must should would could have has had do does did not no nice plus etc using use
experience years year strong good great ability ideal preferred required
""".split())


@dataclass
class Chunk:
    id: str
    text: str          # what is shown to the LLM and indexed
    section: str


@dataclass
class Evidence:
    requirement: str
    supported: bool
    top_score: float
    chunks: List[Dict] = field(default_factory=list)  # {id, text, score}


# ── Chunking ────────────────────────────────────────────────────────────────

def _is_header(line: str) -> bool:
    s = line.strip()
    if not s or _BULLET_RE.match(line) or len(s.split()) > 4:
        return False
    core = s.rstrip(":").strip()
    return bool(core) and (s.endswith(":") or (core.isupper() and len(core) > 2))


def chunk_resume(text: str, max_words: int = 60) -> List[Chunk]:
    """Structure-aware chunking: one chunk per bullet / entry line, prefixed
    with its section and parent entry so each chunk is self-contained."""
    chunks: List[Chunk] = []
    section = "HEADER"
    parent = ""
    header_lines: List[str] = []

    def add(body: str):
        body = body.strip()
        if not body:
            return
        words = body.split()
        pieces = [" ".join(words[i:i + max_words]) for i in range(0, len(words), max_words)]
        for p in pieces:
            prefix = f"{section.title()}"
            if parent and parent not in p:
                prefix += f" | {parent}"
            chunks.append(Chunk(id="", text=f"{prefix}: {p}", section=section))

    for raw in (text or "").splitlines():
        if not raw.strip():
            continue
        if _is_header(raw):
            if section == "HEADER" and header_lines:
                chunks.append(Chunk(id="", text="Header: " + " | ".join(header_lines), section="HEADER"))
                header_lines = []
            section = raw.strip().rstrip(":").strip().upper()
            parent = ""
            continue
        line = raw.strip()
        if section == "HEADER":
            header_lines.append(line)
            continue
        is_sub = bool(_SUB_BULLET_RE.match(raw)) and not raw.lstrip().startswith("- ")
        clean = _BULLET_RE.sub("", line).lstrip("*•·▪◦● ").strip()
        if is_sub and parent:
            add(clean)
        else:
            parent = clean[:120]
            add(clean)
    if header_lines:
        chunks.insert(0, Chunk(id="", text="Header: " + " | ".join(header_lines), section="HEADER"))
    for i, c in enumerate(chunks, 1):
        c.id = f"c{i}"
    return chunks


# ── Requirement extraction (deterministic, no LLM spend) ────────────────────

_META_RE = re.compile(r"^(company|location|salary|employer|organization|title|role|position|job title)\s*:", re.I)


def extract_requirements(jd: str, limit: int = MAX_REQUIREMENTS) -> List[str]:
    lines = [l for l in (jd or "").splitlines() if l.strip()]
    reqs = []
    for l in lines:
        if _BULLET_RE.match(l):
            r = _BULLET_RE.sub("", l).strip()
            r = re.sub(r"^(nice to have|bonus|preferred|plus)\s*:\s*", "", r, flags=re.I)
            if len(r.split()) >= 2:
                reqs.append(r)
    if not reqs:  # unstructured JD: fall back to sentences
        body = " ".join(l.strip() for l in lines if not _META_RE.match(l.strip()))
        for s in re.split(r"(?<=[.!?;])\s+", body):
            s = s.strip()
            if len(s.split()) >= 4:
                reqs.append(s)
    seen, out = set(), []
    for r in reqs:
        k = r.lower()
        if k not in seen:
            seen.add(k)
            out.append(r[:300])
    return out[:limit]


# ── Retrieval primitives ────────────────────────────────────────────────────

def tokenize(text: str) -> List[str]:
    toks = [t.strip("./-") for t in _TOKEN_RE.findall((text or "").lower())]
    return [t for t in toks if t and t not in _STOP]


def rrf_fuse(rankings: Sequence[Sequence[str]], k: int = RRF_K) -> List[str]:
    """Reciprocal Rank Fusion of several ranked id lists (best first)."""
    scores: Dict[str, float] = {}
    for ranking in rankings:
        for rank, cid in enumerate(ranking):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda c: (-scores[c], c))


_cross_encoder = None


def get_cross_encoder():
    global _cross_encoder
    if _cross_encoder is None:
        from sentence_transformers import CrossEncoder
        logger.info("Loading cross-encoder %s", CROSS_ENCODER_MODEL)
        _cross_encoder = CrossEncoder(CROSS_ENCODER_MODEL)
    return _cross_encoder


DenseSearch = Callable[[np.ndarray, int], List[str]]


class HybridRetriever:
    """BM25 + dense retrieval over one resume's chunks.

    `dense_search` lets the caller plug in pgvector; when None, an in-process
    cosine search over the normalised embeddings is used (fallback).
    """

    def __init__(self, chunks: List[Chunk], embedder, cross_encoder=None,
                 dense_search: Optional[DenseSearch] = None,
                 embeddings: Optional[np.ndarray] = None):
        from rank_bm25 import BM25Okapi
        self.chunks = chunks
        self.by_id = {c.id: c for c in chunks}
        self.ids = [c.id for c in chunks]
        self.embedder = embedder
        self.cross_encoder = cross_encoder
        self._bm25 = BM25Okapi([tokenize(c.text) or ["_"] for c in chunks]) if chunks else None
        if embeddings is None and chunks:
            embeddings = np.asarray(embedder.encode([c.text for c in chunks], normalize_embeddings=True))
        self.embeddings = embeddings
        self._dense_search = dense_search
        self.backend = "pgvector" if dense_search else "in-process numpy"

    # individual retrievers ------------------------------------------------
    def bm25(self, query: str, n: int = CANDIDATES_PER_RETRIEVER) -> List[str]:
        if not self._bm25:
            return []
        q = tokenize(query)
        if not q:
            return []
        s = self._bm25.get_scores(q)
        order = np.argsort(-s, kind="stable")
        return [self.ids[i] for i in order[:n] if s[i] > 0]

    def encode_query(self, query: str) -> np.ndarray:
        return np.asarray(self.embedder.encode([query], normalize_embeddings=True))[0]

    def dense(self, query: str, n: int = CANDIDATES_PER_RETRIEVER, qemb=None) -> List[str]:
        if not self.chunks:
            return []
        qemb = self.encode_query(query) if qemb is None else qemb
        if self._dense_search is not None:
            try:
                return self._dense_search(qemb, n)
            except Exception as e:  # pgvector down → in-process fallback
                logger.warning("pgvector dense search failed, using in-process: %s", e)
        sims = self.embeddings @ qemb
        order = np.argsort(-sims, kind="stable")
        return [self.ids[i] for i in order[:n]]

    def hybrid(self, query: str, n: int = CANDIDATES_PER_RETRIEVER) -> List[str]:
        return rrf_fuse([self.bm25(query, n), self.dense(query, n)])

    def rerank(self, query: str, ids: List[str]) -> List[tuple]:
        if not ids:
            return []
        ce = self.cross_encoder or get_cross_encoder()
        scores = ce.predict([(query, self.by_id[i].text) for i in ids])
        pairs = sorted(zip(ids, map(float, scores)), key=lambda p: -p[1])
        return pairs

    def search(self, query: str, mode: str = "hybrid_rerank", k: int = TOP_K) -> List[tuple]:
        """Return [(chunk_id, score)] best-first for one of the eval modes."""
        if mode == "bm25":
            return [(i, 0.0) for i in self.bm25(query)[:k]]
        if mode == "dense":
            return [(i, 0.0) for i in self.dense(query)[:k]]
        if mode == "hybrid":
            return [(i, 0.0) for i in self.hybrid(query)[:k]]
        if mode == "hybrid_rerank":
            return self.rerank(query, self.hybrid(query)[:RERANK_POOL])[:k]
        raise ValueError(mode)

    def cosine(self, query_emb, chunk_id: str) -> float:
        return float(self.embeddings[self.ids.index(chunk_id)] @ query_emb)

    def evidence_for(self, requirements: List[str], k: int = TOP_K,
                     threshold: float = SUPPORT_THRESHOLD) -> List[Evidence]:
        out = []
        for req in requirements:
            ranked = self.search(req, "hybrid_rerank", k)
            q = self.encode_query(req) if ranked else None
            kept, best = [], -1.0
            for cid, s in ranked:
                cos = self.cosine(q, cid)
                best = max(best, cos)
                if cos >= threshold:
                    kept.append({"id": cid, "text": self.by_id[cid].text,
                                 "rerank": round(s, 3), "cosine": round(cos, 3)})
            out.append(Evidence(requirement=req, supported=bool(kept),
                                top_score=round(best, 3), chunks=kept))
        return out


# ── Prompt formatting + citation checks ─────────────────────────────────────

def format_evidence(evidence: List[Evidence]) -> str:
    lines = []
    for i, ev in enumerate(evidence, 1):
        if ev.supported:
            cites = "\n".join(f"    [{c['id']}] {c['text']}" for c in ev.chunks)
            lines.append(f"R{i}. {ev.requirement}\n  SUPPORTED by:\n{cites}")
        else:
            lines.append(f"R{i}. {ev.requirement}\n  NOT SUPPORTED BY RESUME (no evidence retrieved)")
    return "\n".join(lines) or "(no requirements extracted)"


def evidence_chunks(evidence: List[Evidence]) -> Dict[str, str]:
    d = {}
    for ev in evidence:
        for c in ev.chunks:
            d[c["id"]] = c["text"]
    return d


_CITE_RE = re.compile(r"\[(c\d+(?:\s*,\s*c\d+)*)\]")


def extract_citations(text: str) -> List[str]:
    ids = []
    for m in _CITE_RE.finditer(text or ""):
        for cid in m.group(1).split(","):
            cid = cid.strip()
            if cid not in ids:
                ids.append(cid)
    return ids


def invalid_citations(text: str, allowed_ids) -> List[str]:
    allowed = set(allowed_ids)
    return [c for c in extract_citations(text) if c not in allowed]


def coverage(evidence: List[Evidence]) -> float:
    return sum(e.supported for e in evidence) / len(evidence) if evidence else 0.0


# ── Guardrails ──────────────────────────────────────────────────────────────

_INJECTION_RE = re.compile(
    r"(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the|all|previous)|"
    r"system (note|prompt|message)|you are (now )?(an? )?(ai|assistant|screener|language model)|"
    r"(set|make) (the )?match_?score|missing_keywords|pre-?approved|"
    r"(state|say|write|claim) in the cover letter|new instructions|do not (flag|mention) )",
    re.I)


def sanitize_jd(jd: str):
    """Drop JD sentences that try to instruct the model (prompt injection).
    Returns (clean_jd, removed_sentences)."""
    removed, kept_lines = [], []
    for line in (jd or "").splitlines():
        if not _INJECTION_RE.search(line):
            kept_lines.append(line)
            continue
        parts = re.split(r"(?<=[.!?])\s+", line)
        keep = [p for p in parts if not _INJECTION_RE.search(p)]
        removed += [p.strip() for p in parts if _INJECTION_RE.search(p)]
        # an instruction block usually spans the rest of the line
        kept_lines.append(" ".join(keep) if len(keep) == len(parts) - 1 else "")
    return "\n".join(kept_lines), removed


def _norm(t: str) -> str:
    return " ".join(tokenize(t))


def drop_jd_copies(chunks: List[Chunk], jd: str, min_words: int = 5) -> tuple:
    """Remove resume chunks that are verbatim copies of JD text (a known
    ATS-gaming trick: pasting the JD into the resume in white text)."""
    njd = _norm(jd)
    kept, dropped = [], []
    for c in chunks:
        body = c.text.split(": ", 1)[-1]
        nb = _norm(body)
        if len(nb.split()) >= min_words and nb in njd:
            dropped.append(c.id)
        else:
            kept.append(c)
    return kept, dropped


_NEG_RE = re.compile(r"\b(not|no|never|without|yet to|lack|lacks|haven't|hasn't|have not|has not|"
                     r"isn't|aren't|don't|do not|eager to|keen to|learn|learning|gap|gaps|outside)\b", re.I)


def guard_letter(letter: str, banned_terms, resume_text: str):
    """Post-generation guard: delete sentences that assert a JD skill the
    resume does not contain (term in banned_terms, absent from resume text,
    sentence not negated). Returns (letter, removed_sentences)."""
    res = (resume_text or "").lower()
    terms = []
    for t in banned_terms or []:
        t = t.strip().lower()
        if len(t) >= 2 and not re.search(r"(?<![a-z0-9])" + re.escape(t) + r"(?![a-z0-9])", res):
            terms.append(t)
    if not terms or not letter:
        return letter, []
    pat = re.compile(r"(?<![a-z0-9])(" + "|".join(map(re.escape, sorted(terms, key=len, reverse=True))) + r")(?![a-z0-9])", re.I)
    removed, out_paras = [], []
    for para in letter.split("\n"):
        sents = re.split(r"(?<=[.!?])\s+", para)
        keep = []
        for snt in sents:
            if pat.search(snt) and not _NEG_RE.search(snt):
                removed.append(snt.strip())
            else:
                keep.append(snt)
        out_paras.append(" ".join(keep))
    return "\n".join(out_paras), removed


def unsupported_terms(evidence: List[Evidence], missing_keywords, jd_injected_terms=()) -> List[str]:
    """Skill terms the letter must not assert: LLM-flagged missing keywords,
    plus capitalised/technical tokens of requirements with no evidence."""
    terms = set()
    for m in missing_keywords or []:
        for part in re.split(r"[/,()]| and | or ", str(m)):
            part = part.strip()
            if part:
                terms.add(part)
    for ev in evidence:
        if not ev.supported:
            for tok in re.findall(r"\b[A-Z][A-Za-z0-9+#.-]*[A-Za-z0-9+#]\b", ev.requirement):
                if tok.lower() not in _STOP and len(tok) > 2:
                    terms.add(tok)
    terms.update(jd_injected_terms)
    return sorted(terms)


NO_EVIDENCE_LETTER = ("No cover letter was generated: none of this job's requirements is supported by "
                      "evidence in the resume, so any letter would have to claim experience the candidate "
                      "does not have.")
