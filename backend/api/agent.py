import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Dict, Any, Optional
from pydantic import BaseModel
import pandas as pd
from backend.api.auth import get_current_user, UserResponse
from backend.database import get_db, get_projeto, registar_consumo_google
from utils.persistence_manager import serialize_state, deserialize_state
from utils.agent_chat_engine import run_agent_chat_reasoning
from utils.agent_decision_core import analyze_unassigned_and_violations
from utils.ai_rules_parser import parse_business_rules_with_llm

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass


def sanitize_for_json(obj):
    import math
    if isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [sanitize_for_json(v) for v in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return 0.0
        return obj
    return obj


router = APIRouter(prefix="/agent", tags=["AI Copilot Agent"])


class ChatMessageRequest(BaseModel):
    project_id: int
    message: str


class ParseRulesRequest(BaseModel):
    rules_text: List[str]


class ApplyNoteSuggestionRequest(BaseModel):
    project_id: int
    delivery_id: int
    proposed_win_start: Optional[str] = None
    proposed_win_end: Optional[str] = None
    new_rules_combined: Optional[str] = None


class AddCanonicalRuleRequest(BaseModel):
    project_id: int
    Tag_Veiculo: str
    Permissao: str
    Tag_Entrega: str
    Descricao: Optional[str] = ""


def _load_project_routes_and_fleet(project_id: int, cursor) -> tuple:
    cursor.execute(
        "SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1",
        (project_id,),
    )
    row = cursor.fetchone()
    if not row or not row["payload_json"]:
        return {}, pd.DataFrame(), {}, [], []

    state_dict = deserialize_state(row["payload_json"])
    raw_routes = state_dict.get("routes_solution")
    if raw_routes is None:
        raw_routes = state_dict.get("clients_geocoded") or state_dict.get("clients_used")
    df_routes = (
        raw_routes.copy()
        if isinstance(raw_routes, pd.DataFrame)
        else (pd.DataFrame(raw_routes) if raw_routes else pd.DataFrame())
    )

    if not df_routes.empty:
        if "Latitude" in df_routes.columns:
            df_routes["Latitude"] = pd.to_numeric(df_routes["Latitude"], errors="coerce").fillna(0.0).astype(float)
        else:
            df_routes["Latitude"] = 0.0

        if "Longitude" in df_routes.columns:
            df_routes["Longitude"] = pd.to_numeric(df_routes["Longitude"], errors="coerce").fillna(0.0).astype(float)
        else:
            df_routes["Longitude"] = 0.0

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
                "max_entregas": int(dict_f.get("max_entregas") or 30),
                "regresso_armazem": str(dict_f.get("regresso_armazem") or "Sim"),
            }

    if not fleet_cfg:
        raw_fleet = state_dict.get("fleet_config_used") or state_dict.get("fleet_config", {})
        if isinstance(raw_fleet, dict):
            fleet_cfg = raw_fleet
        elif isinstance(raw_fleet, pd.DataFrame) and not raw_fleet.empty:
            for _, rf in raw_fleet.iterrows():
                vn = str(rf.get("Veiculo") or rf.get("veiculo") or "Viatura")
                fleet_cfg[vn] = rf.to_dict()

    wh_raw = state_dict.get("warehouses_used")
    if wh_raw is None or (isinstance(wh_raw, pd.DataFrame) and wh_raw.empty):
        wh_raw = state_dict.get("warehouses_geocoded")
    if wh_raw is None:
        wh_raw = []

    wh_list = (
        wh_raw.to_dict(orient="records")
        if isinstance(wh_raw, pd.DataFrame)
        else (wh_raw if isinstance(wh_raw, list) else [])
    )
    rules_mat = state_dict.get("rules_matrix", [])
    return state_dict, df_routes, fleet_cfg, wh_list, rules_mat


