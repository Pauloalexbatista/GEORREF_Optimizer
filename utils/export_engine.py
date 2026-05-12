import pandas as pd
import io

def generate_route_excel(routes_df):
    """
    Generates an Excel file with optimized routes using the integrated dataframe.
    Args:
        routes_df: Full Pandas DataFrame derived from Phase3Planning.
    """
    output = io.BytesIO()
    
    # Ensure df is working copy
    df_export = routes_df.copy()
    
    # 1. Generate dynamic risk flags based on Nivel_Qualidade
    def get_risk(q):
        try:
            q_int = int(q)
            if q_int >= 5:
                return "⚠️ Risco: Morada Genérica"
            if q_int == 8:
                return "❌ Risco: Não Encontrada"
        except:
            pass
        return ""
    
    if 'Nivel_Qualidade' in df_export.columns:
        df_export['Risco_Aviso'] = df_export['Nivel_Qualidade'].apply(get_risk)
    else:
        df_export['Risco_Aviso'] = ""

    # 2. Generate Deep Links
    def get_gmaps_link(row):
        return f"https://www.google.com/maps/dir/?api=1&destination={row['Latitude']},{row['Longitude']}"
    
    def get_waze_link(row):
        return f"https://waze.com/ul?ll={row['Latitude']},{row['Longitude']}&navigate=yes"
        
    df_export['Link_Google'] = df_export.apply(get_gmaps_link, axis=1)
    df_export['Link_Waze'] = df_export.apply(get_waze_link, axis=1)
    
    # Fill NaN values to prevent Excel errors
    df_export = df_export.fillna("")
    
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
        worksheet.set_column(0, 0, 15) # Rota
        worksheet.set_column(1, 1, 8)  # Ordem
        worksheet.set_column(3, 3, 40) # Morada
        worksheet.set_column(4, 4, 10) # CP
        
        # --- SHEET 2: LEGEND & DISCLAIMER ---
        ws_legend = workbook.add_worksheet('Legenda e Avisos')
        
        # Title
        title_format = workbook.add_format({'bold': True, 'font_size': 14})
        ws_legend.write('A1', 'Legenda de Qualidade de Geocoding', title_format)
        
        # Legend Table
        legend_data = [
            ['Nível', 'Descrição', 'Significado'],
            [0, 'Cliente', 'Coordenadas fornecidas pelo cliente ou corrigidas manualmente.'],
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
