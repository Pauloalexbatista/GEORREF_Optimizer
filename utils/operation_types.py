# -*- coding: utf-8 -*-
"""
GEORREF Optimizer - Operations & Pickup/Delivery Taxonomy Engine
Manages the 4 logistical movements:
- 'D'    : Delivery (leaves warehouse, unloads at client)
- 'P'    : PickUp / Sucata / Retoma (picked up at client, carried to warehouse)
- 'From' : Store / Supplier Pickup (picked up at store, held in truck)
- 'To'   : Delivery of Store Pickup (delivered to final client/destination)
"""

import re
from typing import List, Dict, Any, Tuple, Optional


def normalize_op_type(raw_type: Any) -> str:
    """
    Normaliza a operação logística para uma das 4 categorias canónicas:
    - 'D'    : Entrega normal a partir do armazém.
    - 'P'    : Recolha / Sucata / Retoma do cliente para o armazém.
    - 'From' : Levantamento em Loja / Fornecedor para entrega posterior.
    - 'To'   : Entrega associada a um levantamento anterior em loja.
    """
    if raw_type is None:
        return "D"
        
    s = str(raw_type).strip().upper()
    if not s or s in ["NAN", "NONE", "NULL", ""]:
        return "D"
        
    if s in ["FROM", "LEVANTAMENTO", "RECOLHA_LOJA", "LEV_LOJA", "LOJA_FROM", "PICKUP_LOJA", "COLETA_LOJA"]:
        return "From"
    if s in ["TO", "ENTREGA_LOJA", "ENTREGA_FROM", "LOJA_TO", "DESTINO_LOJA", "CLIENTE_FROM"]:
        return "To"
    if s in ["P", "PICKUP", "SUCATA", "RETOMA", "RECOLHA", "DEVOLUCAO", "DEVOLUÇÃO", "TARA", "REVERSA"]:
        return "P"
    if s in ["D", "DELIVERY", "ENTREGA", "CLIENTE", "VENDA", "FORNECIMENTO", "DISTRIBUICAO", "DISTRIBUIÇÃO"]:
        return "D"
        
    # Heurística textual adicional
    if "LEVANT" in s or "FROM" in s:
        return "From"
    if "SUCAT" in s or "RETOM" in s or "RECOLH" in s:
        return "P"
        
    return "D"


