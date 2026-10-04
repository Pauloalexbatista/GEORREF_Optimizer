import os
import json
import requests
from typing import List, Dict, Any, Optional
import pandas as pd
from utils.agent_spatial_insights import detect_geographic_outliers, analyze_unassigned_clustering
from utils.validation_auditor import audit_route_plan


def extract_distribution_metrics(df_routes: pd.DataFrame) -> Dict[str, Any]:
    manha = 0
    tarde = 0
    dia_todo = 0
    sem_janela = 0
    peso_total = 0.0
    vol_total = 0.0

    if df_routes.empty:
        return {}

    for _, row in df_routes.iterrows():
        s_val = str(row.get("Janela_Inicio") or row.get("janela_inicio") or row.get("Slot1_Inicio") or "").strip()
        e_val = str(row.get("Janela_Fim") or row.get("janela_fim") or row.get("Slot1_Fim") or "").strip()
        win_str = str(row.get("Janela_Horaria") or row.get("janela_horaria") or "").strip()
        
        peso = float(row.get("Peso_KG") or row.get("peso_kg") or row.get("Peso") or 0.0)
        vol = float(row.get("Volume_m3") or row.get("volume_m3") or row.get("Volume") or 0.0)
        peso_total += peso
        vol_total += vol

        if (not s_val and not e_val) and (not win_str or win_str.lower() in ["qualquer", "nan", "none", ""]):
            sem_janela += 1
            continue

        end_hour = 18
        start_hour = 8
        if e_val and ":" in e_val:
            try: end_hour = int(e_val.split(":")[0])
            except: pass
        elif "-" in win_str:
            try: end_hour = int(win_str.split("-")[1].split(":")[0])
            except: pass

        if s_val and ":" in s_val:
            try: start_hour = int(s_val.split(":")[0])
            except: pass

        if end_hour <= 13:
            manha += 1
        elif start_hour >= 13:
            tarde += 1
        else:
            dia_todo += 1

    return {
        "entregas_janela_manha_ate_13h": manha,
        "entregas_janela_tarde_pos_13h": tarde,
        "entregas_janela_alargada_dia_todo": dia_todo,
        "entregas_sem_janela_horaria": sem_janela,
        "peso_total_distribuicao_kg": round(peso_total, 1),
        "volume_total_distribuicao_m3": round(vol_total, 2)
    }

