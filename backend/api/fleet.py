import unicodedata
def _norm_col(s: str) -> str:
    if not s:
        return ""
    s = str(s).strip().lower()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))

def _match_col(df_columns, candidates):
    cand_norms = [_norm_col(c) for c in candidates]
    for col in df_columns:
        if _norm_col(col) in cand_norms:
            return col
    # Fallback partial match
    for col in df_columns:
        c_norm = _norm_col(col)
        for cand in cand_norms:
            if cand in c_norm or c_norm in cand:
                return col
    return None

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



from database import get_db, get_projeto, ensure_entregas_columns



from utils.geocoder_engine import WaterfallGeocoder



from utils.persistence_manager import serialize_state, deserialize_state



from backend.api.auth import get_current_user, UserResponse







router = APIRouter(prefix="/fleet", tags=["fleet"])







class WarehouseItem(BaseModel):
    name: str
    address: str
    cp: Optional[str] = ""
    locality: Optional[str] = ""

class WarehouseGeocoded(BaseModel):
    name: str
    address: str
    cp: Optional[str] = ""
    locality: Optional[str] = ""
    lat: Optional[float] = 0.0
    lon: Optional[float] = 0.0
    quality: Optional[int] = 1

class VehicleItem(BaseModel):
    veiculo: str
    armazem: Optional[str] = ""
    matricula: Optional[str] = ""
    motorista: Optional[str] = ""
    capacidade_kg: Optional[float] = 1000.0
    capacidade_vol: Optional[float] = 5.0
    custo_km: Optional[float] = 0.5
    velocidade_media: Optional[float] = 40.0
    horario_inicio: Optional[str] = "08:00"
    horario_fim: Optional[str] = "18:00"
    is_active: Optional[int] = 1

class DriverItem(BaseModel):
    name: str
    pin: Optional[str] = "1234"
    phone: Optional[str] = ""
    vehicle: Optional[str] = ""
    is_active: Optional[int] = 1

class ReasonItem(BaseModel):
    reason: str
    category: Optional[str] = "Geral"

class FleetSaveRequest(BaseModel):
    fleet: List[VehicleItem] = []
    warehouses: List[WarehouseGeocoded] = []
    drivers: List[DriverItem] = []
    reasons: List[ReasonItem] = []



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
def download_unified_template():
    from utils.template_manager import create_unified_project_template
    from fastapi.responses import Response
    
    template_data = create_unified_project_template()
    return Response(
        content=template_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=GeoRoutePlan.xlsx"}
    )


