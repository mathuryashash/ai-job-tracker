import os
from typing import TypedDict, List, Optional
import pypdf
from sentence_transformers import SentenceTransformer
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from pydantic import BaseModel, Field
import numpy as np

import db

# Setup model name for Groq (llama-3.3-70b-versatile or llama-3.1-70b-versatile)
def get_llm(api_key: Optional[str] = None):
    key = api_key or os.getenv("GROQ_API_KEY")
    if not key:
        raise ValueError("GROQ_API_KEY is not set.")
    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        temperature=0.2,
        groq_api_key=key
    )

# Lazy-load SentenceTransformer so it doesn't block server startup
_embedding_model = None

def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model

# Define LangGraph State
class PipelineState(TypedDict):
    resume_path: str
    filename: str
    job_description: str
    resume_text: Optional[str]
    resume_id: Optional[int]
    extracted_keywords: Optional[List[str]]
    match_score: Optional[float]
    missing_keywords: Optional[List[str]]
    cover_letter: Optional[str]
    groq_api_key: Optional[str]

# Pydantic schemas for structured LLM outputs
class ResumeKeywords(BaseModel):
    keywords: List[str] = Field(description="List of key technical and soft skills extracted from the resume.")

class JDAnalysis(BaseModel):
    match_score: float = Field(description="A score from 0 to 100 representing how well the resume matches the JD.")
    missing_keywords: List[str] = Field(description="List of critical skills, tools, or keywords present in the JD but missing or weak in the resume.")

# --- LangGraph Nodes ---

def load_resume_node(state: PipelineState) -> PipelineState:
    """
    Parses the PDF resume and saves the raw text in the database.
    """
    resume_path = state["resume_path"]
    filename = state["filename"]
    
    print(f"[Node: load_resume] Extracting text from: {resume_path}")
    
    text = ""
    try:
        reader = pypdf.PdfReader(resume_path)
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    except Exception as e:
        print(f"Error reading PDF: {e}")
        text = f"Failed to parse PDF: {str(e)}"
        
    # Save resume text to DB
    resume_id = db.save_resume(filename, text)
    
    return {
        **state,
        "resume_text": text,
        "resume_id": resume_id
    }

def extract_keywords_node(state: PipelineState) -> PipelineState:
    """
    Uses Llama 3 70B on Groq to extract core skills and keywords from the resume text.
    """
    resume_text = state["resume_text"]
    
    print("[Node: extract_keywords] Extracting skills/keywords from resume")
    
    parser = JsonOutputParser(pydantic_object=ResumeKeywords)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an expert ATS (Applicant Tracking System) parser. Analyze the resume text and extract a list of core technical and soft skills, tools, methodologies, and technologies mentioned.\n{format_instructions}"),
        ("human", "Resume Text:\n{resume_text}")
    ]).partial(format_instructions=parser.get_format_instructions())
    
    llm = get_llm(state.get("groq_api_key"))
    chain = prompt | llm | parser
    try:
        result = chain.invoke({"resume_text": resume_text})
        extracted = result.get("keywords", [])
    except Exception as e:
        print(f"Error extracting keywords: {e}")
        extracted = []
        
    return {
        **state,
        "extracted_keywords": extracted
    }

