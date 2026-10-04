"""Live end-to-end run: start the real FastAPI backend (uvicorn) against the
pgvector Postgres, POST one /api/analyze with the repo's test_resume.pdf and
the repo's QA JD, print evidence + citations, then stop the server.

Usage: python eval/live_e2e.py  (env: E2E_DATABASE_URL, E2E_PORT)
Keys are read from .hermes-qa/sandbox.env into the child env only.
"""
import json
import os
import subprocess
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.getenv("E2E_PORT", "8131"))
env = dict(os.environ)
for line in open(os.path.join(ROOT, ".hermes-qa", "sandbox.env"), encoding="utf-8"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        env[k] = v
env["DATABASE_URL"] = os.getenv("E2E_DATABASE_URL", "postgresql://postgres@127.0.0.1:5544/jobtracker_rag")
env.setdefault("HF_HOME", "D:/hf-cache")
env["HF_HUB_OFFLINE"] = "1"
# Optional: GROQ key from another local env file (e.g. when the sandbox key's
# daily token quota is exhausted). Value is never printed.
if os.getenv("E2E_GROQ_ENV"):
    for line in open(os.environ["E2E_GROQ_ENV"], encoding="utf-8"):
        if line.startswith("GROQ_API_KEY="):
            env["GROQ_API_KEY"] = line.split("=", 1)[1].strip().strip('"')
if os.getenv("E2E_GROQ_MODEL"):
    env["GROQ_MODEL"] = os.environ["E2E_GROQ_MODEL"]
key = env["GROQ_API_KEY"]

log = open(os.path.join(ROOT, "eval", "results", "live_backend.log"), "w", encoding="utf-8")
proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "src.main:app", "--host", "127.0.0.1", "--port", str(PORT)],
                        cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
try:
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(120):
        try:
            if requests.get(base + "/health", timeout=2).ok:
                break
        except requests.RequestException:
            pass
        time.sleep(1)
    health = requests.get(base + "/health", timeout=5).json()
    jd = open(os.path.join(ROOT, "eval", "fixtures", "jd_backend.txt"), encoding="utf-8").read()
    t0 = time.perf_counter()
    r = requests.post(base + "/api/analyze",
                      files={"file": ("test_resume.pdf", open(os.path.join(ROOT, "test_resume.pdf"), "rb"),
                                      "application/pdf")},
                      data={"job_description": jd}, timeout=300)
    elapsed = time.perf_counter() - t0
    body = r.json()
    out = {"health": health, "status": r.status_code, "latency_s": round(elapsed, 1), "response": body}
    txt = json.dumps(out, indent=1).replace(key, "***")
    open(os.path.join(ROOT, "eval", "results", "live_analyze.json"), "w", encoding="utf-8").write(txt)
    print("health:", health)
    print("status:", r.status_code, "latency_s:", round(elapsed, 1))
    print("backend:", body.get("retrieval_backend"), "match_score:", body.get("match_score"))
    print("reasoning:", body.get("score_reasoning"))
    print("unsupported:", body.get("unsupported_requirements"))
    print("missing:", body.get("missing_keywords"))
    print("citation_check:", json.dumps(body.get("citation_check"), indent=1))
    print("warnings:", body.get("warnings"))
    print("---- cover letter ----\n" + (body.get("cover_letter") or ""))
finally:
    proc.terminate()
    try:
        proc.wait(15)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()
