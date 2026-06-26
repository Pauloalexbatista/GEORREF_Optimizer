@echo off
title GeoRoute Pro - Parar

echo A parar o servidor...
taskkill /F /IM streamlit.exe 2>nul

rem Matar qualquer processo python que esteja a escutar na porta 8503
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8503 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

echo.
echo Servidor GeoRoute parado com sucesso!
echo.
