from fastapi import UploadFile, File



from fastapi import APIRouter, HTTPException, Depends



from pydantic import BaseModel



from typing import List, Dict, Any, Optional



import os
DB_MULTI_PATH = os.getenv("DB_MULTI_PATH", "geocoding_multi.db")
DB_GEO_PATH = os.getenv("DB_GEO_PATH", "geocoding.db")





import sys



import pandas as pd



import json







# Resolve imports from root



sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))



from database import get_db, get_projeto



from utils.geocoder_engine import WaterfallGeocoder



from utils.persistence_manager import serialize_state, deserialize_state



from backend.api.auth import get_current_user, UserResponse







router = APIRouter(prefix="/fleet", tags=["fleet"])







class WarehouseItem(BaseModel):



    name: str



    address: str



    cp: str



    locality: str







class WarehouseGeocoded(BaseModel):



    name: str



    address: str



    cp: str



    locality: str



    lat: float



    lon: float



    quality: int







class VehicleItem(BaseModel):



    veiculo: str



    armazem: str



    capacidade_kg: float



    capacidade_vol: float



    custo_km: float



    velocidade_media: float



    horario_inicio: str



    horario_fim: str







class FleetSaveRequest(BaseModel):



    fleet: List[VehicleItem]



    warehouses: List[WarehouseGeocoded]







@router.post("/geocode-warehouses", response_model=List[WarehouseGeocoded])



def geocode_warehouses(warehouses: List[WarehouseItem], current_user: UserResponse = Depends(get_current_user)):



    google_api_key = current_user.google_api_key if hasattr(current_user, "google_api_key") else None



    if not google_api_key:



        from database import get_google_api_key



        google_api_key = get_google_api_key()



        



    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_MULTI_PATH)



    geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)



    



    res = []



    for wh in warehouses:



        try:
            res_tuple = geocoder.resolve_address(f"{wh.address}, {wh.locality}", wh.cp, wh.locality)
            r_coords = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
        except Exception:
            r_coords = None



            



        if r_coords and r_coords.get("lat") and r_coords.get("lon"):



            lat = r_coords["lat"]



            lon = r_coords["lon"]



            quality = r_coords.get("quality_level", 1)



        else:



            lat = 0.0



            lon = 0.0



            quality = 99  # Failed indicator



            



        res.append(WarehouseGeocoded(



            name=wh.name,



            address=wh.address,



            cp=wh.cp,



            locality=wh.locality,



            lat=lat,



            lon=lon,



            quality=quality



        ))



    return res







@router.get("/template/unified")
def download_unified_template(current_user: UserResponse = Depends(get_current_user)):
    from utils.template_manager import create_unified_project_template
    from fastapi.responses import Response
    
    template_data = create_unified_project_template()
    return Response(
        content=template_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=GeoRoutePlan.xlsx"}
    )


@router.get("/{project_id}")



def get_fleet_config(project_id: int, current_user: UserResponse = Depends(get_current_user)):



    proj = get_projeto(project_id)



    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):



        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")



        



    try:



        with get_db() as conn:



            cursor = conn.cursor()



            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))



            row = cursor.fetchone()



            



            if not row:



                return {"fleet": [], "warehouses": []}



                



            state_dict = deserialize_state(row["payload_json"])



            



            raw_wh = state_dict.get("warehouses_geocoded")



            warehouses_res = []



            if raw_wh is not None:



                if isinstance(raw_wh, pd.DataFrame):



                    df_wh = raw_wh



                else:



                    df_wh = pd.DataFrame(raw_wh)



                    



                if not df_wh.empty:



                    for idx, r in df_wh.iterrows():



                        warehouses_res.append({



                            "name": r.get("Nome_Armazem", r.get("name", "")),



                            "address": r.get("Morada", r.get("address", "")),



                            "cp": r.get("CP", r.get("cp", "")),



                            "locality": r.get("Localidade", r.get("locality", "")),



                            "lat": float(r.get("Latitude", r.get("lat", 0.0))),



                            "lon": float(r.get("Longitude", r.get("lon", 0.0))),



                            "quality": int(r.get("Nivel_Qualidade", r.get("quality", 1)))



                        })



            



            raw_fleet = state_dict.get("fleet_config")



            fleet_res = []



            if raw_fleet is not None:



                for veh_name, veh in raw_fleet.items():



                    if hasattr(veh, "capacidade_kg"):



                        fleet_res.append({



                            "veiculo": veh_name,



                            "armazem": getattr(veh, "armazem", ""),



                            "capacidade_kg": getattr(veh, "capacidade_kg", 0.0),



                            "capacidade_vol": getattr(veh, "capacidade_vol", 0.0),



                            "custo_km": getattr(veh, "custo_km", 0.0),



                            "velocidade_media": getattr(veh, "velocidade_media", 0.0),



                            "horario_inicio": getattr(veh, "horario_inicio", "08:00"),



                            "horario_fim": getattr(veh, "horario_fim", "18:00")



                        })



                    elif isinstance(veh, dict):



                        fleet_res.append({



                            "veiculo": veh_name,



                            "armazem": veh.get("armazem", ""),



                            "capacidade_kg": veh.get("capacidade_kg", 0.0),



                            "capacidade_vol": veh.get("capacidade_vol", 0.0),



                            "custo_km": veh.get("custo_km", 0.0),



                            "velocidade_media": veh.get("velocidade_media", 0.0),



                            "horario_inicio": veh.get("horario_inicio", "08:00"),



                            "horario_fim": veh.get("horario_fim", "18:00")



                        })



                        



            return {"fleet": fleet_res, "warehouses": warehouses_res}



    except Exception as e:



        raise HTTPException(status_code=500, detail=str(e))







