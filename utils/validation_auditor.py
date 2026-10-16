"""
Validation & Quality Auditor Module ?" GEORREF Optimizer
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
from utils.rules_engine import is_vehicle_compatible, extract_tags, explain_incompatibility
from utils.operation_types import calculate_dynamic_route_loads, normalize_op_type

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

def parse_time_window_str(w_str: str) -> Tuple[int, int]:
    if not w_str or str(w_str).strip().lower() in ["qualquer", "nan", "none", "--", ""]:
        return 0, 1440
    s = str(w_str).strip()
    separators = [" - ", " às ", " as ", " a ", "-", "/"]
    for sep in separators:
        if sep in s:
            parts = s.split(sep, 1)
            p0 = parts[0].strip()
            p1 = parts[1].strip()
            s_min = parse_time_to_minutes(p0, 0)
            e_min = parse_time_to_minutes(p1, 1440)
            if s_min is not None and e_min is not None:
                return s_min, e_min
    return 0, 1440

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
    service_time_default: int = 10
) -> Dict[str, Any]:
    """
    Performs a deep compliance audit on all routes.
    """
    import pandas as pd
    import numpy as np

    def _safe_scalar(val, default=None):
        if isinstance(val, (pd.Series, np.ndarray, list)):
            for item in val:
                if item is not None and not pd.isna(item) and item != "":
                    return item
            return default
        if val is None or pd.isna(val) or val == "":
            return default
        return val

    if isinstance(routes_solution, pd.DataFrame):
        df = routes_solution.copy()
    elif routes_solution:
        df = pd.DataFrame(routes_solution)
    else:
        df = pd.DataFrame()

    if df.empty:
        return {
            "total_violations": 0,
            "routes_status": {},
            "all_violations": []
        }

    # Assegurar que não há colunas duplicadas
    df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()

    # Normalize column names evitando criar colunas duplicadas se já existir o target canónico
    col_map = {
        "rota": "Rota", "cliente": "Cliente", "ordem": "Ordem", "morada": "Morada",
        "chegada": "Chegada", "saida": "Saida", "janela_inicio": "Janela_Inicio",
        "janela_fim": "Janela_Fim", "janela_horaria": "Janela_Horaria",
        "peso": "Peso_KG", "peso_kg": "Peso_KG", "volume": "Volume_m3", "volume_m3": "Volume_m3",
        "lat": "Latitude", "latitude": "Latitude", "lon": "Longitude", "longitude": "Longitude",
        "regras": "Regras", "tags": "Regras", "armazem": "Armazem", "tempo_entrega": "Tempo_Entrega"
    }
    rename_dict = {}
    for c in df.columns:
        c_low = c.lower()
        if c_low in col_map:
            target = col_map[c_low]
            if target != c and target in df.columns:
                continue
            rename_dict[c] = target
    df = df.rename(columns=rename_dict)
    # Deduplicação final obrigatória
    df = df.loc[:, ~df.columns.duplicated(keep="first")].copy()

    all_violations = []
    routes_status = {}

    unique_routes = [r for r in df["Rota"].dropna().unique() if str(r).lower() not in ["por distribuir", "pendente", "nan", ""]]

    # Build warehouse lookup
    wh_coords = {}
    if warehouses_df is not None:
        if isinstance(warehouses_df, pd.DataFrame) and not warehouses_df.empty:
            for idx, wrow in warehouses_df.iterrows():
                w_name = str(wrow.get("Nome_Armazem", wrow.get("Nome", f"Armazem_{idx}"))).strip().lower()
                wh_coords[w_name] = (float(wrow["Latitude"]), float(wrow["Longitude"]))
                # Also store default
                if "default" not in wh_coords:
                    wh_coords["default"] = (float(wrow["Latitude"]), float(wrow["Longitude"]))

    for r_name in unique_routes:
        df_r = df[df["Rota"] == r_name]
        if "Ordem" in df_r.columns:
            df_r = df_r.sort_values(by="Ordem")
            
        v_conf = {}
        if isinstance(fleet_config, dict):
            raw_v = fleet_config.get(r_name, {})
            if hasattr(raw_v, "dict") and callable(raw_v.dict):
                v_conf = raw_v.dict()
            elif hasattr(raw_v, "__dict__") and not isinstance(raw_v, dict):
                v_conf = raw_v.__dict__
            elif isinstance(raw_v, dict):
                v_conf = raw_v
            else:
                v_conf = {}
        elif isinstance(fleet_config, pd.DataFrame) and not fleet_config.empty:
            v_col = "Veiculo" if "Veiculo" in fleet_config.columns else "veiculo" if "veiculo" in fleet_config.columns else None
            if v_col:
                match = fleet_config[fleet_config[v_col].astype(str).str.strip() == str(r_name).strip()]
                if not match.empty:
                    v_conf = match.iloc[0].to_dict()

        v_rules = str(v_conf.get("regras", v_conf.get("Regras", "")))
        v_start_min = parse_time_to_minutes(v_conf.get("horario_inicio", v_conf.get("start_time", "06:30")), 390)
        v_end_min = parse_time_to_minutes(v_conf.get("horario_fim", v_conf.get("end_time", "18:00")), 1080)
        v_max_kg = float(v_conf.get("capacidade_kg", v_conf.get("capacity", 20000.0)) or 20000.0)
        v_max_vol = float(v_conf.get("capacidade_volume", v_conf.get("capacidade_vol", v_conf.get("capacity_volume", 20000.0))) or 20000.0)
        v_max_stops = int(v_conf.get("max_entregas", 40) or 40)
        v_speed = float(v_conf.get("velocidade_media", v_conf.get("speed", avg_speed_default)) or avg_speed_default)
        v_wh = str(v_conf.get("armazem", v_conf.get("warehouse", ""))).strip()

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
            client_name = str(_safe_scalar(row.get("Cliente", row.get("Nome_Cliente", "Cliente")), "Cliente"))
            c_order = int(_safe_scalar(row.get("Ordem", 0), 0))
            c_rules = str(_safe_scalar(row.get("Regras", ""), ""))
            c_kg = float(_safe_scalar(row.get("Peso_KG", 0.0), 0.0))
            c_vol = float(_safe_scalar(row.get("Volume_m3", 0.0), 0.0))
            c_arrival_str = str(_safe_scalar(row.get("Chegada", ""), ""))

            # Parse Time Window with full robustness
            jh_str = str(row.get("Janela_Horaria", "") or "").strip()
            win_start_min, win_end_min = 0, 1440
            if jh_str and jh_str.lower() not in ["qualquer", "nan", "none", ""]:
                win_start_min, win_end_min = parse_time_window_str(jh_str)
            else:
                c_win_start = str(row.get("Janela_Inicio", row.get("Slot1_Inicio", "")) or "")
                c_win_end = str(row.get("Janela_Fim", row.get("Slot1_Fim", "")) or "")
                if c_win_start and c_win_end:
                    win_start_min = parse_time_to_minutes(c_win_start, 0)
                    win_end_min = parse_time_to_minutes(c_win_end, 1440)

            total_kg += c_kg
            total_vol += c_vol

            # 2. Check Tags / Rules & Postal Code Compatibility
            c_cp = str(_safe_scalar(row.get("CP", row.get("Codigo_Postal", "")), "") or "")
            if rules_matrix or v_rules or c_rules or c_cp:
                if not is_vehicle_compatible(v_rules, c_rules, rules_matrix, delivery_cp=c_cp, vehicle_name=r_name):
                    explanation = explain_incompatibility(v_rules, c_rules, rules_matrix, delivery_cp=c_cp, vehicle_name=r_name)
                    v_item = {
                        "type": "tag_rule",
                        "severity": "error",
                        "route": r_name,
                        "client": client_name,
                        "order": c_order,
                        "title": f"Incompatibilidade de Regra/Zona ({client_name})",
                        "message": explanation or f"A viatura '{r_name}' não está autorizada a realizar a entrega '{client_name}' (CP: {c_cp}).",
                        "required_tag": c_rules,
                        "vehicle_tag": v_rules,
                        "cp": c_cp
                    }
                    r_violations.append(v_item)
                    all_violations.append(v_item)

            # 3. Check Client Time Window (Tolerância Zero)
            if c_arrival_str and c_arrival_str not in ["--:--", "00:00", ""]:
                arr_min = parse_time_to_minutes(c_arrival_str)
                if win_end_min < 1440 and arr_min > (win_end_min + 1):
                    delay_min = arr_min - win_end_min
                    v_item = {
                        "type": "time_window",
                        "severity": "error",
                        "route": r_name,
                        "client": client_name,
                        "order": c_order,
                        "title": f"Atraso na Janela Horária ({client_name})",
                        "message": f"Chegada prevista às {c_arrival_str} na paragem #{c_order} ({client_name}), mas a janela fecha às {minutes_to_time_str(win_end_min)} ({delay_min} min de atraso).",
                        "arrival": c_arrival_str,
                        "window_end": minutes_to_time_str(win_end_min),
                        "delay_minutes": delay_min
                    }
                    r_violations.append(v_item)
                    all_violations.append(v_item)

        # 4 & 5. Check Dynamic Vehicle Loads (Curva de Carga a Bordo KG e Volume m3)
        stops_records = df_r.to_dict(orient="records")
        dyn_load = calculate_dynamic_route_loads(stops_records, vehicle_cap_kg=v_max_kg, vehicle_cap_vol=v_max_vol)
        peak_kg = dyn_load.get("peak_load_kg", total_kg)
        peak_vol = dyn_load.get("peak_load_vol", total_vol)

        # 4. Check Weight Capacity (KG a Bordo)
        if dyn_load.get("has_kg_overload", peak_kg > v_max_kg):
            v_item = {
                "type": "capacity_kg",
                "severity": "error",
                "route": r_name,
                "title": f"Excesso de Peso a Bordo na Viatura {r_name}",
                "message": f"Pico de carga a bordo de {peak_kg:.1f} kg excede a capacidade máxima de {v_max_kg:.1f} kg (+{peak_kg - v_max_kg:.1f} kg de excesso).",
                "total_kg": peak_kg,
                "max_kg": v_max_kg,
                "excess_kg": round(peak_kg - v_max_kg, 1)
            }
            r_violations.append(v_item)
            all_violations.append(v_item)

        # 5. Check Volume Capacity (m3 a Bordo)
        if dyn_load.get("has_vol_overload", peak_vol > v_max_vol):
            v_item = {
                "type": "capacity_vol",
                "severity": "error",
                "route": r_name,
                "title": f"Excesso de Volume a Bordo na Viatura {r_name}",
                "message": f"Pico de volume a bordo de {peak_vol:.2f} m³ excede a capacidade máxima de {v_max_vol:.2f} m³ (+{peak_vol - v_max_vol:.2f} m³ de excesso).",
                "total_vol": peak_vol,
                "max_vol": v_max_vol,
                "excess_vol": round(peak_vol - v_max_vol, 2)
            }
            r_violations.append(v_item)
            all_violations.append(v_item)

        # 6. Check Shift Return Time to Depot
        if not df_r.empty:
            last_stop = df_r.iloc[-1]
            last_exit_str = str(_safe_scalar(last_stop.get("Saida", ""), ""))
            last_exit_min = parse_time_to_minutes(last_exit_str, 0)
            
            # Find depot coordinates
            depot_coords = wh_coords.get(v_wh.lower()) if v_wh else None
            if not depot_coords and "default" in wh_coords:
                depot_coords = wh_coords["default"]
                
            if depot_coords and last_exit_min > 0:
                depot_lat, depot_lon = depot_coords
                last_lat = float(_safe_scalar(last_stop.get("Latitude", 0.0), 0.0))
                last_lon = float(_safe_scalar(last_stop.get("Longitude", 0.0), 0.0))
                return_dist_km = haversine_distance(last_lat, last_lon, depot_lat, depot_lon) * 1.30
                ret_speed = 80.0 if return_dist_km > 25.0 else 65.0 if return_dist_km > 10.0 else max(v_speed, 45.0)
                return_travel_min = (return_dist_km / ret_speed) * 60.0
                return_arrival_min = int(round(last_exit_min + return_travel_min))

                # Tolerância de 1 min de precisão numérica
                if return_arrival_min > (v_end_min + 1):
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

    # 7. Check Pickup & Delivery Pairs (From ➔ To) Integrity & Precedence
    from_stops = {}
    to_stops = {}
    for _, row in df.iterrows():
        op = normalize_op_type(row.get("Tipo_Operacao") or row.get("tipo_operacao"))
        p_id = str(row.get("Par_ID") or row.get("par_id") or row.get("Doc_ID") or row.get("doc_id") or "").strip()
        if not p_id:
            continue
        if op == "From":
            from_stops[p_id] = row
        elif op == "To":
            to_stops[p_id] = row

    for p_id, f_row in from_stops.items():
        if p_id in to_stops:
            t_row = to_stops[p_id]
            f_route = str(f_row.get("Rota", ""))
            t_route = str(t_row.get("Rota", ""))
            f_cli = str(f_row.get("Cliente") or f_row.get("Nome_Cliente") or "Loja")
            t_cli = str(t_row.get("Cliente") or t_row.get("Nome_Cliente") or "Cliente")

            is_f_pending = f_route.lower() in ["por distribuir", "pendente", "nan", ""]
            is_t_pending = t_route.lower() in ["por distribuir", "pendente", "nan", ""]

            if is_f_pending != is_t_pending or (not is_f_pending and f_route != t_route):
                v_item = {
                    "type": "pickup_delivery_pair",
                    "severity": "error",
                    "route": f_route if not is_f_pending else t_route,
                    "title": f"Par Casado em Viaturas Diferentes (ID: {p_id})",
                    "message": f"O levantamento na loja '{f_cli}' está na rota '{f_route}', mas a entrega ao cliente '{t_cli}' está na rota '{t_route}'. Devem ser executados pela mesma viatura.",
                    "par_id": p_id
                }
                all_violations.append(v_item)
                if f_route in routes_status:
                    routes_status[f_route]["violations"].append(v_item)
                    routes_status[f_route]["violations_count"] += 1
                    routes_status[f_route]["is_valid"] = False
                if t_route in routes_status and t_route != f_route:
                    routes_status[t_route]["violations"].append(v_item)
                    routes_status[t_route]["violations_count"] += 1
                    routes_status[t_route]["is_valid"] = False
            elif not is_f_pending:
                # Same active vehicle: verify precedence Ordem(From) < Ordem(To)
                f_ord = int(_safe_scalar(f_row.get("Ordem", 0), 0))
                t_ord = int(_safe_scalar(t_row.get("Ordem", 0), 0))
                if f_ord >= t_ord and f_ord > 0 and t_ord > 0:
                    v_item = {
                        "type": "pickup_delivery_pair",
                        "severity": "error",
                        "route": f_route,
                        "title": f"Precedência Invertida no Par Casado (ID: {p_id})",
                        "message": f"Na rota '{f_route}', a entrega ao cliente '{t_cli}' (#{t_ord}) está agendada antes do levantamento na loja '{f_cli}' (#{f_ord}).",
                        "par_id": p_id,
                        "from_order": f_ord,
                        "to_order": t_ord
                    }
                    all_violations.append(v_item)
                    if f_route in routes_status:
                        routes_status[f_route]["violations"].append(v_item)
                        routes_status[f_route]["violations_count"] += 1
                        routes_status[f_route]["is_valid"] = False

    return {
        "total_violations": len(all_violations),
        "routes_status": routes_status,
        "all_violations": all_violations
    }
