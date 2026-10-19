# -*- coding: utf-8 -*-
"""
GEORREF Optimizer - Rules & Multi-Tag Compatibility Engine
Evaluates vehicle-delivery assignment compatibility based on tags and Postal Code (CP) canonical rules.
"""

import re
from typing import List, Set, Dict, Any, Union, Optional, Tuple


def normalize_postal_code(raw_cp: Any) -> Dict[str, Any]:
    """
    Normaliza um código postal português.
    Retorna:
    {
        "raw": str,
        "clean": str,        # Ex: "1050-023" ou "1050"
        "cp4": Optional[int], # Ex: 1050
        "cp3": Optional[str], # Ex: "023"
        "prefix2": Optional[str] # Ex: "10"
    }
    """
    if raw_cp is None:
        return {"raw": "", "clean": "", "cp4": None, "cp3": None, "prefix2": None}
    
    text = str(raw_cp).strip()
    if text.endswith(".0"):
        text = text[:-2]
    text = text.replace(" ", "")
    
    m = re.match(r"^(\d{4})(?:-(\d{3}))?", text)
    if m:
        cp4_val = int(m.group(1))
        cp3_val = m.group(2) if m.group(2) else None
        clean_val = f"{m.group(1)}-{cp3_val}" if cp3_val else f"{m.group(1)}"
        prefix2_val = m.group(1)[:2]
        return {
            "raw": str(raw_cp),
            "clean": clean_val,
            "cp4": cp4_val,
            "cp3": cp3_val,
            "prefix2": prefix2_val
        }
    
    # Se não fez match estrito inicial, procura 4 dígitos consecutivos
    m4 = re.search(r"\b(\d{4})\b", text)
    if m4:
        cp4_val = int(m4.group(1))
        return {
            "raw": str(raw_cp),
            "clean": str(cp4_val),
            "cp4": cp4_val,
            "cp3": None,
            "prefix2": str(cp4_val)[:2]
        }
        
    return {"raw": str(raw_cp), "clean": text.upper(), "cp4": None, "cp3": None, "prefix2": None}


def is_cp_rule(rule_tag: str) -> bool:
    """
    Identifica se uma tag/regra representa uma restrição de Código Postal.
    Exemplos: 'CP:1000..1999', 'CP:10*', 'CP:1050-023', '!CP:1100..1200', '1000..1999'
    """
    if not rule_tag:
        return False
    t = rule_tag.strip().upper()
    if t.startswith("CP:") or t.startswith("!CP:") or t.startswith("NAO_CP:") or t.startswith("NÃO_CP:"):
        return True
    if ".." in t and re.search(r"\d{4}\s*\.\.\s*\d{4}", t):
        return True
    return False


def matches_cp_pattern(pattern: str, cp_info: Union[Dict[str, Any], str, Any]) -> bool:
    """
    Verifica se um dado código postal cumpre um padrão de regra de CP.
    Suporta:
    - Intervalo CP4: 'CP:1000..1999' ou 'CP:1000-1999' ou '1000..1999'
    - Prefixo com asterisco: 'CP:10*' ou 'CP:27*'
    - Conjunto/Lista: 'CP:1000,1050,1100'
    - Específico: 'CP:1050' ou 'CP:1050-023'
    """
    if not isinstance(cp_info, dict):
        cp_info = normalize_postal_code(cp_info)
        
    cp4 = cp_info.get("cp4")
    clean_cp = cp_info.get("clean", "").upper()
    prefix2 = cp_info.get("prefix2", "")
    
    if not clean_cp and cp4 is None:
        return False
        
    p = pattern.strip().upper()
    if p.startswith("CP:"):
        p = p[3:].strip()
    elif p.startswith("!CP:"):
        p = p[4:].strip()
    elif p.startswith("NAO_CP:") or p.startswith("NÃO_CP:"):
        p = p[7:].strip()
        
    # 1. Padrão de Lista separada por vírgula ou ponto e vírgula
    if "," in p or ";" in p:
        sub_patterns = [sp.strip() for sp in re.split(r"[,;]+", p) if sp.strip()]
        return any(matches_cp_pattern(sp, cp_info) for sp in sub_patterns)
        
    # 2. Padrão de Intervalo: '1000..1999' ou '1000-1999' (quando ambos os lados têm 4 dígitos)
    range_match = re.match(r"^(\d{4})\s*(?:\.\.|-)\s*(\d{4})$", p)
    if range_match:
        if cp4 is None:
            return False
        low = int(range_match.group(1))
        high = int(range_match.group(2))
        return low <= cp4 <= high
        
    # 3. Padrão de Prefixo com '*': '10*' ou '27*' ou '1*'
    if p.endswith("*"):
        prefix = p[:-1].strip()
        if not prefix:
            return True
        # Comparar com os primeiros dígitos do código postal
        digits_only = re.sub(r"\D", "", clean_cp)
        return digits_only.startswith(prefix)
        
    # 4. Padrão exato (CP4 ou CP7)
    # Se o padrão for um número de 4 dígitos
    if re.match(r"^\d{4}$", p):
        if cp4 is not None:
            return cp4 == int(p)
        return clean_cp.startswith(p)
        
    # Se o padrão for CP7 (ex: 1050-023)
    p_norm = p.replace(" ", "")
    if clean_cp == p_norm:
        return True
    if cp_info.get("raw", "").strip().upper() == p:
        return True
        
    return False


