# -*- coding: utf-8 -*-
"""
Teste de Integração: Solver OR-Tools com Confinamento Geográfico por Código Postal (CP).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.optimization_solver import AdvancedRouteOptimizer
from utils.validation_auditor import audit_route_plan
import pandas as pd


def test_solver_with_cp_confinement():
    # 1 Armazém (depósito em Lisboa)
    # 4 Clientes: 2 em Lisboa (CP 1000..1999) e 2 na Linha de Sintra (CP 2700..2799)
    locations = [
        (38.75, -9.15),  # Armazém Central (Nó 0)
        (38.72, -9.14),  # Cliente 1 - Lisboa Baixa (CP 1100-001)
        (38.73, -9.15),  # Cliente 2 - Lisboa Saldanha (CP 1050-023)
        (38.80, -9.38),  # Cliente 3 - Sintra Vila (CP 2710-500)
        (38.76, -9.26),  # Cliente 4 - Queluz (CP 2745-100)
    ]
    
    # Matriz euclidiana / distâncias aproximadas (km)
    n = len(locations)
    dist_matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            lat1, lon1 = locations[i]
            lat2, lon2 = locations[j]
            dist_matrix[i][j] = ((lat1 - lat2)**2 + (lon1 - lon2)**2)**0.5 * 100.0

    demands = [0.0, 100.0, 100.0, 100.0, 100.0]
    vehicle_capacities = [1000.0, 1000.0]
    depot_indices = [0, 0]
    
    # Viatura 0: restrita a Lisboa [CP:1000..1999]
    # Viatura 1: restrita a Sintra [CP:2700..2799]
    vehicle_rules = ["[CP:1000..1999]", "[CP:2700..2799]"]
    vehicle_names = ["Viatura Lisboa", "Viatura Sintra"]
    
    # Códigos Postais dos nós:
    client_cps = ["", "1100-001", "1050-023", "2710-500", "2745-100"]
    client_rules = ["", "", "", "", ""]
    
    optimizer = AdvancedRouteOptimizer()
    res = optimizer.optimize_routes(
        distance_matrix=dist_matrix,
        demands=demands,
        vehicle_capacities=vehicle_capacities,
        depot_indices=depot_indices,
        optimization_params={"time_limit_seconds": 5},
        client_rules=client_rules,
        vehicle_rules=vehicle_rules,
        rules_matrix=[],
        client_cps=client_cps,
        vehicle_names=vehicle_names
    )
    
    routes = res.get("routes", [])
    assert len(routes) == 2, f"Esperavam-se 2 rotas, obtidas {len(routes)}"
    
    rota_lisboa = routes[0]
    rota_sintra = routes[1]
    
    print(f"Rota Lisboa (nós): {rota_lisboa}")
    print(f"Rota Sintra (nós): {rota_sintra}")
    
    # Verificar que os nós 1 e 2 (Lisboa) estão na Rota Lisboa
    for node in rota_lisboa:
        assert node in [1, 2], f"Nó {node} em rota de Lisboa não pertence a Lisboa!"
        
    # Verificar que os nós 3 e 4 (Sintra) estão na Rota Sintra
    for node in rota_sintra:
        assert node in [3, 4], f"Nó {node} em rota de Sintra não pertence a Sintra!"
        
    print("VRP CP Solver test passed successfully!")


def test_solver_with_rules_matrix_cp_prohibition():
    locations = [
        (38.75, -9.15),  # Armazém Central (0)
        (38.72, -9.14),  # Cliente 1 - Baixa (CP 1100-001)
        (38.73, -9.15),  # Cliente 2 - Saldanha (CP 1050-023)
    ]
    dist_matrix = [[10.0] * 3 for _ in range(3)]
    for i in range(3):
        dist_matrix[i][i] = 0.0

    demands = [0.0, 50.0, 50.0]
    vehicle_capacities = [1000.0, 1000.0]
    depot_indices = [0, 0]
    
    # Ambas as viaturas podem fazer Lisboa, mas V1 é PESADO e proibido na Baixa
    vehicle_rules = ["PESADO", "LIGEIRO"]
    vehicle_names = ["Camiao 01", "Carrinha 01"]
    client_cps = ["", "1100-001", "1050-023"]
    client_rules = ["", "", ""]
    
    rules_matrix = [
        {
            "tag_veiculo": "PESADO",
            "permissao": "NAO",
            "tag_entrega": "CP:1100..1200",
            "descricao": "Pesados proibidos na Baixa"
        }
    ]
    
    optimizer = AdvancedRouteOptimizer()
    res = optimizer.optimize_routes(
        distance_matrix=dist_matrix,
        demands=demands,
        vehicle_capacities=vehicle_capacities,
        depot_indices=depot_indices,
        optimization_params={"time_limit_seconds": 5},
        client_rules=client_rules,
        vehicle_rules=vehicle_rules,
        rules_matrix=rules_matrix,
        client_cps=client_cps,
        vehicle_names=vehicle_names
    )
    
    routes = res.get("routes", [])
    camiao_route = routes[0]
    carrinha_route = routes[1]
    
    print(f"Rota Camião (PESADO): {camiao_route}")
    print(f"Rota Carrinha (LIGEIRO): {carrinha_route}")
    
    # O nó 1 (Baixa) NÃO PODE estar na rota do camião
    assert 1 not in camiao_route, "Camião PESADO entrou indevidamente na Baixa (CP 1100)!"
    assert 1 in carrinha_route, "Carrinha LIGEIRO devia ter assumido a paragem da Baixa!"
    print("Rules Matrix CP Prohibition test passed successfully!")


if __name__ == "__main__":
    test_solver_with_cp_confinement()
    test_solver_with_rules_matrix_cp_prohibition()


def test_solver_never_crashes_on_inverted_or_zero_shift_times():
    """
    Garante que horários anómalos ou invertidos de viaturas (ex: fim < início ou turno de 0 min)
    NUNCA quebram o solver com CP Solver fail. O solver deve simplesmente deixar a viatura sem paragens
    e manter as entregas não atendidas em dropped_nodes (Por Distribuir).
    """
    locations = [
        (38.75, -9.15),  # Depósito
        (38.72, -9.14),  # Cliente 1
        (38.73, -9.15),  # Cliente 2
    ]
    dist_matrix = [[10.0] * 3 for _ in range(3)]
    for i in range(3):
        dist_matrix[i][i] = 0.0

    demands = [0.0, 50.0, 50.0]
    vehicle_capacities = [1000.0, 1000.0]
    depot_indices = [0, 0]

    # V0 tem fim (08:00 = 480m) ANTERIOR ao início (10:00 = 600m) - Erro típico de operador!
    # V1 tem fim (09:40 = 580m) IGUAL ao início (09:40 = 580m) - Turno de 0 minutos!
    v_starts = [600, 580]
    v_ends = [480, 580]

    optimizer = AdvancedRouteOptimizer()
    res = optimizer.optimize_routes(
        distance_matrix=dist_matrix,
        demands=demands,
        vehicle_capacities=vehicle_capacities,
        depot_indices=depot_indices,
        vehicle_start_times=v_starts,
        vehicle_end_times=v_ends,
        optimization_params={"time_limit_seconds": 3, "respect_time_windows": True},
        client_time_windows=[(0, 1440), (500, 700), (500, 700)]
    )

    assert res is not None, "O solver deve retornar uma estrutura válida sem crashar!"
    assert "routes" in res, "A resposta deve conter 'routes'!"
    assert "dropped_nodes" in res, "A resposta deve conter 'dropped_nodes'!"
    # Como as viaturas têm 0 tempo útil disponível, as paragens devem cair com segurança em dropped_nodes
    assert set(res["dropped_nodes"]) == {1, 2}, f"Esperava-se que os nós ficassem em dropped_nodes, obtidos: {res['dropped_nodes']}"
    print("Zero/Inverted Shift times resilience test passed with flying colors!")
