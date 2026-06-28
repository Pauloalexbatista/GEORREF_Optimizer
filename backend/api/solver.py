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
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        # 2. Get latest snapshot to retrieve fleet config and warehouses
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=400, detail="Por favor configure a frota e os armazéns antes de otimizar.")
                
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
                    "Nivel_Qualidade": dr["nivel_qualidade"]
                })
            deliveries_df = pd.DataFrame(df_rows)
            
        # 4. Prepare fleet config and warehouses DataFrames
        raw_wh = state_dict.get("warehouses_geocoded")
        if raw_wh is None or (isinstance(raw_wh, pd.DataFrame) and raw_wh.empty):
            raise HTTPException(status_code=400, detail="Nenhum armazém configurado no projeto.")
        warehouses_df = raw_wh if isinstance(raw_wh, pd.DataFrame) else pd.DataFrame(raw_wh)
        
        fleet_config = state_dict.get("fleet_config")
        if not fleet_config:
            raise HTTPException(status_code=400, detail="Nenhum veículo configurado na frota.")
            
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
        optimizer = AdvancedRouteOptimizer()
        result = optimizer.optimize_routes(
            distance_matrix,
            demands,
            vehicle_capacities,
            depot_indices,
            optimization_params=req.params,
            volume_demands=volume_demands,
            vehicle_volume_capacities=vehicle_volume_capacities
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
            vehicle_name = vehicle_names[vehicle_idx] if vehicle_idx < len(vehicle_names) else f"Veículo {vehicle_idx + 1}"
            
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
                        "Rota": "⚠️ PENDENTE",
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
        snapshot_name = f"Otimização VRP ({datetime.now().strftime('%H:%M:%S')})"
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
                if isinstance(raw_routes, pd.DataFrame):
                    df_routes = raw_routes
                else:
                    df_routes = pd.DataFrame(raw_routes)
                    
                if not df_routes.empty:
                    for idx, r in df_routes.iterrows():
                        routes_list.append({
                            "Rota": r.get("Rota", "⚠️ PENDENTE"),
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

class ReassignRequest(BaseModel):
    project_id: int
    client_code: str
    new_route: str

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
             
        client_idx = df_routes[df_routes["Cliente"] == req.client_code].index
        if len(client_idx) == 0:
            raise HTTPException(status_code=404, detail="Cliente não encontrado nas rotas.")
            
        df_routes.loc[client_idx[0], "Rota"] = req.new_route
        
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
        snapshot_name = f"Reatribuição Manual ({datetime.now().strftime('%H:%M:%S')})"
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", (req.project_id, current_user.id, 3, snapshot_name, payload))
            conn.commit()
            
        routes_list = df_new_routes.to_dict(orient="records")
        return {"status": "success", "routes": routes_list}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
