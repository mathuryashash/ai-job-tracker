"""Eval fixtures: resumes, JDs and a hand-labelled retrieval set.

R_JOHN is the text of the repo's tests' test_resume.pdf; JD_BACKEND / JD_NURSE
are the JDs used in the repo's live QA run (.hermes-qa/live/jd_*.txt, copied
here verbatim-in-substance). The other resumes/JDs are synthetic, written for
this eval. Relevance labels are substrings of the chunk text (resolved to
chunk ids at runtime) so they survive re-chunking.
"""

R_JOHN = """John Doe
Software Engineer
Email: john@example.com
Phone: 555-1234
EXPERIENCE:
- Senior Software Engineer at TechCorp (2020-2024)
  * Python, React, AWS, Docker, Kubernetes
  * Built microservices handling 1M+ requests/day
  * Led team of 5 engineers
- Software Engineer at StartupXYZ (2018-2020)
  * JavaScript, Node.js, PostgreSQL
  * Developed REST APIs
EDUCATION:
- BS Computer Science, University of Tech (2018)
SKILLS:
Python, JavaScript, React, AWS, Docker, Kubernetes, PostgreSQL, Git, CI/CD
"""

R_PRIYA = """Priya Sharma
Machine Learning Engineer | priya.s@example.com | +91 98000 00000
EXPERIENCE:
- ML Engineer at Finlytics (2022-2025)
  * Fine-tuned BERT and Llama-2 models with LoRA for document classification, raising F1 from 0.81 to 0.89
  * Built a retrieval-augmented QA service with FAISS and LangChain serving 20k queries/week
  * Deployed models as FastAPI services on GCP Cloud Run with Docker
  * Set up MLflow experiment tracking and weekly model drift reports
- Data Science Intern at HealthAI (2021)
  * Trained XGBoost readmission model on 300k patient records (AUC 0.77)
  * Cleaned and joined clinical data with pandas and SQL
PROJECTS:
- Voice assistant: Whisper speech-to-text plus an LLM agent with tool calling
- Kaggle: top 8% in a tabular time-series forecasting competition using LightGBM
EDUCATION:
- B.Tech Computer Science, IIT Example (2021), GPA 8.7/10
SKILLS:
Python, PyTorch, Hugging Face Transformers, LangChain, FAISS, SQL, GCP, Docker, MLflow, scikit-learn
"""

R_MARCO = """Marco Bianchi
Data Analyst | marco.b@example.com
EXPERIENCE:
- Data Analyst at RetailCo (2020-2025)
  * Built Tableau dashboards tracking sales across 140 stores used by regional managers
  * Wrote SQL queries in Snowflake to automate weekly KPI reporting, saving 6 hours per week
  * Ran A/B tests on promotions and reported uplift with confidence intervals
  * Presented findings to non-technical stakeholders in monthly business reviews
- Junior Analyst at BankOne (2018-2020)
  * Reconciled transactions in Excel with VLOOKUP and pivot tables
  * Built a customer churn report in Power BI
EDUCATION:
- BSc Economics, University of Milan (2018)
SKILLS:
SQL, Snowflake, Tableau, Power BI, Excel, Python (pandas), statistics, A/B testing
"""

R_AISHA = """Aisha Khan
Registered Nurse | aisha.k@example.com
EXPERIENCE:
- Staff Nurse, Medical-Surgical Unit at City General Hospital (2019-2025)
  * Provided care for 5-6 patients per shift including post-operative monitoring
  * Administered medications and IV therapy; documented care in Epic EHR
  * Precepted 8 new graduate nurses
- Nursing Assistant at Sunrise Care Home (2017-2019)
  * Assisted residents with daily living activities and vital signs
EDUCATION:
- Bachelor of Science in Nursing, State University (2019)
CERTIFICATIONS:
- RN License, BLS, ACLS
SKILLS:
Patient assessment, medication administration, IV therapy, Epic EHR, patient education
"""

