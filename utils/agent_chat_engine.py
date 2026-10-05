import os
import json
import re
import requests
from typing import List, Dict, Any, Optional
import pandas as pd
from utils.agent_spatial_insights import detect_geographic_outliers, analyze_unassigned_clustering
from utils.validation_auditor import audit_route_plan

# Modelos recomendados em ordem de velocidade e confiabilidade comprovada
CANDIDATE_MODELS = [
    "gemini-3.1-flash-lite",
    "gemini-flash-latest",
    "gemini-3.8-flash"
]

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
        
        try:
            peso = float(row.get("Peso_KG") or row.get("peso_kg") or row.get("Peso") or 0.0)
        except Exception:
            peso = 0.0
            
        try:
            vol = float(row.get("Volume_m3") or row.get("volume_m3") or row.get("Volume") or 0.0)
        except Exception:
            vol = 0.0
            
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

def generate_local_analytical_reply(
    user_msg_lower: str,
    total_stops: int,
    assigned_count: int,
    unassigned_count: int,
    active_vehicles: List[str],
    dist_metrics: Dict[str, Any],
    outliers: List[Dict[str, Any]],
    clustering: Dict[str, Any]
) -> str:
    """Gera uma resposta altamente profissional de imediato baseada nas métricas do plano."""
    # 1. Pergunta sobre slots / manhã e tarde
    if any(k in user_msg_lower for k in ["manhã", "manha", "tarde", "slot", "horári", "horari", "janela"]):
        m = dist_metrics.get("entregas_janela_manha_ate_13h", 0)
        t = dist_metrics.get("entregas_janela_tarde_pos_13h", 0)
        d = dist_metrics.get("entregas_janela_alargada_dia_todo", 0)
        s = dist_metrics.get("entregas_sem_janela_horaria", 0)
        peso = dist_metrics.get("peso_total_distribuicao_kg", 0)
        vol = dist_metrics.get("volume_total_distribuicao_m3", 0)
        return (
            f"📊 **Análise de Janelas Horárias e Cargas:**\n"
            f"- 🌅 **Manhã (até às 13h):** {m} entregas com restrição matinal rigorosa.\n"
            f"- 🌇 **Tarde (após as 13h):** {t} entregas com restrição vespertina.\n"
            f"- ⏱️ **Dia todo / Alargada:** {d} entregas.\n"
            f"- 🔓 **Sem restrição horária:** {s} entregas flexíveis.\n\n"
            f"📦 **Carga Total:** {peso:,.1f} kg distribuídos em {vol:,.2f} m³ entre {len(active_vehicles)} viaturas ativas."
        )

    # 2. Pergunta sobre pontos suspeitos, norte, georreferenciação, fora do mapa
    if any(k in user_msg_lower for k in ["suspeit", "norte", "fora", "georreferenciad", "bola laranja", "errad", "longe", "outlier", "galiza"]):
        if not outliers:
            return "✅ **Auditoria Geográfica:** Não detetei nenhuma paragem com coordenadas isoladas ou fora de zona neste plano. Todos os pontos situam-se dentro do raio operacional habitual."
        
        reply = f"🚨 **Alerta Geográfico: Encontrei {len(outliers)} pontos suspeitos fora de zona:**\n\n"
        for o in outliers[:4]:
            reply += (
                f"- **{o['cliente']}** ({o['localidade']} - CP {o['cp']}):\n"
                f"  📍 A **{o['dist_km_armazem']} km** do armazém (Rota atual: `{o.get('rota_atual', 'N/A')}`).\n"
                f"  ⚠️ *Motivo:* {o['motivo_suspeita']}\n\n"
            )
        reply += "💡 **Recomendação:** Verifique se o Código Postal está correto na BD ou se estes clientes devem ser transferidos para uma distribuição regional específica."
        return reply

    # 3. Pergunta sobre pendentes / por distribuir / perto do armazém / amanhã
    if any(k in user_msg_lower for k in ["perto", "armazém", "armazem", "amanhã", "amanha", "pendente", "por distribuir", "de fora", "fora"]):
        near = clustering.get("near_depot_count", 0)
        far = clustering.get("far_depot_count", 0)
        reply = (
            f"📍 **Distribuição de Entregas Pendentes ({unassigned_count} no total):**\n"
            f"- 🟢 **Perto do armazém (< 15 km):** {near} entregas. É uma excelente estratégia deixá-las para amanhã, pois podem ser despachadas numa volta rápida matinal sem onerar a frota hoje.\n"
            f"- 🔴 **Afastadas (> 15 km):** {far} entregas requerem rota dedicada ou ajuste de turno.\n"
        )
        if clustering.get("near_depot"):
            reply += "\n*Exemplo de clientes próximos para amanhã:*\n"
            for c in clustering["near_depot"][:3]:
                reply += f"- {c['cliente']} ({c['dist_km_armazem']} km - {c['peso_kg']} kg)\n"
        return reply

    # 4. Resposta de acolhimento / visão geral
    reply = (
        f"📋 **Diagnóstico Geral da Operação:**\n"
        f"- **Total de Entregas:** {total_stops} clientes ({assigned_count} atribuídos, {unassigned_count} pendentes).\n"
        f"- **Frota Ativa:** {len(active_vehicles)} viaturas em rota.\n"
    )
    if outliers:
        reply += f"\n⚠️ **Atenção:** Existem **{len(outliers)} paragens com localização suspeita** (ex: {outliers[0]['cliente']} a {outliers[0]['dist_km_armazem']} km). Deseja inspecioná-las?"
    if unassigned_count > 0:
        reply += f"\n💡 Das {unassigned_count} pendentes, {clustering.get('near_depot_count', 0)} estão a menos de 15 km da base e podem ficar para amanhã com impacto nulo na rota."
    return reply

