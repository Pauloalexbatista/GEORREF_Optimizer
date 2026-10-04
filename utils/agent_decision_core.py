import json
import math
from typing import List, Dict, Any, Optional
import pandas as pd
from utils.rules_engine import is_vehicle_compatible
from utils.validation_auditor import parse_time_window_str, parse_time_to_minutes

def analyze_unassigned_and_violations(
    routes_solution: Any,
    fleet_config: Dict[str, Any],
    warehouses_df: Any = None,
    rules_matrix: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Analisa rigorosamente o plano de rotas:
    1. Identifica por que motivo cada paragem ficou em 'Por Distribuir'.
    2. Procura solucoes potenciais com concessao minima (ex: estender turno X min, ou alocar a outra viatura).
    3. Formula perguntas/opcoes claras para o operador humano decidir, mantendo 'Por Distribuir' como opcao segura.
    """
    if isinstance(routes_solution, pd.DataFrame):
        df = routes_solution.copy()
    elif routes_solution:
        df = pd.DataFrame(routes_solution).copy()
    else:
        df = pd.DataFrame()

    if df.empty:
        return {"status": "no_data", "unassigned_count": 0, "proposals": []}

    col_map = {c.lower(): c for c in df.columns}
    def get_val(row, *candidates, default=None):
        for c in candidates:
            if c.lower() in col_map:
                v = row[col_map[c.lower()]]
                if pd.notna(v) and str(v).strip() != "":
                    return v
        return default

    # Separar entregas Por Distribuir vs Atribuidas
    rota_col = col_map.get("rota", "Rota")
    unassigned_mask = df[rota_col].astype(str).str.strip().str.lower().isin(["por distribuir", "pendente", "nan", "", "none"])
    unassigned_df = df[unassigned_mask].copy()
    assigned_df = df[~unassigned_mask].copy()

    # Resumo da ocupacao atual da frota
    fleet_usage = {}
    for v_name, v_info in fleet_config.items():
        v_stops = assigned_df[assigned_df[rota_col].astype(str).str.strip() == v_name]
        tot_kg = sum(float(get_val(r, "peso_kg", "peso", default=0.0)) for _, r in v_stops.iterrows())
        tot_vol = sum(float(get_val(r, "volume_m3", "volume", default=0.0)) for _, r in v_stops.iterrows())
        fleet_usage[v_name] = {
            "stops_count": len(v_stops),
            "max_stops": int(v_info.get("max_entregas", 30) or 30),
            "used_kg": tot_kg,
            "capacity_kg": float(v_info.get("capacidade_kg", v_info.get("capacity", 1000.0))),
            "used_vol": tot_vol,
            "capacity_volume": float(v_info.get("capacidade_volume", v_info.get("capacity_volume", 10.0))),
            "regras": str(v_info.get("regras", "") or ""),
            "horario_inicio": str(v_info.get("horario_inicio", v_info.get("start_time", "08:00"))),
            "horario_fim": str(v_info.get("horario_fim", v_info.get("end_time", "18:00"))),
        }

    proposals = []

    for idx, row in unassigned_df.iterrows():
        deliv_id = get_val(row, "id", "id_original", default=idx)
        client_name = str(get_val(row, "nome_cliente", "cliente", default=f"Cliente {deliv_id}"))
        morada = str(get_val(row, "morada", default=""))
        localidade = str(get_val(row, "localidade", default=""))
        peso = float(get_val(row, "peso_kg", "peso", default=0.0))
        vol = float(get_val(row, "volume_m3", "volume", default=0.1))
        d_regras = str(get_val(row, "regras", default=""))
        win_str = str(get_val(row, "janela_horaria", default="") or "")
        
        # Testar cada viatura para diagnosticar o impedimento real
        reasons = []
        candidate_vehicles = []

        for v_name, u in fleet_usage.items():
            compatible_rule = is_vehicle_compatible(u["regras"], d_regras, rules_matrix)
            has_weight = (u["used_kg"] + peso) <= u["capacity_kg"]
            has_vol = (u["used_vol"] + vol) <= u["capacity_volume"]
            has_stop_slot = (u["stops_count"] + 1) <= u["max_stops"]

            if not compatible_rule:
                reasons.append(f"Incompatibilidade de regras/tags com {v_name}")
            elif not has_weight:
                reasons.append(f"Capacidade de peso esgotada em {v_name} (excede {u['capacity_kg']} kg)")
            elif not has_vol:
                reasons.append(f"Capacidade de volume esgotada em {v_name}")
            elif not has_stop_slot:
                reasons.append(f"Limite maximo de entregas ({u['max_stops']}) atingido em {v_name}")
            else:
                # Caberia fisicamente e por regras! O impedimento foi janela horaria ou tempo de deslocacao
                candidate_vehicles.append({
                    "vehicle": v_name,
                    "remaining_kg": round(u["capacity_kg"] - u["used_kg"] - peso, 1),
                    "remaining_stops": u["max_stops"] - u["stops_count"] - 1
                })

        proposal_item = {
            "delivery_id": deliv_id,
            "client_name": client_name,
            "morada": f"{morada}, {localidade}".strip(", "),
            "peso_kg": peso,
            "volume_m3": vol,
            "candidate_vehicles": candidate_vehicles,
            "diagnostico": list(set(reasons)) if not candidate_vehicles else ["Nao coube nas janelas horarias ou percurso otimo atual."],
            "perguntas": []
        }

        # Formular perguntas claras para o operador humano
        if candidate_vehicles:
            for cv in candidate_vehicles:
                v = cv["vehicle"]
                proposal_item["perguntas"].append({
                    "tipo": "reatribuir_com_reotimizacao",
                    "texto": f"Tentar encaixar na rota de '{v}' (tem {cv['remaining_kg']} kg livres)?",
                    "target_vehicle": v,
                    "acao": "reassign"
                })
        
        # Opcao sempre presente e segura: manter em Por Distribuir
        proposal_item["perguntas"].append({
            "tipo": "manter_pendente",
            "texto": "Manter em 'Por Distribuir' para proxima distribuicao / reagendamento.",
            "acao": "keep_pending"
        })

        proposals.append(proposal_item)

    return {
        "status": "success",
        "unassigned_count": len(unassigned_df),
        "total_assigned": len(assigned_df),
        "proposals": proposals
    }
