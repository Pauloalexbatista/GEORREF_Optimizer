"""
Testes Unitários - Módulo Geocoder & Otimização
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pandas as pd
from utils.geocoder_engine import WaterfallGeocoder
from utils.validation import is_in_portugal, validate_cp4
from utils.distance_calculator import calculate_haversine_matrix
from utils.optimization_solver import AdvancedRouteOptimizer


class TestValidation:
    """Testes para funções de validação"""
    
    def test_validate_cp4_validos(self):
        """CPs válidos devem passar (4 dígitos)"""
        assert validate_cp4("1000") is True
        assert validate_cp4("2750") is True
        assert validate_cp4("4000") is True
    
    def test_validate_cp4_invalidos(self):
        """CPs inválidos devem falhar"""
        assert validate_cp4("0000-000") is False
        assert validate_cp4("9999-999") is False
        assert validate_cp4("abc-def") is False
        assert validate_cp4("") is False
    
    def test_is_in_portugal(self):
        """Coordenadas em Portugal devem retornar True"""
        # Lisboa
        assert is_in_portugal(38.7223, -9.1393) is True
        # Porto
        assert is_in_portugal(41.1579, -8.6291) is True
        # Faro (Algarve)
        assert is_in_portugal(37.0194, -7.9322) is True
    
    def test_is_out_portugal(self):
        """Coordenadas fora de Portugal devem retornar False"""
        # Madrid
        assert is_in_portugal(40.4168, -3.7038) is False
        # Paris
        assert is_in_portugal(48.8566, 2.3522) is False


class TestGeocoderEngine:
    """Testes para o motor de geocoding em cascata"""
    
    @pytest.fixture
    def geocoder(self):
        """Criar instância do geocoder para testes"""
        return WaterfallGeocoder("geocoding.db", google_api_key=None)
    
    def test_clean_address(self, geocoder):
        """Testar limpeza de moradas"""
        result = geocoder._clean_address("  Rua de Lisboa,  123  ")
        assert "Rua de Lisboa" in result
        assert "123" in result
        
        result = geocoder._clean_address("Av.engº Duffy")
        assert "Duffy" in result or "duffy" in result.lower()
    
    def test_try_local_com_dados_validos(self, geocoder):
        """Testar pesquisa na base de dados local"""
        result = geocoder._try_local("Rua da Prata", "1100", "Lisboa")
        assert result is None or isinstance(result, dict)
    
    def test_resolve_address_invalido(self, geocoder):
        """Testar morada completamente inválida"""
        result, learned = geocoder.resolve_address(
            "xyzabc123nãoexiste 999999", 
            "9999-999", 
            "ConcelhoInexistente"
        )
        assert result['quality_level'] == 8
        assert result['lat'] is None


class TestDistanceCalculator:
    """Testes para cálculo de distâncias Haversine calibrado"""
    
    def test_calculate_haversine_matrix(self):
        """Testar cálculo de matriz de distâncias Haversine"""
        locations = [
            (38.7223, -9.1393),  # Lisboa
            (41.1579, -8.6291),  # Porto
            (37.0194, -7.9322),  # Faro
            (40.2033, -8.4103),  # Coimbra
        ]
        
        matrix = calculate_haversine_matrix(locations)
        
        assert len(matrix) == 4
        assert len(matrix[0]) == 4
        assert matrix[0][0] == 0
        assert matrix[1][1] == 0
        
        # Lisboa-Porto deve ser ~270-360 km (com fator rodoviário 1.3)
        lisboa_porto = matrix[0][1]
        assert 250 < lisboa_porto < 400


class TestOptimization:
    """Testes para o solver OR-Tools VRPTW"""
    
    def test_vrp_basic(self):
        """Teste do algoritmo OR-Tools VRPTW"""
        optimizer = AdvancedRouteOptimizer()
        
        # 0=Depot, 1-3=Clientes
        dist_matrix = [
            [0, 10, 15, 20],
            [10, 0, 8, 12],
            [15, 8, 0, 10],
            [20, 12, 10, 0]
        ]
        demands = [0, 5, 5, 5]
        capacities = [15.0, 15.0]
        depots = [0, 0]
        
        result = optimizer.optimize_routes(
            distance_matrix=dist_matrix,
            demands=demands,
            vehicle_capacities=capacities,
            depot_indices=depots,
            optimization_params={"time_limit_seconds": 1.0}
        )
        
        assert "routes" in result
        assert isinstance(result["routes"], list)
        assert len(result["routes"]) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
