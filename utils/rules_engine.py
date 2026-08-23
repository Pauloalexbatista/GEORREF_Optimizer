# -*- coding: utf-8 -*-
"""
GEORREF Optimizer - Rules & Multi-Tag Compatibility Engine
Evaluates vehicle-delivery assignment compatibility based on single or multiple tags.
"""

import re
from typing import List, Set, Dict, Any, Union

def extract_tags(raw_input: Union[str, List, Set, None]) -> Set[str]:
    """
    Extrai um conjunto de tags limpas em maiúsculas a partir de qualquer formato:
    - '[PEQUENO][EXPRESSO]' -> {'PEQUENO', 'EXPRESSO'}
    - '[PEQUENO], [EXPRESSO]' -> {'PEQUENO', 'EXPRESSO'}
    - 'PEQUENO, EXPRESSO' -> {'PEQUENO', 'EXPRESSO'}
    - 'PEQUENO; ALARGADO' -> {'PEQUENO', 'ALARGADO'}
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
            for part in re.split(r'[,;|\s]+', t):
                cleaned = part.strip()
                if cleaned:
                    tags.add(cleaned)
        return tags
        
    # Se não tem colchetes, faz split por vírgula, ponto-e-vírgula ou barra
    tokens = re.split(r'[,;|]+', text)
    return {t.strip() for t in tokens if t.strip()}

def is_vehicle_compatible(
    vehicle_tags: Union[str, Set[str]],
    delivery_tags: Union[str, Set[str]],
    rules_matrix: List[Dict[str, Any]] = None
) -> bool:
    """
    Verifica se uma viatura é compatível com uma entrega considerando regras e múltiplas tags:
    
    1. Proibições Rígidas (NÃO): Se qualquer tag da viatura tiver regra de proibição 'NAO' com qualquer tag da entrega, é IMEDIATAMENTE DESQUALIFICADA.
    2. Obrigatoriedades (SIM): Para cada tag exigida pela entrega:
       - A viatura deve possuir uma tag autorizada para essa restrição (por 'SIM' na matriz ou tag idêntica).
    """
    v_tags = extract_tags(vehicle_tags)
    d_tags = extract_tags(delivery_tags)
    
    # Se a entrega não tem nenhuma restrição especial
    if not d_tags:
        return True
        
    if rules_matrix is None:
        rules_matrix = []
        
    # Normalizar matriz de regras
    prohibitions = set() # (tag_v, tag_d)
    permissions = set()  # (tag_v, tag_d)
    
    for r in rules_matrix:
        tv = str(r.get('Tag_Veiculo', r.get('tag_veiculo', ''))).strip().upper()
        perm = str(r.get('Permissao', r.get('permissao', 'SIM'))).strip().upper()
        td = str(r.get('Tag_Entrega', r.get('tag_entrega', ''))).strip().upper()
        
        if not tv or not td:
            continue
            
        if perm in ['NAO', 'NÃO', 'NO', 'PROIBIR', 'FALSE', '0']:
            prohibitions.add((tv, td))
        else:
            permissions.add((tv, td))
            
    # 1. Verificar Proibições Rígidas (NAO)
    for vt in v_tags:
        for dt in d_tags:
            if (vt, dt) in prohibitions:
                return False
                
    # 2. Verificar Obrigatoriedade de cada Tag da Entrega
    for dt in d_tags:
        # A entrega exige 'dt'. O veículo tem de satisfazer 'dt'
        matched = False
        
        # Match direto (o veículo tem exatamente essa tag)
        if dt in v_tags:
            matched = True
        else:
            # Match via matriz de regras (alguma tag do veículo tem permissão explícita 'SIM' para 'dt')
            for vt in v_tags:
                if (vt, dt) in permissions:
                    matched = True
                    break
                    
        # Se a entrega exige uma tag restritiva e o veículo não satisfaz, é incompatível
        if not matched:
            return False
            
    return True

def filter_eligible_vehicles_for_node(
    vehicles: List[Dict[str, Any]],
    delivery: Dict[str, Any],
    rules_matrix: List[Dict[str, Any]] = None
) -> List[int]:
    """
    Retorna a lista de índices de viaturas elegíveis para uma dada entrega.
    """
    d_tags = delivery.get('Regras', delivery.get('regras', ''))
    eligible_indices = []
    
    for idx, v in enumerate(vehicles):
        v_tags = v.get('regras', v.get('Regras', ''))
        if is_vehicle_compatible(v_tags, d_tags, rules_matrix):
            eligible_indices.append(idx)
            
    return eligible_indices
