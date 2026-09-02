@echo off
title GeoRoute Pro - Parar Servicos

cd /d "%~dp0"

echo A terminar servicos do GeoRoute Pro...

:: Terminar processos na porta 8000 (Backend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)

:: Terminar processos na porta 3000 (Frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a 2>nul
)

echo Servicos terminados com sucesso.
exit
