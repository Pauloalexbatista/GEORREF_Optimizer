@echo off
echo A iniciar a Aplicacao de Geocoding...
echo Por favor aguarde enquanto o navegador abre.
cd /d "%~dp0"
python -m streamlit run "%~dp0app.py"
pause
