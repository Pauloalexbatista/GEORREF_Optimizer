@echo off
title GeoRoute Pro - Gestão de Arranque

cd /d "%~dp0"

echo ===================================================
echo             GeoRoute Pro - Arranque
echo ===================================================
echo.
echo   1. Nova Aplicação Profissional (FastAPI + Next.js)
echo   2. Protótipo Streamlit (Legado)
echo.
echo ===================================================
set /p choice="Escolha uma opção (1 ou 2) e prima ENTER: "

if "%choice%"=="1" goto option1
if "%choice%"=="2" goto option2
goto option1

:option1
echo.
echo A iniciar Nova Aplicação Profissional...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)
start /b python -m uvicorn backend.main:app --port 8000
cd frontend
start /b npm run dev
ping -n 4 127.0.0.1 >nul
start http://localhost:3000
exit

:option2
echo.
echo A iniciar Protótipo Streamlit Legado...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8503 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)
taskkill /F /IM streamlit.exe 2>nul
python -c "from database import init_database; init_database()" 2>nul
start /b python -c "import collections, collections.abc; collections.MutableMapping = collections.abc.MutableMapping; collections.Mapping = collections.abc.Mapping; collections.Sequence = collections.abc.Sequence; collections.Iterable = collections.abc.Iterable; collections.Container = collections.abc.Container; collections.Callable = collections.abc.Callable; from streamlit.web import cli; cli.main(['run', 'app.py', '--server.port', '8503', '--server.headless', 'true'])"
ping -n 3 127.0.0.1 >nul
start http://localhost:8503
exit