def extract_tags(raw_input: Union[str, List, Set, None]) -> Set[str]:
    """
    Extrai um conjunto de tags limpas em maiúsculas a partir de qualquer formato:
    - '[PEQUENO][EXPRESSO]' -> {'PEQUENO', 'EXPRESSO'}
    - '[CP:1000..1999]' -> {'CP:1000..1999'}
    - 'PEQUENO, EXPRESSO' -> {'PEQUENO', 'EXPRESSO'}
    Preserva padrões internos de CP dentro de colchetes.
    """
    if not raw_input:
        return set()
        
    if isinstance(raw_input, (list, set, tuple)):
        tags = set()
        for item in raw_input:
            tags.update(extract_tags(str(item)))
        return tags
        
    text = str(raw_input).strip().upper()
    if not text or text in ['NAN', 'NONE', 'NULL', '']:
        return set()
        
    # Encontra todas as tags entre colchetes [TAG]
    bracketed = re.findall(r'\[([^\]]+)\]', text)
    if bracketed:
        tags = set()
        for t in bracketed:
            t_clean = t.strip()
            # Se for uma regra de CP, preserva o conteúdo do colchete sem partir por espaços
            if is_cp_rule(t_clean):
                # Remove espaços redundantes em volta de : ou ..
                normalized_cp_tag = re.sub(r"\s*:\s*", ":", t_clean)
                normalized_cp_tag = re.sub(r"\s*\.\.\s*", "..", normalized_cp_tag)
                tags.add(normalized_cp_tag)
            else:
                for part in re.split(r'[,;|\s]+', t_clean):
                    cleaned = part.strip()
                    if cleaned:
                        tags.add(cleaned)
        return tags
        
    # Se não tem colchetes, faz split por vírgula, ponto-e-vírgula ou barra
    tokens = re.split(r'[,;|]+', text)
    cleaned_tokens = set()
    for tok in tokens:
        cleaned = tok.strip()
        if cleaned:
            if is_cp_rule(cleaned):
                normalized = re.sub(r"\s*:\s*", ":", cleaned)
                normalized = re.sub(r"\s*\.\.\s*", "..", normalized)
                cleaned_tokens.add(normalized)
            else:
                cleaned_tokens.add(cleaned)
    return cleaned_tokens