@router.post("/{project_id}")



def save_fleet_config(project_id: int, req: FleetSaveRequest, current_user: UserResponse = Depends(get_current_user)):



    proj = get_projeto(project_id)



    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):



        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")



        



    try:



        with get_db() as conn:



            cursor = conn.cursor()



            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))



            row = cursor.fetchone()



            



            if row:



                state_dict = deserialize_state(row["payload_json"])



            else:



                state_dict = {}



                



        wh_rows = []



        for wh in req.warehouses:



            wh_rows.append({



                "Nome_Armazem": wh.name,



                "Morada": wh.address,



                "CP": wh.cp,



                "Localidade": wh.locality,



                "Latitude": wh.lat,



                "Longitude": wh.lon,



                "Nivel_Qualidade": wh.quality



            })



        df_wh = pd.DataFrame(wh_rows)

        state_dict["warehouses_geocoded"] = df_wh
        state_dict["df_warehouses"] = df_wh



        



        from core.session_state import FleetVehicle



        from core.session_state import FleetVehicle
        fleet_dict = {}



        for veh in req.fleet:



            fleet_dict[veh.veiculo] = FleetVehicle(



                capacidade_kg=veh.capacidade_kg,



                capacidade_vol=veh.capacidade_vol,



                custo_km=veh.custo_km,



                velocidade_media=veh.velocidade_media,



                horario_inicio=veh.horario_inicio,



                horario_fim=veh.horario_fim,



                armazem=veh.armazem



            )



        state_dict["fleet_config"] = fleet_dict



        state_dict["phase_2_complete"] = True



        



        payload = serialize_state(state_dict)



        



        from datetime import datetime



        snapshot_name = f"Config Frota/Armazéns ({datetime.now().strftime('%H:%M:%S')})"



        user_id = current_user.id



        



        with get_db() as conn:



            cursor = conn.cursor()



            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", (project_id, user_id, 2, snapshot_name, payload))



            conn.commit()



            



        return {"status": "success", "message": "Configuração da frota e armazéns guardada com sucesso."}



    except Exception as e:



        raise HTTPException(status_code=500, detail=str(e))











