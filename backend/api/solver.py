from fastapi.responses import StreamingResponse
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import os
import sys
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

class SolverRequest(BaseModel):
    project_id: int
    params: Dict[str, Any]

def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    return R * c

@router.post("/solve")
def run_solver(req: SolverRequest, current_user: UserResponse = Depends(get_current_user)):
    # 1. Verify project permission
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")
        
    try:
        # 2. Get latest snapshot to retrieve fleet config and warehouses
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Por favor configure a frota e os armazÃ©ns antes de otimizar.")
                
            state_dict = deserialize_state(row["payload_json"])
            
        # 3. Load deliveries from database
        deliveries_df = None
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC", (req.project_id,))
            rows = cursor.fetchall()
            
            if not rows:
                raise HTTPException(status_code=400, detail="Nenhum cliente georreferenciado encontrado no projeto.")
                
            # Convert SQLite rows to pandas DataFrame
            col_names = [d[0] for d in cursor.description]
            delivery_rows = [dict(zip(col_names, r)) for r in rows]
            # Standardize column mappings expected by converter
            # cp -> Codigo_Postal, concelho -> Localidade, name -> Codigo_Cliente
            df_rows = []
            for dr in delivery_rows:
                df_rows.append({
                    "id": dr["id"],
                    "Codigo_Cliente": dr["codigo_cliente"],
                    "Morada": dr["morada"],
                    "Codigo_Postal": dr["codigo_postal"],
                    "Localidade": dr["_concelho"],
                    "Peso_KG": dr["peso_kg"],
                    "Volume_m3": dr["volume_m3"],
                    "Prioridade": dr["prioridade"],
                    "Slot1_Inicio": dr["janela_inicio"],
                    "Slot1_Fim": dr["janela_fim"],
                    "Latitude": dr["latitude"],
                    "Longitude": dr["longitude"],
                    "Nivel_Qualidade": dr["nivel_qualidade"],
                    "Armazem": dr.get("armazem")
                })
            deliveries_df = pd.DataFrame(df_rows)
            
        # 4. Prepare fleet config and warehouses DataFrames
        raw_wh = state_dict.get("warehouses_geocoded")
        if raw_wh is None or (isinstance(raw_wh, pd.DataFrame) and raw_wh.empty):
            raise HTTPException(status_code=400, detail="Nenhum armazÃ©m configurado no projeto.")
        warehouses_df = raw_wh if isinstance(raw_wh, pd.DataFrame) else pd.DataFrame(raw_wh)
        
        fleet_config = state_dict.get("fleet_config")
        if not fleet_config:
            raise HTTPException(status_code=400, detail="Nenhum veÃ­culo configurado na frota.")
            
        # 5. Build coordinates locations array and solver demands
        locations = []
        location_names = []
        demands = []
        volume_demands = []
        
        # Add warehouses first
        warehouse_indices = {}
        for idx, row in warehouses_df.iterrows():
            locations.append((row["Latitude"], row["Longitude"]))
            location_names.append(row["Nome_Armazem"])
            demands.append(0)
            volume_demands.append(0)
            warehouse_indices[row["Nome_Armazem"]] = len(locations) - 1
            
        # Add clients
        client_start_idx = len(locations)
        for idx, row in deliveries_df.iterrows():
            locations.append((row["Latitude"], row["Longitude"]))
            location_names.append(row.get("Codigo_Cliente", f"Cliente_{idx}"))
            demands.append(row.get("Peso_KG", 50))
            volume_demands.append(row.get("Volume_m3", 0.1))
            
        # Calculate distance matrix
        distance_matrix = calculate_haversine_matrix(locations)
        
        # Ensure fleet_config is parsed as dict
        if isinstance(fleet_config, pd.DataFrame):
            temp_dict = {}
            for _, row in fleet_config.iterrows():
                temp_dict[row["Veiculo"]] = {
                    "capacity": row["Capacidade_KG"],
                    "capacity_volume": row.get("Cap_Volume_m3", 0),
                    "cost_per_km": row["Custo_KM"],
                    "speed": row["Velocidade_Media"],
                    "start_time": str(row["Horario_Inicio"]),
                    "end_time": str(row["Horario_Fim"]),
                    "warehouse": row["Armazem"]
                }
            fleet_config = temp_dict
            
        # Prepare fleet configurations for solver
        vehicle_capacities = []
        vehicle_volume_capacities = []
        depot_indices = []
        vehicle_names = []
        
        for vehicle_name, vehicle_data in fleet_config.items():
            if isinstance(vehicle_data, dict):
                vehicle_capacities.append(vehicle_data.get("capacity", vehicle_data.get("capacidade_kg", 1000)))
                vehicle_volume_capacities.append(vehicle_data.get("capacity_volume", vehicle_data.get("capacidade_vol", 5.0)))
                warehouse_name = vehicle_data.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"])
            else:
                vehicle_capacities.append(getattr(vehicle_data, "capacidade_kg", 1000))
                vehicle_volume_capacities.append(getattr(vehicle_data, "capacidade_vol", 5.0))
                warehouse_name = getattr(vehicle_data, "armazem", warehouses_df.iloc[0]["Nome_Armazem"])
            depot_indices.append(warehouse_indices.get(warehouse_name, 0))
            vehicle_names.append(vehicle_name)
            
        # 6. Run solver
        solver_params = dict(req.params or {})
        if 'time_limit' in solver_params and 'time_limit_seconds' not in solver_params:
            solver_params['time_limit_seconds'] = solver_params['time_limit']

        client_warehouses = list(deliveries_df["Armazem"].fillna(""))
        
        vehicle_warehouses = []
        for vehicle_name, vehicle_data in fleet_config.items():
            if isinstance(vehicle_data, dict):
                vehicle_warehouses.append(vehicle_data.get("warehouse", warehouses_df.iloc[0]["Nome_Armazem"]))
            else:
                vehicle_warehouses.append(getattr(vehicle_data, "armazem", warehouses_df.iloc[0]["Nome_Armazem"]))
                
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
            vehicle_warehouses=vehicle_warehouses
        )
        
        if result["status"] != "SUCCESS":
            # Return failure status with diagnostics info
            total_demand = sum(demands)
            total_capacity = sum(vehicle_capacities)
            total_vol_demand = sum(volume_demands)
            total_vol_capacity = sum(vehicle_volume_capacities)
            
            diagnostics = {
                "status": result["status"],
                "total_demand_kg": total_demand,
                "total_capacity_kg": total_capacity,
                "total_volume_demand_m3": total_vol_demand,
                "total_volume_capacity_m3": total_vol_capacity,
                "weight_capacity_insufficient": total_capacity < total_demand,
                "volume_capacity_insufficient": total_vol_capacity < total_vol_demand
            }
            return {"status": "failure", "diagnostics": diagnostics}
            
        # 7. Convert solver output to routes list
        routes_list = []
        for vehicle_idx, route in enumerate(result["routes"]):
            vehicle_name = vehicle_names[vehicle_idx] if vehicle_idx < len(vehicle_names) else f"VeÃ­culo {vehicle_idx + 1}"
            
            order = 1
            cumulative_dist = 0
            cumulative_load = 0
            cumulative_volume = 0
            current_time = datetime.strptime("08:00", "%H:%M")
            
            depot_idx = route[0]
            prev_lat, prev_lon = locations[depot_idx]
            
            # Skip first and last depot node
            for i in range(1, len(route) - 1):
                loc_idx = route[i]
                
                if loc_idx >= client_start_idx:
                    client_idx = loc_idx - client_start_idx
                    client_row = deliveries_df.iloc[client_idx]
                    
                    client_lat = client_row["Latitude"]
                    client_lon = client_row["Longitude"]
                    
                    dist_from_prev = haversine_distance(prev_lat, prev_lon, client_lat, client_lon)
                    cumulative_dist += dist_from_prev
                    
                    # 40 km/h average
                    travel_time_minutes = (dist_from_prev / 40) * 60
                    arrival_time = current_time + timedelta(minutes=travel_time_minutes)
                    service_time = 15
                    departure_time = arrival_time + timedelta(minutes=service_time)
                    
                    demand = client_row.get("Peso_KG", 50)
                    vol_demand = client_row.get("Volume_m3", 0.1)
                    cumulative_load += demand
                    cumulative_volume += vol_demand
                    
                    win_s = client_row.get("Slot1_Inicio", "")
                    win_e = client_row.get("Slot1_Fim", "")
                    combined_window = f"{win_s} - {win_e}" if (win_s and win_e) else "Qualquer"
                    
                    if isinstance(fleet_config.get(vehicle_name), dict):
                        warehouse_origin = fleet_config.get(vehicle_name, {}).get("warehouse", "N/A")
                    else:
                        warehouse_origin = getattr(fleet_config.get(vehicle_name), "armazem", "N/A")
                        
                    routes_list.append({
                        "Rota": vehicle_name,
                        "Armazem": warehouse_origin,
                        "Ordem": order,
                        "Cliente": client_row.get("Codigo_Cliente", f"Cliente_{client_idx}"),
                        "Morada": client_row.get("Morada", "N/A"),
                        "CP": client_row.get("Codigo_Postal", "N/A"),
                        "Localidade": client_row.get("Localidade", ""),
                        "Janela_Horaria": combined_window,
                        "Latitude": client_lat,
                        "Longitude": client_lon,
                        "Chegada": arrival_time.strftime("%H:%M"),
                        "Tempo_Entrega": service_time,
                        "Saida": departure_time.strftime("%H:%M"),
                        "Nivel_Qualidade": int(client_row.get("Nivel_Qualidade", 0)),
                        "KM_Anterior": round(dist_from_prev, 2),
                        "Dist_Acum": round(cumulative_dist, 2),
                        "Carga_Acum": round(cumulative_load, 1),
                        "Carga_Vol_Acum": round(cumulative_volume, 2)
                    })
                    
                    prev_lat, prev_lon = client_lat, client_lon
                    current_time = departure_time
                    order += 1
                    
        # Process dropped nodes as PENDENTE
        dropped_nodes = result.get("dropped_nodes", [])
        if dropped_nodes:
            order = 1
            for loc_idx in dropped_nodes:
                if loc_idx >= client_start_idx:
                    client_idx = loc_idx - client_start_idx
                    client_row = deliveries_df.iloc[client_idx]
                    
                    win_s = client_row.get("Slot1_Inicio", "")
                    win_e = client_row.get("Slot1_Fim", "")
                    combined_window = f"{win_s} - {win_e}" if (win_s and win_e) else "Qualquer"
                    
                    routes_list.append({
                        "Rota": "PENDENTE",
                        "Armazem": "N/A",
                        "Ordem": order,
                        "Cliente": client_row.get("Codigo_Cliente", f"Cliente_{client_idx}"),
                        "Morada": client_row.get("Morada", "N/A"),
                        "CP": client_row.get("Codigo_Postal", "N/A"),
                        "Localidade": client_row.get("Localidade", ""),
                        "Janela_Horaria": combined_window,
                        "Latitude": client_row["Latitude"],
                        "Longitude": client_row["Longitude"],
                        "Chegada": "00:00",
                        "Tempo_Entrega": 0,
                        "Saida": "00:00",
                        "Nivel_Qualidade": int(client_row.get("Nivel_Qualidade", 0)),
                        "KM_Anterior": 0.0,
                        "Dist_Acum": 0.0,
                        "Carga_Acum": round(client_row.get("Peso_KG", 50), 1),
                        "Carga_Vol_Acum": round(client_row.get("Volume_m3", 0.1), 2)
                    })
                    order += 1
                    
        # 8. Save snapshot with optimized solution
        df_routes = pd.DataFrame(routes_list)
        state_dict["routes_solution"] = df_routes
        state_dict["fleet_config_used"] = fleet_config
        state_dict["warehouses_used"] = warehouses_df
        state_dict["optimization_params"] = req.params
        
        payload = serialize_state(state_dict)
        snapshot_name = f"OtimizaÃ§Ã£o VRP ({datetime.now().strftime('%H:%M:%S')})"
        user_id = current_user.id
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", (req.project_id, user_id, 3, snapshot_name, payload))
            conn.commit()
            
        return {
            "status": "success",
            "routes": routes_list,
            "quality_metrics": result.get("quality_metrics", {})
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{project_id}")
def get_solver_solution(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")
        
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
                if isinstance(raw_routes, pd.DataFrame):
                    df_routes = raw_routes
                else:
                    df_routes = pd.DataFrame(raw_routes)
                    
                if not df_routes.empty:
                    for idx, r in df_routes.iterrows():
                        routes_list.append({
                            "Rota": r.get("Rota", "âš ï¸ PENDENTE"),
                            "Armazem": r.get("Armazem", "N/A"),
                            "Ordem": int(r.get("Ordem", 1)),
                            "Cliente": r.get("Cliente", ""),
                            "Morada": r.get("Morada", ""),
                            "CP": r.get("CP", ""),
                            "Localidade": r.get("Localidade", ""),
                            "Janela_Horaria": r.get("Janela_Horaria", "Qualquer"),
                            "Latitude": float(r.get("Latitude", 0.0)),
                            "Longitude": float(r.get("Longitude", 0.0)),
                            "Chegada": r.get("Chegada", "00:00"),
                            "Tempo_Entrega": int(r.get("Tempo_Entrega", 15)),
                            "Saida": r.get("Saida", "00:00"),
                            "Nivel_Qualidade": int(r.get("Nivel_Qualidade", 1)),
                            "KM_Anterior": float(r.get("KM_Anterior", 0.0)),
                            "Dist_Acum": float(r.get("Dist_Acum", 0.0)),
                            "Carga_Acum": float(r.get("Carga_Acum", 0.0)),
                            "Carga_Vol_Acum": float(r.get("Carga_Vol_Acum", 0.0))
                        })
                        
            return {
                "status": "success" if routes_list else "none",
                "routes": routes_list,
                "quality_metrics": state_dict.get("routes_metrics", {})
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ReorderRequest(BaseModel):
    project_id: int
    route_name: str
    client_code: str
    new_order: int

class ReassignRequest(BaseModel):
    project_id: int
    client_code: str
    new_route: str

@router.post("/reassign")
def reassign_client_route(req: ReassignRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="NÃ£o existem rotas calculadas para reatribuir.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="NÃ£o existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
             raise HTTPException(status_code=400, detail="A lista de rotas estÃ¡ vazia.")
             
        # Robust case and space insensitive matching
        clean_target_code = str(req.client_code).strip().upper()
        client_idx = df_routes[df_routes["Cliente"].astype(str).str.strip().str.upper() == clean_target_code].index
        
        if len(client_idx) == 0:
            # Fallback check if passed by id or partial name
            client_idx = df_routes[df_routes["Cliente"].astype(str).str.contains(clean_target_code, case=False, na=False)].index
            
        if len(client_idx) == 0:
            raise HTTPException(status_code=404, detail="Cliente nÃ£o encontrado nas rotas.")
            
        target_idx = client_idx[0]
        df_routes.loc[target_idx, "Rota"] = req.new_route
        if "PENDENTE" not in str(req.new_route):
            df_routes.loc[target_idx, "Ordem"] = 99999
        
        warehouses_df = state_dict.get("warehouses_geocoded")
        depot_lat = warehouses_df.iloc[0]["Latitude"] if not warehouses_df.empty else 39.5
        depot_lon = warehouses_df.iloc[0]["Longitude"] if not warehouses_df.empty else -8.0
        
        updated_rows = []
        unique_routes = df_routes["Rota"].unique()
        
        for r_name in unique_routes:
            route_clients = df_routes[df_routes["Rota"] == r_name].copy()
            if "PENDENTE" in r_name:
                order = 1
                for idx, row_c in route_clients.iterrows():
                    row_c["Ordem"] = order
                    row_c["Chegada"] = "00:00"
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    order += 1
                continue
                
            route_clients = route_clients.sort_values(by="Ordem")
            
            order = 1
            cumulative_dist = 0.0
            cumulative_load = 0.0
            cumulative_volume = 0.0
            current_time = datetime.strptime("08:00", "%H:%M")
            
            prev_lat = depot_lat
            prev_lon = depot_lon
            
            for idx, row_c in route_clients.iterrows():
                c_lat = row_c["Latitude"]
                c_lon = row_c["Longitude"]
                
                dist = haversine_distance(prev_lat, prev_lon, c_lat, c_lon)
                cumulative_dist += dist
                
                travel_time = (dist / 40.0) * 60.0
                arrival = current_time + timedelta(minutes=travel_time)
                service = int(row_c.get("Tempo_Entrega", 15))
                departure = arrival + timedelta(minutes=service)
                
                row_c["Ordem"] = order
                row_c["Chegada"] = arrival.strftime("%H:%M")
                row_c["Saida"] = departure.strftime("%H:%M")
                row_c["KM_Anterior"] = round(dist, 2)
                row_c["Dist_Acum"] = round(cumulative_dist, 2)
                
                updated_rows.append(row_c.to_dict())
                
                prev_lat = c_lat
                prev_lon = c_lon
                current_time = departure
                order += 1
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        
        payload = serialize_state(state_dict)
        snapshot_name = f"ReatribuiÃ§Ã£o Manual ({datetime.now().strftime('%H:%M:%S')})"
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", (req.project_id, current_user.id, 3, snapshot_name, payload))
            conn.commit()
            
        routes_list = df_new_routes.to_dict(orient="records")
        return {"status": "success", "routes": routes_list}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reorder")
def reorder_client_stop(req: ReorderRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="NÃ£o existem rotas calculadas.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="NÃ£o existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
            
        if df_routes.empty:
             raise HTTPException(status_code=400, detail="A lista de rotas estÃ¡ vazia.")
             
        # Get all clients in this specific route
        route_clients = df_routes[df_routes["Rota"] == req.route_name].copy()
        if route_clients.empty:
            raise HTTPException(status_code=404, detail="Rota nÃ£o encontrada ou vazia.")
            
        # Sort by current order
        route_clients = route_clients.sort_values(by="Ordem")
        
        # Convert to list of dicts to manipulate sequence
        clients_list = [row_c.to_dict() for idx, row_c in route_clients.iterrows()]
        
        # Find index of target client
        target_idx = -1
        for i, c in enumerate(clients_list):
            if c["Cliente"] == req.client_code:
                target_idx = i
                break
                
        if target_idx == -1:
            raise HTTPException(status_code=404, detail="Cliente nÃ£o encontrado na rota.")
            
        # Remove target client and insert at new_order - 1 (clamped)
        target_client = clients_list.pop(target_idx)
        new_pos = max(0, min(req.new_order - 1, len(clients_list)))
        clients_list.insert(new_pos, target_client)
        
        # Update Ordem field sequentially
        for i, c in enumerate(clients_list):
            c["Ordem"] = i + 1
            
        # Replace these clients back in df_routes
        new_orders = {c["Cliente"]: c["Ordem"] for c in clients_list}
        
        for client_code, new_ord in new_orders.items():
            df_routes.loc[df_routes["Cliente"] == client_code, "Ordem"] = new_ord
            
        # Recalculate route times and distances
        warehouses_df = state_dict.get("warehouses_geocoded")
        depot_lat = warehouses_df.iloc[0]["Latitude"] if not warehouses_df.empty else 39.5
        depot_lon = warehouses_df.iloc[0]["Longitude"] if not warehouses_df.empty else -8.0
        
        updated_rows = []
        unique_routes = df_routes["Rota"].unique()
        
        for r_name in unique_routes:
            route_cls = df_routes[df_routes["Rota"] == r_name].copy()
            if "PENDENTE" in r_name:
                order = 1
                for idx, row_c in route_cls.iterrows():
                    row_c["Ordem"] = order
                    row_c["Chegada"] = "00:00"
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    order += 1
                continue
                
            route_cls = route_cls.sort_values(by="Ordem")
            
            order = 1
            cumulative_dist = 0.0
            cumulative_load = 0.0
            cumulative_volume = 0.0
            current_time = datetime.strptime("08:00", "%H:%M")
            
            prev_lat = depot_lat
            prev_lon = depot_lon
            
            for idx, row_c in route_cls.iterrows():
                c_lat = row_c["Latitude"]
                c_lon = row_c["Longitude"]
                
                dist = haversine_distance(prev_lat, prev_lon, c_lat, c_lon)
                cumulative_dist += dist
                
                travel_time = (dist / 40.0) * 60.0
                arrival = current_time + timedelta(minutes=travel_time)
                service = int(row_c.get("Tempo_Entrega", 15))
                departure = arrival + timedelta(minutes=service)
                
                row_c["Ordem"] = order
                row_c["Chegada"] = arrival.strftime("%H:%M")
                row_c["Saida"] = departure.strftime("%H:%M")
                row_c["KM_Anterior"] = round(dist, 2)
                row_c["Dist_Acum"] = round(cumulative_dist, 2)
                
                updated_rows.append(row_c.to_dict())
                
                prev_lat = c_lat
                prev_lon = c_lon
                current_time = departure
                order += 1
                
        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        
        payload = serialize_state(state_dict)
        snapshot_name = f"Reordenacao Manual ({datetime.now().strftime('%H:%M:%S')})"
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", (req.project_id, current_user.id, 3, snapshot_name, payload))
            conn.commit()
            
        routes_list = df_new_routes.to_dict(orient="records")
        return {"status": "success", "routes": routes_list}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/{project_id}")
def export_optimized_routes(
    project_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
        if not row:
            raise HTTPException(status_code=400, detail="NÃ£o existem rotas calculadas para este projeto.")
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        
        if raw_routes is None:
            raise HTTPException(status_code=400, detail="NÃ£o existem rotas ativas neste projeto.")
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas estÃ¡ vazia.")
            
        from utils.export_engine import generate_route_excel
        excel_data = generate_route_excel(df_routes)
        
        output = io.BytesIO(excel_data)
        output.seek(0)
        
        filename = f"rotas_otimizadas_{project_id}.xlsx"
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"'
        }
        return StreamingResponse(
            output,
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers=headers
        )
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar rotas: {str(e)}")



@router.get("/export-full/{project_id}")
def export_full_project(
    project_id: int,
    current_user: UserResponse = Depends(get_current_user)
):
    """Export the complete project Excel: ArmazÃ©ns, Frota, Entregas, Rotas, Manifesto, OpÃ§Ãµes."""
    import io as _io
    from fastapi.responses import StreamingResponse as _SR
    proj = get_projeto(project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")

    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1",
                (project_id,)
            )
            snap_row = cursor.fetchone()

            cursor.execute(
                """SELECT codigo_cliente, morada, codigo_postal, _concelho, latitude, longitude,
                          peso_kg, volume_m3, prioridade, janela_inicio, janela_fim, armazem,
                          nivel_qualidade, fonte_match, morada_encontrada
                   FROM entregas WHERE projeto_id = ?""",
                (project_id,)
            )
            del_rows = cursor.fetchall()

        deliveries_df = None
        if del_rows:
            deliveries_df = pd.DataFrame([dict(r) for r in del_rows])
            deliveries_df = deliveries_df.rename(columns={
                'codigo_cliente': 'Codigo_Cliente',
                'morada': 'Morada',
                'codigo_postal': 'Codigo_Postal',
                '_concelho': 'Localidade',
                'latitude': 'Latitude',
                'longitude': 'Longitude',
                'peso_kg': 'Peso_KG',
                'volume_m3': 'Volume_m3',
                'prioridade': 'Prioridade',
                'janela_inicio': 'Janela_Inicio',
                'janela_fim': 'Janela_Fim',
                'armazem': 'Armazem',
                'nivel_qualidade': 'Nivel_Qualidade',
                'fonte_match': 'Fonte_Match',
                'morada_encontrada': 'Morada_Encontrada'
            })

        routes_df = None
        warehouses_df = None
        fleet_config = None
        optimization_params = None

        if snap_row:
            state_dict = deserialize_state(snap_row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            if raw_routes is not None:
                routes_df = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)

            wh_data = state_dict.get('warehouses_used')
            if wh_data is None or (hasattr(wh_data, 'empty') and wh_data.empty):
                wh_data = state_dict.get('warehouses_geocoded')
            if wh_data is not None:
                warehouses_df = wh_data if isinstance(wh_data, pd.DataFrame) else pd.DataFrame(wh_data)

            fleet_config = state_dict.get('fleet_config_used')
            if fleet_config is None or (hasattr(fleet_config, 'empty') and fleet_config.empty):
                fleet_config = state_dict.get('fleet_config')
            optimization_params = state_dict.get("optimization_params")

        from utils.export_engine import generate_full_project_excel
        excel_data = generate_full_project_excel(
            routes_df=routes_df,
            deliveries_df=deliveries_df,
            warehouses_df=warehouses_df,
            fleet_config=fleet_config,
            optimization_params=optimization_params
        )

        output = _io.BytesIO(excel_data)
        output.seek(0)

        from datetime import date
        date_str = date.today().strftime('%Y%m%d')
        filename = f"GeoRoute_Completo_{project_id}_{date_str}.xlsx"
        return _SR(
            output,
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers={'Content-Disposition': f'attachment; filename="{filename}"'}
        )

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao exportar projeto completo: {str(e)}")

class OptimizeRouteRequest(BaseModel):
    project_id: int
    route_name: str

@router.post("/optimize-single-route")
def optimize_single_route(req: OptimizeRouteRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(req.project_id)
    if not proj or proj["empresa_id"] != current_user.empresa_id:
        raise HTTPException(status_code=403, detail="NÃ£o tem permissÃ£o para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="NÃ£o existem rotas calculadas.")
                
            state_dict = deserialize_state(row["payload_json"])
            raw_routes = state_dict.get("routes_solution")
            
            if raw_routes is None:
                raise HTTPException(status_code=400, detail="NÃ£o existem rotas ativas neste projeto.")
                
            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)

        if df_routes.empty:
            raise HTTPException(status_code=400, detail="A lista de rotas estÃ¡ vazia.")

        route_mask = df_routes["Rota"] == req.route_name
        route_stops = df_routes[route_mask].copy()

        if len(route_stops) <= 1:
            return {"status": "success", "routes": df_routes.to_dict(orient="records")}

        warehouses_df = state_dict.get("warehouses_geocoded")
        wh_name = route_stops.iloc[0].get("Armazem", "")
        matching_wh = warehouses_df[warehouses_df["Nome_Armazem"] == wh_name] if (warehouses_df is not None and not warehouses_df.empty and "Nome_Armazem" in warehouses_df.columns) else pd.DataFrame()

        if not matching_wh.empty:
            depot_lat = float(matching_wh.iloc[0]["Latitude"])
            depot_lon = float(matching_wh.iloc[0]["Longitude"])
        elif warehouses_df is not None and not warehouses_df.empty:
            depot_lat = float(warehouses_df.iloc[0]["Latitude"])
            depot_lon = float(warehouses_df.iloc[0]["Longitude"])
        else:
            depot_lat, depot_lon = 38.75, -9.2

        unvisited = list(route_stops.index)
        ordered_indices = []
        cur_lat, cur_lon = depot_lat, depot_lon

        while unvisited:
            best_idx = None
            best_dist = float("inf")
            for idx in unvisited:
                c_lat = float(df_routes.loc[idx, "Latitude"])
                c_lon = float(df_routes.loc[idx, "Longitude"])
                d = haversine_distance(cur_lat, cur_lon, c_lat, c_lon)
                if d < best_dist:
                    best_dist = d
                    best_idx = idx
            ordered_indices.append(best_idx)
            unvisited.remove(best_idx)
            cur_lat = float(df_routes.loc[best_idx, "Latitude"])
            cur_lon = float(df_routes.loc[best_idx, "Longitude"])

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
            if "PENDENTE" in r_name:
                ord_num = 1
                for idx, row_c in r_clients.iterrows():
                    row_c["Ordem"] = ord_num
                    row_c["Chegada"] = "00:00"
                    row_c["Saida"] = "00:00"
                    row_c["KM_Anterior"] = 0.0
                    row_c["Dist_Acum"] = 0.0
                    updated_rows.append(row_c.to_dict())
                    ord_num += 1
                continue

            r_clients = r_clients.sort_values(by="Ordem")
            ord_num = 1
            cumulative_dist = 0.0
            current_time = datetime.strptime("08:00", "%H:%M")
            p_lat, p_lon = depot_lat, depot_lon

            for idx, row_c in r_clients.iterrows():
                c_lat = float(row_c["Latitude"])
                c_lon = float(row_c["Longitude"])
                dist = haversine_distance(p_lat, p_lon, c_lat, c_lon)
                cumulative_dist += dist

                travel_time = (dist / 40.0) * 60.0
                arrival = current_time + timedelta(minutes=travel_time)
                service = int(row_c.get("Tempo_Entrega", 15))
                departure = arrival + timedelta(minutes=service)

                row_c["Ordem"] = ord_num
                row_c["Chegada"] = arrival.strftime("%H:%M")
                row_c["Saida"] = departure.strftime("%H:%M")
                row_c["KM_Anterior"] = round(dist, 2)
                row_c["Dist_Acum"] = round(cumulative_dist, 2)

                updated_rows.append(row_c.to_dict())
                p_lat, p_lon = c_lat, c_lon
                current_time = departure
                ord_num += 1

        df_new_routes = pd.DataFrame(updated_rows)
        state_dict["routes_solution"] = df_new_routes
        payload = serialize_state(state_dict)

        snapshot_name = f"OtimizaÃ§Ã£o Rota {req.route_name} ({datetime.now().strftime('%H:%M:%S')})"
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                           (req.project_id, current_user.id, 3, snapshot_name, payload))
            conn.commit()

        return {"status": "success", "routes": df_new_routes.to_dict(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

