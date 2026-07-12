import pandas as pd
import io
import json

def generate_route_excel(routes_df):
    return generate_full_project_excel(
        routes_df=routes_df,
        deliveries_df=None,
        warehouses_df=None,
        fleet_config=None,
        optimization_params=None
    )


def generate_full_project_excel(
    routes_df,
    deliveries_df=None,
    warehouses_df=None,
    fleet_config=None,
    optimization_params=None
):
    output = io.BytesIO()
    
    with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
        workbook = writer.book
        
        # 1. Rotas Detalhadas
        if routes_df is not None and not routes_df.empty:
            routes_df.to_excel(writer, index=False, sheet_name='Rotas_Detalhadas')
            
            # 2. Manifesto de Carga (Visual Guia)
            manifest_sheet = 'Manifesto_Carga'
            worksheet = workbook.add_worksheet(manifest_sheet)
            
            # Formats
            title_format = workbook.add_format({'bold': True, 'font_size': 14, 'bg_color': '#4F81BD', 'font_color': 'white', 'valign': 'vcenter', 'border': 1})
            header_format = workbook.add_format({'bold': True, 'bg_color': '#DCE6F1', 'border': 1, 'text_wrap': True, 'align': 'center'})
            cell_format = workbook.add_format({'border': 1, 'text_wrap': True})
            cell_center = workbook.add_format({'border': 1, 'align': 'center'})
            
            # Write visual manifest
            row_idx = 0
            if 'Rota' in routes_df.columns:
                # Group by Route
                for route_id, group in routes_df.groupby('Rota', sort=False):
                    # Route Header
                    worksheet.merge_range(row_idx, 0, row_idx, 8, f"MANIFESTO DE CARGA - ROTA: {route_id}", title_format)
                    row_idx += 2
                    
                    # Columns to print
                    cols = ['Ordem', 'Cliente', 'Morada', 'CP', 'Localidade', 'Janela_Horaria', 'Chegada', 'Tempo_Entrega', 'Saida']
                    # Verify cols exist
                    cols = [c for c in cols if c in group.columns]
                    
                    # Write Table Headers
                    for col_num, col_name in enumerate(cols):
                        worksheet.write(row_idx, col_num, col_name, header_format)
                    row_idx += 1
                    
                    # Write Data
                    for _, row_data in group.iterrows():
                        for col_num, col_name in enumerate(cols):
                            val = row_data[col_name]
                            if pd.isna(val): val = ""
                            fmt = cell_center if col_name in ['Ordem', 'Chegada', 'Saida', 'Tempo_Entrega'] else cell_format
                            worksheet.write(row_idx, col_num, val, fmt)
                        row_idx += 1
                        
                    # Add some empty space and page break
                    worksheet.set_h_pagebreaks([row_idx])
                    row_idx += 2
                
                # Column widths
                worksheet.set_column('A:A', 8)
                worksheet.set_column('B:B', 15)
                worksheet.set_column('C:C', 45)
                worksheet.set_column('D:E', 15)
                worksheet.set_column('F:F', 15)
                worksheet.set_column('G:I', 10)
                
                worksheet.set_landscape()
                worksheet.set_margins(left=0.5, right=0.5, top=0.5, bottom=0.5)
        else:
            pd.DataFrame({'Aviso': ['Sem dados de rotas']}).to_excel(writer, index=False, sheet_name='Rotas_Detalhadas')
            
        # 3. Entregas
        if deliveries_df is not None and not deliveries_df.empty:
            deliveries_df.to_excel(writer, index=False, sheet_name='Entregas')
            
        # 4. Armazens
        if warehouses_df is not None and not warehouses_df.empty:
            warehouses_df.to_excel(writer, index=False, sheet_name='Armazens')
            
        # 5. Frota
        if fleet_config is not None:
            fleet_list = []
            if isinstance(fleet_config, dict):
                for k, v in fleet_config.items():
                    v_dict = {}
                    # handle custom objects by accessing dict or __dict__
                    if hasattr(v, 'dict') and callable(getattr(v, 'dict')):
                        v_dict = v.dict()
                    elif hasattr(v, '__dict__'):
                        v_dict = v.__dict__.copy()
                    elif isinstance(v, dict):
                        v_dict = v.copy()
                    else:
                        v_dict = {'Info': str(v)}
                    
                    v_dict['Veiculo'] = k
                    # filter out internal stuff like __type__
                    v_dict = {key: val for key, val in v_dict.items() if not key.startswith('__')}
                    fleet_list.append(v_dict)
                df_fleet = pd.DataFrame(fleet_list)
                if 'Veiculo' in df_fleet.columns:
                    cols = ['Veiculo'] + [c for c in df_fleet.columns if c != 'Veiculo']
                    df_fleet = df_fleet[cols]
                df_fleet.to_excel(writer, index=False, sheet_name='Frota')
            elif isinstance(fleet_config, list):
                pd.DataFrame(fleet_config).to_excel(writer, index=False, sheet_name='Frota')
                
        # 6. Planeamento_Opcoes
        if optimization_params is not None:
            if isinstance(optimization_params, dict):
                opts = [{'Parametro': k, 'Valor': str(v)} for k, v in optimization_params.items()]
                pd.DataFrame(opts).to_excel(writer, index=False, sheet_name='Planeamento_Opcoes')
                
    return output.getvalue()
