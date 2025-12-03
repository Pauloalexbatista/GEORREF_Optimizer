import pandas as pd
import io

def generate_route_excel(solution, locations, df_original):
    """
    Generates an Excel file with optimized routes.
    solution: Dict returned by RouteOptimizer {'routes': [[idx, ...], ...]}
    locations: List of (lat, lon) tuples used in optimization (0 is depot)
    df_original: Original DataFrame to retrieve address details
    """
    output = io.BytesIO()
    
    # Create a list to hold all route rows
    route_rows = []
    
    for v_idx, route_indices in enumerate(solution['routes']):
        vehicle_id = v_idx + 1
        
        for seq_id, loc_idx in enumerate(route_indices):
            # loc_idx is index in 'locations' list
            # locations[0] is Depot
            
            row_data = {
                'Veículo': f"Veículo {vehicle_id}",
                'Ordem': seq_id,
                'Tipo': 'Depósito' if loc_idx == 0 else 'Cliente',
                'Morada': 'Depósito' if loc_idx == 0 else '',
                'Latitude': locations[loc_idx][0],
                'Longitude': locations[loc_idx][1],
                'Link_Google': '',
                'Link_Waze': ''
            }
            
            if loc_idx != 0:
                # Retrieve original data
                # df_original index is loc_idx - 1
                original_row = df_original.iloc[loc_idx - 1]
                row_data['Morada'] = original_row.get('Morada_Encontrada', 'N/A')
                
                # Quality & Risk Logic
                q_level = original_row.get('Nivel_Qualidade', 8)
                row_data['Qualidade'] = q_level
                
                # Risk Warning
                risk_msg = ""
                try:
                    q_int = int(q_level)
                    if q_int >= 5:
                        risk_msg = "⚠️ Risco: Morada Genérica"
                    if q_int == 8:
                        risk_msg = "❌ Risco: Não Encontrada"
                except:
                    pass
                
                row_data['Risco_Aviso'] = risk_msg
                row_data['Input_Original'] = original_row.get('CP_Original', '') 
            
            # Generate Deep Links
            lat = row_data['Latitude']
            lon = row_data['Longitude']
            
            # Google Maps: https://www.google.com/maps/dir/?api=1&destination=lat,lon
            row_data['Link_Google'] = f"https://www.google.com/maps/dir/?api=1&destination={lat},{lon}"
            
            # Waze: https://waze.com/ul?ll=lat,lon&navigate=yes
            row_data['Link_Waze'] = f"https://waze.com/ul?ll={lat},{lon}&navigate=yes"
            
            route_rows.append(row_data)
            
    # Create DataFrame
    df_export = pd.DataFrame(route_rows)
    
    # Fill NaN values to prevent Excel errors
    df_export = df_export.fillna({
        'Morada': 'N/A',
        'Qualidade': 0,
        'Risco_Aviso': '',
        'Input_Original': '',
        'Latitude': 0.0,
        'Longitude': 0.0
    })
    
    # Write to Excel
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        # --- SHEET 1: ROUTES ---
        df_export.to_excel(writer, index=False, sheet_name='Rotas Otimizadas')
        
        workbook = writer.book
        worksheet = writer.sheets['Rotas Otimizadas']
        
        # Formats
        link_format = workbook.add_format({'font_color': 'blue', 'underline': 1})
        header_format = workbook.add_format({'bold': True, 'bg_color': '#D3D3D3'})
        risk_format = workbook.add_format({'font_color': 'red', 'bold': True})
        
        # Apply header format
        for col_num, value in enumerate(df_export.columns.values):
            worksheet.write(0, col_num, value, header_format)
            
        # Apply link format and Risk format
        col_idx_google = df_export.columns.get_loc('Link_Google')
        col_idx_waze = df_export.columns.get_loc('Link_Waze')
        col_idx_risk = df_export.columns.get_loc('Risco_Aviso') if 'Risco_Aviso' in df_export.columns else -1
        
        for row_num in range(len(df_export)):
            # Google Link
            google_url = df_export.iloc[row_num]['Link_Google']
            worksheet.write_url(row_num + 1, col_idx_google, google_url, link_format, string='Abrir Google Maps')
            
            # Waze Link
            waze_url = df_export.iloc[row_num]['Link_Waze']
            worksheet.write_url(row_num + 1, col_idx_waze, waze_url, link_format, string='Abrir Waze')
            
            # Risk Warning Color
            if col_idx_risk != -1:
                risk_val = df_export.iloc[row_num]['Risco_Aviso']
                if risk_val:
                    worksheet.write(row_num + 1, col_idx_risk, risk_val, risk_format)
            
        # Auto-adjust columns width (approx)
        worksheet.set_column(0, 0, 10) # Veiculo
        worksheet.set_column(3, 3, 50) # Morada
        worksheet.set_column(col_idx_risk, col_idx_risk, 25) # Risco
        
        # --- SHEET 2: LEGEND & DISCLAIMER ---
        ws_legend = workbook.add_worksheet('Legenda e Avisos')
        
        # Title
        title_format = workbook.add_format({'bold': True, 'font_size': 14})
        ws_legend.write('A1', 'Legenda de Qualidade de Geocoding', title_format)
        
        # Legend Table
        legend_data = [
            ['Nível', 'Descrição', 'Significado'],
            [0, 'Cliente', 'Coordenadas fornecidas pelo cliente. Não validadas.'],
            [1, 'Ouro', 'Rua + Número de Porta exato (Alta Confiança).'],
            [2, 'Prata', 'Rua + Código Postal 4 dígitos (Confiança Média-Alta).'],
            [3, 'Bronze', 'Centro do Código Postal 7 dígitos.'],
            [4, 'Ferro', 'Centro do Código Postal 4 dígitos (Área alargada).'],
            [5, 'Pedra', 'Centro da Localidade/Cidade (Risco de falha).'],
            [6, 'Concelho', 'Centro do Concelho (Muito genérico).'],
            [7, 'Distrito', 'Centro do Distrito (Inutilizável para entrega).'],
            [8, 'Falha', 'Morada não encontrada em nenhuma base de dados.']
        ]
        
        for i, row in enumerate(legend_data):
            for j, val in enumerate(row):
                fmt = header_format if i == 0 else None
                ws_legend.write(i+2, j, val, fmt)
                
        ws_legend.set_column(0, 0, 10)
        ws_legend.set_column(1, 1, 15)
        ws_legend.set_column(2, 2, 60)
        
        # Disclaimer
        ws_legend.write('A14', '⚠️ AVISO DE RESPONSABILIDADE', title_format)
        disclaimer_text = (
            "As rotas geradas baseiam-se na informação de morada fornecida. "
            "Entregas marcadas com 'Risco' (Níveis 5 a 8) indicam que a morada original era insuficiente "
            "para determinar uma localização exata. A responsabilidade pela precisão dos dados é do cliente. "
            "Recomenda-se a validação prévia destas moradas para evitar falhas na entrega."
        )
        text_wrap = workbook.add_format({'text_wrap': True})
        ws_legend.merge_range('A15:C20', disclaimer_text, text_wrap)

    return output.getvalue()
