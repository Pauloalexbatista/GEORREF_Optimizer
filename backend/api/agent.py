from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import pandas as pd
from backend.api.auth import get_current_user, UserResponse
from backend.database import get_db, get_projeto
from utils.persistence_manager import serialize_state, deserialize_state
from utils.agent_decision_core import analyze_unassigned_and_violations
from utils.ai_rules_parser import parse_business_rules_with_llm

router = APIRouter(prefix="/agent", tags=["AI Copilot Agent"])

class ParseRulesRequest(BaseModel):
    rules_text: List[str]

class ExecuteDecisionRequest(BaseModel):
    project_id: int
    delivery_id: int
    target_vehicle: str
    action: str  # "reassign" | "keep_pending"

@router.post("/parse-rules")
def parse_rules(req: ParseRulesRequest, current_user: UserResponse = Depends(get_current_user)):
    """Traduz regras em linguagem natural para tags estruturadas."""
    return parse_business_rules_with_llm(req.rules_text)

@router.get("/diagnose/{project_id}")
def diagnose_routes(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    """Analisa o plano de rotas, explica 'Por Distribuir' e gera opcoes/perguntas ao operador."""
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Sem permissao para aceder a este projeto.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        if not row or not row["payload_json"]:
            return {"status": "no_data", "unassigned_count": 0, "proposals": []}

        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        if raw_routes is None:
            return {"status": "no_data", "unassigned_count": 0, "proposals": []}

        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)

        fleet_cfg = {}
        cursor.execute("SELECT * FROM frota WHERE projeto_id = ? AND is_active = 1", (project_id,))
        f_rows = cursor.fetchall()
        if f_rows:
            col_names = [d[0] for d in cursor.description]
            for row_f in f_rows:
                dict_f = dict(zip(col_names, row_f))
                v_name = str(dict_f["veiculo"])
                fleet_cfg[v_name] = {
                    "capacidade_kg": float(dict_f.get("capacidade_kg") or 1000.0),
                    "capacidade_volume": float(dict_f.get("capacidade_volume") or 10.0),
                    "custo_km": float(dict_f.get("custo_km") or 0.65),
                    "velocidade_media": float(dict_f.get("velocidade_media") or 50.0),
                    "horario_inicio": str(dict_f.get("horario_inicio") or "08:00"),
                    "horario_fim": str(dict_f.get("horario_fim") or "18:00"),
                    "armazem": str(dict_f.get("armazem") or ""),
                    "regras": str(dict_f.get("regras") or ""),
                    "max_entregas": int(dict_f.get("max_entregas") or 30)
                }

        if not fleet_cfg:
            fleet_cfg = state_dict.get("fleet_config_used") or state_dict.get("fleet_config", {})

        wh_df = state_dict.get("warehouses_used") or state_dict.get("warehouses_geocoded")
        rules_mat = state_dict.get("rules_matrix", [])

        diagnosis = analyze_unassigned_and_violations(df_routes, fleet_cfg, wh_df, rules_mat)
        return diagnosis
