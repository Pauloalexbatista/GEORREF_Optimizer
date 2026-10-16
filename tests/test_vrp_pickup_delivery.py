import pytest
import numpy as np
from utils.operation_types import (
    normalize_op_type,
    apply_sucata_heritage,
    extract_pickup_delivery_pairs,
    calculate_dynamic_route_loads
)
from utils.optimization_solver import AdvancedRouteOptimizer
from utils.validation_auditor import audit_route_plan

def test_sucata_heritage_and_dynamic_loads():
    # 1. Teste de Herança de Sucata 1:1
    raw_deliveries = [
        {"Doc_ID": "DOC_100", "Tipo_Operacao": "D", "Peso_KG": 45.0, "Volume_M3": 0.5},
        {"Doc_ID": "DOC_100", "Tipo_Operacao": "P", "Peso_KG": None, "Volume_M3": None}, # Sucata a recolher
        {"Doc_ID": "DOC_200", "Tipo_Operacao": "From", "Par_ID": "PAR_ABC", "Peso_KG": 20.0, "Volume_M3": 0.2},
        {"Doc_ID": "DOC_201", "Tipo_Operacao": "To", "Par_ID": "PAR_ABC", "Peso_KG": 20.0, "Volume_M3": 0.2},
    ]
    
    inherited = apply_sucata_heritage(raw_deliveries)
    sucata = next(d for d in inherited if d["Tipo_Operacao"] == "P")
    assert sucata["Peso_KG"] == 45.0
    assert sucata["Volume_M3"] == 0.5
    
    # 2. Teste de Extração de Pares Casados
    pairs = extract_pickup_delivery_pairs(inherited)
    assert len(pairs) == 1
    p_from, p_to = pairs[0]
    assert p_from == 2 # From está no índice 2
    assert p_to == 3   # To está no índice 3

def test_dynamic_loads_curve():
    # Rota com 1 Viatura (Capacidade 100 kg):
    # - Sai do armazém carregada apenas com as entregas D (50 kg)
    # - Paragem 1: D entrega 50 kg -> carga a bordo passa a 0 kg
    # - Paragem 2: From recolhe 60 kg -> carga a bordo passa a 60 kg
    # - Paragem 3: P recolhe sucata 30 kg -> carga a bordo passa a 90 kg
    # - Paragem 4: To descarrega os 60 kg -> carga a bordo passa a 30 kg (fica só a sucata para o armazém)
    stops = [
        {"Ordem": 1, "Tipo_Operacao": "D", "Peso_KG": 50.0, "Volume_m3": 0.5},
        {"Ordem": 2, "Tipo_Operacao": "From", "Peso_KG": 60.0, "Volume_m3": 0.6},
        {"Ordem": 3, "Tipo_Operacao": "P", "Peso_KG": 30.0, "Volume_m3": 0.3},
        {"Ordem": 4, "Tipo_Operacao": "To", "Peso_KG": 60.0, "Volume_m3": 0.6},
    ]
    
    result = calculate_dynamic_route_loads(stops, vehicle_cap_kg=100.0, vehicle_cap_vol=2.0)
    stops_res = result["stops_with_loads"]
    
    assert stops_res[0]["Carga_Acum"] == 0.0   # 50 saiu - 50 entregou = 0
    assert stops_res[1]["Carga_Acum"] == 60.0  # 0 + 60 levantou da loja = 60
    assert stops_res[2]["Carga_Acum"] == 90.0  # 60 + 30 sucata recolhida = 90
    assert stops_res[3]["Carga_Acum"] == 30.0  # 90 - 60 entregou da loja = 30
    assert result["peak_load_kg"] == 90.0
    assert result["has_kg_overload"] is False

