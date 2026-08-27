@echo off
title AppGeoRoutePlan - Servidor WebApp
cls
echo ====================================================================
echo                     AppGeoRoutePlan (WebApp)
echo ====================================================================
echo.
echo   [+] O servidor esta a iniciar...
echo.

:: Detecta o IP local automaticamente
for /f "tokens=4" %%a in ('route print ^| findstr 0.0.0.0 ^| findstr /v "0.0.0.0.*0.0.0.0"') do (
    set LOCAL_IP=%%a
)
if "%LOCAL_IP%"=="" set LOCAL_IP=192.168.1.75

echo   ----------------------------------------------------------------
echo   COMO ACEDER A APLICACAO:
echo   ----------------------------------------------------------------
echo   - No Computador: http://localhost:8000
echo   - No Telemovel:  http://%LOCAL_IP%:8000  (no mesmo Wi-Fi)
echo.
echo   CREDENCIAIS PARA TESTE:
echo   - Gestor de Trafego (Master): admin123
echo   - Motorista Norte (Joao):     1111
echo   - Motorista Sul (Carlos):     2222
echo   ----------------------------------------------------------------
echo.
echo   [+] A abrir o navegador em http://localhost:8000 ...
echo   (Nota: Mantenha esta janela aberta enquanto utiliza a aplicacao)
echo.
echo ====================================================================
echo.

cd /d "%~dp0"

:: Abre o navegador em background automaticamente apos 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000"

:: Inicia o servidor Python Uvicorn
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload

pause
