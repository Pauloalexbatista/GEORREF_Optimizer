import os
import shutil
import tempfile
from datetime import datetime
from typing import Optional, List
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from .models import (
    get_db, init_db, clear_session_db, set_session_meta, get_session_meta
)
from .excel_handler import (
    parse_and_import_excel, generate_export_excel, DEFAULT_FAILURE_REASONS
)
from .template_generator import build_app_georouteplan_template

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
STATIC_DIR = os.path.join(FRONTEND_DIR, "static")
TEMPLATES_DIR = os.path.join(FRONTEND_DIR, "templates")
DATA_DIR = os.path.join(BASE_DIR, "data")
EXPORTS_DIR = os.path.join(DATA_DIR, "exports")
os.makedirs(EXPORTS_DIR, exist_ok=True)

# Master manager password (can be overridden by environment variable)
MASTER_MANAGER_PASSWORD = os.environ.get("GEO_MANAGER_PASSWORD", "admin123")

app = FastAPI(title="AppGeoRoutePlan", version="1.0.0")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

@app.on_event("startup")
def startup_event():
    init_db()

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)

# --- Page Routes (Compatible with modern Starlette / FastAPI) ---

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse(request=request, name="login.html", context={})

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(request=request, name="login.html", context={})

@app.get("/driver", response_class=HTMLResponse)
async def driver_page(request: Request):
    return templates.TemplateResponse(request=request, name="driver.html", context={})

@app.get("/manager", response_class=HTMLResponse)
async def manager_page(request: Request):
    return templates.TemplateResponse(request=request, name="manager.html", context={})

# --- Pydantic Request Models ---

class LoginRequest(BaseModel):
    password: str

class StopUpdateRequest(BaseModel):
    stop_id: int
    status: str # "Entregue", "Não Entregue", "Pendente"
    fail_reason: Optional[str] = ""
    driver_notes: Optional[str] = ""
    driver_id: Optional[int] = None
    lat: Optional[float] = None
    lng: Optional[float] = None

class GpsPingRequest(BaseModel):
    driver_id: int
    lat: float
    lng: float

class AssignDriverRequest(BaseModel):
    driver_id: int
    route_id: str

class AddReasonRequest(BaseModel):
    reason: str

# --- API Endpoints ---

@app.post("/api/login")
async def api_login(req: LoginRequest):
    pwd = req.password.strip()
    if not pwd:
        raise HTTPException(status_code=400, detail="Senha obrigatória")
        
    # Check Manager
    if pwd == MASTER_MANAGER_PASSWORD:
        return {
            "success": True,
            "role": "manager",
            "name": "Gestor de Tráfego"
        }
        
    # Check Driver
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM drivers WHERE password = ?", (pwd,))
    driver = cursor.fetchone()
    conn.close()
    
    if driver:
        return {
            "success": True,
            "role": "driver",
            "driver_id": driver["id"],
            "name": driver["name"],
            "vehicle": driver["vehicle"] or "",
            "route_id": driver["assigned_route_id"] or ""
        }
        
    raise HTTPException(status_code=401, detail="Senha incorreta")

