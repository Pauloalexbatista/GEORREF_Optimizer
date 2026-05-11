"""
Script para executar todos os testes do PRJT_GEO
用法: python run_tests.py
"""
import sys
import os

# Adicionar diretório principal ao path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pytest
import pandas as pd
from datetime import datetime


def run_tests():
    """Executar todos os testes e gerar relatório"""
    
    print("=" * 60)
    print(" PRJT_GEO - SUITE DE TESTES ")
    print("=" * 60)
    print(f"Iniciado: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    # Configurar pytest
    args = [
        "tests/",
        "-v",           # Verbose
        "--tb=short",   # Traceback curto
        "--color=yes",
        "-ra",          # Resumo de todos os testes
    ]
    
    # Executar testes
    exit_code = pytest.main(args)
    
    print()
    print("=" * 60)
    if exit_code == 0:
        print(" TODOS OS TESTES PASSARAM!")
    else:
        print(" ALGUNS TESTES FALHARAM")
    print("=" * 60)
    
    return exit_code


def quick_test():
    """Teste rapido - apenas imports e funcoes basicas"""
    print("[TEST] Teste Rapido: Verificando Imports...")
    
    try:
        # Testar imports principais
        from utils.geocoder_engine import WaterfallGeocoder
        from utils.optimization_solver import RouteOptimizer
        from utils.validation import is_in_portugal, validate_cp4
        from utils.template_manager import create_deliveries_template
        from utils.distance_calculator import calculate_haversine_matrix
        from utils.export_engine import generate_route_excel
        from utils.map_generator import generate_route_map_html
        from utils.schedule_generator import generate_route_schedule_html
        
        print("[OK] Todos os imports OK")
        
        # Testar funcoes basicas
        print("[TEST] Teste Rapido: Funcoes Basicas...")
        
        # Validation (CP4 = 4 digitos, CP7 = 4-3)
        assert validate_cp4("1000") == True  # CP4 valido
        assert validate_cp4("abcd") == False  # Letras sao invalidas
        assert validate_cp4("") == False  # String vazia
        assert is_in_portugal(38.7, -9.1) == True
        print("[OK] Validation OK")
        
        # Template
        template = create_deliveries_template()
        assert len(template) > 0
        print("[OK] Template OK")
        
        # Distance Calculator
        locations = [(38.7, -9.1), (41.1, -8.6)]
        matrix = calculate_haversine_matrix(locations)
        assert matrix[0][1] > 0
        print("[OK] Distance Calculator OK")
        
        print()
        print("=" * 60)
        print(" TESTE RAPIDO PASSOU! ")
        print("=" * 60)
        return 0
        
    except Exception as e:
        print(f"[ERRO] {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--quick":
        sys.exit(quick_test())
    else:
        sys.exit(run_tests())