R_LEO = """Leo Martin
Frontend Developer | leo.m@example.com
EXPERIENCE:
- Frontend Developer at Shoply (2021-2025)
  * Rebuilt the checkout in React and TypeScript, improving conversion by 12%
  * Wrote unit tests with Jest and end-to-end tests with Playwright
  * Improved Lighthouse performance score from 54 to 91 via code splitting and image optimisation
  * Built an accessible design system with Storybook meeting WCAG 2.1 AA
- Web Developer at AgencyX (2019-2021)
  * Built marketing sites with Next.js and Tailwind CSS
EDUCATION:
- BSc Software Engineering (2019)
SKILLS:
JavaScript, TypeScript, React, Next.js, Tailwind CSS, Jest, Playwright, Storybook, Git
"""

RESUMES = {"john": R_JOHN, "priya": R_PRIYA, "marco": R_MARCO, "aisha": R_AISHA, "leo": R_LEO}

JD_BACKEND = """Senior Backend Engineer
Company: Brightwave Payments
Location: Remote (US/EU)

Responsibilities:
- Design, build and operate Python microservices (FastAPI) running on AWS (EKS, RDS, SQS)
- Own containerised deployments with Docker and Kubernetes; improve our CI/CD pipelines
- Design PostgreSQL schemas and REST APIs consumed by our React dashboard
- Mentor a small team of engineers and lead technical design reviews

Requirements:
- 5+ years of professional software engineering experience
- Strong Python; experience with JavaScript/Node.js is a plus
- Hands-on AWS, Docker and Kubernetes in production
- PostgreSQL and REST API design
- Nice to have: Terraform, Kafka, observability (Prometheus/Grafana)
"""

JD_NURSE = """Registered Nurse - ICU (Night Shift)
Company: St. Mary's Regional Medical Center
Location: Cleveland, OH (on-site)

Responsibilities:
- Provide direct patient care to critically ill adults, including ventilator management and titration of vasoactive drips
- Assess, plan, implement and evaluate nursing care plans; document in Epic EHR
- Administer medications, monitor hemodynamics, respond to rapid-response and code-blue events
- Educate patients and families; collaborate with physicians and respiratory therapists

Requirements:
- Active RN license and BSN
- 2+ years of acute care nursing experience, ICU preferred
- BLS and ACLS certification required; CCRN a plus
"""

JD_ML = """Machine Learning Engineer - LLM Applications
Company: Northstar AI

Responsibilities:
- Build retrieval-augmented generation (RAG) pipelines over enterprise documents
- Fine-tune open-weight LLMs with parameter-efficient methods such as LoRA
- Deploy model services with Docker on a public cloud and monitor them in production
- Track experiments and model versions

Requirements:
- Strong Python and PyTorch
- Experience with vector databases or similarity search
- Kubernetes and Terraform experience
- Experience with speech or voice models is a plus
"""

JD_DATA = """Senior Data Analyst
Company: Grocerly

Responsibilities:
- Build and maintain BI dashboards for commercial teams
- Write performant SQL against our cloud data warehouse
- Design and analyse experiments (A/B tests) for pricing and promotions
- Communicate insights to non-technical stakeholders

Requirements:
- 4+ years in analytics
- dbt and Airflow experience
- Python for analysis
"""

JD_FRONTEND = """Frontend Engineer
Company: Paperlane

Responsibilities:
- Build product features in React and TypeScript
- Own web performance and Core Web Vitals
- Maintain our component library and accessibility standards
- Write automated tests

Requirements:
- 3+ years building React applications
- GraphQL experience
- Experience with Next.js
"""

JDS = {"backend": JD_BACKEND, "nurse": JD_NURSE, "ml": JD_ML, "data": JD_DATA, "frontend": JD_FRONTEND}

