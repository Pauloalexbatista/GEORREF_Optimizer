@echo off
title GeoRoute Pro - Gestão de Arranque

cd /d "%~dp0"

echo ===================================================
echo             GeoRoute Pro - Arranque
echo ===================================================
echo.
echo A iniciar a plataforma (FastAPI + Next.js)...
echo.

:: Fechar instâncias anteriores nas portas 8000 e 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)

:: Iniciar Backend FastAPI na porta 8000
start "GeoRoute Backend API" /b python -m uvicorn backend.main:app --port 8000 --reload

:: Iniciar Frontend Next.js na porta 3000
cd frontend
start "GeoRoute Frontend Web" /b npm run dev
cd ..

echo.
echo A aguardar inicialização dos serviços...
ping -n 4 127.0.0.1 >nul

:: Abrir navegador
start http://localhost:3000

echo ===================================================
echo GeoRoute Pro em execução!
echo - Frontend: http://localhost:3000
echo - Backend API: http://localhost:8000
echo - Documentação API: http://localhost:8000/docs
echo ===================================================
exit
