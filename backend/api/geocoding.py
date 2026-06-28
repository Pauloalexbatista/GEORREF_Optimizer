from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import io
import uuid
import os
import shutil
import pandas as pd
import sys

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_db, get_projeto
from utils.geocoder_engine import WaterfallGeocoder
from backend.api.auth import get_current_user, UserResponse

router = APIRouter(prefix="/geocoding", tags=["geocoding"])

# Directory to store temporary uploaded files
TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "temp_uploads")
os.makedirs(TEMP_DIR, exist_ok=True)

class ColumnMapping(BaseModel):
    file_id: str
    project_id: int
    col_code: str
    col_name: str
    col_addr: str
    col_cp: str
    col_city: str
    col_weight: str
    col_volume: str
    col_priority: Optional[str] = None
    col_start_window: Optional[str] = None
    col_end_window: Optional[str] = None
    col_lat: Optional[str] = None
    col_lon: Optional[str] = None

class DeliveryCorrection(BaseModel):
    morada: str
    codigo_postal: str
    concelho: str
    latitude: float
    longitude: float

@router.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: UserResponse = Depends(get_current_user)):
    # Verify file extension
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".xlsx", ".xls", ".csv"]:
        raise HTTPException(status_code=400, detail="Apenas ficheiros Excel (.xlsx, .xls) ou CSV são suportados.")
        
    file_id = str(uuid.uuid4())
    temp_path = os.path.join(TEMP_DIR, f"{file_id}{ext}")
    
    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Read columns
        if ext == ".csv":
            try:
                df = pd.read_csv(temp_path, nrows=2, sep=";")
            except Exception:
                df = pd.read_csv(temp_path, nrows=2, sep=",")
        else:
            df = pd.read_excel(temp_path, nrows=2)
            
        return {
            "file_id": file_id,
            "filename": file.filename,
            "columns": list(df.columns)
        }
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"Erro ao ler colunas do ficheiro: {str(e)}")

@router.post("/start")
async def start_geocoding(mapping: ColumnMapping, current_user: UserResponse = Depends(get_current_user)):
    # 1. Find the uploaded file
    file_path = None
    for f in os.listdir(TEMP_DIR):
        if f.startswith(mapping.file_id):
            file_path = os.path.join(TEMP_DIR, f)
            break
            
    if not file_path:
        raise HTTPException(status_code=404, detail="Ficheiro temporário expirou ou não foi encontrado. Por favor faça upload novamente.")
        
    # 2. Check project permission
    proj = get_projeto(mapping.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    ext = os.path.splitext(file_path)[1].lower()
    try:
        # Read the entire file
        if ext == ".csv":
            try:
                df = pd.read_csv(file_path, sep=";")
            except Exception:
                df = pd.read_csv(file_path, sep=",")
        else:
            df = pd.read_excel(file_path)
            
        # Validate that mapped columns exist in df
        required_cols = [mapping.col_code, mapping.col_name, mapping.col_addr, mapping.col_cp, mapping.col_city, mapping.col_weight, mapping.col_volume]
        for col in required_cols:
            if col not in df.columns:
                raise HTTPException(status_code=400, detail=f"Coluna mapeada '{col}' não encontrada no ficheiro.")
                
        # Initialize Geocoder
        google_api_key = current_user.google_api_key if hasattr(current_user, 'google_api_key') else None
        if not google_api_key:
            from database import get_google_api_key
            google_api_key = get_google_api_key()
            
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "geocoding_multi.db")
        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)
        
        # Clear existing deliveries for project
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (mapping.project_id,))
            conn.commit()
            
        success_count = 0
        fail_count = 0
        
        for idx, row in df.iterrows():
            code = str(row[mapping.col_code])
            name = str(row[mapping.col_name])
            addr = str(row[mapping.col_addr])
            cp = str(row[mapping.col_cp]) if pd.notna(row[mapping.col_cp]) else ""
            city = str(row[mapping.col_city]) if pd.notna(row[mapping.col_city]) else ""
            weight = float(row[mapping.col_weight]) if pd.notna(row[mapping.col_weight]) else 0.0
            volume = float(row[mapping.col_volume]) if pd.notna(row[mapping.col_volume]) else 0.0
            
            priority = 2
            if mapping.col_priority and mapping.col_priority in df.columns:
                try:
                    priority = int(row[mapping.col_priority])
                except Exception:
                    priority = 2
                    
            start_window = "08:00"
            if mapping.col_start_window and mapping.col_start_window in df.columns:
                start_window = str(row[mapping.col_start_window])
                
            end_window = "18:00"
            if mapping.col_end_window and mapping.col_end_window in df.columns:
                end_window = str(row[mapping.col_end_window])
                
            has_coords = False
            lat_val = 0.0
            lon_val = 0.0
            if mapping.col_lat and mapping.col_lat in df.columns and mapping.col_lon and mapping.col_lon in df.columns:
                try:
                    e_lat = row[mapping.col_lat]
                    e_lon = row[mapping.col_lon]
                    if pd.notna(e_lat) and pd.notna(e_lon):
                        lat_val = float(e_lat)
                        lon_val = float(e_lon)
                        if lat_val != 0 and -90 <= lat_val <= 90:
                            has_coords = True
                except Exception:
                    has_coords = False
                    
            if has_coords:
                res = {
                    "lat": lat_val,
                    "lon": lon_val,
                    "quality_level": 0,
                    "source": "FICHEIRO",
                    "morada_encontrada": addr
                }
            else:
                try:
                    res = geocoder.resolve_address(addr, cp, city)
                except Exception:
                    res = None
                    
            if res and res.get('lat') and res.get('lon'):
                lat = res['lat']
                lon = res['lon']
                quality = res.get('quality_level', 1)
                source = res.get('source', 'NOMINATIM')
                morada_encontrada = res.get('morada_encontrada', addr)
                success_count += 1
            else:
                lat = 0.0
                lon = 0.0
                quality = 99
                source = "FALHA"
                morada_encontrada = ""
                fail_count += 1
                
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    INSERT INTO entregas (
                        projeto_id, codigo_cliente, morada, codigo_postal, _concelho,
                        peso_kg, volume_m3, prioridade, janela_inicio, janela_fim,
                        latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    mapping.project_id, code, addr, cp, city,
                    weight, volume, priority, start_window, end_window,
                    lat, lon, quality, source, morada_encontrada
                ))
                conn.commit()
                
        os.remove(file_path)
        
        return {
            "status": "success",
            "total": len(df),
            "success": success_count,
            "failed": fail_count
        }
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Erro durante a geocodificação: {str(e)}")

