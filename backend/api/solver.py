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
from database import get_db, get_projeto
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
    client_code: Optional[str] = None
    delivery_id: Optional[int] = None
    address: Optional[str] = None
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

def parse_time_to_minutes(t_val, default=480) -> int:
    if not t_val:
        return default
    s = str(t_val).strip()[:5]
    try:
        parts = s.split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return default

def minutes_to_time_str(m: int) -> str:
    h = (int(m) // 60) % 24
    mins = int(m) % 60
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
    if warehouses_df is not None and not warehouses_df.empty:
        if wh_name:
            match = warehouses_df[warehouses_df["Nome_Armazem"].astype(str).str.strip().str.lower() == str(wh_name).strip().lower()]
            if not match.empty:
                return float(match.iloc[0]["Latitude"]), float(match.iloc[0]["Longitude"])
        return float(warehouses_df.iloc[0]["Latitude"]), float(warehouses_df.iloc[0]["Longitude"])
    return 38.6593, -9.1758

def recalculate_route_stops(stops_iterable, depot_lat: float, depot_lon: float, start_time_str: str = "09:50", avg_speed: float = 50.0, default_service_time: int = 15) -> list:
    updated_stops = []
    if avg_speed <= 0:
        avg_speed = 50.0
        
    cur_time_min = parse_time_to_minutes(start_time_str, 590)
    p_lat, p_lon = depot_lat, depot_lon
    cumul_dist = 0.0
    cumul_load = 0.0
    cumul_vol = 0.0
    
    order = 1
    for stop_dict in stops_iterable:
        c_lat = float(stop_dict.get("Latitude", p_lat))
        c_lon = float(stop_dict.get("Longitude", p_lon))
        
        dist = haversine_distance(p_lat, p_lon, c_lat, c_lon)
        cumul_dist += dist
        
        travel_min = (dist / avg_speed) * 60.0
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
    if not proj or proj["empresa_id"] != current_user.empresa_id:
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
                    "Armazem": dr.get("armazem")
                })
            deliveries_df = pd.DataFrame(df_rows)
            
        # 3. Prepare warehouses and fleet DataFrames
        raw_wh = state_dict.get("warehouses_geocoded")
        if raw_wh is None or (isinstance(raw_wh, pd.DataFrame) and raw_wh.empty):
            raise HTTPException(status_code=400, detail="Nenhum armazém configurado no projeto.")
        warehouses_df = raw_wh if isinstance(raw_wh, pd.DataFrame) else pd.DataFrame(raw_wh)
        
        fleet_config = state_dict.get("fleet_config")
        if not fleet_config:
            raise HTTPException(status_code=400, detail="Nenhum veículo configurado na frota.")
            
        # 4. Build coordinates locations array and solver demands
        locations = []
        location_names = []
        demands = []
        volume_demands = []
        
        # Add warehouses first
        warehouse_indices = {}
        for idx, row in warehouses_df.iterrows():
            wh_name = str(row["Nome_Armazem"])
            locations.append((float(row["Latitude"]), float(row["Longitude"])))
            location_names.append(wh_name)
            demands.append(0.0)
            volume_demands.append(0.0)
            warehouse_indices[wh_name] = len(locations) - 1
            
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
            wh_name = vehicle_data["warehouse"]
            depot_indices.append(warehouse_indices.get(wh_name, 0))
            vehicle_names.append(vehicle_name)
            vehicle_warehouses.append(wh_name)
            
            s_min = parse_time_to_minutes(vehicle_data.get("start_time", "09:50"), 590)
            e_min = parse_time_to_minutes(vehicle_data.get("end_time", "18:00"), 1080)
            vehicle_start_times.append(s_min)
            vehicle_end_times.append(e_min)

        # Parse client time windows
        client_time_windows = []
        for idx, row in deliveries_df.iterrows():
            win_s_str = str(row.get("Slot1_Inicio", "") or "").strip()
            win_e_str = str(row.get("Slot1_Fim", "") or "").strip()
            if win_s_str and win_e_str:
                cs_min = parse_time_to_minutes(win_s_str, 0)
                ce_min = parse_time_to_minutes(win_e_str, 1440)
            else:
                cs_min, ce_min = 0, 1440
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
            
        client_warehouses = list(deliveries_df["Armazem"].fillna("")) if "Armazem" in deliveries_df.columns else ["" for _ in range(len(deliveries_df))]
        client_rules = list(deliveries_df["Regras"].fillna("")) if "Regras" in deliveries_df.columns else ["" for _ in range(len(deliveries_df))]
        vehicle_rules = [str(fleet_dict.get(v_name, {}).get("regras", "")) for v_name in vehicle_names]
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
            rules_matrix=rules_matrix
        )
        
        # 6. Convert solver output to routes list
        routes_list = []
        visited_client_indices = set()
        
        for vehicle_idx, route in enumerate(result["routes"]):
            vehicle_name = vehicle_names[vehicle_idx] if vehicle_idx < len(vehicle_names) else f"Veículo {vehicle_idx + 1}"
            v_info = fleet_dict.get(vehicle_name, {})
            warehouse_origin = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"])
            depot_lat, depot_lon = get_depot_coords(warehouses_df, warehouse_origin)
            
            raw_stops = []
            for i in range(1, len(route) - 1):
                loc_idx = route[i]
                if loc_idx >= client_start_idx:
                    client_idx = loc_idx - client_start_idx
                    client_row = deliveries_df.iloc[client_idx]
                    visited_client_indices.add(client_idx)
                    
                    win_s = str(client_row.get("Slot1_Inicio", "") or "").strip()
                    win_e = str(client_row.get("Slot1_Fim", "") or "").strip()
                    combined_window = f"{win_s} - {win_e}" if (win_s and win_e) else "Qualquer"
                    
                    deliv_id = int(client_row.get("id", client_idx + 1))
                    raw_stops.append({
                        "id": deliv_id,
                        "ID_Original": deliv_id,
                        "Rota": vehicle_name,
                        "Armazem": warehouse_origin,
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
                        "Tempo_Entrega": 15,
                        "Nivel_Qualidade": int(client_row.get("Nivel_Qualidade", 0))
                    })
                    
            if raw_stops:
                v_start_str = str(v_info.get("start_time", "09:50"))
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
            win_s = str(client_row.get("Slot1_Inicio", "") or "").strip()
            win_e = str(client_row.get("Slot1_Fim", "") or "").strip()
            combined_window = f"{win_s} - {win_e}" if (win_s and win_e) else "Qualquer"
            
            deliv_id = int(client_row.get("id", client_idx + 1))
            routes_list.append({
                "id": deliv_id,
                "ID_Original": deliv_id,
                "Rota": "Por Distribuir",
                "Armazem": "N/A",
                "Ordem": pending_order,
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
                "Carga_Vol_Acum": round(float(client_row.get("Volume_m3", 0.1)), 2)
            })
            pending_order += 1
            
        # 8. Save snapshot with optimized solution
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
            conn.commit()
            
        return {
            "status": "success",
            "routes": routes_list,
            "vehicles": vehicle_names,
            "quality_metrics": result.get("quality_metrics", {})
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{project_id}")
def get_solver_solution(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
            if not row:
                return {"status": "none", "routes": []}
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            routes_list = []
            if raw_routes is not None:
                df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
                if not df_routes.empty:
                    for idx, r in df_routes.iterrows():
                        r_name = str(r.get("Rota", "Por Distribuir") if pd.notna(r.get("Rota")) else "Por Distribuir")
                        if "PENDENTE" in r_name.upper():
                            r_name = "Por Distribuir"
                        d_id = clean_int(r.get("id") or r.get("ID_Original"), idx + 1)
                        chegada_val = str(r.get("Hora_Chegada_Prevista") or r.get("Chegada") or "00:00").strip()
                        saida_val = str(r.get("Hora_Saida_Prevista") or r.get("Saida") or "00:00").strip()
                        km_ant = clean_num(r.get("Distancia_KM") if pd.notna(r.get("Distancia_KM")) else r.get("KM_Anterior"), 0.0)
                        dist_acum = clean_num(r.get("Distancia_Acumulada_KM") if pd.notna(r.get("Distancia_Acumulada_KM")) else r.get("Dist_Acum"), 0.0)
                        t_esp = clean_int(r.get("Tempo_Espera_Min") if pd.notna(r.get("Tempo_Espera_Min")) else r.get("Tempo_Espera"), 0)
                        t_ent = clean_int(r.get("Tempo_Viagem_Min") if pd.notna(r.get("Tempo_Viagem_Min")) else r.get("Tempo_Entrega"), 15)
                        ordem_val = clean_int(r.get("Ordem_Paragem") if pd.notna(r.get("Ordem_Paragem")) else r.get("Ordem"), 1)
                        
                        routes_list.append({
                            "id": d_id,
                            "ID_Original": d_id,
                            "Rota": r_name,
                            "Armazem": str(r.get("Armazem", "N/A") if pd.notna(r.get("Armazem")) else "N/A"),
                            "Ordem": ordem_val,
                            "Cliente": str(r.get("Cliente", "") if pd.notna(r.get("Cliente")) else ""),
                            "Nome_Cliente": str(r.get("Nome_Cliente", r.get("Cliente", "")) if pd.notna(r.get("Nome_Cliente")) else str(r.get("Cliente", "") if pd.notna(r.get("Cliente")) else "")),
                            "Morada": str(r.get("Morada", "") if pd.notna(r.get("Morada")) else ""),
                            "CP": str(r.get("CP", "") if pd.notna(r.get("CP")) else ""),
                            "Localidade": str(r.get("Localidade", "") if pd.notna(r.get("Localidade")) else ""),
                            "Janela_Horaria": str(r.get("Janela_Horaria", "Qualquer") if pd.notna(r.get("Janela_Horaria")) else "Qualquer"),
                            "Latitude": clean_num(r.get("Latitude"), 0.0),
                            "Longitude": clean_num(r.get("Longitude"), 0.0),
                            "Chegada": chegada_val if chegada_val else "00:00",
                            "Tempo_Espera": t_esp,
                            "Tempo_Entrega": t_ent,
                            "Saida": saida_val if saida_val else "00:00",
                            "Nivel_Qualidade": clean_int(r.get("Nivel_Qualidade"), 1),
                            "KM_Anterior": km_ant,
                            "Dist_Acum": dist_acum,
                            "Peso_KG": clean_num(r.get("Peso_KG"), 50.0),
                            "Carga_Acum": clean_num(r.get("Carga_Acum"), 0.0),
                            "Carga_Vol_Acum": clean_num(r.get("Carga_Vol_Acum"), 0.0)
                        })
                        
            resp_data = {
                "status": "success" if routes_list else "none",
                "routes": routes_list,
                "quality_metrics": sanitize_json_data(state_dict.get("routes_metrics", {}))
            }
            return sanitize_json_data(resp_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reassign")
def reassign_client_route(req: ReassignRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem rotas calculadas para reatribuir.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="Não existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas está vazia.")
            
        target_idx = None
        
        # Match by delivery_id / ID_Original if supplied
        if req.delivery_id is not None:
            if "id" in df_routes.columns:
                m_id = df_routes[df_routes["id"] == req.delivery_id].index
                if len(m_id) > 0:
                    target_idx = m_id[0]
            if target_idx is None and "ID_Original" in df_routes.columns:
                m_id = df_routes[df_routes["ID_Original"] == req.delivery_id].index
                if len(m_id) > 0:
                    target_idx = m_id[0]
                    
        # Match by client_code AND address if supplied
        if target_idx is None and req.client_code and req.address:
            t_code = str(req.client_code).strip().upper()
            t_addr = str(req.address).strip().upper()
            m_both = df_routes[
                (df_routes["Cliente"].astype(str).str.strip().str.upper() == t_code) &
                (df_routes["Morada"].astype(str).str.strip().str.upper() == t_addr)
            ].index
            if len(m_both) > 0:
                target_idx = m_both[0]
                
        # Match by client_code
        if target_idx is None and req.client_code:
            t_code = str(req.client_code).strip().upper()
            m_code = df_routes[df_routes["Cliente"].astype(str).str.strip().str.upper() == t_code].index
            if len(m_code) == 0:
                m_code = df_routes[df_routes["Cliente"].astype(str).str.contains(t_code, case=False, na=False)].index
            if len(m_code) > 0:
                target_idx = m_code[0]
                
        if target_idx is None:
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
        fleet_config = state_dict.get("fleet_config") or state_dict.get("fleet_config_used", {})
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
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Reatribuição Manual ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reassign-entire-route")
def reassign_entire_route(req: BulkReassignRouteRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem rotas calculadas.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="Não existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas está vazia.")
            
        src_clean = req.source_route.strip()
        tgt_clean = req.target_route.strip()
        if is_pending_route(tgt_clean):
            tgt_clean = "Por Distribuir"
            
        if is_pending_route(src_clean):
            src_mask = df_routes["Rota"].astype(str).apply(is_pending_route)
        else:
            src_mask = df_routes["Rota"].astype(str).str.strip().str.upper() == src_clean.upper()
            
        if not src_mask.any():
            raise HTTPException(status_code=404, detail=f"A rota '{src_clean}' não tem paragens atribuídas.")
            
        df_routes.loc[src_mask, "Rota"] = tgt_clean
        if not is_pending_route(tgt_clean):
            df_routes.loc[src_mask, "Ordem"] = 99999
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = state_dict.get("fleet_config") or state_dict.get("fleet_config_used", {})
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
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Transferência Rota {src_clean} -> {tgt_clean} ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reorder")
def reorder_route_stop(req: ReorderRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem rotas calculadas para reordenar.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="Não existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas está vazia.")
            
        route_mask = df_routes["Rota"] == req.route_name
        route_stops = df_routes[route_mask].copy().sort_values(by="Ordem")
        
        clean_code = str(req.client_code).strip().upper()
        current_idx = None
        for i, (idx, r) in enumerate(route_stops.iterrows()):
            if str(r["Cliente"]).strip().upper() == clean_code:
                current_idx = i
                break
                
        if current_idx is None:
            raise HTTPException(status_code=404, detail="Paragem não encontrada na rota indicada.")
            
        target_idx = max(0, min(len(route_stops) - 1, req.new_order - 1))
        
        indices = list(route_stops.index)
        elem = indices.pop(current_idx)
        indices.insert(target_idx, elem)
        
        for new_pos, idx in enumerate(indices, 1):
            df_routes.loc[idx, "Ordem"] = new_pos
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = state_dict.get("fleet_config") or state_dict.get("fleet_config_used", {})
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        
        updated_rows = []
        for r_name in df_routes["Rota"].unique():
            r_clients = df_routes[df_routes["Rota"] == r_name].copy()
            if is_pending_route(r_name):
                ord_num = 1
                for idx, row_c in r_clients.iterrows():
                    row_c["Rota"] = "Por Distribuir"
                    row_c["Ordem"] = ord_num
                    row_c["Chegada"] = "00:00"
                    row_c["Tempo_Espera"] = 0
                    row_c["Tempo_Entrega"] = 0
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    ord_num += 1
                continue
                
            r_clients = r_clients.sort_values(by="Ordem")
            v_info = fleet_dict.get(r_name, {})
            wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
            v_start = str(v_info.get("start_time", "09:50"))
            v_speed = float(v_info.get("speed", 50.0))
            
            recalc_stops = recalculate_route_stops(r_clients.to_dict(orient="records"), depot_lat, depot_lon, v_start, v_speed)
            updated_rows.extend(recalc_stops)
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Reordenação Rota {req.route_name} ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize-single-route")
def optimize_single_route(req: OptimizeRouteRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem rotas calculadas para otimizar.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="Não existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas está vazia.")
            
        route_mask = df_routes["Rota"] == req.route_name
        route_stops = df_routes[route_mask].copy()
        
        if len(route_stops) <= 1:
            return sanitize_json_data({"status": "success", "routes": df_routes.to_dict(orient="records")})
            
        warehouses_df = state_dict.get("warehouses_geocoded")
        if warehouses_df is None or (isinstance(warehouses_df, pd.DataFrame) and warehouses_df.empty):
            warehouses_df = state_dict.get("warehouses_used", pd.DataFrame())
        fleet_config = state_dict.get("fleet_config") or state_dict.get("fleet_config_used", {})
        fleet_dict = extract_fleet_dict(fleet_config, warehouses_df)
        v_info = fleet_dict.get(req.route_name, {})
        
        wh_name = v_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
        depot_lat, depot_lon = get_depot_coords(warehouses_df, wh_name)
        v_start_min = parse_time_to_minutes(v_info.get("start_time", "09:50"), 590)
        v_speed = float(v_info.get("speed", 50.0))
        
        # Time-Window Aware Routing for Single Route
        # Group stops by window start time
        stop_indices = list(route_stops.index)
        
        def get_stop_window_start(idx):
            w_str = str(df_routes.loc[idx, "Janela_Horaria"])
            w_s, _ = parse_time_window_str(w_str)
            return w_s
            
        # Sort stops primarily by opening window, preserving feasibility
        distinct_windows = sorted(list(set([get_stop_window_start(idx) for idx in stop_indices])))
        
        ordered_indices = []
        cur_lat, cur_lon = depot_lat, depot_lon
        
        for w_val in distinct_windows:
            window_cluster = [idx for idx in stop_indices if get_stop_window_start(idx) == w_val]
            
            # Nearest neighbor within the same time window cluster
            unvisited_cluster = list(window_cluster)
            while unvisited_cluster:
                best_idx = None
                best_dist = float("inf")
                for idx in unvisited_cluster:
                    c_lat = float(df_routes.loc[idx, "Latitude"])
                    c_lon = float(df_routes.loc[idx, "Longitude"])
                    d = haversine_distance(cur_lat, cur_lon, c_lat, c_lon)
                    if d < best_dist:
                        best_dist = d
                        best_idx = idx
                ordered_indices.append(best_idx)
                unvisited_cluster.remove(best_idx)
                cur_lat = float(df_routes.loc[best_idx, "Latitude"])
                cur_lon = float(df_routes.loc[best_idx, "Longitude"])
                
        # 2-Opt local refinement strictly within the ordered sequence that does not violate time windows
        def calc_path_dist(idx_list):
            d_total = 0.0
            p_lat, p_lon = depot_lat, depot_lon
            for i in idx_list:
                clat = float(df_routes.loc[i, "Latitude"])
                clon = float(df_routes.loc[i, "Longitude"])
                d_total += haversine_distance(p_lat, p_lon, clat, clon)
                p_lat, p_lon = clat, clon
            return d_total
            
        improved = True
        while improved:
            improved = False
            best_path_dist = calc_path_dist(ordered_indices)
            for i in range(len(ordered_indices) - 1):
                for j in range(i + 1, len(ordered_indices)):
                    new_idx_list = ordered_indices[:i] + ordered_indices[i:j+1][::-1] + ordered_indices[j+1:]
                    
                    # Verify that reversing does not invert time windows (e.g. putting 12:30 before 10:30)
                    is_valid_windows = True
                    for k in range(len(new_idx_list) - 1):
                        w_curr = get_stop_window_start(new_idx_list[k])
                        w_next = get_stop_window_start(new_idx_list[k+1])
                        if w_curr > w_next and w_curr > 0 and w_next > 0:
                            is_valid_windows = False
                            break
                            
                    if is_valid_windows:
                        new_d = calc_path_dist(new_idx_list)
                        if new_d < best_path_dist - 0.01:
                            ordered_indices = new_idx_list
                            best_path_dist = new_d
                            improved = True
                            break
                if improved:
                    break
                    
        for pos, idx in enumerate(ordered_indices, 1):
            df_routes.loc[idx, "Ordem"] = pos
            
        updated_rows = []
        for r_name in df_routes["Rota"].unique():
            r_clients = df_routes[df_routes["Rota"] == r_name].copy()
            if is_pending_route(r_name):
                ord_num = 1
                for idx, row_c in r_clients.iterrows():
                    row_c["Rota"] = "Por Distribuir"
                    row_c["Ordem"] = ord_num
                    row_c["Chegada"] = "00:00"
                    row_c["Tempo_Espera"] = 0
                    row_c["Tempo_Entrega"] = 0
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    ord_num += 1
                continue
                
            r_clients = r_clients.sort_values(by="Ordem")
            v_curr_info = fleet_dict.get(r_name, {})
            curr_wh = v_curr_info.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"] if warehouses_df is not None and not warehouses_df.empty else "")
            depot_c_lat, depot_c_lon = get_depot_coords(warehouses_df, curr_wh)
            curr_v_start = str(v_curr_info.get("start_time", "09:50"))
            curr_v_speed = float(v_curr_info.get("speed", 50.0))
            
            recalc_stops = recalculate_route_stops(r_clients.to_dict(orient="records"), depot_c_lat, depot_c_lon, curr_v_start, curr_v_speed)
            updated_rows.extend(recalc_stops)
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        payload = serialize_state(state_dict)
        
        snapshot_name = f"Otimização Rota {req.route_name} ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (req.project_id, current_user.id, 3, snapshot_name, payload)
            )
            conn.commit()
            
        return sanitize_json_data({"status": "success", "routes": df_new_routes.to_dict(orient="records")})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/export-full/{project_id}")
def export_full_project(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Não existem dados exportáveis.")
                
            state_dict = deserialize_state(row["payload_json"])
            
            routes_df = state_dict.get('routes_solution')
            if routes_df is None or (isinstance(routes_df, pd.DataFrame) and routes_df.empty):
                routes_df = state_dict.get('routes_df')
                
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
            rules_matrix=rules_matrix
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
    if not proj or proj["empresa_id"] != current_user.empresa_id:
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
        fleet_config = state_dict.get("fleet_config") or state_dict.get("fleet_config_used", {})
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