def is_vehicle_compatible(
    vehicle_tags: Union[str, Set[str]],
    delivery_tags: Union[str, Set[str]],
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
    delivery_cp: Optional[Any] = None,
    vehicle_name: Optional[str] = None
) -> bool:
    """
    Verifica se uma viatura é compatível com uma entrega considerando regras,
    múltiplas tags e restrições canónicas de Código Postal (CP):
    
    1. Regras Embutidas na Viatura (CP Confinement & Blacklist):
       - Se a viatura tiver tags '[CP:1000..1999]' (zonas permitidas), a entrega DEVE pertencer a pelo menos uma delas.
       - Se a viatura tiver tags '[!CP:1100..1200]' (zonas proibidas), a entrega NÃO PODE pertencer a nenhuma delas.
    
    2. Proibições Rígidas (NÃO na Matriz de Regras):
       - Se a viatura possui uma tag proibida de aceder à tag ou zona postal da entrega, é DESQUALIFICADA.
       
    3. Obrigatoriedades de Zona ou Serviço (SIM na Matriz de Regras):
       - Se a zona da entrega (ou tag da entrega) exige permissão exclusiva na matriz,
         apenas viaturas autorizadas com essa tag podem realizar a paragem.
    """
    v_tags = extract_tags(vehicle_tags)
    if vehicle_name:
        v_tags.add(str(vehicle_name).strip().upper())
        
    d_tags = extract_tags(delivery_tags)
    cp_info = normalize_postal_code(delivery_cp)
    
    # Injetar tags derivadas do Código Postal na entrega
    if cp_info.get("clean"):
        clean_cp = cp_info["clean"]
        d_tags.add(f"CP:{clean_cp}")
        if cp_info.get("cp4") is not None:
            d_tags.add(f"CP:{cp_info['cp4']}")
        if cp_info.get("prefix2"):
            d_tags.add(f"CP:{cp_info['prefix2']}*")
            
    # ---------------------------------------------------------------------
    # 1. Validação de Restrições Postais Embutidas na Própria Viatura
    # ---------------------------------------------------------------------
    allowed_cp_rules = []
    forbidden_cp_rules = []
    
    for vt in v_tags:
        if vt.startswith("!CP:") or vt.startswith("NAO_CP:") or vt.startswith("NÃO_CP:"):
            forbidden_cp_rules.append(vt)
        elif is_cp_rule(vt):
            allowed_cp_rules.append(vt)
            
    # Se a viatura tem lista negra de CPs direta
    if forbidden_cp_rules and (cp_info.get("clean") or cp_info.get("cp4") is not None):
        for f_rule in forbidden_cp_rules:
            if matches_cp_pattern(f_rule, cp_info):
                return False
                
    # Se a viatura tem confinamento geográfico de CPs (whitelisting positivo)
    if allowed_cp_rules and (cp_info.get("clean") or cp_info.get("cp4") is not None):
        in_allowed_zone = any(matches_cp_pattern(a_rule, cp_info) for a_rule in allowed_cp_rules)
        if not in_allowed_zone:
            return False

    # ---------------------------------------------------------------------
    # 2. Avaliação de Negações Diretas na Viatura e Matriz de Regras (Folha 4)
    # ---------------------------------------------------------------------
    # Negações diretas declaradas na própria viatura (ex: [!FRIO], [!PESADO])
    for vt in v_tags:
        if vt.startswith("!") or vt.startswith("NAO_") or vt.startswith("NÃO_"):
            clean_neg = vt.lstrip("!").replace("NAO_", "").replace("NÃO_", "").strip()
            if clean_neg in d_tags:
                return False

    if not rules_matrix:
        return True
        
    prohibitions = [] # (tag_v, tag_d, is_cp)
    permissions = []  # (tag_v, tag_d, is_cp)
    configured_delivery_tags = set()
    configured_cp_rules = []
    
    for r in rules_matrix:
        tv = str(r.get('Tag_Veiculo', r.get('tag_veiculo', ''))).strip().upper()
        perm = str(r.get('Permissao', r.get('permissao', 'SIM'))).strip().upper()
        td = str(r.get('Tag_Entrega', r.get('tag_entrega', ''))).strip().upper()
        
        if not tv or not td:
            continue
            
        is_cp = is_cp_rule(td)
        if is_cp:
            configured_cp_rules.append((tv, perm, td))
        else:
            configured_delivery_tags.add(td)
            
        if perm in ['NAO', 'NÃO', 'NO', 'PROIBIR', 'FALSE', '0']:
            prohibitions.append((tv, td, is_cp))
        else:
            permissions.append((tv, td, is_cp))
            
    # A. Proibições Rígidas (NAO) na Matriz
    for tv, td, is_cp in prohibitions:
        if tv in v_tags:
            if is_cp:
                if (cp_info.get("clean") or cp_info.get("cp4") is not None) and matches_cp_pattern(td, cp_info):
                    return False
            else:
                if td in d_tags:
                    return False
                    
    # B. Obrigatoriedades de Zona Postal (SIM com CP na Matriz)
    # Se uma regra 'SIM' na matriz define que certa zona postal requer uma viatura com determinada Tag_Veiculo,
    # viaturas que não possuam essa tag ficam desqualificadas para entregas nessa zona.
    if configured_cp_rules and (cp_info.get("clean") or cp_info.get("cp4") is not None):
        for tv, perm, td in configured_cp_rules:
            if perm in ['SIM', 'YES', 'PERMITIR', '1', 'TRUE']:
                if matches_cp_pattern(td, cp_info):
                    # Entrega está nesta zona postal configurada na matriz
                    if tv not in v_tags:
                        return False

    # C. Obrigatoriedade de Tags Convencionais da Entrega
    for dt in d_tags:
        if dt not in configured_delivery_tags or is_cp_rule(dt):
            continue
            
        matched = False
        if dt in v_tags:
            matched = True
        else:
            for tv, perm_td, is_cp in permissions:
                if not is_cp and perm_td == dt and tv in v_tags:
                    matched = True
                    break
                    
        if not matched:
            return False
            
    return True


