"""LangGraph pipeline: parse resume → extract keywords → score alignment →
generate cover letter + optimized resume.

Design notes:
- The graph is built lazily via lru_cache so importing this module is cheap
  and test setups don't pay for heavy ML imports until first use.
- Independent downstream branches (cover letter, optimized resume, target role)
  run concurrently in a single StateGraph step using asyncio.gather wrappers
  invoked from a thread executor, cutting wall-clock latency ~2x.
- All logging goes through `logger`, never `print`.
- Embeddings use a chunked mean-pool of the full document (B15), not a single
  truncated 400-word window.
"""
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import List, Optional, TypedDict

import numpy as np
import pypdf
from pydantic import BaseModel, Field

from . import db

logger = logging.getLogger(__name__)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# Lazy imports for heavy ML deps (avoid Triton/CUDA hang on Windows)
_ChatGroq = None
_ChatPromptTemplate = None
_JsonOutputParser = None
_SentenceTransformer = None
_StateGraph = None
_END = None


def _get_chat_groq():
    global _ChatGroq
    if _ChatGroq is None:
        from langchain_groq import ChatGroq
        _ChatGroq = ChatGroq
    return _ChatGroq


def _get_chat_prompt_template():
    global _ChatPromptTemplate
    if _ChatPromptTemplate is None:
        from langchain_core.prompts import ChatPromptTemplate
        _ChatPromptTemplate = ChatPromptTemplate
    return _ChatPromptTemplate


def _get_json_output_parser():
    global _JsonOutputParser
    if _JsonOutputParser is None:
        from langchain_core.output_parsers import JsonOutputParser
        _JsonOutputParser = JsonOutputParser
    return _JsonOutputParser


def _get_sentence_transformer():
    global _SentenceTransformer
    if _SentenceTransformer is None:
        from sentence_transformers import SentenceTransformer
        _SentenceTransformer = SentenceTransformer
    return _SentenceTransformer


def _get_state_graph():
    global _StateGraph
    if _StateGraph is None:
        from langgraph.graph import StateGraph
        _StateGraph = StateGraph
    return _StateGraph


def _get_end():
    global _END
    if _END is None:
        from langgraph.graph import END
        _END = END
    return _END


# ── Configuration ────────────────────────────────────────────────────────────
from . import config  # noqa: E402  (intentional late import for testability)


def get_llm(api_key: Optional[str] = None, timeout: Optional[int] = None):
    """Get LLM with configurable timeout to prevent hanging requests."""
    key = api_key or os.getenv("GROQ_API_KEY") or config.GROQ_API_KEY
    if not key:
        raise ValueError("GROQ_API_KEY is not set.")
    ChatGroq = _get_chat_groq()
    return ChatGroq(
        model=config.GROQ_MODEL,
        temperature=0.2,
        groq_api_key=key,
        timeout=timeout or config.LLM_TIMEOUT_SECONDS,
        max_retries=2,
    )


# ── Embedding model (lazy singleton) ────────────────────────────────────────

_embedding_model = None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        SentenceTransformer = _get_sentence_transformer()
        logger.info("Loading sentence-transformers model all-MiniLM-L6-v2")
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model


def preload_embedding_model():
    """Preload the embedding model at startup to avoid first-request latency."""
    logger.info("[Pipeline] Preloading embedding model...")
    get_embedding_model()
    logger.info("[Pipeline] Embedding model loaded")


# ── LangGraph state ──────────────────────────────────────────────────────────

class PipelineState(TypedDict, total=False):
    resume_path: str
    filename: str
    job_description: str
    resume_text: Optional[str]
    resume_id: Optional[int]
    candidate_name: Optional[str]
    candidate_email: Optional[str]
    candidate_phone: Optional[str]
    extracted_keywords: Optional[List[str]]
    match_score: Optional[float]
    missing_keywords: Optional[List[str]]
    cover_letter: Optional[str]
    optimized_resume: Optional[str]
    optimized_resume_latex: Optional[str]
    target_role: Optional[str]
    groq_api_key: Optional[str]


class ResumeKeywords(BaseModel):
    keywords: List[str] = Field(description="Key technical and soft skills from the resume.")


