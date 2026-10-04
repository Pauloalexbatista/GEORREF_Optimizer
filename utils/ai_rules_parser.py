import os
import json
import httpx
from typing import List, Dict, Any, Optional

def parse_business_rules_with_llm(
    rules_text_list: List[str],
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Interpreta regras de negcio em linguagem natural (ex: escritas em notas ou abas do Excel)
    e converte-as em regras estruturadas compativeis com a Folha 4 (Regras) do GeoRoutePlan:
    - Tag_Veiculo
    - Permissao: 'PERMITIR' ou 'PROIBIR'
    - Tag_Entrega
    - Descricao
    """
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        return {
            "status": "missing_api_key",
            "message": "Chave de API Gemini nao configurada. Configure GEMINI_API_KEY no .env.",
            "rules": []
        }

    valid_texts = [str(t).strip() for t in rules_text_list if str(t).strip()]
    if not valid_texts:
        return {"status": "empty_input", "rules": []}

    prompt = f"""
Voce e um especialista em logistica e roteamento de frotas (VRP).
Analise as seguintes notas/regras operacionais em linguagem natural e extraia uma lista de regras de compatibilidade estruturadas.

As regras devem mapear restricoes entre VEICULOS (ou tags de veiculos como [LIGEIRO], [PESADO], [FRIO], [ELEVADOR])
e ENTREGAS/CLIENTES (como [ACESSO_DIFICIL], [FRIO], [CENTRO_HISTORICO], [URGENTE]).

Textos para analisar:
{json.dumps(valid_texts, ensure_ascii=False, indent=2)}

Responda EXCLUSIVAMENTE em formato JSON com esta estrutura:
{{
  "rules": [
    {{
      "Tag_Veiculo": "NOME_DO_VEICULO_OU_TAG",
      "Permissao": "PERMITIR ou PROIBIR",
      "Tag_Entrega": "TAG_OU_EXIGENCIA_DA_ENTREGA",
      "Descricao": "Explicacao curta da regra"
    }}
  ]
}}
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.1
        }
    }

    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.post(url, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                text_out = data["candidates"][0]["content"]["parts"][0]["text"]
                parsed = json.loads(text_out)
                return {"status": "success", "rules": parsed.get("rules", [])}
            else:
                return {
                    "status": "api_error",
                    "code": resp.status_code,
                    "detail": resp.text,
                    "rules": []
                }
    except Exception as e:
        return {"status": "exception", "detail": str(e), "rules": []}