def calculate_rag_alignment_node(state: PipelineState) -> PipelineState:
    """
    1. Embeds the resume and stores it in the database using pgvector.
    2. Embeds the job description.
    3. Calculates cosine similarity score (RAG semantic matching).
    4. Evaluates ATS match and identifies missing keywords using Llama-3-70B.
    """
    resume_text = state["resume_text"]
    resume_id = state["resume_id"]
    job_description = state["job_description"]
    
    print("[Node: calculate_rag_alignment] Generating embeddings and running similarity check")
    
    # 1. Generate local sentence embeddings
    resume_emb = get_embedding_model().encode(resume_text).tolist()
    jd_emb = get_embedding_model().encode(job_description).tolist()
    
    # 2. Save embedding to database
    db.save_resume_embedding(resume_id, resume_emb)
    
    # 3. Calculate semantic cosine similarity
    dot_product = np.dot(resume_emb, jd_emb)
    norm_resume = np.linalg.norm(resume_emb)
    norm_jd = np.linalg.norm(jd_emb)
    semantic_similarity = (dot_product / (norm_resume * norm_jd)) if (norm_resume > 0 and norm_jd > 0) else 0.0
    
    # Convert range [-1, 1] to percentage [0, 100]
    semantic_score = float(max(0.0, semantic_similarity) * 100)
    
    # 4. Use LLM to evaluate ATS structural alignment and identify missing keywords
    parser = JsonOutputParser(pydantic_object=JDAnalysis)
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are an ATS optimization system. Compare the candidate's resume keywords with the job description. Analyze structural match, experience level, and skill gaps. Identify missing keywords and calculate a final match score (0-100) combining semantic similarity and keyword presence.\n{format_instructions}"),
        ("human", "Resume Extracted Keywords: {keywords}\n\nJob Description:\n{jd}")
    ]).partial(format_instructions=parser.get_format_instructions())
    
    llm = get_llm(state.get("groq_api_key"))
    chain = prompt | llm | parser
    
    try:
        analysis = chain.invoke({
            "keywords": state["extracted_keywords"],
            "jd": job_description
        })
        llm_score = analysis.get("match_score", 50.0)
        missing = analysis.get("missing_keywords", [])
        
        # Combine Semantic Embeddings (40%) and LLM Skill Match (60%) for the final score
        final_score = round((semantic_score * 0.4) + (llm_score * 0.6), 1)
    except Exception as e:
        print(f"Error calculating alignment: {e}")
        final_score = round(semantic_score, 1)
        missing = []
        
    return {
        **state,
        "match_score": final_score,
        "missing_keywords": missing
    }

def generate_cover_letter_node(state: PipelineState) -> PipelineState:
    """
    Generates a tailored, professional cover letter using Llama 3 70B.
    """
    resume_text = state["resume_text"]
    job_description = state["job_description"]
    missing_keywords = state["missing_keywords"]
    
    print("[Node: generate_cover_letter] Drafting cover letter")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a professional career coach. Write a tailored, persuasive cover letter for a candidate applying to a job. Use details from the resume, highlight how they solve the challenges in the job description, and address any potential missing skills or transferrable experiences professionally. Maintain a polished, engaging tone, keep it to 3-4 paragraphs, and use standard placeholders like [Name] and [Company] if not known."),
        ("human", "Candidate's Resume:\n{resume}\n\nJob Description:\n{jd}\n\nKey gaps to address/reframe: {gaps}")
    ])
    
    llm = get_llm(state.get("groq_api_key"))
    chain = prompt | llm
    try:
        result = chain.invoke({
            "resume": resume_text,
            "jd": job_description,
            "gaps": ", ".join(missing_keywords)
        })
        cover_letter = result.content
    except Exception as e:
        print(f"Error generating cover letter: {e}")
        cover_letter = "Failed to generate cover letter due to an LLM error."
        
    return {
        **state,
        "cover_letter": cover_letter
    }

# --- Compile LangGraph ---

from langgraph.graph import StateGraph, END

def build_pipeline():
    workflow = StateGraph(PipelineState)
    
    # Add Nodes
    workflow.add_node("load_resume", load_resume_node)
    workflow.add_node("extract_keywords", extract_keywords_node)
    workflow.add_node("calculate_rag_alignment", calculate_rag_alignment_node)
    workflow.add_node("generate_cover_letter", generate_cover_letter_node)
    
    # Add Edges
    workflow.set_entry_point("load_resume")
    workflow.add_edge("load_resume", "extract_keywords")
    workflow.add_edge("extract_keywords", "calculate_rag_alignment")
    workflow.add_edge("calculate_rag_alignment", "generate_cover_letter")
    workflow.add_edge("generate_cover_letter", END)
    
    return workflow.compile()

# Instantiate the pipeline
pipeline_app = build_pipeline()

def run_analysis_pipeline(resume_path: str, filename: str, job_description: str, groq_api_key: Optional[str] = None) -> dict:
    """
    Wrapper to run the compiled LangGraph pipeline.
    """
    initial_state = {
        "resume_path": resume_path,
        "filename": filename,
        "job_description": job_description,
        "resume_text": None,
        "resume_id": None,
        "extracted_keywords": [],
        "match_score": 0.0,
        "missing_keywords": [],
        "cover_letter": "",
        "groq_api_key": groq_api_key
    }
    
    result = pipeline_app.invoke(initial_state)
    return result