def explain_incompatibility(
    vehicle_tags: Union[str, Set[str]],
    delivery_tags: Union[str, Set[str]],
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
    delivery_cp: Optional[Any] = None,
    vehicle_name: Optional[str] = None
) -> Optional[str]:
    """
    Retorna uma explicação textual em Português detalhando o motivo exato
    da incompatibilidade entre uma viatura e uma entrega, ou None se compatível.
    """
    v_tags = extract_tags(vehicle_tags)
    if vehicle_name:
        v_tags.add(str(vehicle_name).strip().upper())
        
    d_tags = extract_tags(delivery_tags)
    cp_info = normalize_postal_code(delivery_cp)
    v_label = vehicle_name or (", ".join(sorted(v_tags)) if v_tags else "Viatura")
    clean_cp = cp_info.get("clean", "")
    
    # Validação de CPs da própria viatura
    allowed_cp_rules = [vt for vt in v_tags if is_cp_rule(vt) and not vt.startswith("!") and not vt.startswith("NAO")]
    forbidden_cp_rules = [vt for vt in v_tags if vt.startswith("!CP:") or vt.startswith("NAO_CP:") or vt.startswith("NÃO_CP:")]
    
    if forbidden_cp_rules and clean_cp:
        for f_rule in forbidden_cp_rules:
            if matches_cp_pattern(f_rule, cp_info):
                return f"Viatura '{v_label}' proibida no Código Postal '{clean_cp}' pela restrição direta '{f_rule}'."
                
    if allowed_cp_rules and clean_cp:
        if not any(matches_cp_pattern(a_rule, cp_info) for a_rule in allowed_cp_rules):
            allowed_str = ", ".join(allowed_cp_rules)
            return f"Código Postal '{clean_cp}' fora das zonas postais autorizadas para a viatura '{v_label}' ({allowed_str})."
            
    if not rules_matrix:
        return None
        
    for r in rules_matrix:
        tv = str(r.get('Tag_Veiculo', r.get('tag_veiculo', ''))).strip().upper()
        perm = str(r.get('Permissao', r.get('permissao', 'SIM'))).strip().upper()
        td = str(r.get('Tag_Entrega', r.get('tag_entrega', ''))).strip().upper()
        desc = str(r.get('Descricao', r.get('descricao', ''))).strip()
        
        if not tv or not td:
            continue
            
        is_cp = is_cp_rule(td)
        
        if perm in ['NAO', 'NÃO', 'NO', 'PROIBIR', 'FALSE', '0'] and tv in v_tags:
            if is_cp and clean_cp and matches_cp_pattern(td, cp_info):
                msg = f"Viatura '{v_label}' (Tag: '{tv}') proibida na zona postal '{td}' (CP: {clean_cp})"
                if desc:
                    msg += f" - Regra: {desc}"
                return msg
            elif not is_cp and td in d_tags:
                msg = f"Viatura '{v_label}' (Tag: '{tv}') proibida de aceder a entregas com a tag '{td}'"
                if desc:
                    msg += f" - Regra: {desc}"
                return msg
                
        if perm in ['SIM', 'YES', 'PERMITIR', '1', 'TRUE'] and is_cp and clean_cp and matches_cp_pattern(td, cp_info):
            if tv not in v_tags:
                msg = f"A zona postal '{clean_cp}' ({td}) está reservada a viaturas com a tag '{tv}'"
                if desc:
                    msg += f" - Regra: {desc}"
                return msg

    for dt in d_tags:
        if is_cp_rule(dt):
            continue
        if dt not in v_tags:
            # Verifica se tem permissão por regra SIM
            has_perm = any(
                str(r.get('Tag_Entrega', r.get('tag_entrega', ''))).strip().upper() == dt
                and str(r.get('Permissao', r.get('permissao', 'SIM'))).strip().upper() in ['SIM', 'YES', '1']
                and str(r.get('Tag_Veiculo', r.get('tag_veiculo', ''))).strip().upper() in v_tags
                for r in rules_matrix
            )
            if not has_perm:
                return f"A entrega requer a capacidade/tag '{dt}', que a viatura '{v_label}' não possui."
                
    return None


def filter_eligible_vehicles_for_node(
    vehicles: List[Dict[str, Any]],
    delivery: Dict[str, Any],
    rules_matrix: Optional[List[Dict[str, Any]]] = None
) -> List[int]:
    """
    Retorna a lista de índices de viaturas elegíveis para uma dada entrega,
    considerando tags e Código Postal.
    """
    d_tags = delivery.get('Regras', delivery.get('regras', ''))
    d_cp = delivery.get('CP', delivery.get('cp', delivery.get('Codigo_Postal', '')))
    eligible_indices = []
    
    for idx, v in enumerate(vehicles):
        v_tags = v.get('regras', v.get('Regras', ''))
        v_name = v.get('veiculo', v.get('Veiculo', ''))
        if is_vehicle_compatible(v_tags, d_tags, rules_matrix, delivery_cp=d_cp, vehicle_name=v_name):
            eligible_indices.append(idx)
            
    return eligible_indices


