from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import sys
import pandas as pd
import json

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_db, get_projeto
from utils.geocoder_engine import WaterfallGeocoder
from utils.persistence_manager import serialize_state, deserialize_state
from backend.api.auth import get_current_user, UserResponse

router = APIRouter(prefix="/fleet", tags=["fleet"])

class WarehouseItem(BaseModel):
    name: str
    address: str
    cp: str
    locality: str

class WarehouseGeocoded(BaseModel):
    name: str
    address: str
    cp: str
    locality: str
    lat: float
    lon: float
    quality: int

class VehicleItem(BaseModel):
    veiculo: str
    armazem: str
    capacidade_kg: float
    capacidade_vol: float
    custo_km: float
    velocidade_media: float
    horario_inicio: str
    horario_fim: str

class FleetSaveRequest(BaseModel):
    fleet: List[VehicleItem]
    warehouses: List[WarehouseGeocoded]

@router.post("/geocode-warehouses", response_model=List[WarehouseGeocoded])
def geocode_warehouses(warehouses: List[WarehouseItem], current_user: UserResponse = Depends(get_current_user)):
    google_api_key = current_user.google_api_key if hasattr(current_user, "google_api_key") else None
    if not google_api_key:
        from database import get_google_api_key
        google_api_key = get_google_api_key()
        
    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "geocoding_multi.db")
    geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)
    
    res = []
    for wh in warehouses:
        try:
            r_coords = geocoder.resolve_address(wh.address, wh.cp, wh.locality)
        except Exception:
            r_coords = None
            
        if r_coords and r_coords.get("lat") and r_coords.get("lon"):
            lat = r_coords["lat"]
            lon = r_coords["lon"]
            quality = r_coords.get("quality_level", 1)
        else:
            lat = 0.0
            lon = 0.0
            quality = 99  # Failed indicator
            
        res.append(WarehouseGeocoded(
            name=wh.name,
            address=wh.address,
            cp=wh.cp,
            locality=wh.locality,
            lat=lat,
            lon=lon,
            quality=quality
        ))
    return res

@router.get("/{project_id}")
def get_fleet_config(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
            if not row:
                return {"fleet": [], "warehouses": []}
                
            state_dict = deserialize_state(row["payload_json"])
            
            raw_wh = state_dict.get("warehouses_geocoded")
            warehouses_res = []
            if raw_wh is not None:
                if isinstance(raw_wh, pd.DataFrame):
                    df_wh = raw_wh
                else:
                    df_wh = pd.DataFrame(raw_wh)
                    
                if not df_wh.empty:
                    for idx, r in df_wh.iterrows():
                        warehouses_res.append({
                            "name": r.get("Nome_Armazem", r.get("name", "")),
                            "address": r.get("Morada", r.get("address", "")),
                            "cp": r.get("CP", r.get("cp", "")),
                            "locality": r.get("Localidade", r.get("locality", "")),
                            "lat": float(r.get("Latitude", r.get("lat", 0.0))),
                            "lon": float(r.get("Longitude", r.get("lon", 0.0))),
                            "quality": int(r.get("Nivel_Qualidade", r.get("quality", 1)))
                        })
            
            raw_fleet = state_dict.get("fleet_config")
            fleet_res = []
            if raw_fleet is not None:
                for veh_name, veh in raw_fleet.items():
                    if hasattr(veh, "capacidade_kg"):
                        fleet_res.append({
                            "veiculo": veh_name,
                            "armazem": getattr(veh, "armazem", ""),
                            "capacidade_kg": getattr(veh, "capacidade_kg", 0.0),
                            "capacidade_vol": getattr(veh, "capacidade_vol", 0.0),
                            "custo_km": getattr(veh, "custo_km", 0.0),
                            "velocidade_media": getattr(veh, "velocidade_media", 0.0),
                            "horario_inicio": getattr(veh, "horario_inicio", "08:00"),
                            "horario_fim": getattr(veh, "horario_fim", "18:00")
                        })
                    elif isinstance(veh, dict):
                        fleet_res.append({
                            "veiculo": veh_name,
                            "armazem": veh.get("armazem", ""),
                            "capacidade_kg": veh.get("capacidade_kg", 0.0),
                            "capacidade_vol": veh.get("capacidade_vol", 0.0),
                            "custo_km": veh.get("custo_km", 0.0),
                            "velocidade_media": veh.get("velocidade_media", 0.0),
                            "horario_inicio": veh.get("horario_inicio", "08:00"),
                            "horario_fim": veh.get("horario_fim", "18:00")
                        })
                        
            return {"fleet": fleet_res, "warehouses": warehouses_res}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{project_id}")
def save_fleet_config(project_id: int, req: FleetSaveRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
            if row:
                state_dict = deserialize_state(row["payload_json"])
            else:
                state_dict = {}
                
        wh_rows = []
        for wh in req.warehouses:
            wh_rows.append({
                "Nome_Armazem": wh.name,
                "Morada": wh.address,
                "CP": wh.cp,
                "Localidade": wh.locality,
                "Latitude": wh.lat,
                "Longitude": wh.lon,
                "Nivel_Qualidade": wh.quality
            })
        df_wh = pd.DataFrame(wh_rows)
        state_dict["warehouses_geocoded"] = df_wh
        
        from core.session_state import FleetVehicle
        fleet_dict = {}
        for veh in req.fleet:
            fleet_dict[veh.veiculo] = FleetVehicle(
                capacidade_kg=veh.capacidade_kg,
                capacidade_vol=veh.capacidade_vol,
                custo_km=veh.custo_km,
                velocidade_media=veh.velocidade_media,
                horario_inicio=veh.horario_inicio,
                horario_fim=veh.horario_fim,
                armazem=veh.armazem
            )
        state_dict["fleet_config"] = fleet_dict
        state_dict["phase_2_complete"] = True
        
        payload = serialize_state(state_dict)
        
        from datetime import datetime
        snapshot_name = f"Config Frota/Armazéns ({datetime.now().strftime('%H:%M:%S')})"
        user_id = current_user.id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", (project_id, user_id, 2, snapshot_name, payload))
            conn.commit()
            
        return {"status": "success", "message": "Configuração da frota e armazéns guardada com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
