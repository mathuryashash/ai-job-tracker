@echo off
echo Starting AI Resume & Job Tracker...
echo.

start "Backend" cmd /k "cd /d D:\ai-resume-job-tracker && python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload"
start "Frontend" cmd /k "cd /d D:\ai-resume-job-tracker\frontend && npm run dev"

echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Two command windows opened. Keep them running.
pause