def run_agent_chat_reasoning(
    user_message: str,
    routes_solution: Any,
    fleet_config: Dict[str, Any],
    warehouses_list: List[Dict[str, Any]],
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Motor conversacional do Agente Co-Piloto de Tráfego.
    Cruza estado real, coordenadas enriquecidas e executa em cascata rápida.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

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

    # Detetar se o utilizador pediu diretamente uma reatribuição via texto
    # Exemplo: "Passa o cliente X para a carrinha Y"
    # Detetar se o utilizador pediu diretamente uma reatribui??o ou a??o operacional via texto
    action_commands = []
    reassign_match = re.search(r'(?:passa|muda|move|atribui|troca|retira|tira|coloca)\s+(?:o\s+)?(?:cliente\s+)?([^\s,]+(?: [^\s,]+)?)\s+(?:para|p\/)\s+(?:a\s+)?(?:carrinha|viatura|carro|rota|pendente|por distribuir)?\s*([^\s,\.]+)', user_message, re.IGNORECASE)
    if reassign_match:
        client_target = reassign_match.group(1).strip()
        vehicle_target = reassign_match.group(2).strip()
        if vehicle_target.lower() in ["pendente", "pendentes", "por distribuir", "fora"]:
            vehicle_target = "Por Distribuir"
        action_commands.append(f"[COMANDO:REATRIBUIR|CLIENTE:{client_target}|VIATURA:{vehicle_target}]")

    if any(k in user_message.lower() for k in ["ordenar todos", "ordenar as rotas", "ordenar carros", "otimizar sequencia", "otimizar sequ?ncias", "reordenar tudo", "sequenciar rotas", "reotimizar", "ordenar"]):
        action_commands.append("[COMANDO:OTIMIZAR_TODAS_SEQUENCIAS]")

    geo_match = re.search(r'(?:georreferenci(?:ar|a)?|corrige coordenadas)\s+(?:do\s+cliente\s+|o\s+)?([^\s,\.]+)', user_message, re.IGNORECASE)
    if geo_match:
        target_c = geo_match.group(1).strip()
        action_commands.append(f"[COMANDO:REGEORREFERENCIAR|CLIENTE:{target_c}]")
    actions = []
    if outliers:
        actions.append({"label": f"🔍 Ver {len(outliers)} Pontos Suspeitos", "action": "inspect_outliers"})
    if unassigned_count > 0:
        actions.append({"label": "⏱️ Simular +10% Turno", "action": "simulate_plus_10_percent"})
        actions.append({"label": "📦 Deixar Perto do Armazém", "action": "filter_near_depot"})
    actions.append({"label": "📊 Horários Manhã/Tarde", "action": "slots_distribution"})

    # Se não houver chave de API, responder com análise local imediata
    if not key:
        local_reply = generate_local_analytical_reply(
            user_message.lower(), total_stops, assigned_count, unassigned_count,
            active_vehicles, dist_metrics, outliers, clustering
        )
        for cmd in action_commands:
            if cmd not in local_reply:
                local_reply += f"\n\n{cmd}"
            return {
                "reply": local_reply,
                "outliers": outliers,
                "clustering": clustering,
                "suggested_actions": actions
            }

    # Prompt para a IA
    context_summary = {
        "total_entregas": total_stops,
        "entregas_atribuidas": assigned_count,
        "entregas_pendentes": unassigned_count,
        "viaturas_ativas": len(active_vehicles),
        "estatisticas_janelas_e_cargas": dist_metrics,
        "pontos_geograficamente_suspeitos": outliers[:5],
        "pendentes_perto_armazem_menos_15km": clustering.get("near_depot_count", 0),
        "pendentes_longe_armazem": clustering.get("far_depot_count", 0),
        "amostra_pendentes": clustering.get("near_depot", [])[:3]
    }

    system_prompt = f"""
Você é o Co-Piloto Inteligente de Tráfego do sistema GeoRoutePlan.
Conversa diretamente com o gestor operacional (Paulo).

DADOS REAIS DA DISTRIBUIÇÃO ATUAL:
{json.dumps(context_summary, ensure_ascii=False, indent=2)}

DIRETRIZES:
1. Responda em Português direto, técnico e conciso (máximo 3-4 parágrafos claros).
2. Se houver pontos suspeitos a centenas de km (outliers), aponte os clientes e distâncias e explique que pode ser erro de código postal ou cliente que deve ser retirado desta rota.
3. Se perguntar sobre janelas ou slots, use as estatísticas fornecidas de manhã vs tarde.
4. Voc? TEM AUTONOMIA operacional no sistema! NUNCA diga 'como sistema n?o tenho permiss?o' ou 'n?o posso alterar'. Se o gestor solicitar a??es operacionais, confirme que as est? a executar e emita SEMPRE as tags de comando para o sistema executar na base de dados:
   - Trocar cliente de carro ou colocar em pendente/por distribuir:
     [COMANDO:REATRIBUIR|CLIENTE:id_ou_nome|VIATURA:nome_da_viatura_ou_Por Distribuir]
   - Reotimizar / ordenar a sequ?ncia de entregas de todas as viaturas:
     [COMANDO:OTIMIZAR_TODAS_SEQUENCIAS]
   - Corrigir georreferencia??o de cliente:
     [COMANDO:REGEORREFERENCIAR|CLIENTE:id_ou_nome]
"""

    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": f"{system_prompt}\n\nPergunta do Gestor: {user_message}"}]}
        ],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 600
        }
    }

    # Tentativa em cascata pelos modelos disponíveis (timeout curto de 6s cada)
    for model_name in CANDIDATE_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}"
        try:
            resp = requests.post(url, json=payload, timeout=12.0)
            if resp.status_code == 200:
                data = resp.json()
                reply_text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                for cmd in action_commands:
                    if cmd not in reply_text:
                        reply_text += f"\n\n{cmd}"
                return {
                    "reply": reply_text,
                    "outliers": outliers,
                    "clustering": clustering,
                    "suggested_actions": actions
                }
            else:
                print(f"[Aviso LLM] Modelo {model_name} retornou status {resp.status_code}: {resp.text[:150]}")
        except Exception:
            continue

    # Se todos os modelos da API falharem ou derem timeout, fallback analítico instantâneo garantido
    local_reply = generate_local_analytical_reply(
        user_message.lower(), total_stops, assigned_count, unassigned_count,
        active_vehicles, dist_metrics, outliers, clustering
    )
    for cmd in action_commands:
        if cmd not in local_reply:
            local_reply += f"\n\n{cmd}"

    return {
        "reply": local_reply,
        "outliers": outliers,
        "clustering": clustering,
        "suggested_actions": actions
    }