# (resume, requirement, [substrings identifying relevant chunks])
# An empty list = the resume has NO supporting evidence (refusal expected).
LABELLED = [
    # john × backend (repo test resume + repo live-QA JD)
    ("john", "Design, build and operate Python microservices (FastAPI) running on AWS (EKS, RDS, SQS)",
     ["microservices handling", "Python, React, AWS", "Skills: Python"]),
    ("john", "Own containerised deployments with Docker and Kubernetes; improve our CI/CD pipelines",
     ["Python, React, AWS, Docker", "Skills: Python"]),
    ("john", "Design PostgreSQL schemas and REST APIs consumed by our React dashboard",
     ["Developed REST APIs", "JavaScript, Node.js, PostgreSQL"]),
    ("john", "Mentor a small team of engineers and lead technical design reviews", ["Led team of 5"]),
    ("john", "5+ years of professional software engineering experience",
     ["Experience: Senior Software Engineer at TechCorp", "Experience: Software Engineer at StartupXYZ"]),
    ("john", "Strong Python; experience with JavaScript/Node.js is a plus",
     ["JavaScript, Node.js, PostgreSQL", "Skills: Python", "Python, React, AWS"]),
    ("john", "Hands-on AWS, Docker and Kubernetes in production", ["Python, React, AWS, Docker", "Skills: Python"]),
    ("john", "PostgreSQL and REST API design", ["Developed REST APIs", "JavaScript, Node.js, PostgreSQL", "Skills: Python"]),
    ("john", "Terraform, Kafka, observability (Prometheus/Grafana)", []),
    ("john", "Active RN license and BSN", []),
    ("john", "BLS and ACLS certification required; CCRN a plus", []),
    # priya × ml
    ("priya", "Build retrieval-augmented generation (RAG) pipelines over enterprise documents", ["retrieval-augmented QA"]),
    ("priya", "Fine-tune open-weight LLMs with parameter-efficient methods such as LoRA", ["LoRA"]),
    ("priya", "Deploy model services with Docker on a public cloud and monitor them in production",
     ["Cloud Run", "drift reports"]),
    ("priya", "Track experiments and model versions", ["MLflow experiment tracking"]),
    ("priya", "Strong Python and PyTorch", ["Skills: Python, PyTorch"]),
    ("priya", "Experience with vector databases or similarity search", ["FAISS and LangChain"]),
    ("priya", "Kubernetes and Terraform experience", []),
    ("priya", "Experience with speech or voice models is a plus", ["Whisper"]),
    ("priya", "Clean messy clinical data with pandas and SQL", ["pandas and SQL"]),
    # marco × data
    ("marco", "Build and maintain BI dashboards for commercial teams", ["Tableau dashboards", "Power BI"]),
    ("marco", "Write performant SQL against our cloud data warehouse", ["Snowflake to automate"]),
    ("marco", "Design and analyse experiments (A/B tests) for pricing and promotions", ["A/B tests on promotions"]),
    ("marco", "Communicate insights to non-technical stakeholders", ["non-technical stakeholders"]),
    ("marco", "dbt and Airflow experience", []),
    ("marco", "Python for analysis", ["Python (pandas)"]),
    # aisha × nurse
    ("aisha", "Assess, plan, implement and evaluate nursing care plans; document in Epic EHR",
     ["documented care in Epic", "Patient assessment"]),
    ("aisha", "Administer medications, monitor hemodynamics, respond to rapid-response and code-blue events",
     ["Administered medications"]),
    ("aisha", "Active RN license and BSN", ["RN License", "Bachelor of Science in Nursing"]),
    ("aisha", "BLS and ACLS certification required; CCRN a plus", ["RN License, BLS, ACLS"]),
    ("aisha", "Educate patients and families; collaborate with physicians and respiratory therapists",
     ["patient education"]),
    ("aisha", "Provide direct patient care to critically ill adults, including ventilator management",
     ["5-6 patients per shift"]),
    ("aisha", "Hands-on AWS, Docker and Kubernetes in production", []),
    # leo × frontend
    ("leo", "Build product features in React and TypeScript", ["checkout in React"]),
    ("leo", "Own web performance and Core Web Vitals", ["Lighthouse performance"]),
    ("leo", "Maintain our component library and accessibility standards", ["design system with Storybook"]),
    ("leo", "Write automated tests", ["Jest and end-to-end"]),
    ("leo", "GraphQL experience", []),
    ("leo", "Experience with Next.js", ["Next.js and Tailwind"]),
]
