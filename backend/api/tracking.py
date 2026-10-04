from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import pandas as pd
import numpy as np
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
    route_name: str
    sequence: Optional[int] = None
    stop_id: Optional[int] = None
    client_name: Optional[str] = None
    status: str  # "Entregue", "Não Entregue", "Pendente"
    fail_reason: Optional[str] = ""
    driver_notes: Optional[str] = ""
    actual_time: Optional[str] = None

class TelemetryPayload(BaseModel):
    driver_name: Optional[str] = None
    vehicle: Optional[str] = None
    route_name: Optional[str] = None
    lat: float
    lng: float
    speed: Optional[float] = 0.0
    heading: Optional[float] = 0.0
    timestamp: Optional[str] = None


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
        
        default_reasons = [
            "Cliente Ausente",
            "Morada Incorreta / Incompleta",
            "Recusado pelo Cliente",
            "Avaria na Viatura",
            "Fora de Horário",
            "Acesso Bloqueado",
            "Outro Motivo"
        ]
        
        if not row:
            return {
                "totals": {"total_stops": 0, "entregues": 0, "falhadas": 0, "pendentes": 0, "rate": 0},
                "routes": [],
                "drivers": [],
                "available_drivers": [],
                "warehouses": [],
                "reasons": default_reasons,
                "fail_reasons": default_reasons,
                "last_telemetry": {},
                "activity": []
            }
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution", state_dict.get("routes_df"))
        
        if raw_routes is None:
            return {
                "totals": {"total_stops": 0, "entregues": 0, "falhadas": 0, "pendentes": 0, "rate": 0},
                "routes": [],
                "drivers": [],
                "available_drivers": [],
                "warehouses": [],
                "reasons": default_reasons,
                "fail_reasons": default_reasons,
                "last_telemetry": {},
                "activity": []
            }
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if df_routes.empty:
            return {
                "totals": {"total_stops": 0, "entregues": 0, "falhadas": 0, "pendentes": 0, "rate": 0},
                "routes": [],
                "drivers": [],
                "available_drivers": [],
                "warehouses": [],
                "reasons": default_reasons,
                "fail_reasons": default_reasons,
                "last_telemetry": {},
                "activity": []
            }
            
        # 1. Obter e Indexar Armazéns (Warehouses)
        wh_raw = state_dict.get("warehouses_geocoded")
        if wh_raw is None or (isinstance(wh_raw, pd.DataFrame) and wh_raw.empty):
            wh_raw = state_dict.get("warehouses_used", state_dict.get("df_warehouses", state_dict.get("warehouses", [])))
            
        warehouses_dict = {}
        warehouses_list = []
        
        if isinstance(wh_raw, pd.DataFrame) and not wh_raw.empty:
            for idx, w in wh_raw.iterrows():
                w_name = str(w.get("Nome_Armazem", w.get("Nome", w.get("name", f"ARM_{idx+1}")))).strip()
                w_lat = float(w.get("Latitude", w.get("Lat", w.get("lat", 0.0)))) if pd.notna(w.get("Latitude", w.get("Lat", w.get("lat", 0.0)))) else 0.0
                w_lng = float(w.get("Longitude", w.get("Lon", w.get("lng", 0.0)))) if pd.notna(w.get("Longitude", w.get("Lon", w.get("lng", 0.0)))) else 0.0
                w_addr = str(w.get("Morada", w.get("address", "")))
                
                if w_lat != 0 and w_lng != 0:
                    wh_obj = {"name": w_name, "address": w_addr, "lat": w_lat, "lng": w_lng}
                    warehouses_dict[w_name] = wh_obj
                    warehouses_dict[w_name.lower()] = wh_obj
                    warehouses_list.append(wh_obj)
        elif isinstance(wh_raw, list):
            for idx, w in enumerate(wh_raw):
                if isinstance(w, dict):
                    w_name = str(w.get("Nome_Armazem", w.get("Nome", w.get("name", f"ARM_{idx+1}")))).strip()
                    w_lat = float(w.get("Latitude", w.get("Lat", w.get("lat", 0.0)))) if pd.notna(w.get("Latitude", w.get("Lat", w.get("lat", 0.0)))) else 0.0
                    w_lng = float(w.get("Longitude", w.get("Lon", w.get("lng", 0.0)))) if pd.notna(w.get("Longitude", w.get("Lon", w.get("lng", 0.0)))) else 0.0
                    w_addr = str(w.get("Morada", w.get("address", "")))
                    if w_lat != 0 and w_lng != 0:
                        wh_obj = {"name": w_name, "address": w_addr, "lat": w_lat, "lng": w_lng}
                        warehouses_dict[w_name] = wh_obj
                        warehouses_dict[w_name.lower()] = wh_obj
                        warehouses_list.append(wh_obj)

        # Fallback de Armazém se não existir
        default_wh = warehouses_list[0] if warehouses_list else {
            "name": "Armazém Central",
            "address": "Hub de Distribuição",
            "lat": 38.7500,
            "lng": -9.1500
        }
        if not warehouses_list:
            warehouses_list.append(default_wh)

        # 2. Obter Lista de Motoristas
        raw_drivers = state_dict.get("drivers", state_dict.get("motoristas", []))
        drivers_list_res = []
        available_names = set()
        
        if isinstance(raw_drivers, list):
            for d in raw_drivers:
                if isinstance(d, dict) and d.get("name"):
                    n = str(d.get("name", "")).strip()
                    if n:
                        drivers_list_res.append({
                            "name": n,
                            "pin": str(d.get("pin", "")),
                            "phone": str(d.get("phone", "")),
                            "vehicle": str(d.get("vehicle", "")),
                            "matricula": str(d.get("matricula", "")),
                            "route": str(d.get("route", "")),
                            "is_active": int(d.get("is_active", 1))
                        })
                        available_names.add(n)
                elif isinstance(d, str) and d.strip():
                    n = d.strip()
                    drivers_list_res.append({"name": n, "phone": "", "vehicle": "", "route": ""})
                    available_names.add(n)
        elif isinstance(raw_drivers, pd.DataFrame) and not raw_drivers.empty:
            for _, d in raw_drivers.iterrows():
                name_val = str(d.get("name", d.get("Motorista", ""))).strip()
                if name_val and name_val.lower() not in ['nan', 'none']:
                    drivers_list_res.append({
                        "name": name_val,
                        "pin": str(d.get("pin", d.get("PIN/Password", "1234"))),
                        "phone": str(d.get("phone", d.get("Telemóvel", ""))),
                        "vehicle": str(d.get("vehicle", d.get("Viatura", ""))),
                        "matricula": str(d.get("matricula", d.get("Matrícula", ""))),
                        "route": str(d.get("route", d.get("Rota Atribuída", ""))),
                        "is_active": int(d.get("is_active", 1))
                    })
                    available_names.add(name_val)

        # 3. Totais Globais
        total_stops = len(df_routes)
        estado_series = df_routes.get("Estado", pd.Series(["Pendente"] * total_stops)).fillna("Pendente").astype(str)
        entregues = int((estado_series == "Entregue").sum())
        falhadas = int((estado_series.isin(["Não Entregue", "Nao Entregue", "Falhada"])).sum())
        pendentes = max(0, total_stops - entregues - falhadas)
        rate = round((entregues / total_stops * 100)) if total_stops > 0 else 0
        
        telemetry_map = state_dict.get("telemetry_map", {})
        
        # 4. Construir Estrutura de Rotas
        routes_list = []
        rota_col = "Rota" if "Rota" in df_routes.columns else "route" if "route" in df_routes.columns else None
        
        if rota_col:
            unique_routes = df_routes[rota_col].dropna().unique()
            
            for r_idx, r_name in enumerate(unique_routes):
                r_str = str(r_name).strip()
                if r_str.lower() in ["por distribuir", "pendente", "nan", "", "none", "unassigned"]:
                    continue
                df_r = df_routes[df_routes[rota_col] == r_name].sort_values(
                    by=["Ordem"] if "Ordem" in df_routes.columns else ["id"],
                    ascending=True
                )
                r_total = len(df_r)
                r_est_series = df_r.get("Estado", pd.Series(["Pendente"] * r_total)).fillna("Pendente").astype(str)
                r_entregues = int((r_est_series == "Entregue").sum())
                r_falhadas = int((r_est_series.isin(["Não Entregue", "Nao Entregue", "Falhada"])).sum())
                r_pendentes = max(0, r_total - r_entregues - r_falhadas)
                r_percent = round((r_entregues / r_total * 100)) if r_total > 0 else 0
                
                # Armazém de Origem da Rota
                route_wh_name = str(df_r.iloc[0].get("Armazem", df_r.iloc[0].get("armazem", "ARM_1"))).strip()
                route_wh = warehouses_dict.get(route_wh_name) or warehouses_dict.get(route_wh_name.lower()) or default_wh
                
                stops = []
                for idx_s, (_, s_row) in enumerate(df_r.iterrows()):
                    lat_val = float(s_row.get("Latitude", s_row.get("Lat", s_row.get("lat", 0.0)))) if pd.notna(s_row.get("Latitude", s_row.get("Lat", s_row.get("lat", 0.0)))) else 0.0
                    lng_val = float(s_row.get("Longitude", s_row.get("Lon", s_row.get("lng", 0.0)))) if pd.notna(s_row.get("Longitude", s_row.get("Lon", s_row.get("lng", 0.0)))) else 0.0
                    
                    seq_val = int(s_row.get("Ordem", s_row.get("sequence", idx_s + 1))) if pd.notna(s_row.get("Ordem", s_row.get("sequence", idx_s + 1))) else (idx_s + 1)
                    
                    cli_name = str(s_row.get("Cliente", s_row.get("Nome_Cliente", s_row.get("Nome", ""))))
                    addr_str = str(s_row.get("Morada", s_row.get("address", "")))
                    cp_str = str(s_row.get("CodPostal", s_row.get("CP", s_row.get("postal_code", ""))))
                    loc_str = str(s_row.get("Localidade", s_row.get("locality", "")))
                    tel_str = str(s_row.get("Contacto", s_row.get("Telefone", s_row.get("phone", ""))))
                    w_start = str(s_row.get("Janela_Inicio", s_row.get("Janela1_Inicio", s_row.get("window_start", "08:00"))))
                    w_end = str(s_row.get("Janela_Fim", s_row.get("Janela1_Fim", s_row.get("window_end", "18:00"))))
                    exp_arr = str(s_row.get("Chegada", s_row.get("expected_arrival", "")))
                    act_arr = str(s_row.get("Hora_Picagem", s_row.get("actual_arrival_time", "")))
                    st_val = str(s_row.get("Estado", s_row.get("status", "Pendente")))
                    fail_r = str(s_row.get("Motivo_Falha", s_row.get("fail_reason", "")))
                    dr_notes = str(s_row.get("Notas_Motorista", s_row.get("driver_notes", "")))
                    peso_val = float(s_row.get("Peso_KG", s_row.get("Peso", 0.0))) if pd.notna(s_row.get("Peso_KG", s_row.get("Peso", 0.0))) else 0.0
                    vol_val = float(s_row.get("Volume_m3", s_row.get("Volume", 0.0))) if pd.notna(s_row.get("Volume_m3", s_row.get("Volume", 0.0))) else 0.0
                    vol_pack = int(s_row.get("Volumes", s_row.get("packages", 1))) if pd.notna(s_row.get("Volumes", s_row.get("packages", 1))) else 1

                    stops.append({
                        "id": int(s_row.get("id", s_row.get("ID_Original", seq_val))) if pd.notna(s_row.get("id", s_row.get("ID_Original", seq_val))) else seq_val,
                        "sequence": seq_val,
                        "client_name": cli_name,
                        "cliente": cli_name,
                        "address": addr_str,
                        "morada": addr_str,
                        "postal_code": cp_str,
                        "cod_postal": cp_str,
                        "locality": loc_str,
                        "localidade": loc_str,
                        "phone": tel_str,
                        "telefone": tel_str,
                        "window_start": w_start,
                        "janela_inicio": w_start,
                        "window_end": w_end,
                        "janela_fim": w_end,
                        "expected_arrival": exp_arr,
                        "actual_arrival_time": act_arr if act_arr and act_arr.lower() != "nan" else None,
                        "hora_entrega_real": act_arr if act_arr and act_arr.lower() != "nan" else None,
                        "status": st_val if st_val and st_val.lower() != "nan" else "Pendente",
                        "fail_reason": fail_r if fail_r and fail_r.lower() != "nan" else None,
                        "motivo_falha": fail_r if fail_r and fail_r.lower() != "nan" else None,
                        "driver_notes": dr_notes if dr_notes and dr_notes.lower() != "nan" else None,
                        "notas_motorista": dr_notes if dr_notes and dr_notes.lower() != "nan" else None,
                        "weight_kg": peso_val,
                        "peso_kg": peso_val,
                        "volume_m3": vol_val,
                        "packages": vol_pack,
                        "lat": lat_val,
                        "lng": lng_val,
                    })
                
                # Motorista e Viatura
                drv_raw = str(df_r.iloc[0].get("Motorista", df_r.iloc[0].get("driver_name", ""))) if "Motorista" in df_r.columns and pd.notna(df_r.iloc[0].get("Motorista")) else ""
                has_driver = bool(drv_raw.strip() and drv_raw.lower() not in ["não atribuído", "nao atribuido", "nan", "none", ""])
                drv_name = drv_raw.strip() if has_driver else ""
                
                veh_raw = str(df_r.iloc[0].get("Viatura", df_r.iloc[0].get("vehicle", df_r.iloc[0].get("Matricula", r_str)))) if pd.notna(df_r.iloc[0].get("Viatura", df_r.iloc[0].get("vehicle", df_r.iloc[0].get("Matricula", r_str)))) else r_str
                veh_name = veh_raw.strip() if veh_raw.strip() and veh_raw.lower() not in ["nan", "none", ""] else r_str
                
                # 5. Cálculo Dinâmico do Próximo Cliente e Posição Operacional
                # Próxima paragem = primeira paragem pendente
                next_stop = next((s for s in stops if s["status"] == "Pendente"), None)
                last_finished = next((s for s in reversed(stops) if s["status"] in ["Entregue", "Não Entregue", "Nao Entregue"]), None)
                
                # Telemetria em tempo real
                telem = telemetry_map.get(str(r_name), telemetry_map.get(drv_name, {})) if drv_name else telemetry_map.get(str(r_name), {})
                
                last_lat = telem.get("lat")
                last_lng = telem.get("lng")
                last_gps_time = telem.get("timestamp")
                speed_val = float(telem.get("speed", 0.0))
                
                # Se não houver telemetria GPS externa transmitida:
                if not last_lat:
                    if not has_driver:
                        # 1º SEM MOTORISTA: A viatura está na garagem do armazém
                        status_operacional = "🅿️ Garagem (Sem Motorista Atribuído)"
                        # Jitter ligeiro para que as viaturas no armazém não fiquem exatamente no mesmo pixel
                        jitter_lat = ((r_idx % 5) - 2) * 0.0015
                        jitter_lng = (((r_idx // 5) % 5) - 2) * 0.0015
                        last_lat = route_wh["lat"] + jitter_lat
                        last_lng = route_wh["lng"] + jitter_lng
                        last_gps_time = "Em Garagem"
                    elif r_entregues == 0 and r_falhadas == 0:
                        # 2º COM MOTORISTA MAS 0 ENTREGAS: A viatura está a sair do Armazém rumo à Paragem #1
                        if next_stop and next_stop["lat"] != 0:
                            status_operacional = f"🏢 No Armazém ➔ A Caminho de #{next_stop['sequence']} {next_stop['cliente']}"
                        else:
                            status_operacional = "🏢 No Armazém (Pronto a Partir)"
                        last_lat = route_wh["lat"]
                        last_lng = route_wh["lng"]
                        last_gps_time = "08:00 (Partida)"
                    elif next_stop is not None:
                        # 3º EM TRÂNSITO: A caminho do Próximo Cliente
                        status_operacional = f"🚚 Em Trânsito ➔ Próximo: #{next_stop['sequence']} {next_stop['cliente']}"
                        if last_finished and last_finished["lat"] != 0 and next_stop["lat"] != 0:
                            # Posiciona a viatura a caminho da próxima paragem (40% do trajeto)
                            last_lat = last_finished["lat"] * 0.6 + next_stop["lat"] * 0.4
                            last_lng = last_finished["lng"] * 0.6 + next_stop["lng"] * 0.4
                        elif next_stop["lat"] != 0:
                            last_lat = next_stop["lat"]
                            last_lng = next_stop["lng"]
                        else:
                            last_lat = route_wh["lat"]
                            last_lng = route_wh["lng"]
                        last_gps_time = datetime.now().strftime("%H:%M")
                        speed_val = 35.0
                    else:
                        # 4º ROTA CONCLUÍDA: Regresso ao Armazém
                        status_operacional = "🏁 Rota Concluída (No Armazém)"
                        last_lat = route_wh["lat"]
                        last_lng = route_wh["lng"]
                        last_gps_time = last_finished.get("actual_arrival_time") if last_finished else datetime.now().strftime("%H:%M")
                        
                else:
                    if next_stop:
                        status_operacional = f"📡 GPS Live ➔ A Caminho de #{next_stop['sequence']} {next_stop['cliente']}"
                    else:
                        status_operacional = "🏁 Rota Concluída (GPS Live)"

                routes_list.append({
                    "route_id": str(r_name),
                    "route_name": str(r_name),
                    "driver_name": drv_name,
                    "has_driver": has_driver,
                    "vehicle": veh_name,
                    "vehicle_id": veh_name,
                    "warehouse": route_wh["name"],
                    "warehouse_lat": route_wh["lat"],
                    "warehouse_lng": route_wh["lng"],
                    "status_operacional": status_operacional,
                    "next_stop": next_stop,
                    "last_finished_stop": last_finished,
                    "total": int(r_total),
                    "total_stops": int(r_total),
                    "entregues": int(r_entregues),
                    "falhadas": int(r_falhadas),
                    "pendentes": int(r_pendentes),
                    "percent_complete": int(r_percent),
                    "stops": stops,
                    "last_lat": last_lat,
                    "last_lng": last_lng,
                    "last_gps_time": last_gps_time or "Sem sinal GPS",
                    "speed": speed_val
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
            "drivers": drivers_list_res,
            "available_drivers": sorted(list(available_names)),
            "warehouses": warehouses_list,
            "reasons": default_reasons,
            "fail_reasons": default_reasons,
            "last_telemetry": telemetry_map,
            "activity": state_dict.get("activity_log", [])
        }


@router.post("/auto-assign/{project_id}")
def auto_assign_drivers(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    """
    Atribui automaticamente condutores disponíveis a todas as rotas ativas.
    """
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
            raise HTTPException(status_code=400, detail="Nenhum plano de rotas encontrado.")
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution", state_dict.get("routes_df"))
        if raw_routes is None:
            raise HTTPException(status_code=400, detail="Nenhuma rota encontrada.")
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Nenhuma rota encontrada.")
            
        rota_col = "Rota" if "Rota" in df_routes.columns else "route" if "route" in df_routes.columns else None
        if not rota_col:
            raise HTTPException(status_code=400, detail="Coluna de rotas não encontrada.")
            
        unique_routes = [r for r in df_routes[rota_col].dropna().unique() if str(r).lower() not in ["por distribuir", "pendente", "nan", ""]]
        
        # Obter motoristas cadastrados
        raw_drivers = state_dict.get("drivers", state_dict.get("motoristas", []))
        available_driver_names = []
        if isinstance(raw_drivers, list):
            for d in raw_drivers:
                if isinstance(d, dict) and d.get("name"):
                    available_driver_names.append(d.get("name"))
                elif isinstance(d, str):
                    available_driver_names.append(d)
        elif isinstance(raw_drivers, pd.DataFrame):
            for _, d in raw_drivers.iterrows():
                n = str(d.get("name", d.get("Motorista", ""))).strip()
                if n and n.lower() not in ['nan', 'none']:
                    available_driver_names.append(n)
                    
        if not available_driver_names:
            available_driver_names = [f"Motorista {i+1}" for i in range(len(unique_routes))]
            
        if "Motorista" not in df_routes.columns:
            df_routes["Motorista"] = ""
            
        assigned_count = 0
        for i, r_name in enumerate(unique_routes):
            drv_assigned = available_driver_names[i % len(available_driver_names)]
            df_routes.loc[df_routes[rota_col] == r_name, "Motorista"] = drv_assigned
            assigned_count += 1
            
        state_dict["routes_solution"] = df_routes
        state_dict["routes_df"] = df_routes
        
        new_payload = serialize_state(state_dict)
        snapshot_name = f"Atribuição Automática de Motoristas ({assigned_count} rotas)"
        cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 
                       (project_id, current_user.id, 3, snapshot_name, new_payload))
        conn.commit()
        
    return {
        "status": "success",
        "message": f"Atribuídos com sucesso motoristas a {assigned_count} rotas.",
        "assigned_count": assigned_count
    }


@router.post("/assign/{project_id}")
def assign_driver_to_route(project_id: int, payload: AssignDriverPayload, current_user: UserResponse = Depends(get_current_user)):
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
            raise HTTPException(status_code=400, detail="Nenhum plano de rotas encontrado.")
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution", state_dict.get("routes_df"))
        if raw_routes is None:
            raise HTTPException(status_code=400, detail="Nenhuma rota encontrada.")
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Nenhuma rota encontrada.")
            
        if "Motorista" not in df_routes.columns:
            df_routes["Motorista"] = ""
            
        # Update driver in df_routes
        df_routes.loc[df_routes["Rota"] == payload.route_name, "Motorista"] = payload.driver_name
        if payload.vehicle:
            df_routes.loc[df_routes["Rota"] == payload.route_name, "Viatura"] = payload.vehicle
            
        state_dict["routes_solution"] = df_routes
        state_dict["routes_df"] = df_routes
        
        # Also update drivers list in state_dict
        drivers = state_dict.get("drivers", state_dict.get("motoristas", []))
        for d in drivers:
            if isinstance(d, dict):
                if d.get("name") == payload.driver_name:
                    d["route"] = payload.route_name
                    if payload.vehicle:
                        d["vehicle"] = payload.vehicle
                elif d.get("route") == payload.route_name and d.get("name") != payload.driver_name:
                    d["route"] = ""
        state_dict["drivers"] = drivers
        state_dict["motoristas"] = drivers
        
        new_payload = serialize_state(state_dict)
        snapshot_name = f"Atribuição Motorista {payload.driver_name} -> {payload.route_name}"
        cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 
                       (project_id, current_user.id, 3, snapshot_name, new_payload))
        conn.commit()
        
    return {"status": "success", "message": f"Motorista '{payload.driver_name}' atribuído à rota '{payload.route_name}' com sucesso."}


@router.post("/stop/{project_id}")
def update_stop_status(project_id: int, payload: UpdateStopPayload, current_user: UserResponse = Depends(get_current_user)):
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
            raise HTTPException(status_code=400, detail="Nenhum plano de rotas encontrado.")
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution", state_dict.get("routes_df"))
        if raw_routes is None:
            raise HTTPException(status_code=400, detail="Nenhuma rota encontrada.")
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Nenhuma rota encontrada.")
            
        # Match stop by route + sequence OR stop_id OR client_name
        mask = (df_routes["Rota"] == payload.route_name)
        if payload.sequence is not None:
            mask = mask & (df_routes["Ordem"] == payload.sequence)
        elif payload.stop_id is not None and "id" in df_routes.columns:
            mask = mask & (df_routes["id"] == payload.stop_id)
        elif payload.client_name:
            mask = mask & (df_routes["Cliente"] == payload.client_name)
            
        if not mask.any():
            raise HTTPException(status_code=404, detail="Paragem não encontrada na rota especificada.")
            
        now_time = payload.actual_time or datetime.now().strftime("%H:%M:%S")
        
        # Update columns
        df_routes.loc[mask, "Estado"] = payload.status
        if payload.status == "Entregue":
            df_routes.loc[mask, "Hora_Picagem"] = now_time
            df_routes.loc[mask, "Motivo_Falha"] = ""
        elif payload.status in ["Não Entregue", "Nao Entregue", "Falhada"]:
            df_routes.loc[mask, "Hora_Picagem"] = now_time
            df_routes.loc[mask, "Motivo_Falha"] = payload.fail_reason or "Não especificado"
        else: # Pendente
            df_routes.loc[mask, "Hora_Picagem"] = ""
            df_routes.loc[mask, "Motivo_Falha"] = ""
            
        if payload.driver_notes is not None:
            df_routes.loc[mask, "Notas_Motorista"] = payload.driver_notes
            
        state_dict["routes_solution"] = df_routes
        state_dict["routes_df"] = df_routes
        
        # Log activity
        activity = state_dict.get("activity_log", [])
        matched_client = df_routes.loc[mask, "Cliente"].iloc[0] if "Cliente" in df_routes.columns else "Cliente"
        activity.append({
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "route": payload.route_name,
            "client": str(matched_client),
            "status": payload.status,
            "reason": payload.fail_reason or "",
            "notes": payload.driver_notes or ""
        })
        state_dict["activity_log"] = activity[-50:]
        
        new_payload = serialize_state(state_dict)
        snapshot_name = f"Atualização {matched_client}: {payload.status}"
        cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 
                       (project_id, current_user.id, 3, snapshot_name, new_payload))
        conn.commit()
        
    return {"status": "success", "message": f"Estado atualizado para '{payload.status}'.", "hora": now_time}


@router.post("/telemetry/{project_id}")
def update_telemetry(project_id: int, payload: TelemetryPayload, current_user: UserResponse = Depends(get_current_user)):
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
            raise HTTPException(status_code=400, detail="Nenhum snapshot encontrado.")
            
        state_dict = deserialize_state(row["payload_json"])
        telemetry_map = state_dict.get("telemetry_map", {})
        
        now_str = payload.timestamp or datetime.now().strftime("%H:%M:%S")
        telem_data = {
            "lat": payload.lat,
            "lng": payload.lng,
            "speed": payload.speed or 0.0,
            "heading": payload.heading or 0.0,
            "timestamp": now_str,
            "driver_name": payload.driver_name or "",
            "vehicle": payload.vehicle or ""
        }
        
        if payload.route_name:
            telemetry_map[payload.route_name] = telem_data
        if payload.driver_name:
            telemetry_map[payload.driver_name] = telem_data
            
        state_dict["telemetry_map"] = telemetry_map
        
        new_payload = serialize_state(state_dict)
        # Update latest snapshot in-place
        cursor.execute("UPDATE snapshots SET payload_json = ? WHERE id = (SELECT id FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1)", 
                       (new_payload, project_id))
        conn.commit()
        
    return {"status": "success", "timestamp": now_str}


@router.post("/activate/{project_id}")
def activate_project(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado.")
    if proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="Sem permissao para este projeto.")
        
    from database import ativar_projeto
    ativar_projeto(project_id, proj["empresa_id"])
    return {"status": "success", "message": "Rotas ativadas com sucesso para a rua! Os motoristas ja podem aceder a aplicacao."}

@router.post("/deactivate/{project_id}")
def deactivate_project(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto nao encontrado.")
    if proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="Sem permissao para este projeto.")
        
    from database import desativar_projeto
    desativar_projeto(project_id)
    return {"status": "success", "message": "Distribuicao concluida e rotas desativadas com sucesso."}