def run_agent_chat_reasoning(
    user_message: str,
    routes_solution: Any,
    fleet_config: Dict[str, Any],
    warehouses_list: List[Dict[str, Any]],
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Motor conversacional do Agente Co-Piloto de Trafego.
    Cruza o estado real das rotas, deteta anomalias geograficas e responde
    de forma estrategica e operacional usando o Gemini 3.8 Flash.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

    # 1. Analises analiticas locais
    if isinstance(routes_solution, pd.DataFrame):
        df_routes = routes_solution
    elif routes_solution:
        df_routes = pd.DataFrame(routes_solution)
    else:
        df_routes = pd.DataFrame()

    deliveries_records = df_routes.to_dict(orient="records") if not df_routes.empty else []
    
    outliers = detect_geographic_outliers(deliveries_records, warehouses_list)
    clustering = analyze_unassigned_clustering(df_routes, warehouses_list)

    total_stops = len(df_routes)
    unassigned_count = clustering.get("total_unassigned", 0)
    assigned_count = total_stops - unassigned_count

    active_vehicles = list(fleet_config.keys()) if fleet_config else []
    dist_metrics = extract_distribution_metrics(df_routes)

    context_summary = {
        "total_entregas": total_stops,
        "entregas_atribuidas": assigned_count,
        "entregas_por_distribuir": unassigned_count,
        "viaturas_ativas": len(active_vehicles),
        "estatisticas_gerais_distribuicao": dist_metrics,
        "pontos_geograficamente_suspeitos_outliers": outliers,
        "por_distribuir_perto_armazem_menos_15km": clustering.get("near_depot_count", 0),
        "por_distribuir_longe_armazem": clustering.get("far_depot_count", 0),
        "amostra_outliers": outliers[:3],
        "amostra_por_distribuir": clustering.get("far_depot", [])[:4]
    }

    # 2. Prompt estrategico para o Gemini
    system_prompt = f"""
Voce e o Co-Piloto Inteligente de Trafego e Logistica do sistema GeoRoutePlan.
Voce conversa diretamente com o gestor de trafego (Paulo) para ajuda-lo a tomar decisoes de roteamento.

ESTADO ATUAL DA DISTRIBUICAO:
{json.dumps(context_summary, ensure_ascii=False, indent=2)}

DIRETRIZES FUNDAMENTAIS DO TEU PAPEL:
1. NUNCA respondas com listas mecanicas de 15 botoes sem contexto.
2. Analisa o mapa de forma holistica:
   - Se houver pontos suspeitos a centenas de km (outliers), alerta imediatamente para possivel erro de geocodificacao / codigo postal trocado (ex: entrega de Lisboa que caiu no Norte de Portugal).
   - Se o gestor pedir para deixar as entregas perto do armazem em 'Por Distribuir' para resolver amanha, confirma a estrategia e indica quantos km/horas poupariamos.
   - Podes sugerir simulacoes realistas como: aumentar os turnos em 10% (ex: +45min), ativar mais 1 viatura, ou reajustar clusters de zonas no mesmo carro.
3. Fala em Portugues claro, profissional, direto e conciso, como um despachante de trafego experiente.
4. Sugere ate 3 'acoes_sugeridas' (botoes rapidos) para o gestor poder executar diretamente.
"""

    if not key:
        # Fallback offline inteligente se nao houver chave API
        fallback_msg = f"Detectei {unassigned_count} entregas em 'Por Distribuir'."
        if outliers:
            fallback_msg += f"\n\n⚠️ **Alerta Geográfico:** Encontrei {len(outliers)} paragens com localização suspeita a grande distância do armazém principal (ex: {outliers[0]['cliente']} a {outliers[0]['dist_km_armazem']} km). Verifique se o Código Postal não tem gralha."
        if clustering.get("near_depot_count", 0) > 0:
            fallback_msg += f"\n\n📍 Das entregas por atribuir, {clustering['near_depot_count']} estão a menos de 15 km do armazém, o que facilita a resolução com uma rota local amanhã."

        return {
            "reply": fallback_msg,
            "outliers": outliers,
            "clustering": clustering,
            "suggested_actions": [
                {"label": "🔍 Inspecionar Pontos Suspeitos", "action": "inspect_outliers"},
                {"label": "⏱️ Simular +10% de Turno", "action": "simulate_plus_10_percent"},
                {"label": "🏠 Priorizar Perto do Armazém", "action": "filter_near_depot"}
            ]
        }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={key}"
    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{system_prompt}\n\nMensagem do Gestor de Tráfego: {user_message}"}]}
        ],
        "generationConfig": {
            "temperature": 0.2
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=20.0)
        if resp.status_code == 200:
            data = resp.json()
            reply_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            
            # Gerar acoes sugeridas contextuais
            actions = []
            if outliers:
                actions.append({"label": f"⚠️ Ver {len(outliers)} Pontos Suspeitos", "action": "inspect_outliers"})
            actions.append({"label": "⏱️ Simular +10% Horário nos Carros", "action": "simulate_plus_10_percent"})
            actions.append({"label": "📍 Deixar Perto do Armazém", "action": "filter_near_depot"})

            return {
                "reply": reply_text,
                "outliers": outliers,
                "clustering": clustering,
                "suggested_actions": actions
            }
        else:
            return {
                "reply": f"Ocorreu uma falha na chamada à IA (Código {resp.status_code}). Mas verifiquei que existem {len(outliers)} pontos com coordenadas suspeitas e {unassigned_count} entregas pendentes.",
                "outliers": outliers,
                "clustering": clustering,
                "suggested_actions": []
            }
    except Exception as e:
        return {
            "reply": f"Erro de comunicação com o assistente: {str(e)}",
            "outliers": outliers,
            "clustering": clustering,
            "suggested_actions": []
        }
