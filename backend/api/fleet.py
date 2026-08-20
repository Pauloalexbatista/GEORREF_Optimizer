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
        headers={"Content-Disposition": "attachment; filename=Template_Importacao_Completa.xlsx"}
    )


@router.get("/{project_id}")



def get_fleet_config(project_id: int, current_user: UserResponse = Depends(get_current_user)):



    proj = get_projeto(project_id)



    if not proj or proj["empresa_id"] != current_user.empresa_id:



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



    if not proj or proj["empresa_id"] != current_user.empresa_id:



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



        # 4. Check if Entregas sheet exists for unified import
        sheet_entregas = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['entregas', 'clientes', 'encomendas', 'deliveries', 'orders']:
                sheet_entregas = s
                break
                
        if sheet_entregas:
            df_entregas_raw = pd.read_excel(xls, sheet_name=sheet_entregas)
            
            # Robust column resolution for Deliveries
            col_e_code = next((c for c in ['Codigo_Cliente', 'Cliente', 'Código Cliente', 'Client_Code', 'Código_Cliente'] if c in df_entregas_raw.columns), None)
            col_e_addr = next((c for c in ['Morada', 'Address', 'Rua', 'Endereço'] if c in df_entregas_raw.columns), None)
            col_e_cp = next((c for c in ['Codigo_Postal', 'CP', 'Código Postal', 'Postal_Code'] if c in df_entregas_raw.columns), None)
            col_e_city = next((c for c in ['Localidade', 'Cidade', 'Concelho', 'Locality'] if c in df_entregas_raw.columns), None)
            col_e_weight = next((c for c in ['Peso_KG', 'Peso_kg', 'Peso (kg)', 'Weight_KG', 'Peso'] if c in df_entregas_raw.columns), None)
            col_e_volume = next((c for c in ['Volume_m3', 'Volume (m3)', 'Volume', 'Volume_M3'] if c in df_entregas_raw.columns), None)
            col_e_start = next((c for c in ['Janela_Inicio', 'Slot1_Inicio', 'Horário Início', 'Start_Time', 'Janela início'] if c in df_entregas_raw.columns), None)
            col_e_end = next((c for c in ['Janela_Fim', 'Slot1_Fim', 'Horário Fim', 'End_Time', 'Janela fim'] if c in df_entregas_raw.columns), None)
            col_e_priority = next((c for c in ['Prioridade', 'Priority'] if c in df_entregas_raw.columns), None)
            col_e_obs = next((c for c in ['Observacoes', 'Observações', 'Remarks', 'Obs'] if c in df_entregas_raw.columns), None)
            col_e_wh = next((c for c in ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'] if c in df_entregas_raw.columns), None)
            col_e_lat = next((c for c in ['Latitude', 'Lat', 'lat', 'latitude'] if c in df_entregas_raw.columns), None)
            col_e_lon = next((c for c in ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'] if c in df_entregas_raw.columns), None)
            
            if not col_e_addr:
                raise HTTPException(status_code=400, detail="A folha de Entregas deve conter uma coluna de Morada.")
                
            # Clear existing deliveries
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (project_id,))
                conn.commit()
                
            for idx, row in df_entregas_raw.iterrows():
                code = str(row[col_e_code]).strip() if col_e_code else f"C_{idx+1}"
                addr = str(row[col_e_addr]).strip()
                cp = str(row[col_e_cp]).strip() if col_e_cp and pd.notna(row[col_e_cp]) else ""
                city = str(row[col_e_city]).strip() if col_e_city and pd.notna(row[col_e_city]) else ""
                weight = float(row[col_e_weight]) if col_e_weight and pd.notna(row[col_e_weight]) else 0.0
                volume = float(row[col_e_volume]) if col_e_volume and pd.notna(row[col_e_volume]) else 0.0
                priority = int(row[col_e_priority]) if col_e_priority and pd.notna(row[col_e_priority]) else 2
                start_window = str(row[col_e_start]).strip() if col_e_start and pd.notna(row[col_e_start]) else "08:00"
                end_window = str(row[col_e_end]).strip() if col_e_end and pd.notna(row[col_e_end]) else "18:00"
                obs = str(row[col_e_obs]).strip() if col_e_obs and pd.notna(row[col_e_obs]) else ""
                wh_val = str(row[col_e_wh]).strip() if col_e_wh and pd.notna(row[col_e_wh]) else ""
                
                # Check for coordinates in file
                has_coords = False
                lat_val = 0.0
                lon_val = 0.0
                if col_e_lat and col_e_lon:
                    try:
                        e_lat = row[col_e_lat]
                        e_lon = row[col_e_lon]
                        if pd.notna(e_lat) and pd.notna(e_lon):
                            lat_val = float(e_lat)
                            lon_val = float(e_lon)
                            if lat_val != 0 and -90 <= lat_val <= 90:
                                has_coords = True
                    except Exception:
                        has_coords = False
                        
                if has_coords:
                    res = {
                        "lat": lat_val,
                        "lon": lon_val,
                        "quality_level": 0,
                        "source": "FICHEIRO",
                        "morada_encontrada": addr
                    }
                else:
                    try:
                        res_tuple = geocoder.resolve_address(addr, cp, city)
                        res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    except Exception:
                        res = None
                        
                if res and res.get('lat') and res.get('lon'):
                    lat = res['lat']
                    lon = res['lon']
                    quality = res.get('quality_level', 1)
                    source = res.get('source', 'NOMINATIM')
                    morada_encontrada = res.get('morada_encontrada', addr)
                else:
                    lat = 0.0
                    lon = 0.0
                    quality = 99
                    source = "FALHA"
                    morada_encontrada = ""
                    
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT INTO entregas (
                            projeto_id, codigo_cliente, morada, codigo_postal, _concelho,
                            peso_kg, volume_m3, prioridade, janela_inicio, janela_fim,
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, code, addr, cp, city,
                        weight, volume, priority, start_window, end_window,
                        lat, lon, quality, source, morada_encontrada, wh_val
                    ))
                    conn.commit()
            
            state_dict["phase_1_complete"] = True

        state_dict["warehouses_geocoded"] = df_wh



        



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



    if not proj or proj["empresa_id"] != current_user.empresa_id:



        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")



        



        proj = get_projeto(project_id)

    if not proj or proj["empresa_id"] != current_user.empresa_id:

        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

        

    try:

        import io

        from datetime import datetime

        contents = await file.read()

        xls = pd.ExcelFile(io.BytesIO(contents))

        

        sheet_wh = None

        for s in xls.sheet_names:

            if s.lower().strip() in ['armazéns', 'armazens', 'warehouses', 'armazem', 'armazem_origem']:

                sheet_wh = s

                break

                

        if not sheet_wh:

            raise HTTPException(status_code=400, detail="Ficheiro inválido. Deve conter a folha 'Armazéns' ou 'Armazens'.")

            

        df_wh_raw = pd.read_excel(xls, sheet_name=sheet_wh)

        

        # Robust column resolution for Warehouses

        col_wh_name = next((c for c in ['Nome_Armazem', 'Nome', 'Nome do Armazém', 'Nome_Armazém', 'Warehouse'] if c in df_wh_raw.columns), None)
        col_wh_lat = next((c for c in ['Latitude', 'Lat', 'lat', 'latitude'] if c in df_wh_raw.columns), None)
        col_wh_lon = next((c for c in ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'] if c in df_wh_raw.columns), None)

        col_wh_addr = next((c for c in ['Morada', 'Endereço', 'Address', 'Rua'] if c in df_wh_raw.columns), None)

        col_wh_cp = next((c for c in ['CP', 'Código Postal', 'Codigo_Postal', 'Postal Code'] if c in df_wh_raw.columns), None)

        col_wh_loc = next((c for c in ['Localidade', 'Cidade', 'Concelho', 'Locality'] if c in df_wh_raw.columns), None)

        

        if not col_wh_name:

            raise HTTPException(status_code=400, detail="A folha 'Armazéns' deve conter a coluna de identificação (ex: 'Nome_Armazem' ou 'Nome').")

        if not col_wh_addr:

            raise HTTPException(status_code=400, detail="A folha 'Armazéns' deve conter a coluna de morada (ex: 'Morada').")

        if not col_wh_cp:

            raise HTTPException(status_code=400, detail="A folha 'Armazéns' deve conter a coluna de código postal (ex: 'CP').")

        if not col_wh_loc:

            raise HTTPException(status_code=400, detail="A folha 'Armazéns' deve conter a coluna de localidade (ex: 'Localidade').")

            

        google_api_key = current_user.google_api_key if hasattr(current_user, 'google_api_key') else None

        if not google_api_key:

            from database import get_google_api_key

            google_api_key = get_google_api_key()

            

        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)

        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)

        

        wh_rows = []

        for idx, row in df_wh_raw.iterrows():

            name = str(row[col_wh_name]).strip()

            addr = str(row[col_wh_addr]).strip()

            cp = str(row[col_wh_cp]).strip()

            locality = str(row[col_wh_loc]).strip()

            

            has_coords = False
            lat_val = 0.0
            lon_val = 0.0
            if col_wh_lat and col_wh_lon:
                try:
                    w_lat = row[col_wh_lat]
                    w_lon = row[col_wh_lon]
                    if pd.notna(w_lat) and pd.notna(w_lon):
                        lat_val = float(w_lat)
                        lon_val = float(w_lon)
                        if lat_val != 0 and -90 <= lat_val <= 90:
                            if (lat_val < 0 and lon_val > 0) or (-10.0 <= lat_val <= -6.0 and 36.0 <= lon_val <= 43.0):
                                lat_val, lon_val = lon_val, lat_val
                            has_coords = True
                except Exception:
                    has_coords = False
                    
            if has_coords:
                lat = lat_val
                lon = lon_val
                quality = 0
            else:
                try:
                    res_tuple = geocoder.resolve_address(addr, cp, locality)
                    g_res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    lat = g_res.get('lat', 39.5) if g_res else 39.5
                    lon = g_res.get('lon', -8.0) if g_res else -8.0
                    quality = g_res.get('quality_level', 99) if g_res else 99
                except Exception:
                    lat = 39.5
                    lon = -8.0
                    quality = 99

                

            wh_rows.append({

                "Nome_Armazem": name,

                "Morada": addr,

                "CP": cp,

                "Localidade": locality,

                "Latitude": lat,

                "Longitude": lon,

                "Nivel_Qualidade": quality

            })

            

        df_wh = pd.DataFrame(wh_rows)

        

        # 3. Read Frota sheet

        sheet_fleet = None

        for s in xls.sheet_names:

            if s.lower().strip() in ['frota', 'veículos', 'veiculos', 'fleet']:

                sheet_fleet = s

                break

                

        if not sheet_fleet:

            raise HTTPException(status_code=400, detail="Ficheiro inválido. Deve conter a folha 'Frota' ou 'Fleet'.")

            

        df_fleet_raw = pd.read_excel(xls, sheet_name=sheet_fleet)

        

        # Robust column resolution for Fleet

        col_f_veh = next((c for c in ['Veiculo', 'Veículo', 'Vehicle', 'Nome_Veiculo'] if c in df_fleet_raw.columns), None)

        col_f_wh = next((c for c in ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'] if c in df_fleet_raw.columns), None)

        col_f_kg = next((c for c in ['Capacidade_KG', 'Capacidade_kg', 'Capacidade (kg)', 'Capacidade_KG', 'Weight_Capacity'] if c in df_fleet_raw.columns), None)

        col_f_vol = next((c for c in ['Cap_Volume_m3', 'Capacidade_Volume', 'Volume (m3)', 'Volume_m3', 'Volume_Capacity'] if c in df_fleet_raw.columns), None)

        col_f_cost = next((c for c in ['Custo_KM', 'Custo_km', 'Custo/km', 'Cost_KM'] if c in df_fleet_raw.columns), None)

        col_f_speed = next((c for c in ['Velocidade_Media', 'Velocidade_media', 'Velocidade Média', 'Speed'] if c in df_fleet_raw.columns), None)

        col_f_start = next((c for c in ['Horario_Inicio', 'Horário Início', 'Horario_inicio', 'Start_Time', 'Inicio'] if c in df_fleet_raw.columns), None)

        col_f_end = next((c for c in ['Horario_Fim', 'Horário Fim', 'Horario_fim', 'End_Time', 'Fim'] if c in df_fleet_raw.columns), None)

        

        if not col_f_veh:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de veículo (ex: 'Veiculo').")

        if not col_f_wh:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de armazém (ex: 'Armazem').")

        if not col_f_kg:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de capacidade de peso (ex: 'Capacidade_KG').")

        if not col_f_vol:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de capacidade de volume (ex: 'Cap_Volume_m3').")

        if not col_f_cost:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de custo/km (ex: 'Custo_KM').")

        if not col_f_speed:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de velocidade média (ex: 'Velocidade_Media').")

        if not col_f_start:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de horário de início (ex: 'Horario_Inicio').")

        if not col_f_end:

            raise HTTPException(status_code=400, detail="A folha 'Frota' deve conter a coluna de horário de fim (ex: 'Horario_Fim').")

            

        from core.session_state import FleetVehicle

        fleet_dict = {}

        for idx, row in df_fleet_raw.iterrows():

            v_name = str(row[col_f_veh]).strip()

            wh_name = str(row[col_f_wh]).strip()

            cap_kg = float(row[col_f_kg])

            cap_vol = float(row[col_f_vol])

            custo = float(row[col_f_cost])

            vel = float(row[col_f_speed])

            h_ini = str(row[col_f_start]).strip()

            h_fim = str(row[col_f_end]).strip()

            

            if len(h_ini) > 5:

                h_ini = h_ini[:5]

            if len(h_fim) > 5:

                h_fim = h_fim[:5]

                

            fleet_dict[v_name] = FleetVehicle(

                capacidade_kg=cap_kg,

                capacidade_vol=cap_vol,

                custo_km=custo,

                velocidade_media=vel,

                horario_inicio=h_ini,

                horario_fim=h_fim,

                armazem=wh_name

            )

            

        with get_db() as conn:

            cursor = conn.cursor()

            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))

            row_snap = cursor.fetchone()

            

            if row_snap:

                state_dict = deserialize_state(row_snap["payload_json"])

            else:

                state_dict = {}

                

        # 4. Check if Entregas sheet exists for unified import
        sheet_entregas = None
        for s in xls.sheet_names:
            if s.lower().strip() in ['entregas', 'clientes', 'encomendas', 'deliveries', 'orders']:
                sheet_entregas = s
                break
                
        if sheet_entregas:
            df_entregas_raw = pd.read_excel(xls, sheet_name=sheet_entregas)
            
            # Robust column resolution for Deliveries
            col_e_code = next((c for c in ['Codigo_Cliente', 'Cliente', 'Código Cliente', 'Client_Code', 'Código_Cliente'] if c in df_entregas_raw.columns), None)
            col_e_addr = next((c for c in ['Morada', 'Address', 'Rua', 'Endereço'] if c in df_entregas_raw.columns), None)
            col_e_cp = next((c for c in ['Codigo_Postal', 'CP', 'Código Postal', 'Postal_Code'] if c in df_entregas_raw.columns), None)
            col_e_city = next((c for c in ['Localidade', 'Cidade', 'Concelho', 'Locality'] if c in df_entregas_raw.columns), None)
            col_e_weight = next((c for c in ['Peso_KG', 'Peso_kg', 'Peso (kg)', 'Weight_KG', 'Peso'] if c in df_entregas_raw.columns), None)
            col_e_volume = next((c for c in ['Volume_m3', 'Volume (m3)', 'Volume', 'Volume_M3'] if c in df_entregas_raw.columns), None)
            col_e_start = next((c for c in ['Janela_Inicio', 'Slot1_Inicio', 'Horário Início', 'Start_Time', 'Janela início'] if c in df_entregas_raw.columns), None)
            col_e_end = next((c for c in ['Janela_Fim', 'Slot1_Fim', 'Horário Fim', 'End_Time', 'Janela fim'] if c in df_entregas_raw.columns), None)
            col_e_priority = next((c for c in ['Prioridade', 'Priority'] if c in df_entregas_raw.columns), None)
            col_e_obs = next((c for c in ['Observacoes', 'Observações', 'Remarks', 'Obs'] if c in df_entregas_raw.columns), None)
            col_e_wh = next((c for c in ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'] if c in df_entregas_raw.columns), None)
            col_e_lat = next((c for c in ['Latitude', 'Lat', 'lat', 'latitude'] if c in df_entregas_raw.columns), None)
            col_e_lon = next((c for c in ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'] if c in df_entregas_raw.columns), None)
            
            if not col_e_addr:
                raise HTTPException(status_code=400, detail="A folha de Entregas deve conter uma coluna de Morada.")
                
            # Clear existing deliveries
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (project_id,))
                conn.commit()
                
            for idx, row in df_entregas_raw.iterrows():
                code = str(row[col_e_code]).strip() if col_e_code else f"C_{idx+1}"
                addr = str(row[col_e_addr]).strip()
                cp = str(row[col_e_cp]).strip() if col_e_cp and pd.notna(row[col_e_cp]) else ""
                city = str(row[col_e_city]).strip() if col_e_city and pd.notna(row[col_e_city]) else ""
                weight = float(row[col_e_weight]) if col_e_weight and pd.notna(row[col_e_weight]) else 0.0
                volume = float(row[col_e_volume]) if col_e_volume and pd.notna(row[col_e_volume]) else 0.0
                priority = int(row[col_e_priority]) if col_e_priority and pd.notna(row[col_e_priority]) else 2
                start_window = str(row[col_e_start]).strip() if col_e_start and pd.notna(row[col_e_start]) else "08:00"
                end_window = str(row[col_e_end]).strip() if col_e_end and pd.notna(row[col_e_end]) else "18:00"
                obs = str(row[col_e_obs]).strip() if col_e_obs and pd.notna(row[col_e_obs]) else ""
                wh_val = str(row[col_e_wh]).strip() if col_e_wh and pd.notna(row[col_e_wh]) else ""
                
                # Check for coordinates in file
                has_coords = False
                lat_val = 0.0
                lon_val = 0.0
                if col_e_lat and col_e_lon:
                    try:
                        e_lat = row[col_e_lat]
                        e_lon = row[col_e_lon]
                        if pd.notna(e_lat) and pd.notna(e_lon):
                            lat_val = float(e_lat)
                            lon_val = float(e_lon)
                            if lat_val != 0 and -90 <= lat_val <= 90:
                                has_coords = True
                    except Exception:
                        has_coords = False
                        
                if has_coords:
                    res = {
                        "lat": lat_val,
                        "lon": lon_val,
                        "quality_level": 0,
                        "source": "FICHEIRO",
                        "morada_encontrada": addr
                    }
                else:
                    try:
                        res_tuple = geocoder.resolve_address(addr, cp, city)
                        res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    except Exception:
                        res = None
                        
                if res and res.get('lat') and res.get('lon'):
                    lat = res['lat']
                    lon = res['lon']
                    quality = res.get('quality_level', 1)
                    source = res.get('source', 'NOMINATIM')
                    morada_encontrada = res.get('morada_encontrada', addr)
                else:
                    lat = 0.0
                    lon = 0.0
                    quality = 99
                    source = "FALHA"
                    morada_encontrada = ""
                    
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("""
                        INSERT INTO entregas (
                            projeto_id, codigo_cliente, morada, codigo_postal, _concelho,
                            peso_kg, volume_m3, prioridade, janela_inicio, janela_fim,
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, code, addr, cp, city,
                        weight, volume, priority, start_window, end_window,
                        lat, lon, quality, source, morada_encontrada, wh_val
                    ))
                    conn.commit()
            
            state_dict["phase_1_complete"] = True

        state_dict["warehouses_geocoded"] = df_wh

        state_dict["fleet_config"] = fleet_dict

        state_dict["phase_2_complete"] = True

        

        payload = serialize_state(state_dict)

        snapshot_name = f"Importação de Frota Excel ({datetime.now().strftime('%H:%M:%S')})"

        

        with get_db() as conn:

            cursor = conn.cursor()

            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 

                           (project_id, current_user.id, 2, snapshot_name, payload))

            conn.commit()

            

        return {"status": "success", "message": "Frota e armazéns importados com sucesso."}

        

    except HTTPException as he:

        raise he

    except Exception as e:

        raise HTTPException(status_code=500, detail=f"Erro ao importar Excel de frota: {str(e)}")