@router.get("/diagnose/{project_id}")
def diagnose_project_routes(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    """
    Executa os 4 motores táticos do Copiloto IA sem alterar nenhum dado:
    - Auditor de Causa-Raiz & Negociador de Janelas ('proposals')
    - Cirurgião de Fronteiras / Swaps entre rotas vizinhas ('border_swaps')
    - Consolidador de Frota ('fleet_consolidations')
    - Detetive de Notas Ocultas ('hidden_notes')
    O utilizador decide individualmente o que quer aplicar.
    """
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")

    with get_db() as conn:
        cursor = conn.cursor()
        _, df_routes, fleet_cfg, wh_list, rules_mat = _load_project_routes_and_fleet(project_id, cursor)
        if df_routes.empty:
            return {
                "status": "no_data",
                "unassigned_count": 0,
                "total_assigned": 0,
                "proposals": [],
                "border_swaps": [],
                "fleet_consolidations": [],
                "hidden_notes": [],
            }

        res = analyze_unassigned_and_violations(
            routes_solution=df_routes,
            fleet_config=fleet_cfg,
            warehouses_df=wh_list,
            rules_matrix=rules_mat,
        )
        return sanitize_for_json(res)


@router.post("/parse-rules")
def parse_rules(req: ParseRulesRequest, current_user: UserResponse = Depends(get_current_user)):
    return parse_business_rules_with_llm(req.rules_text)


@router.post("/apply-note-suggestion")
def apply_note_suggestion(req: ApplyNoteSuggestionRequest, current_user: UserResponse = Depends(get_current_user)):
    """
    Aplica (a pedido explícito do utilizador) a janela horária ou tag extraída das Observações
    a uma entrega específica no snapshot e na tabela 'entregas'.
    """
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")

    with get_db() as conn:
        cursor = conn.cursor()
        state_dict, df_routes, _, _, _ = _load_project_routes_and_fleet(req.project_id, cursor)
        if df_routes.empty:
            raise HTTPException(status_code=400, detail="Projeto sem entregas carregadas.")

        matched_mask = pd.Series(False, index=df_routes.index)
        for col_id in ["id", "ID_Original"]:
            if col_id in df_routes.columns:
                matched_mask = matched_mask | (pd.to_numeric(df_routes[col_id], errors="coerce") == req.delivery_id)

        if not matched_mask.any():
            raise HTTPException(status_code=404, detail=f"Entrega #{req.delivery_id} não encontrada.")

        if req.proposed_win_start and req.proposed_win_end:
            win_str = f"{req.proposed_win_start} - {req.proposed_win_end}"
            df_routes.loc[matched_mask, "Janela_Inicio"] = req.proposed_win_start
            df_routes.loc[matched_mask, "Janela_Fim"] = req.proposed_win_end
            df_routes.loc[matched_mask, "Janela_Horaria"] = win_str
            if "Slot1_Inicio" in df_routes.columns:
                df_routes.loc[matched_mask, "Slot1_Inicio"] = req.proposed_win_start
            if "Slot1_Fim" in df_routes.columns:
                df_routes.loc[matched_mask, "Slot1_Fim"] = req.proposed_win_end

        if req.new_rules_combined is not None:
            df_routes.loc[matched_mask, "Regras"] = req.new_rules_combined

        # Atualizar também clients_geocoded / clients_used para caso o utilizador rode o Solver a seguir
        for df_key in ["routes_solution", "routes_df", "clients_geocoded", "clients_used"]:
            sub_df = state_dict.get(df_key)
            if isinstance(sub_df, pd.DataFrame) and not sub_df.empty:
                m_sub = pd.Series(False, index=sub_df.index)
                for col_id in ["id", "ID_Original"]:
                    if col_id in sub_df.columns:
                        m_sub = m_sub | (pd.to_numeric(sub_df[col_id], errors="coerce") == req.delivery_id)
                if m_sub.any():
                    if req.proposed_win_start and req.proposed_win_end:
                        sub_df.loc[m_sub, "Janela_Inicio"] = req.proposed_win_start
                        sub_df.loc[m_sub, "Janela_Fim"] = req.proposed_win_end
                        sub_df.loc[m_sub, "Janela_Horaria"] = f"{req.proposed_win_start} - {req.proposed_win_end}"
                        if "Slot1_Inicio" in sub_df.columns:
                            sub_df.loc[m_sub, "Slot1_Inicio"] = req.proposed_win_start
                        if "Slot1_Fim" in sub_df.columns:
                            sub_df.loc[m_sub, "Slot1_Fim"] = req.proposed_win_end
                    if req.new_rules_combined is not None:
                        sub_df.loc[m_sub, "Regras"] = req.new_rules_combined
                    state_dict[df_key] = sub_df

        state_dict["routes_solution"] = df_routes
        payload = serialize_state(state_dict)
        snap_name = f"IA: Regra/Janela Aplicada #{req.delivery_id} ({datetime.now().strftime('%H:%M:%S')})"
        cursor.execute(
            "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
            (req.project_id, current_user.id, 3, snap_name, payload),
        )
        if req.proposed_win_start and req.proposed_win_end:
            cursor.execute(
                "UPDATE entregas SET janela_inicio = ?, janela_fim = ? WHERE projeto_id = ? AND id = ?",
                (req.proposed_win_start, req.proposed_win_end, req.project_id, req.delivery_id),
            )
        if req.new_rules_combined is not None:
            cursor.execute(
                "UPDATE entregas SET regras = ? WHERE projeto_id = ? AND id = ?",
                (req.new_rules_combined, req.project_id, req.delivery_id),
            )
        conn.commit()

        return sanitize_for_json({"status": "success", "routes": df_routes.to_dict(orient="records")})


@router.post("/add-rule")
def add_canonical_rule(req: AddCanonicalRuleRequest, current_user: UserResponse = Depends(get_current_user)):
    """
    Adiciona uma regra canónica (traduzida pela IA e aprovada pelo utilizador) à Folha 4 (rules_matrix).
    """
    proj = get_projeto(req.project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")

    with get_db() as conn:
        cursor = conn.cursor()
        state_dict, _, _, _, rules_mat = _load_project_routes_and_fleet(req.project_id, cursor)
        if not isinstance(rules_mat, list):
            rules_mat = []

        new_rule = {
            "Tag_Veiculo": req.Tag_Veiculo.strip(),
            "Permissao": req.Permissao.strip().upper(),
            "Tag_Entrega": req.Tag_Entrega.strip(),
            "Descricao": (req.Descricao or "").strip(),
        }
        rules_mat.append(new_rule)
        state_dict["rules_matrix"] = rules_mat

        payload = serialize_state(state_dict)
        snap_name = f"IA: Nova Regra Folha 4 ({new_rule['Tag_Veiculo']} -> {new_rule['Tag_Entrega']})"
        cursor.execute(
            "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
            (req.project_id, current_user.id, 3, snap_name, payload),
        )
        conn.commit()
        return {"status": "success", "rule": new_rule, "total_rules": len(rules_mat)}


@router.post("/chat")
def chat_with_agent(req: ChatMessageRequest, current_user: UserResponse = Depends(get_current_user)):
    try:
        proj = get_projeto(req.project_id)
        if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
            raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")

        with get_db() as conn:
            cursor = conn.cursor()
            _, df_routes, fleet_cfg, wh_list, rules_mat = _load_project_routes_and_fleet(req.project_id, cursor)
            if df_routes.empty:
                return {
                    "reply": "Não encontrei um plano calculado neste projeto. Calcule ou importe as rotas primeiro.",
                    "outliers": [],
                    "suggested_actions": [],
                }

            try:
                registar_consumo_google(
                    empresa_id=current_user.empresa_id,
                    projeto_id=req.project_id,
                    servico="gemini_ai_copilot",
                    num_pedidos=1,
                    custo_estimado=0.0005,
                )
            except Exception as e_log:
                print(f"[Aviso] Falha ao registar consumo: {e_log}")

            response = run_agent_chat_reasoning(
                user_message=req.message,
                routes_solution=df_routes,
                fleet_config=fleet_cfg,
                warehouses_list=wh_list,
                rules_matrix=rules_mat,
            )
            return sanitize_for_json(response)
    except HTTPException as he:
        raise he
    except Exception as e_unhandled:
        print(f"[Erro chat_with_agent]: {e_unhandled}")
        return {
            "reply": f"⚠️ Não foi possível analisar os dados deste projeto: {str(e_unhandled)}",
            "outliers": [],
            "suggested_actions": [],
        }