def _pick_first_valid(*candidates):
    for c in candidates:
        if c is not None:
            if isinstance(c, pd.DataFrame):
                if not c.empty:
                    return c
            elif isinstance(c, (dict, list, str)):
                if len(c) > 0:
                    return c
            else:
                return c
    return None

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
            
            state_dict = {}
            if row and row["payload_json"]:
                state_dict = deserialize_state(row["payload_json"])
                
            raw_wh = _pick_first_valid(
                state_dict.get("warehouses_geocoded"),
                state_dict.get("warehouses_used"),
                state_dict.get("warehouses"),
                state_dict.get("df_warehouses")
            )
            warehouses_res = []
            if raw_wh is not None:
                if isinstance(raw_wh, pd.DataFrame):
                    df_wh = raw_wh
                elif isinstance(raw_wh, list):
                    df_wh = pd.DataFrame(raw_wh)
                elif isinstance(raw_wh, dict):
                    df_wh = pd.DataFrame.from_dict(raw_wh)
                else:
                    df_wh = pd.DataFrame()
                    
                if not df_wh.empty:
                    for idx, r in df_wh.iterrows():
                        warehouses_res.append({
                            "name": str(r.get("Nome_Armazem", r.get("name", ""))),
                            "address": str(r.get("Morada", r.get("address", ""))),
                            "cp": str(r.get("CP", r.get("cp", ""))),
                            "locality": str(r.get("Localidade", r.get("locality", ""))),
                            "lat": float(r.get("Latitude", r.get("lat", 0.0)) or 0.0),
                            "lon": float(r.get("Longitude", r.get("lon", 0.0)) or 0.0),
                            "quality": int(r.get("Nivel_Qualidade", r.get("quality", 1)) or 1)
                        })
            
            raw_fleet = _pick_first_valid(
                state_dict.get("fleet_config"),
                state_dict.get("fleet_config_used")
            )
            fleet_res = []
            if raw_fleet is not None:
                if isinstance(raw_fleet, dict):
                    for veh_name, veh in raw_fleet.items():
                        if hasattr(veh, "capacidade_kg"):
                            fleet_res.append({
                                "veiculo": str(veh_name),
                                "armazem": str(getattr(veh, "armazem", "") or ""),
                                "capacidade_kg": float(getattr(veh, "capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(getattr(veh, "capacidade_vol", 5.0) or 5.0),
                                "custo_km": float(getattr(veh, "custo_km", 0.5) or 0.5),
                                "velocidade_media": float(getattr(veh, "velocidade_media", 40.0) or 40.0),
                                "horario_inicio": str(getattr(veh, "horario_inicio", "08:00") or "08:00"),
                                "horario_fim": str(getattr(veh, "horario_fim", "18:00") or "18:00"),
                                "is_active": int(getattr(veh, "is_active", 1) if getattr(veh, "is_active", None) is not None else 1)
                            })
                        elif isinstance(veh, dict):
                            fleet_res.append({
                                "veiculo": str(veh_name),
                                "armazem": str(veh.get("armazem", "") or ""),
                                "capacidade_kg": float(veh.get("capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(veh.get("capacidade_vol", veh.get("capacidade_volume", 5.0)) or 5.0),
                                "custo_km": float(veh.get("custo_km", 0.5) or 0.5),
                                "velocidade_media": float(veh.get("velocidade_media", 40.0) or 40.0),
                                "horario_inicio": str(veh.get("horario_inicio", "08:00") or "08:00"),
                                "horario_fim": str(veh.get("horario_fim", "18:00") or "18:00"),
                                "is_active": int(veh.get("is_active", 1) if veh.get("is_active", None) is not None else 1)
                            })
                elif isinstance(raw_fleet, pd.DataFrame):
                    for _, veh in raw_fleet.iterrows():
                        v_name = str(veh.get("veiculo", veh.get("Nome_Veiculo", "")))
                        if v_name:
                            fleet_res.append({
                                "veiculo": v_name,
                                "armazem": str(veh.get("armazem", veh.get("Nome_Armazem", "")) or ""),
                                "capacidade_kg": float(veh.get("capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(veh.get("capacidade_volume", veh.get("capacidade_vol", 5.0)) or 5.0),
                                "custo_km": float(veh.get("custo_km", 0.5) or 0.5),
                                "velocidade_media": float(veh.get("velocidade_media", 40.0) or 40.0),
                                "horario_inicio": str(veh.get("horario_inicio", "08:00") or "08:00"),
                                "horario_fim": str(veh.get("horario_fim", "18:00") or "18:00"),
                                "is_active": int(veh.get("is_active", 1) if veh.get("is_active", None) is not None else 1)
                            })
                elif isinstance(raw_fleet, list):
                    for veh in raw_fleet:
                        if isinstance(veh, dict):
                            fleet_res.append({
                                "veiculo": str(veh.get("veiculo", "")),
                                "armazem": str(veh.get("armazem", "") or ""),
                                "capacidade_kg": float(veh.get("capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(veh.get("capacidade_vol", veh.get("capacidade_volume", 5.0)) or 5.0),
                                "custo_km": float(veh.get("custo_km", 0.5) or 0.5),
                                "velocidade_media": float(veh.get("velocidade_media", 40.0) or 40.0),
                                "horario_inicio": str(veh.get("horario_inicio", "08:00") or "08:00"),
                                "horario_fim": str(veh.get("horario_fim", "18:00") or "18:00"),
                                "is_active": int(veh.get("is_active", 1) if veh.get("is_active", None) is not None else 1)
                            })

            # If snapshot has no fleet, fallback to SQLite frota table
            if not fleet_res:
                from database import get_frota_projeto
                db_frota = get_frota_projeto(project_id)
                for f in db_frota:
                    fleet_res.append({
                        "veiculo": str(f["veiculo"]),
                        "armazem": str(f["armazem"]) if "armazem" in f.keys() and f["armazem"] else "",
                        "capacidade_kg": float(f["capacidade_kg"] or 1000.0),
                        "capacidade_vol": float(f["capacidade_volume"] if "capacidade_volume" in f.keys() and f["capacidade_volume"] is not None else 5.0),
                        "custo_km": float(f["custo_km"] or 0.5),
                        "velocidade_media": float(f["velocidade_media"] or 40.0),
                        "horario_inicio": str(f["horario_inicio"] or "08:00"),
                        "horario_fim": str(f["horario_fim"] or "18:00"),
                        "is_active": int(f["is_active"] if f.get("is_active") is not None else 1)
                    })

            # Extract DRIVERS
            raw_drivers = _pick_first_valid(
                state_dict.get("drivers"),
                state_dict.get("motoristas")
            )
            drivers_res = []
            if raw_drivers is not None:
                if isinstance(raw_drivers, list):
                    for d in raw_drivers:
                        if isinstance(d, dict):
                            drivers_res.append({
                                "name": str(d.get("name", d.get("Motorista", ""))),
                                "pin": str(d.get("pin", d.get("PIN/Password", d.get("PIN", "1234")))),
                                "phone": str(d.get("phone", d.get("Telemovel", d.get("Telem?vel", d.get("telefone", ""))))),
                                "vehicle": str(d.get("vehicle", d.get("Viatura", ""))),
                                "is_active": int(d.get("is_active", 1) if d.get("is_active") is not None else 1)
                            })
                elif isinstance(raw_drivers, pd.DataFrame):
                    for _, d in raw_drivers.iterrows():
                        drivers_res.append({
                            "name": str(d.get("Motorista", d.get("name", ""))),
                            "pin": str(d.get("PIN/Password", d.get("pin", "1234"))),
                            "phone": str(d.get("Telemovel", d.get("Telem?vel", d.get("phone", "")))),
                            "vehicle": str(d.get("Viatura", d.get("vehicle", ""))),
                            "is_active": int(d.get("is_active", 1) if d.get("is_active") is not None else 1)
                        })
            
            # Fallback for drivers from fleet vehicles if no explicit list
            if not drivers_res and fleet_res:
                for v in fleet_res:
                    mot = v.get("motorista", "")
                    if mot:
                        drivers_res.append({
                            "name": str(mot),
                            "pin": "1111",
                            "phone": "910000000",
                            "vehicle": v["veiculo"],
                            "is_active": 1
                        })

            # Extract REASONS
            raw_reasons = _pick_first_valid(
                state_dict.get("reasons"),
                state_dict.get("failure_reasons"),
                state_dict.get("justificacoes")
            )
            reasons_res = []
            if raw_reasons is not None:
                if isinstance(raw_reasons, list):
                    for r in raw_reasons:
                        if isinstance(r, dict):
                            reasons_res.append({
                                "reason": str(r.get("reason", r.get("Motivo de N?o Entrega", r.get("motivo", "")))),
                                "category": str(r.get("category", r.get("Categoria / A??o", r.get("categoria", "Geral"))))
                            })
                elif isinstance(raw_reasons, pd.DataFrame):
                    for _, r in raw_reasons.iterrows():
                        reasons_res.append({
                            "reason": str(r.get("Motivo de N?o Entrega", r.get("reason", ""))),
                            "category": str(r.get("Categoria / A??o", r.get("category", "Geral")))
                        })

            return {
                "fleet": fleet_res, 
                "warehouses": warehouses_res,
                "drivers": drivers_res,
                "reasons": reasons_res if reasons_res else None
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{project_id}")
@router.post("/{project_id}/save")
def save_fleet_config(project_id: int, req: FleetSaveRequest, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            row = cursor.fetchone()
            
            if row and row["payload_json"]:
                state_dict = deserialize_state(row["payload_json"])
            else:
                state_dict = {}
                
        wh_rows = []
        for wh in req.warehouses:
            wh_rows.append({
                "Nome_Armazem": wh.name,
                "Morada": wh.address,
                "CP": wh.cp or "",
                "Localidade": wh.locality or "",
                "Latitude": float(wh.lat or 0.0),
                "Longitude": float(wh.lon or 0.0),
                "Nivel_Qualidade": int(wh.quality or 1)
            })
        df_wh = pd.DataFrame(wh_rows)

        state_dict["warehouses_geocoded"] = df_wh
        state_dict["df_warehouses"] = df_wh

        # NOTE: Guardar como dict puro - FleetVehicle nao tem is_active e pode perder
        # campos durante a serializacao. Dict puro garante fidelidade total ao snapshot.
        fleet_dict = {}
        fleet_rows_for_db = []
        for veh in req.fleet:
            if not veh.veiculo or not veh.veiculo.strip():
                continue
            fleet_dict[veh.veiculo] = {
                "capacidade_kg": float(veh.capacidade_kg or 1000.0),
                "capacidade_vol": float(veh.capacidade_vol or 5.0),
                "custo_km": float(veh.custo_km or 0.5),
                "velocidade_media": float(veh.velocidade_media or 40.0),
                "horario_inicio": str(veh.horario_inicio or "08:00"),
                "horario_fim": str(veh.horario_fim or "18:00"),
                "armazem": str(veh.armazem or ""),
                "is_active": int(veh.is_active if veh.is_active is not None else 1)
            }
            fleet_rows_for_db.append({
                "veiculo": veh.veiculo,
                "capacidade_kg": float(veh.capacidade_kg or 1000.0),
                "capacidade_volume": float(veh.capacidade_vol or 5.0),
                "custo_km": float(veh.custo_km or 0.5),
                "velocidade_media": float(veh.velocidade_media or 40.0),
                "horario_inicio": str(veh.horario_inicio or "08:00"),
                "horario_fim": str(veh.horario_fim or "18:00"),
                "armazem": str(veh.armazem or ""),
                "is_active": int(veh.is_active if veh.is_active is not None else 1)
            })

        state_dict["fleet_config"] = fleet_dict
        state_dict["phase_2_complete"] = True

        # Save Drivers
        drivers_list = []
        for d in req.drivers:
            if not d.name or not d.name.strip():
                continue
            drivers_list.append({
                "name": str(d.name).strip(),
                "pin": str(d.pin or "1234").strip(),
                "phone": str(d.phone or "").strip(),
                "vehicle": str(d.vehicle or "").strip(),
                "is_active": int(d.is_active if d.is_active is not None else 1)
            })
        state_dict["drivers"] = drivers_list
        state_dict["motoristas"] = drivers_list

        # Save Reasons
        reasons_list = []
        for r in req.reasons:
            if not r.reason or not r.reason.strip():
                continue
            reasons_list.append({
                "reason": str(r.reason).strip(),
                "category": str(r.category or "Geral").strip()
            })
        state_dict["reasons"] = reasons_list
        state_dict["failure_reasons"] = reasons_list

        # Save to SQLite frota table
        from database import save_frota_projeto
        save_frota_projeto(project_id, fleet_rows_for_db)

        # Save to snapshots table
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
            sn = _norm_col(s)
            if 'armazem' in sn or 'warehouse' in sn or 'depot' in sn or 'origem' in sn:
                sheet_wh = s
                break
                
        wh_rows = []
        if sheet_wh:
            df_wh_raw = pd.read_excel(xls, sheet_name=sheet_wh)
            if not df_wh_raw.empty:
                col_wh_name = _match_col(df_wh_raw.columns, ['Nome_Armazem', 'Nome_Armazém', 'Armazem', 'Armazém', 'Warehouse', 'Nome'])
                col_wh_addr = _match_col(df_wh_raw.columns, ['Morada', 'Endereço', 'Address', 'Rua', 'Morada_Armazem'])
                col_wh_cp = _match_col(df_wh_raw.columns, ['CP', 'Código Postal', 'Codigo_Postal', 'Postal Code', 'Postal_Code', 'CodPostal'])
                col_wh_loc = _match_col(df_wh_raw.columns, ['Localidade', 'Cidade', 'Concelho', 'Locality', 'City'])
                col_wh_lat = _match_col(df_wh_raw.columns, ['Latitude', 'Lat', 'lat', 'latitude'])
                col_wh_lon = _match_col(df_wh_raw.columns, ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'])
                col_wh_open = _match_col(df_wh_raw.columns, ['Hora_Abertura', 'Abertura', 'Open', 'Hora Abertura'])
                col_wh_close = _match_col(df_wh_raw.columns, ['Hora_Fecho', 'Fecho', 'Close', 'Hora Fecho'])
                col_wh_load = _match_col(df_wh_raw.columns, ['Tempo_Carga_Min', 'Tempo_Carga', 'Tempo Carga (min)', 'Loading_Time'])
                col_wh_contact = _match_col(df_wh_raw.columns, ['Contacto_Responsavel', 'Contacto', 'Telefone', 'Phone'])
                
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
            sn = _norm_col(s)
            if 'frota' in sn or 'veiculo' in sn or 'fleet' in sn or 'vehicle' in sn or 'viatura' in sn:
                sheet_fleet = s
                break
                
        from core.session_state import FleetVehicle
        fleet_dict = {}
        if sheet_fleet:
            df_fleet_raw = pd.read_excel(xls, sheet_name=sheet_fleet)
            if not df_fleet_raw.empty:
                col_f_veh = _match_col(df_fleet_raw.columns, ['Veiculo', 'Veículo', 'Vehicle', 'Nome', 'Matricula', 'Viatura'])
                col_f_wh = _match_col(df_fleet_raw.columns, ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'])
                col_f_cap_kg = _match_col(df_fleet_raw.columns, ['Capacidade_KG', 'Capacidade_kg', 'Capacidade (kg)', 'Capacity_KG', 'Peso_Max', 'Capacidade'])
                col_f_cap_vol = _match_col(df_fleet_raw.columns, ['Capacidade_Vol', 'Capacidade_Volume', 'Capacidade (m3)', 'Capacity_Vol', 'Volume_m3', 'Volume'])
                col_f_speed = _match_col(df_fleet_raw.columns, ['Velocidade_Media', 'Velocidade_media', 'Velocidade Média', 'Speed'])
                col_f_start = _match_col(df_fleet_raw.columns, ['Hora_Inicio_Turno', 'Horario_Inicio', 'Hora Início', 'Start_Time', 'Inicio'])
                col_f_end = _match_col(df_fleet_raw.columns, ['Hora_Fim_Turno', 'Horario_Fim', 'Hora Fim', 'End_Time', 'Fim'])
                col_f_cost_km = _match_col(df_fleet_raw.columns, ['Custo_KM', 'Custo KM (€/km)', 'Custo_km', 'Cost_KM'])
                col_f_cost_hr = _match_col(df_fleet_raw.columns, ['Custo_Hora', 'Custo Hora (€/h)', 'Custo_hora', 'Cost_Hour'])
                col_f_max_deliv = _match_col(df_fleet_raw.columns, ['Max_Entregas', 'Max_Paragens', 'Max Deliveries'])
                col_f_rules = _match_col(df_fleet_raw.columns, ['Regras', 'Tags', 'Restricoes', 'Rules'])
                col_f_driver = _match_col(df_fleet_raw.columns, ['Motorista_Nome', 'Motorista', 'Driver_Name', 'Driver'])
                col_f_driver_tel = _match_col(df_fleet_raw.columns, ['Motorista_Telemovel', 'Telemovel_Motorista', 'Driver_Phone', 'Contacto_Motorista'])
                
                for idx, row in df_fleet_raw.iterrows():
                    v_name = str(row[col_f_veh]).strip() if col_f_veh and pd.notna(row[col_f_veh]) else ""
                    if not v_name or v_name == 'nan':
                        v_name = f"Viatura {idx + 1}"
                    
                    wh_name = str(row[col_f_wh]).strip() if col_f_wh and pd.notna(row[col_f_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Central")
                    cap_kg = float(row[col_f_cap_kg]) if col_f_cap_kg and pd.notna(row[col_f_cap_kg]) else 1000.0
                    cap_vol = float(row[col_f_cap_vol]) if col_f_cap_vol and pd.notna(row[col_f_cap_vol]) else 10.0
                    speed = float(row[col_f_speed]) if col_f_speed and pd.notna(row[col_f_speed]) else 50.0
                    start_t = str(row[col_f_start]).strip() if col_f_start and pd.notna(row[col_f_start]) else "08:00:00"
                    end_t = str(row[col_f_end]).strip() if col_f_end and pd.notna(row[col_f_end]) else "18:00:00"
                    cost_km = float(row[col_f_cost_km]) if col_f_cost_km and pd.notna(row[col_f_cost_km]) else 0.65
                    cost_hr = float(row[col_f_cost_hr]) if col_f_cost_hr and pd.notna(row[col_f_cost_hr]) else 12.50
                    max_deliv = int(row[col_f_max_deliv]) if col_f_max_deliv and pd.notna(row[col_f_max_deliv]) else 30
                    regras_str = str(row[col_f_rules]).strip() if col_f_rules and pd.notna(row[col_f_rules]) else ""
                    
                    v_obj = FleetVehicle(
                        capacidade_kg=cap_kg,
                        capacidade_vol=cap_vol,
                        custo_km=cost_km,
                        velocidade_media=speed,
                        horario_inicio=start_t,
                        horario_fim=end_t,
                        armazem=wh_name
                    )
                    v_obj.custo_hora = cost_hr
                    v_obj.max_entregas = max_deliv
                    v_obj.regras = regras_str
                    if col_f_driver and pd.notna(row[col_f_driver]):
                        v_obj.motorista_nome = str(row[col_f_driver]).strip()
                    if col_f_driver_tel and pd.notna(row[col_f_driver_tel]):
                        v_obj.motorista_telemovel = str(row[col_f_driver_tel]).strip()
                    
                    fleet_dict[v_name] = v_obj

        # 3. Sheet: Regras
        sheet_rules = None
        for s in xls.sheet_names:
            sn = _norm_col(s)
            if 'regra' in sn or 'rule' in sn or 'restricao' in sn or 'matriz' in sn:
                sheet_rules = s
                break
                
        rules_matrix = []
        if sheet_rules:
            df_rules_raw = pd.read_excel(xls, sheet_name=sheet_rules)
            if not df_rules_raw.empty:
                col_r_vtag = _match_col(df_rules_raw.columns, ['Tag_Veiculo', 'Tag_Viatura', 'Veiculo_Tag', 'Tag Veiculo'])
                col_r_perm = _match_col(df_rules_raw.columns, ['Permissao', 'Permitido', 'Status', 'Regra'])
                col_r_etag = _match_col(df_rules_raw.columns, ['Tag_Entrega', 'Tag_Cliente', 'Entrega_Tag', 'Tag Entrega'])
                col_r_desc = _match_col(df_rules_raw.columns, ['Descricao', 'Descrição', 'Notas', 'Motivo'])
                
                for idx, row in df_rules_raw.iterrows():
                    vtag = str(row[col_r_vtag]).strip() if col_r_vtag and pd.notna(row[col_r_vtag]) else ""
                    etag = str(row[col_r_etag]).strip() if col_r_etag and pd.notna(row[col_r_etag]) else ""
                    perm = str(row[col_r_perm]).strip() if col_r_perm and pd.notna(row[col_r_perm]) else "SIM"
                    desc = str(row[col_r_desc]).strip() if col_r_desc and pd.notna(row[col_r_desc]) else ""
                    if vtag or etag:
                        rules_matrix.append({
                            "tag_veiculo": vtag,
                            "tag_entrega": etag,
                            "permissao": perm,
                            "descricao": desc
                        })

        # 4. Sheet: Entregas
        sheet_entregas = None
        for s in xls.sheet_names:
            sn = _norm_col(s)
            if 'entrega' in sn or 'cliente' in sn or 'delivery' in sn or 'order' in sn or 'encomenda' in sn:
                sheet_entregas = s
                break
                
        deliveries_list = []
        if sheet_entregas:
            df_entregas_raw = pd.read_excel(xls, sheet_name=sheet_entregas)
            if not df_entregas_raw.empty:
                col_e_wh = _match_col(df_entregas_raw.columns, ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'])
                col_e_code = _match_col(df_entregas_raw.columns, ['Doc_ID', 'Doc ID', 'Documento', 'Codigo_Cliente', 'Cod_Cliente', 'Codigo', 'ID_Original', 'Doc'])
                col_e_name = _match_col(df_entregas_raw.columns, ['Cliente', 'Nome_Cliente', 'Client_Name', 'Nome', 'Designacao'])
                col_e_addr = _match_col(df_entregas_raw.columns, ['Morada', 'Endereço', 'Address', 'Rua', 'Morada_Entrega'])
                col_e_cp = _match_col(df_entregas_raw.columns, ['CP', 'Codigo_Postal', 'Código Postal', 'Postal_Code', 'Cod_Postal', 'Postal Code', 'CodPostal'])
                col_e_city = _match_col(df_entregas_raw.columns, ['Localidade', 'Cidade', 'Concelho', 'Locality', 'City'])
                col_e_tel = _match_col(df_entregas_raw.columns, ['Telefone_Cliente', 'Telefone', 'Phone', 'Contacto', 'Telemovel', 'Telemóvel', 'Tel'])
                col_e_weight = _match_col(df_entregas_raw.columns, ['Peso_KG', 'Peso', 'Weight', 'Carga_KG', 'Carga', 'Peso_Total'])
                col_e_volume = _match_col(df_entregas_raw.columns, ['Volume_M3', 'Volume_m3', 'Volume', 'Capacidade_Vol', 'Volumes'])
                col_e_j1_start = _match_col(df_entregas_raw.columns, ['Janela1_Inicio', 'Janela_Inicio', 'Janela_1_Inicio', 'Hora_Inicio', 'Inicio', 'Janela_Horaria'])
                col_e_j1_end = _match_col(df_entregas_raw.columns, ['Janela1_Fim', 'Janela_Fim', 'Janela_1_Fim', 'Hora_Fim', 'Fim'])
                col_e_unload = _match_col(df_entregas_raw.columns, ['Tempo_Descarga_Min', 'Tempo_Descarga', 'Tempo_Entrega', 'Unload_Time', 'Tempo'])
                col_e_op_type = _match_col(df_entregas_raw.columns, ['Tipo_Operacao', 'Tipo', 'Operation', 'Tipo_Doc'])
                col_e_rules = _match_col(df_entregas_raw.columns, ['Regras', 'Tags', 'Restricoes', 'Rules'])
                col_e_obs = _match_col(df_entregas_raw.columns, ['Notas_Entrega', 'Notas_Motorista', 'Observacoes', 'Observações', 'Notas', 'Obs', 'Instrucoes', 'Notas_Condutor', 'Instruções'])
                col_e_prio = _match_col(df_entregas_raw.columns, ['Prioridade', 'Priority', 'Prio'])
                col_e_vend = _match_col(df_entregas_raw.columns, ['Vendedor', 'vendedor', 'Comercial', 'Sales_Rep', 'Agente'])
                col_e_lat = _match_col(df_entregas_raw.columns, ['Latitude', 'Lat', 'lat', 'latitude'])
                col_e_lon = _match_col(df_entregas_raw.columns, ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'])

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
                            
                    vend_val = str(row[col_e_vend]).strip() if col_e_vend and pd.notna(row[col_e_vend]) else ""
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
                        "notas_motorista": obs,
                        "Observacoes": obs,
                        "observacoes": obs,
                        "Prioridade": prio_str,
                        "Vendedor": vend_val,
                        "vendedor": vend_val,
                        "Rota": "Por Distribuir",
                        "Ordem": idx + 1
                    })

        # 5. Sheet: Rotas (Planeamento pré-definido)
        sheet_rotas = None
        for s in xls.sheet_names:
            sn = _norm_col(s)
            if 'rota' in sn or 'route' in sn or 'planeamento' in sn or 'plano' in sn:
                sheet_rotas = s
                break
                
        routes_solution_list = []
        if sheet_rotas:
            df_rotas_raw = pd.read_excel(xls, sheet_name=sheet_rotas)
            if not df_rotas_raw.empty:
                col_rt_wh = _match_col(df_rotas_raw.columns, ['Armazem', 'Armazém', 'Warehouse', 'Nome_Armazem'])
                col_rt_veh = _match_col(df_rotas_raw.columns, ['Rota', 'Veiculo', 'Veículo', 'Vehicle', 'Route', 'Nome_Veiculo', 'Carro'])
                col_rt_ord = _match_col(df_rotas_raw.columns, ['Ordem', 'Ordem_Paragem', 'Stop_Order', 'Seq', 'Posicao'])
                col_rt_doc = _match_col(df_rotas_raw.columns, ['ID_Original', 'Doc_ID', 'Doc ID', 'Documento', 'Codigo_Cliente', 'Cod_Cliente', 'Codigo', 'Id', 'Doc'])
                col_rt_cli = _match_col(df_rotas_raw.columns, ['Cliente', 'Nome_Cliente', 'Client_Name', 'Nome', 'Designacao'])
                col_rt_addr = _match_col(df_rotas_raw.columns, ['Morada', 'Address', 'Rua', 'Endereço', 'Morada_Entrega'])
                col_rt_cp = _match_col(df_rotas_raw.columns, ['CodPostal', 'CP', 'Codigo_Postal', 'Código Postal', 'Postal_Code', 'Cod_Postal'])
                col_rt_loc = _match_col(df_rotas_raw.columns, ['Localidade', 'Cidade', 'City', 'Concelho', 'Locality'])
                col_rt_tel = _match_col(df_rotas_raw.columns, ['Contacto', 'Telefone_Cliente', 'Telefone', 'Phone', 'Tel', 'Telemovel', 'Telemóvel'])
                col_rt_win = _match_col(df_rotas_raw.columns, ['Janela_Horaria', 'Janela_Horária', 'Janela', 'Horario', 'Janela_Inicio'])
                col_rt_arr = _match_col(df_rotas_raw.columns, ['Hora_Chegada_Prevista', 'Chegada_Prevista', 'ETA', 'Hora_Chegada', 'Chegada'])
                col_rt_dep = _match_col(df_rotas_raw.columns, ['Hora_Saida_Prevista', 'Saida_Prevista', 'ETD', 'Hora_Saida', 'Saida'])
                col_rt_dist = _match_col(df_rotas_raw.columns, ['Distancia_KM', 'Distancia', 'Distancia_km', 'KM'])
                col_rt_cum_dist = _match_col(df_rotas_raw.columns, ['Distancia_Acumulada_KM', 'Distancia_Acumulada', 'Dist_Acum'])
                col_rt_t_viag = _match_col(df_rotas_raw.columns, ['Tempo_Viagem_Min', 'Tempo_Viagem'])
                col_rt_t_esp = _match_col(df_rotas_raw.columns, ['Tempo_Espera_Min', 'Tempo_Espera'])
                col_rt_cg_kg = _match_col(df_rotas_raw.columns, ['Peso', 'Peso_KG', 'Carga_Restante_KG', 'Carga_Restante', 'Carga_KG', 'Peso_Total'])
                col_rt_cg_vol = _match_col(df_rotas_raw.columns, ['Volumes', 'Volume_M3', 'Volume_m3', 'Volume', 'Carga_Restante_Vol', 'Carga_Vol'])
                col_rt_lat = _match_col(df_rotas_raw.columns, ['Latitude', 'Lat', 'lat', 'latitude'])
                col_rt_lon = _match_col(df_rotas_raw.columns, ['Longitude', 'Lon', 'lon', 'longitude', 'lng', 'Lng'])
                col_rt_status = _match_col(df_rotas_raw.columns, ['Status', 'Estado', 'Situacao'])
                col_rt_vend = _match_col(df_rotas_raw.columns, ['Vendedor', 'vendedor', 'Comercial', 'sales_rep', 'Agente'])
                col_rt_obs = _match_col(df_rotas_raw.columns, ['Observações', 'Observacoes', 'Notas_Motorista', 'Notas_Entrega', 'Notas', 'Obs', 'Instrucoes', 'Notas_Condutor'])
                
                # Reverse engineering warehouses from Rotas if missing
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

                # Register all vehicle routes found in Rotas sheet
                if col_rt_veh:
                    for v_val in df_rotas_raw[col_rt_veh].dropna().unique():
                        v_str = str(v_val).strip()
                        if not v_str or "distribuir" in v_str.lower() or "pendente" in v_str.lower():
                            continue
                        if v_str not in fleet_dict:
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
                            
                # Coordinate & info lookup from deliveries_list
                coord_map = {}
                for d in deliveries_list:
                    d_info = {
                        "lat": d.get("Latitude", 0.0),
                        "lon": d.get("Longitude", 0.0),
                        "peso": d.get("Peso_KG", 50.0),
                        "vol": d.get("Volume_M3", 0.1),
                        "tel": d.get("Telefone_Cliente", d.get("Telefone", "")),
                        "obs": d.get("Notas_Motorista", d.get("Observacoes", "")),
                        "vend": d.get("Vendedor", d.get("vendedor", "")),
                        "nome": d.get("Cliente", d.get("Nome_Cliente", "")),
                        "morada": d.get("Morada", ""),
                        "cp": d.get("CP", ""),
                        "loc": d.get("Localidade", ""),
                        "armazem": d.get("Armazem", "")
                    }
                    if d.get("Doc_ID"):
                        coord_map[str(d["Doc_ID"]).strip().upper()] = d_info
                    if d.get("Cliente"):
                        coord_map[str(d["Cliente"]).strip().upper()] = d_info
                    if d.get("Morada"):
                        coord_map[str(d["Morada"]).strip().upper()] = d_info
                    if d.get("Morada") and d.get("CP"):
                        coord_map[f"{d['Morada']}_{d['CP']}".strip().upper()] = d_info

                # Process all Rotas rows
                for r_idx, r_row in df_rotas_raw.iterrows():
                    veh_name = str(r_row[col_rt_veh]).strip() if col_rt_veh and pd.notna(r_row[col_rt_veh]) else "Por Distribuir"
                    if not veh_name or veh_name.lower() == 'nan':
                        veh_name = "Por Distribuir"
                        
                    ord_val = int(r_row[col_rt_ord]) if col_rt_ord and pd.notna(r_row[col_rt_ord]) else (r_idx + 1)
                    doc_val = str(r_row[col_rt_doc]).strip() if col_rt_doc and pd.notna(r_row[col_rt_doc]) else f"CLI_{r_idx+1}"
                    cli_val = str(r_row[col_rt_cli]).replace("_x000D_", "").strip() if col_rt_cli and pd.notna(r_row[col_rt_cli]) else doc_val
                    addr_val = str(r_row[col_rt_addr]).strip() if col_rt_addr and pd.notna(r_row[col_rt_addr]) else ""
                    cp_val = str(r_row[col_rt_cp]).strip() if col_rt_cp and pd.notna(r_row[col_rt_cp]) else ""
                    loc_val = str(r_row[col_rt_loc]).strip() if col_rt_loc and pd.notna(r_row[col_rt_loc]) else ""
                    wh_name = str(r_row[col_rt_wh]).strip() if col_rt_wh and pd.notna(r_row[col_rt_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Principal")
                    
                    p_kg = float(r_row[col_rt_cg_kg]) if col_rt_cg_kg and pd.notna(r_row[col_rt_cg_kg]) else 50.0
                    v_m3 = float(r_row[col_rt_cg_vol]) if col_rt_cg_vol and pd.notna(r_row[col_rt_cg_vol]) else 0.1
                    
                    # Match lookup from coord_map
                    matched_info = (
                        coord_map.get(doc_val.upper()) or 
                        coord_map.get(cli_val.upper()) or 
                        coord_map.get(addr_val.upper()) or 
                        coord_map.get(f"{addr_val}_{cp_val}".upper()) or 
                        {}
                    )
                    
                    c_lat = 0.0
                    c_lon = 0.0
                    if col_rt_lat and col_rt_lon and pd.notna(r_row[col_rt_lat]) and pd.notna(r_row[col_rt_lon]):
                        try:
                            c_lat = float(r_row[col_rt_lat])
                            c_lon = float(r_row[col_rt_lon])
                        except Exception:
                            pass
                    if (c_lat == 0 or c_lon == 0) and matched_info:
                        c_lat = float(matched_info.get("lat", 0.0))
                        c_lon = float(matched_info.get("lon", 0.0))
                        if not p_kg or p_kg == 50.0:
                            p_kg = float(matched_info.get("peso", 50.0))
                        if not v_m3 or v_m3 == 0.1:
                            v_m3 = float(matched_info.get("vol", 0.1))
                            
                    if (c_lat == 0 or c_lon == 0) and addr_val:
                        try:
                            res_tuple = geocoder.resolve_address(addr_val, cp_val, loc_val, fast_mode=True)
                            res_geo = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                            if res_geo and res_geo.get('lat') and res_geo.get('lon'):
                                c_lat = res_geo['lat']
                                c_lon = res_geo['lon']
                        except Exception:
                            pass
                            
                    rt_vend = str(r_row[col_rt_vend]).strip() if col_rt_vend and pd.notna(r_row[col_rt_vend]) else matched_info.get("vend", "")
                    rt_obs = str(r_row[col_rt_obs]).strip() if col_rt_obs and pd.notna(r_row[col_rt_obs]) else matched_info.get("obs", "")
                    rt_tel = str(r_row[col_rt_tel]).strip() if col_rt_tel and pd.notna(r_row[col_rt_tel]) else matched_info.get("tel", "")
                    
                    # Also update deliveries_list item if matching
                    for d_item in deliveries_list:
                        if (
                            (doc_val and str(d_item.get("Doc_ID")).strip().upper() == doc_val.upper()) or
                            (cli_val and str(d_item.get("Cliente")).strip().upper() == cli_val.upper()) or
                            (addr_val and str(d_item.get("Morada")).strip().upper() == addr_val.upper())
                        ):
                            d_item["Rota"] = veh_name
                            d_item["Ordem"] = ord_val
                            if rt_obs:
                                d_item["Notas_Motorista"] = rt_obs
                                d_item["notas_motorista"] = rt_obs
                                d_item["Observacoes"] = rt_obs
                                d_item["observacoes"] = rt_obs
                            if rt_vend:
                                d_item["Vendedor"] = rt_vend
                                d_item["vendedor"] = rt_vend
                            break

                    routes_solution_list.append({
                        "id": r_idx + 1,
                        "ID_Original": doc_val,
                        "Doc_ID": doc_val,
                        "Codigo_Cliente": doc_val,
                        "Cliente": cli_val,
                        "Nome_Cliente": cli_val,
                        "Morada": addr_val,
                        "CP": cp_val,
                        "Localidade": loc_val,
                        "Telefone_Cliente": rt_tel,
                        "Telefone": rt_tel,
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
                        "Status": str(r_row[col_rt_status]).strip() if col_rt_status and pd.notna(r_row[col_rt_status]) else "Planeado",
                        "Notas_Motorista": rt_obs,
                        "notas_motorista": rt_obs,
                        "Observacoes": rt_obs,
                        "observacoes": rt_obs,
                        "Vendedor": rt_vend,
                        "vendedor": rt_vend,
                        "Peso_KG": p_kg,
                        "Volume_m3": v_m3
                    })
                    
        # If no explicit Sheet 5 Rotas, but deliveries_list exists, construct routes_solution_list from deliveries
        if not routes_solution_list and deliveries_list:
            for idx, d in enumerate(deliveries_list):
                routes_solution_list.append({
                    "id": idx + 1,
                    "ID_Original": d.get("Doc_ID", f"CLI_{idx+1}"),
                    "Doc_ID": d.get("Doc_ID", f"CLI_{idx+1}"),
                    "Codigo_Cliente": d.get("Codigo_Cliente", d.get("Doc_ID", f"CLI_{idx+1}")),
                    "Cliente": d.get("Cliente", d.get("Nome_Cliente", "")),
                    "Nome_Cliente": d.get("Nome_Cliente", d.get("Cliente", "")),
                    "Morada": d.get("Morada", ""),
                    "CP": d.get("CP", ""),
                    "Localidade": d.get("Localidade", ""),
                    "Telefone_Cliente": d.get("Telefone_Cliente", d.get("Telefone", "")),
                    "Telefone": d.get("Telefone_Cliente", d.get("Telefone", "")),
                    "Latitude": float(d.get("Latitude", 0.0)),
                    "Longitude": float(d.get("Longitude", 0.0)),
                    "Rota": d.get("Rota", "Por Distribuir"),
                    "Veiculo": d.get("Rota", "Por Distribuir"),
                    "Armazem": d.get("Armazem", wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Principal"),
                    "Ordem": d.get("Ordem", idx + 1),
                    "Ordem_Paragem": d.get("Ordem", idx + 1),
                    "Janela_Horaria": d.get("Janela_Horaria", "08:00 - 18:00"),
                    "Hora_Chegada_Prevista": "",
                    "Hora_Saida_Prevista": "",
                    "Distancia_KM": 0.0,
                    "Distancia_Acumulada_KM": 0.0,
                    "Tempo_Viagem_Min": 0.0,
                    "Tempo_Espera_Min": 0.0,
                    "Carga_Restante_KG": float(d.get("Peso_KG", 50.0)),
                    "Carga_Restante_Vol": float(d.get("Volume_M3", 0.1)),
                    "Status": "Pendente",
                    "Notas_Motorista": d.get("Notas_Motorista", d.get("Observacoes", "")),
                    "notas_motorista": d.get("Notas_Motorista", d.get("Observacoes", "")),
                    "Observacoes": d.get("Observacoes", d.get("Notas_Motorista", "")),
                    "observacoes": d.get("Observacoes", d.get("Notas_Motorista", "")),
                    "Vendedor": d.get("Vendedor", d.get("vendedor", "")),
                    "vendedor": d.get("Vendedor", d.get("vendedor", "")),
                    "Peso_KG": float(d.get("Peso_KG", 50.0)),
                    "Volume_m3": float(d.get("Volume_M3", 0.1))
                })

        # --- D. SAVE DELIVERIES TO SQLITE DB FOR PHASE 1 GEOREFERENCING ---
        if deliveries_list:
            ensure_entregas_columns()
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
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem,
                            telefone, observacoes, vendedor, rota, ordem_paragem
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, d.get("Doc_ID", ""), d.get("Cliente", ""), d.get("Morada", ""),
                        d.get("CP", ""), d.get("Localidade", ""), float(d.get("Peso_KG", 50.0)),
                        float(d.get("Volume_M3", 0.1)), 2, d.get("Janela_Inicio", "08:00"),
                        d.get("Janela_Fim", "18:00"), lat_d, lon_d, qual_d, src_d,
                        d.get("Morada", ""), d.get("Armazem", "Armazém Principal"),
                        d.get("Telefone_Cliente", d.get("Telefone", "")),
                        d.get("Notas_Motorista", d.get("Observacoes", "")),
                        d.get("Vendedor", d.get("vendedor", "")),
                        d.get("Rota", "Por Distribuir"),
                        int(d.get("Ordem", 1))
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

        # 6. Sheet: Motoristas e Carros
        sheet_drivers = None
        for s in xls.sheet_names:
            sn = _norm_col(s)
            if 'motorista' in sn or 'driver' in sn or 'condutor' in sn or 'equipa' in sn:
                sheet_drivers = s
                break
                
        drivers_list = []
        if sheet_drivers:
            df_drivers_raw = pd.read_excel(xls, sheet_name=sheet_drivers)
            if not df_drivers_raw.empty:
                col_dr_name = _match_col(df_drivers_raw.columns, ['Motorista', 'Nome', 'Nome_Motorista', 'Driver', 'Driver_Name'])
                col_dr_pin = _match_col(df_drivers_raw.columns, ['PIN/Password', 'PIN', 'Password', 'Pin', 'Senha', 'Codigo', 'Pin_Code'])
                col_dr_veh = _match_col(df_drivers_raw.columns, ['Viatura', 'Veiculo', 'Veiculo', 'Vehicle', 'Carro', 'Nome_Veiculo'])
                col_dr_mat = _match_col(df_drivers_raw.columns, ['Matricula', 'Matricula', 'Plate', 'License_Plate'])
                col_dr_tel = _match_col(df_drivers_raw.columns, ['Telemovel', 'Telemovel', 'Telefone', 'Phone', 'Contacto', 'Driver_Phone', 'Telemovel_Motorista'])
                col_dr_route = _match_col(df_drivers_raw.columns, ['Rota Atribuida', 'Rota_Atribuida', 'Rota', 'Route', 'Plano'])
                
                for idx, r_row in df_drivers_raw.iterrows():
                    dr_name = str(r_row[col_dr_name]).replace("_x000D_", "").strip() if col_dr_name and pd.notna(r_row[col_dr_name]) else ""
                    if not dr_name or dr_name.lower() == 'nan':
                        continue
                    
                    dr_pin = str(r_row[col_dr_pin]).strip() if col_dr_pin and pd.notna(r_row[col_dr_pin]) else "1234"
                    if dr_pin.endswith('.0'):
                        dr_pin = dr_pin[:-2]
                    dr_veh = str(r_row[col_dr_veh]).strip() if col_dr_veh and pd.notna(r_row[col_dr_veh]) else ""
                    if dr_veh.lower() == 'nan':
                        dr_veh = ""
                    dr_tel = str(r_row[col_dr_tel]).strip() if col_dr_tel and pd.notna(r_row[col_dr_tel]) else ""
                    if dr_tel.lower() == 'nan':
                        dr_tel = ""
                    dr_mat = str(r_row[col_dr_mat]).strip() if col_dr_mat and pd.notna(r_row[col_dr_mat]) else ""
                    if dr_mat.lower() == 'nan':
                        dr_mat = ""
                    dr_route = str(r_row[col_dr_route]).strip() if col_dr_route and pd.notna(r_row[col_dr_route]) else ""
                    if dr_route.lower() == 'nan':
                        dr_route = ""
                        
                    drivers_list.append({
                        "name": dr_name,
                        "pin": dr_pin,
                        "phone": dr_tel,
                        "vehicle": dr_veh,
                        "matricula": dr_mat,
                        "route": dr_route,
                        "is_active": 1
                    })
                    
        # Fallback for drivers from fleet if no Sheet 7
        if not drivers_list and fleet_dict:
            for v_name, v_data in fleet_dict.items():
                m_name = getattr(v_data, 'motorista_nome', '') if hasattr(v_data, 'motorista_nome') else (v_data.get('motorista_nome', '') if isinstance(v_data, dict) else '')
                m_tel = getattr(v_data, 'motorista_telemovel', '') if hasattr(v_data, 'motorista_telemovel') else (v_data.get('motorista_telemovel', '') if isinstance(v_data, dict) else '')
                if m_name and m_name.lower() != 'nan':
                    drivers_list.append({
                        "name": m_name,
                        "pin": "1111",
                        "phone": m_tel or "910000000",
                        "vehicle": v_name,
                        "matricula": "",
                        "route": "",
                        "is_active": 1
                    })

        # 7. Sheet: Justifica??o entregas
        sheet_reasons = None
        for s in xls.sheet_names:
            sn = _norm_col(s)
            if 'justifica' in sn or 'motivo' in sn or 'reason' in sn or 'falha' in sn or 'nao entrega' in sn or 'recusa' in sn:
                sheet_reasons = s
                break
                
        reasons_list = []
        if sheet_reasons:
            df_reasons_raw = pd.read_excel(xls, sheet_name=sheet_reasons)
            if not df_reasons_raw.empty:
                col_rs_reason = _match_col(df_reasons_raw.columns, ['Motivo de Nao Entrega', 'Motivo de N?o Entrega', 'Motivo', 'Reason', 'Descricao', 'Justificacao', 'Motivo_Falha'])
                col_rs_cat = _match_col(df_reasons_raw.columns, ['Categoria / Acao', 'Categoria / A??o', 'Categoria', 'Category', 'Acao', 'Tipo'])
                
                for idx, r_row in df_reasons_raw.iterrows():
                    r_val = str(r_row[col_rs_reason]).strip() if col_rs_reason and pd.notna(r_row[col_rs_reason]) else ""
                    if not r_val or r_val.lower() == 'nan':
                        continue
                    c_val = str(r_row[col_rs_cat]).strip() if col_rs_cat and pd.notna(r_row[col_rs_cat]) else "Geral"
                    if c_val.lower() == 'nan':
                        c_val = "Geral"
                    reasons_list.append({
                        "reason": r_val,
                        "category": c_val
                    })

        # 8. Persist Complete Snapshot
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
            "drivers": drivers_list,
            "motoristas": drivers_list,
            "reasons": reasons_list,
            "failure_reasons": reasons_list,
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
        
        msg = f"Ficheiro importado com sucesso ({len(wh_rows)} armaz?ns, {len(fleet_dict)} ve?culos, {len(deliveries_list)} entregas georreferenciadas, {len(drivers_list)} motoristas, {len(reasons_list)} motivos de n?o entrega, {len(routes_solution_list)} paragens atribu?das)."
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
