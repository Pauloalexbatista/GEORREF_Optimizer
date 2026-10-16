"""
Núcleo de Decisão Tática do Copiloto IA (Custo Zero Determinístico)
===================================================================
Fornece 4 motores analíticos onde o utilizador decide individualmente o que aplicar (Opt-In):
1. Auditor de Causa-Raiz & Negociador de Janelas (para entregas em 'Por Distribuir')
2. Cirurgião de Fronteiras (Trocas / Doações entre rotas vizinhas que poupam KM)
3. Consolidador de Frota (Eliminação de viaturas subocupadas)
4. Detetive de Notas Ocultas (Extração de horários e tags [2MAN], [FRIO], [ACESSO_RESTRITO] das observações)
"""

from typing import List, Dict, Any, Optional, Tuple
import pandas as pd
from utils.rules_engine import is_vehicle_compatible, explain_incompatibility
from utils.validation_auditor import parse_time_window_str, parse_time_to_minutes, minutes_to_time_str, haversine_distance
from utils.optimization_solver import get_segment_speed
from utils.operation_types import normalize_op_type
from utils.ai_rules_parser import scan_delivery_notes_for_hidden_rules


def _get_depot_coords_for_vehicle(v_wh: str, warehouses_df: Any) -> Tuple[float, float]:
    default_lat, default_lon = 38.7223, -9.1393
    if warehouses_df is None:
        return default_lat, default_lon
    wh_records = (
        warehouses_df.to_dict(orient="records")
        if isinstance(warehouses_df, pd.DataFrame)
        else (warehouses_df if isinstance(warehouses_df, list) else [])
    )
    if not wh_records:
        return default_lat, default_lon

    for w in wh_records:
        w_name = str(w.get("Nome_Armazem") or w.get("Nome_Armazém") or w.get("name") or w.get("armazem") or "").strip()
        lat = float(w.get("Latitude") or w.get("latitude") or 0.0)
        lon = float(w.get("Longitude") or w.get("longitude") or 0.0)
        if lat != 0.0 and lon != 0.0:
            if not v_wh or w_name.lower() == v_wh.lower() or v_wh.lower() in w_name.lower():
                return lat, lon

    first = wh_records[0]
    lat = float(first.get("Latitude") or first.get("latitude") or default_lat)
    lon = float(first.get("Longitude") or first.get("longitude") or default_lon)
    return (lat if lat != 0.0 else default_lat, lon if lon != 0.0 else default_lon)


def _extract_stop_window(row_dict: Dict[str, Any]) -> Tuple[int, int]:
    s_raw = str(row_dict.get("Janela_Inicio") or row_dict.get("Slot1_Inicio") or row_dict.get("janela_inicio") or "").strip()
    e_raw = str(row_dict.get("Janela_Fim") or row_dict.get("Slot1_Fim") or row_dict.get("janela_fim") or "").strip()
    if s_raw and e_raw and s_raw.lower() not in ["nan", "none"] and e_raw.lower() not in ["nan", "none"]:
        return parse_time_to_minutes(s_raw, 0), parse_time_to_minutes(e_raw, 1440)
    win_str = str(row_dict.get("Janela_Horaria") or row_dict.get("janela_horaria") or "").strip()
    return parse_time_window_str(win_str)


