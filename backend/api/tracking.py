from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import pandas as pd
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_db, get_projeto
from backend.api.auth import get_current_user, UserResponse
from utils.persistence_manager import serialize_state, deserialize_state

router = APIRouter(prefix="/tracking", tags=["tracking"])

class AssignDriverPayload(BaseModel):
    route_name: str
    driver_name: str
    vehicle: Optional[str] = ""

class UpdateStopPayload(BaseModel):
    stop_id: Optional[int] = None
    client_name: Optional[str] = None
    route_name: str
    status: str
    fail_reason: Optional[str] = ""
    driver_notes: Optional[str] = ""
    actual_time: Optional[str] = None

@router.get("/{project_id}")
def get_project_tracking(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        
        if not row:
            return {
                "totals": {"total_stops": 0, "entregues": 0, "falhadas": 0, "pendentes": 0, "rate": 0},
                "routes": [],
                "drivers": [],
                "activity": []
            }
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        
        if raw_routes is None:
            return {
                "totals": {"total_stops": 0, "entregues": 0, "falhadas": 0, "pendentes": 0, "rate": 0},
                "routes": [],
                "drivers": [],
                "activity": []
            }
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if df_routes.empty:
            return {
                "totals": {"total_stops": 0, "entregues": 0, "falhadas": 0, "pendentes": 0, "rate": 0},
                "routes": [],
                "drivers": [],
                "activity": []
            }
            
        # Ensure status columns
        if "Estado" not in df_routes.columns:
            df_routes["Estado"] = "Pendente"
        if "Hora_Picagem" not in df_routes.columns:
            df_routes["Hora_Picagem"] = ""
        if "Motivo_Falha" not in df_routes.columns:
            df_routes["Motivo_Falha"] = ""
        if "Notas_Motorista" not in df_routes.columns:
            df_routes["Notas_Motorista"] = ""
            
        total_stops = len(df_routes)
        entregues = int((df_routes["Estado"] == "Entregue").sum())
        falhadas = int((df_routes["Estado"] == "Não Entregue").sum())
        pendentes = int(total_stops - entregues - falhadas)
        rate = round((entregues / total_stops * 100)) if total_stops > 0 else 0
        
        # Build route breakdown
        routes_list = []
        unique_routes = df_routes["Rota"].dropna().unique()
        
        for r_name in unique_routes:
            if str(r_name).lower() in ["por distribuir", "pendente", "nan", ""]:
                continue
            df_r = df_routes[df_routes["Rota"] == r_name]
            r_total = len(df_r)
            r_entregues = int((df_r["Estado"] == "Entregue").sum())
            r_falhadas = int((df_r["Estado"] == "Não Entregue").sum())
            r_pendentes = r_total - r_entregues - r_falhadas
            
            stops = []
            for _, s_row in df_r.iterrows():
                stops.append({
                    "id": int(s_row.get("id", s_row.get("ID_Original", 0))) if pd.notna(s_row.get("id", s_row.get("ID_Original", 0))) else 0,
                    "sequence": int(s_row.get("Ordem", 0)) if pd.notna(s_row.get("Ordem", 0)) else 0,
                    "client_name": str(s_row.get("Cliente", "")),
                    "address": str(s_row.get("Morada", "")),
                    "postal_code": str(s_row.get("CodPostal", s_row.get("Cod_Postal", ""))),
                    "locality": str(s_row.get("Localidade", "")),
                    "phone": str(s_row.get("Contacto", s_row.get("Telefone", ""))),
                    "window_start": str(s_row.get("Janela_Inicio", s_row.get("Janela1_Inicio", "08:00"))),
                    "window_end": str(s_row.get("Janela_Fim", s_row.get("Janela1_Fim", "18:00"))),
                    "expected_arrival": str(s_row.get("Chegada", "")),
                    "actual_arrival_time": str(s_row.get("Hora_Picagem", "")),
                    "status": str(s_row.get("Estado", "Pendente")),
                    "fail_reason": str(s_row.get("Motivo_Falha", "")),
                    "driver_notes": str(s_row.get("Notas_Motorista", "")),
                    "weight_kg": float(s_row.get("Peso", 0.0)) if pd.notna(s_row.get("Peso", 0)) else 0.0,
                    "packages": int(s_row.get("Volumes", 1)) if pd.notna(s_row.get("Volumes", 1)) else 1,
                    "lat": float(s_row.get("Latitude", s_row.get("Lat", 0.0))) if pd.notna(s_row.get("Latitude", s_row.get("Lat", 0.0))) else 0.0,
                    "lng": float(s_row.get("Longitude", s_row.get("Lon", 0.0))) if pd.notna(s_row.get("Longitude", s_row.get("Lon", 0.0))) else 0.0,
                })
                
            routes_list.append({
                "route_id": str(r_name),
                "driver_name": str(df_r.iloc[0].get("Motorista", "Não Atribuído")) if "Motorista" in df_r.columns and pd.notna(df_r.iloc[0].get("Motorista")) else "Não Atribuído",
                "vehicle": str(df_r.iloc[0].get("Viatura", df_r.iloc[0].get("Matricula", "-"))) if "Viatura" in df_r.columns and pd.notna(df_r.iloc[0].get("Viatura")) else "-",
                "total": r_total,
                "entregues": r_entregues,
                "falhadas": r_falhadas,
                "pendentes": r_pendentes,
                "stops": stops,
                "last_lat": stops[0]["lat"] if stops and stops[0]["lat"] != 0 else None,
                "last_lng": stops[0]["lng"] if stops and stops[0]["lng"] != 0 else None,
                "last_gps_time": datetime.now().strftime("%H:%M")
            })
            
        return {
            "totals": {
                "total_stops": total_stops,
                "entregues": entregues,
                "falhadas": falhadas,
                "pendentes": pendentes,
                "rate": rate
            },
            "routes": routes_list,
            "drivers": [],
            "activity": []
        }
