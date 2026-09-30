@echo off
echo Starting AI Resume ^& Job Tracker...
echo.

start "Backend" cmd /k call "%~dp0start-app.bat"
start "Frontend" cmd /k call "%~dp0start-frontend.bat"

echo.
echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Two command windows opened. Keep them running.
pause
