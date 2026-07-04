from fastapi import UploadFile, File



from fastapi import APIRouter, HTTPException, Depends



from pydantic import BaseModel



from typing import List, Dict, Any, Optional



import os



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



        



    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "geocoding_multi.db")



    geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)



    



    res = []



    for wh in warehouses:



        try:
            res_tuple = geocoder.resolve_address(f"{wh.address}, {wh.locality}", wh.cp, wh.locality)
            r_coords = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
        except Exception:
            r_coords = None



            



        if r_coords and r_coords.get("latitude") and r_coords.get("lon"):



            lat = r_coords["latitude"]



            lon = r_coords["longitude"]



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

            

        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "geocoding.db")

        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)

        

        wh_rows = []

        for idx, row in df_wh_raw.iterrows():

            name = str(row[col_wh_name]).strip()

            addr = str(row[col_wh_addr]).strip()

            cp = str(row[col_wh_cp]).strip()

            locality = str(row[col_wh_loc]).strip()

            

            try:

                g_res = geocoder.geocode(addr, cp, locality)

                lat = g_res.get('latitude', 39.5)

                lon = g_res.get('longitude', -8.0)

                quality = g_res.get('quality_level', 99)

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