@router.post("/import/{project_id}")
async def import_fleet_warehouses(
    project_id: int,
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        import io
        from datetime import datetime
        contents = await file.read()
        xls = pd.ExcelFile(io.BytesIO(contents))
        
        google_api_key = current_user.google_api_key if hasattr(current_user, 'google_api_key') else None
        if not google_api_key:
            from database import get_google_api_key
            google_api_key = get_google_api_key()
            
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)
        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)
        
        # 1. Sheet: Armazéns
        sheet_wh = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['armazéns', 'armazens', 'warehouses', 'armazem', 'armazem_origem']:
                sheet_wh = s
                break
                
        wh_rows = []
        if sheet_wh:
            df_wh_raw = pd.read_excel(xls, sheet_name=sheet_wh)
            if not df_wh_raw.empty:
                col_wh_name = next((c for c in ['Nome_Armazem', 'Nome', 'Nome do Armazém', 'Nome_Armazém', 'Warehouse'] if c in df_wh_raw.columns), None)
                col_wh_addr = next((c for c in ['Morada', 'Endereço', 'Address', 'Rua'] if c in df_wh_raw.columns), None)
                col_wh_cp = next((c for c in ['CP', 'Código Postal', 'Codigo_Postal', 'Postal Code', 'Postal_Code'] if c in df_wh_raw.columns), None)
                col_wh_loc = next((c for c in ['Localidade', 'Cidade', 'Concelho', 'Locality'] if c in df_wh_raw.columns), None)
                col_wh_lat = next((c for c in ['Latitude', 'Lat', 'lat', 'latitude'] if c in df_wh_raw.columns), None)
                col_wh_lon = next((c for c in ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'] if c in df_wh_raw.columns), None)
                col_wh_open = next((c for c in ['Hora_Abertura', 'Abertura', 'Open', 'Hora Abertura'] if c in df_wh_raw.columns), None)
                col_wh_close = next((c for c in ['Hora_Fecho', 'Fecho', 'Close', 'Hora Fecho'] if c in df_wh_raw.columns), None)
                col_wh_load = next((c for c in ['Tempo_Carga_Min', 'Tempo_Carga', 'Tempo Carga (min)', 'Loading_Time'] if c in df_wh_raw.columns), None)
                col_wh_contact = next((c for c in ['Contacto_Responsavel', 'Contacto', 'Telefone', 'Phone'] if c in df_wh_raw.columns), None)
                
                if col_wh_name:
                    for idx, row in df_wh_raw.iterrows():
                        name = str(row[col_wh_name]).replace("_x000D_", "").strip()
                        addr = str(row[col_wh_addr]).strip() if col_wh_addr and pd.notna(row[col_wh_addr]) else ""
                        cp = str(row[col_wh_cp]).strip() if col_wh_cp and pd.notna(row[col_wh_cp]) else ""
                        locality = str(row[col_wh_loc]).strip() if col_wh_loc and pd.notna(row[col_wh_loc]) else ""
                        open_t = str(row[col_wh_open]).strip() if col_wh_open and pd.notna(row[col_wh_open]) else "06:00:00"
                        close_t = str(row[col_wh_close]).strip() if col_wh_close and pd.notna(row[col_wh_close]) else "22:00:00"
                        load_t = int(row[col_wh_load]) if col_wh_load and pd.notna(row[col_wh_load]) else 30
                        contact_val = str(row[col_wh_contact]).strip() if col_wh_contact and pd.notna(row[col_wh_contact]) else ""
                        
                        lat_val, lon_val = 0.0, 0.0
                        if col_wh_lat and col_wh_lon and pd.notna(row[col_wh_lat]) and pd.notna(row[col_wh_lon]):
                            try:
                                lat_val = float(row[col_wh_lat])
                                lon_val = float(row[col_wh_lon])
                            except Exception:
                                pass
                                
                        if (lat_val == 0 or lon_val == 0) and addr:
                            try:
                                res_tuple = geocoder.resolve_address(addr, cp, locality, fast_mode=True)
                                res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                                if res and res.get('lat') and res.get('lon'):
                                    lat_val = res['lat']
                                    lon_val = res['lon']
                            except Exception:
                                pass
                                
                        wh_rows.append({
                            "Nome_Armazem": name,
                            "Nome": name,
                            "Morada": addr,
                            "CP": cp,
                            "Codigo_Postal": cp,
                            "Localidade": locality,
                            "Latitude": lat_val,
                            "Longitude": lon_val,
                            "Hora_Abertura": open_t,
                            "Hora_Fecho": close_t,
                            "Tempo_Carga_Min": load_t,
                            "Contacto_Responsavel": contact_val
                        })

        # 2. Sheet: Frota
        sheet_fleet = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['frota', 'veiculos', 'veículos', 'fleet', 'vehicles', 'viaturas']:
                sheet_fleet = s
                break
                
        from core.session_state import FleetVehicle
        fleet_dict = {}
        if sheet_fleet:
            df_fleet_raw = pd.read_excel(xls, sheet_name=sheet_fleet)
            if not df_fleet_raw.empty:
                col_f_veh = next((c for c in ['Veiculo', 'Veículo', 'Vehicle', 'Nome', 'Matricula'] if c in df_fleet_raw.columns), None)
                col_f_wh = next((c for c in ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'] if c in df_fleet_raw.columns), None)
                col_f_cap_kg = next((c for c in ['Capacidade_KG', 'Capacidade_kg', 'Capacidade (kg)', 'Capacity_KG', 'Peso_Max'] if c in df_fleet_raw.columns), None)
                col_f_cap_vol = next((c for c in ['Capacidade_Vol', 'Capacidade_Volume', 'Capacidade (m3)', 'Capacity_Vol', 'Volume_m3'] if c in df_fleet_raw.columns), None)
                col_f_speed = next((c for c in ['Velocidade_Media', 'Velocidade_media', 'Velocidade Média', 'Speed'] if c in df_fleet_raw.columns), None)
                col_f_start = next((c for c in ['Hora_Inicio_Turno', 'Horario_Inicio', 'Hora Início', 'Start_Time', 'Inicio'] if c in df_fleet_raw.columns), None)
                col_f_end = next((c for c in ['Hora_Fim_Turno', 'Horario_Fim', 'Hora Fim', 'End_Time', 'Fim'] if c in df_fleet_raw.columns), None)
                col_f_cost_km = next((c for c in ['Custo_KM', 'Custo KM (€/km)', 'Custo_km', 'Cost_KM'] if c in df_fleet_raw.columns), None)
                col_f_cost_hr = next((c for c in ['Custo_Hora', 'Custo Hora (€/h)', 'Custo_hora', 'Cost_Hour'] if c in df_fleet_raw.columns), None)
                col_f_max_deliv = next((c for c in ['Max_Entregas', 'Max_Paragens', 'Max Deliveries'] if c in df_fleet_raw.columns), None)
                col_f_rules = next((c for c in ['Regras', 'Tags', 'Restricoes', 'Rules'] if c in df_fleet_raw.columns), None)
                col_f_driver = next((c for c in ['Motorista_Nome', 'Motorista', 'Driver_Name', 'Driver'] if c in df_fleet_raw.columns), None)
                col_f_driver_tel = next((c for c in ['Motorista_Telemovel', 'Telemovel_Motorista', 'Driver_Phone', 'Contacto_Motorista'] if c in df_fleet_raw.columns), None)
                
                if col_f_veh:
                    for idx, row in df_fleet_raw.iterrows():
                        v_name = str(row[col_f_veh]).strip()
                        wh_name = str(row[col_f_wh]).strip() if col_f_wh and pd.notna(row[col_f_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Central")
                        cap_kg = float(row[col_f_cap_kg]) if col_f_cap_kg and pd.notna(row[col_f_cap_kg]) else 1000.0
                        cap_vol = float(row[col_f_cap_vol]) if col_f_cap_vol and pd.notna(row[col_f_cap_vol]) else 10.0
                        speed = float(row[col_f_speed]) if col_f_speed and pd.notna(row[col_f_speed]) else 50.0
                        start_t = str(row[col_f_start]).strip() if col_f_start and pd.notna(row[col_f_start]) else "08:00:00"
                        end_t = str(row[col_f_end]).strip() if col_f_end and pd.notna(row[col_f_end]) else "18:00:00"
                        cost_km = float(row[col_f_cost_km]) if col_f_cost_km and pd.notna(row[col_f_cost_km]) else 0.65
                        cost_hr = float(row[col_f_cost_hr]) if col_f_cost_hr and pd.notna(row[col_f_cost_hr]) else 12.50
                        max_deliv = int(row[col_f_max_deliv]) if col_f_max_deliv and pd.notna(row[col_f_max_deliv]) else 30
                        rules_val = str(row[col_f_rules]).strip() if col_f_rules and pd.notna(row[col_f_rules]) else ""
                        driver_name = str(row[col_f_driver]).strip() if col_f_driver and pd.notna(row[col_f_driver]) else ""
                        driver_tel = str(row[col_f_driver_tel]).strip() if col_f_driver_tel and pd.notna(row[col_f_driver_tel]) else ""
                        
                        v_obj = FleetVehicle(
                            capacidade_kg=cap_kg,
                            capacidade_vol=cap_vol,
                            custo_km=cost_km,
                            velocidade_media=speed,
                            horario_inicio=start_t,
                            horario_fim=end_t,
                            armazem=wh_name
                        )
                        v_obj.regras = rules_val
                        v_obj.custo_hora = cost_hr
                        v_obj.max_entregas = max_deliv
                        v_obj.motorista_nome = driver_name
                        v_obj.motorista_telemovel = driver_tel
                        fleet_dict[v_name] = v_obj

        # 3. Sheet: Regras
        sheet_regras = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['regras', 'rules', 'matriz_regras']:
                sheet_regras = s
                break
                
        rules_matrix = []
        if sheet_regras:
            df_regras_raw = pd.read_excel(xls, sheet_name=sheet_regras)
            col_r_veh = next((c for c in ['Tag_Veiculo', 'Tag_Veículo', 'Veiculo_Tag', 'Tag Veiculo'] if c in df_regras_raw.columns), None)
            col_r_perm = next((c for c in ['Permissao', 'Permissão', 'Permission', 'Permitir'] if c in df_regras_raw.columns), None)
            col_r_deliv = next((c for c in ['Tag_Entrega', 'Entrega_Tag', 'Tag Entrega'] if c in df_regras_raw.columns), None)
            col_r_desc = next((c for c in ['Descricao', 'Descrição', 'Description', 'Observacoes', 'Obs'] if c in df_regras_raw.columns), None)
            
            if col_r_veh and col_r_perm and col_r_deliv:
                for _, r_row in df_regras_raw.iterrows():
                    tv = str(r_row[col_r_veh]).strip().upper() if pd.notna(r_row[col_r_veh]) else ""
                    pm = str(r_row[col_r_perm]).strip().upper() if pd.notna(r_row[col_r_perm]) else "SIM"
                    td = str(r_row[col_r_deliv]).strip().upper() if pd.notna(r_row[col_r_deliv]) else ""
                    ds = str(r_row[col_r_desc]).strip() if col_r_desc and pd.notna(r_row[col_r_desc]) else ""
                    if tv and td:
                        rules_matrix.append({
                            'Tag_Veiculo': tv,
                            'Permissao': pm,
                            'Tag_Entrega': td,
                            'Descricao': ds
                        })

        # 4. Sheet: Entregas
        sheet_entregas = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['entregas', 'clientes', 'encomendas', 'deliveries', 'orders']:
                sheet_entregas = s
                break
                
        deliveries_list = []
        if sheet_entregas:
            df_entregas_raw = pd.read_excel(xls, sheet_name=sheet_entregas)
            if not df_entregas_raw.empty:
                col_e_wh = next((c for c in ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'] if c in df_entregas_raw.columns), None)
                col_e_code = next((c for c in ['Doc_ID', 'Codigo_Cliente', 'Cliente', 'Código Cliente', 'Client_Code', 'Doc ID', 'Documento'] if c in df_entregas_raw.columns), None)
                col_e_name = next((c for c in ['Cliente', 'Nome_Cliente', 'Nome', 'Nome do Cliente', 'Client_Name', 'Designacao'] if c in df_entregas_raw.columns), None)
                col_e_addr = next((c for c in ['Morada', 'Address', 'Rua', 'Endereço'] if c in df_entregas_raw.columns), None)
                col_e_cp = next((c for c in ['CP', 'Codigo_Postal', 'Código Postal', 'Postal_Code'] if c in df_entregas_raw.columns), None)
                col_e_city = next((c for c in ['Localidade', 'Cidade', 'Concelho', 'Locality'] if c in df_entregas_raw.columns), None)
                col_e_tel = next((c for c in ['Telefone_Cliente', 'Telefone', 'Phone', 'Telemovel'] if c in df_entregas_raw.columns), None)
                col_e_weight = next((c for c in ['Peso_KG', 'Peso_kg', 'Peso (kg)', 'Weight_KG', 'Peso'] if c in df_entregas_raw.columns), None)
                col_e_volume = next((c for c in ['Volume_M3', 'Volume_m3', 'Volume (m3)', 'Volume'] if c in df_entregas_raw.columns), None)
                col_e_j1_start = next((c for c in ['Janela1_Inicio', 'Janela_Inicio', 'Slot1_Inicio', 'Horário Início'] if c in df_entregas_raw.columns), None)
                col_e_j1_end = next((c for c in ['Janela1_Fim', 'Janela_Fim', 'Slot1_Fim', 'Horário Fim'] if c in df_entregas_raw.columns), None)
                col_e_lat = next((c for c in ['Latitude', 'Lat', 'lat', 'latitude'] if c in df_entregas_raw.columns), None)
                col_e_lon = next((c for c in ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'] if c in df_entregas_raw.columns), None)
                col_e_obs = next((c for c in ['Notas_Motorista', 'Observacoes', 'Notas', 'Obs'] if c in df_entregas_raw.columns), None)
                col_e_unload = next((c for c in ['Tempo_Descarga_Min', 'Tempo_Descarga', 'Tempo Descarga'] if c in df_entregas_raw.columns), None)
                col_e_op_type = next((c for c in ['Tipo_Operacao', 'Tipo', 'Operation'] if c in df_entregas_raw.columns), None)
                col_e_rules = next((c for c in ['Regras', 'Tags', 'Restricoes'] if c in df_entregas_raw.columns), None)
                col_e_prio = next((c for c in ['Prioridade', 'Priority', 'Prio'] if c in df_entregas_raw.columns), None)

                for idx, row in df_entregas_raw.iterrows():
                    code = str(row[col_e_code]).strip() if col_e_code and pd.notna(row[col_e_code]) else f"CLI_{idx+1}"
                    name_val = str(row[col_e_name]).replace("_x000D_", "").strip() if col_e_name and pd.notna(row[col_e_name]) else code
                    addr = str(row[col_e_addr]).strip() if col_e_addr and pd.notna(row[col_e_addr]) else ""
                    cp = str(row[col_e_cp]).strip() if col_e_cp and pd.notna(row[col_e_cp]) else ""
                    city = str(row[col_e_city]).strip() if col_e_city and pd.notna(row[col_e_city]) else ""
                    tel = str(row[col_e_tel]).strip() if col_e_tel and pd.notna(row[col_e_tel]) else ""
                    weight = float(row[col_e_weight]) if col_e_weight and pd.notna(row[col_e_weight]) else 50.0
                    volume = float(row[col_e_volume]) if col_e_volume and pd.notna(row[col_e_volume]) else 0.1
                    j1_s = str(row[col_e_j1_start]).strip() if col_e_j1_start and pd.notna(row[col_e_j1_start]) else "08:00"
                    j1_e = str(row[col_e_j1_end]).strip() if col_e_j1_end and pd.notna(row[col_e_j1_end]) else "18:00"
                    unload_t = int(row[col_e_unload]) if col_e_unload and pd.notna(row[col_e_unload]) else 15
                    op_type = str(row[col_e_op_type]).strip() if col_e_op_type and pd.notna(row[col_e_op_type]) else "ENTREGA"
                    e_rules = str(row[col_e_rules]).strip() if col_e_rules and pd.notna(row[col_e_rules]) else ""
                    obs = str(row[col_e_obs]).strip() if col_e_obs and pd.notna(row[col_e_obs]) else ""
                    prio_str = str(row[col_e_prio]).strip() if col_e_prio and pd.notna(row[col_e_prio]) else "Normal"
                    wh_val = str(row[col_e_wh]).strip() if col_e_wh and pd.notna(row[col_e_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Central")
                    
                    lat, lon = 0.0, 0.0
                    if col_e_lat and col_e_lon and pd.notna(row[col_e_lat]) and pd.notna(row[col_e_lon]):
                        try:
                            lat = float(row[col_e_lat])
                            lon = float(row[col_e_lon])
                        except Exception:
                            pass
                            
                    if (lat == 0 or lon == 0) and addr:
                        try:
                            res_tuple = geocoder.resolve_address(addr, cp, city, fast_mode=True)
                            res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                            if res and res.get('lat') and res.get('lon'):
                                lat = res['lat']
                                lon = res['lon']
                        except Exception:
                            pass
                            
                    deliveries_list.append({
                        "Armazem": wh_val,
                        "Doc_ID": code,
                        "Codigo_Cliente": code,
                        "Cliente": name_val,
                        "Nome_Cliente": name_val,
                        "Morada": addr,
                        "CP": cp,
                        "Codigo_Postal": cp,
                        "Localidade": city,
                        "Latitude": lat,
                        "Longitude": lon,
                        "Telefone_Cliente": tel,
                        "Telefone": tel,
                        "Peso_KG": weight,
                        "Peso": weight,
                        "Volume_M3": volume,
                        "Volume_m3": volume,
                        "Janela_Inicio": j1_s,
                        "Janela_Fim": j1_e,
                        "Janela_Horaria": f"{j1_s} - {j1_e}",
                        "Tempo_Descarga_Min": unload_t,
                        "Tipo_Operacao": op_type,
                        "Regras": e_rules,
                        "Notas_Motorista": obs,
                        "Observacoes": obs,
                        "Prioridade": prio_str
                    })

        # 5. Sheet: Rotas (Planeamento pré-definido)
        sheet_rotas = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['rotas', 'routes', 'planeamento', 'plano_rotas']:
                sheet_rotas = s
                break
                
        routes_solution_list = []
        if sheet_rotas:
            df_rotas_raw = pd.read_excel(xls, sheet_name=sheet_rotas)
            if not df_rotas_raw.empty:
                col_rt_wh = next((c for c in ['Armazem', 'Armazém', 'Warehouse'] if c in df_rotas_raw.columns), None)
                col_rt_veh = next((c for c in ['Veiculo', 'Veículo', 'Rota', 'Vehicle', 'Route'] if c in df_rotas_raw.columns), None)
                col_rt_ord = next((c for c in ['Ordem_Paragem', 'Ordem', 'Stop_Order', 'Seq'] if c in df_rotas_raw.columns), None)
                col_rt_doc = next((c for c in ['Doc_ID', 'Doc ID', 'Documento', 'Codigo_Cliente', 'Cod_Cliente'] if c in df_rotas_raw.columns), None)
                col_rt_cli = next((c for c in ['Cliente', 'Nome_Cliente', 'Client_Name', 'Nome'] if c in df_rotas_raw.columns), None)
                col_rt_addr = next((c for c in ['Morada', 'Address', 'Rua', 'Endereço'] if c in df_rotas_raw.columns), None)
                col_rt_cp = next((c for c in ['CP', 'Codigo_Postal', 'Código Postal', 'Postal_Code'] if c in df_rotas_raw.columns), None)
                col_rt_loc = next((c for c in ['Localidade', 'Cidade', 'City', 'Concelho'] if c in df_rotas_raw.columns), None)
                col_rt_tel = next((c for c in ['Telefone_Cliente', 'Telefone', 'Phone', 'Contacto'] if c in df_rotas_raw.columns), None)
                col_rt_win = next((c for c in ['Janela_Horaria', 'Janela_Horária', 'Janela', 'Horario'] if c in df_rotas_raw.columns), None)
                col_rt_arr = next((c for c in ['Hora_Chegada_Prevista', 'Chegada_Prevista', 'ETA', 'Hora_Chegada', 'Chegada'] if c in df_rotas_raw.columns), None)
                col_rt_dep = next((c for c in ['Hora_Saida_Prevista', 'Saida_Prevista', 'ETD', 'Hora_Saida', 'Saida'] if c in df_rotas_raw.columns), None)
                col_rt_dist = next((c for c in ['Distancia_KM', 'Distancia', 'Distancia_km', 'KM'] if c in df_rotas_raw.columns), None)
                col_rt_cum_dist = next((c for c in ['Distancia_Acumulada_KM', 'Distancia_Acumulada', 'Dist_Acum'] if c in df_rotas_raw.columns), None)
                col_rt_t_viag = next((c for c in ['Tempo_Viagem_Min', 'Tempo_Viagem'] if c in df_rotas_raw.columns), None)
                col_rt_t_esp = next((c for c in ['Tempo_Espera_Min', 'Tempo_Espera'] if c in df_rotas_raw.columns), None)
                col_rt_cg_kg = next((c for c in ['Carga_Restante_KG', 'Carga_Restante', 'Peso_KG', 'Peso'] if c in df_rotas_raw.columns), None)
                col_rt_cg_vol = next((c for c in ['Carga_Restante_Vol', 'Carga_Vol', 'Volume_M3', 'Volume'] if c in df_rotas_raw.columns), None)
                col_rt_lat = next((c for c in ['Latitude', 'Lat', 'lat', 'latitude'] if c in df_rotas_raw.columns), None)
                col_rt_lon = next((c for c in ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'] if c in df_rotas_raw.columns), None)
                col_rt_status = next((c for c in ['Status', 'Estado'] if c in df_rotas_raw.columns), None)
                
                # --- A. REVERSE ENGINEERING: WAREHOUSES FROM ROTAS ---
                if not wh_rows:
                    unique_whs = []
                    if col_rt_wh:
                        unique_whs = [str(w).strip() for w in df_rotas_raw[col_rt_wh].dropna().unique() if str(w).strip()]
                    if not unique_whs:
                        unique_whs = ["Armazém Principal"]
                        
                    for u_wh in unique_whs:
                        wh_rows.append({
                            "Nome_Armazem": u_wh,
                            "Nome": u_wh,
                            "Morada": "",
                            "CP": "",
                            "Codigo_Postal": "",
                            "Localidade": "",
                            "Latitude": 0.0,
                            "Longitude": 0.0,
                            "Hora_Abertura": "06:00:00",
                            "Hora_Fecho": "22:00:00",
                            "Tempo_Carga_Min": 30,
                            "Contacto_Responsavel": ""
                        })

                # --- B. REVERSE ENGINEERING: VEHICLES FROM ROTAS ---
                if not fleet_dict:
                    if col_rt_veh:
                        for v_val in df_rotas_raw[col_rt_veh].dropna().unique():
                            v_str = str(v_val).strip()
                            if not v_str or "distribuir" in v_str.lower() or "pendente" in v_str.lower():
                                continue
                            
                            # Find associated warehouse for this vehicle from the rows
                            veh_wh = wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Principal"
                            if col_rt_wh:
                                match_wh = df_rotas_raw[df_rotas_raw[col_rt_veh] == v_val][col_rt_wh].dropna()
                                if not match_wh.empty:
                                    veh_wh = str(match_wh.iloc[0]).strip()
                                    
                            v_obj = FleetVehicle(
                                capacidade_kg=1000.0,
                                capacidade_vol=10.0,
                                custo_km=0.65,
                                velocidade_media=50.0,
                                horario_inicio="08:00:00",
                                horario_fim="18:00:00",
                                armazem=veh_wh
                            )
                            v_obj.custo_hora = 12.50
                            v_obj.max_entregas = 50
                            fleet_dict[v_str] = v_obj
                            
                # Coordinate lookup from deliveries_list if available
                coord_map = {}
                for d in deliveries_list:
                    if d.get("Doc_ID"):
                        coord_map[str(d["Doc_ID"]).strip().lower()] = (d.get("Latitude", 0.0), d.get("Longitude", 0.0), d.get("Peso_KG", 50.0), d.get("Volume_M3", 0.1))
                    if d.get("Morada"):
                        coord_map[str(d["Morada"]).strip().lower()] = (d.get("Latitude", 0.0), d.get("Longitude", 0.0), d.get("Peso_KG", 50.0), d.get("Volume_M3", 0.1))

                # If Rotas has more entries than deliveries_list, rebuild deliveries_list completely from Rotas!
                if len(df_rotas_raw) >= len(deliveries_list):
                    deliveries_list = []

                # Process all Rotas rows
                for r_idx, r_row in df_rotas_raw.iterrows():
                    veh_name = str(r_row[col_rt_veh]).strip() if col_rt_veh and pd.notna(r_row[col_rt_veh]) else "Por Distribuir"
                    ord_val = int(r_row[col_rt_ord]) if col_rt_ord and pd.notna(r_row[col_rt_ord]) else (r_idx + 1)
                    doc_val = str(r_row[col_rt_doc]).strip() if col_rt_doc and pd.notna(r_row[col_rt_doc]) else f"CLI_{r_idx+1}"
                    cli_val = str(r_row[col_rt_cli]).replace("_x000D_", "").strip() if col_rt_cli and pd.notna(r_row[col_rt_cli]) else doc_val
                    addr_val = str(r_row[col_rt_addr]).strip() if col_rt_addr and pd.notna(r_row[col_rt_addr]) else ""
                    cp_val = str(r_row[col_rt_cp]).strip() if col_rt_cp and pd.notna(r_row[col_rt_cp]) else ""
                    loc_val = str(r_row[col_rt_loc]).strip() if col_rt_loc and pd.notna(r_row[col_rt_loc]) else ""
                    wh_name = str(r_row[col_rt_wh]).strip() if col_rt_wh and pd.notna(r_row[col_rt_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Principal")
                    
                    p_kg = float(r_row[col_rt_cg_kg]) if col_rt_cg_kg and pd.notna(r_row[col_rt_cg_kg]) else 50.0
                    v_m3 = float(r_row[col_rt_cg_vol]) if col_rt_cg_vol and pd.notna(r_row[col_rt_cg_vol]) else 0.1
                    
                    c_lat, c_lon = 0.0, 0.0
                    if col_rt_lat and col_rt_lon and pd.notna(r_row[col_rt_lat]) and pd.notna(r_row[col_rt_lon]):
                        try:
                            c_lat = float(r_row[col_rt_lat])
                            c_lon = float(r_row[col_rt_lon])
                        except Exception:
                            pass
                    elif doc_val.lower() in coord_map:
                        c_lat, c_lon, p_kg, v_m3 = coord_map[doc_val.lower()]
                    elif addr_val.lower() in coord_map:
                        c_lat, c_lon, p_kg, v_m3 = coord_map[addr_val.lower()]
                    elif addr_val:
                        try:
                            res_tuple = geocoder.resolve_address(addr_val, cp_val, loc_val, fast_mode=True)
                            res_geo = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                            if res_geo and res_geo.get('lat') and res_geo.get('lon'):
                                c_lat = res_geo['lat']
                                c_lon = res_geo['lon']
                        except Exception:
                            pass
                            
                    # --- C. REVERSE ENGINEERING: DELIVERIES ---
                    deliveries_list.append({
                            "Armazem": wh_name,
                            "Doc_ID": doc_val,
                            "Codigo_Cliente": doc_val,
                            "Cliente": cli_val,
                            "Nome_Cliente": cli_val,
                            "Morada": addr_val,
                            "CP": cp_val,
                            "Codigo_Postal": cp_val,
                            "Localidade": loc_val,
                            "Latitude": c_lat,
                            "Longitude": c_lon,
                            "Telefone_Cliente": str(r_row[col_rt_tel]).strip() if col_rt_tel and pd.notna(r_row[col_rt_tel]) else "",
                            "Peso_KG": p_kg,
                            "Volume_M3": v_m3,
                            "Janela_Inicio": "08:00",
                            "Janela_Fim": "18:00",
                            "Janela_Horaria": str(r_row[col_rt_win]).strip() if col_rt_win and pd.notna(r_row[col_rt_win]) else "08:00 - 18:00",
                            "Tempo_Descarga_Min": 15,
                            "Tipo_Operacao": "ENTREGA",
                            "Regras": "",
                            "Observacoes": "",
                            "Prioridade": "Normal"
                        })
                            
                    routes_solution_list.append({
                        "id": r_idx + 1,
                        "ID_Original": r_idx + 1,
                        "Doc_ID": doc_val,
                        "Codigo_Cliente": doc_val,
                        "Cliente": cli_val,
                        "Nome_Cliente": cli_val,
                        "Morada": addr_val,
                        "CP": cp_val,
                        "Localidade": loc_val,
                        "Telefone_Cliente": str(r_row[col_rt_tel]).strip() if col_rt_tel and pd.notna(r_row[col_rt_tel]) else "",
                        "Latitude": c_lat,
                        "Longitude": c_lon,
                        "Rota": veh_name,
                        "Veiculo": veh_name,
                        "Armazem": wh_name,
                        "Ordem": ord_val,
                        "Ordem_Paragem": ord_val,
                        "Janela_Horaria": str(r_row[col_rt_win]).strip() if col_rt_win and pd.notna(r_row[col_rt_win]) else "08:00 - 18:00",
                        "Hora_Chegada_Prevista": str(r_row[col_rt_arr]).strip() if col_rt_arr and pd.notna(r_row[col_rt_arr]) else "",
                        "Hora_Saida_Prevista": str(r_row[col_rt_dep]).strip() if col_rt_dep and pd.notna(r_row[col_rt_dep]) else "",
                        "Distancia_KM": float(r_row[col_rt_dist]) if col_rt_dist and pd.notna(r_row[col_rt_dist]) else 0.0,
                        "Distancia_Acumulada_KM": float(r_row[col_rt_cum_dist]) if col_rt_cum_dist and pd.notna(r_row[col_rt_cum_dist]) else 0.0,
                        "Tempo_Viagem_Min": float(r_row[col_rt_t_viag]) if col_rt_t_viag and pd.notna(r_row[col_rt_t_viag]) else 0.0,
                        "Tempo_Espera_Min": float(r_row[col_rt_t_esp]) if col_rt_t_esp and pd.notna(r_row[col_rt_t_esp]) else 0.0,
                        "Carga_Restante_KG": float(r_row[col_rt_cg_kg]) if col_rt_cg_kg and pd.notna(r_row[col_rt_cg_kg]) else p_kg,
                        "Carga_Restante_Vol": float(r_row[col_rt_cg_vol]) if col_rt_cg_vol and pd.notna(r_row[col_rt_cg_vol]) else v_m3,
                        "Status": str(r_row[col_rt_status]).strip() if col_rt_status and pd.notna(r_row[col_rt_status]) else "Planeado"
                    })

        # --- D. SAVE DELIVERIES TO SQLITE DB FOR PHASE 1 GEOREFERENCING ---
        if deliveries_list:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (project_id,))
                for d in deliveries_list:
                    lat_d = float(d.get("Latitude", 0.0))
                    lon_d = float(d.get("Longitude", 0.0))
                    qual_d = 1 if (lat_d != 0 and lon_d != 0) else 99
                    src_d = "FICHEIRO" if qual_d == 1 else "PENDENTE"
                    cursor.execute("""
                        INSERT INTO entregas (
                            projeto_id, codigo_cliente, nome_cliente, morada, codigo_postal, _concelho,
                            peso_kg, volume_m3, prioridade, janela_inicio, janela_fim,
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, d.get("Doc_ID", ""), d.get("Cliente", ""), d.get("Morada", ""),
                        d.get("CP", ""), d.get("Localidade", ""), float(d.get("Peso_KG", 50.0)),
                        float(d.get("Volume_M3", 0.1)), 2, d.get("Janela_Inicio", "08:00"),
                        d.get("Janela_Fim", "18:00"), lat_d, lon_d, qual_d, src_d,
                        d.get("Morada", ""), d.get("Armazem", "Armazém Principal")
                    ))
                conn.commit()

        # --- E. SAVE FLEET TO SQLITE DB FOR PHASE 2 FLEET ---
        if fleet_dict:
            from database import save_frota_projeto
            fleet_rows_for_db = []
            for v_name, v_data in fleet_dict.items():
                fleet_rows_for_db.append({
                    "veiculo": v_name,
                    "capacidade_kg": v_data.capacidade_kg,
                    "custo_km": v_data.custo_km,
                    "velocidade_media": v_data.velocidade_media,
                    "horario_inicio": v_data.horario_inicio,
                    "horario_fim": v_data.horario_fim
                })
            save_frota_projeto(project_id, fleet_rows_for_db)

        # 6. Persist Complete Snapshot
        df_wh = pd.DataFrame(wh_rows) if wh_rows else pd.DataFrame()
        df_routes_imported = pd.DataFrame(routes_solution_list) if routes_solution_list else pd.DataFrame()
        has_routes = not df_routes_imported.empty
        
        state_dict = {
            "warehouses_geocoded": df_wh,
            "fleet_config": fleet_dict,
            "rules_matrix": rules_matrix,
            "clients_geocoded": pd.DataFrame(deliveries_list) if deliveries_list else pd.DataFrame(),
            "routes_solution": df_routes_imported if has_routes else None,
            "routes_df": df_routes_imported if has_routes else None,
            "phase_1_complete": bool(deliveries_list),
            "phase_2_complete": bool(fleet_dict),
            "phase_3_complete": has_routes
        }
        
        payload = serialize_state(state_dict)
        fase_num = 3 if has_routes else 2
        snapshot_name = f"Importação GeoRoutePlan ({datetime.now().strftime('%H:%M:%S')})"
        
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 
                           (project_id, current_user.id, fase_num, snapshot_name, payload))
            conn.commit()
            
        # Check if warehouses need geocoding
        wh_needs_geo = [w["Nome_Armazem"] for w in wh_rows if float(w.get("Latitude", 0)) == 0]
        
        msg = f"Ficheiro importado com sucesso ({len(wh_rows)} armazéns, {len(fleet_dict)} veículos, {len(deliveries_list)} entregas georreferenciadas, {len(routes_solution_list)} paragens atribuídas)."
        if wh_needs_geo:
            msg += f" ⚠️ Atenção: O armazém '{wh_needs_geo[0]}' precisa de confirmação da morada na aba Frota e Armazéns."
            
        return {
            "status": "success",
            "message": msg,
            "warehouses_missing_coords": wh_needs_geo,
            "num_warehouses": len(wh_rows),
            "num_vehicles": len(fleet_dict),
            "num_deliveries": len(deliveries_list),
            "num_routes": len(routes_solution_list)
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar ficheiro: {str(e)}")
