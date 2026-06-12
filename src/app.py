import os
import requests
import streamlit as st
import plotly.graph_objects as go
import pandas as pd

# Page Configuration
st.set_page_config(page_title="AI Resume & Job Tracker", page_icon="💼", layout="wide")

# Theme / Premium Styling (Dark glassmorphism/gradient style)
st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
    
    html, body, [class*="css"] {
        font-family: 'Outfit', sans-serif;
    }
    
    .main-title {
        font-size: 2.8rem !important;
        font-weight: 700;
        background: linear-gradient(135deg, #6366F1 0%, #A855F7 50%, #EC4899 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-align: center;
        margin-bottom: 5px;
    }
    
    .subtitle {
        font-size: 1.25rem !important;
        color: #6B7280;
        text-align: center;
        margin-bottom: 35px;
    }
    
    .card {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s ease-in-out;
    }
    
    .card:hover {
        transform: translateY(-2px);
    }
    
    .badge {
        display: inline-block;
        padding: 4px 10px;
        border-radius: 9999px;
        font-size: 0.85rem;
        font-weight: 600;
        margin-right: 6px;
        margin-bottom: 6px;
    }
    
    .badge-success {
        background-color: rgba(16, 185, 129, 0.15);
        color: #10B981;
        border: 1px solid rgba(16, 185, 129, 0.3);
    }
    
    .badge-warning {
        background-color: rgba(245, 158, 11, 0.15);
        color: #F59E0B;
        border: 1px solid rgba(245, 158, 11, 0.3);
    }
    
    .kanban-col {
        background-color: rgba(249, 250, 251, 0.02);
        border-radius: 12px;
        padding: 15px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        min-height: 500px;
    }
    
    .kanban-header {
        font-size: 1.1rem;
        font-weight: 700;
        margin-bottom: 15px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding-bottom: 8px;
        border-bottom: 2px solid;
    }
</style>
""", unsafe_allow_html=True)

# App Title & Description
st.markdown('<div class="main-title">💼 AI Resume & Job Tracker</div>', unsafe_allow_html=True)
st.markdown('<div class="subtitle">Streamline your applications with Groq-powered ATS parsing, RAG alignment, and Kanban tracking</div>', unsafe_allow_html=True)

# Determine Backend URL (handles docker container network or local)
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

# Setup default session state values
if "groq_api_key" not in st.session_state:
    st.session_state["groq_api_key"] = os.getenv("GROQ_API_KEY", "")

# Tabs navigation
tab_analyzer, tab_kanban, tab_settings = st.tabs(["📄 Resume Analyzer", "📋 Kanban Tracker", "⚙️ Configuration"])

# --- TAB 1: RESUME ANALYZER ---
with tab_analyzer:
    col_left, col_right = st.columns([1, 1])
    
    with col_left:
        st.markdown("### 📥 Upload Materials")
        uploaded_file = st.file_uploader("Upload your resume (PDF only)", type=["pdf"])
        job_description = st.text_area("Paste the Target Job Description (JD)", height=300)
        
        # Check for API key
        api_key = st.session_state["groq_api_key"]
        
        if st.button("🚀 Analyze & Generate Alignment", use_container_width=True):
            if not uploaded_file:
                st.error("Please upload your resume PDF first.")
            elif not job_description.strip():
                st.error("Please paste the target job description.")
            elif not api_key:
                st.error("Groq API Key is missing. Please set it in the 'Configuration' tab.")
            else:
                with st.spinner("Running agentic LangGraph parsing, keyword extraction, and pgvector RAG alignment..."):
                    try:
                        # Prepare files and form data
                        files = {"file": (uploaded_file.name, uploaded_file.getvalue(), "application/pdf")}
                        data = {"job_description": job_description}
                        
                        # Set header for Groq API Key if configured in app state
                        headers = {}
                        if st.session_state.get("groq_api_key"):
                            headers["X-Groq-Api-Key"] = st.session_state["groq_api_key"]
                        
                        # Post to FastAPI backend
                        response = requests.post(f"{BACKEND_URL}/api/analyze", files=files, data=data, headers=headers, timeout=60)
                        
                        if response.status_code == 200:
                            res_json = response.json()
                            st.session_state["analysis_results"] = res_json
                            st.success("Analysis complete! Review the dashboard on the right.")
                            # Trigger re-run to update UI
                            st.rerun()
                        else:
                            st.error(f"Backend returned an error: {response.text}")
                    except Exception as e:
                        st.error(f"Failed to connect to the backend server at {BACKEND_URL}: {e}")

    with col_right:
        st.markdown("### 📊 Alignment Dashboard")
        
        if "analysis_results" in st.session_state:
            results = st.session_state["analysis_results"]
            score = results["match_score"]
            
            # 1. Gauge Chart for Score
            fig = go.Figure(go.Indicator(
                mode="gauge+number",
                value=score,
                domain={'x': [0, 1], 'y': [0, 1]},
                title={'text': "ATS Fit Score", 'font': {'size': 24, 'family': 'Outfit'}},
                gauge={
                    'axis': {'range': [0, 100], 'tickwidth': 1, 'tickcolor': "darkblue"},
                    'bar': {'color': "#818CF8"},
                    'bgcolor': "white",
                    'borderwidth': 2,
                    'bordercolor': "gray",
                    'steps': [
                        {'range': [0, 50], 'color': 'rgba(239, 68, 68, 0.15)'},
                        {'range': [50, 75], 'color': 'rgba(245, 158, 11, 0.15)'},
                        {'range': [75, 100], 'color': 'rgba(16, 185, 129, 0.15)'}
                    ],
                }
            ))
            fig.update_layout(height=250, margin=dict(l=20, r=20, t=40, b=20))
            st.plotly_chart(fig, use_container_width=True)
            
            # 2. Keywords section
            st.markdown("#### Key Findings")
            
            col_match, col_gap = st.columns(2)
            
            with col_match:
                st.markdown("**✅ Found Resume Keywords**")
                keywords = results.get("extracted_keywords", [])
                if keywords:
                    for kw in keywords[:15]: # Show top 15
                        st.markdown(f'<span class="badge badge-success">{kw}</span>', unsafe_allow_html=True)
                else:
                    st.info("No matching keywords found.")
                    
            with col_gap:
                st.markdown("**⚠️ Identified Skill Gaps**")
                gaps = results.get("missing_keywords", [])
                if gaps:
                    for gp in gaps:
                        st.markdown(f'<span class="badge badge-warning">{gp}</span>', unsafe_allow_html=True)
                else:
                    st.success("Perfect ATS alignment! No major gaps detected.")
            
            # 3. Tailored Cover Letter
            st.markdown("---")
            st.markdown("#### 💌 Tailored Cover Letter")
            st.text_area("Copy and customize your tailored cover letter:", value=results["cover_letter"], height=300)
            
        else:
            st.info("Upload materials and trigger analysis on the left to see results.")

# --- TAB 2: KANBAN TRACKER ---
with tab_kanban:
    st.markdown("### 📋 Application Pipeline")
    
    # 1. Fetch current applications
    applications = []
    try:
        resp = requests.get(f"{BACKEND_URL}/api/applications", timeout=5)
        if resp.status_code == 200:
            applications = resp.json().get("data", [])
    except Exception as e:
        st.error(f"Could not connect to database/backend: {e}")
        
    # Form to add a new application
    with st.expander("➕ Add New Application Card"):
        add_col1, add_col2 = st.columns(2)
        with add_col1:
            company = st.text_input("Company Name")
            position = st.text_input("Position Title")
        with add_col2:
            status = st.selectbox("Stage", ["todo", "applied", "interviewing", "offer", "rejected"])
            jd_input = st.text_area("Job Description (Optional)")
            
        if st.button("Add Job Application", use_container_width=True):
            if not company or not position:
                st.error("Company and Position are required fields.")
            else:
                try:
                    payload = {
                        "company_name": company,
                        "position_title": position,
                        "job_description": jd_input,
                        "status": status
                    }
                    post_resp = requests.post(f"{BACKEND_URL}/api/applications", json=payload, timeout=5)
                    if post_resp.status_code == 200:
                        st.success(f"Added application for {company}!")
                        st.rerun()
                    else:
                        st.error(f"Failed to save application: {post_resp.text}")
                except Exception as e:
                    st.error(f"Error: {e}")

    # 2. Display Kanban Columns
    col_todo, col_applied, col_interviewing, col_offer, col_rejected = st.columns(5)
    
    stages = [
        {"name": "todo", "label": "To Do 📝", "col": col_todo, "border": "#6366F1"},
        {"name": "applied", "label": "Applied 📤", "col": col_applied, "border": "#3B82F6"},
        {"name": "interviewing", "label": "Interviewing 📞", "col": col_interviewing, "border": "#F59E0B"},
        {"name": "offer", "label": "Offer 🎉", "col": col_offer, "border": "#10B981"},
        {"name": "rejected", "label": "Rejected ❌", "col": col_rejected, "border": "#EF4444"}
    ]
    
    for stage in stages:
        with stage["col"]:
            st.markdown(
                f'<div class="kanban-header" style="color: {stage["border"]}; border-bottom-color: {stage["border"]};">{stage["label"]}</div>', 
                unsafe_allow_html=True
            )
            
            # Filter applications for this stage
            stage_apps = [a for a in applications if a["status"] == stage["name"]]
            
            for app in stage_apps:
                # Build custom Card HTML
                card_html = f"""
                <div class="card" style="border-left: 4px solid {stage["border"]};">
                    <h5 style="margin: 0; font-weight: 700;">{app['company_name']}</h5>
                    <p style="margin: 3px 0 10px 0; font-size: 0.95rem; color: #9CA3AF;">{app['position_title']}</p>
                </div>
                """
                st.markdown(card_html, unsafe_allow_html=True)
                
                # Dynamic Controls per card (using keys to avoid collision)
                sub_col1, sub_col2 = st.columns([2, 1])
                with sub_col1:
                    new_stage = st.selectbox(
                        "Move", 
                        ["todo", "applied", "interviewing", "offer", "rejected"],
                        index=["todo", "applied", "interviewing", "offer", "rejected"].index(app["status"]),
                        key=f"move_{app['id']}"
                    )
                    if new_stage != app["status"]:
                        requests.put(f"{BACKEND_URL}/api/applications/{app['id']}", json={"status": new_stage})
                        st.rerun()
                with sub_col2:
                    st.write("")  # Alignment
                    st.write("")
                    if st.button("🗑️", key=f"del_{app['id']}"):
                        requests.delete(f"{BACKEND_URL}/api/applications/{app['id']}")
                        st.rerun()

# --- TAB 3: CONFIGURATION ---
with tab_settings:
    st.markdown("### ⚙️ Engine Configurations")
    
    groq_key = st.text_input("Groq API Key", value=st.session_state["groq_api_key"], type="password")
    model_opt = st.selectbox("LLM Model Name", ["llama3-70b-8192", "llama-3.1-70b-versatile"], index=0)
    
    if st.button("Save Configurations", use_container_width=True):
        st.session_state["groq_api_key"] = groq_key
        # Update local environment variables so the pipeline script loads the saved key
        os.environ["GROQ_API_KEY"] = groq_key
        os.environ["GROQ_MODEL"] = model_opt
        st.success("Configurations updated successfully!")
        
    st.markdown("---")
    st.markdown("#### System Health Status")
    try:
        resp = requests.get(f"{BACKEND_URL}/health", timeout=3)
        if resp.status_code == 200:
            health = resp.json()
            st.success(f"🟢 Connected to FastAPI backend: {health.get('service')} - Status: {health.get('status')}")
        else:
            st.error(f"🔴 Backend API reachable but returned error: {resp.text}")
    except Exception as e:
        st.error(f"🔴 Cannot reach backend FastAPI service on {BACKEND_URL}. Ensure uvicorn server is running. Error: {e}")
