@echo off
chcp 65001 >nul
title GeoRoute Pro - A Iniciar...

echo.
echo ========================================
echo   GeoRoute Pro - Preparando Tudo...
echo ========================================
echo.

cd /d "%~dp0"

echo [1/4] A instalar dependencias...
pip install -r requirements.txt -q
echo      OK

echo.
echo [2/4] A inicializar base de dados...
python -c "from database import init_database; init_database()" 2>nul
echo      OK

echo.
echo [3/4] A limpar servidores anteriores...
taskkill /F /IM streamlit.exe 2>nul
taskkill /F /IM python.exe 2>nul
echo      OK

echo.
echo [4/4] A iniciar servidor...
start /b python server.py start 8502 >nul 2>&1

echo.
echo ========================================
echo   GeoRoute Pro INICIADO!
echo ========================================
echo.
echo   Acede no browser: http://localhost:8502
echo.
echo   Credenciais demo:
echo   - Email: demo@georoute.pt
echo   - Password: demo123
echo.
echo   Para PARAR o servidor: georoute.bat stop
echo.

timeout /t 3 /nobreak >nul
start http://localhost:8502