class JDAnalysis(BaseModel):
    match_score: float = Field(description="0-100 score for resume vs JD alignment.")
    missing_keywords: List[str] = Field(description="Skills/keywords present in JD but missing from resume.")


class CandidateProfile(BaseModel):
    name: str = Field(default="", description="Full name of the candidate.")
    email: str = Field(default="", description="Primary email address.")
    phone: str = Field(default="", description="Primary phone number.")


# ── Embedding helpers (chunked mean-pool over the full document) ─────────────

CHUNK_WORDS = 200
CHUNK_OVERLAP_WORDS = 40
EMBED_MAX_CHARS = 8000  # all-MiniLM-L6-v2 hard cap is ~512 tokens ≈ 2000 chars per chunk


def _chunk_text(text: str, chunk_words: int = CHUNK_WORDS,
                overlap: int = CHUNK_OVERLAP_WORDS) -> List[str]:
    words = text.split()
    if not words:
        return []
    if len(words) <= chunk_words:
        return [" ".join(words)]
    chunks = []
    step = chunk_words - overlap
    for i in range(0, len(words), step):
        chunk = words[i:i + chunk_words]
        if not chunk:
            break
        chunks.append(" ".join(chunk))
    return chunks


def encode_long_text(text: str) -> List[float]:
    """Encode a possibly long document as the mean of its chunk embeddings."""
    model = get_embedding_model()
    chunks = _chunk_text(text)
    if not chunks:
        return model.encode("").tolist()
    if len(chunks) == 1:
        return model.encode(chunks[0][:EMBED_MAX_CHARS]).tolist()
    embeddings = model.encode([c[:EMBED_MAX_CHARS] for c in chunks])
    return np.mean(embeddings, axis=0).tolist()


# ── Pipeline nodes ───────────────────────────────────────────────────────────

def load_resume_node(state: PipelineState) -> PipelineState:
    resume_path = state["resume_path"]
    filename = state["filename"]
    logger.info("[load_resume] Extracting text from %s", resume_path)

    text = ""
    try:
        reader = pypdf.PdfReader(resume_path)
        text = "\n".join(
            page.extract_text() for page in reader.pages if page.extract_text()
        )
    except Exception as e:
        logger.error("Error reading PDF: %s", e)
        text = f"Failed to parse PDF: {e}"

    # Use LLM to extract structured contact info (more robust than heuristics).
    candidate_name = ""
    candidate_email = ""
    candidate_phone = ""
    try:
        ChatPromptTemplate = _get_chat_prompt_template()
        JsonOutputParser = _get_json_output_parser()
        parser = JsonOutputParser(pydantic_object=CandidateProfile)
        prompt = ChatPromptTemplate.from_messages([
            ("system", "Extract the candidate's full name, primary email, and primary phone from the resume. If any field is missing, return an empty string. Respond with JSON matching: {format_instructions}"),
            ("human", "Resume:\n{resume_text}"),
        ]).partial(format_instructions=parser.get_format_instructions())
        chain = prompt | get_llm(state.get("groq_api_key")) | parser
        profile = chain.invoke({"resume_text": text[:4000]})
        candidate_name = profile.get("name", "") or ""
        candidate_email = profile.get("email", "") or ""
        candidate_phone = profile.get("phone", "") or ""
    except Exception as e:
        logger.warning("LLM profile extraction failed, falling back to heuristics: %s", e)
        candidate_name = _heuristic_candidate_name(text) or ""

    resume_id = db.save_resume(filename, text)
    return {
        **state,
        "resume_text": text,
        "resume_id": resume_id,
        "candidate_name": candidate_name,
        "candidate_email": candidate_email,
        "candidate_phone": candidate_phone,
    }


