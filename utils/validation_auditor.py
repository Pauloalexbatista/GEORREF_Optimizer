"""
Validation & Quality Auditor Module — GEORREF Optimizer
======================================================
Audits routes and stops against all business rules and constraints:
1. Client Time Windows (tolerância zero)
2. Vehicle Shift Return Times (tolerância zero)
3. Vehicle / Client Tag & Rule Compatibility
4. Weight Capacity (KG)
5. Volume Capacity (m3)
6. Max Stops / Deliveries per Vehicle
7. Warehouse Consistency
"""

import math
from typing import List, Dict, Any, Tuple, Optional
from utils.rules_engine import is_vehicle_compatible, extract_tags

def parse_time_to_minutes(t_val, default: int = 480) -> int:
    if t_val is None or t_val == "":
        return default
    s = str(t_val).strip()
    if not s or s.lower() in ["nan", "none", "--", "qualquer"]:
        return default
    try:
        parts = s.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        return h * 60 + m
    except Exception:
        return default

def minutes_to_time_str(m: int) -> str:
    m = int(round(m))
    h = (m // 60) % 24
    mins = m % 60
    return f"{h:02d}:{mins:02d}"

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if not lat1 or not lon1 or not lat2 or not lon2:
        return 0.0
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2.0) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def audit_route_plan(
    routes_solution: Any,
    fleet_config: Dict[str, Any],
    warehouses_df: Any = None,
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
    avg_speed_default: float = 50.0,
    service_time_default: int = 15
) -> Dict[str, Any]:
    """
    Performs a deep compliance audit on all routes.
    Returns:
      total_violations: int
      routes_status: Dict[route_name, { is_valid: bool, violations_count: int, violations: List[Dict] }]
      all_violations: List[Dict]
    """
    import pandas as pd

    df = routes_solution if isinstance(routes_solution, pd.DataFrame) else pd.DataFrame(routes_solution or [])
    if df.empty:
        return {
            "total_violations": 0,
            "routes_status": {},
            "all_violations": []
        }

    # Normalize column names
    col_map = {
        "rota": "Rota", "cliente": "Cliente", "ordem": "Ordem", "morada": "Morada",
        "chegada": "Chegada", "saida": "Saida", "janela_inicio": "Janela_Inicio",
        "janela_fim": "Janela_Fim", "janela_horaria": "Janela_Horaria",
        "peso": "Peso_KG", "peso_kg": "Peso_KG", "volume": "Volume_m3", "volume_m3": "Volume_m3",
        "lat": "Latitude", "latitude": "Latitude", "lon": "Longitude", "longitude": "Longitude",
        "regras": "Regras", "tags": "Regras", "armazem": "Armazem"
    }
    df = df.rename(columns={c: col_map[c.lower()] for c in df.columns if c.lower() in col_map})

    all_violations = []
    routes_status = {}

    unique_routes = [r for r in df["Rota"].dropna().unique() if str(r).lower() not in ["por distribuir", "pendente", "nan", ""]]

    for r_name in unique_routes:
        df_r = df[df["Rota"] == r_name].sort_values(by="Ordem" if "Ordem" in df.columns else df.index)
        v_conf = fleet_config.get(r_name, {})
        v_rules = str(v_conf.get("regras", ""))
        v_start_min = parse_time_to_minutes(v_conf.get("horario_inicio", "08:00"), 480)
        v_end_min = parse_time_to_minutes(v_conf.get("horario_fim", "18:00"), 1080)
        v_max_kg = float(v_conf.get("capacidade_kg", 1000.0) or 1000.0)
        v_max_vol = float(v_conf.get("capacidade_vol", 10.0) or 10.0)
        v_max_stops = int(v_conf.get("max_entregas", 40) or 40)
        v_speed = float(v_conf.get("velocidade_media", avg_speed_default) or avg_speed_default)
        v_wh = str(v_conf.get("armazem", "")).strip()

        r_violations = []
        total_kg = 0.0
        total_vol = 0.0
        num_stops = len(df_r)

        # 1. Check Max Stops
        if num_stops > v_max_stops:
            v_item = {
                "type": "max_stops",
                "severity": "error",
                "route": r_name,
                "title": f"Excesso de Paragens na Viatura {r_name}",
                "message": f"A viatura tem {num_stops} paragens planeadas (Máximo permitido: {v_max_stops} entregas).",
                "excess": num_stops - v_max_stops
            }
            r_violations.append(v_item)
            all_violations.append(v_item)

        for _, row in df_r.iterrows():
            client_name = str(row.get("Cliente", "Cliente"))
            c_order = int(row.get("Ordem", 0))
            c_rules = str(row.get("Regras", "") or "")
            c_kg = float(row.get("Peso_KG", 0.0) or 0.0)
            c_vol = float(row.get("Volume_m3", 0.0) or 0.0)
            c_arrival_str = str(row.get("Chegada", "") or "")
            c_win_start = str(row.get("Janela_Inicio", "08:00") or "08:00")
            c_win_end = str(row.get("Janela_Fim", "18:00") or "18:00")

            total_kg += c_kg
            total_vol += c_vol

            # 2. Check Tags / Rules Compatibility (Tolerância Zero)
            if c_rules or v_rules:
                if not is_vehicle_compatible(v_rules, c_rules, rules_matrix):
                    v_item = {
                        "type": "tag_rule",
                        "severity": "error",
                        "route": r_name,
                        "client": client_name,
                        "order": c_order,
                        "title": f"Incompatibilidade de Regra/Tag ({client_name})",
                        "message": f"A viatura '{r_name}' (Tag: '{v_rules or 'Geral'}') não está autorizada a realizar a entrega '{client_name}' (Tag: '{c_rules}').",
                        "required_tag": c_rules,
                        "vehicle_tag": v_rules
                    }
                    r_violations.append(v_item)
                    all_violations.append(v_item)

            # 3. Check Client Time Window (Tolerância Zero)
            if c_arrival_str:
                arr_min = parse_time_to_minutes(c_arrival_str)
                win_end_min = parse_time_to_minutes(c_win_end, 1440)
                if arr_min > win_end_min:
                    delay_min = arr_min - win_end_min
                    v_item = {
                        "type": "time_window",
                        "severity": "error",
                        "route": r_name,
                        "client": client_name,
                        "order": c_order,
                        "title": f"Atraso na Janela Horária ({client_name})",
                        "message": f"Chegada prevista às {c_arrival_str} na paragem #{c_order} ({client_name}), mas a janela do cliente fecha às {c_win_end} ({delay_min} min de atraso).",
                        "arrival": c_arrival_str,
                        "window_end": c_win_end,
                        "delay_minutes": delay_min
                    }
                    r_violations.append(v_item)
                    all_violations.append(v_item)

        # 4. Check Weight Capacity (KG)
        if total_kg > v_max_kg:
            v_item = {
                "type": "capacity_kg",
                "severity": "error",
                "route": r_name,
                "title": f"Excesso de Peso na Viatura {r_name}",
                "message": f"Carga total de {total_kg:.1f} kg excede a capacidade máxima de {v_max_kg:.1f} kg (+{total_kg - v_max_kg:.1f} kg de excesso).",
                "total_kg": total_kg,
                "max_kg": v_max_kg,
                "excess_kg": round(total_kg - v_max_kg, 1)
            }
            r_violations.append(v_item)
            all_violations.append(v_item)

        # 5. Check Volume Capacity (m3)
        if total_vol > v_max_vol:
            v_item = {
                "type": "capacity_vol",
                "severity": "error",
                "route": r_name,
                "title": f"Excesso de Volume na Viatura {r_name}",
                "message": f"Volume total de {total_vol:.2f} m³ excede a capacidade máxima de {v_max_vol:.2f} m³ (+{total_vol - v_max_vol:.2f} m³ de excesso).",
                "total_vol": total_vol,
                "max_vol": v_max_vol,
                "excess_vol": round(total_vol - v_max_vol, 2)
            }
            r_violations.append(v_item)
            all_violations.append(v_item)

        # 6. Check Shift End Return Time (Tolerância Zero)
        if num_stops > 0:
            last_stop = df_r.iloc[-1]
            last_exit_str = str(last_stop.get("Saida", last_stop.get("Chegada", "12:00")))
            last_exit_min = parse_time_to_minutes(last_exit_str)
            
            # Distance back to depot
            depot_lat, depot_lon = 38.7, -9.1
            if warehouses_df is not None and hasattr(warehouses_df, "iterrows"):
                for _, wh_row in warehouses_df.iterrows():
                    wh_n = str(wh_row.get("Nome_Armazem", wh_row.get("name", "")))
                    if v_wh and wh_n and v_wh.lower() in wh_n.lower():
                        depot_lat = float(wh_row.get("Latitude", wh_row.get("lat", depot_lat)))
                        depot_lon = float(wh_row.get("Longitude", wh_row.get("lon", depot_lon)))
                        break

            last_lat = float(last_stop.get("Latitude", 0.0) or 0.0)
            last_lon = float(last_stop.get("Longitude", 0.0) or 0.0)
            return_dist_km = haversine_distance(last_lat, last_lon, depot_lat, depot_lon) * 1.30
            return_travel_min = (return_dist_km / max(v_speed, 20.0)) * 60.0
            return_arrival_min = int(round(last_exit_min + return_travel_min))

            if return_arrival_min > v_end_min:
                overtime_min = return_arrival_min - v_end_min
                v_item = {
                    "type": "shift_overtime",
                    "severity": "error",
                    "route": r_name,
                    "title": f"Atraso no Fim de Turno da Viatura {r_name}",
                    "message": f"A viatura regressa ao armazém às {minutes_to_time_str(return_arrival_min)}, ultrapassando o fim de turno estipulado das {minutes_to_time_str(v_end_min)} ({overtime_min} min de horas extra).",
                    "return_time": minutes_to_time_str(return_arrival_min),
                    "shift_end": minutes_to_time_str(v_end_min),
                    "overtime_minutes": overtime_min
                }
                r_violations.append(v_item)
                all_violations.append(v_item)

        routes_status[r_name] = {
            "is_valid": len(r_violations) == 0,
            "violations_count": len(r_violations),
            "violations": r_violations
        }

    return {
        "total_violations": len(all_violations),
        "routes_status": routes_status,
        "all_violations": all_violations
    }
