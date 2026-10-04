from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import pandas as pd
from backend.api.auth import get_current_user, UserResponse
from backend.database import get_db, get_projeto, registar_consumo_google
from utils.persistence_manager import serialize_state, deserialize_state
from utils.agent_chat_engine import run_agent_chat_reasoning
from utils.ai_rules_parser import parse_business_rules_with_llm

router = APIRouter(prefix="/agent", tags=["AI Copilot Agent"])

class ChatMessageRequest(BaseModel):
    project_id: int
    message: str

class ParseRulesRequest(BaseModel):
    rules_text: List[str]

@router.post("/parse-rules")
def parse_rules(req: ParseRulesRequest, current_user: UserResponse = Depends(get_current_user)):
    return parse_business_rules_with_llm(req.rules_text)

@router.post("/chat")
def chat_with_agent(req: ChatMessageRequest, current_user: UserResponse = Depends(get_current_user)):
    """Conversa em tempo real com o Agente Co-Piloto de Trafego com visao completa do mapa."""
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Sem permissao para aceder a este projeto.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (req.project_id,))
        row = cursor.fetchone()
        if not row or not row["payload_json"]:
            return {
                "reply": "Não encontrei um plano calculado neste projeto. Calcule ou importe as rotas primeiro.",
                "outliers": [],
                "suggested_actions": []
            }

        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        if raw_routes is None:
            return {
                "reply": "O plano ainda não tem rotas geradas. Execute o planeamento primeiro.",
                "outliers": [],
                "suggested_actions": []
            }

        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)

        # Frota ativa
        fleet_cfg = {}
        cursor.execute("SELECT * FROM frota WHERE projeto_id = ? AND is_active = 1", (req.project_id,))
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

        wh_raw = state_dict.get("warehouses_used")
        if wh_raw is None or (isinstance(wh_raw, pd.DataFrame) and wh_raw.empty):
            wh_raw = state_dict.get("warehouses_geocoded")
        if wh_raw is None:
            wh_raw = []
        wh_list = wh_raw.to_dict(orient="records") if isinstance(wh_raw, pd.DataFrame) else (wh_raw if isinstance(wh_raw, list) else [])
        rules_mat = state_dict.get("rules_matrix", [])

        # Executar raciocinio conversacional com Gemini 3.8 Flash
        # Registar consumo de IA auditavel
        try:
            registar_consumo_google(
                empresa_id=current_user.empresa_id,
                projeto_id=req.project_id,
                servico="gemini_ai_copilot",
                num_pedidos=1,
                custo_estimado=0.0005 # Cerca de meio centesimo por interacao com Gemini Flash
            )
        except Exception as e_log:
            print(f"[Aviso] Falha ao registar consumo Gemini: {e_log}")

        response = run_agent_chat_reasoning(
            user_message=req.message,
            routes_solution=df_routes,
            fleet_config=fleet_cfg,
            warehouses_list=wh_list,
            rules_matrix=rules_mat
        )
        return response
