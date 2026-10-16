"""
Testes unitários para o Copiloto IA & Negociador Tático:
1. Detetive de Notas Ocultas (`scan_delivery_notes_for_hidden_rules`)
2. Tradutor de Regras em Linguagem Natural para a Folha 4 (`parse_business_rules_with_llm`)
3. Auditor de Causa-Raiz, Negociador de Janelas, Cirurgião de Fronteiras e Consolidador de Frota (`analyze_unassigned_and_violations`)
"""

from utils.ai_rules_parser import scan_delivery_notes_for_hidden_rules, parse_business_rules_with_llm
from utils.agent_decision_core import analyze_unassigned_and_violations


def test_scan_delivery_notes_detects_windows_and_tags():
    deliveries = [
        {
            "id": 101,
            "Nome_Cliente": "Maria Sintra",
            "Rota": "Por Distribuir",
            "Observacoes": "Entregar só da parte da tarde, 4º andar sem elevador, levar 2 homens",
            "Janela_Inicio": "08:00",
            "Janela_Fim": "18:00",
            "Regras": "",
        },
        {
            "id": 102,
            "Nome_Cliente": "Restaurante Baixa",
            "Rota": "Carrinha 01",
            "Observacoes": "Rua estreita no centro histórico, produto congelado",
            "Janela_Inicio": "09:00",
            "Janela_Fim": "12:00",
            "Regras": "",
        },
    ]

    suggestions = scan_delivery_notes_for_hidden_rules(deliveries)
    assert len(suggestions) == 2

    s1 = suggestions[0]
    assert s1["delivery_id"] == 101
    assert s1["proposed_win_start"] == "14:00"
    assert s1["proposed_win_end"] == "18:00"
    assert "[2MAN]" in s1["proposed_tags"]

    s2 = suggestions[1]
    assert s2["delivery_id"] == 102
    assert "[ACESSO_RESTRITO]" in s2["proposed_tags"]
    assert "[FRIO]" in s2["proposed_tags"]


def test_parse_business_rules_deterministic_pt():
    res = parse_business_rules_with_llm(
        [
            "Viaturas PESADO não podem entrar no código postal 1100 a 1299",
            "Carrinha 02 proibida na Margem Sul",
        ],
        api_key="",  # Força o motor determinístico local a custo zero
    )
    assert res["status"] == "success"
    rules = res["rules"]
    assert len(rules) == 2
    assert rules[0]["Tag_Veiculo"] == "PESADO"
    assert rules[0]["Permissao"] == "PROIBIR"
    assert rules[0]["Tag_Entrega"] == "CP:1100..1299"

    assert "Carrinha 02" in rules[1]["Tag_Veiculo"]
    assert rules[1]["Permissao"] == "PROIBIR"
    assert rules[1]["Tag_Entrega"] == "CP:2800..2999"


def test_analyze_unassigned_and_border_swaps():
    routes_solution = [
        # Carrinha 01 (Zona Norte Lisboa, mas tem o ponto #3 desviado a Sul que fica colado à Carrinha 02)
        {
            "id": 1,
            "Nome_Cliente": "Cliente Norte A",
            "Rota": "Carrinha 01",
            "Ordem": 1,
            "Latitude": 38.7800,
            "Longitude": -9.1500,
            "CP": "1750-001",
            "Peso_KG": 50.0,
            "Volume_m3": 0.5,
            "Janela_Inicio": "08:00",
            "Janela_Fim": "18:00",
        },
        {
            "id": 2,
            "Nome_Cliente": "Cliente Norte B",
            "Rota": "Carrinha 01",
            "Ordem": 2,
            "Latitude": 38.7900,
            "Longitude": -9.1600,
            "CP": "1750-002",
            "Peso_KG": 50.0,
            "Volume_m3": 0.5,
            "Janela_Inicio": "08:00",
            "Janela_Fim": "18:00",
        },
        {
            "id": 3,
            "Nome_Cliente": "Cliente Fronteira Cascais",
            "Rota": "Carrinha 01",
            "Ordem": 3,
            "Latitude": 38.7000,
            "Longitude": -9.4200,
            "CP": "2750-001",
            "Peso_KG": 30.0,
            "Volume_m3": 0.3,
            "Janela_Inicio": "08:00",
            "Janela_Fim": "18:00",
        },
        # Carrinha 02 (Zona Cascais)
        {
            "id": 4,
            "Nome_Cliente": "Cliente Cascais A",
            "Rota": "Carrinha 02",
            "Ordem": 1,
            "Latitude": 38.6980,
            "Longitude": -9.4180,
            "CP": "2750-002",
            "Peso_KG": 40.0,
            "Volume_m3": 0.4,
            "Janela_Inicio": "08:00",
            "Janela_Fim": "18:00",
        },
        {
            "id": 5,
            "Nome_Cliente": "Cliente Cascais B",
            "Rota": "Carrinha 02",
            "Ordem": 2,
            "Latitude": 38.7020,
            "Longitude": -9.4220,
            "CP": "2750-003",
            "Peso_KG": 40.0,
            "Volume_m3": 0.4,
            "Janela_Inicio": "08:00",
            "Janela_Fim": "18:00",
        },
        # Cliente Pendente em Por Distribuir
        {
            "id": 6,
            "Nome_Cliente": "Cliente Pendente Janela Curta",
            "Rota": "Por Distribuir",
            "Ordem": 1,
            "Latitude": 38.7850,
            "Longitude": -9.1550,
            "CP": "1750-010",
            "Peso_KG": 25.0,
            "Volume_m3": 0.2,
            "Janela_Inicio": "08:00",
            "Janela_Fim": "08:05",
            "Observacoes": "Entregar só de manhã",
        },
    ]

    fleet_config = {
        "Carrinha 01": {
            "capacidade_kg": 1000.0,
            "capacidade_volume": 10.0,
            "horario_inicio": "08:00",
            "horario_fim": "18:00",
            "velocidade_media": 50.0,
            "custo_km": 0.65,
            "regras": "",
        },
        "Carrinha 02": {
            "capacidade_kg": 1000.0,
            "capacidade_volume": 10.0,
            "horario_inicio": "08:00",
            "horario_fim": "18:00",
            "velocidade_media": 50.0,
            "custo_km": 0.65,
            "regras": "",
        },
    }

    warehouses = [{"Nome_Armazem": "Armazém Central", "Latitude": 38.7223, "Longitude": -9.1393}]

    res = analyze_unassigned_and_violations(routes_solution, fleet_config, warehouses, rules_matrix=[])
    assert res["status"] == "success"
    assert res["unassigned_count"] == 1
    assert len(res["proposals"]) == 1
    # Deve detetar a troca de fronteira do cliente #3 (Cascais) da Carrinha 01 para a Carrinha 02
    assert len(res["border_swaps"]) >= 1
    assert res["border_swaps"][0]["delivery_id"] == 3
    assert res["border_swaps"][0]["to_route"] == "Carrinha 02"
    assert res["border_swaps"][0]["saved_km"] > 10.0