@app.post("/api/import")
async def api_import_excel(file: UploadFile = File(...)):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Ficheiro deve ser um Excel (.xlsx ou .xls)")
        
    temp_path = os.path.join(DATA_DIR, f"temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{file.filename}")
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        summary = parse_and_import_excel(temp_path, file.filename)
        return {"success": True, "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar Excel: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.get("/api/session/status")
async def api_session_status():
    imported_at = get_session_meta("imported_at")
    filename = get_session_meta("file_name")
    warehouse = get_session_meta("warehouse_info") or "Armazém Principal"
    total_stops = get_session_meta("total_stops") or "0"
    total_routes = get_session_meta("total_routes") or "0"
    is_active = get_session_meta("session_active") == "1"
    
    return {
        "active": is_active,
        "imported_at": imported_at,
        "filename": filename,
        "warehouse": warehouse,
        "total_stops": int(total_stops),
        "total_routes": int(total_routes)
    }

@app.get("/api/driver/data")
async def api_driver_data(driver_id: int):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM drivers WHERE id = ?", (driver_id,))
    driver = cursor.fetchone()
    if not driver:
        conn.close()
        raise HTTPException(status_code=404, detail="Motorista não encontrado")
        
    route_id = driver["assigned_route_id"]
    stops = []
    if route_id:
        cursor.execute("""
            SELECT * FROM route_stops 
            WHERE route_id = ? 
            ORDER BY sequence ASC, id ASC
        """, (route_id,))
        stops = [dict(row) for row in cursor.fetchall()]
        
    cursor.execute("SELECT reason FROM failure_reasons ORDER BY id ASC")
    reasons = [r["reason"] for r in cursor.fetchall()]
    
    conn.close()
    
    return {
        "driver": {
            "id": driver["id"],
            "name": driver["name"],
            "vehicle": driver["vehicle"],
            "route_id": route_id
        },
        "stops": stops,
        "reasons": reasons
    }

@app.post("/api/driver/update_stop")
async def api_update_stop(req: StopUpdateRequest):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM route_stops WHERE id = ?", (req.stop_id,))
    stop = cursor.fetchone()
    if not stop:
        conn.close()
        raise HTTPException(status_code=404, detail="Paragem não encontrada")
        
    prev_status = stop["status"]
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    cursor.execute("""
        UPDATE route_stops 
        SET status = ?, fail_reason = ?, driver_notes = ?, updated_at = ?, delivered_lat = ?, delivered_lng = ?
        WHERE id = ?
    """, (req.status, req.fail_reason, req.driver_notes, now_str, req.lat, req.lng, req.stop_id))
    
    # Get driver name
    driver_name = "Motorista"
    if req.driver_id:
        cursor.execute("SELECT name FROM drivers WHERE id = ?", (req.driver_id,))
        drv = cursor.fetchone()
        if drv:
            driver_name = drv["name"]
            
    # Log action
    cursor.execute("""
        INSERT INTO activity_log (
            route_id, stop_id, client_name, action, previous_status, new_status, reason, notes, driver_name, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        stop["route_id"], stop["id"], stop["client_name"], 
        f"Alteração de Estado para {req.status}", prev_status, req.status, 
        req.fail_reason or "", req.driver_notes or "", driver_name, now_str
    ))
    
    conn.commit()
    conn.close()
    
    return {"success": True, "updated_at": now_str, "status": req.status}

@app.post("/api/driver/gps_ping")
async def api_driver_gps(req: GpsPingRequest):
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE drivers 
        SET last_lat = ?, last_lng = ?, last_gps_time = ?
        WHERE id = ?
    """, (req.lat, req.lng, now_str, req.driver_id))
    conn.commit()
    conn.close()
    return {"success": True, "timestamp": now_str}

@app.get("/api/manager/dashboard")
async def api_manager_dashboard():
    conn = get_db()
    cursor = conn.cursor()
    
    # Overview
    cursor.execute("""
        SELECT 
            COUNT(id) as total_stops,
            SUM(CASE WHEN status = 'Entregue' THEN 1 ELSE 0 END) as entregues,
            SUM(CASE WHEN status = 'Não Entregue' THEN 1 ELSE 0 END) as falhadas,
            SUM(CASE WHEN status = 'Pendente' THEN 1 ELSE 0 END) as pendentes
        FROM route_stops
    """)
    totals = dict(cursor.fetchone())
    
    # Routes breakdown
    cursor.execute("""
        SELECT 
            rs.route_id,
            COUNT(rs.id) as total,
            SUM(CASE WHEN rs.status = 'Entregue' THEN 1 ELSE 0 END) as entregues,
            SUM(CASE WHEN rs.status = 'Não Entregue' THEN 1 ELSE 0 END) as falhadas,
            SUM(CASE WHEN rs.status = 'Pendente' THEN 1 ELSE 0 END) as pendentes,
            d.id as driver_id,
            d.name as driver_name,
            d.vehicle,
            d.last_lat,
            d.last_lng,
            d.last_gps_time
        FROM route_stops rs
        LEFT JOIN drivers d ON d.assigned_route_id = rs.route_id
        GROUP BY rs.route_id
        ORDER BY rs.route_id
    """)
    routes = [dict(row) for row in cursor.fetchall()]
    
    # All drivers
    cursor.execute("SELECT * FROM drivers ORDER BY name ASC")
    drivers = [dict(row) for row in cursor.fetchall()]
    
    # Available routes list
    cursor.execute("SELECT DISTINCT route_id FROM route_stops ORDER BY route_id")
    available_routes = [r["route_id"] for r in cursor.fetchall()]
    
    # Activity log (recent 40 items)
    cursor.execute("SELECT * FROM activity_log ORDER BY id DESC LIMIT 40")
    activity = [dict(row) for row in cursor.fetchall()]
    
    # Failure reasons
    cursor.execute("SELECT * FROM failure_reasons ORDER BY id ASC")
    reasons = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return {
        "totals": totals,
        "routes": routes,
        "drivers": drivers,
        "available_routes": available_routes,
        "activity": activity,
        "reasons": reasons
    }

@app.get("/api/manager/route_details/{route_id}")
async def api_manager_route_details(route_id: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM route_stops 
        WHERE route_id = ? 
        ORDER BY sequence ASC, id ASC
    """, (route_id,))
    stops = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"route_id": route_id, "stops": stops}

@app.post("/api/manager/assign")
async def api_manager_assign(req: AssignDriverRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE drivers SET assigned_route_id = ? WHERE id = ?", (req.route_id, req.driver_id))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/reasons")
async def api_get_reasons():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM failure_reasons ORDER BY id ASC")
    reasons = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {"reasons": reasons}

@app.post("/api/reasons")
async def api_add_reason(req: AddReasonRequest):
    reason_str = req.reason.strip()
    if not reason_str:
        raise HTTPException(status_code=400, detail="Motivo inválido")
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO failure_reasons (reason) VALUES (?)", (reason_str,))
    conn.commit()
    conn.close()
    return {"success": True}

@app.get("/api/template")
async def api_download_template():
    template_path = os.path.join(DATA_DIR, "AppGeoRoutePlan_Template.xlsx")
    if not os.path.exists(template_path):
        build_app_georouteplan_template(template_path)
    return FileResponse(
        template_path,
        filename="AppGeoRoutePlan.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

@app.get("/api/export")
async def api_export_excel():
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_filename = f"Relatorio_Distribuicao_{now_str}.xlsx"
    export_path = os.path.join(EXPORTS_DIR, export_filename)
    
    try:
        generate_export_excel(export_path)
        return FileResponse(
            export_path,
            filename=export_filename,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao gerar Excel: {str(e)}")

@app.post("/api/clear")
async def api_clear_session():
    clear_session_db()
    set_session_meta("session_active", "0")
    return {"success": True, "message": "Sessão do dia limpa com sucesso!"}