def _simulate_insertion_in_route(
    cand_stop: Dict[str, Any],
    route_stops: List[Dict[str, Any]],
    depot_lat: float,
    depot_lon: float,
    v_start_min: int,
    v_end_min: int,
    v_speed: float,
    return_to_depot: bool = True,
) -> Dict[str, Any]:
    """
    Simula a inserção de `cand_stop` em todas as posições possíveis (0..N) da rota
    e devolve a posição com menor custo/violação, incluindo:
    - delta_km: acréscimo de quilómetros reais (x1.30)
    - cand_arrival_min: hora de chegada prevista ao cliente inserido
    - tw_violation_min: minutos de atraso face à janela horária (máximo da rota)
    - shift_overtime_min: minutos de excesso face ao fim de turno da viatura
    """
    cand_lat = float(cand_stop.get("Latitude") or cand_stop.get("latitude") or 0.0)
    cand_lon = float(cand_stop.get("Longitude") or cand_stop.get("longitude") or 0.0)
    if cand_lat == 0.0 or cand_lon == 0.0:
        return {
            "best_pos": len(route_stops),
            "delta_km": 0.0,
            "cand_arrival_min": v_start_min,
            "tw_violation_min": 0,
            "shift_overtime_min": 0,
        }

    # Calcular KM originais da rota
    orig_km = 0.0
    prev_lat, prev_lon = depot_lat, depot_lon
    for s in route_stops:
        slat = float(s.get("Latitude") or s.get("latitude") or prev_lat)
        slon = float(s.get("Longitude") or s.get("longitude") or prev_lon)
        orig_km += haversine_distance(prev_lat, prev_lon, slat, slon) * 1.30
        prev_lat, prev_lon = slat, slon
    if route_stops and return_to_depot:
        orig_km += haversine_distance(prev_lat, prev_lon, depot_lat, depot_lon) * 1.30

    best_eval = None
    best_score = float("inf")

    for pos in range(len(route_stops) + 1):
        trial = route_stops[:pos] + [cand_stop] + route_stops[pos:]
        curr_min = float(v_start_min)
        curr_lat, curr_lon = depot_lat, depot_lon
        total_km = 0.0
        max_tw_late = 0
        cand_arr = v_start_min

        for idx_s, s in enumerate(trial):
            slat = float(s.get("Latitude") or s.get("latitude") or curr_lat)
            slon = float(s.get("Longitude") or s.get("longitude") or curr_lon)
            seg_km = haversine_distance(curr_lat, curr_lon, slat, slon) * 1.30
            total_km += seg_km
            spd = get_segment_speed(seg_km, v_speed)
            curr_min += (seg_km / spd) * 60.0

            ws, we = _extract_stop_window(s)
            if curr_min < ws:
                curr_min = float(ws)
            if idx_s == pos:
                cand_arr = int(round(curr_min))
            if curr_min > we:
                late = int(round(curr_min - we))
                if late > max_tw_late:
                    max_tw_late = late

            serv = float(s.get("Tempo_Entrega") or s.get("tempo_descarga_min") or 10.0)
            curr_min += serv
            curr_lat, curr_lon = slat, slon

        if return_to_depot:
            ret_km = haversine_distance(curr_lat, curr_lon, depot_lat, depot_lon) * 1.30
            total_km += ret_km
            spd_ret = get_segment_speed(ret_km, v_speed)
            curr_min += (ret_km / spd_ret) * 60.0

        overtime = max(0, int(round(curr_min - v_end_min)))
        delta_km = round(max(0.0, total_km - orig_km), 1)

        # Penalizar violações de janela e fim de turno, mas guardar a melhor opção
        score = delta_km + (max_tw_late * 5.0) + (overtime * 4.0)
        if score < best_score:
            best_score = score
            best_eval = {
                "best_pos": pos + 1,
                "delta_km": delta_km,
                "cand_arrival_min": cand_arr,
                "tw_violation_min": max_tw_late,
                "shift_overtime_min": overtime,
            }

    return best_eval or {
        "best_pos": 1,
        "delta_km": 0.0,
        "cand_arrival_min": v_start_min,
        "tw_violation_min": 0,
        "shift_overtime_min": 0,
    }