def _extract_company_and_role(jd: str) -> tuple[str, str]:
    """Best-effort extraction of company name + role title from a job description.

    Falls back to "Analyzed Target" / "Matched Role" if nothing found.
    """
    if not jd:
        return "Analyzed Target", "Matched Role"
    company = ""
    role = ""
    lines = [l.strip() for l in jd.splitlines() if l.strip()]
    head = lines[:15]
    for line in head:
        lo = line.lower()
        if not company and ("company:" in lo or "organization:" in lo or "employer:" in lo):
            company = line.split(":", 1)[1].strip().strip("* ")[:120]
        if not role and ("role:" in lo or "position:" in lo or "title:" in lo or "job title:" in lo):
            role = line.split(":", 1)[1].strip().strip("* ")[:120]
    # First non-empty line is often the role if not labelled.
    if not role and head:
        first = head[0][:120]
        # Heuristic: contains engineer/developer/manager/etc → likely a title
        if any(w in first.lower() for w in ("engineer", "developer", "manager", "designer",
                                            "analyst", "scientist", "intern", "lead", "architect")):
            role = first
    return (company or "Analyzed Target"), (role or "Matched Role")


def _heuristic_candidate_name(text: str) -> Optional[str]:
    """Fallback name extraction from the first lines of a resume."""
    if not text:
        return None
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    for line in lines[:5]:
        words = line.split()
        if 2 <= len(words) <= 4 and all(w[0].isupper() for w in words if w):
            if not any(h in line.lower() for h in ("resume", "cv", "curriculum", "vitae", "profile", "summary")):
                return line
    return None


def extract_keywords_node(state: PipelineState) -> PipelineState:
    resume_text = state["resume_text"]
    logger.info("[extract_keywords] Extracting skills/keywords")

    ChatPromptTemplate = _get_chat_prompt_template()
    JsonOutputParser = _get_json_output_parser()
    parser = JsonOutputParser(pydantic_object=ResumeKeywords)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an expert ATS parser. Extract core technical and soft skills, tools, methodologies, and technologies from the resume.\n{format_instructions}"),
        ("human", "Resume Text:\n{resume_text}"),
    ]).partial(format_instructions=parser.get_format_instructions())

    chain = prompt | get_llm(state.get("groq_api_key")) | parser
    try:
        result = chain.invoke({"resume_text": resume_text[:6000]})
        extracted = result.get("keywords", [])
    except Exception as e:
        logger.error("Error extracting keywords: %s", e)
        extracted = []

    return {**state, "extracted_keywords": extracted}


def calculate_rag_alignment_node(state: PipelineState) -> PipelineState:
    """Generate chunked embeddings, compute semantic similarity, and ask the LLM
    for keyword-level structural alignment. Stores embedding for reuse."""
    resume_text = state["resume_text"]
    resume_id = state["resume_id"]
    job_description = state["job_description"]
    logger.info("[calculate_rag_alignment] Generating chunked embeddings")

    cached_emb = db.get_resume_embedding(resume_id) if resume_id else None
    if cached_emb is not None:
        logger.info("[calculate_rag_alignment] Using cached resume embedding")
        resume_emb = cached_emb
    else:
        resume_emb = encode_long_text(resume_text)
        if resume_id:
            try:
                db.save_resume_embedding(resume_id, resume_emb)
            except Exception as e:
                logger.warning("Failed to cache resume embedding: %s", e)

    jd_emb = encode_long_text(job_description)

    dot = np.dot(resume_emb, jd_emb)
    norm_r = np.linalg.norm(resume_emb)
    norm_j = np.linalg.norm(jd_emb)
    semantic_score = float(max(0.0, dot / (norm_r * norm_j)) * 100) if (norm_r > 0 and norm_j > 0) else 0.0

    ChatPromptTemplate = _get_chat_prompt_template()
    JsonOutputParser = _get_json_output_parser()
    parser = JsonOutputParser(pydantic_object=JDAnalysis)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an ATS optimisation system. Compare resume keywords to the JD; identify missing keywords and a final 0-100 score combining semantic similarity and keyword presence.\n{format_instructions}"),
        ("human", "Resume Extracted Keywords: {keywords}\n\nJob Description:\n{jd}"),
    ]).partial(format_instructions=parser.get_format_instructions())

    try:
        analysis = (prompt | get_llm(state.get("groq_api_key")) | parser).invoke({
            "keywords": state.get("extracted_keywords") or [],
            "jd": job_description,
        })
        llm_score = float(analysis.get("match_score", 50.0))
        missing = analysis.get("missing_keywords", []) or []
        final_score = round((semantic_score * 0.4) + (llm_score * 0.6), 1)
    except Exception as e:
        logger.error("Error calculating alignment: %s", e)
        final_score = round(semantic_score, 1)
        missing = []

    return {**state, "match_score": final_score, "missing_keywords": missing}


