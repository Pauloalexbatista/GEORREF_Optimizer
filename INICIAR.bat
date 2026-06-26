@echo off
title GeoRoute Pro

cd /d "%~dp0"

echo.
echo ===============================
echo   GeoRoute Pro - A Iniciar
echo ===============================

rem Limpar processos órfãos na porta 8503
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8503 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)
taskkill /F /IM streamlit.exe 2>nul

pip install -r requirements.txt -q 2>nul

python -c "from database import init_database; init_database()" 2>nul

start /b python -m streamlit run app.py --server.port 8503 --server.headless true

echo.
echo ===============================
echo   GeoRoute Pro INICIADO!
echo ===============================
echo.
echo   Browser: http://localhost:8503
echo.
echo   Login: demo@georoute.pt / demo123
echo.

ping -n 3 127.0.0.1 >nul

start http://localhost:8503
