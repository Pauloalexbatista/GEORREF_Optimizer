import pytest
from utils.optimization_solver import AdvancedRouteOptimizer
from utils.distance_calculator import calculate_haversine_matrix
from backend.api.solver import diagnose_unassigned_delivery

def test_diagnose_unassigned_delivery_tags():
    # Teste 1: Regra configurada na matriz (FRIO exige viatura com tag FRIO)
    client_row = {
        "Regras": "[FRIO]",
        "Armazem": "Armazém Lisboa",
        "Peso_KG": 50.0,
        "Volume_m3": 0.5,
        "Total_Cx": 0,
        "Janela_Inicio": "08:00",
        "Janela_Fim": "18:00"
    }
    fleet_dict = {
        "Carrinha 01": {
            "warehouse": "Armazém Lisboa",
            "capacity": 1000.0,
            "regras": ""  # Sem tag FRIO
        }
    }
    rules_matrix = [{"Tag_Entrega": "FRIO", "Tag_Veiculo": "FRIO", "Permissao": "SIM"}]
    diag = diagnose_unassigned_delivery(client_row, "Armazém Lisboa", fleet_dict, rules_matrix=rules_matrix)
    assert "Sem viatura compatível" in diag or "não autorizadas" in diag
    assert "FRIO" in diag

def test_diagnose_unassigned_delivery_proximity():
    # Teste 2: Retida junto ao armazém
    client_row = {"Armazem": "Armazém Lisboa"}
    fleet_dict = {"Carrinha 01": {"warehouse": "Armazém Lisboa"}}
    diag = diagnose_unassigned_delivery(
        client_row, "Armazém Lisboa", fleet_dict,
        was_proximity_ejected=True,
        dist_km=2.4
    )
    assert "Retida junto ao armazém (2.4 km)" in diag

def test_adaptive_time_budget_and_coverage():
    # Teste 3: Cobertura e solver com tempo adaptativo
    locations = [
        (38.7436, -9.1602), # Armazém
        (38.7500, -9.1500), # Cliente 1 (perto)
        (38.7800, -9.1400), # Cliente 2 (médio)
        (38.9000, -9.1000), # Cliente 3 (longe)
    ]
    dist_mat = calculate_haversine_matrix(locations)
    demands = [0.0, 10.0, 10.0, 10.0]
    caps = [100.0]
    depots = [0]
    optimizer = AdvancedRouteOptimizer()
    res = optimizer.optimize_routes(
        dist_mat, demands, caps, depots,
        optimization_params={"time_limit_seconds": 10}
    )
    routes = res.get("routes", [])
    assert len(routes) > 0