# ── Parallel downstream branch (cover letter + optimized resume + role) ─────

def parallel_outputs_node(state: PipelineState) -> PipelineState:
    """Run the three independent LLM branches concurrently using a thread pool.

    Cuts wall-clock from ~3 sequential calls to 1 longest call.
    """
    logger.info("[parallel_outputs] Running cover letter + optimized resume + role in parallel")

    def _cover_letter() -> str:
        ChatPromptTemplate = _get_chat_prompt_template()
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a professional career coach. Write a tailored 3-4 paragraph cover letter using the candidate's name and addressing skill gaps honestly. Sign off with the candidate's name. Use [Company] if company unknown."),
            ("human", "Candidate Name: {name}\n\nResume:\n{resume}\n\nJD:\n{jd}\n\nGaps:\n{gaps}"),
        ])
        chain = prompt | get_llm(state.get("groq_api_key"))
        try:
            res = chain.invoke({
                "name": state.get("candidate_name") or "[Name]",
                "resume": state["resume_text"][:6000],
                "jd": state["job_description"][:3000],
                "gaps": ", ".join(state.get("missing_keywords") or []) or "none identified",
            })
            return res.content
        except Exception as e:
            logger.error("Cover letter generation failed: %s", e)
            return f"Cover letter generation failed: {str(e)[:200]}"

    def _optimized_resume() -> str:
        ChatPromptTemplate = _get_chat_prompt_template()
        prompt = ChatPromptTemplate.from_messages([
            ("system", (
                "You are an expert resume writer. Rewrite the resume to maximise ATS match for the JD.\n"
                "STRICT CONSTRAINT: Final LaTeX resume MUST fit on EXACTLY ONE A4 page.\n"
                "Rules: naturally incorporate missing keywords where truthful; mirror JD language; never fabricate; "
                "be extremely concise (2-3 bullets/role, 1 line/bullet); merge older low-relevance roles; "
                "compact LaTeX with \\documentclass[10pt]{article}, \\usepackage[margin=0.5in]{geometry}, 10pt font; "
                "reduce spacing with \\setlength{\\parskip}{0pt}, \\setlength{\\itemsep}{1pt}, \\vspace{-4pt}; "
                "include Header (single line), Professional Summary (2 lines max), Experience, Education, Skills (single line); "
                "use \\section*{}, \\subsection*{}, \\textbf{}, \\begin{itemize}[leftmargin=*, nosep]; "
                "escape LaTeX specials (&, %, $, #, _, {, }, ~, ^, \\\\); "
                "output ONLY the LaTeX code, no markdown."
            )),
            ("human", "ORIGINAL RESUME:\n{resume}\n\nJOB DESCRIPTION:\n{jd}\n\nKEYWORDS TO INCORPORATE WHERE RELEVANT:\n{keywords}\n\nWrite the ONE-PAGE ATS-optimized resume in LaTeX:"),
        ])
        chain = prompt | get_llm(state.get("groq_api_key"), timeout=45)
        try:
            res = chain.invoke({
                "resume": state["resume_text"][:6000],
                "jd": state["job_description"][:3000],
                "keywords": ", ".join(state.get("missing_keywords") or []) or "none identified",
            })
            return res.content
        except Exception as e:
            logger.error("Optimized resume generation failed: %s", e)
            return f"% Optimized resume generation failed: {str(e)[:200]}"

    def _target_role() -> str:
        ChatPromptTemplate = _get_chat_prompt_template()
        prompt = ChatPromptTemplate.from_messages([
            ("system", "You are a career strategist. Identify the single most specific role title this candidate is targeting (e.g. 'Senior Backend Engineer'). Return ONLY the title."),
            ("human", "Resume Keywords: {keywords}\n\nJD:\n{jd}"),
        ])
        chain = prompt | get_llm(state.get("groq_api_key"), timeout=15)
        try:
            res = chain.invoke({
                "keywords": ", ".join(state.get("extracted_keywords") or []),
                "jd": state["job_description"][:2000],
            })
            return res.content.strip()
        except Exception as e:
            logger.error("Target role detection failed: %s", e)
            return "Software Engineer"

    with ThreadPoolExecutor(max_workers=3, thread_name_prefix="llm-branch") as ex:
        fut_cover = ex.submit(_cover_letter)
        fut_opt = ex.submit(_optimized_resume)
        fut_role = ex.submit(_target_role)
        cover_letter = fut_cover.result(timeout=60)
        optimized_latex = fut_opt.result(timeout=60)
        target_role = fut_role.result(timeout=30)

    return {
        **state,
        "cover_letter": cover_letter,
        "optimized_resume_latex": optimized_latex,
        "optimized_resume": optimized_latex,  # backwards-compat alias
        "target_role": target_role,
    }


