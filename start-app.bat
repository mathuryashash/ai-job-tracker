@echo off
title AI Resume ^& Job Tracker - Backend
rem Run from the repo root regardless of where the script is launched from.
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
    echo venv not found. Create it first:  python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)
echo Starting Backend API on http://localhost:8000
"venv\Scripts\python.exe" -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