def simulate_rule_evaluation(
    vehicle_tags: Union[str, Set[str]],
    delivery_tags: Union[str, Set[str]],
    rules_matrix: Optional[List[Dict[str, Any]]] = None,
    delivery_cp: Optional[Any] = None,
    vehicle_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executa uma simulação detalhada de regras entre uma viatura e uma entrega.
    Retorna diagnóstico completo com compatibilidade, motivo e tags analisadas.
    """
    compatible = is_vehicle_compatible(
        vehicle_tags=vehicle_tags,
        delivery_tags=delivery_tags,
        rules_matrix=rules_matrix,
        delivery_cp=delivery_cp,
        vehicle_name=vehicle_name
    )

    explanation = explain_incompatibility(
        vehicle_tags=vehicle_tags,
        delivery_tags=delivery_tags,
        rules_matrix=rules_matrix,
        delivery_cp=delivery_cp,
        vehicle_name=vehicle_name
    )

    v_set = sorted(list(extract_tags(vehicle_tags)))
    d_set = sorted(list(extract_tags(delivery_tags)))
    cp_info = normalize_postal_code(delivery_cp)

    return {
        "compatible": compatible,
        "explanation": explanation or "A viatura cumpre 100% dos requisitos de tags e zonas postais para esta entrega.",
        "vehicle_name": vehicle_name or "Viatura",
        "vehicle_tags": v_set,
        "delivery_tags": d_set,
        "postal_code": cp_info.get("clean") or "",
        "applied_rules_count": len(rules_matrix) if rules_matrix else 0
    }


def validate_route_precedence(
    route_stops: List[Dict[str, Any]],
    precedence_rules: Optional[List[Dict[str, Any]]] = None
) -> Tuple[bool, List[str]]:
    """
    Valida se as regras de precedência foram cumpridas na sequência de uma rota.
    Ex: Paragem A (ex: recolha de peça) tem de ocorrer estritamente antes de Paragem B (entrega/substituição).
    """
    violations = []
    if not route_stops or not precedence_rules:
        return True, violations

    # Mapear posições de cada paragem na rota
    pos_map = {}
    for pos, stop in enumerate(route_stops):
        doc_id = str(stop.get('Doc_ID') or stop.get('Codigo_Cliente') or stop.get('id') or '').strip().upper()
        if doc_id:
            pos_map[doc_id] = pos

    for r in precedence_rules:
        before_id = str(r.get('Precedente_ID', r.get('before_id', ''))).strip().upper()
        after_id = str(r.get('Dependente_ID', r.get('after_id', ''))).strip().upper()
        desc = r.get('Descricao', r.get('descricao', 'Precedência Obrigatória'))

        if before_id in pos_map and after_id in pos_map:
            if pos_map[before_id] > pos_map[after_id]:
                violations.append(
                    f"Violação de precedência: Paragem '{before_id}' (posição {pos_map[before_id]+1}) "
                    f"deve ser visitada antes de '{after_id}' (posição {pos_map[after_id]+1}). Regra: {desc}"
                )

    return len(violations) == 0, violations


def validate_category_limits(
    vehicle_route_stops: List[Dict[str, Any]],
    category_limits: Optional[Dict[str, int]] = None
) -> Tuple[bool, List[str]]:
    """
    Valida se o número de entregas de uma determinada categoria/tag numa mesma rota
    não ultrapassa o teto máximo permitido para a viatura.
    Ex: category_limits = {'PESADO': 3, 'FRIO': 5}
    """
    violations = []
    if not vehicle_route_stops or not category_limits:
        return True, violations

    counts: Dict[str, int] = {}
    for stop in vehicle_route_stops:
        tags = extract_tags(stop.get('Regras', stop.get('regras', '')))
        for t in tags:
            counts[t] = counts.get(t, 0) + 1

    for tag, max_limit in category_limits.items():
        tag_upper = tag.strip().upper()
        actual = counts.get(tag_upper, 0)
        if actual > max_limit:
            violations.append(
                f"Limite de categoria excedido: Rota possui {actual} entregas com a tag '[{tag_upper}]', "
                f"mas o limite máximo permitido é de {max_limit}."
            )

    return len(violations) == 0, violations
