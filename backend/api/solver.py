from utils.validation_auditor import audit_route_plan
def _pick_first_valid(*candidates):
    for c in candidates:
        if c is not None:
            if isinstance(c, pd.DataFrame):
                if not c.empty:
                    return c
            elif isinstance(c, (dict, list, str)):
                if len(c) > 0:
                    return c
            else:
                return c
    return None

from utils.google_routes_engine import calculate_google_traffic_route, get_google_api_key
from fastapi.responses import StreamingResponse
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import sys
import io
import pandas as pd
from datetime import datetime, timedelta
import math

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_db, get_projeto, ensure_entregas_columns
from utils.distance_calculator import calculate_haversine_matrix
from utils.optimization_solver import AdvancedRouteOptimizer
from utils.persistence_manager import serialize_state, deserialize_state
from backend.api.auth import get_current_user, UserResponse

router = APIRouter(prefix="/solver", tags=["solver"])

import math
import numpy as np

def clean_num(val, default=0.0):
    if val is None or pd.isna(val):
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except Exception:
        return default

def clean_int(val, default=0):
    if val is None or pd.isna(val):
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return int(f)
    except Exception:
        return default

def sanitize_json_data(obj):
    """Recursively replaces NaN, Inf, -Inf with safe values for JSON compliance."""
    if isinstance(obj, dict):
        return {k: sanitize_json_data(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_json_data(v) for v in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return 0.0
        return obj
    elif pd.isna(obj):
        return None
    return obj


class SolverRequest(BaseModel):
    project_id: int
    params: Dict[str, Any]

from typing import Optional

class ReorderRequest(BaseModel):
    project_id: int
    route_name: str
    client_code: Optional[str] = None
    delivery_id: Optional[int] = None
    address: Optional[str] = None
    new_order: int

class ReassignRequest(BaseModel):
    project_id: int
    client_code: Optional[Any] = None
    clientName: Optional[Any] = None
    delivery_id: Optional[Any] = None
    deliveryId: Optional[Any] = None
    address: Optional[Any] = None
    lat: Optional[Any] = None
    lon: Optional[Any] = None
    new_route: Any

    def get_code(self):
        val = self.client_code if self.client_code is not None else self.clientName
        return str(val).strip() if val is not None else ""

    def get_id(self):
        return self.delivery_id if self.delivery_id is not None else self.deliveryId

class BulkReassignSelectionItem(BaseModel):
    client_code: Optional[Any] = None
    clientName: Optional[Any] = None
    delivery_id: Optional[Any] = None
    deliveryId: Optional[Any] = None
    address: Optional[Any] = None
    lat: Optional[Any] = None
    lon: Optional[Any] = None

    def get_code(self):
        val = self.client_code if self.client_code is not None else self.clientName
        return str(val).strip() if val is not None else ""

    def get_id(self):
        return self.delivery_id if self.delivery_id is not None else self.deliveryId

class BulkReassignSelectionRequest(BaseModel):
    project_id: int
    items: List[BulkReassignSelectionItem]
    new_route: str

class BulkReassignRouteRequest(BaseModel):
    project_id: int
    source_route: str
    target_route: str

class OptimizeRouteRequest(BaseModel):
    project_id: int
    route_name: str

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

def is_pending_route(route_name: str) -> bool:
    if not route_name:
        return True
    s = str(route_name).upper()
    return "PENDENTE" in s or "DISTRIBUIR" in s

def format_time_slot(t_val) -> str:
    if t_val is None or pd.isna(t_val):
        return ""
    s = str(t_val).strip()
    if not s or s.lower() in ["none", "nan", "qualquer", "n/a", "nat", "0", "0.0"]:
        return ""
    if " " in s:
        s = s.split(" ")[-1].strip()
    if "T" in s:
        s = s.split("T")[-1].strip()
    if ":" in s:
        parts = s.split(":")
        try:
            h = int(parts[0])
            m = int(parts[1])
            return f"{h:02d}:{m:02d}"
        except Exception:
            pass
    return s[:5]

def format_time_window_display(start_val, end_val) -> str:
    s1 = format_time_slot(start_val)
    s2 = format_time_slot(end_val)
    if s1 and s2:
        return f"{s1} - {s2}"
    if s1:
        return f"{s1} - 23:59"
    return "Qualquer"

def parse_time_to_minutes(t_val, default=480) -> int:
    if not t_val or pd.isna(t_val):
        return default
    s = str(t_val).strip()
    if not s or s.lower() in ["none", "nan", "qualquer", "n/a", "nat"]:
        return default
    if " " in s:
        s = s.split(" ")[-1].strip()
    if "T" in s:
        s = s.split("T")[-1].strip()
    try:
        parts = s.split(":")
        if len(parts) >= 2:
            return int(parts[0]) * 60 + int(parts[1])
        return default
    except Exception:
        return default


def minutes_to_time_str(m: int) -> str:
    total_m = int(round(m))
    h = total_m // 60
    mins = total_m % 60
    if h >= 24:
        return f"+1d {h % 24:02d}:{mins:02d}"
    return f"{h:02d}:{mins:02d}"

def parse_time_window_str(win_str: str) -> tuple:
    if not win_str or str(win_str).strip().lower() in ["qualquer", "none", "", "nan", "n/a"]:
        return 0, 1440
    s = str(win_str).strip()
    if "-" in s:
        parts = s.split("-")
        s_m = parse_time_to_minutes(parts[0].strip(), 0)
        e_m = parse_time_to_minutes(parts[1].strip(), 1440)
        if e_m <= s_m:
            e_m = 1440
        return s_m, e_m
    return 0, 1440

def extract_fleet_dict(fleet_config, warehouses_df=None):
    fleet_dict = {}
    default_wh = warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "Armazém Central"
    
    if isinstance(fleet_config, pd.DataFrame):
        for _, row in fleet_config.iterrows():
            fleet_dict[str(row["Veiculo"])] = {
                "capacity": float(row.get("Capacidade_KG", 1000.0)),
                "capacity_volume": float(row.get("Cap_Volume_m3", row.get("Capacidade_Vol", 5.0))),
                "cost_per_km": float(row.get("Custo_KM", 0.65)),
                "speed": float(row.get("Velocidade_Media", 50.0)),
                "start_time": str(row.get("Hora_Inicio_Turno", row.get("Horario_Inicio", "08:00:00"))),
                "end_time": str(row.get("Hora_Fim_Turno", row.get("Horario_Fim", "18:00:00"))),
                "warehouse": str(row.get("Armazem", default_wh)),
                "regras": str(row.get("Regras", ""))
            }
    elif isinstance(fleet_config, dict):
        for v_k, v_v in fleet_config.items():
            if isinstance(v_v, dict):
                fleet_dict[str(v_k)] = {
                    "capacity": float(v_v.get("capacity", v_v.get("capacidade_kg", 1000.0))),
                    "capacity_volume": float(v_v.get("capacity_volume", v_v.get("capacidade_vol", 5.0))),
                    "cost_per_km": float(v_v.get("cost_per_km", v_v.get("custo_km", 0.65))),
                    "speed": float(v_v.get("speed", v_v.get("velocidade_media", 50.0))),
                    "start_time": str(v_v.get("start_time", v_v.get("horario_inicio", "08:00:00"))),
                    "end_time": str(v_v.get("end_time", v_v.get("horario_fim", "18:00:00"))),
                    "warehouse": str(v_v.get("warehouse", v_v.get("armazem", default_wh))),
                    "regras": str(v_v.get("regras", v_v.get("Regras", "")))
                }
            else:
                fleet_dict[str(v_k)] = {
                    "capacity": float(getattr(v_v, "capacidade_kg", 1000.0)),
                    "capacity_volume": float(getattr(v_v, "capacidade_vol", 5.0)),
                    "cost_per_km": float(getattr(v_v, "custo_km", 0.65)),
                    "speed": float(getattr(v_v, "velocidade_media", 50.0)),
                    "start_time": str(getattr(v_v, "horario_inicio", "08:00:00")),
                    "end_time": str(getattr(v_v, "horario_fim", "18:00:00")),
                    "warehouse": str(getattr(v_v, "armazem", default_wh)),
                    "regras": str(getattr(v_v, "regras", getattr(v_v, "Regras", "")))
                }
    return fleet_dict

def get_depot_coords(warehouses_df, wh_name=None):
    try:
        if warehouses_df is not None:
            if isinstance(warehouses_df, list):
                warehouses_df = pd.DataFrame(warehouses_df)
            if isinstance(warehouses_df, pd.DataFrame) and not warehouses_df.empty:
                # Find name column
                name_col = None
                for col in ["Nome_Armazem", "Nome_Armazém", "Armazem", "Armazém", "Nome", "name", "warehouse", "Armazem_Nome"]:
                    if col in warehouses_df.columns:
                        name_col = col
                        break
                
                # Find lat and lon columns
                lat_col = None
                for col in ["Latitude", "latitude", "lat", "Lat", "LAT"]:
                    if col in warehouses_df.columns:
                        lat_col = col
                        break
                        
                lon_col = None
                for col in ["Longitude", "longitude", "lon", "Lon", "lng", "Lng", "LON", "LNG"]:
                    if col in warehouses_df.columns:
                        lon_col = col
                        break
                        
                if lat_col and lon_col:
                    if wh_name and name_col:
                        wh_str = str(wh_name).strip().lower()
                        match = warehouses_df[warehouses_df[name_col].astype(str).str.strip().str.lower() == wh_str]
                        if not match.empty:
                            return float(match.iloc[0][lat_col]), float(match.iloc[0][lon_col])
                        # Fuzzy match
                        for _, w_row in warehouses_df.iterrows():
                            w_n = str(w_row[name_col]).strip().lower()
                            if w_n in wh_str or wh_str in w_n:
                                return float(w_row[lat_col]), float(w_row[lon_col])
                    return float(warehouses_df.iloc[0][lat_col]), float(warehouses_df.iloc[0][lon_col])
    except Exception as e:
        print(f"Notice in get_depot_coords: {e}")
    return 38.6593, -9.1758

def recalculate_route_stops(stops_iterable, depot_lat: float, depot_lon: float, start_time_str: str = "09:50", avg_speed: float = 50.0, default_service_time: int = 15, empresa_id: int = 1, projeto_id: int = 0, use_google_traffic: bool = False) -> list:
    stops_list = list(stops_iterable)
    if not stops_list:
        return []

    updated_stops = []
    if avg_speed <= 0:
        avg_speed = 50.0
        
    # STRICT: Vehicle departure time is EXACTLY its configured driver shift start time
    cur_time_min = parse_time_to_minutes(start_time_str, 480)
    
    # Attempt Google Routes with Live Traffic calculation only when explicitly requested
    g_legs = None
    if use_google_traffic:
        try:
            stops_coords = [(float(s.get("Latitude", 0)), float(s.get("Longitude", 0))) for s in stops_list if float(s.get("Latitude", 0)) != 0]
            if stops_coords and len(stops_coords) <= 23:
                g_res = calculate_google_traffic_route((depot_lat, depot_lon), stops_coords, cur_time_min, empresa_id=empresa_id, projeto_id=projeto_id)
                if g_res and g_res.get("legs"):
                    g_legs = g_res["legs"]
        except Exception as ge:
            print(f"[Traffic Info]: Using fallback travel model ({ge})")

    p_lat, p_lon = depot_lat, depot_lon
    cumul_dist = 0.0
    cumul_load = 0.0
    cumul_vol = 0.0
    
    order = 1
    for idx, stop_dict in enumerate(stops_list):
        c_lat = float(stop_dict.get("Latitude", p_lat))
        c_lon = float(stop_dict.get("Longitude", p_lon))
        
        if g_legs and idx < len(g_legs):
            dist = float(g_legs[idx]["distance_km"])
            travel_min = float(g_legs[idx]["duration_min"])
        else:
            dist = haversine_distance(p_lat, p_lon, c_lat, c_lon) * 1.28
            # Hybrid speed: 70 km/h for highway segments (>15km), else avg_speed (urban)
            segment_speed = 70.0 if dist > 15.0 else avg_speed
            travel_min = (dist / segment_speed) * 60.0
        cumul_dist += dist
        arr_min = cur_time_min + travel_min
        
        win_str = str(stop_dict.get("Janela_Horaria", "Qualquer") or "Qualquer")
        win_s, win_e = parse_time_window_str(win_str)
        
        # Calculate waiting time if arrived before opening
        wait_min = max(0.0, win_s - arr_min) if win_s > 0 else 0.0
        serv_start_min = arr_min + wait_min
        
        serv_time = int(stop_dict.get("Tempo_Entrega", default_service_time) or default_service_time)
        dep_min = serv_start_min + serv_time
        
        demand = float(stop_dict.get("Peso_KG", 50.0) if stop_dict.get("Peso_KG") is not None else 50.0)
        vol_demand = float(stop_dict.get("Volume_m3", 0.1) if stop_dict.get("Volume_m3") is not None else 0.1)
        cumul_load += demand
        cumul_vol += vol_demand
        
        new_row = dict(stop_dict)
        new_row["Ordem"] = order
        new_row["Peso_KG"] = demand
        new_row["Volume_m3"] = vol_demand
        new_row["Carga_Acum"] = round(cumul_load, 1)
        new_row["Carga_Vol_Acum"] = round(cumul_vol, 2)
        new_row["Volume_m3"] = vol_demand
        new_row["Chegada"] = minutes_to_time_str(arr_min)
        new_row["Tempo_Espera"] = int(round(wait_min))
        new_row["Tempo_Entrega"] = serv_time
        new_row["Saida"] = minutes_to_time_str(dep_min)
        new_row["KM_Anterior"] = round(dist, 2)
        new_row["Dist_Acum"] = round(cumul_dist, 2)
        new_row["Carga_Acum"] = round(cumul_load, 1)
        new_row["Carga_Vol_Acum"] = round(cumul_vol, 2)
        
        updated_stops.append(new_row)
        p_lat, p_lon = c_lat, c_lon
        cur_time_min = dep_min
        order += 1
        
    return updated_stops

@router.post("/solve")
def run_solver(req: SolverRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        # 1. Get latest snapshot
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Por favor configure a frota e os armazéns antes de otimizar.")
                
            state_dict = deserialize_state(row["payload_json"])
            
        # 2. Load deliveries from database
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC", (req.project_id,))
            rows = cursor.fetchall()
            
            if not rows:
                raise HTTPException(status_code=400, detail="Nenhum cliente georreferenciado encontrado no projeto.")
                
            col_names = [d[0] for d in cursor.description]
            delivery_rows = [dict(zip(col_names, r)) for r in rows]
            
            df_rows = []
            for dr in delivery_rows:
                df_rows.append({
                    "id": dr["id"],
                    "Codigo_Cliente": dr["codigo_cliente"],
                    "Nome_Cliente": dr.get("nome_cliente") or dr["codigo_cliente"],
                    "Morada": dr["morada"],
                    "Codigo_Postal": dr["codigo_postal"],
                    "Localidade": dr.get("_concelho") or dr.get("concelho", ""),
                    "Peso_KG": float(dr.get("peso_kg") or 50.0),
                    "Volume_m3": float(dr.get("volume_m3") or 0.1),
                    "Prioridade": dr.get("prioridade", 1),
                    "Slot1_Inicio": dr.get("janela_inicio", ""),
                    "Slot1_Fim": dr.get("janela_fim", ""),
                    "Latitude": float(dr["latitude"]),
                    "Longitude": float(dr["longitude"]),
                    "Nivel_Qualidade": int(dr.get("nivel_qualidade") or 0),
                    "Armazem": dr.get("armazem"),
                    "Regras": str(dr.get("regras") or "")
                })
            deliveries_df = pd.DataFrame(df_rows)
            
        # 3. Prepare warehouses and fleet DataFrames
        raw_wh = state_dict.get("warehouses_geocoded")
        if raw_wh is None or (isinstance(raw_wh, pd.DataFrame) and raw_wh.empty):
            raise HTTPException(status_code=400, detail="Nenhum armazém configurado no projeto.")
        warehouses_df = raw_wh if isinstance(raw_wh, pd.DataFrame) else pd.DataFrame(raw_wh)
        
                # Read fleet configuration directly from the database table 'frota' to get fresh updates
        db_fleet = {}
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM frota WHERE projeto_id = ? AND is_active = 1", (req.project_id,))
            fleet_rows = cursor.fetchall()
            if fleet_rows:
                col_names = [d[0] for d in cursor.description]
                for row_f in fleet_rows:
                    dict_f = dict(zip(col_names, row_f))
                    v_name = str(dict_f["veiculo"])
                    db_fleet[v_name] = {
                        "capacity": float(dict_f.get("capacidade_kg") or 1000.0),
                        "capacity_volume": float(dict_f.get("capacidade_volume") or 5.0),
                        "cost_per_km": float(dict_f.get("custo_km") or 0.65),
                        "speed": float(dict_f.get("velocidade_media") or 50.0),
                        "start_time": str(dict_f.get("horario_inicio") or "08:00:00"),
                        "end_time": str(dict_f.get("horario_fim") or "18:00:00"),
                        "warehouse": str(dict_f.get("armazem") or ""),
                        "regras": str(dict_f.get("regras") or "")
                    }
        
        # Fallback to snapshot if database table is empty
        if db_fleet:
            fleet_config = db_fleet
            
        else:
            fleet_config = state_dict.get("fleet_config")
            if not fleet_config:
                raise HTTPException(status_code=400, detail="Nenhum veculo configurado na frota.")            
        # 4. Build coordinates locations array and solver demands
        locations = []
        location_names = []
        demands = []
        volume_demands = []
        
        # Add warehouses first
        warehouse_indices = {}
        for idx, row in warehouses_df.iterrows():
            wh_name = str(row.get("Nome_Armazem", row.get("Nome", f"Armazem_{idx}")))
            locations.append((float(row["Latitude"]), float(row["Longitude"])))
            location_names.append(wh_name)
            demands.append(0.0)
            volume_demands.append(0.0)
            pos_idx = len(locations) - 1
            warehouse_indices[wh_name.strip().lower()] = pos_idx
            warehouse_indices[wh_name.strip()] = pos_idx
            
        num_warehouses = len(locations)
        client_start_idx = num_warehouses
        
        # Add clients
        for idx, row in deliveries_df.iterrows():
            c_lat = float(row["Latitude"])
            c_lon = float(row["Longitude"])
            
            # Auto-correction for inverted coordinates in Portugal bounds
            if (c_lat < 0 and c_lon > 0) or (-10.0 <= c_lat <= -6.0 and 36.0 <= c_lon <= 43.0):
                c_lat, c_lon = c_lon, c_lat
                deliveries_df.at[idx, "Latitude"] = c_lat
                deliveries_df.at[idx, "Longitude"] = c_lon
                try:
                    with get_db() as c_conn:
                        c_cursor = c_conn.cursor()
                        c_cursor.execute("UPDATE entregas SET latitude = ?, longitude = ? WHERE id = ?", (c_lat, c_lon, row["id"]))
                        c_conn.commit()
                except Exception:
                    pass

            locations.append((c_lat, c_lon))
            location_names.append(row.get("Codigo_Cliente", f"Cliente_{idx}"))
            demands.append(float(row.get("Peso_KG", 50.0)))
            volume_demands.append(float(row.get("Volume_m3", 0.1)))
            
        # Calculate distance matrix
        distance_matrix = calculate_haversine_matrix(locations)
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
                    
        # Prepare fleet configurations for solver with working shifts
        vehicle_capacities = []
        vehicle_volume_capacities = []
        depot_indices = []
        vehicle_names = []
        vehicle_warehouses = []
        vehicle_start_times = []
        vehicle_end_times = []
        
        for vehicle_name, vehicle_data in fleet_dict.items():
            vehicle_capacities.append(vehicle_data["capacity"])
            vehicle_volume_capacities.append(vehicle_data["capacity_volume"])
            wh_name = str(vehicle_data.get("warehouse", "") or "").strip()
            dep_idx = 0
            if wh_name:
                wh_norm = wh_name.lower()
                if wh_norm in warehouse_indices:
                    dep_idx = warehouse_indices[wh_norm]
                else:
                    for k, idx_val in warehouse_indices.items():
                        if k in wh_norm or wh_norm in k:
                            dep_idx = idx_val
                            break
            depot_indices.append(dep_idx)
            vehicle_names.append(vehicle_name)
            vehicle_warehouses.append(wh_name)
            
            s_min = parse_time_to_minutes(vehicle_data.get("start_time", "09:50"), 590)
            e_min = parse_time_to_minutes(vehicle_data.get("end_time", "18:00"), 1080)
            vehicle_start_times.append(s_min)
            vehicle_end_times.append(e_min)

        # Parse client time windows with warehouse prefix for exact 1-to-1 index matching
        client_time_windows = [(0, 1440) for _ in range(num_warehouses)]
        for idx, row in deliveries_df.iterrows():
            cs_min, ce_min = 0, 1440
            for col in ["Janela_Horaria", "janela_horaria", "Horario"]:
                if col in row and pd.notna(row[col]) and str(row[col]).strip():
                    ws, we = parse_time_window_str(str(row[col]))
                    if ws != 0 or we != 1440:
                        cs_min, ce_min = ws, we
                        break
            if cs_min == 0 and ce_min == 1440:
                for s_col, e_col in [("janela_inicio", "janela_fim"), ("Janela1_Inicio", "Janela1_Fim"), ("Slot1_Inicio", "Slot1_Fim")]:
                    if s_col in row and e_col in row and pd.notna(row[s_col]) and pd.notna(row[e_col]):
                        s_val = str(row[s_col]).strip()
                        e_val = str(row[e_col]).strip()
                        if s_val and e_val:
                            cs_min = parse_time_to_minutes(s_val, 0)
                            ce_min = parse_time_to_minutes(e_val, 1440)
                            break
            client_time_windows.append((cs_min, ce_min))
            
        # 5. Run solver
        solver_params = dict(req.params or {})
        if "time_limit" in solver_params and "time_limit_seconds" not in solver_params:
            solver_params["time_limit_seconds"] = solver_params["time_limit"]
            
        # Parse max duration if given as HH:MM or minutes
        raw_max_dur = solver_params.get("max_route_duration") or solver_params.get("max_travel_time")
        if raw_max_dur:
            if isinstance(raw_max_dur, str) and ":" in raw_max_dur:
                parts = raw_max_dur.split(":")
                dur_min = int(parts[0]) * 60 + int(parts[1])
                solver_params["max_travel_time_hours"] = round(dur_min / 60.0, 2)
            else:
                try:
                    val = float(raw_max_dur)
                    if val > 24.0: # minutes
                        solver_params["max_travel_time_hours"] = round(val / 60.0, 2)
                    else: # hours
                        solver_params["max_travel_time_hours"] = val
                except ValueError:
                    pass
            
        client_warehouses = ["" for _ in range(num_warehouses)] + (list(deliveries_df["Armazem"].fillna("")) if "Armazem" in deliveries_df.columns else ["" for _ in range(len(deliveries_df))])
        client_rules = ["" for _ in range(num_warehouses)] + (list(deliveries_df["Regras"].fillna("")) if "Regras" in deliveries_df.columns else ["" for _ in range(len(deliveries_df))])
        vehicle_rules = [str(fleet_dict.get(v_name, {}).get("regras", "")) for v_name in vehicle_names]
        vehicle_max_stops = [int(fleet_dict.get(v_name, {}).get("max_entregas", 30) or 30) for v_name in vehicle_names]
        rules_matrix = state_dict.get("rules_matrix", [])
        
        optimizer = AdvancedRouteOptimizer()
        result = optimizer.optimize_routes(
            distance_matrix,
            demands,
            vehicle_capacities,
            depot_indices,
            optimization_params=solver_params,
            volume_demands=volume_demands,
            vehicle_volume_capacities=vehicle_volume_capacities,
            client_warehouses=client_warehouses,
            vehicle_warehouses=vehicle_warehouses,
            num_warehouses=num_warehouses,
            vehicle_start_times=vehicle_start_times,
            vehicle_end_times=vehicle_end_times,
            client_time_windows=client_time_windows,
            locations=locations,
            client_rules=client_rules,
            vehicle_rules=vehicle_rules,
            rules_matrix=rules_matrix,
            vehicle_max_stops=vehicle_max_stops
        )
        
        # 6. Convert solver output to routes list
        routes_list = []
        visited_client_indices = set()
        
        default_wh_name = "Armazém Principal"
        if warehouses_df is not None and not warehouses_df.empty:
            for w_col in ["Nome_Armazem", "Nome_Armazém", "name", "Nome", "armazem", "warehouse"]:
                if w_col in warehouses_df.columns:
                    default_wh_name = str(warehouses_df.iloc[0][w_col])
                    break

        for vehicle_idx, route in enumerate(result["routes"]):
            vehicle_name = vehicle_names[vehicle_idx] if vehicle_idx < len(vehicle_names) else f"Veículo {vehicle_idx + 1}"
            v_info = fleet_dict.get(vehicle_name, {})
            warehouse_origin = v_info.get("warehouse", default_wh_name)
            depot_lat, depot_lon = get_depot_coords(warehouses_df, warehouse_origin)
            
            raw_stops = []
            loc_indices = route
            if len(route) >= 2 and route[0] < client_start_idx and route[-1] < client_start_idx:
                loc_indices = route[1:-1]

            for loc_idx in loc_indices:
                if loc_idx >= client_start_idx:
                    client_idx = loc_idx - client_start_idx
                    client_row = deliveries_df.iloc[client_idx]
                    visited_client_indices.add(client_idx)
                    
                    win_s = client_row.get("Slot1_Inicio", "")
                    win_e = client_row.get("Slot1_Fim", "")
                    combined_window = format_time_window_display(win_s, win_e)
                    
                    deliv_id = int(client_row.get("id", client_idx + 1))
                    doc_id_val = str(client_row.get("Doc_ID") or client_row.get("numero_doc") or client_row.get("doc_id") or "")
                    tel_val = str(client_row.get("Telefone_Cliente") or client_row.get("Telefone") or client_row.get("telefone") or "")
                    obs_val = str(client_row.get("Notas_Motorista") or client_row.get("Observacoes") or client_row.get("observacoes") or client_row.get("Regras") or "")
                    vend_val = str(client_row.get("Vendedor") or client_row.get("vendedor") or "")
                    
                    raw_stops.append({
                        "id": deliv_id,
                        "ID_Original": deliv_id,
                        "Rota": vehicle_name,
                        "Armazem": warehouse_origin,
                        "Doc_ID": doc_id_val,
                        "Cliente": str(client_row.get("Codigo_Cliente", f"Cliente_{client_idx}")),
                        "Nome_Cliente": str(client_row.get("Nome_Cliente") or client_row.get("Codigo_Cliente", f"Cliente_{client_idx}")),
                        "Morada": str(client_row.get("Morada", "N/A")),
                        "CP": str(client_row.get("Codigo_Postal", "N/A")),
                        "Localidade": str(client_row.get("Localidade", "")),
                        "Janela_Horaria": combined_window,
                        "Latitude": float(client_row["Latitude"]),
                        "Longitude": float(client_row["Longitude"]),
                        "Peso_KG": float(client_row.get("Peso_KG", 50.0)),
                        "Volume_m3": float(client_row.get("Volume_m3", 0.1)),
                        "Telefone": tel_val,
                        "Observacoes": obs_val,
                        "Notas_Motorista": obs_val,
                        "Vendedor": vend_val,
                        "Tempo_Entrega": 15,
                        "Nivel_Qualidade": int(client_row.get("Nivel_Qualidade", 0))
                    })
                    
            if raw_stops:
                v_start_str = str(v_info.get("start_time", "08:00:00"))
                v_speed = float(v_info.get("speed", 50.0))
                processed_stops = recalculate_route_stops(raw_stops, depot_lat, depot_lon, v_start_str, v_speed)
                routes_list.extend(processed_stops)
                    
        # 7. Process dropped nodes (unassigned deliveries -> Por Distribuir)
        dropped_nodes = result.get("dropped_nodes", [])
        dropped_client_indices = set()
        for loc_idx in dropped_nodes:
            if loc_idx >= client_start_idx:
                dropped_client_indices.add(loc_idx - client_start_idx)
                
        # Also catch any client that was not visited
        for c_idx in range(len(deliveries_df)):
            if c_idx not in visited_client_indices:
                dropped_client_indices.add(c_idx)
                
        pending_order = 1
        for client_idx in sorted(dropped_client_indices):
            client_row = deliveries_df.iloc[client_idx]
            win_s = client_row.get("Slot1_Inicio", "")
            win_e = client_row.get("Slot1_Fim", "")
            combined_window = format_time_window_display(win_s, win_e)
            
            deliv_id = int(client_row.get("id", client_idx + 1))
            doc_id_val = str(client_row.get("Doc_ID") or client_row.get("numero_doc") or client_row.get("doc_id") or "")
            tel_val = str(client_row.get("Telefone_Cliente") or client_row.get("Telefone") or client_row.get("telefone") or "")
            obs_val = str(client_row.get("Notas_Motorista") or client_row.get("Observacoes") or client_row.get("observacoes") or client_row.get("Regras") or "")
            vend_val = str(client_row.get("Vendedor") or client_row.get("vendedor") or "")
            
            routes_list.append({
                "id": deliv_id,
                "ID_Original": deliv_id,
                "Rota": "Por Distribuir",
                "Armazem": "N/A",
                "Ordem": pending_order,
                "Doc_ID": doc_id_val,
                "Cliente": str(client_row.get("Codigo_Cliente", f"Cliente_{client_idx}")),
                "Nome_Cliente": str(client_row.get("Nome_Cliente") or client_row.get("Codigo_Cliente", f"Cliente_{client_idx}")),
                "Morada": str(client_row.get("Morada", "N/A")),
                "CP": str(client_row.get("Codigo_Postal", "N/A")),
                "Localidade": str(client_row.get("Localidade", "")),
                "Janela_Horaria": combined_window,
                "Latitude": float(client_row["Latitude"]),
                "Longitude": float(client_row["Longitude"]),
                "Chegada": "00:00",
                "Tempo_Espera": 0,
                "Tempo_Entrega": 0,
                "Saida": "00:00",
                "Nivel_Qualidade": int(client_row.get("Nivel_Qualidade", 0)),
                "KM_Anterior": 0.0,
                "Dist_Acum": 0.0,
                "Carga_Acum": round(float(client_row.get("Peso_KG", 50.0)), 1),
                "Carga_Vol_Acum": round(float(client_row.get("Volume_m3", 0.1)), 2),
                "Telefone": tel_val,
                "Observacoes": obs_val,
                "Notas_Motorista": obs_val,
                "Vendedor": vend_val
            })
            pending_order += 1
            
        # 8. Save snapshot with optimized solution and sync to SQLite entregas table
        df_routes = pd.DataFrame(routes_list)
        state_dict["routes_solution"] = df_routes
        state_dict["fleet_config_used"] = fleet_dict
        state_dict["warehouses_used"] = warehouses_df
        state_dict["optimization_params"] = req.params
        
        payload = serialize_state(state_dict)
        snapshot_name = f"Otimização VRP ({datetime.now().strftime('%H:%M:%S')})"
        user_id = current_user.id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, user_id, 3, snapshot_name, payload)
            )
            # Sync optimized route and stop order into SQLite table 'entregas'
            for r in routes_list:
                r_id = r.get("id") or r.get("ID_Original")
                if r_id:
                    cursor.execute(
                        "UPDATE entregas SET rota = ?, ordem_paragem = ? WHERE id = ? AND projeto_id = ?",
                        (str(r.get("Rota", "Por Distribuir")), int(r.get("Ordem", 0)), r_id, req.project_id)
                    )
            conn.commit()
            
        resp_obj = {
            "status": "success",
            "routes": routes_list,
            "vehicles": vehicle_names,
            "quality_metrics": result.get("quality_metrics", {})
        }
        return sanitize_json_data(resp_obj)
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{project_id}")
def get_solver_solution(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            state_dict = deserialize_state(row["payload_json"]) if (row and row["payload_json"]) else {}

        df_canonical = _build_routes_from_state_or_db(project_id, state_dict)
        routes_list = df_canonical.to_dict(orient="records") if not df_canonical.empty else []
                    
        resp_data = {
            "status": "success" if routes_list else "none",
            "routes": routes_list,
            "quality_metrics": sanitize_json_data(state_dict.get("routes_metrics", {}))
        }
        return sanitize_json_data(resp_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _norm_stop_str(s) -> str:
    if s is None:
        return ""
    import unicodedata
    s = str(s).strip().lower().replace("_x000d_", "").replace("\r", "").replace("\n", "")
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))

def _find_stop_match(df_r: pd.DataFrame, deliv_id=None, code=None, addr=None, lat=None, lon=None, already_matched=None):
    if df_r.empty:
        return None
    used = set(already_matched or [])

    # 1. By exact ID (Unique primary key in database)
    if deliv_id is not None:
        s_id = str(deliv_id).strip().upper()
        for col in ["id", "ID_Original"]:
            if col in df_r.columns:
                matches = df_r[df_r[col].astype(str).str.strip().str.upper() == s_id].index
                for m in matches:
                    if m not in used:
                        return m

    # 2. By Doc_ID / Codigo_Cliente
    if code is not None:
        s_code = str(code).strip().upper()
        for col in ["Doc_ID", "Codigo_Cliente"]:
            if col in df_r.columns:
                matches = df_r[df_r[col].astype(str).str.strip().str.upper() == s_code].index
                for m in matches:
                    if m not in used:
                        return m

    # 3. By Name (Cliente / Nome_Cliente) + Address
    n_code = _norm_stop_str(code)
    n_addr = _norm_stop_str(addr)
    if n_code and n_addr:
        for idx, r in df_r.iterrows():
            if idx in used:
                continue
            r_c = _norm_stop_str(r.get("Cliente") or r.get("Nome_Cliente") or r.get("Doc_ID") or r.get("Codigo_Cliente"))
            r_a = _norm_stop_str(r.get("Morada"))
            if (r_c == n_code or n_code in r_c or r_c in n_code) and (r_a == n_addr or n_addr in r_a or r_a in n_addr):
                return idx

    # 4. By Name (Cliente / Nome_Cliente) only
    if n_code:
        for idx, r in df_r.iterrows():
            if idx in used:
                continue
            r_c = _norm_stop_str(r.get("Cliente") or r.get("Nome_Cliente") or r.get("Doc_ID") or r.get("Codigo_Cliente"))
            if r_c == n_code or n_code in r_c or r_c in n_code:
                return idx

    # 5. By Coordinates (Fallback when ID & Name differ)
    if lat is not None and lon is not None:
        try:
            f_lat = float(lat)
            f_lon = float(lon)
            if f_lat != 0.0 and f_lon != 0.0:
                for idx, r in df_r.iterrows():
                    if idx in used:
                        continue
                    r_lat = float(r.get("Latitude", 0.0) or 0.0)
                    r_lon = float(r.get("Longitude", 0.0) or 0.0)
                    if abs(r_lat - f_lat) < 0.0003 and abs(r_lon - f_lon) < 0.0003:
                        return idx
        except Exception:
            pass

    # 6. By Address only
    if n_addr:
        for idx, r in df_r.iterrows():
            if idx in used:
                continue
            r_a = _norm_stop_str(r.get("Morada"))
            if r_a == n_addr or n_addr in r_a or r_a in n_addr:
                return idx

    # 7. Rapidfuzz fallback
    try:
        from rapidfuzz import fuzz
        if n_code:
            best_score, best_idx = 0, None
            for idx, r in df_r.iterrows():
                if idx in used:
                    continue
                r_c = _norm_stop_str(r.get("Cliente") or r.get("Nome_Cliente") or r.get("Doc_ID"))
                score = fuzz.ratio(n_code, r_c)
                if score > best_score and score >= 50:
                    best_score = score
                    best_idx = idx
            if best_idx is not None:
                return best_idx
    except Exception:
        pass
        
    return None

def _build_routes_from_state_or_db(project_id: int, state_dict: dict) -> pd.DataFrame:
    """Helper to obtain canonical df_routes combining database and snapshot state."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC", (project_id,))
        rows = cursor.fetchall()
        cols = [d[0] for d in cursor.description] if cursor.description else []
        db_deliveries = [dict(zip(cols, r)) for r in rows]

    raw_routes = state_dict.get("routes_solution")
    if raw_routes is None or (isinstance(raw_routes, pd.DataFrame) and raw_routes.empty):
        raw_routes = state_dict.get("routes_df")
    
    route_map_by_id = {}
    route_map_by_code = {}
    route_map_by_name = {}
    
    if raw_routes is not None:
        df_r = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if not df_r.empty:
            for idx, r in df_r.iterrows():
                r_dict = r.to_dict()
                d_id = r.get("id") or r.get("ID_Original")
                if d_id is not None:
                    route_map_by_id[str(d_id).strip().upper()] = r_dict
                c_code = r.get("Doc_ID") or r.get("Codigo_Cliente")
                if c_code:
                    route_map_by_code[str(c_code).strip().upper()] = r_dict
                c_name = r.get("Cliente") or r.get("Nome_Cliente")
                if c_name:
                    route_map_by_name[str(c_name).strip().upper()] = r_dict

    if not db_deliveries and raw_routes is not None:
        df_r = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if not df_r.empty:
            return df_r.copy()

    merged_records = []
    for idx, d in enumerate(db_deliveries):
        d_id_str = str(d["id"]).strip().upper()
        d_code_str = str(d.get("codigo_cliente", "")).strip().upper()
        d_name_str = str(d.get("nome_cliente", "")).strip().upper()
        
        matched = (
            route_map_by_id.get(d_id_str) or
            route_map_by_code.get(d_code_str) or
            route_map_by_name.get(d_name_str) or
            {}
        )
        
        assigned_rota = str(matched.get("Rota") or d.get("rota") or "Por Distribuir")
        if "PENDENTE" in assigned_rota.upper():
            assigned_rota = "Por Distribuir"
            
        merged_records.append({
            "id": d["id"],
            "ID_Original": d["id"],
            "Doc_ID": str(d.get("codigo_cliente", f"CLI_{idx+1}")),
            "Codigo_Cliente": str(d.get("codigo_cliente", f"CLI_{idx+1}")),
            "Cliente": str(d.get("nome_cliente") or d.get("codigo_cliente", f"CLI_{idx+1}")),
            "Nome_Cliente": str(d.get("nome_cliente") or d.get("codigo_cliente", f"CLI_{idx+1}")),
            "Morada": str(d.get("morada", "")),
            "CP": str(d.get("codigo_postal", "")),
            "Localidade": str(d.get("_concelho") or d.get("concelho", "")),
            "Telefone_Cliente": str(d.get("telefone", "")),
            "Telefone": str(d.get("telefone", "")),
            "Latitude": clean_num(d.get("latitude")),
            "Longitude": clean_num(d.get("longitude")),
            "Rota": assigned_rota,
            "Armazem": str(matched.get("Armazem") or d.get("armazem", "Armazém Principal")),
            "Ordem": clean_int(matched.get("Ordem") or d.get("ordem_paragem") or d.get("ordem"), idx + 1),
            "Observacoes": str(matched.get("Observacoes") or d.get("observacoes", "")),
            "Notas_Motorista": str(matched.get("Notas_Motorista") or d.get("observacoes", "")),
            "Vendedor": str(matched.get("Vendedor") or d.get("vendedor", "")),
            "Peso_KG": clean_num(d.get("peso_kg"), 50.0),
            "Volume_m3": clean_num(d.get("volume_m3"), 0.1),
            "Janela_Horaria": str(matched.get("Janela_Horaria") or f"{d.get('janela_inicio', '08:00')} - {d.get('janela_fim', '18:00')}")
        })
        
    return pd.DataFrame(merged_records)

@router.post("/reassign")
def reassign_client_route(req: ReassignRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            state_dict = deserialize_state(row["payload_json"]) if (row and row["payload_json"]) else {}
            
        df_routes = _build_routes_from_state_or_db(req.project_id, state_dict)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Não existem entregas ou rotas no projeto para reatribuir.")
            
        target_idx = _find_stop_match(df_routes, deliv_id=req.get_id(), code=req.get_code(), addr=req.address, lat=req.lat, lon=req.lon)
        if target_idx is None:
            if len(df_routes) == 1:
                target_idx = df_routes.index[0]
            else:
                raise HTTPException(status_code=404, detail="Cliente/Entrega não encontrado nas rotas.")
        
        new_route_clean = req.new_route
        if is_pending_route(new_route_clean):
            new_route_clean = "Por Distribuir"
            
        df_routes.loc[target_idx, "Rota"] = new_route_clean
        if not is_pending_route(new_route_clean):
            df_routes.loc[target_idx, "Ordem"] = 99999
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = _pick_first_valid(state_dict.get("fleet_config"), state_dict.get("fleet_config_used")) or {}
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        
        updated_rows = []
        unique_routes = df_routes["Rota"].unique()
        
        for r_name in unique_routes:
            route_clients = df_routes[df_routes["Rota"] == r_name].copy()
            if is_pending_route(r_name):
                order = 1
                for idx, row_c in route_clients.iterrows():
                    row_c["Rota"] = "Por Distribuir"
                    row_c["Ordem"] = order
                    row_c["Chegada"] = "00:00"
                    row_c["Tempo_Espera"] = 0
                    row_c["Tempo_Entrega"] = 0
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    order += 1
                continue
                
            route_clients = route_clients.sort_values(by="Ordem")
            v_info = fleet_dict.get(r_name, {})
            wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
            v_start = str(v_info.get("start_time", "09:50"))
            v_speed = float(v_info.get("speed", 50.0))
            
            recalc_stops = recalculate_route_stops(route_clients.to_dict(orient="records"), depot_lat, depot_lon, v_start, v_speed)
            updated_rows.extend(recalc_stops)
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        state_dict["routes_df"] = df_new_routes
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Reatribuição Manual ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            # Synchronize active database table 'entregas'
            if req.delivery_id is not None:
                cursor.execute(
                    "UPDATE entregas SET rota = ? WHERE projeto_id = ? AND id = ?",
                    (new_route_clean, req.project_id, req.delivery_id)
                )
            elif req.client_code:
                cursor.execute(
                    "UPDATE entregas SET rota = ? WHERE projeto_id = ? AND (codigo_cliente = ? OR nome_cliente = ?)",
                    (new_route_clean, req.project_id, req.client_code, req.client_code)
                )
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reassign-bulk")
def reassign_bulk_selection(req: BulkReassignSelectionRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            state_dict = deserialize_state(row["payload_json"]) if (row and row["payload_json"]) else {}
            
        df_routes = _build_routes_from_state_or_db(req.project_id, state_dict)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Não existem entregas ou rotas no projeto para reatribuir.")

        new_route_clean = req.new_route
        if is_pending_route(new_route_clean):
            new_route_clean = "Por Distribuir"

        matched_indices = []
        for item in req.items:
            target_idx = _find_stop_match(df_routes, deliv_id=item.get_id(), code=item.get_code(), addr=item.address, lat=item.lat, lon=item.lon, already_matched=matched_indices)
            if target_idx is not None and target_idx not in matched_indices:
                matched_indices.append(target_idx)

        if not matched_indices:
            raise HTTPException(status_code=404, detail="Nenhuma paragem correspondente encontrada para reatribuir.")

        for idx in matched_indices:
            df_routes.loc[idx, "Rota"] = new_route_clean
            if not is_pending_route(new_route_clean):
                df_routes.loc[idx, "Ordem"] = 99999

        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = _pick_first_valid(state_dict.get("fleet_config"), state_dict.get("fleet_config_used")) or {}
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        
        updated_rows = []
        unique_routes = df_routes["Rota"].unique()
        
        for r_name in unique_routes:
            route_clients = df_routes[df_routes["Rota"] == r_name].copy()
            if is_pending_route(r_name):
                order = 1
                for idx, row_c in route_clients.iterrows():
                    row_c["Rota"] = "Por Distribuir"
                    row_c["Ordem"] = order
                    row_c["Chegada"] = "00:00"
                    row_c["Tempo_Espera"] = 0
                    row_c["Tempo_Entrega"] = 0
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    order += 1
                continue
                
            route_clients = route_clients.sort_values(by="Ordem")
            v_info = fleet_dict.get(r_name, {})
            wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
            v_start = str(v_info.get("start_time", "09:50"))
            v_speed = float(v_info.get("speed", 50.0))
            
            recalc_stops = recalculate_route_stops(route_clients.to_dict(orient="records"), depot_lat, depot_lon, v_start, v_speed)
            updated_rows.extend(recalc_stops)
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        state_dict["routes_df"] = df_new_routes
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Transferência em Massa ({len(matched_indices)} paragens -> {new_route_clean})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            # Synchronize active database table 'entregas'
            for idx in matched_indices:
                row_item = df_routes.loc[idx]
                d_id = row_item.get("id")
                c_code = row_item.get("Doc_ID") or row_item.get("Codigo_Cliente") or row_item.get("Cliente")
                if d_id is not None:
                    cursor.execute("UPDATE entregas SET rota = ? WHERE projeto_id = ? AND id = ?", (new_route_clean, req.project_id, d_id))
                elif c_code:
                    cursor.execute("UPDATE entregas SET rota = ? WHERE projeto_id = ? AND (codigo_cliente = ? OR nome_cliente = ?)", (new_route_clean, req.project_id, str(c_code), str(c_code)))
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reassign-entire-route")
def reassign_entire_route(req: BulkReassignRouteRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            state_dict = deserialize_state(row["payload_json"]) if (row and row["payload_json"]) else {}
            
        df_routes = _build_routes_from_state_or_db(req.project_id, state_dict)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Não existem entregas ou rotas calculadas.")
            
        src_clean = req.source_route
        tgt_clean = req.target_route
        if is_pending_route(src_clean):
            src_clean = "Por Distribuir"
        if is_pending_route(tgt_clean):
            tgt_clean = "Por Distribuir"
            
        if src_clean == tgt_clean:
            return sanitize_json_data({"status": "success", "routes": df_routes.to_dict(orient="records")})
            
        matched = df_routes[df_routes["Rota"] == src_clean].index
        if len(matched) == 0:
            raise HTTPException(status_code=404, detail=f"Nenhuma paragem encontrada na rota origem '{src_clean}'.")
            
        df_routes.loc[matched, "Rota"] = tgt_clean
        if not is_pending_route(tgt_clean):
            df_routes.loc[matched, "Ordem"] = 99999
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = _pick_first_valid(state_dict.get("fleet_config"), state_dict.get("fleet_config_used")) or {}
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        
        updated_rows = []
        unique_routes = df_routes["Rota"].unique()
        
        for r_name in unique_routes:
            route_clients = df_routes[df_routes["Rota"] == r_name].copy()
            if is_pending_route(r_name):
                order = 1
                for idx, row_c in route_clients.iterrows():
                    row_c["Rota"] = "Por Distribuir"
                    row_c["Ordem"] = order
                    row_c["Chegada"] = "00:00"
                    row_c["Tempo_Espera"] = 0
                    row_c["Tempo_Entrega"] = 0
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    order += 1
                continue
                
            route_clients = route_clients.sort_values(by="Ordem")
            v_info = fleet_dict.get(r_name, {})
            wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
            v_start = str(v_info.get("start_time", "09:50"))
            v_speed = float(v_info.get("speed", 50.0))
            
            recalc_stops = recalculate_route_stops(route_clients.to_dict(orient="records"), depot_lat, depot_lon, v_start, v_speed)
            updated_rows.extend(recalc_stops)
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        state_dict["routes_df"] = df_new_routes
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Transferência Rota {src_clean} -> {tgt_clean} ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            cursor.execute("UPDATE entregas SET rota = ? WHERE projeto_id = ? AND rota = ?", (tgt_clean, req.project_id, src_clean))
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export-full/{project_id}")
@router.get("/{project_id}/export-full")
def export_full_project(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem dados exportáveis.")
                
            state_dict = deserialize_state(row["payload_json"])
            
            df_canonical = _build_routes_from_state_or_db(project_id, state_dict)
            routes_df = df_canonical
                
            wh_raw = state_dict.get('warehouses_geocoded')
            if wh_raw is None or (isinstance(wh_raw, pd.DataFrame) and wh_raw.empty):
                wh_raw = state_dict.get('warehouses_used')
            warehouses_df = wh_raw
            
            fleet_raw = state_dict.get('fleet_config')
            if fleet_raw is None or (isinstance(fleet_raw, pd.DataFrame) and fleet_raw.empty):
                fleet_raw = state_dict.get('fleet_config_used')
            fleet_config = fleet_raw
            
            deliv_raw = state_dict.get('clients_geocoded')
            if deliv_raw is None or (isinstance(deliv_raw, pd.DataFrame) and deliv_raw.empty):
                deliv_raw = state_dict.get('clients_used')
            if deliv_raw is None or (isinstance(deliv_raw, pd.DataFrame) and deliv_raw.empty):
                cursor.execute("SELECT * FROM entregas WHERE projeto_id = ?", (project_id,))
                rows_e = [dict(r) for r in cursor.fetchall()]
                if rows_e:
                    deliv_raw = pd.DataFrame(rows_e)
            deliveries_df = deliv_raw
            
            optimization_params = state_dict.get("optimization_params")
            rules_matrix = state_dict.get('rules_matrix', [])
            
        from utils.export_engine import generate_full_project_excel
        excel_data = generate_full_project_excel(
            routes_df=routes_df,
            deliveries_df=deliveries_df,
            warehouses_df=warehouses_df,
            fleet_config=fleet_config,
            optimization_params=optimization_params,
            rules_matrix=rules_matrix,
            drivers_data=state_dict.get('drivers', state_dict.get('motoristas', [])),
            reasons_data=state_dict.get('reasons', state_dict.get('failure_reasons', []))
        )
        
        from fastapi import Response
        import re
        from datetime import datetime
        now_str = datetime.now().strftime('%Y%m%d_%H%M')
        proj_dict = dict(proj) if proj else {}
        proj_name = proj_dict.get("nome", f"Projeto_{project_id}")
        safe_proj_name = re.sub(r'[^\w\s-]', '', str(proj_name)).strip().replace(' ', '_')
        filename = f"Distribuicao_{safe_proj_name}_{now_str}.xlsx"
        return Response(
            content=excel_data,
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"',
                'Access-Control-Expose-Headers': 'Content-Disposition'
            }
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar projeto completo: {str(e)}")


class OptimizeAllSequencesRequest(BaseModel):
    project_id: int

@router.post("/optimize-all-sequences")
def optimize_all_sequences(req: OptimizeAllSequencesRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem rotas para otimizar.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="Não existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas está vazia.")
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = _pick_first_valid(state_dict.get("fleet_config"), state_dict.get("fleet_config_used")) or {}
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        
        unique_routes = [r for r in df_routes["Rota"].dropna().unique() if str(r).strip() and "PENDENTE" not in str(r).upper() and "POR DISTRIBUIR" not in str(r).upper()]
        
        for route_name in unique_routes:
            route_mask = df_routes["Rota"] == route_name
            route_stops = df_routes[route_mask].copy()
            
            if len(route_stops) <= 1:
                continue
                
            v_info = fleet_dict.get(route_name, {})
            wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
            v_start_min = parse_time_to_minutes(v_info.get("start_time", "08:00:00"), 480)
            v_speed = float(v_info.get("speed", 50.0))
            
            stop_indices = list(route_stops.index)
            curr_lat, curr_lon = depot_lat, depot_lon
            curr_time_min = v_start_min
            cum_dist = 0.0
            order_counter = 1
            
            # Nearest Neighbor Sequence TSP from depot
            remaining = stop_indices.copy()
            while remaining:
                best_idx = None
                best_dist = float('inf')
                for s_idx in remaining:
                    s_lat = float(df_routes.at[s_idx, "Latitude"])
                    s_lon = float(df_routes.at[s_idx, "Longitude"])
                    d = haversine_distance(curr_lat, curr_lon, s_lat, s_lon)
                    if d < best_dist:
                        best_dist = d
                        best_idx = s_idx
                        
                if best_idx is None:
                    break
                    
                remaining.remove(best_idx)
                s_lat = float(df_routes.at[best_idx, "Latitude"])
                s_lon = float(df_routes.at[best_idx, "Longitude"])
                
                travel_time_min = (best_dist / v_speed) * 60.0 if v_speed > 0 else 10.0
                arr_time_min = curr_time_min + travel_time_min
                
                # Service duration
                serv_min = 15.0
                dep_time_min = arr_time_min + serv_min
                cum_dist += best_dist
                
                df_routes.at[best_idx, "Ordem"] = order_counter
                df_routes.at[best_idx, "Ordem_Paragem"] = order_counter
                df_routes.at[best_idx, "Distancia_KM"] = round(best_dist, 2)
                df_routes.at[best_idx, "Distancia_Acumulada_KM"] = round(cum_dist, 2)
                df_routes.at[best_idx, "Tempo_Viagem_Min"] = round(travel_time_min, 1)
                df_routes.at[best_idx, "Hora_Chegada_Prevista"] = minutes_to_time_str(arr_time_min)
                df_routes.at[best_idx, "Hora_Saida_Prevista"] = minutes_to_time_str(dep_time_min)
                
                curr_lat, curr_lon = s_lat, s_lon
                curr_time_min = dep_time_min
                order_counter += 1

        # Re-sort DataFrame by Rota and Ordem
        df_routes.sort_values(by=["Rota", "Ordem"], inplace=True)
        
        state_dict["routes_solution"] = df_routes
        state_dict["routes_df"] = df_routes
        payload = serialize_state(state_dict)
        snapshot_name = f"Otimização de Sequências ({datetime.now().strftime('%H:%M:%S')})"
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 
                           (req.project_id, current_user.id, 3, snapshot_name, payload))
            conn.commit()
            
        return sanitize_json_data({
            "status": "success",
            "message": f"Sequências de {len(unique_routes)} viaturas ordenadas com sucesso!",
            "routes": df_routes.to_dict(orient="records")
        })
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao ordenar sequências de rotas: {str(e)}")

class SingleRouteOptimizeRequest(BaseModel):
    project_id: int
    route_name: str

@router.post("/optimize-single-route")
def optimize_single_route(req: SingleRouteOptimizeRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            state_dict = deserialize_state(row["payload_json"]) if (row and row["payload_json"]) else {}

        df_canonical = _build_routes_from_state_or_db(req.project_id, state_dict)
        if df_canonical.empty:
            raise HTTPException(status_code=400, detail="Não existem rotas para otimizar.")
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = _pick_first_valid(state_dict.get("fleet_config"), state_dict.get("fleet_config_used")) or {}
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        
        target_route = req.route_name.strip()
        route_mask = df_canonical["Rota"].astype(str).str.strip().str.lower() == target_route.lower()
        route_stops = df_canonical[route_mask].copy()
        
        if len(route_stops) > 1:
            v_info = fleet_dict.get(target_route, {})
            wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
            v_start_min = parse_time_to_minutes(v_info.get("start_time", "08:00:00"), 480)
            v_speed = float(v_info.get("speed", 50.0))
            
            stop_indices = list(route_stops.index)
            curr_lat, curr_lon = depot_lat, depot_lon
            curr_time_min = v_start_min
            cum_dist = 0.0
            order_counter = 1
            
            remaining = stop_indices.copy()
            while remaining:
                best_idx = None
                best_dist = float('inf')
                for s_idx in remaining:
                    s_lat = float(df_canonical.at[s_idx, "Latitude"])
                    s_lon = float(df_canonical.at[s_idx, "Longitude"])
                    d = haversine_distance(curr_lat, curr_lon, s_lat, s_lon)
                    if d < best_dist:
                        best_dist = d
                        best_idx = s_idx
                        
                if best_idx is None:
                    break
                    
                remaining.remove(best_idx)
                s_lat = float(df_canonical.at[best_idx, "Latitude"])
                s_lon = float(df_canonical.at[best_idx, "Longitude"])
                
                travel_time_min = (best_dist / v_speed) * 60.0 if v_speed > 0 else 10.0
                arr_time_min = curr_time_min + travel_time_min
                serv_min = 15.0
                dep_time_min = arr_time_min + serv_min
                cum_dist += best_dist
                
                df_canonical.at[best_idx, "Ordem"] = order_counter
                df_canonical.at[best_idx, "Ordem_Paragem"] = order_counter
                df_canonical.at[best_idx, "Distancia_KM"] = round(best_dist, 2)
                df_canonical.at[best_idx, "Distancia_Acumulada_KM"] = round(cum_dist, 2)
                df_canonical.at[best_idx, "Tempo_Viagem_Min"] = round(travel_time_min, 1)
                df_canonical.at[best_idx, "Tempo_Servico_Min"] = serv_min
                df_canonical.at[best_idx, "Chegada"] = minutes_to_time_str(int(arr_time_min))
                df_canonical.at[best_idx, "Saida"] = minutes_to_time_str(int(dep_time_min))
                
                curr_lat, curr_lon = s_lat, s_lon
                curr_time_min = dep_time_min
                order_counter += 1

        state_dict["routes_solution"] = df_canonical
        payload = serialize_state(state_dict)
        from datetime import datetime
        snapshot_name = f"Otimização Trajeto ({target_route}) - {datetime.now().strftime('%H:%M:%S')}"
        user_id = current_user.id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, user_id, 3, snapshot_name, payload)
            )
            # Sync to SQLite entregas table
            for _, r in df_canonical.iterrows():
                r_id = r.get("id") or r.get("ID_Original")
                if r_id:
                    cursor.execute(
                        "UPDATE entregas SET rota = ?, ordem_paragem = ? WHERE id = ? AND projeto_id = ?",
                        (str(r.get("Rota", "Por Distribuir")), int(r.get("Ordem", 0)), r_id, req.project_id)
                    )
            conn.commit()

        routes_list = df_canonical.to_dict(orient="records")
        return sanitize_json_data({"status": "success", "routes": routes_list})
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/audit/{project_id}")
def get_route_audit(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        if not row or not row["payload_json"]:
            return {"total_violations": 0, "routes_status": {}, "all_violations": []}
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        if raw_routes is None:
            return {"total_violations": 0, "routes_status": {}, "all_violations": []}
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        fleet_cfg = state_dict.get("fleet_config", {})
        wh_df = state_dict.get("warehouses_geocoded", state_dict.get("df_warehouses"))
        rules_mat = state_dict.get("rules_matrix", [])
        
        audit_res = audit_route_plan(df_routes, fleet_cfg, wh_df, rules_mat)
        return audit_res
