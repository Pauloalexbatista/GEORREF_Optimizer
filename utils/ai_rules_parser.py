"""
Motor Híbrido de Extração de Regras e Notas Ocultas (Local Determinístico + Gemini LLM)
======================================================================================
1. `scan_delivery_notes_for_hidden_rules`: Varre as Observações / Notas_Motorista das entregas
   e deteta horários ocultos (ex: "só à tarde", "até às 12h"), exigências de equipa/veículo
   (ex: "2 homens", "sem elevador", "rua estreita", "frio") que ainda não estejam nas colunas
   formais `Janela_Inicio`/`Janela_Fim` ou `Regras`.
2. `parse_business_rules_with_llm`: Converte frases em linguagem natural (ex: "Pesados não entram
   em Sintra CP 2710" ou "Carrinha 02 proibida em acesso restrito") em regras estruturadas da
   Folha 4 (`Tag_Veiculo`, `Permissao`, `Tag_Entrega`, `Descricao`), funcionando a custo zero
   com parser determinístico em Português e enriquecimento opcional via Gemini API.
"""

import os
import re
import json
import requests
from typing import List, Dict, Any, Optional


def scan_delivery_notes_for_hidden_rules(deliveries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Analisa a lista de entregas (dicionários) à procura de instruções escondidas nas
    Observações / Notas_Motorista que não estão refletidas nas janelas horárias ou tags.
    Retorna sugestões individuais para o utilizador decidir quais quer aplicar (Opt-In).
    """
    suggestions: List[Dict[str, Any]] = []

    for idx, row in enumerate(deliveries):
        deliv_id = row.get("id") or row.get("ID_Original") or (idx + 1)
        client_name = str(
            row.get("Nome_Cliente")
            or row.get("Cliente")
            or row.get("codigo_cliente")
            or f"Cliente #{deliv_id}"
        ).strip()
        notes = str(
            row.get("Observacoes")
            or row.get("Notas_Motorista")
            or row.get("observacoes")
            or row.get("notas_motorista")
            or ""
        ).strip()

        if not notes or notes.lower() in ["nan", "none", "n/a", "--"]:
            continue

        notes_lower = notes.lower()
        current_rules = str(row.get("Regras") or row.get("regras") or "").strip()
        current_rules_upper = current_rules.upper()

        win_s = str(row.get("Janela_Inicio") or row.get("Slot1_Inicio") or row.get("janela_inicio") or "").strip()
        win_e = str(row.get("Janela_Fim") or row.get("Slot1_Fim") or row.get("janela_fim") or "").strip()
        win_combined = str(row.get("Janela_Horaria") or row.get("janela_horaria") or "").strip()

        # Verificar se a janela atual é aberta/dia todo (ex: vazia, 00:00-23:59, 08:00-18:00, Qualquer)
        is_wide_window = (
            not win_s
            or win_s in ["00:00", "08:00", "07:00", "09:00"]
            and (not win_e or win_e in ["18:00", "19:00", "20:00", "23:59", "24:00"])
        ) or ("qualquer" in win_combined.lower())

        proposed_tags: List[str] = []
        proposed_win_start: Optional[str] = None
        proposed_win_end: Optional[str] = None
        reasons: List[str] = []

        # 1. Deteção de Janelas Horárias explícitas ou implícitas nas notas
        # Ex: "entre as 14h e as 17h", "das 09:00 às 12:00", "a partir das 14h", "só da parte da tarde"
        explicit_range = re.search(
            r"(?:das|entre\s+as?)\s*(\d{1,2})(?:[:h](\d{2}))?\s*(?:às|as|e\s+as?|a|-)\s*(\d{1,2})(?:[:h](\d{2}))?",
            notes_lower,
        )
        if explicit_range:
            h1 = int(explicit_range.group(1))
            m1 = int(explicit_range.group(2) or 0)
            h2 = int(explicit_range.group(3))
            m2 = int(explicit_range.group(4) or 0)
            if 0 <= h1 <= 23 and 0 <= h2 <= 23 and (h1 * 60 + m1) < (h2 * 60 + m2):
                cand_s = f"{h1:02d}:{m1:02d}"
                cand_e = f"{h2:02d}:{m2:02d}"
                if cand_s != win_s[:5] or cand_e != win_e[:5]:
                    proposed_win_start = cand_s
                    proposed_win_end = cand_e
                    reasons.append(f"Horário explícito detetado na nota ('{cand_s} - {cand_e}')")
        elif is_wide_window:
            if any(
                kw in notes_lower
                for kw in ["só à tarde", "so a tarde", "parte da tarde", "período da tarde", "periodo da tarde", "após as 14", "apos as 14", "depois das 14", "a partir das 14"]
            ):
                proposed_win_start = "14:00"
                proposed_win_end = "18:00"
                reasons.append("Nota indica entrega exclusiva no período da tarde ('14:00 - 18:00')")
            elif any(
                kw in notes_lower
                for kw in ["só de manhã", "so de manha", "parte da manhã", "parte da manha", "período da manhã", "periodo da manha", "até às 12", "ate as 12", "antes do almoço", "antes do almoco"]
            ):
                proposed_win_start = "08:00"
                proposed_win_end = "12:30"
                reasons.append("Nota indica entrega exclusiva no período da manhã ('08:00 - 12:30')")

        # 2. Deteção de exigência de 2 Homens / Sem Elevador / Carga Pesada
        if any(
            kw in notes_lower
            for kw in [
                "2 homens",
                "dois homens",
                "2 pessoas",
                "duas pessoas",
                "sem elevador",
                "s/ elevador",
                "escadas",
                "ajudante",
                "2man",
                "two man",
            ]
        ):
            if "[2MAN]" not in current_rules_upper and "2MAN" not in current_rules_upper:
                proposed_tags.append("[2MAN]")
                reasons.append("Nota menciona necessidade de equipa de 2 elementos / escadas ([2MAN])")

        # 3. Deteção de Acesso Restrito / Rua Estreita / Centro Histórico (proíbe pesados)
        if any(
            kw in notes_lower
            for kw in [
                "rua estreita",
                "acesso difícil",
                "acesso dificil",
                "acesso restrito",
                "não entra camião",
                "nao entra camiao",
                "não passa pesado",
                "centro histórico",
                "centro historico",
                "carrinha pequena",
                "viatura ligeira",
            ]
        ):
            if "ACESSO_RESTRITO" not in current_rules_upper and "LIGEIRO" not in current_rules_upper:
                proposed_tags.append("[ACESSO_RESTRITO]")
                reasons.append("Nota alerta para rua estreita ou restrição a viaturas pesadas ([ACESSO_RESTRITO])")

        # 4. Deteção de Temperatura Controlada / Frio
        if any(kw in notes_lower for kw in ["frio", "refrigerado", "congelado", "temperatura controlada"]):
            if "FRIO" not in current_rules_upper:
                proposed_tags.append("[FRIO]")
                reasons.append("Nota exige transporte refrigerado ([FRIO])")

        # 5. Deteção de Porta-Paletes / Plataforma Elevatória
        if any(kw in notes_lower for kw in ["porta-paletes", "porta paletes", "plataforma", "elevatória", "elevatoria", "tail lift"]):
            if "ELEVADOR" not in current_rules_upper and "PLATAFORMA" not in current_rules_upper:
                proposed_tags.append("[ELEVADOR]")
                reasons.append("Nota requer plataforma elevatória / porta-paletes ([ELEVADOR])")

        if proposed_tags or (proposed_win_start and proposed_win_end):
            new_rules_str = current_rules
            for t in proposed_tags:
                if t not in new_rules_str:
                    new_rules_str = f"{new_rules_str}, {t}".strip(", ")

            suggestions.append({
                "delivery_id": int(deliv_id) if str(deliv_id).isdigit() else deliv_id,
                "client_name": client_name,
                "route": str(row.get("Rota") or "Por Distribuir"),
                "original_note": notes,
                "current_window": f"{win_s[:5]} - {win_e[:5]}" if (win_s and win_e) else (win_combined or "Qualquer"),
                "proposed_win_start": proposed_win_start,
                "proposed_win_end": proposed_win_end,
                "current_rules": current_rules,
                "proposed_tags": proposed_tags,
                "new_rules_combined": new_rules_str,
                "reasons": reasons,
            })

    return suggestions


def _parse_rules_locally_pt(rules_text_list: List[str]) -> List[Dict[str, str]]:
    """
    Parser determinístico em Português (custo zero) para converter frases naturais em
    regras estruturadas da Folha 4 (Tag_Veiculo, Permissao, Tag_Entrega, Descricao).
    """
    extracted: List[Dict[str, str]] = []

    for raw_line in rules_text_list:
        line = str(raw_line).strip()
        if not line:
            continue
        lower = line.lower()

        # Determinar permissão (PROIBIR vs PERMITIR)
        is_forbid = any(
            w in lower
            for w in ["não pode", "nao pode", "proibid", "não entra", "nao entra", "nunca", "impedid", "bloquead", "exceto", "sem acesso"]
        )
        permissao = "PROIBIR" if is_forbid else "PERMITIR"

        # Determinar Tag_Veiculo
        tag_veiculo = "GERAL"
        veh_match = re.search(r"(carrinha\s*\d+|viatura\s*\d+|cami[aã]o\s*\d+|rota\s*\d+)", lower)
        if veh_match:
            tag_veiculo = veh_match.group(1).title()
        elif "pesad" in lower or "cami" in lower:
            tag_veiculo = "PESADO"
        elif "ligeir" in lower or "pequen" in lower:
            tag_veiculo = "LIGEIRO"
        elif "1 homem" in lower or "sozinho" in lower or "oneman" in lower:
            tag_veiculo = "ONEMAN"
        elif "2 homens" in lower or "equipa" in lower or "2man" in lower:
            tag_veiculo = "2MAN"
        elif "frio" in lower or "isotérmic" in lower or "isotermic" in lower:
            tag_veiculo = "FRIO"

        # Determinar Tag_Entrega (CP ou Tag)
        tag_entrega = ""
        cp_range = re.search(r"(\d{4})\s*(?:a|até|ate|\.\.|-)\s*(\d{4})", lower)
        cp_prefix = re.search(r"cp\s*(\d{2,4}\*?)", lower)
        if cp_range:
            tag_entrega = f"CP:{cp_range.group(1)}..{cp_range.group(2)}"
        elif cp_prefix:
            val = cp_prefix.group(1)
            tag_entrega = f"CP:{val}" if len(val) == 4 or val.endswith("*") else f"CP:{val}*"
        elif "margem sul" in lower or "almada" in lower or "seixal" in lower or "setúbal" in lower:
            tag_entrega = "CP:2800..2999"
        elif "sintra" in lower:
            tag_entrega = "CP:2700..2749"
        elif "cascais" in lower:
            tag_entrega = "CP:2750..2799"
        elif "lisboa" in lower or "centro histórico" in lower or "baixa" in lower:
            tag_entrega = "CP:1000..1999" if "lisboa" in lower else "ACESSO_RESTRITO"
        elif "estreit" in lower or "acesso" in lower:
            tag_entrega = "ACESSO_RESTRITO"
        elif "2 homens" in lower or "escadas" in lower or "sem elevador" in lower:
            tag_entrega = "2MAN"
        elif "frio" in lower or "congelad" in lower or "refrigerad" in lower:
            tag_entrega = "FRIO"
        elif "elevador" in lower or "plataforma" in lower or "palete" in lower:
            tag_entrega = "ELEVADOR"

        if not tag_entrega:
            # Procurar qualquer tag entre parênteses retos [TAG]
            brackets = re.findall(r"\[([A-Za-z0-9_:\.\-\*]+)\]", line)
            if len(brackets) >= 2:
                tag_veiculo = brackets[0].upper()
                tag_entrega = brackets[1].upper()
            elif len(brackets) == 1:
                tag_entrega = brackets[0].upper()
            else:
                tag_entrega = "RESTRICAO_ESPECIAL"

        extracted.append({
            "Tag_Veiculo": tag_veiculo,
            "Permissao": permissao,
            "Tag_Entrega": tag_entrega,
            "Descricao": line,
        })

    return extracted


def parse_business_rules_with_llm(
    rules_text_list: List[str],
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Interpreta regras de negócio em linguagem natural e converte-as em regras
    estruturadas compatíveis com a Folha 4 (Regras) do GeoRoutePlan:
    - Tag_Veiculo
    - Permissao: 'PERMITIR' ou 'PROIBIR'
    - Tag_Entrega (suporta tags como ACESSO_RESTRITO, 2MAN, FRIO e códigos postais CP:1000..1999)
    - Descricao
    Se a chave Gemini não estiver configurada ou falhar, utiliza o motor determinístico local em PT.
    """
    valid_texts = [str(t).strip() for t in rules_text_list if str(t).strip()]
    if not valid_texts:
        return {"status": "empty_input", "rules": []}

    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        local_rules = _parse_rules_locally_pt(valid_texts)
        return {
            "status": "success",
            "source": "local_deterministic_engine",
            "message": "Regras extraídas pelo motor determinístico local (Custo Zero).",
            "rules": local_rules,
        }

    prompt = f"""
Você é um especialista em logística e roteamento de frotas (VRP) no sistema GeoRoutePlan.
Analise as seguintes regras operacionais em linguagem natural e extraia uma lista de regras estruturadas para a Folha 4 (Matriz de Regras).

Padrões suportados:
- Tag_Veiculo: nome da viatura ou tag de frota (ex: PESADO, LIGEIRO, ONEMAN, 2MAN, FRIO, ELEVADOR, Carrinha 01)
- Permissao: 'PERMITIR' ou 'PROIBIR'
- Tag_Entrega: tag de exigência da entrega (ex: ACESSO_RESTRITO, 2MAN, FRIO, ELEVADOR) OU padrão canónico de Código Postal (ex: CP:1000..1999, CP:2800..2999, CP:2710*)
- Descricao: explicação clara em Português

Textos para analisar:
{json.dumps(valid_texts, ensure_ascii=False, indent=2)}

Responda EXCLUSIVAMENTE em formato JSON:
{{
  "rules": [
    {{
      "Tag_Veiculo": "PESADO",
      "Permissao": "PROIBIR",
      "Tag_Entrega": "CP:1100..1299",
      "Descricao": "Proibir viaturas pesadas no centro histórico de Lisboa"
    }}
  ]
}}
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.1
        }
    }

    try:
        resp = requests.post(url, json=payload, timeout=15.0)
        if resp.status_code == 200:
            data = resp.json()
            text_out = data["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(text_out)
            rules_out = parsed.get("rules", [])
            if rules_out:
                return {"status": "success", "source": "gemini_llm", "rules": rules_out}
    except Exception:
        pass

    # Fallback determinístico local garantido
    local_rules = _parse_rules_locally_pt(valid_texts)
    return {
        "status": "success",
        "source": "local_deterministic_engine",
        "rules": local_rules,
    }