@router.get("/{project_id}")
def get_deliveries(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC", (project_id,))
            rows = cursor.fetchall()
            
            res = []
            for r in rows:
                res.append({
                    "id": r["id"],
                    "codigo_cliente": r["codigo_cliente"],
                    "morada": r["morada"],
                    "codigo_postal": r["codigo_postal"],
                    "concelho": r["_concelho"],
                    "peso_kg": r["peso_kg"],
                    "volume_m3": r["volume_m3"],
                    "prioridade": r["prioridade"],
                    "janela_inicio": r["janela_inicio"],
                    "janela_fim": r["janela_fim"],
                    "latitude": r["latitude"],
                    "longitude": r["longitude"],
                    "nivel_qualidade": r["nivel_qualidade"],
                    "fonte_match": r["fonte_match"],
                    "morada_encontrada": r["morada_encontrada"]
                })
            return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/delivery/{delivery_id}")
def update_delivery_correction(delivery_id: int, corr: DeliveryCorrection, current_user: UserResponse = Depends(get_current_user)):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT e.id, p.empresa_id 
                FROM entregas e 
                JOIN projetos p ON e.projeto_id = p.id 
                WHERE e.id = ?
            """, (delivery_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Entrega não encontrada.")
            if row["empresa_id"] != current_user.empresa_id:
                raise HTTPException(status_code=403, detail="Não tem permissão para editar esta entrega.")
                
            cursor.execute("""
                UPDATE entregas 
                SET morada = ?, codigo_postal = ?, _concelho = ?,
                    latitude = ?, longitude = ?, nivel_qualidade = 1, fonte_match = 'CORRECAO_MANUAL'
                WHERE id = ?
            """, (corr.morada, corr.codigo_postal, corr.concelho, corr.latitude, corr.longitude, delivery_id))
            conn.commit()
            
            try:
                db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "geocoding_multi.db")
                geocoder = WaterfallGeocoder(db_path)
                learned_entry = {
                    "original_address": corr.morada,
                    "lat": corr.latitude,
                    "lon": corr.longitude,
                    "cp4": corr.codigo_postal[:4] if len(corr.codigo_postal) >= 4 else "",
                    "concelho": corr.concelho
                }
                geocoder.save_learned_batch([learned_entry])
            except Exception as e:
                print(f"Error saving learned batch: {e}")
                
            return {"status": "success", "message": "Geocodificação corrigida e guardada no sistema."}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
