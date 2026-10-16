# -*- coding: utf-8 -*-
"""
Testes unitários para a taxonomia operacional D, P, From, To e curvas de carga.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.operation_types import (
    normalize_op_type,
    apply_sucata_heritage,
    extract_pickup_delivery_pairs,
    calculate_dynamic_route_loads
)


def test_normalize_op_type():
    assert normalize_op_type("D") == "D"
    assert normalize_op_type("ENTREGA") == "D"
    assert normalize_op_type("P") == "P"
    assert normalize_op_type("Sucata") == "P"
    assert normalize_op_type("recolha") == "P"
    assert normalize_op_type("From") == "From"
    assert normalize_op_type("LEVANTAMENTO") == "From"
    assert normalize_op_type("To") == "To"
    assert normalize_op_type("ENTREGA_LOJA") == "To"
    assert normalize_op_type(None) == "D"


def test_apply_sucata_heritage():
    # Entrega de frigorífico (80 kg) e linha de sucata sem peso especificado
    deliveries = [
        {"Doc_ID": "FT100", "Cliente": "João Silva", "Tipo_Operacao": "D", "Peso_KG": 80.0, "Volume_m3": 0.8},
        {"Doc_ID": "FT100-SUCATA", "Par_ID": "FT100", "Cliente": "João Silva", "Tipo_Operacao": "P", "Peso_KG": 0.0, "Volume_m3": 0.0}
    ]
    
    updated = apply_sucata_heritage(deliveries)
    sucata = updated[1]
    
    assert sucata["Peso_KG"] == 80.0, f"Sucata devia herdar 80 kg, tem {sucata['Peso_KG']}"
    assert sucata["Volume_m3"] == 0.8, f"Sucata devia herdar 0.8 m3, tem {sucata['Volume_m3']}"


def test_extract_pickup_delivery_pairs():
    deliveries = [
        {"Doc_ID": "LEV-01", "Par_ID": "ENC-999", "Tipo_Operacao": "From", "Cliente": "Loja Colombo"},
        {"Doc_ID": "CLI-01", "Tipo_Operacao": "D", "Cliente": "Carlos"},
        {"Doc_ID": "ENT-01", "Par_ID": "ENC-999", "Tipo_Operacao": "To", "Cliente": "Maria Santos"}
    ]
    
    pairs = extract_pickup_delivery_pairs(deliveries)
    assert len(pairs) == 1
    assert pairs[0] == (0, 2)  # Nó 0 (From) associado ao Nó 2 (To)


def test_calculate_dynamic_route_loads():
    # Viatura com 1000 kg capacidade
    # Rota:
    # 1. 'D' Entrega 400 kg (sai com 400 kg do armazém -> fica a 0 kg)
    # 2. 'From' Levanta 300 kg na loja -> fica a 300 kg
    # 3. 'To' Entrega os 300 kg no cliente -> fica a 0 kg
    # 4. 'P' Recolhe 200 kg de sucata -> fica a 200 kg até ao armazém
    stops = [
        {"Tipo_Operacao": "D", "Peso_KG": 400.0, "Volume_m3": 0.5},
        {"Tipo_Operacao": "From", "Peso_KG": 300.0, "Volume_m3": 0.3},
        {"Tipo_Operacao": "To", "Peso_KG": 300.0, "Volume_m3": 0.3},
        {"Tipo_Operacao": "P", "Peso_KG": 200.0, "Volume_m3": 0.2}
    ]
    
    res = calculate_dynamic_route_loads(stops, vehicle_cap_kg=1000.0, vehicle_cap_vol=10.0)
    
    assert res["initial_load_kg"] == 400.0, f"Carga inicial devia ser 400 kg, deu {res['initial_load_kg']}"
    assert res["final_load_kg"] == 200.0, f"Carga final (sucata) devia ser 200 kg, deu {res['final_load_kg']}"
    assert res["peak_load_kg"] == 400.0
    assert res["has_overload"] is False
    
    # Verificar evolução em cada paragem
    enriched = res["stops_with_loads"]
    assert enriched[0]["Carga_Acum"] == 0.0  # após entregar 400 kg
    assert enriched[1]["Carga_Acum"] == 300.0  # após levantar 300 kg
    assert enriched[2]["Carga_Acum"] == 0.0  # após entregar 300 kg
    assert enriched[3]["Carga_Acum"] == 200.0  # após recolher 200 kg sucata
    print("Todos os testes de tipos operacionais passaram com sucesso!")


if __name__ == "__main__":
    test_normalize_op_type()
    test_apply_sucata_heritage()
    test_extract_pickup_delivery_pairs()
    test_calculate_dynamic_route_loads()
