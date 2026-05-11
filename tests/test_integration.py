"""
Testes de Integração - Fluxos Completos
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pandas as pd
from io import BytesIO
import tempfile
from utils.template_manager import create_deliveries_template, create_fleet_warehouses_template
from utils.template_manager import validate_deliveries_file, validate_fleet_file


class TestTemplates:
    """Testes para geração e validação de templates"""
    
    def test_create_deliveries_template(self):
        """Testar criação de template de entregas"""
        excel_data = create_deliveries_template()
        
        # Deve retornar bytes
        assert isinstance(excel_data, bytes)
        assert len(excel_data) > 0
        
        # Deve ser possível ler como Excel (usar BytesIO para evitar warning)
        df = pd.read_excel(BytesIO(excel_data))
        assert len(df) > 0
        
        # Verificar colunas obrigatórias
        required_cols = ['Codigo_Cliente', 'Morada', 'Codigo_Postal', 'Concelho', 'Peso_KG']
        for col in required_cols:
            assert col in df.columns, f"Coluna {col} em falta"
    
    def test_create_fleet_template(self):
        """Testar criação de template de frota"""
        excel_data = create_fleet_warehouses_template()
        
        assert isinstance(excel_data, bytes)
        assert len(excel_data) > 0
        
        df = pd.read_excel(BytesIO(excel_data))
        assert len(df) > 0
        
        # Verificar colunas (template de armazens)
        required_cols = ['Nome_Armazem', 'Morada', 'CP', 'Localidade']
        for col in required_cols:
            assert col in df.columns


class TestValidationFiles:
    """Testes para validação de ficheiros"""
    
    def test_validate_deliveries_valid(self):
        """Validar ficheiro de entregas válido"""
        # Criar dados válidos (com todas as colunas obrigatórias)
        df = pd.DataFrame({
            'Codigo_Cliente': ['CL001', 'CL002'],
            'Morada': ['Rua da Prata, 10, Lisboa', 'Av. da Boavista, 100, Porto'],
            'Codigo_Postal': ['1100-001', '4100-001'],
            'Concelho': ['Lisboa', 'Porto'],
            'Peso_KG': [10.5, 25.0],
            'Prioridade': [1, 2],
            'Janela_Inicio': ['09:00', '09:00'],
            'Janela_Fim': ['18:00', '18:00'],
            'Observacoes': ['', '']
        })
        
        is_valid, msg = validate_deliveries_file(df)
        assert is_valid == True, f"Dados validos devem passar: {msg}"
    
    def test_validate_deliveries_invalid(self):
        """Validar ficheiro com dados inválidos"""
        # Dados em falta
        df = pd.DataFrame({
            'Codigo_Cliente': ['CL001'],
            'Morada': [None],  # Morada em falta
            'Codigo_Postal': ['0000-000'],  # CP inválido
        })
        
        is_valid, msg = validate_deliveries_file(df)
        assert is_valid == False, "Dados inválidos devem falhar"
    
    def test_validate_fleet_valid(self):
        """Validar frota válida"""
        df = pd.DataFrame({
            'Veiculo': ['Van 1', 'Van 2'],
            'Capacidade_KG': [500, 1000],
            'Custo_KM': [0.50, 0.60],
            'Velocidade_Media': [40, 50],
            'Horario_Inicio': ['08:00', '08:00'],
            'Horario_Fim': ['18:00', '18:00']
        })
        
        is_valid, msg = validate_fleet_file(df)
        assert is_valid == True


class TestEndToEnd:
    """Testes end-to-end simulando fluxos reais"""
    
    def test_full_pipeline_mock(self):
        """Simular pipeline completo: Excel → Geocoding → Otimização"""
        from utils.optimization_solver import RouteOptimizer
        
        # Usar matriz manual simples (evitar dependência de haversine para teste)
        # 0=Depot, 1-9=Clientes
        dist_matrix = [
            [0, 10, 15, 20, 25, 30, 35, 40, 45, 50],
            [10, 0, 8, 12, 18, 22, 28, 32, 38, 42],
            [15, 8, 0, 10, 15, 20, 25, 30, 35, 40],
            [20, 12, 10, 0, 8, 15, 20, 25, 30, 35],
            [25, 18, 15, 8, 0, 10, 18, 22, 28, 32],
            [30, 22, 20, 15, 10, 0, 12, 18, 22, 28],
            [35, 28, 25, 20, 18, 12, 0, 10, 15, 20],
            [40, 32, 30, 25, 22, 18, 10, 0, 8, 12],
            [45, 38, 35, 30, 28, 22, 15, 8, 0, 10],
            [50, 42, 40, 35, 32, 28, 20, 12, 10, 0]
        ]
        
        # 2. Otimizar rotas (2 veículos)
        optimizer = RouteOptimizer()
        solution = optimizer.solve_vrp(dist_matrix, num_vehicles=2, depot_index=0)
        
        # 4. Verificar solução
        assert solution['total_distance'] > 0, "Distancia deve ser maior que 0"
        assert len(solution['routes']) >= 1, "Deve ter pelo menos 1 rota"
        
        # Cada rota deve começar e acabar no depot
        for route in solution['routes']:
            assert route[0] == 0, "Rota deve comecar no depot"
            assert route[-1] == 0, "Rota deve acabar no depot"


class TestFailureHandling:
    """Testes para gestão de falhas"""
    
    def test_failure_handler_imports(self):
        """Verificar que failure_handler pode ser importado"""
        from utils.failure_handler import GeocodingFailureHandler
        assert GeocodingFailureHandler is not None
    
    def test_export_engines(self):
        """Verificar engines de exportação"""
        from utils.export_engine import generate_route_excel
        from utils.map_generator import generate_route_map_html
        from utils.schedule_generator import generate_route_schedule_html
        
        # Funções devem existir
        assert callable(generate_route_excel)
        assert callable(generate_route_map_html)
        assert callable(generate_route_schedule_html)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