def analyze_unassigned_and_violations(
    routes_solution: Any,
    fleet_config: Dict[str, Any],
    warehouses_df: Any = None,
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Executa a auditoria completa do Copiloto IA (100% Opt-In pelo utilizador):
    1. `proposals`: Diagnóstico de Causa-Raiz e Negociador de Janelas para 'Por Distribuir'.
    2. `border_swaps`: Cirurgião de Fronteiras (trocas entre rotas vizinhas que poupam KM).
    3. `fleet_consolidations`: Poupança de Frota (absorção de viaturas subocupadas).
    4. `hidden_notes`: Detetive de Notas Ocultas nas Observações das entregas.
    """
    if isinstance(routes_solution, pd.DataFrame):
        df = routes_solution.copy()
    elif routes_solution:
        df = pd.DataFrame(routes_solution).copy()
    else:
        df = pd.DataFrame()

    if df.empty:
        return {
            "status": "no_data",
            "unassigned_count": 0,
            "total_assigned": 0,
            "proposals": [],
            "border_swaps": [],
            "fleet_consolidations": [],
            "hidden_notes": [],
        }

    col_map = {c.lower(): c for c in df.columns}

    def get_val(row, *candidates, default=None):
        for c in candidates:
            if c.lower() in col_map:
                v = row[col_map[c.lower()]]
                if pd.notna(v) and str(v).strip() != "":
                    return v
        return default

    rota_col = col_map.get("rota", "Rota")
    unassigned_mask = (
        df[rota_col]
        .astype(str)
        .str.strip()
        .str.lower()
        .isin(["por distribuir", "pendente", "nan", "", "none", "não atribuído", "nao atribuido"])
    )
    unassigned_df = df[unassigned_mask].copy()
    assigned_df = df[~unassigned_mask].copy()

    # Organizar paragens atuais por viatura
    route_stops_map: Dict[str, List[Dict[str, Any]]] = {}
    fleet_usage: Dict[str, Dict[str, Any]] = {}

    for v_name, v_info in fleet_config.items():
        v_df = assigned_df[assigned_df[rota_col].astype(str).str.strip() == v_name].copy()
        if not v_df.empty and "Ordem" in v_df.columns:
            v_df = v_df.sort_values(by="Ordem")
        stops_list = v_df.to_dict(orient="records")
        route_stops_map[v_name] = stops_list

        # Calcular carga Outbound (D) e Inbound (P) separadamente
        out_kg = sum(
            float(get_val(r, "peso_kg", "peso", default=0.0))
            for _, r in v_df.iterrows()
            if normalize_op_type(get_val(r, "tipo_operacao", default="D")) in ("D", "From")
        )
        in_kg = sum(
            float(get_val(r, "peso_kg", "peso", default=0.0))
            for _, r in v_df.iterrows()
            if normalize_op_type(get_val(r, "tipo_operacao", default="D")) in ("P", "From")
        )
        tot_kg = max(out_kg, in_kg)
        tot_vol = sum(
            float(get_val(r, "volume_m3", "volume", default=0.0))
            for _, r in v_df.iterrows()
            if normalize_op_type(get_val(r, "tipo_operacao", default="D")) != "To"
        )

        v_wh = str(v_info.get("armazem") or v_info.get("warehouse") or "").strip()
        d_lat, d_lon = _get_depot_coords_for_vehicle(v_wh, warehouses_df)
        reg_str = str(v_info.get("regresso_armazem", "Sim")).strip().lower()
        ret_depot = reg_str not in ["não", "nao", "false", "0", "no"]

        fleet_usage[v_name] = {
            "stops_count": len(stops_list),
            "max_stops": int(v_info.get("max_entregas", 30) or 30),
            "used_kg": round(tot_kg, 1),
            "capacity_kg": float(v_info.get("capacidade_kg", v_info.get("capacity", 1000.0)) or 1000.0),
            "used_vol": round(tot_vol, 2),
            "capacity_volume": float(v_info.get("capacidade_volume", v_info.get("capacity_volume", 10.0)) or 10.0),
            "regras": str(v_info.get("regras", "") or ""),
            "start_min": parse_time_to_minutes(v_info.get("horario_inicio") or v_info.get("start_time", "08:00"), 480),
            "end_min": parse_time_to_minutes(v_info.get("horario_fim") or v_info.get("end_time", "18:00"), 1080),
            "speed": float(v_info.get("velocidade_media") or v_info.get("speed") or 50.0),
            "cost_km": float(v_info.get("custo_km") or v_info.get("cost_per_km") or 0.65),
            "depot_lat": d_lat,
            "depot_lon": d_lon,
            "return_to_depot": ret_depot,
        }

    # ==========================================================================
    # 1. AUDITOR DE CAUSA-RAIZ & NEGOCIADOR DE JANELAS ('Por Distribuir')
    # ==========================================================================
    proposals = []
    for idx, row in unassigned_df.iterrows():
        row_dict = row.to_dict()
        deliv_id = get_val(row, "id", "id_original", default=idx)
        client_name = str(get_val(row, "nome_cliente", "cliente", default=f"Cliente {deliv_id}"))
        morada = str(get_val(row, "morada", default=""))
        localidade = str(get_val(row, "localidade", default=""))
        cp = str(get_val(row, "cp", "codigo_postal", default=""))
        peso = float(get_val(row, "peso_kg", "peso", default=0.0))
        vol = float(get_val(row, "volume_m3", "volume", default=0.1))
        d_regras = str(get_val(row, "regras", default=""))
        op_type = normalize_op_type(get_val(row, "tipo_operacao", default="D"))
        par_id = str(get_val(row, "par_id", default="") or "")
        ws, we = _extract_stop_window(row_dict)
        win_label = f"{minutes_to_time_str(ws)} - {minutes_to_time_str(we)}" if (ws > 0 or we < 1440) else "Qualquer"

        reasons = []
        candidate_options = []

        for v_name, u in fleet_usage.items():
            compatible_rule = is_vehicle_compatible(u["regras"], d_regras, rules_matrix, delivery_cp=cp, vehicle_name=v_name)
            if not compatible_rule:
                reason_txt = explain_incompatibility(u["regras"], d_regras, rules_matrix, delivery_cp=cp, vehicle_name=v_name) or f"Incompatibilidade de regras/CP com '{v_name}'"
                reasons.append(reason_txt)
                continue

            has_weight = (u["used_kg"] + peso) <= u["capacity_kg"]
            has_vol = (u["used_vol"] + vol) <= u["capacity_volume"]
            has_stop_slot = (u["stops_count"] + 1) <= u["max_stops"]

            if not has_weight:
                reasons.append(f"Peso insuficiente em '{v_name}' (Faltam {round(u['used_kg'] + peso - u['capacity_kg'], 1)} kg)")
                continue
            if not has_vol:
                reasons.append(f"Volume insuficiente em '{v_name}' (Excede {u['capacity_volume']} m³)")
                continue
            if not has_stop_slot:
                reasons.append(f"Limite de paragens ({u['max_stops']}) atingido em '{v_name}'")
                continue

            # Simular inserção real na rota de v_name
            sim = _simulate_insertion_in_route(
                cand_stop=row_dict,
                route_stops=route_stops_map.get(v_name, []),
                depot_lat=u["depot_lat"],
                depot_lon=u["depot_lon"],
                v_start_min=u["start_min"],
                v_end_min=u["end_min"],
                v_speed=u["speed"],
                return_to_depot=u["return_to_depot"],
            )

            candidate_options.append({
                "vehicle": v_name,
                "remaining_kg": round(u["capacity_kg"] - u["used_kg"] - peso, 1),
                "delta_km": sim["delta_km"],
                "arrival_str": minutes_to_time_str(sim["cand_arrival_min"]),
                "tw_violation_min": sim["tw_violation_min"],
                "shift_overtime_min": sim["shift_overtime_min"],
                "best_pos": sim["best_pos"],
            })

        # Ordenar opções pela menor violação de horário e menor acréscimo de KM
        candidate_options.sort(key=lambda x: (x["tw_violation_min"] * 3 + x["shift_overtime_min"] * 2 + x["delta_km"]))

        diagnostico_final = []
        if candidate_options:
            best_c = candidate_options[0]
            if best_c["tw_violation_min"] > 0:
                diagnostico_final.append(
                    f"Conflito de Janela Horária ({win_label}): a viatura mais próxima ('{best_c['vehicle']}') chegaria às {best_c['arrival_str']} (+{best_c['tw_violation_min']} min após o fecho)."
                )
            elif best_c["shift_overtime_min"] > 0:
                diagnostico_final.append(
                    f"Fim de Turno: encaixar em '{best_c['vehicle']}' prolonga o regresso ao armazém em +{best_c['shift_overtime_min']} min."
                )
            else:
                diagnostico_final.append(
                    f"Viável fisicamente em '{best_c['vehicle']}' (+{best_c['delta_km']} km, chegada prevista às {best_c['arrival_str']})."
                )
        else:
            diagnostico_final = list(dict.fromkeys(reasons))[:4] or ["Sem viatura compatível com capacidade disponível."]

        perguntas = []
        for cv in candidate_options[:3]:
            v = cv["vehicle"]
            if cv["tw_violation_min"] == 0 and cv["shift_overtime_min"] == 0:
                label_txt = f"⚡ Encaixar em '{v}' na {cv['best_pos']}ª pos. (Chega {cv['arrival_str']}, +{cv['delta_km']} km)"
            elif cv["tw_violation_min"] > 0:
                label_txt = f"🤝 Negociar +{cv['tw_violation_min']} min na janela e encaixar em '{v}' (Chega {cv['arrival_str']}, +{cv['delta_km']} km)"
            else:
                label_txt = f"⏱️ Estender turno +{cv['shift_overtime_min']} min e encaixar em '{v}' (+{cv['delta_km']} km)"

            perguntas.append({
                "tipo": "reatribuir_com_reotimizacao",
                "texto": label_txt,
                "target_vehicle": v,
                "acao": "reassign",
                "delta_km": cv["delta_km"],
                "tw_violation_min": cv["tw_violation_min"],
            })

        perguntas.append({
            "tipo": "manter_pendente",
            "texto": "Manter em 'Por Distribuir' (Não aplicar alteração)",
            "acao": "keep_pending",
        })

        proposals.append({
            "delivery_id": deliv_id,
            "client_name": client_name,
            "morada": f"{morada}, {cp} {localidade}".strip(", "),
            "janela_horaria": win_label,
            "tipo_operacao": op_type,
            "par_id": par_id,
            "peso_kg": peso,
            "volume_m3": vol,
            "candidate_vehicles": candidate_options[:3],
            "diagnostico": diagnostico_final,
            "perguntas": perguntas,
        })

    # ==========================================================================
    # 2. CIRURGIÃO DE FRONTEIRAS (Border Swaps / Doações entre Rotas Vizinhas)
    # ==========================================================================
    border_swaps = []
    active_routes = [r for r, stops in route_stops_map.items() if len(stops) >= 2]

    for src_route in active_routes:
        src_stops = route_stops_map[src_route]
        src_u = fleet_usage[src_route]

        for idx_s, stop in enumerate(src_stops):
            op_t = normalize_op_type(stop.get("Tipo_Operacao") or stop.get("tipo_operacao") or "D")
            # Evitar mover metade de um par From/To isoladamente no swap simples
            if op_t in ("From", "To"):
                continue

            s_lat = float(stop.get("Latitude") or stop.get("latitude") or 0.0)
            s_lon = float(stop.get("Longitude") or stop.get("longitude") or 0.0)
            if s_lat == 0.0 or s_lon == 0.0:
                continue

            # Calcular quantos KM se poupam ao retirar `stop` de `src_route`
            prev_lat = src_u["depot_lat"] if idx_s == 0 else float(src_stops[idx_s - 1].get("Latitude") or src_u["depot_lat"])
            prev_lon = src_u["depot_lon"] if idx_s == 0 else float(src_stops[idx_s - 1].get("Longitude") or src_u["depot_lon"])
            if idx_s == len(src_stops) - 1:
                next_lat = src_u["depot_lat"] if src_u["return_to_depot"] else prev_lat
                next_lon = src_u["depot_lon"] if src_u["return_to_depot"] else prev_lon
            else:
                next_lat = float(src_stops[idx_s + 1].get("Latitude") or prev_lat)
                next_lon = float(src_stops[idx_s + 1].get("Longitude") or prev_lon)

            km_with = (haversine_distance(prev_lat, prev_lon, s_lat, s_lon) + haversine_distance(s_lat, s_lon, next_lat, next_lon)) * 1.30
            km_without = haversine_distance(prev_lat, prev_lon, next_lat, next_lon) * 1.30 if (idx_s < len(src_stops) - 1 or src_u["return_to_depot"]) else 0.0
            saved_in_src_km = max(0.0, km_with - km_without)

            if saved_in_src_km < 2.5:
                continue

            s_peso = float(stop.get("Peso_KG") or stop.get("peso_kg") or 0.0)
            s_vol = float(stop.get("Volume_m3") or stop.get("volume_m3") or 0.0)
            s_rules = str(stop.get("Regras") or stop.get("regras") or "")
            s_cp = str(stop.get("CP") or stop.get("codigo_postal") or "")
            deliv_id = stop.get("id") or stop.get("ID_Original")
            c_name = str(stop.get("Nome_Cliente") or stop.get("Cliente") or f"Entrega #{deliv_id}")

            for tgt_route in active_routes:
                if tgt_route == src_route:
                    continue
                tgt_u = fleet_usage[tgt_route]
                if (tgt_u["used_kg"] + s_peso) > tgt_u["capacity_kg"]:
                    continue
                if (tgt_u["used_vol"] + s_vol) > tgt_u["capacity_volume"]:
                    continue
                if (tgt_u["stops_count"] + 1) > tgt_u["max_stops"]:
                    continue
                if not is_vehicle_compatible(tgt_u["regras"], s_rules, rules_matrix, delivery_cp=s_cp):
                    continue

                sim_tgt = _simulate_insertion_in_route(
                    cand_stop=stop,
                    route_stops=route_stops_map[tgt_route],
                    depot_lat=tgt_u["depot_lat"],
                    depot_lon=tgt_u["depot_lon"],
                    v_start_min=tgt_u["start_min"],
                    v_end_min=tgt_u["end_min"],
                    v_speed=tgt_u["speed"],
                    return_to_depot=tgt_u["return_to_depot"],
                )

                if sim_tgt["tw_violation_min"] == 0 and sim_tgt["shift_overtime_min"] == 0:
                    net_saved_km = round(saved_in_src_km - sim_tgt["delta_km"], 1)
                    if net_saved_km >= 2.0:
                        saved_eur = round((saved_in_src_km * src_u["cost_km"]) - (sim_tgt["delta_km"] * tgt_u["cost_km"]), 2)
                        border_swaps.append({
                            "delivery_id": deliv_id,
                            "client_name": c_name,
                            "cp": s_cp,
                            "localidade": str(stop.get("Localidade") or ""),
                            "from_route": src_route,
                            "to_route": tgt_route,
                            "best_pos": sim_tgt["best_pos"],
                            "arrival_str": minutes_to_time_str(sim_tgt["cand_arrival_min"]),
                            "saved_km": net_saved_km,
                            "saved_eur": max(0.5, saved_eur),
                            "reason": f"Passa muito mais perto de '{tgt_route}' (retira {round(saved_in_src_km, 1)} km a '{src_route}' e acrescenta apenas {sim_tgt['delta_km']} km a '{tgt_route}').",
                        })

    border_swaps.sort(key=lambda x: x["saved_km"], reverse=True)
    # Evitar duplicados da mesma entrega
    seen_swap_ids = set()
    unique_swaps = []
    for sw in border_swaps:
        if sw["delivery_id"] not in seen_swap_ids:
            seen_swap_ids.add(sw["delivery_id"])
            unique_swaps.append(sw)

    # ==========================================================================
    # 3. CONSOLIDADOR DE FROTA (Absorção de Viaturas Subocupadas <= 3 paragens)
    # ==========================================================================
    fleet_consolidations = []
    for donor_route, donor_stops in route_stops_map.items():
        if not (1 <= len(donor_stops) <= 3):
            continue
        donor_u = fleet_usage[donor_route]
        assignments = []
        possible = True

        for d_stop in donor_stops:
            d_peso = float(d_stop.get("Peso_KG") or d_stop.get("peso_kg") or 0.0)
            d_vol = float(d_stop.get("Volume_m3") or d_stop.get("volume_m3") or 0.0)
            d_rules = str(d_stop.get("Regras") or d_stop.get("regras") or "")
            d_cp = str(d_stop.get("CP") or d_stop.get("codigo_postal") or "")
            deliv_id = d_stop.get("id") or d_stop.get("ID_Original")
            c_name = str(d_stop.get("Nome_Cliente") or d_stop.get("Cliente") or f"#{deliv_id}")

            best_receiver = None
            for rec_route, rec_stops in route_stops_map.items():
                if rec_route == donor_route or len(rec_stops) == 0:
                    continue
                rec_u = fleet_usage[rec_route]
                if (rec_u["used_kg"] + d_peso) > rec_u["capacity_kg"]:
                    continue
                if (rec_u["used_vol"] + d_vol) > rec_u["capacity_volume"]:
                    continue
                if (rec_u["stops_count"] + 1) > rec_u["max_stops"]:
                    continue
                if not is_vehicle_compatible(rec_u["regras"], d_rules, rules_matrix, delivery_cp=d_cp, vehicle_name=rec_route):
                    continue

                sim_r = _simulate_insertion_in_route(
                    cand_stop=d_stop,
                    route_stops=rec_stops,
                    depot_lat=rec_u["depot_lat"],
                    depot_lon=rec_u["depot_lon"],
                    v_start_min=rec_u["start_min"],
                    v_end_min=rec_u["end_min"],
                    v_speed=rec_u["speed"],
                    return_to_depot=rec_u["return_to_depot"],
                )
                if sim_r["tw_violation_min"] <= 15 and sim_r["shift_overtime_min"] <= 15:
                    if best_receiver is None or sim_r["delta_km"] < best_receiver["delta_km"]:
                        best_receiver = {
                            "delivery_id": deliv_id,
                            "client_name": c_name,
                            "target_vehicle": rec_route,
                            "delta_km": sim_r["delta_km"],
                            "tw_violation_min": sim_r["tw_violation_min"],
                        }

            if best_receiver:
                assignments.append(best_receiver)
            else:
                possible = False
                break

        if possible and assignments:
            max_tw_tol = max(a["tw_violation_min"] for a in assignments)
            fleet_consolidations.append({
                "donor_vehicle": donor_route,
                "stops_count": len(donor_stops),
                "requires_tw_tolerance_min": max_tw_tol,
                "assignments": assignments,
                "summary": (
                    f"A viatura '{donor_route}' tem apenas {len(donor_stops)} paragem(ns). "
                    f"Pode ser eliminada distribuindo as suas entregas por {', '.join(sorted({a['target_vehicle'] for a in assignments}))}"
                    + (f" (com tolerância de +{max_tw_tol} min)." if max_tw_tol > 0 else " (100% dentro das janelas horárias!).")
                ),
            })

    # ==========================================================================
    # 4. DETETIVE DE NOTAS OCULTAS (Observações -> Janelas / Tags)
    # ==========================================================================
    hidden_notes = scan_delivery_notes_for_hidden_rules(df.to_dict(orient="records"))

    return {
        "status": "success",
        "unassigned_count": len(unassigned_df),
        "total_assigned": len(assigned_df),
        "proposals": proposals,
        "border_swaps": unique_swaps[:10],
        "fleet_consolidations": fleet_consolidations,
        "hidden_notes": hidden_notes,
    }
