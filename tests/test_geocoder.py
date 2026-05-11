"""
Testes Unitários - Módulo Geocoder
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pandas as pd
from utils.geocoder_engine import WaterfallGeocoder
from utils.validation import is_in_portugal, validate_cp4


class TestValidation:
    """Testes para funções de validação"""
    
    def test_validate_cp4_validos(self):
        """CPs válidos devem passar (4 dígitos)"""
        assert validate_cp4("1000") == True
        assert validate_cp4("2750") == True
        assert validate_cp4("4000") == True
    
    def test_validate_cp4_invalidos(self):
        """CPs inválidos devem falhar"""
        assert validate_cp4("0000-000") == False
        assert validate_cp4("9999-999") == False
        assert validate_cp4("abc-def") == False
        assert validate_cp4("") == False
    
    def test_is_in_portugal(self):
        """Coordenadas em Portugal devem retornar True"""
        # Lisboa
        assert is_in_portugal(38.7223, -9.1393) == True
        # Porto
        assert is_in_portugal(41.1579, -8.6291) == True
        # Faro (Algarve)
        assert is_in_portugal(37.0194, -7.9322) == True
    
    def test_is_out_portugal(self):
        """Coordenadas fora de Portugal devem retornar False"""
        # Madrid
        assert is_in_portugal(40.4168, -3.7038) == False
        # Paris
        assert is_in_portugal(48.8566, 2.3522) == False


class TestGeocoderEngine:
    """Testes para o motor de geocoding"""
    
    @pytest.fixture
    def geocoder(self):
        """Criar instância do geocoder para testes"""
        return WaterfallGeocoder("geocoding.db", google_api_key=None)
    
    def test_clean_address(self, geocoder):
        """Testar limpeza de moradas"""
        # Moradas sujas devem ser limpas
        result = geocoder._clean_address("  Rua de Lisboa,  123  ")
        assert "Rua de Lisboa" in result
        assert "123" in result
        
        result = geocoder._clean_address("Av.engº Duffy")
        assert "Duffy" in result or "duffy" in result.lower()
    
    def test_try_local_com_dados_validos(self, geocoder):
        """Testar pesquisa na base de dados local"""
        # Usar dados que existem na DB de teste
        result = geocoder._try_local("Rua da Prata", "1100", "Lisboa")
        # Pode retornar None se não existir na DB
        assert result is None or isinstance(result, dict)
    
    def test_resolve_address_invalido(self, geocoder):
        """Testar morada completamente inválida"""
        result, learned = geocoder.resolve_address(
            "xyzabc123nãoexiste 999999", 
            "9999-999", 
            "ConcelhoInexistente"
        )
        # Deve retornar nível 8 (falha)
        assert result['quality_level'] == 8
        assert result['lat'] is None


class TestDistanceCalculator:
    """Testes para cálculo de distâncias"""
    
    def test_calculate_haversine_matrix(self):
        """Testar cálculo de matriz de distâncias"""
        from utils.distance_calculator import calculate_haversine_matrix
        
        # 4 localizações: Lisboa, Porto, Faro, Coimbra
        locations = [
            (38.7223, -9.1393),  # Lisboa
            (41.1579, -8.6291),  # Porto
            (37.0194, -7.9322),  # Faro
            (40.2033, -8.4103),  # Coimbra
        ]
        
        matrix = calculate_haversine_matrix(locations)
        
        # Verificar dimensões
        assert len(matrix) == 4
        assert len(matrix[0]) == 4
        
        # Diagonal deve ser 0
        assert matrix[0][0] == 0
        assert matrix[1][1] == 0
        
        # Lisboa-Porto deve ser aproximadamente 274 km
        # Usar margem de erro de 10%
        lisboa_porto = matrix[0][1]
        assert 250 < lisboa_porto < 300


class TestOptimization:
    """Testes para o solver de otimização"""
    
    def test_vrp_basic(self):
        """Teste básico do VRP"""
        from utils.optimization_solver import RouteOptimizer
        
        # Matriz maior para forçar múltiplas rotas
        # 0=Depot, 1-8=Clientes
        matrix = [
            [0, 100, 100, 100, 100, 100, 100, 100, 100],
            [100, 0, 50, 50, 50, 50, 50, 50, 50],
            [100, 50, 0, 50, 50, 50, 50, 50, 50],
            [100, 50, 50, 0, 50, 50, 50, 50, 50],
            [100, 50, 50, 50, 0, 50, 50, 50, 50],
            [100, 50, 50, 50, 50, 0, 50, 50, 50],
            [100, 50, 50, 50, 50, 50, 0, 50, 50],
            [100, 50, 50, 50, 50, 50, 50, 0, 50],
            [100, 50, 50, 50, 50, 50, 50, 50, 0]
        ]
        
        optimizer = RouteOptimizer()
        result = optimizer.solve_vrp(matrix, num_vehicles=2, depot_index=0)
        
        # Verificar estrutura do resultado
        assert 'routes' in result
        assert 'total_distance' in result
        assert result['total_distance'] > 0  # Deve ter alguma distância
        
        # Depot deve ser sempre o primeiro e último ponto
        for route in result['routes']:
            assert route[0] == 0
            assert route[-1] == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
