"""
Testes de Integração - Padrão Canónico de 9 Abas e Fluxos de Otimização
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import pandas as pd
from io import BytesIO
import openpyxl

from utils.template_manager import create_unified_project_template
from utils.export_engine import generate_full_project_excel
from utils.rules_engine import is_vehicle_compatible, extract_tags
from utils.optimization_solver import AdvancedRouteOptimizer


class TestCanonical9SheetsTemplate:
    """Testes para a geração do template oficial de 9 abas"""
    
    def test_create_unified_project_template(self):
        """Testar criação do template oficial de 9 abas"""
        excel_data = create_unified_project_template()
        
        assert isinstance(excel_data, bytes)
        assert len(excel_data) > 0
        
        wb = openpyxl.load_workbook(BytesIO(excel_data))
        sheet_names = wb.sheetnames
        
        expected_sheets = [
            "Armazéns",
            "Frota",
            "Entregas",
            "Regras",
            "Rotas",
            "Manifestos",
            "Motoristas e Carros",
            "Justificação entregas",
            "Instruções"
        ]
        
        for expected in expected_sheets:
            assert any(expected.lower() in s.lower() for s in sheet_names), f"Aba '{expected}' em falta no template"


class TestRulesEngine:
    """Testes para o motor de regras e compatibilidade multi-tag"""
    
    def test_extract_tags(self):
        """Testar extração de tags em colchetes ou separadores"""
        assert extract_tags("[PESADO][FRIO]") == {"PESADO", "FRIO"}
        assert extract_tags("URBANO, NOTURNO") == {"URBANO", "NOTURNO"}
        assert extract_tags(None) == set()
        
    def test_compatibility_simples(self):
        """Testar compatibilidade direta veículo-entrega"""
        assert is_vehicle_compatible("CARRINHA", "") is True
        assert is_vehicle_compatible("FRIGORIFICO", "FRIGORIFICO") is True
        assert is_vehicle_compatible("NORMAL", "FRIGORIFICO") is False

    def test_prohibition_and_permission_rules(self):
        """Testar regras explícitas de permissão e proibição"""
        rules = [
            {"Tag_Veiculo": "PESADO", "Permissao": "NAO", "Tag_Entrega": "CENTRO_HISTORICO"},
            {"Tag_Veiculo": "LIGEIRO", "Permissao": "SIM", "Tag_Entrega": "CENTRO_HISTORICO"}
        ]
        # Pesado é proibido
        assert is_vehicle_compatible("PESADO", "CENTRO_HISTORICO", rules) is False
        # Ligeiro tem permissão SIM
        assert is_vehicle_compatible("LIGEIRO", "CENTRO_HISTORICO", rules) is True
        # Veículo que tem diretamente a tag CENTRO_HISTORICO
        assert is_vehicle_compatible("[LIGEIRO][CENTRO_HISTORICO]", "CENTRO_HISTORICO", rules) is True


class TestEndToEndPipeline:
    """Testes de ponta a ponta do solver e exportação"""
    
    def test_full_pipeline_optimization_and_export(self):
        """Simular pipeline: Matriz -> Solver VRPTW -> Exportação 9 Abas"""
        optimizer = AdvancedRouteOptimizer()
        
        dist_matrix = [
            [0, 10, 15, 20, 25],
            [10, 0, 8, 12, 18],
            [15, 8, 0, 10, 15],
            [20, 12, 10, 0, 8],
            [25, 18, 15, 8, 0]
        ]
        demands = [0, 5.0, 5.0, 5.0, 5.0]
        caps = [20.0, 20.0]
        depots = [0, 0]
        
        solution = optimizer.optimize_routes(
            distance_matrix=dist_matrix,
            demands=demands,
            vehicle_capacities=caps,
            depot_indices=depots,
            optimization_params={"time_limit_seconds": 1.0}
        )
        
        assert "routes" in solution
        assert len(solution["routes"]) == 2
        
        # Testar exportação final com base no resultado
        routes_rows = []
        for v_idx, r_stops in enumerate(solution["routes"]):
            r_name = f"Rota {v_idx + 1}"
            for ord_idx, node_idx in enumerate(r_stops, start=1):
                routes_rows.append({
                    "Rota": r_name,
                    "Ordem": ord_idx,
                    "Cliente": f"Cliente {node_idx}",
                    "Morada": "Rua Exemplo, 10",
                    "CodPostal": "1000-001",
                    "Localidade": "Lisboa",
                    "Peso": 5.0,
                    "Volumes": 1,
                    "KM_Anterior": 10.0,
                    "Estado": "Entregue" if ord_idx == 1 else "Pendente",
                    "Hora_Picagem": "09:30" if ord_idx == 1 else "",
                    "Motorista": f"Motorista {v_idx + 1}",
                    "Viatura": f"Viatura {v_idx + 1}"
                })
        
        df_routes = pd.DataFrame(routes_rows)
        excel_bytes = generate_full_project_excel(routes_df=df_routes)
        
        assert isinstance(excel_bytes, bytes)
        assert len(excel_bytes) > 0
        
        wb = openpyxl.load_workbook(BytesIO(excel_bytes))
        assert len(wb.sheetnames) >= 7


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
