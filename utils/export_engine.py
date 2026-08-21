import pandas as pd
import io
import json
import math

def is_pending_route(routeName: str) -> bool:
    if not routeName:
        return True
    s = str(routeName).upper()
    return "PENDENTE" in s or "DISTRIBUIR" in s

def safe_float(val, default=0.0) -> float:
    if val is None or pd.isna(val):
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except Exception:
        return default

def safe_int(val, default=0) -> int:
    if val is None or pd.isna(val):
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return int(f)
    except Exception:
        return default

def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    R = 6371.0
    try:
        lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
        c = 2 * math.asin(math.sqrt(a))
        return R * c
    except Exception:
        return 0.0

def add_minutes_to_time(time_str: str, minutes_to_add: float) -> str:
    try:
        parts = (time_str or "07:00").split(":")
        h = int(parts[0])
        m = int(parts[1])
        total_m = h * 60 + m + int(round(minutes_to_add))
        new_h = (total_m // 60) % 24
        new_m = total_m % 60
        return f"{new_h:02d}:{new_m:02d}"
    except Exception:
        return time_str or "00:00"

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
    
    # 1. Clean and enrich routes_df
    df_clean = routes_df.copy() if routes_df is not None and not routes_df.empty else pd.DataFrame()
    
    # Ensure warehouse mapping
    wh_dict = {}
    default_wh = {"name": "Armazém Principal", "address": "Centro de Distribuição", "cp": "0000-000", "locality": "Principal", "lat": 38.6593, "lon": -9.1758}
    if warehouses_df is not None and not warehouses_df.empty:
        for _, wh in warehouses_df.iterrows():
            w_name = str(wh.get("Nome_Armazem", "Armazém Principal"))
            wh_dict[w_name] = {
                "name": w_name,
                "address": str(wh.get("Morada", "")),
                "cp": str(wh.get("CP", wh.get("Codigo_Postal", ""))),
                "locality": str(wh.get("Localidade", "")),
                "lat": safe_float(wh.get("Latitude"), 38.6593),
                "lon": safe_float(wh.get("Longitude"), -9.1758)
            }
        if wh_dict:
            default_wh = list(wh_dict.values())[0]

    # Ensure fleet info
    fleet_map = {}
    if fleet_config is not None:
        if isinstance(fleet_config, pd.DataFrame):
            for _, r in fleet_config.iterrows():
                v_name = str(r["Veiculo"])
                fleet_map[v_name] = {
                    "start_time": str(r.get("Horario_Inicio", "07:00")),
                    "end_time": str(r.get("Horario_Fim", "18:00")),
                    "speed": safe_float(r.get("Velocidade_Media"), 50.0),
                    "capacity_kg": safe_float(r.get("Capacidade_KG"), 1000.0),
                    "warehouse": str(r.get("Armazem", default_wh["name"]))
                }
        elif isinstance(fleet_config, dict):
            for k, v in fleet_config.items():
                if isinstance(v, dict):
                    fleet_map[str(k)] = {
                        "start_time": str(v.get("start_time", v.get("horario_inicio", "07:00"))),
                        "end_time": str(v.get("end_time", v.get("horario_fim", "18:00"))),
                        "speed": safe_float(v.get("speed", v.get("velocidade_media")), 50.0),
                        "capacity_kg": safe_float(v.get("capacity", v.get("capacidade_kg")), 1000.0),
                        "warehouse": str(v.get("warehouse", v.get("armazem", default_wh["name"])))
                    }
                else:
                    fleet_map[str(k)] = {
                        "start_time": str(getattr(v, "horario_inicio", "07:00")),
                        "end_time": str(getattr(v, "horario_fim", "18:00")),
                        "speed": safe_float(getattr(v, "velocidade_media", 50.0), 50.0),
                        "capacity_kg": safe_float(getattr(v, "capacidade_kg", 1000.0), 1000.0),
                        "warehouse": str(getattr(v, "armazem", default_wh["name"]))
                    }

    # Fill missing Armazem in df_clean
    if not df_clean.empty and "Rota" in df_clean.columns:
        for idx, row in df_clean.iterrows():
            r_name = str(row["Rota"])
            cur_wh = str(row.get("Armazem", "N/A"))
            if cur_wh in ["N/A", "", "nan", "None"]:
                assigned_wh = fleet_map.get(r_name, {}).get("warehouse", default_wh["name"])
                df_clean.at[idx, "Armazem"] = assigned_wh

    with pd.ExcelWriter(output, engine='xlsxwriter', engine_kwargs={'options': {'nan_inf_to_errors': True}}) as writer:
        workbook = writer.book
        
        # Styles
        title_fmt = workbook.add_format({'bold': True, 'font_size': 13, 'bg_color': '#1E293B', 'font_color': '#F8FAFC', 'valign': 'vcenter', 'border': 1, 'align': 'left'})
        sub_title_fmt = workbook.add_format({'bold': True, 'font_size': 10, 'bg_color': '#334155', 'font_color': '#E2E8F0', 'valign': 'vcenter', 'border': 1, 'align': 'left'})
        header_fmt = workbook.add_format({'bold': True, 'font_size': 10, 'bg_color': '#E2E8F0', 'font_color': '#0F172A', 'border': 1, 'align': 'center', 'valign': 'vcenter', 'text_wrap': True})
        
        depot_row_fmt = workbook.add_format({'bold': True, 'bg_color': '#EFF6FF', 'font_color': '#1D4ED8', 'border': 1, 'valign': 'vcenter'})
        depot_center_fmt = workbook.add_format({'bold': True, 'bg_color': '#EFF6FF', 'font_color': '#1D4ED8', 'border': 1, 'align': 'center', 'valign': 'vcenter'})
        depot_right_fmt = workbook.add_format({'bold': True, 'bg_color': '#EFF6FF', 'font_color': '#1D4ED8', 'border': 1, 'align': 'right', 'valign': 'vcenter', 'num_format': '#,##0.0'})
        
        cell_fmt = workbook.add_format({'border': 1, 'valign': 'vcenter', 'font_size': 9})
        cell_center = workbook.add_format({'border': 1, 'align': 'center', 'valign': 'vcenter', 'font_size': 9})
        cell_right = workbook.add_format({'border': 1, 'align': 'right', 'valign': 'vcenter', 'font_size': 9, 'num_format': '#,##0.0'})
        cell_wait = workbook.add_format({'border': 1, 'align': 'center', 'valign': 'vcenter', 'font_size': 9, 'bg_color': '#FEF3C7', 'font_color': '#B45309', 'bold': True})
        
        # 1. Rotas Detalhadas Sheet
        if not df_clean.empty:
            preferred_cols = [
                'Ordem', 'Rota', 'Armazem', 'Cliente', 'Nome_Cliente', 'Morada', 'CP', 'Localidade',
                'Janela_Horaria', 'Chegada', 'Tempo_Espera', 'Tempo_Entrega', 'Saida',
                'KM_Anterior', 'Dist_Acum', 'Peso_KG', 'Carga_Acum', 'Latitude', 'Longitude'
            ]
            export_cols = [c for c in preferred_cols if c in df_clean.columns] + [c for c in df_clean.columns if c not in preferred_cols and c not in ['id', 'ID_Original']]
            df_export = df_clean[export_cols].copy()
            df_export.to_excel(writer, index=False, sheet_name='Rotas_Detalhadas')
            
            ws_routes = writer.sheets['Rotas_Detalhadas']
            ws_routes.set_column('A:A', 8)
            ws_routes.set_column('B:C', 16)
            ws_routes.set_column('D:D', 14)
            ws_routes.set_column('E:E', 32)
            ws_routes.set_column('F:F', 40)
            ws_routes.set_column('G:H', 14)
            ws_routes.set_column('I:I', 18)
            ws_routes.set_column('J:M', 12)
            ws_routes.set_column('N:Q', 12)
            ws_routes.set_column('R:S', 12)

            # 2. Manifesto de Carga Sheet (Visual e Completo por Rota)
            ws_manifest = workbook.add_worksheet('Manifesto_Carga')
            manifest_headers = [
                'Ordem', 'Cód. Cliente', 'Nome do Cliente / Destino', 'Morada de Entrega',
                'C. Postal', 'Localidade', 'Janela Horária', 'Chegada', 'Espera (min)',
                'Serviço (min)', 'Saída', 'Dist. Km', 'Carga (kg)'
            ]
            
            curr_row = 0
            for r_name, group in df_clean.groupby('Rota', sort=False):
                is_pending = is_pending_route(r_name)
                v_info = fleet_map.get(r_name, {})
                wh_name = v_info.get("warehouse", default_wh["name"])
                wh_obj = wh_dict.get(wh_name, default_wh)
                
                start_time = v_info.get("start_time", "07:00")
                end_time = v_info.get("end_time", "18:00")
                speed = v_info.get("speed", 50.0)
                cap_kg = v_info.get("capacity_kg", 5000.0)
                
                # Sort route stops
                stops = group.sort_values(by="Ordem").copy()
                total_kg = safe_float(stops["Peso_KG"].sum() if "Peso_KG" in stops.columns else 0.0)
                
                # Header block
                if is_pending:
                    ws_manifest.merge_range(curr_row, 0, curr_row, len(manifest_headers) - 1, f"📦 ENCOMENDAS POR DISTRIBUIR ({len(stops)} paragens pendentes)", title_fmt)
                    curr_row += 1
                else:
                    ws_manifest.merge_range(curr_row, 0, curr_row, len(manifest_headers) - 1, f"🚚 MANIFESTO DE CARGA — VIATURA: {r_name} ({wh_obj['name']})", title_fmt)
                    curr_row += 1
                    info_text = f"Turno: {start_time} às {end_time} | Velocidade Média: {speed:.0f} km/h | Capacidade: {cap_kg:.0f} kg | Total Paragens: {len(stops)} | Carga Total: {total_kg:.1f} kg"
                    ws_manifest.merge_range(curr_row, 0, curr_row, len(manifest_headers) - 1, info_text, sub_title_fmt)
                    curr_row += 1
                
                # Table column headers
                for col_idx, h_text in enumerate(manifest_headers):
                    ws_manifest.write(curr_row, col_idx, h_text, header_fmt)
                curr_row += 1
                
                # Row 0: Partida do Armazém (if not pending)
                if not is_pending:
                    ws_manifest.write(curr_row, 0, "Partida", depot_center_fmt)
                    ws_manifest.write(curr_row, 1, "ARMAZÉM", depot_center_fmt)
                    ws_manifest.write(curr_row, 2, f"Partida: {wh_obj['name']}", depot_row_fmt)
                    ws_manifest.write(curr_row, 3, wh_obj["address"], depot_row_fmt)
                    ws_manifest.write(curr_row, 4, wh_obj["cp"], depot_center_fmt)
                    ws_manifest.write(curr_row, 5, wh_obj["locality"], depot_row_fmt)
                    ws_manifest.write(curr_row, 6, "--", depot_center_fmt)
                    ws_manifest.write(curr_row, 7, "--:--", depot_center_fmt)
                    ws_manifest.write(curr_row, 8, 0, depot_center_fmt)
                    ws_manifest.write(curr_row, 9, 0, depot_center_fmt)
                    ws_manifest.write(curr_row, 10, start_time, depot_center_fmt)
                    ws_manifest.write(curr_row, 11, 0.0, depot_right_fmt)
                    ws_manifest.write(curr_row, 12, round(total_kg, 1), depot_right_fmt)
                    curr_row += 1
                
                # Customer delivery stops
                last_lat = wh_obj["lat"]
                last_lon = wh_obj["lon"]
                last_saida = start_time
                cumul_dist = 0.0
                
                for _, s in stops.iterrows():
                    c_lat = safe_float(s.get("Latitude"), last_lat)
                    c_lon = safe_float(s.get("Longitude"), last_lon)
                    last_lat, last_lon = c_lat, c_lon
                    last_saida = str(s.get("Saida", "12:00") if pd.notna(s.get("Saida")) else "12:00")
                    cumul_dist = safe_float(s.get("Dist_Acum"), cumul_dist)
                    
                    wait_time = safe_int(s.get("Tempo_Espera"), 0)
                    wait_fmt = cell_wait if wait_time > 0 else cell_center
                    
                    ws_manifest.write(curr_row, 0, safe_int(s.get("Ordem"), 1), cell_center)
                    ws_manifest.write(curr_row, 1, str(s.get("Cliente", "")), cell_center)
                    ws_manifest.write(curr_row, 2, str(s.get("Nome_Cliente") or s.get("Cliente", "")), cell_fmt)
                    ws_manifest.write(curr_row, 3, str(s.get("Morada", "")), cell_fmt)
                    ws_manifest.write(curr_row, 4, str(s.get("CP", "")), cell_center)
                    ws_manifest.write(curr_row, 5, str(s.get("Localidade", "")), cell_fmt)
                    ws_manifest.write(curr_row, 6, str(s.get("Janela_Horaria", "Qualquer") if pd.notna(s.get("Janela_Horaria")) else "Qualquer"), cell_center)
                    ws_manifest.write(curr_row, 7, str(s.get("Chegada", "00:00") if pd.notna(s.get("Chegada")) else "00:00"), cell_center)
                    ws_manifest.write(curr_row, 8, wait_time, wait_fmt)
                    ws_manifest.write(curr_row, 9, safe_int(s.get("Tempo_Entrega"), 15), cell_center)
                    ws_manifest.write(curr_row, 10, str(s.get("Saida", "00:00") if pd.notna(s.get("Saida")) else "00:00"), cell_center)
                    ws_manifest.write(curr_row, 11, safe_float(s.get("KM_Anterior"), 0.0), cell_right)
                    ws_manifest.write(curr_row, 12, safe_float(s.get("Peso_KG"), 0.0), cell_right)
                    curr_row += 1
                
                # Row End: Regresso ao Armazém (if not pending)
                if not is_pending and len(stops) > 0:
                    ret_dist = haversine_distance(last_lat, last_lon, wh_obj["lat"], wh_obj["lon"])
                    ret_travel_min = (ret_dist / speed) * 60.0
                    return_arrival = add_minutes_to_time(last_saida, ret_travel_min)
                    total_route_km = cumul_dist + ret_dist
                    
                    ws_manifest.write(curr_row, 0, "Regresso", depot_center_fmt)
                    ws_manifest.write(curr_row, 1, "ARMAZÉM", depot_center_fmt)
                    ws_manifest.write(curr_row, 2, f"Regresso: {wh_obj['name']}", depot_row_fmt)
                    ws_manifest.write(curr_row, 3, wh_obj["address"], depot_row_fmt)
                    ws_manifest.write(curr_row, 4, wh_obj["cp"], depot_center_fmt)
                    ws_manifest.write(curr_row, 5, wh_obj["locality"], depot_row_fmt)
                    ws_manifest.write(curr_row, 6, f"Fim Turno: {end_time}", depot_center_fmt)
                    ws_manifest.write(curr_row, 7, return_arrival, depot_center_fmt)
                    ws_manifest.write(curr_row, 8, 0, depot_center_fmt)
                    ws_manifest.write(curr_row, 9, 0, depot_center_fmt)
                    ws_manifest.write(curr_row, 10, "--:--", depot_center_fmt)
                    ws_manifest.write(curr_row, 11, round(ret_dist, 1), depot_right_fmt)
                    ws_manifest.write(curr_row, 12, 0.0, depot_right_fmt)
                    curr_row += 1
                    
                    # Summary line for route
                    summary_fmt = workbook.add_format({'bold': True, 'bg_color': '#F1F5F9', 'border': 1, 'font_size': 9})
                    summary_right_fmt = workbook.add_format({'bold': True, 'bg_color': '#F1F5F9', 'border': 1, 'align': 'right', 'font_size': 9, 'num_format': '#,##0.0'})
                    ws_manifest.merge_range(curr_row, 0, curr_row, 10, f"TOTAL ROTA {r_name}: {len(stops)} paragens entregues | Saída {start_time} ➔ Regresso {return_arrival}", summary_fmt)
                    ws_manifest.write(curr_row, 11, round(total_route_km, 1), summary_right_fmt)
                    ws_manifest.write(curr_row, 12, round(total_kg, 1), summary_right_fmt)
                    curr_row += 1
                
                curr_row += 2 # gap between routes
            
            # Set Manifest Column widths
            ws_manifest.set_column('A:A', 10) # Ordem
            ws_manifest.set_column('B:B', 14) # Codigo
            ws_manifest.set_column('C:C', 34) # Nome
            ws_manifest.set_column('D:D', 42) # Morada
            ws_manifest.set_column('E:E', 12) # CP
            ws_manifest.set_column('F:F', 18) # Localidade
            ws_manifest.set_column('G:G', 18) # Janela
            ws_manifest.set_column('H:K', 12) # Chegada, Espera, Servico, Saida
            ws_manifest.set_column('L:M', 13) # Dist, Carga
            ws_manifest.set_landscape()
            ws_manifest.set_margins(left=0.4, right=0.4, top=0.4, bottom=0.4)

        # 3. Armazens Sheet
        if warehouses_df is not None and not warehouses_df.empty:
            warehouses_df.to_excel(writer, index=False, sheet_name='Armazens')
            ws_wh = writer.sheets['Armazens']
            ws_wh.set_column('A:B', 25)
            ws_wh.set_column('C:D', 15)
            ws_wh.set_column('E:F', 12)

        # 4. Frota Sheet
        if fleet_config is not None:
            fleet_rows = []
            if isinstance(fleet_config, pd.DataFrame):
                fleet_df_to_save = fleet_config
            elif isinstance(fleet_config, dict):
                for k, v in fleet_config.items():
                    if isinstance(v, dict):
                        fleet_rows.append({
                            "Veiculo": k,
                            "Capacidade_KG": v.get("capacity", v.get("capacidade_kg", 1000.0)),
                            "Cap_Volume_m3": v.get("capacity_volume", v.get("capacidade_vol", 5.0)),
                            "Custo_KM": v.get("cost_per_km", v.get("custo_km", 0.65)),
                            "Velocidade_Media": v.get("speed", v.get("velocidade_media", 50.0)),
                            "Horario_Inicio": v.get("start_time", v.get("horario_inicio", "07:00")),
                            "Horario_Fim": v.get("end_time", v.get("horario_fim", "18:00")),
                            "Armazem": v.get("warehouse", v.get("armazem", default_wh["name"]))
                        })
                    else:
                        fleet_rows.append({
                            "Veiculo": k,
                            "Capacidade_KG": getattr(v, "capacidade_kg", 1000.0),
                            "Cap_Volume_m3": getattr(v, "capacidade_vol", 5.0),
                            "Custo_KM": getattr(v, "custo_km", 0.65),
                            "Velocidade_Media": getattr(v, "velocidade_media", 50.0),
                            "Horario_Inicio": getattr(v, "horario_inicio", "07:00"),
                            "Horario_Fim": getattr(v, "horario_fim", "18:00"),
                            "Armazem": getattr(v, "armazem", default_wh["name"])
                        })
                fleet_df_to_save = pd.DataFrame(fleet_rows)
            else:
                fleet_df_to_save = pd.DataFrame()
            
            if not fleet_df_to_save.empty:
                fleet_df_to_save.to_excel(writer, index=False, sheet_name='Frota')
                ws_fl = writer.sheets['Frota']
                ws_fl.set_column('A:A', 18)
                ws_fl.set_column('B:E', 15)
                ws_fl.set_column('F:H', 20)

    output.seek(0)
    return output.getvalue()