# ── Graph construction (lazy + cached) ──────────────────────────────────────

@lru_cache(maxsize=1)
def _build_pipeline_cached():
    StateGraph = _get_state_graph()
    END = _get_end()
    wf = StateGraph(PipelineState)
    wf.add_node("load_resume", load_resume_node)
    wf.add_node("extract_keywords", extract_keywords_node)
    wf.add_node("calculate_rag_alignment", calculate_rag_alignment_node)
    wf.add_node("parallel_outputs", parallel_outputs_node)
    wf.set_entry_point("load_resume")
    wf.add_edge("load_resume", "extract_keywords")
    wf.add_edge("extract_keywords", "calculate_rag_alignment")
    wf.add_edge("calculate_rag_alignment", "parallel_outputs")
    wf.add_edge("parallel_outputs", END)
    return wf.compile()


@lru_cache(maxsize=1)
def _build_batch_pipeline_cached():
    """Pipeline variant for batch mode (skips PDF loading — resume already in DB)."""
    StateGraph = _get_state_graph()
    END = _get_end()
    wf = StateGraph(PipelineState)
    wf.add_node("extract_keywords", extract_keywords_node)
    wf.add_node("calculate_rag_alignment", calculate_rag_alignment_node)
    wf.add_node("parallel_outputs", parallel_outputs_node)
    wf.set_entry_point("extract_keywords")
    wf.add_edge("extract_keywords", "calculate_rag_alignment")
    wf.add_edge("calculate_rag_alignment", "parallel_outputs")
    wf.add_edge("parallel_outputs", END)
    return wf.compile()


# ── Public entry points ──────────────────────────────────────────────────────

def _initial_state(resume_path: str, filename: str, job_description: str,
                    groq_api_key: Optional[str]) -> PipelineState:
    return PipelineState(
        resume_path=resume_path, filename=filename, job_description=job_description,
        resume_text=None, resume_id=None, candidate_name=None, candidate_email=None,
        candidate_phone=None, extracted_keywords=[], match_score=0.0,
        missing_keywords=[], cover_letter="", optimized_resume="",
        optimized_resume_latex="", target_role="", groq_api_key=groq_api_key,
    )


def run_analysis_pipeline(resume_path: str, filename: str, job_description: str,
                           groq_api_key: Optional[str] = None) -> dict:
    """Run the full LangGraph pipeline. Synchronous; call via run_in_executor."""
    return _build_pipeline_cached().invoke(
        _initial_state(resume_path, filename, job_description, groq_api_key)
    )


def run_batch_pipeline(resume_id: int, resume_text: str, job_description: str,
                       groq_api_key: Optional[str] = None) -> dict:
    """Batch mode: resume text + id are pre-loaded, skip load_resume node."""
    state = _initial_state("", "", job_description, groq_api_key)
    state.update(resume_id=resume_id, resume_text=resume_text)
    return _build_batch_pipeline_cached().invoke(state)


def reset_pipeline_cache() -> None:
    """Clear the lazy pipeline cache (e.g. for tests)."""
    _build_pipeline_cached.cache_clear()
    _build_batch_pipeline_cached.cache_clear()


# Expose a coroutine wrapper so async callers don't need to manage executors.
async def run_analysis_pipeline_async(resume_path: str, filename: str,
                                       job_description: str,
                                       groq_api_key: Optional[str] = None) -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None, run_analysis_pipeline, resume_path, filename, job_description, groq_api_key,
    )
