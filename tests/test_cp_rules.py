# -*- coding: utf-8 -*-
"""
Testes unitários para regras canónicas de Códigos Postais (CP) e Matriz de Regras.
"""
import pytest
from utils.rules_engine import (
    normalize_postal_code,
    matches_cp_pattern,
    is_vehicle_compatible,
    explain_incompatibility
)

def test_normalize_postal_code():
    res1 = normalize_postal_code("1050-023")
    assert res1["cp4"] == 1050
    assert res1["cp3"] == "023"
    assert res1["clean"] == "1050-023"
    assert res1["prefix2"] == "10"

    res2 = normalize_postal_code("2700")
    assert res2["cp4"] == 2700
    assert res2["clean"] == "2700"
    assert res2["prefix2"] == "27"

    res3 = normalize_postal_code(" 1100-001.0 ")
    assert res3["cp4"] == 1100
    assert res3["clean"] == "1100-001"

    res4 = normalize_postal_code(None)
    assert res4["cp4"] is None


def test_matches_cp_pattern_ranges():
    cp_info = normalize_postal_code("1050-023")
    
    # Range com ..
    assert matches_cp_pattern("CP:1000..1999", cp_info) is True
    assert matches_cp_pattern("1000..1999", cp_info) is True
    assert matches_cp_pattern("CP:2000..2999", cp_info) is False

    # Range com -
    assert matches_cp_pattern("CP:1000-1999", cp_info) is True
    assert matches_cp_pattern("CP:2600-2800", cp_info) is False

    # Prefixo com *
    assert matches_cp_pattern("CP:10*", cp_info) is True
    assert matches_cp_pattern("CP:1*", cp_info) is True
    assert matches_cp_pattern("CP:27*", cp_info) is False

    # CP exato
    assert matches_cp_pattern("CP:1050", cp_info) is True
    assert matches_cp_pattern("CP:1050-023", cp_info) is True
    assert matches_cp_pattern("CP:1050-999", cp_info) is False


def test_vehicle_confinement_by_cp():
    # Viatura restrita a Lisboa (1000..1999)
    v_tags = "[CP:1000..1999]"
    
    # Entrega em Lisboa
    assert is_vehicle_compatible(v_tags, "", delivery_cp="1050-023") is True
    
    # Entrega em Sintra (fora da zona de Lisboa)
    assert is_vehicle_compatible(v_tags, "", delivery_cp="2710-100") is False
    
    reason = explain_incompatibility(v_tags, "", delivery_cp="2710-100")
    assert "fora das zonas postais autorizadas" in reason.lower() or "código postal" in reason.lower()


def test_vehicle_blacklist_by_cp():
    # Viatura proibida no centro histórico (1100..1299)
    v_tags = "[!CP:1100..1299]"
    
    # Entrega normal Lisboa
    assert is_vehicle_compatible(v_tags, "", delivery_cp="1050-023") is True
    
    # Entrega na Baixa Chiado
    assert is_vehicle_compatible(v_tags, "", delivery_cp="1100-001") is False


def test_rules_matrix_prohibition_cp():
    rules_matrix = [
        {
            "tag_veiculo": "PESADO",
            "permissao": "NAO",
            "tag_entrega": "CP:1100..1200",
            "descricao": "Pesados proibidos na Baixa"
        }
    ]
    
    # Viatura PESADO a tentar entrar no CP 1150
    assert is_vehicle_compatible("PESADO", "", rules_matrix=rules_matrix, delivery_cp="1150-100") is False
    
    # Viatura LIGEIRO a tentar entrar no CP 1150 (permitido)
    assert is_vehicle_compatible("LIGEIRO", "", rules_matrix=rules_matrix, delivery_cp="1150-100") is True
    
    # Viatura PESADO fora da zona proibida (permitido)
    assert is_vehicle_compatible("PESADO", "", rules_matrix=rules_matrix, delivery_cp="1900-001") is True


def test_rules_matrix_zone_exclusivity():
    rules_matrix = [
        {
            "tag_veiculo": "ZONA_NORTE",
            "permissao": "SIM",
            "tag_entrega": "CP:4000..4999",
            "descricao": "Apenas frota do Norte opera no Porto"
        }
    ]
    
    # Viatura sem a tag ZONA_NORTE no Porto -> Rejeitada
    assert is_vehicle_compatible("ZONA_SUL", "", rules_matrix=rules_matrix, delivery_cp="4000-001") is False
    
    # Viatura com ZONA_NORTE no Porto -> Autorizada
    assert is_vehicle_compatible("ZONA_NORTE", "", rules_matrix=rules_matrix, delivery_cp="4000-001") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
