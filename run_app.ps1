# Start the Backend FastAPI server in a new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "python -m uvicorn backend.main:app --port 8000 --reload" -WindowStyle Normal

# Start the Frontend Next.js server in a new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev" -WindowStyle Normal

Write-Host "Servidores iniciados com sucesso!" -ForegroundColor Green
Write-Host "Frontend (Next.js): http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend (FastAPI):  http://localhost:8000" -ForegroundColor Cyan