def test_ortools_vrp_pickup_and_delivery_precedence():
    # Depósito no índice 0
    # Índice 1: Entrega Normal D
    # Índice 2: Loja From (Levantamento)
    # Índice 3: Cliente To (Entrega de Loja)
    
    # Matriz de distâncias (4 nós: 0, 1, 2, 3)
    dist_matrix = [
        [0, 10, 15, 25],
        [10, 0, 12, 20],
        [15, 12, 0, 10],
        [25, 20, 10, 0]
    ]
    
    demands = [0, 30, 20, 20]
    v_caps = [100]
    depot_indices = [0]
    num_warehouses = 1
    
    op_types = ["D", "D", "From", "To"]
    pd_pairs = [(2, 3)] # Nó 2 (From) DEVE ser visitado antes do Nó 3 (To) pelo mesmo veículo
    
    opt = AdvancedRouteOptimizer()
    res = opt.optimize_routes(
        distance_matrix=dist_matrix,
        demands=demands,
        vehicle_capacities=v_caps,
        depot_indices=depot_indices,
        num_warehouses=num_warehouses,
        locations=[(38.7, -9.1), (38.71, -9.11), (38.72, -9.12), (38.73, -9.13)],
        operation_types=op_types,
        pickup_delivery_pairs=pd_pairs,
        optimization_params={"time_limit_seconds": 3}
    )
    
    route = res["routes"][0]
    # Depósito no início e fim (ou sem depot dependendo de retorno)
    # Verificar se 2 e 3 estão na rota e ordem(2) < ordem(3)
    assert 2 in route
    assert 3 in route
    idx_from = route.index(2)
    idx_to = route.index(3)
    assert idx_from < idx_to, f"Nó From ({idx_from}) deve anteceder Nó To ({idx_to})!"

def test_auditor_detects_inverted_pair_and_split():
    # Teste do Auditor quando par casado está em viaturas diferentes ou invertido
    fleet_config = {
        "Viatura 1": {"capacidade_kg": 100, "capacidade_vol": 10, "start_time": "08:00", "end_time": "18:00"},
        "Viatura 2": {"capacidade_kg": 100, "capacidade_vol": 10, "start_time": "08:00", "end_time": "18:00"}
    }
    
    # Caso 1: Invertido na mesma viatura (To antes de From)
    bad_route_stops = [
        {"Rota": "Viatura 1", "Ordem": 1, "Cliente": "Cliente To", "Tipo_Operacao": "To", "Par_ID": "P1", "Peso_KG": 10, "Volume_m3": 0.1, "Chegada": "09:00", "Saida": "09:10"},
        {"Rota": "Viatura 1", "Ordem": 2, "Cliente": "Loja From", "Tipo_Operacao": "From", "Par_ID": "P1", "Peso_KG": 10, "Volume_m3": 0.1, "Chegada": "10:00", "Saida": "10:10"}
    ]
    audit_res = audit_route_plan(bad_route_stops, fleet_config)
    violations = [v for v in audit_res["all_violations"] if v["type"] == "pickup_delivery_pair"]
    assert len(violations) > 0
    assert "Precedência Invertida" in violations[0]["title"]
    
    # Caso 2: Em viaturas diferentes
    split_route_stops = [
        {"Rota": "Viatura 1", "Ordem": 1, "Cliente": "Loja From", "Tipo_Operacao": "From", "Par_ID": "P2", "Peso_KG": 10, "Volume_m3": 0.1, "Chegada": "09:00", "Saida": "09:10"},
        {"Rota": "Viatura 2", "Ordem": 1, "Cliente": "Cliente To", "Tipo_Operacao": "To", "Par_ID": "P2", "Peso_KG": 10, "Volume_m3": 0.1, "Chegada": "10:00", "Saida": "10:10"}
    ]
    audit_res_split = audit_route_plan(split_route_stops, fleet_config)
    violations_split = [v for v in audit_res_split["all_violations"] if v["type"] == "pickup_delivery_pair"]
    assert len(violations_split) > 0
    assert "Viaturas Diferentes" in violations_split[0]["title"]