def apply_sucata_heritage(delivery_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Regra de Ouro da Sucata:
    Se uma paragem de PickUp ('P') não tiver peso ou volume especificado (ou for 0),
    assume por defeito o mesmo peso e volume da entrega correspondente ('D')
    no mesmo cliente, documento ou morada.
    """
    updated_rows = [dict(r) for r in delivery_rows]
    
    # Criar índices de busca de entregas 'D' por cliente, morada e documento
    lookup_by_client = {}
    lookup_by_doc = {}
    lookup_by_addr = {}
    
    for r in updated_rows:
        op = normalize_op_type(r.get("Tipo_Operacao") or r.get("tipo_operacao") or r.get("Tipo"))
        if op == "D":
            cli = str(r.get("Cliente") or r.get("Nome_Cliente") or r.get("codigo_cliente") or "").strip().upper()
            doc = str(r.get("Doc_ID") or r.get("ID_Original") or "").strip().upper()
            addr = str(r.get("Morada") or r.get("morada") or "").strip().upper()
            kg = float(r.get("Peso_KG") or r.get("peso_kg") or 0.0)
            vol = float(r.get("Volume_m3") or r.get("volume_m3") or r.get("Volume_M3") or 0.0)
            
            if cli and kg > 0:
                lookup_by_client[cli] = (kg, vol)
            if doc and kg > 0:
                lookup_by_doc[doc] = (kg, vol)
            if addr and kg > 0:
                lookup_by_addr[addr] = (kg, vol)
                
    for r in updated_rows:
        op = normalize_op_type(r.get("Tipo_Operacao") or r.get("tipo_operacao") or r.get("Tipo"))
        if op == "P":
            kg_val = float(r.get("Peso_KG") or r.get("peso_kg") or 0.0)
            vol_val = float(r.get("Volume_m3") or r.get("volume_m3") or r.get("Volume_M3") or 0.0)
            
            if kg_val <= 0.0 or vol_val <= 0.0:
                cli = str(r.get("Cliente") or r.get("Nome_Cliente") or r.get("codigo_cliente") or "").strip().upper()
                doc = str(r.get("Doc_ID") or r.get("ID_Original") or "").strip().upper()
                par_doc = str(r.get("Par_ID") or r.get("par_id") or "").strip().upper()
                addr = str(r.get("Morada") or r.get("morada") or "").strip().upper()
                
                inherited = (
                    lookup_by_doc.get(par_doc) or
                    lookup_by_doc.get(doc) or
                    lookup_by_client.get(cli) or
                    lookup_by_addr.get(addr)
                )
                
                if inherited:
                    inh_kg, inh_vol = inherited
                    if kg_val <= 0.0 and inh_kg > 0:
                        r["Peso_KG"] = inh_kg
                        if "peso_kg" in r:
                            r["peso_kg"] = inh_kg
                    if vol_val <= 0.0 and inh_vol > 0:
                        r["Volume_m3"] = inh_vol
                        if "volume_m3" in r:
                            r["volume_m3"] = inh_vol
                        if "Volume_M3" in r:
                            r["Volume_M3"] = inh_vol
                else:
                    # Valor padrão razoável caso não haja entrega correspondente
                    if kg_val <= 0.0:
                        r["Peso_KG"] = 50.0
                    if vol_val <= 0.0:
                        r["Volume_m3"] = 0.2
                        if "Volume_M3" in r:
                            r["Volume_M3"] = 0.2
                        
    return updated_rows


def extract_pickup_delivery_pairs(delivery_rows: List[Dict[str, Any]]) -> List[Tuple[int, int]]:
    """
    Identifica pares casados (From, To) a partir dos campos 'Par_ID' ou 'Doc_ID'.
    Retorna lista de tuplos: [(idx_from, idx_to), ...]
    onde os índices correspondem às posições na lista delivery_rows.
    """
    from_map: Dict[str, int] = {}
    to_map: Dict[str, int] = {}
    
    for idx, r in enumerate(delivery_rows):
        op = normalize_op_type(r.get("Tipo_Operacao") or r.get("tipo_operacao") or r.get("Tipo"))
        par_id = str(r.get("Par_ID") or r.get("par_id") or "").strip().upper()
        doc_id = str(r.get("Doc_ID") or r.get("ID_Original") or "").strip().upper()
        
        link_key = par_id if par_id else doc_id
        if not link_key:
            continue
            
        if op == "From":
            from_map[link_key] = idx
        elif op == "To":
            to_map[link_key] = idx
            
    pairs = []
    for key, from_idx in from_map.items():
        if key in to_map:
            to_idx = to_map[key]
            if from_idx != to_idx:
                pairs.append((from_idx, to_idx))
                
    return pairs


def calculate_dynamic_route_loads(
    stops: List[Dict[str, Any]],
    vehicle_cap_kg: float = 1000.0,
    vehicle_cap_vol: float = 10.0
) -> Dict[str, Any]:
    """
    Calcula a física exata da curva de carga ao longo da rota de uma viatura:
    1. Carga Inicial na Base: Soma de todas as Entregas 'D' (apenas as que saem da base).
       As recolhas 'P' e os levantamentos 'From' NÃO estão no carro à saída.
    2. Em cada paragem i:
       - 'D'    : descarrega (- peso, - vol)
       - 'From' : carrega no carro (+ peso, + vol)
       - 'To'   : descarrega do levantamento (- peso, - vol)
       - 'P'    : carrega sucata/retoma (+ peso, + vol)
    3. Carga Final de Regresso: Total de sucatas 'P' transportadas de volta à base.
    
    Retorna dicionário com:
    - initial_load_kg, initial_load_vol
    - final_load_kg, final_load_vol
    - peak_load_kg, peak_load_vol
    - stops_with_loads: paragens enriquecidas com 'Carga_Acum' e 'Carga_Vol_Acum'
    - has_overload: boolean indicando se a capacidade foi excedida em algum momento
    - overload_details: descrição da sobrecarga caso ocorra
    """
    if not stops:
        return {
            "initial_load_kg": 0.0,
            "initial_load_vol": 0.0,
            "final_load_kg": 0.0,
            "final_load_vol": 0.0,
            "peak_load_kg": 0.0,
            "peak_load_vol": 0.0,
            "stops_with_loads": [],
            "has_overload": False,
            "overload_details": None
        }
        
    # 1. Calcular Carga Inicial (apenas paragens 'D')
    init_kg = 0.0
    init_vol = 0.0
    for s in stops:
        op = normalize_op_type(s.get("Tipo_Operacao") or s.get("tipo_operacao") or s.get("Tipo"))
        if op == "D":
            init_kg += float(s.get("Peso_KG") or s.get("peso_kg") or 0.0)
            init_vol += float(s.get("Volume_m3") or s.get("volume_m3") or s.get("Volume_M3") or 0.0)
            
    cur_kg = init_kg
    cur_vol = init_vol
    peak_kg = cur_kg
    peak_vol = cur_vol
    has_overload = (cur_kg > vehicle_cap_kg) or (cur_vol > vehicle_cap_vol)
    overload_details = None
    
    if has_overload:
        overload_details = f"Carga inicial na saída do armazém ({cur_kg:.1f} kg / {cur_vol:.2f} m³) excede a capacidade ({vehicle_cap_kg:.1f} kg / {vehicle_cap_vol:.2f} m³)."

    enriched_stops = []
    
    for idx, s in enumerate(stops):
        op = normalize_op_type(s.get("Tipo_Operacao") or s.get("tipo_operacao") or s.get("Tipo"))
        w_kg = float(s.get("Peso_KG") or s.get("peso_kg") or 0.0)
        w_vol = float(s.get("Volume_m3") or s.get("volume_m3") or s.get("Volume_M3") or 0.0)
        
        # Aplicar delta físico da paragem
        if op == "D":
            cur_kg = max(0.0, cur_kg - w_kg)
            cur_vol = max(0.0, cur_vol - w_vol)
        elif op == "From":
            cur_kg += w_kg
            cur_vol += w_vol
        elif op == "To":
            cur_kg = max(0.0, cur_kg - w_kg)
            cur_vol = max(0.0, cur_vol - w_vol)
        elif op == "P":
            cur_kg += w_kg
            cur_vol += w_vol
            
        peak_kg = max(peak_kg, cur_kg)
        peak_vol = max(peak_vol, cur_vol)
        
        if (cur_kg > vehicle_cap_kg or cur_vol > vehicle_cap_vol) and not has_overload:
            has_overload = True
            c_name = s.get("Cliente") or s.get("Nome_Cliente") or f"Paragem #{idx+1}"
            overload_details = f"Sobrecarga na paragem #{idx+1} ({c_name}, Tipo: {op}): {cur_kg:.1f} kg / {cur_vol:.2f} m³ a bordo (Máx: {vehicle_cap_kg:.1f} kg / {vehicle_cap_vol:.2f} m³)."
            
        s_copy = dict(s)
        s_copy["Tipo_Operacao"] = op
        s_copy["Carga_Acum"] = round(cur_kg, 1)
        s_copy["Carga_Vol_Acum"] = round(cur_vol, 2)
        s_copy["Ocupacao_Kg_Pct"] = round((cur_kg / vehicle_cap_kg) * 100, 1) if vehicle_cap_kg > 0 else 0.0
        enriched_stops.append(s_copy)
        
    return {
        "initial_load_kg": round(init_kg, 1),
        "initial_load_vol": round(init_vol, 2),
        "final_load_kg": round(cur_kg, 1),
        "final_load_vol": round(cur_vol, 2),
        "peak_load_kg": round(peak_kg, 1),
        "peak_load_vol": round(peak_vol, 2),
        "stops_with_loads": enriched_stops,
        "has_overload": has_overload,
        "has_kg_overload": bool(peak_kg > vehicle_cap_kg),
        "has_vol_overload": bool(peak_vol > vehicle_cap_vol),
        "overload_details": overload_details
    }
