"""
Geocoding Failure Handler Module

Handles analysis and management of geocoding failures (Level 8).
Provides functionality for:
- Analyzing failure reasons
- Exporting success/failure files
- Creating warehouse fallback routes
"""

import pandas as pd
from datetime import datetime
from io import BytesIO
from typing import Dict, List, Tuple


class FailureReport:
    """Container for failure analysis results"""
    
    def __init__(self, total: int, success: int, failures: int, 
                 failure_details: pd.DataFrame, failure_reasons: Dict[str, int]):
        self.total = total
        self.success = success
        self.failures = failures
        self.failure_details = failure_details
        self.failure_reasons = failure_reasons
        self.success_rate = (success / total * 100) if total > 0 else 0
        self.failure_rate = (failures / total * 100) if total > 0 else 0


class GeocodingFailureHandler:
    """Handles geocoding failures and provides recovery options"""
    
    @staticmethod
    def analyze_failures(df: pd.DataFrame, geocoding_results: List[Dict]) -> FailureReport:
        """
        Analyzes geocoding results and identifies failures.
        
        Args:
            df: Original dataframe with client data
            geocoding_results: List of geocoding result dictionaries
            
        Returns:
            FailureReport object with detailed analysis
        """
        # Add geocoding results to dataframe
        df_analysis = df.copy()
        
        # Extract nivel from results
        df_analysis['nivel'] = [r.get('nivel', 8) for r in geocoding_results]
        df_analysis['lat'] = [r.get('lat', None) for r in geocoding_results]
        df_analysis['lon'] = [r.get('lon', None) for r in geocoding_results]
        df_analysis['morada_encontrada'] = [r.get('morada_encontrada', '') for r in geocoding_results]
        df_analysis['fonte'] = [r.get('fonte', 'FALHA') for r in geocoding_results]
        
        # Identify failures (nivel 8)
        failure_mask = df_analysis['nivel'] == 8
        success_mask = df_analysis['nivel'] < 8
        
        total = len(df_analysis)
        failures = failure_mask.sum()
        success = success_mask.sum()
        
        # Get failure details
        failure_details = df_analysis[failure_mask].copy()
        
        # Analyze failure reasons
        failure_reasons = {}
        if failures > 0:
            failure_details['Motivo_Falha'] = failure_details.apply(
                GeocodingFailureHandler._get_failure_reason, axis=1
            )
            failure_reasons = failure_details['Motivo_Falha'].value_counts().to_dict()
        
        return FailureReport(
            total=total,
            success=success,
            failures=failures,
            failure_details=failure_details,
            failure_reasons=failure_reasons
        )
    
    @staticmethod
    def _get_failure_reason(row: pd.Series) -> str:
        """
        Determines the specific reason for geocoding failure.
        
        Args:
            row: DataFrame row with client data
            
        Returns:
            String describing the failure reason
        """
        import pandas as pd
        
        # Get values with proper pandas null handling
        morada = row.get('Morada', '')
        cp = row.get('Codigo_Postal', '')
        concelho = row.get('Concelho', '')
        
        # Convert to string and handle pandas NaN/None
        morada = str(morada).strip() if pd.notna(morada) else ''
        cp = str(cp).strip() if pd.notna(cp) else ''
        concelho = str(concelho).strip() if pd.notna(concelho) else ''
        
        reasons = []
        has_data = False  # Track if client has ANY valid data
        
        # Check for missing or invalid data
        if not morada or morada.lower() in ['nan', 'none', '']:
            reasons.append("Morada vazia")
        else:
            has_data = True
        
        # Enhanced CP validation
        if not cp or cp.lower() in ['nan', 'none', '']:
            reasons.append("Código Postal vazio")
        else:
            has_data = True
            # Remove hyphens and spaces for validation
            cp_clean = cp.replace('-', '').replace(' ', '')
            
            # Check if too short (need at least 4 digits for CP4)
            if len(cp_clean) < 4:
                reasons.append("Código Postal inválido (muito curto)")
            # Check if invalid patterns (all zeros, all nines, etc.)
            elif cp_clean[:4] in ['0000', '9999']:
                reasons.append("Código Postal inválido (não existe)")
            # Check if not numeric
            elif not cp_clean.isdigit():
                reasons.append("Código Postal inválido (formato incorreto)")
        
        if not concelho or concelho.lower() in ['nan', 'none', '']:
            reasons.append("Concelho vazio")
        else:
            has_data = True
        
        # If client has valid data but still failed, it's a lookup failure
        if not reasons and has_data:
            reasons.append("Endereço não encontrado em nenhuma fonte")
        elif not reasons and not has_data:
            reasons.append("Todos os campos vazios")
        
        return " | ".join(reasons)
    
    @staticmethod
    def export_success_file(df: pd.DataFrame, geocoding_results: List[Dict]) -> bytes:
        """
        Exports successfully geocoded clients to Excel.
        
        Args:
            df: Original dataframe
            geocoding_results: List of geocoding results
            
        Returns:
            Excel file as bytes
        """
        df_export = df.copy()
        
        # Add geocoding results
        df_export['Latitude'] = [r.get('lat', None) for r in geocoding_results]
        df_export['Longitude'] = [r.get('lon', None) for r in geocoding_results]
        df_export['Morada_Encontrada'] = [r.get('morada_encontrada', '') for r in geocoding_results]
        df_export['Nivel_Qualidade'] = [r.get('nivel', 8) for r in geocoding_results]
        df_export['Fonte'] = [r.get('fonte', 'FALHA') for r in geocoding_results]
        
        # Filter only successful geocoding (nivel < 8)
        df_success = df_export[df_export['Nivel_Qualidade'] < 8].copy()
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_success.to_excel(writer, sheet_name='Geocodificados', index=False)
        
        return output.getvalue()
    
    @staticmethod
    def export_failure_file(df: pd.DataFrame, geocoding_results: List[Dict]) -> bytes:
        """
        Exports failed geocoding clients to Excel with failure reasons.
        
        Args:
            df: Original dataframe
            geocoding_results: List of geocoding results
            
        Returns:
            Excel file as bytes
        """
        df_export = df.copy()
        
        # Add nivel
        df_export['Nivel_Qualidade'] = [r.get('nivel', 8) for r in geocoding_results]
        
        # Filter only failures (nivel 8)
        df_failures = df_export[df_export['Nivel_Qualidade'] == 8].copy()
        
        # Add failure reasons
        df_failures['Motivo_Falha'] = df_failures.apply(
            GeocodingFailureHandler._get_failure_reason, axis=1
        )
        
        # Add suggestions column (empty for now, can be enhanced later)
        df_failures['Sugestao_Correcao'] = ''
        
        # Reorder columns to put important ones first
        cols = list(df_failures.columns)
        priority_cols = ['Codigo_Cliente', 'Morada', 'Codigo_Postal', 'Concelho', 
                        'Motivo_Falha', 'Sugestao_Correcao']
        other_cols = [c for c in cols if c not in priority_cols]
        df_failures = df_failures[priority_cols + other_cols]
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df_failures.to_excel(writer, sheet_name='Falhas', index=False)
            
            # Add instructions sheet
            instructions = pd.DataFrame({
                'Instruções': [
                    '1. Corrija os dados nas colunas Morada, Codigo_Postal e Concelho',
                    '2. Certifique-se que todos os campos obrigatórios estão preenchidos',
                    '3. Use CP7 (1000-001) sempre que possível para maior precisão',
                    '4. Normalize os nomes dos concelhos (ex: Lisboa, Porto, Braga)',
                    '5. Evite abreviaturas (ex: Rua em vez de R.)',
                    '6. Após correção, volte a importar este ficheiro na aplicação'
                ]
            })
            instructions.to_excel(writer, sheet_name='Como Corrigir', index=False)
        
        return output.getvalue()
    
    @staticmethod
    def create_warehouse_fallback_route(failed_clients: pd.DataFrame, 
                                       warehouse_coords: Tuple[float, float]) -> Dict:
        """
        Creates a special route for non-geocoded clients using warehouse coordinates.
        
        Args:
            failed_clients: DataFrame with failed geocoding clients
            warehouse_coords: Tuple of (latitude, longitude) for warehouse
            
        Returns:
            Dictionary representing the special route
        """
        warehouse_lat, warehouse_lon = warehouse_coords
        
        # Create route data
        route = {
            'vehicle_name': '⚠️ Entregas Pendentes de Validação',
            'stops': [],
            'total_distance': 0,
            'total_time': 0,
            'total_cost': 0,
            'is_validation_route': True,  # Flag to identify this special route
            'warning': 'Esta rota contém clientes não geocodificados. Coordenadas são aproximadas (armazém).'
        }
        
        # Add each failed client as a stop
        for idx, client in failed_clients.iterrows():
            stop = {
                'codigo_cliente': client.get('Codigo_Cliente', f'Cliente_{idx}'),
                'morada_original': client.get('Morada', 'N/A'),
                'lat': warehouse_lat,
                'lon': warehouse_lon,
                'peso': client.get('Peso_KG', 0),
                'prioridade': client.get('Prioridade', 3),
                'observacoes': f"⚠️ GEOCODING FALHOU: {client.get('Morada', 'N/A')}",
                'is_approximate': True
            }
            route['stops'].append(stop)
        
        return route
    
    @staticmethod
    def get_failure_summary(report: FailureReport) -> str:
        """
        Generates a human-readable summary of failures.
        
        Args:
            report: FailureReport object
            
        Returns:
            Formatted string with failure summary
        """
        summary = f"""
📊 Resumo do Geocoding:
• Total processado: {report.total} clientes
• Sucesso: {report.success} ({report.success_rate:.1f}%)
• Falhas: {report.failures} ({report.failure_rate:.1f}%)

📋 Motivos das falhas:
"""
        for reason, count in report.failure_reasons.items():
            summary += f"• {count} cliente(s): {reason}\n"
        
        return summary
