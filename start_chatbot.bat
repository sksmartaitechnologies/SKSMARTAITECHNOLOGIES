@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    py -3 -m venv .venv
    if errorlevel 1 exit /b 1
)

".venv\Scripts\python.exe" -c "import flask, flask_cors, psycopg, dotenv" >nul 2>nul
if errorlevel 1 (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 exit /b 1
)

echo Chatbot site starting at http://127.0.0.1:5000/
start "" http://127.0.0.1:5000/
".venv\Scripts\python.exe" app.py
