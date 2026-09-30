@echo off
title AI Resume & Job Tracker - Backend
cd /d D:\ai-resume-job-tracker
echo Starting Backend API on http://localhost:8000
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload