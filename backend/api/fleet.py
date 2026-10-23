import unicodedata
def _clean_coord(val) -> float:
    if val is None or pd.isna(val):
        return 0.0
    s = str(val).strip().replace(",", ".")
    try:
        return float(s)
    except Exception:
        return 0.0

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
    open_time: Optional[str] = "06:00:00"
    close_time: Optional[str] = "22:00:00"
    load_time: Optional[int] = 30
    contact: Optional[str] = ""
    is_active: Optional[int] = 1

class VehicleItem(BaseModel):
    armazem: Optional[str] = ""
    veiculo: str
    capacidade_kg: Optional[float] = 1000.0
    capacidade_vol: Optional[float] = 10.0
    velocidade_media: Optional[float] = 50.0
    horario_inicio: Optional[str] = "08:00:00"
    horario_fim: Optional[str] = "18:00:00"
    custo_km: Optional[float] = 0.65
    custo_hora: Optional[float] = 12.50
    max_entregas: Optional[int] = 30
    regras: Optional[str] = ""
    motorista_nome: Optional[str] = ""
    motorista_telemovel: Optional[str] = ""
    is_active: Optional[int] = 1
    segunda_volta: Optional[str] = "Não"
    regresso_armazem: Optional[str] = "Sim"

class DriverItem(BaseModel):
    name: str
    pin: Optional[str] = "1234"
    vehicle: Optional[str] = ""
    matricula: Optional[str] = ""
    phone: Optional[str] = ""
    route: Optional[str] = ""
    is_active: Optional[int] = 1

class ReasonItem(BaseModel):
    code: Optional[str] = ""
    reason: str
    category: Optional[str] = "Geral"
    action_required: Optional[str] = "Reagendar"
    is_active: Optional[int] = 1

class RuleItem(BaseModel):
    tag_veiculo: str = ""
    tag_entrega: str = ""
    permissao: Optional[str] = "SIM"
    descricao: Optional[str] = ""
    is_active: Optional[int] = 1

class FleetSaveRequest(BaseModel):
    fleet: List[VehicleItem] = []
    warehouses: List[WarehouseGeocoded] = []
    rules_matrix: List[RuleItem] = []
    drivers: List[DriverItem] = []
    reasons: List[ReasonItem] = []
    clients: Optional[List[Dict[str, Any]]] = None



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
                        lat_w = _clean_coord(r.get("Latitude", r.get("lat", 0.0)))
                        lon_w = _clean_coord(r.get("Longitude", r.get("lon", 0.0)))
                        cp_w = str(r.get("CP", r.get("cp", r.get("Codigo_Postal", ""))) or "").strip()
                        if cp_w.endswith(".0"):
                            cp_w = cp_w[:-2]
                        warehouses_res.append({
                            "name": str(r.get("Nome_Armazem", r.get("name", ""))),
                            "address": str(r.get("Morada", r.get("address", ""))),
                            "cp": cp_w,
                            "locality": str(r.get("Localidade", r.get("locality", ""))),
                            "lat": lat_w,
                            "lon": lon_w,
                            "open_time": str(r.get("Hora_Abertura", r.get("open_time", "06:00:00")) or "06:00:00"),
                            "close_time": str(r.get("Hora_Fecho", r.get("close_time", "22:00:00")) or "22:00:00"),
                            "load_time": int(r.get("Tempo_Carga_Min", r.get("load_time", 30)) or 30),
                            "contact": str(r.get("Contacto_Responsavel", r.get("contact", "")) or ""),
                            "quality": 1 if (lat_w != 0.0 and lon_w != 0.0) else int(r.get("Nivel_Qualidade", r.get("quality", 99)) or 99),
                            "is_active": int(r.get("is_active", 1) if r.get("is_active") is not None else 1)
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
                                "armazem": str(getattr(veh, "armazem", "") or ""),
                                "veiculo": str(veh_name),
                                "capacidade_kg": float(getattr(veh, "capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(getattr(veh, "capacidade_vol", 10.0) or 10.0),
                                "velocidade_media": float(getattr(veh, "velocidade_media", 50.0) or 50.0),
                                "horario_inicio": str(getattr(veh, "horario_inicio", "08:00:00") or "08:00:00"),
                                "horario_fim": str(getattr(veh, "horario_fim", "18:00:00") or "18:00:00"),
                                "custo_km": float(getattr(veh, "custo_km", 0.65) or 0.65),
                                "custo_hora": float(getattr(veh, "custo_hora", 12.50) or 12.50),
                                "max_entregas": int(getattr(veh, "max_entregas", 30) or 30),
                                "regras": str(getattr(veh, "regras", "") or ""),
                                "motorista_nome": str(getattr(veh, "motorista_nome", "") or ""),
                                "motorista_telemovel": str(getattr(veh, "motorista_telemovel", "") or ""),
                                "is_active": int(getattr(veh, "is_active", 1) if getattr(veh, "is_active", None) is not None else 1),
                                "segunda_volta": str(getattr(veh, "segunda_volta", "Não") or "Não"),
                                "regresso_armazem": str(getattr(veh, "regresso_armazem", "Sim") or "Sim")
                            })
                        elif isinstance(veh, dict):
                            fleet_res.append({
                                "armazem": str(veh.get("armazem", "") or ""),
                                "veiculo": str(veh_name),
                                "capacidade_kg": float(veh.get("capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(veh.get("capacidade_vol", veh.get("capacidade_volume", 10.0)) or 10.0),
                                "velocidade_media": float(veh.get("velocidade_media", 50.0) or 50.0),
                                "horario_inicio": str(veh.get("horario_inicio", "08:00:00") or "08:00:00"),
                                "horario_fim": str(veh.get("horario_fim", "18:00:00") or "18:00:00"),
                                "custo_km": float(veh.get("custo_km", 0.65) or 0.65),
                                "custo_hora": float(veh.get("custo_hora", 12.50) or 12.50),
                                "max_entregas": int(veh.get("max_entregas", 30) or 30),
                                "regras": str(veh.get("regras", "") or ""),
                                "motorista_nome": str(veh.get("motorista_nome", veh.get("motorista", "")) or ""),
                                "motorista_telemovel": str(veh.get("motorista_telemovel", "") or ""),
                                "is_active": int(veh.get("is_active", 1) if veh.get("is_active", None) is not None else 1),
                                "segunda_volta": str(veh.get("segunda_volta", veh.get("2ª Volta", "Não")) or "Não"),
                                "regresso_armazem": str(veh.get("regresso_armazem", veh.get("Regresso_Armazem", veh.get("Regresso ao Armazem", "Sim"))) or "Sim")
                            })
                elif isinstance(raw_fleet, pd.DataFrame):
                    for _, veh in raw_fleet.iterrows():
                        v_name = str(veh.get("veiculo", veh.get("Veiculo", veh.get("Nome_Veiculo", ""))))
                        if v_name:
                            fleet_res.append({
                                "armazem": str(veh.get("armazem", veh.get("Armazem", veh.get("Nome_Armazem", ""))) or ""),
                                "veiculo": v_name,
                                "capacidade_kg": float(veh.get("capacidade_kg", veh.get("Capacidade_KG", 1000.0)) or 1000.0),
                                "capacidade_vol": float(veh.get("capacidade_volume", veh.get("capacidade_vol", veh.get("Capacidade_Vol", 10.0))) or 10.0),
                                "velocidade_media": float(veh.get("velocidade_media", veh.get("Velocidade_Media", 50.0)) or 50.0),
                                "horario_inicio": str(veh.get("horario_inicio", veh.get("Hora_Inicio_Turno", "08:00:00")) or "08:00:00"),
                                "horario_fim": str(veh.get("horario_fim", veh.get("Hora_Fim_Turno", "18:00:00")) or "18:00:00"),
                                "custo_km": float(veh.get("custo_km", veh.get("Custo_KM", 0.65)) or 0.65),
                                "custo_hora": float(veh.get("custo_hora", veh.get("Custo_Hora", 12.50)) or 12.50),
                                "max_entregas": int(veh.get("max_entregas", veh.get("Max_Entregas", 30)) or 30),
                                "regras": str(veh.get("regras", veh.get("Regras", "")) or ""),
                                "motorista_nome": str(veh.get("motorista_nome", veh.get("Motorista_Nome", veh.get("motorista", ""))) or ""),
                                "motorista_telemovel": str(veh.get("motorista_telemovel", veh.get("Motorista_Telemovel", "")) or ""),
                                "is_active": int(veh.get("is_active", 1) if veh.get("is_active", None) is not None else 1),
                                "segunda_volta": str(veh.get("segunda_volta", veh.get("2ª Volta", veh.get("2a Volta", "Não"))) or "Não"),
                                "regresso_armazem": str(veh.get("regresso_armazem", veh.get("Regresso_Armazem", veh.get("Regresso ao Armazem", "Sim"))) or "Sim")
                            })
                elif isinstance(raw_fleet, list):
                    for veh in raw_fleet:
                        if isinstance(veh, dict):
                            fleet_res.append({
                                "armazem": str(veh.get("armazem", "") or ""),
                                "veiculo": str(veh.get("veiculo", "")),
                                "capacidade_kg": float(veh.get("capacidade_kg", 1000.0) or 1000.0),
                                "capacidade_vol": float(veh.get("capacidade_vol", veh.get("capacidade_volume", 10.0)) or 10.0),
                                "velocidade_media": float(veh.get("velocidade_media", 50.0) or 50.0),
                                "horario_inicio": str(veh.get("horario_inicio", "08:00:00") or "08:00:00"),
                                "horario_fim": str(veh.get("horario_fim", "18:00:00") or "18:00:00"),
                                "custo_km": float(veh.get("custo_km", 0.65) or 0.65),
                                "custo_hora": float(veh.get("custo_hora", 12.50) or 12.50),
                                "max_entregas": int(veh.get("max_entregas", 30) or 30),
                                "regras": str(veh.get("regras", "") or ""),
                                "motorista_nome": str(veh.get("motorista_nome", veh.get("motorista", "")) or ""),
                                "motorista_telemovel": str(veh.get("motorista_telemovel", "") or ""),
                                "is_active": int(veh.get("is_active", 1) if veh.get("is_active", None) is not None else 1),
                                "segunda_volta": str(veh.get("segunda_volta", veh.get("2ª Volta", "Não")) or "Não"),
                                "regresso_armazem": str(veh.get("regresso_armazem", veh.get("Regresso_Armazem", veh.get("Regresso ao Armazem", "Sim"))) or "Sim")
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
                        "is_active": int(f["is_active"] if f.get("is_active") is not None else 1),
                        "segunda_volta": str(f["segunda_volta"]) if "segunda_volta" in f.keys() and f["segunda_volta"] else "Não",
                        "regresso_armazem": str(f["regresso_armazem"]) if "regresso_armazem" in f.keys() and f["regresso_armazem"] else "Sim"
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
                                "phone": str(d.get("phone", d.get("Telemóvel", d.get("Telemovel", d.get("telefone", ""))))),
                                "vehicle": str(d.get("vehicle", d.get("Viatura", ""))),
                                "matricula": str(d.get("matricula", d.get("Matrícula", d.get("Matricula", "")))),
                                "route": str(d.get("route", d.get("Rota Atribuída", d.get("Rota_Atribuida", d.get("Rota", ""))))),
                                "is_active": int(d.get("is_active", 1) if d.get("is_active") is not None else 1)
                            })
                elif isinstance(raw_drivers, pd.DataFrame):
                    for _, d in raw_drivers.iterrows():
                        drivers_res.append({
                            "name": str(d.get("Motorista", d.get("name", ""))),
                            "pin": str(d.get("PIN/Password", d.get("pin", "1234"))),
                            "phone": str(d.get("Telemóvel", d.get("Telemovel", d.get("phone", "")))),
                            "vehicle": str(d.get("Viatura", d.get("vehicle", ""))),
                            "matricula": str(d.get("Matrícula", d.get("Matricula", d.get("matricula", "")))),
                            "route": str(d.get("Rota Atribuída", d.get("Rota_Atribuida", d.get("route", "")))),
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
                                "code": str(r.get("code", r.get("codigo", ""))),
                                "reason": str(r.get("reason", r.get("Motivo de Não Entrega", r.get("motivo", "")))),
                                "category": str(r.get("category", r.get("Categoria / Ação", r.get("categoria", "Geral")))),
                                "action_required": str(r.get("action_required", r.get("Acao_Requerida", "Reagendar"))),
                                "is_active": int(r.get("is_active", 1) if r.get("is_active") is not None else 1)
                            })
                elif isinstance(raw_reasons, pd.DataFrame):
                    for _, r in raw_reasons.iterrows():
                        reasons_res.append({
                            "code": str(r.get("code", r.get("codigo", ""))),
                            "reason": str(r.get("Motivo de Não Entrega", r.get("reason", ""))),
                            "category": str(r.get("Categoria / Ação", r.get("category", "Geral"))),
                            "action_required": str(r.get("action_required", r.get("Acao_Requerida", "Reagendar"))),
                            "is_active": int(r.get("is_active", 1) if r.get("is_active") is not None else 1)
                        })

            # Extract RULES MATRIX
            raw_rules = state_dict.get("rules_matrix")
            rules_res = []
            if raw_rules is not None:
                if isinstance(raw_rules, list):
                    for r in raw_rules:
                        if isinstance(r, dict):
                            rules_res.append({
                                "tag_veiculo": str(r.get("tag_veiculo", r.get("Tag_Veiculo", ""))),
                                "tag_entrega": str(r.get("tag_entrega", r.get("Tag_Entrega", ""))),
                                "permissao": str(r.get("permissao", r.get("Permissao", "SIM"))).upper(),
                                "descricao": str(r.get("descricao", r.get("Descricao", ""))),
                                "is_active": int(r.get("is_active", 1) if r.get("is_active") is not None else 1)
                            })
                elif isinstance(raw_rules, pd.DataFrame):
                    for _, r in raw_rules.iterrows():
                        rules_res.append({
                            "tag_veiculo": str(r.get("Tag_Veiculo", r.get("tag_veiculo", ""))),
                            "tag_entrega": str(r.get("Tag_Entrega", r.get("tag_entrega", ""))),
                            "permissao": str(r.get("Permissao", r.get("permissao", "SIM"))).upper(),
                            "descricao": str(r.get("Descricao", r.get("descricao", ""))),
                            "is_active": int(r.get("is_active", 1) if r.get("is_active") is not None else 1)
                        })

            return {
                "fleet": fleet_res, 
                "warehouses": warehouses_res,
                "rules_matrix": rules_res,
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
            lat_w = _clean_coord(wh.lat)
            lon_w = _clean_coord(wh.lon)
            cp_w = str(wh.cp or "").strip()
            if cp_w.endswith(".0"):
                cp_w = cp_w[:-2]
            wh_rows.append({
                "Nome_Armazem": wh.name,
                "Morada": wh.address,
                "CP": cp_w,
                "Codigo_Postal": cp_w,
                "Localidade": wh.locality or "",
                "Latitude": lat_w,
                "Longitude": lon_w,
                "Hora_Abertura": getattr(wh, "open_time", "06:00:00") or "06:00:00",
                "Hora_Fecho": getattr(wh, "close_time", "22:00:00") or "22:00:00",
                "Tempo_Carga_Min": getattr(wh, "load_time", 30) or 30,
                "Contacto_Responsavel": getattr(wh, "contact", "") or "",
                "Nivel_Qualidade": 1 if (lat_w != 0.0 and lon_w != 0.0) else int(wh.quality or 99),
                "is_active": int(getattr(wh, "is_active", 1) if getattr(wh, "is_active", None) is not None else 1)
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
                "armazem": str(veh.armazem or ""),
                "veiculo": veh.veiculo,
                "capacidade_kg": float(veh.capacidade_kg or 1000.0),
                "capacidade_vol": float(veh.capacidade_vol or 10.0),
                "velocidade_media": float(veh.velocidade_media or 50.0),
                "horario_inicio": str(veh.horario_inicio or "08:00:00"),
                "horario_fim": str(veh.horario_fim or "18:00:00"),
                "custo_km": float(veh.custo_km or 0.65),
                "custo_hora": float(veh.custo_hora or 12.50),
                "max_entregas": int(veh.max_entregas or 30),
                "regras": str(veh.regras or ""),
                "motorista_nome": str(veh.motorista_nome or ""),
                "motorista_telemovel": str(veh.motorista_telemovel or ""),
                "is_active": int(veh.is_active if veh.is_active is not None else 1),
                "segunda_volta": str(veh.segunda_volta or "Não"),
                "regresso_armazem": str(veh.regresso_armazem or "Sim")
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
                "regras": str(veh.regras or ""),
                "is_active": int(veh.is_active if veh.is_active is not None else 1),
                "segunda_volta": str(veh.segunda_volta or "Não"),
                "regresso_armazem": str(veh.regresso_armazem or "Sim")
            })

        state_dict["fleet_config"] = fleet_dict
        state_dict["phase_2_complete"] = True

        # Save Rules Matrix
        rules_list = []
        for r in req.rules_matrix:
            vtag = str(r.tag_veiculo or "").strip()
            etag = str(r.tag_entrega or "").strip()
            if not vtag and not etag:
                continue
            rules_list.append({
                "tag_veiculo": vtag,
                "tag_entrega": etag,
                "permissao": str(r.permissao or "SIM").strip().upper(),
                "descricao": str(r.descricao or "").strip(),
                "is_active": int(getattr(r, "is_active", 1) if getattr(r, "is_active", None) is not None else 1)
            })
        state_dict["rules_matrix"] = rules_list

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
                "matricula": str(d.matricula or "").strip(),
                "route": str(d.route or "").strip(),
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
                "code": str(getattr(r, "code", "") or "").strip(),
                "reason": str(r.reason).strip(),
                "category": str(r.category or "Geral").strip(),
                "action_required": str(getattr(r, "action_required", "Reagendar") or "Reagendar").strip(),
                "is_active": int(getattr(r, "is_active", 1) if getattr(r, "is_active", None) is not None else 1)
            })
        state_dict["reasons"] = reasons_list
        state_dict["failure_reasons"] = reasons_list

        # Save Clients if provided
        if req.clients:
            with get_db() as conn:
                cursor = conn.cursor()
                for c in req.clients:
                    c_id = c.get("id")
                    if c_id:
                        cursor.execute("""
                            UPDATE entregas SET
                                codigo_cliente = COALESCE(?, codigo_cliente),
                                nome_cliente = COALESCE(?, nome_cliente),
                                morada = COALESCE(?, morada),
                                codigo_postal = COALESCE(?, codigo_postal),
                                _concelho = COALESCE(?, _concelho),
                                peso_kg = COALESCE(?, peso_kg),
                                volume_m3 = COALESCE(?, volume_m3),
                                janela_inicio = COALESCE(?, janela_inicio),
                                janela_fim = COALESCE(?, janela_fim),
                                tempo_descarga_min = COALESCE(?, tempo_descarga_min),
                                regras = COALESCE(?, regras),
                                vendedor = COALESCE(?, vendedor),
                                telefone = COALESCE(?, telefone),
                                valor_cobrar = COALESCE(?, valor_cobrar),
                                armazem = COALESCE(?, armazem),
                                is_active = COALESCE(?, is_active)
                            WHERE id = ? AND projeto_id = ?
                        """, (
                            c.get("codigo_cliente"),
                            c.get("nome_cliente"),
                            c.get("morada"),
                            c.get("codigo_postal"),
                            c.get("concelho"),
                            c.get("peso_kg"),
                            c.get("volume_m3"),
                            c.get("janela_inicio"),
                            c.get("janela_fim"),
                            c.get("tempo_descarga_min"),
                            c.get("regras"),
                            c.get("vendedor"),
                            c.get("telefone"),
                            c.get("valor_cobrar"),
                            c.get("armazem"),
                            c.get("is_active"),
                            c_id,
                            project_id
                        ))
                conn.commit()

            raw_clients = state_dict.get("clients_geocoded")
            if raw_clients is not None:
                df_c = raw_clients if isinstance(raw_clients, pd.DataFrame) else pd.DataFrame(raw_clients)
                if not df_c.empty:
                    for c in req.clients:
                        cid = c.get("id")
                        if not cid: continue
                        idx_match = []
                        if "id" in df_c.columns:
                            idx_match = df_c[df_c["id"] == cid].index
                        if len(idx_match) == 0 and "ID_Original" in df_c.columns:
                            idx_match = df_c[df_c["ID_Original"] == cid].index
                        if len(idx_match) > 0:
                            if "regras" in c:
                                if "Regras" in df_c.columns: df_c.loc[idx_match, "Regras"] = c["regras"]
                                if "regras" in df_c.columns: df_c.loc[idx_match, "regras"] = c["regras"]
                            if "peso_kg" in c:
                                if "Peso_KG" in df_c.columns: df_c.loc[idx_match, "Peso_KG"] = c["peso_kg"]
                            if "volume_m3" in c:
                                if "Volume_m3" in df_c.columns: df_c.loc[idx_match, "Volume_m3"] = c["volume_m3"]
                            if "armazem" in c:
                                if "Armazem" in df_c.columns: df_c.loc[idx_match, "Armazem"] = c["armazem"]
                            if "vendedor" in c:
                                if "Vendedor" in df_c.columns: df_c.loc[idx_match, "Vendedor"] = c["vendedor"]
                    state_dict["clients_geocoded"] = df_c

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
        
        # =========================================================================
        # PRÉ-VALIDAÇÃO AUDITORIA CANÓNICA DAS 9 ABAS (TUDO-OU-NADA)
        # =========================================================================
        audit_grid = []
        has_critical_error = False

        # Helper para encontrar folhas
        def _find_sheet(keywords):
            for s in xls.sheet_names:
                sn = _norm_col(s)
                if any(k in sn for k in keywords):
                    return s
            return None

        # 1. Auditoria Armazéns
        s_wh_name = _find_sheet(['armaz', 'warehouse', 'depot', 'origem'])
        wh_errs = []
        df_wh_audit = pd.DataFrame()
        if not s_wh_name:
            wh_errs.append("Aba 'Armazéns' em falta no ficheiro.")
        else:
            df_wh_audit = pd.read_excel(xls, sheet_name=s_wh_name)
            c_name = _match_col(df_wh_audit.columns, ['Nome_Armazem', 'Nome_Armazém', 'Armazem', 'Armazém', 'Warehouse', 'Nome'])
            c_addr = _match_col(df_wh_audit.columns, ['Morada', 'Endereço', 'Address', 'Rua', 'Morada_Armazem'])
            c_cp = _match_col(df_wh_audit.columns, ['CP', 'Código Postal', 'Codigo_Postal', 'Postal Code', 'Postal_Code', 'CodPostal'])
            if not c_name or not c_addr:
                wh_errs.append("Colunas obrigatórias em falta (Nome_Armazem ou Morada).")
            else:
                for idx, r in df_wh_audit.iterrows():
                    row_num = idx + 2
                    if pd.isna(r.get(c_name)) or str(r.get(c_name)).strip() == "":
                        wh_errs.append(f"Linha {row_num}: 'Nome_Armazem' não pode estar vazio.")
                    if pd.isna(r.get(c_addr)) or str(r.get(c_addr)).strip() == "":
                        wh_errs.append(f"Linha {row_num}: 'Morada' não pode estar vazia.")
                    if c_cp and (pd.isna(r.get(c_cp)) or str(r.get(c_cp)).strip() == ""):
                        wh_errs.append(f"Linha {row_num}: 'CP' não pode estar vazio.")
        
        audit_grid.append({
            "sheet": "Armazéns",
            "required": True,
            "total_rows": len(df_wh_audit),
            "valid_rows": len(df_wh_audit) if not wh_errs else max(0, len(df_wh_audit) - len(wh_errs)),
            "status": "ERRO" if wh_errs else "OK",
            "errors": wh_errs[:5]
        })
        if wh_errs: has_critical_error = True

        # 2. Auditoria Frota
        s_fleet_name = _find_sheet(['frota', 'veicul', 'viatur', 'fleet', 'vehicle', 'carro'])
        fleet_errs = []
        df_fl_audit = pd.DataFrame()
        if not s_fleet_name:
            fleet_errs.append("Aba 'Frota' em falta no ficheiro.")
        else:
            df_fl_audit = pd.read_excel(xls, sheet_name=s_fleet_name)
            c_v = _match_col(df_fl_audit.columns, ['Veiculo', 'Veículo', 'Vehicle', 'Nome', 'Matricula', 'Viatura'])
            c_cap = _match_col(df_fl_audit.columns, ['Capacidade_KG', 'Capacidade_kg', 'Capacidade (kg)', 'Capacity_KG', 'Peso_Max', 'Capacidade'])
            c_ini = _match_col(df_fl_audit.columns, ['Hora_Inicio_Turno', 'Horario_Inicio', 'Hora Início', 'Start_Time', 'Inicio'])
            c_fim = _match_col(df_fl_audit.columns, ['Hora_Fim_Turno', 'Horario_Fim', 'Hora Fim', 'End_Time', 'Fim'])
            if not c_v or not c_cap:
                fleet_errs.append("Colunas obrigatórias em falta (Veiculo ou Capacidade_KG).")
            else:
                for idx, r in df_fl_audit.iterrows():
                    row_num = idx + 2
                    if pd.isna(r.get(c_v)) or str(r.get(c_v)).strip() == "":
                        fleet_errs.append(f"Linha {row_num}: 'Veiculo' não pode estar vazio.")
                    if pd.isna(r.get(c_cap)):
                        fleet_errs.append(f"Linha {row_num}: 'Capacidade_KG' não pode estar vazia.")
                    if c_ini and (pd.isna(r.get(c_ini)) or str(r.get(c_ini)).strip() == ""):
                        fleet_errs.append(f"Linha {row_num}: 'Hora_Inicio_Turno' vazia.")
                    if c_fim and (pd.isna(r.get(c_fim)) or str(r.get(c_fim)).strip() == ""):
                        fleet_errs.append(f"Linha {row_num}: 'Hora_Fim_Turno' vazia.")

        audit_grid.append({
            "sheet": "Frota",
            "required": True,
            "total_rows": len(df_fl_audit),
            "valid_rows": len(df_fl_audit) if not fleet_errs else max(0, len(df_fl_audit) - len(fleet_errs)),
            "status": "ERRO" if fleet_errs else "OK",
            "errors": fleet_errs[:5]
        })
        if fleet_errs: has_critical_error = True

        # 3. Auditoria Entregas
        s_del_name = _find_sheet(['entreg', 'client', 'order', 'delivery', 'encomend'])
        del_errs = []
        df_del_audit = pd.DataFrame()
        if not s_del_name:
            del_errs.append("Aba 'Entregas' em falta no ficheiro.")
        else:
            df_del_audit = pd.read_excel(xls, sheet_name=s_del_name)
            c_mor = _match_col(df_del_audit.columns, ['Morada', 'Endereço', 'Address', 'Rua', 'Morada_Entrega'])
            c_dcp = _match_col(df_del_audit.columns, ['CP', 'Codigo_Postal', 'Código Postal', 'Postal_Code', 'Cod_Postal', 'Postal Code', 'CodPostal'])
            if not c_mor or not c_dcp:
                del_errs.append("Colunas obrigatórias em falta (Morada ou CP).")
            else:
                for idx, r in df_del_audit.iterrows():
                    row_num = idx + 2
                    if pd.isna(r.get(c_mor)) or str(r.get(c_mor)).strip() == "":
                        del_errs.append(f"Linha {row_num}: 'Morada' não pode estar vazia.")
                    if pd.isna(r.get(c_dcp)) or str(r.get(c_dcp)).strip() == "":
                        del_errs.append(f"Linha {row_num}: 'CP' não pode estar vazio.")

        audit_grid.append({
            "sheet": "Entregas",
            "required": True,
            "total_rows": len(df_del_audit),
            "valid_rows": len(df_del_audit) if not del_errs else max(0, len(df_del_audit) - len(del_errs)),
            "status": "ERRO" if del_errs else "OK",
            "errors": del_errs[:5]
        })
        if del_errs: has_critical_error = True

        # 4. Auditoria Regras
        s_rules_name = _find_sheet(['regr', 'rule', 'restri', 'matriz'])
        df_rules_audit = pd.DataFrame()
        rules_errs = []
        if s_rules_name:
            df_rules_audit = pd.read_excel(xls, sheet_name=s_rules_name)
            c_rtag = _match_col(df_rules_audit.columns, ['Tag_Veiculo', 'Tag_Viatura', 'Veiculo_Tag', 'Tag Veiculo'])
            c_perm = _match_col(df_rules_audit.columns, ['Permissao', 'Permitido', 'Status', 'Regra'])
            c_etag = _match_col(df_rules_audit.columns, ['Tag_Entrega', 'Tag_Cliente', 'Entrega_Tag', 'Tag Entrega'])
            for idx, r in df_rules_audit.iterrows():
                row_num = idx + 2
                vt = str(r.get(c_rtag)).strip() if c_rtag and pd.notna(r.get(c_rtag)) else ""
                et = str(r.get(c_etag)).strip() if c_etag and pd.notna(r.get(c_etag)) else ""
                if vt and not et and not c_perm:
                    rules_errs.append(f"Linha {row_num}: Regra sem tag de entrega ou permissão definida.")
        audit_grid.append({
            "sheet": "Regras",
            "required": False,
            "total_rows": len(df_rules_audit),
            "valid_rows": len(df_rules_audit) if not rules_errs else max(0, len(df_rules_audit) - len(rules_errs)),
            "status": "ERRO" if rules_errs else "OK",
            "errors": rules_errs[:5]
        })
        if rules_errs: has_critical_error = True

        # 5. Auditoria Rotas
        s_rotas_name = _find_sheet(['rotas', 'rota', 'routes', 'route', 'planeamento', 'plano', 'planorotas'])
        df_rotas_audit = pd.DataFrame()
        if s_rotas_name and 'frota' not in _norm_col(s_rotas_name):
            df_rotas_audit = pd.read_excel(xls, sheet_name=s_rotas_name)
        audit_grid.append({
            "sheet": "Rotas",
            "required": False,
            "total_rows": len(df_rotas_audit),
            "valid_rows": len(df_rotas_audit),
            "status": "OK",
            "errors": []
        })

        # 6. Auditoria Manifestos
        s_manif_name = _find_sheet(['manif', 'resumo'])
        df_manif_audit = pd.DataFrame()
        if s_manif_name:
            df_manif_audit = pd.read_excel(xls, sheet_name=s_manif_name)
        audit_grid.append({
            "sheet": "Manifestos",
            "required": False,
            "total_rows": len(df_manif_audit),
            "valid_rows": len(df_manif_audit),
            "status": "OK",
            "errors": []
        })

        # 7. Auditoria Motoristas e Carros
        s_dr_name = _find_sheet(['motorista', 'driver', 'condutor', 'equipa'])
        df_dr_audit = pd.DataFrame()
        dr_errs = []
        if s_dr_name:
            df_dr_audit = pd.read_excel(xls, sheet_name=s_dr_name)
            c_dn = _match_col(df_dr_audit.columns, ['Motorista', 'Nome', 'Nome_Motorista', 'Driver', 'Driver_Name'])
            c_dp = _match_col(df_dr_audit.columns, ['PIN/Password', 'PIN', 'Password', 'Pin', 'Senha', 'Codigo', 'Pin_Code'])
            for idx, r in df_dr_audit.iterrows():
                row_num = idx + 2
                dn_val = str(r.get(c_dn)).strip() if c_dn and pd.notna(r.get(c_dn)) else ""
                dp_val = str(r.get(c_dp)).strip() if c_dp and pd.notna(r.get(c_dp)) else ""
                if dn_val and dn_val.lower() != 'nan':
                    if not dp_val or dp_val.lower() == 'nan':
                        dr_errs.append(f"Linha {row_num}: Motorista '{dn_val}' não tem PIN/Password definido.")
        audit_grid.append({
            "sheet": "Motoristas e Carros",
            "required": False,
            "total_rows": len(df_dr_audit),
            "valid_rows": len(df_dr_audit) if not dr_errs else max(0, len(df_dr_audit) - len(dr_errs)),
            "status": "ERRO" if dr_errs else "OK",
            "errors": dr_errs[:5]
        })
        if dr_errs: has_critical_error = True

        # 8. Auditoria Justificação entregas
        s_reasons_name = _find_sheet(['justifica', 'motivo', 'reason', 'falha', 'nao entrega', 'recusa'])
        df_reasons_audit = pd.DataFrame()
        if s_reasons_name:
            df_reasons_audit = pd.read_excel(xls, sheet_name=s_reasons_name)
        audit_grid.append({
            "sheet": "Justificação entregas",
            "required": False,
            "total_rows": len(df_reasons_audit),
            "valid_rows": len(df_reasons_audit),
            "status": "OK",
            "errors": []
        })

        # 9. Auditoria Instruções
        s_inst_name = _find_sheet(['instru', 'ajuda', 'help', 'guia'])
        df_inst_audit = pd.DataFrame()
        if s_inst_name:
            df_inst_audit = pd.read_excel(xls, sheet_name=s_inst_name)
        audit_grid.append({
            "sheet": "Instruções",
            "required": False,
            "total_rows": len(df_inst_audit),
            "valid_rows": len(df_inst_audit),
            "status": "OK",
            "errors": []
        })

        # SE EXISTIR ERRO CRÍTICO: TUDO-OU-NADA! Interromper sem tocar na base de dados!
        if has_critical_error:
            return {
                "status": "audit_failed",
                "message": "Auditoria de Importação rejeitou o ficheiro devido a erros de validação.",
                "audit_grid": audit_grid
            }

        # 1. Sheet: Armazéns
        sheet_wh = s_wh_name
        wh_rows = []
        if sheet_wh:
            df_wh_raw = df_wh_audit
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
                            lat_val = _clean_coord(row[col_wh_lat])
                            lon_val = _clean_coord(row[col_wh_lon])
                        if cp and str(cp).endswith(".0"):
                            cp = str(cp)[:-2]
                                
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
            if any(k in sn for k in ['frota', 'veicul', 'viatur', 'fleet', 'vehicle', 'carro']):
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
                col_f_2v = _match_col(df_fleet_raw.columns, ['2ª Volta', '2a Volta', '2ª_Volta', '2a_Volta', '2 Volta', 'Segunda_Volta', 'Segunda Volta'])
                col_f_regresso = _match_col(df_fleet_raw.columns, ['Regresso_Armazem', 'Regresso_Armazém', 'Regresso ao Armazem', 'Regresso ao Armazém', 'Retorno_Armazem', 'Retorno ao Deposito', 'Regresso', 'Retorno'])
                col_f_driver = _match_col(df_fleet_raw.columns, ['Motorista_Nome', 'Motorista', 'Driver_Name', 'Driver'])
                col_f_driver_tel = _match_col(df_fleet_raw.columns, ['Motorista_Telemovel', 'Telemovel_Motorista', 'Driver_Phone', 'Contacto_Motorista'])
                
                for idx, row in df_fleet_raw.iterrows():
                    v_name = str(row[col_f_veh]).strip() if col_f_veh and pd.notna(row[col_f_veh]) else ""
                    if not v_name or v_name == 'nan':
                        v_name = f"Viatura {idx + 1}"
                    
                    wh_name = str(row[col_f_wh]).strip() if col_f_wh and pd.notna(row[col_f_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Central")
                    cap_kg = _clean_coord(row[col_f_cap_kg]) if col_f_cap_kg and pd.notna(row[col_f_cap_kg]) else 1000.0
                    cap_vol = _clean_coord(row[col_f_cap_vol]) if col_f_cap_vol and pd.notna(row[col_f_cap_vol]) else 10.0
                    speed = _clean_coord(row[col_f_speed]) if col_f_speed and pd.notna(row[col_f_speed]) else 50.0
                    start_t = str(row[col_f_start]).strip() if col_f_start and pd.notna(row[col_f_start]) else "08:00:00"
                    end_t = str(row[col_f_end]).strip() if col_f_end and pd.notna(row[col_f_end]) else "18:00:00"
                    cost_km = _clean_coord(row[col_f_cost_km]) if col_f_cost_km and pd.notna(row[col_f_cost_km]) else 0.65
                    cost_hr = _clean_coord(row[col_f_cost_hr]) if col_f_cost_hr and pd.notna(row[col_f_cost_hr]) else 12.50
                    max_deliv = int(_clean_coord(row[col_f_max_deliv])) if col_f_max_deliv and pd.notna(row[col_f_max_deliv]) else 30
                    regras_str = str(row[col_f_rules]).strip() if col_f_rules and pd.notna(row[col_f_rules]) else ""
                    val_2v = str(row[col_f_2v]).strip().lower() if col_f_2v and pd.notna(row[col_f_2v]) else "não"
                    is_2v = "Sim" if val_2v in ['sim', 's', 'yes', 'y', 'true', '1', '2'] else "Não"
                    val_regresso = str(row[col_f_regresso]).strip().lower() if col_f_regresso and pd.notna(row[col_f_regresso]) else "sim"
                    is_regresso = "Não" if val_regresso in ['não', 'nao', 'n', 'no', 'false', '0'] else "Sim"
                    
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
                    v_obj.segunda_volta = is_2v
                    v_obj.regresso_armazem = is_regresso
                    if col_f_driver and pd.notna(row[col_f_driver]):
                        v_obj.motorista_nome = str(row[col_f_driver]).strip()
                    if col_f_driver_tel and pd.notna(row[col_f_driver_tel]):
                        v_obj.motorista_telemovel = str(row[col_f_driver_tel]).strip()
                    
                    fleet_dict[v_name] = v_obj

        # 3. Sheet: Regras
        sheet_rules = None
        for s in xls.sheet_names:
            sn = _norm_col(s)
            if any(k in sn for k in ['regr', 'rule', 'restri', 'matriz']):
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
            if any(k in sn for k in ['entreg', 'client', 'order', 'delivery', 'encomend']):
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
                    weight = _clean_coord(row[col_e_weight]) if col_e_weight and pd.notna(row[col_e_weight]) else 0.0
                    volume = _clean_coord(row[col_e_volume]) if col_e_volume and pd.notna(row[col_e_volume]) else 0.0
                    j1_s = str(row[col_e_j1_start]).strip() if col_e_j1_start and pd.notna(row[col_e_j1_start]) else "08:00"
                    j1_e = str(row[col_e_j1_end]).strip() if col_e_j1_end and pd.notna(row[col_e_j1_end]) else "18:00"
                    unload_t = int(_clean_coord(row[col_e_unload])) if col_e_unload and pd.notna(row[col_e_unload]) else 15
                    op_type = str(row[col_e_op_type]).strip() if col_e_op_type and pd.notna(row[col_e_op_type]) else "ENTREGA"
                    e_rules = str(row[col_e_rules]).strip() if col_e_rules and pd.notna(row[col_e_rules]) else ""
                    obs = str(row[col_e_obs]).strip() if col_e_obs and pd.notna(row[col_e_obs]) else ""
                    prio_str = str(row[col_e_prio]).strip() if col_e_prio and pd.notna(row[col_e_prio]) else "Normal"
                    wh_val = str(row[col_e_wh]).strip() if col_e_wh and pd.notna(row[col_e_wh]) else (wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Central")
                    
                    lat, lon = 0.0, 0.0
                    if col_e_lat and col_e_lon and pd.notna(row[col_e_lat]) and pd.notna(row[col_e_lon]):
                        lat = _clean_coord(row[col_e_lat])
                        lon = _clean_coord(row[col_e_lon])
                            
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
            if (sn in ['rotas', 'rota', 'routes', 'route', 'planeamento', 'plano', 'planorotas'] or ('rota' in sn and 'frota' not in sn)):
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
                    
                    p_kg = _clean_coord(r_row[col_rt_cg_kg]) if col_rt_cg_kg and pd.notna(r_row[col_rt_cg_kg]) else 50.0
                    v_m3 = _clean_coord(r_row[col_rt_cg_vol]) if col_rt_cg_vol and pd.notna(r_row[col_rt_cg_vol]) else 0.1
                    
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
                        c_lat = _clean_coord(r_row[col_rt_lat])
                        c_lon = _clean_coord(r_row[col_rt_lon])
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
                        "Distancia_KM": _clean_coord(r_row[col_rt_dist]) if col_rt_dist and pd.notna(r_row[col_rt_dist]) else 0.0,
                        "Distancia_Acumulada_KM": _clean_coord(r_row[col_rt_cum_dist]) if col_rt_cum_dist and pd.notna(r_row[col_rt_cum_dist]) else 0.0,
                        "Tempo_Viagem_Min": _clean_coord(r_row[col_rt_t_viag]) if col_rt_t_viag and pd.notna(r_row[col_rt_t_viag]) else 0.0,
                        "Tempo_Espera_Min": _clean_coord(r_row[col_rt_t_esp]) if col_rt_t_esp and pd.notna(r_row[col_rt_t_esp]) else 0.0,
                        "Carga_Restante_KG": _clean_coord(r_row[col_rt_cg_kg]) if col_rt_cg_kg and pd.notna(r_row[col_rt_cg_kg]) else p_kg,
                        "Carga_Restante_Vol": _clean_coord(r_row[col_rt_cg_vol]) if col_rt_cg_vol and pd.notna(r_row[col_rt_cg_vol]) else v_m3,
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
                    "Latitude": _clean_coord(d.get("Latitude", 0.0)),
                    "Longitude": _clean_coord(d.get("Longitude", 0.0)),
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
                    "Carga_Restante_KG": _clean_coord(d.get("Peso_KG", 0.0)),
                    "Carga_Restante_Vol": _clean_coord(d.get("Volume_M3", 0.0)),
                    "Status": "Pendente",
                    "Notas_Motorista": d.get("Notas_Motorista", d.get("Observacoes", "")),
                    "notas_motorista": d.get("Notas_Motorista", d.get("Observacoes", "")),
                    "Observacoes": d.get("Observacoes", d.get("Notas_Motorista", "")),
                    "observacoes": d.get("Observacoes", d.get("Notas_Motorista", "")),
                    "Vendedor": d.get("Vendedor", d.get("vendedor", "")),
                    "vendedor": d.get("Vendedor", d.get("vendedor", "")),
                    "Peso_KG": _clean_coord(d.get("Peso_KG", 0.0)),
                    "Volume_m3": _clean_coord(d.get("Volume_M3", 0.0))
                })

        # 6. Sheet: Motoristas e Carros
        sheet_drivers = s_dr_name
        drivers_list = []
        if sheet_drivers and not df_dr_audit.empty:
            df_drivers_raw = df_dr_audit
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

        # 7. Sheet: Justificação entregas
        sheet_reasons = s_reasons_name
        reasons_list = []
        if sheet_reasons and not df_reasons_audit.empty:
            df_reasons_raw = df_reasons_audit
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

        # Prepara snapshot do estado
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

        # =========================================================================
        # 8. PERSISTÊNCIA ATÓMICA TOTAL (TUDO-OU-NADA EM SQLite)
        # =========================================================================
        ensure_entregas_columns()
        with get_db() as conn:
            cursor = conn.cursor()

            # A. Gravar entregas na BD
            if deliveries_list:
                cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (project_id,))
                for d in deliveries_list:
                    lat_d = _clean_coord(d.get("Latitude", 0.0))
                    lon_d = _clean_coord(d.get("Longitude", 0.0))
                    qual_d = 1 if (lat_d != 0 and lon_d != 0) else 99
                    src_d = "FICHEIRO" if qual_d == 1 else "PENDENTE"

                    w_s_str = str(d.get("Janela_Inicio") or d.get("Janela1_Inicio") or d.get("Slot1_Inicio") or d.get("janela_inicio") or "").strip()
                    w_e_str = str(d.get("Janela_Fim") or d.get("Janela1_Fim") or d.get("Slot1_Fim") or d.get("janela_fim") or "").strip()
                    if not w_s_str or not w_e_str:
                        win_h = str(d.get("Janela_Horaria") or d.get("janela_horaria") or d.get("Horario") or "").strip()
                        if win_h:
                            try:
                                from utils.optimization_solver import parse_time_window_str, minutes_to_time_str
                                ws_m, we_m = parse_time_window_str(win_h)
                                if ws_m > 0 or we_m < 1440:
                                    if not w_s_str:
                                        w_s_str = minutes_to_time_str(ws_m)
                                    if not w_e_str:
                                        w_e_str = minutes_to_time_str(we_m)
                            except Exception:
                                pass
                    if not w_s_str:
                        w_s_str = "08:00"
                    if not w_e_str:
                        w_e_str = "18:00"

                    cursor.execute("""
                        INSERT INTO entregas (
                            projeto_id, codigo_cliente, nome_cliente, morada, codigo_postal, _concelho,
                            peso_kg, volume_m3, prioridade, janela_inicio, janela_fim,
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem,
                            telefone, observacoes, vendedor, rota, ordem_paragem, regras
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, d.get("Doc_ID", ""), d.get("Cliente", ""), d.get("Morada", ""),
                        d.get("CP", ""), d.get("Localidade", ""), _clean_coord(d.get("Peso_KG", 0.0)),
                        _clean_coord(d.get("Volume_M3", 0.0)), 2, w_s_str,
                        w_e_str, lat_d, lon_d, qual_d, src_d,
                        d.get("Morada", ""), d.get("Armazem", "Armazém Principal"),
                        d.get("Telefone_Cliente", d.get("Telefone", "")),
                        d.get("Notas_Motorista", d.get("Observacoes", "")),
                        d.get("Vendedor", d.get("vendedor", "")),
                        d.get("Rota", "Por Distribuir"),
                        int(_clean_coord(d.get("Ordem", 1)) or 1),
                        str(d.get("Regras", d.get("regras", "")) or "")
                    ))

            # B. Gravar frota na BD
            if fleet_dict:
                cursor.execute("DELETE FROM frota WHERE projeto_id = ?", (project_id,))
                for v_name, v_data in fleet_dict.items():
                    cursor.execute("""
                        INSERT INTO frota (
                            projeto_id, veiculo, capacidade_kg, capacidade_volume, custo_km,
                            velocidade_media, horario_inicio, horario_fim, armazem, regras,
                            max_entregas, motorista_nome, motorista_telemovel, is_active,
                            codigo_veiculo, codigo_motorista, segunda_volta
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, v_name, float(v_data.capacidade_kg or 1000.0),
                        float(getattr(v_data, "capacidade_vol", 10.0) or 10.0), float(v_data.custo_km or 0.65),
                        float(v_data.velocidade_media or 50.0), str(v_data.horario_inicio or '08:00:00'), str(v_data.horario_fim or '18:00:00'),
                        str(getattr(v_data, "armazem", "") or ""), str(getattr(v_data, "regras", "") or ""),
                        int(getattr(v_data, "max_entregas", 30) or 30),
                        str(getattr(v_data, "motorista_nome", "") or ""),
                        str(getattr(v_data, "motorista_telemovel", "") or ""),
                        1, "", "", str(getattr(v_data, "segunda_volta", "Não") or "Não")
                    ))

            # C. Gravar snapshot completo
            cursor.execute("INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)", 
                           (project_id, current_user.id, fase_num, snapshot_name, payload))
            
            # Commit atómico único
            conn.commit()
            
        # Verificar armazéns sem coordenadas
        wh_needs_geo = [w["Nome_Armazem"] for w in wh_rows if float(w.get("Latitude", 0)) == 0]
        
        msg = f"Ficheiro validado e importado com sucesso ({len(wh_rows)} armazéns, {len(fleet_dict)} veículos, {len(deliveries_list)} entregas georreferenciadas, {len(drivers_list)} motoristas, {len(reasons_list)} motivos de não entrega, {len(routes_solution_list)} paragens atribuídas)."
        if wh_needs_geo:
            msg += f" ⚠️ Atenção: O armazém '{wh_needs_geo[0]}' precisa de confirmação da morada na aba Frota e Armazéns."
            
        return {
            "status": "success",
            "message": msg,
            "warehouses_missing_coords": wh_needs_geo,
            "num_warehouses": len(wh_rows),
            "num_vehicles": len(fleet_dict),
            "num_deliveries": len(deliveries_list),
            "num_routes": len(routes_solution_list),
            "audit_grid": audit_grid
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar ficheiro: {str(e)}")

@router.post("/import-mobiliario/{project_id}")
async def import_mobiliario_files(
    project_id: int,
    files: List[UploadFile] = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Importa ficheiros Mobiliário do sistema ERP da empresa (Stores, Fleet, Services)
    e popula diretamente as tabelas SQLite (entregas, frota) e o snapshot GeoRoutePlan.
    """
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

    if not files:
        raise HTTPException(status_code=400, detail="Nenhum ficheiro fornecido para importação.")

    try:
        from datetime import datetime
        from core.session_state import FleetVehicle
        from database import save_frota_projeto

        google_api_key = current_user.google_api_key if hasattr(current_user, 'google_api_key') else None
        if not google_api_key:
            from database import get_google_api_key
            google_api_key = get_google_api_key()

        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)
        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)

        def _decode_file(raw_bytes: bytes) -> str:
            for enc in ["utf-8-sig", "utf-8", "latin-1", "cp1252"]:
                try:
                    return raw_bytes.decode(enc)
                except Exception:
                    continue
            return raw_bytes.decode("utf-8", errors="ignore")

        def _parse_time_min(val_str: str) -> int:
            if not val_str:
                return 15
            s = str(val_str).strip()
            if ":" in s:
                parts = s.split(":")
                try:
                    h = int(parts[0])
                    m = int(parts[1])
                    return h * 60 + m
                except Exception:
                    pass
            try:
                return int(float(s))
            except Exception:
                return 15

        def _parse_flt(val_str, default=0.0) -> float:
            if val_str is None:
                return default
            s = str(val_str).strip().replace(",", ".")
            try:
                return float(s)
            except Exception:
                return default

        # Ler e categorizar os ficheiros
        file_stores_lines = []
        file_fleet_lines = []
        file_services_lines = []

        for f in files:
            content_bytes = await f.read()
            text = _decode_file(content_bytes)
            raw_lines = [l.strip("\r\n") for l in text.split("\n") if l.strip()]
            if not raw_lines:
                continue

            first_cols = raw_lines[0].split("\t")
            fn = f.filename.lower() if f.filename else ""
            num_cols = len(first_cols)

            if "store" in fn or "armaz" in fn or num_cols == 13 or (num_cols >= 10 and num_cols <= 15):
                file_stores_lines = raw_lines
            elif "fleet" in fn or "frota" in fn or num_cols == 41 or (num_cols >= 35 and num_cols <= 43):
                file_fleet_lines = raw_lines
            elif "service" in fn or "servi" in fn or "entrega" in fn or num_cols == 47 or num_cols >= 44:
                file_services_lines = raw_lines

        if not file_stores_lines and not file_fleet_lines and not file_services_lines:
            raise HTTPException(
                status_code=400,
                detail="Não foi possível identificar os ficheiros Mobiliário (Stores, Fleet ou Services). Verifique se enviou os ficheiros de texto tabulados correspondentes."
            )

        # 1. Processar Armazéns (Stores)
        wh_rows = []
        store_map = {}  # store_id -> wh_row
        for line in file_stores_lines:
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            w_name = parts[0].strip()
            w_id = parts[1].strip()
            w_addr = parts[2].strip() if len(parts) > 2 else ""
            w_cp = parts[4].strip() if len(parts) > 4 else ""
            w_loc = parts[5].strip() if len(parts) > 5 else ""
            w_lon = _parse_flt(parts[7]) if len(parts) > 7 else 0.0
            w_lat = _parse_flt(parts[8]) if len(parts) > 8 else 0.0
            w_load = _parse_time_min(parts[11]) if len(parts) > 11 else 30

            if (w_lat == 0.0 or w_lon == 0.0) and (w_addr or w_cp):
                try:
                    res_tuple = geocoder.resolve_address(w_addr, w_cp, w_loc, fast_mode=True)
                    res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    if res and res.get("lat") and res.get("lon"):
                        w_lat = float(res["lat"])
                        w_lon = float(res["lon"])
                except Exception:
                    pass

            wh_item = {
                "Nome_Armazem": w_name,
                "Nome": w_name,
                "Store_ID": w_id,
                "Morada": w_addr,
                "CP": w_cp,
                "Codigo_Postal": w_cp,
                "Localidade": w_loc,
                "Latitude": w_lat,
                "Longitude": w_lon,
                "Hora_Abertura": "06:00:00",
                "Hora_Fecho": "22:00:00",
                "Tempo_Carga_Min": w_load,
                "Contacto_Responsavel": ""
            }
            wh_rows.append(wh_item)
            if w_id:
                store_map[w_id] = wh_item

        # Fallback de Armazém se Stores não foi fornecido
        if not wh_rows:
            wh_rows.append({
                "Nome_Armazem": "Armazém Principal",
                "Nome": "Armazém Principal",
                "Store_ID": "19",
                "Morada": "Zona Industrial de Frielas",
                "CP": "2660-026",
                "Codigo_Postal": "2660-026",
                "Localidade": "Frielas",
                "Latitude": 38.818668,
                "Longitude": -9.148433,
                "Hora_Abertura": "06:00:00",
                "Hora_Fecho": "22:00:00",
                "Tempo_Carga_Min": 30,
                "Contacto_Responsavel": ""
            })
            store_map["19"] = wh_rows[0]

        # 2. Processar Frota (Fleet)
        fleet_dict = {}
        veh_code_to_name = {}
        veh_to_id = {}
        driver_to_id = {}
        drivers_list = []
        fleet_rows_for_db = []

        for line in file_fleet_lines:
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            v_id = parts[0].strip()
            v_name = parts[1].strip() or f"Viatura {v_id}"
            d_id = parts[2].strip() if len(parts) > 2 else ""
            d_name = parts[3].strip() if len(parts) > 3 else ""
            v_store_id = parts[4].strip() if len(parts) > 4 else ""
            v_rules = parts[6].strip() if len(parts) > 6 else ""
            v_kg = _parse_flt(parts[11], 1000.0) if len(parts) > 11 else 1000.0
            raw_vol = _parse_flt(parts[13], 10.0) if len(parts) > 13 else 10.0
            v_vol = round(raw_vol / 1000.0, 2) if raw_vol > 50 else raw_vol
            v_max = int(_parse_flt(parts[15], 30)) if len(parts) > 15 else 30
            v_start = parts[19].strip() if len(parts) > 19 and parts[19].strip() else "08:00"
            v_end = parts[20].strip() if len(parts) > 20 and parts[20].strip() else "20:00"
            v_max_trips = int(_parse_flt(parts[39], 1)) if len(parts) > 39 else 1
            v_segunda_volta = "Sim" if v_max_trips >= 2 else "Não"

            wh_name = store_map.get(v_store_id, {}).get("Nome_Armazem", wh_rows[0]["Nome_Armazem"])

            v_obj = FleetVehicle(
                capacidade_kg=v_kg,
                capacidade_vol=v_vol,
                custo_km=0.65,
                velocidade_media=50.0,
                horario_inicio=v_start,
                horario_fim=v_end,
                armazem=wh_name
            )
            v_obj.custo_hora = 12.50
            v_obj.max_entregas = v_max
            v_obj.regras = v_rules
            v_obj.motorista_nome = d_name
            v_obj.codigo_veiculo = v_id
            v_obj.codigo_motorista = d_id
            v_obj.segunda_volta = v_segunda_volta
            fleet_dict[v_name] = v_obj

            veh_code_to_name[v_id] = v_name
            veh_to_id[v_name] = v_id
            if d_name:
                driver_to_id[d_name] = d_id
                driver_to_id[v_name] = d_id

            fleet_rows_for_db.append({
                "veiculo": v_name,
                "capacidade_kg": v_kg,
                "capacidade_volume": v_vol,
                "custo_km": 0.65,
                "velocidade_media": 50.0,
                "horario_inicio": v_start,
                "horario_fim": v_end,
                "armazem": wh_name,
                "regras": v_rules,
                "max_entregas": v_max,
                "motorista_nome": d_name,
                "motorista_telemovel": "910000000",
                "codigo_veiculo": v_id,
                "codigo_motorista": d_id,
                "is_active": 1,
                "segunda_volta": v_segunda_volta
            })

            if d_name:
                drivers_list.append({
                    "name": d_name,
                    "pin": "1234",
                    "phone": "910000000",
                    "vehicle": v_name,
                    "matricula": "",
                    "route": v_name,
                    "is_active": 1
                })

        # 3. Processar Serviços / Entregas (Services)
        deliveries_list = []
        routes_solution_list = []
        detected_service_date = ""

        for s_idx, line in enumerate(file_services_lines):
            parts = line.split("\t")
            if len(parts) < 17:
                continue

            s_rules = parts[2].strip() if len(parts) > 2 else ""
            doc_id = parts[16].strip()
            if not doc_id:
                continue

            cli_name = parts[17].strip() if len(parts) > 17 else doc_id
            addr = parts[18].strip() if len(parts) > 18 else ""
            cp = parts[19].strip() if len(parts) > 19 else ""
            loc = parts[20].strip() if len(parts) > 20 else ""
            j1_start = parts[24].strip() if len(parts) > 24 and parts[24].strip() else "08:00"
            j1_end = parts[25].strip() if len(parts) > 25 and parts[25].strip() else "20:00"
            unload_min = _parse_time_min(parts[26]) if len(parts) > 26 else 15
            weight = _parse_flt(parts[30]) if len(parts) > 30 else 50.0
            raw_vol = _parse_flt(parts[31]) if len(parts) > 31 else 10.0
            volume = round(raw_vol / 1000.0, 3) if raw_vol > 10 else raw_vol

            v_code = parts[33].strip() if len(parts) > 33 else ""
            drv_code = parts[34].strip() if len(parts) > 34 else ""
            s_store_id = parts[35].strip() if len(parts) > 35 else ""
            stop_order = int(_parse_flt(parts[36], s_idx + 1)) if len(parts) > 36 else (s_idx + 1)
            raw_date = parts[41].strip() if len(parts) > 41 else ""
            if raw_date and not detected_service_date:
                detected_service_date = raw_date

            wh_name = store_map.get(s_store_id, {}).get("Nome_Armazem", wh_rows[0]["Nome_Armazem"])

            # Georreferenciação com cascata Low-Cost
            lat, lon = 0.0, 0.0
            if addr or cp:
                try:
                    res_tuple = geocoder.resolve_address(addr, cp, loc, fast_mode=True)
                    res_geo = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    if res_geo and res_geo.get("lat") and res_geo.get("lon"):
                        lat = float(res_geo["lat"])
                        lon = float(res_geo["lon"])
                except Exception:
                    pass

            qual = 1 if (lat != 0.0 and lon != 0.0) else 99
            src = "OSM/LOCAL" if qual == 1 else "PENDENTE"

            # Nome da viatura associada
            assigned_veh_name = "Por Distribuir"
            if v_code:
                if v_code in veh_code_to_name:
                    assigned_veh_name = veh_code_to_name[v_code]
                elif v_code in fleet_dict:
                    assigned_veh_name = v_code
                else:
                    assigned_veh_name = f"Viatura {v_code}"
                    veh_code_to_name[v_code] = assigned_veh_name
                    veh_to_id[assigned_veh_name] = v_code
                    if drv_code:
                        driver_to_id[assigned_veh_name] = drv_code

            d_entry = {
                "Armazem": wh_name,
                "Doc_ID": doc_id,
                "Codigo_Cliente": doc_id,
                "Cliente": cli_name,
                "Nome_Cliente": cli_name,
                "Morada": addr,
                "CP": cp,
                "Codigo_Postal": cp,
                "Localidade": loc,
                "Latitude": lat,
                "Longitude": lon,
                "Telefone_Cliente": "",
                "Telefone": "",
                "Peso_KG": weight,
                "Peso": weight,
                "Volume_M3": volume,
                "Volume_m3": volume,
                "Janela_Inicio": j1_start,
                "Janela_Fim": j1_end,
                "Janela_Horaria": f"{j1_start} - {j1_end}",
                "Tempo_Descarga_Min": unload_min,
                "Tipo_Operacao": "ENTREGA",
                "Regras": s_rules,
                "Notas_Motorista": "",
                "Observacoes": "",
                "Prioridade": "Normal",
                "Vendedor": "",
                "Rota": assigned_veh_name,
                "Ordem": stop_order,
                "Ordem_Paragem": stop_order
            }
            deliveries_list.append(d_entry)

            if assigned_veh_name != "Por Distribuir":
                routes_solution_list.append({
                    "id": len(routes_solution_list) + 1,
                    "ID_Original": doc_id,
                    "Doc_ID": doc_id,
                    "Codigo_Cliente": doc_id,
                    "Cliente": cli_name,
                    "Nome_Cliente": cli_name,
                    "Morada": addr,
                    "CP": cp,
                    "Localidade": loc,
                    "Telefone_Cliente": "",
                    "Telefone": "",
                    "Latitude": lat,
                    "Longitude": lon,
                    "Rota": assigned_veh_name,
                    "Veiculo": assigned_veh_name,
                    "Armazem": wh_name,
                    "Ordem": stop_order,
                    "Ordem_Paragem": stop_order,
                    "Janela_Horaria": f"{j1_start} - {j1_end}",
                    "Hora_Chegada_Prevista": "",
                    "Hora_Saida_Prevista": "",
                    "Distancia_KM": 0.0,
                    "Distancia_Acumulada_KM": 0.0,
                    "Tempo_Viagem_Min": 0.0,
                    "Tempo_Espera_Min": 0.0,
                    "Carga_Restante_KG": weight,
                    "Carga_Restante_Vol": volume,
                    "Status": "Planeado",
                    "Notas_Motorista": "",
                    "Observacoes": "",
                    "Vendedor": "",
                    "Peso_KG": weight,
                    "Volume_m3": volume
                })

        # 4. Guardar Entregas na tabela SQLite entregas
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
                            peso_kg, volume_m3, prioridade, janela_inicio, janela_fim, tempo_descarga_min,
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem,
                            telefone, observacoes, vendedor, rota, ordem_paragem, regras
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, d.get("Doc_ID", ""), d.get("Cliente", ""), d.get("Morada", ""),
                        d.get("CP", ""), d.get("Localidade", ""), float(d.get("Peso_KG", 50.0)),
                        float(d.get("Volume_M3", 0.1)), 2, d.get("Janela_Inicio", "08:00"),
                        d.get("Janela_Fim", "18:00"), int(d.get("Tempo_Descarga_Min", 15)),
                        lat_d, lon_d, qual_d, src_d,
                        d.get("Morada", ""), d.get("Armazem", wh_rows[0]["Nome_Armazem"]),
                        "", "", "", d.get("Rota", "Por Distribuir"),
                        int(d.get("Ordem", 1)), str(d.get("Regras", "") or "")
                    ))
                conn.commit()

        # 5. Guardar Frota na tabela SQLite frota
        if fleet_rows_for_db:
            save_frota_projeto(project_id, fleet_rows_for_db)

        # 6. Salvar Snapshot completo
        df_wh = pd.DataFrame(wh_rows) if wh_rows else pd.DataFrame()
        df_routes_imported = pd.DataFrame(routes_solution_list) if routes_solution_list else pd.DataFrame()
        has_routes = not df_routes_imported.empty

        state_dict = {
            "warehouses_geocoded": df_wh,
            "fleet_config": fleet_dict,
            "rules_matrix": [],
            "clients_geocoded": pd.DataFrame(deliveries_list) if deliveries_list else pd.DataFrame(),
            "routes_solution": df_routes_imported if has_routes else None,
            "routes_df": df_routes_imported if has_routes else None,
            "drivers": drivers_list,
            "motoristas": drivers_list,
            "service_date": detected_service_date or datetime.now().strftime("%Y-%m-%d"),
            "mobiliario_meta": {
                "store_map": {k: {"Nome": v.get("Nome_Armazem"), "ID": k} for k, v in store_map.items()},
                "veh_to_id": veh_to_id,
                "driver_to_id": driver_to_id
            },
            "phase_1_complete": bool(deliveries_list),
            "phase_2_complete": bool(fleet_dict),
            "phase_3_complete": has_routes
        }

        payload = serialize_state(state_dict)
        fase_num = 3 if has_routes else 2
        snapshot_name = f"Importação Mobiliário ({datetime.now().strftime('%H:%M:%S')})"

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (project_id, current_user.id, fase_num, snapshot_name, payload)
            )
            conn.commit()

        return {
            "status": "success",
            "message": f"Ficheiros Mobiliário importados com sucesso! ({len(wh_rows)} armazéns, {len(fleet_dict)} veículos, {len(deliveries_list)} entregas georreferenciadas, {len(routes_solution_list)} serviços atribuídos).",
            "num_warehouses": len(wh_rows),
            "num_vehicles": len(fleet_dict),
            "num_deliveries": len(deliveries_list),
            "num_routes": len(routes_solution_list)
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao importar ficheiros Mobiliário: {str(e)}")


import re
from datetime import datetime

from core.session_state import FleetVehicle
from database import save_frota_projeto

@router.post("/import-alimentar/{project_id}")
async def import_alimentar_files(
    project_id: int,
    files: List[UploadFile] = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Importa ficheiros da Distribuição Alimentar (Lojas, Frota e Pedidos)
    e popula diretamente as tabelas SQLite (entregas, frota) e o snapshot GeoRoutePlan.
    """
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

    try:
        google_api_key = os.getenv("GOOGLE_MAPS_API_KEY", "")
        root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        db_path = os.path.join(root_dir, DB_GEO_PATH)
        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)

        def _decode_file(raw_bytes: bytes) -> str:
            for enc in ["utf-8-sig", "utf-8", "latin-1", "cp1252"]:
                try:
                    return raw_bytes.decode(enc)
                except Exception:
                    continue
            return raw_bytes.decode("utf-8", errors="ignore")

        def _parse_time_min(val_str: Any) -> int:
            if not val_str:
                return 15
            s = str(val_str).strip()
            if ":" in s:
                parts = s.split(":")
                try:
                    return int(parts[0]) * 60 + int(parts[1])
                except Exception:
                    return 15
            try:
                return int(float(s.replace(",", ".")))
            except Exception:
                return 15

        def _parse_flt(val_str: Any, default: float = 0.0) -> float:
            if val_str is None or val_str == "":
                return default
            s = str(val_str).strip().replace(",", ".")
            try:
                return float(s)
            except Exception:
                return default

        # Obter estado anterior do projeto para preservar tabelas que não foram enviadas
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            snap_row = cursor.fetchone()
        existing_state = deserialize_state(snap_row["payload_json"]) if snap_row and snap_row["payload_json"] else {}

        # Ler e categorizar os ficheiros
        file_lojas_lines = []
        file_fleet_lines = []
        file_pedidos_lines = []

        for f in files:
            content_bytes = await f.read()
            text = _decode_file(content_bytes)
            raw_lines = [l.strip("\r\n") for l in text.split("\n") if l.strip()]
            if not raw_lines:
                continue

            first_cols = raw_lines[0].split("\t")
            fn = f.filename.lower() if f.filename else ""
            num_cols = len(first_cols)

            if "loja" in fn or "store" in fn or "armaz" in fn or num_cols == 10 or (num_cols >= 8 and num_cols <= 15 and "nome_armazem" in raw_lines[0].lower()):
                file_lojas_lines = raw_lines
            elif "frota" in fn or "fleet" in fn or (num_cols >= 30 and num_cols <= 34):
                file_fleet_lines = raw_lines
            elif "pedido" in fn or "pedidos" in fn or "service" in fn or "servi" in fn or "entrega" in fn or (num_cols >= 35 and num_cols <= 42):
                file_pedidos_lines = raw_lines

        if not file_lojas_lines and not file_fleet_lines and not file_pedidos_lines:
            raise HTTPException(
                status_code=400,
                detail="Não foi possível identificar os ficheiros da Distribuição Alimentar (Lojas, Frota ou Pedidos). Verifique se enviou os ficheiros de texto tabulados correspondentes."
            )

        # 1. Processar Lojas (Armazéns)
        wh_rows = []
        store_map = {}
        for idx, line in enumerate(file_lojas_lines):
            if idx == 0 and "nome_armazem" in line.lower():
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            w_name = parts[0].strip()
            w_addr = parts[1].strip() if len(parts) > 1 else ""
            w_cp = parts[2].strip() if len(parts) > 2 else ""
            w_loc = parts[3].strip() if len(parts) > 3 else ""
            w_lat = _parse_flt(parts[4]) if len(parts) > 4 else 0.0
            w_lon = _parse_flt(parts[5]) if len(parts) > 5 else 0.0
            w_open = parts[6].strip() if len(parts) > 6 and parts[6].strip() else "06:00:00"
            w_close = parts[7].strip() if len(parts) > 7 and parts[7].strip() else "22:00:00"
            w_load = _parse_time_min(parts[8]) if len(parts) > 8 else 30
            w_cont = parts[9].strip() if len(parts) > 9 else ""

            if (w_lat == 0.0 or w_lon == 0.0) and (w_addr or w_cp):
                try:
                    res_tuple = geocoder.resolve_address(w_addr, w_cp, w_loc, fast_mode=True)
                    res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    if res and res.get("lat") and res.get("lon"):
                        w_lat = float(res["lat"])
                        w_lon = float(res["lon"])
                except Exception:
                    pass

            wh_item = {
                "Nome_Armazem": w_name,
                "Nome": w_name,
                "Morada": w_addr,
                "CP": w_cp,
                "Codigo_Postal": w_cp,
                "Localidade": w_loc,
                "Latitude": w_lat,
                "Longitude": w_lon,
                "Hora_Abertura": w_open,
                "Hora_Fecho": w_close,
                "Tempo_Carga_Min": w_load,
                "Contacto_Responsavel": w_cont
            }
            wh_rows.append(wh_item)
            norm_key = re.sub(r'[^a-zA-Z0-9]', '', w_name.lower())
            store_map[norm_key] = wh_item
            store_map[w_name] = wh_item

        if not wh_rows:
            raw_prev_wh = _pick_first_valid(
                existing_state.get("warehouses_geocoded"),
                existing_state.get("warehouses_used"),
                existing_state.get("warehouses")
            )
            if raw_prev_wh is not None:
                df_prev_wh = raw_prev_wh if isinstance(raw_prev_wh, pd.DataFrame) else pd.DataFrame(raw_prev_wh)
                if not df_prev_wh.empty:
                    wh_rows = df_prev_wh.to_dict(orient="records")
                    for w in wh_rows:
                        w_name = str(w.get("Nome_Armazem", w.get("name", ""))).strip()
                        if w_name:
                            norm_k = re.sub(r'[^a-zA-Z0-9]', '', w_name.lower())
                            store_map[norm_k] = w
                            store_map[w_name.lower()] = w
            if not wh_rows:
                wh_rows.append({
                    "Nome_Armazem": "Loja Central",
                    "Nome": "Loja Central",
                    "Morada": "Centro de Distribuição Alimentar",
                    "CP": "2810-500",
                    "Codigo_Postal": "2810-500",
                    "Localidade": "Almada",
                    "Latitude": 38.6598,
                    "Longitude": -9.1747,
                    "Hora_Abertura": "06:00:00",
                    "Hora_Fecho": "22:00:00",
                    "Tempo_Carga_Min": 30,
                    "Contacto_Responsavel": ""
                })

        # 2. Processar Frota
        fleet_dict = {}
        veh_code_to_name = {}
        drivers_list = []
        fleet_rows_for_db = []

        for line in file_fleet_lines:
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            v_id = parts[0].strip()
            v_plate = parts[1].strip() if len(parts) > 1 else ""
            v_name = f"Viatura {v_id} ({v_plate})" if v_plate else f"Viatura {v_id}"
            d_id = parts[2].strip() if len(parts) > 2 else ""
            d_name = parts[3].strip() if len(parts) > 3 else ""
            v_store_key = parts[4].strip() if len(parts) > 4 else ""
            v_rules = parts[5].strip() if len(parts) > 5 else ""
            v_start = parts[15].strip() if len(parts) > 15 and parts[15].strip() else "08:00:00"
            v_end = parts[16].strip() if len(parts) > 16 and parts[16].strip() else "20:00:00"
            v_kg = _parse_flt(parts[10], 1000.0) if len(parts) > 10 else 1000.0
            v_vol = 10.0

            target_wh = wh_rows[0]["Nome_Armazem"]
            if v_store_key:
                norm_sk = re.sub(r'[^a-zA-Z0-9]', '', v_store_key.lower())
                for k, s in store_map.items():
                    if k in norm_sk or norm_sk in k:
                        target_wh = s["Nome_Armazem"]
                        break

            v_obj = FleetVehicle(
                capacidade_kg=v_kg,
                capacidade_vol=v_vol,
                custo_km=0.65,
                velocidade_media=50.0,
                horario_inicio=v_start[:5],
                horario_fim=v_end[:5],
                armazem=target_wh
            )
            v_obj.custo_hora = 12.50
            v_obj.max_entregas = 30
            v_obj.regras = v_rules
            v_obj.motorista_nome = d_name
            v_obj.codigo_veiculo = v_id
            v_obj.codigo_motorista = d_id
            v_obj.segunda_volta = "Não"
            fleet_dict[v_name] = v_obj
            veh_code_to_name[v_id] = v_name

            fleet_rows_for_db.append({
                "veiculo": v_name,
                "capacidade_kg": v_kg,
                "capacidade_volume": v_vol,
                "custo_km": 0.65,
                "velocidade_media": 50.0,
                "horario_inicio": v_start[:5],
                "horario_fim": v_end[:5],
                "armazem": target_wh,
                "regras": v_rules,
                "max_entregas": 30,
                "motorista_nome": d_name,
                "motorista_telemovel": "910000000",
                "codigo_veiculo": v_id,
                "codigo_motorista": d_id,
                "is_active": 1,
                "segunda_volta": "Não"
            })

            if d_name:
                drivers_list.append({
                    "name": d_name,
                    "pin": "1234",
                    "phone": "910000000",
                    "vehicle": v_name,
                    "matricula": v_plate,
                    "route": v_name,
                    "is_active": 1
                })

        # 3. Processar Pedidos
        deliveries_list = []
        detected_service_date = ""

        for s_idx, line in enumerate(file_pedidos_lines):
            parts = line.split("\t")
            if len(parts) < 25:
                continue

            raw_date = parts[1].strip() if len(parts) > 1 else ""
            if raw_date and not detected_service_date:
                if "/" in raw_date:
                    d_p = raw_date.split("/")
                    if len(d_p) == 3:
                        detected_service_date = f"{d_p[2]}-{d_p[1]}-{d_p[0]}"
                else:
                    detected_service_date = raw_date

            s_rules = parts[6].strip() if len(parts) > 6 else ""
            doc_id = parts[32].strip() if len(parts) > 32 and parts[32].strip() else parts[0].strip()
            cli_name = parts[21].strip() if len(parts) > 21 and parts[21].strip() else doc_id
            addr = parts[22].strip() if len(parts) > 22 else ""
            cp = parts[23].strip() if len(parts) > 23 else ""
            loc = parts[24].strip() if len(parts) > 24 else ""

            lon_str = parts[26].strip() if len(parts) > 26 else ""
            lat_str = parts[27].strip() if len(parts) > 27 else ""

            j1_start = parts[28].strip() if len(parts) > 28 and parts[28].strip() else "08:00"
            j1_end = parts[29].strip() if len(parts) > 29 and parts[29].strip() else "20:00"
            unload_min = _parse_time_min(parts[30]) if len(parts) > 30 else 15
            weight = _parse_flt(parts[34], 50.0) if len(parts) > 34 else 50.0
            volume = round(weight / 100.0, 2) if weight > 0 else 1.0

            lat, lon = 0.0, 0.0
            if lat_str and lon_str:
                try:
                    lat = float(lat_str.replace(",", "."))
                    lon = float(lon_str.replace(",", "."))
                except Exception:
                    pass

            if lat == 0.0 and lon == 0.0 and (addr or cp):
                try:
                    res_tuple = geocoder.resolve_address(addr, cp, loc, fast_mode=True)
                    res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
                    if res and res.get("lat") and res.get("lon"):
                        lat = float(res["lat"])
                        lon = float(res["lon"])
                except Exception:
                    pass

            qual = 1 if (lat != 0.0 and lon != 0.0) else 99
            wh_name = wh_rows[0]["Nome_Armazem"]

            d_entry = {
                "Armazem": wh_name,
                "Doc_ID": doc_id,
                "Codigo_Cliente": doc_id,
                "Cliente": cli_name,
                "Nome_Cliente": cli_name,
                "Morada": addr,
                "CP": cp,
                "Codigo_Postal": cp,
                "Localidade": loc,
                "Latitude": lat,
                "Longitude": lon,
                "Telefone_Cliente": "",
                "Telefone": "",
                "Peso_KG": weight,
                "Peso": weight,
                "Volume_M3": volume,
                "Volume_m3": volume,
                "Janela_Inicio": j1_start,
                "Janela_Fim": j1_end,
                "Janela_Horaria": f"{j1_start} - {j1_end}",
                "Tempo_Descarga_Min": unload_min,
                "Tipo_Operacao": "ENTREGA",
                "Regras": s_rules,
                "Notas_Motorista": "",
                "Observacoes": "",
                "Prioridade": "Normal",
                "Vendedor": "",
                "Rota": "Por Distribuir",
                "Ordem": s_idx + 1,
                "Ordem_Paragem": s_idx + 1
            }
            deliveries_list.append(d_entry)

        # 4. Guardar Entregas no SQLite
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
                            peso_kg, volume_m3, prioridade, janela_inicio, janela_fim, tempo_descarga_min,
                            latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada, armazem,
                            telefone, observacoes, vendedor, rota, ordem_paragem, regras
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        project_id, d["Doc_ID"], d["Cliente"], d["Morada"],
                        d["CP"], d["Localidade"], float(d.get("Peso_KG", 50.0)),
                        float(d.get("Volume_M3", 0.1)), 2, d.get("Janela_Inicio", "08:00"),
                        d.get("Janela_Fim", "18:00"), int(d.get("Tempo_Descarga_Min", 15)),
                        lat_d, lon_d, qual_d, src_d, d["Morada"], d["Armazem"],
                        "", "", "", d["Rota"], d["Ordem"], d["Regras"]
                    ))
                conn.commit()

        # 5. Guardar Frota no SQLite
        if fleet_rows_for_db:
            save_frota_projeto(project_id, fleet_rows_for_db)

        # 6. Salvar Snapshot completo
        df_wh = pd.DataFrame(wh_rows) if wh_rows else pd.DataFrame()

        state_dict = {
            "warehouses_geocoded": df_wh,
            "fleet_config": fleet_dict,
            "rules_matrix": [],
            "clients_geocoded": pd.DataFrame(deliveries_list) if deliveries_list else pd.DataFrame(),
            "routes_solution": None,
            "routes_df": None,
            "drivers": drivers_list,
            "motoristas": drivers_list,
            "service_date": detected_service_date or datetime.now().strftime("%Y-%m-%d"),
            "phase_1_complete": bool(deliveries_list),
            "phase_2_complete": bool(fleet_dict),
            "phase_3_complete": False
        }

        payload = serialize_state(state_dict)
        snapshot_name = f"Importação Alimentar ({datetime.now().strftime('%H:%M:%S')})"

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (project_id, current_user.id, 2, snapshot_name, payload)
            )
            conn.commit()

        return {
            "status": "success",
            "message": f"Ficheiros da Distribuição Alimentar importados com sucesso! ({len(wh_rows)} lojas/armazéns, {len(fleet_dict)} veículos, {len(deliveries_list)} pedidos georreferenciados).",
            "num_warehouses": len(wh_rows),
            "num_vehicles": len(fleet_dict),
            "num_deliveries": len(deliveries_list)
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao importar ficheiros Alimentar: {str(e)}")




@router.post("/import-fleet-file/{project_id}")
async def import_fleet_file_only(
    project_id: int,
    files: List[UploadFile] = File(...),
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Importa exclusivamente ficheiro(s) de Frota (.txt) para o projeto atual,
    associando viaturas e motoristas aos armazéns existentes sem apagar lojas nem clientes.
    Suporta formatos Alimentar (33 cols), Mobiliário (41 cols) e outros tabulados.
    """
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

    try:
        def _decode_file(raw_bytes: bytes) -> str:
            for enc in ["utf-8-sig", "utf-8", "latin-1", "cp1252"]:
                try:
                    return raw_bytes.decode(enc)
                except Exception:
                    continue
            return raw_bytes.decode("utf-8", errors="ignore")

        def _parse_flt(val_str: Any, default: float = 0.0) -> float:
            if val_str is None or val_str == "":
                return default
            s = str(val_str).strip().replace(",", ".")
            try:
                return float(s)
            except Exception:
                return default

        # 1. Obter snapshot atual para preservar armazéns e clientes
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
            snap_row = cursor.fetchone()

        existing_state = deserialize_state(snap_row["payload_json"]) if snap_row and snap_row["payload_json"] else {}

        raw_wh = _pick_first_valid(
            existing_state.get("warehouses_geocoded"),
            existing_state.get("warehouses_used"),
            existing_state.get("warehouses"),
            existing_state.get("df_warehouses")
        )
        wh_rows = []
        store_map = {}
        if raw_wh is not None:
            df_wh = raw_wh if isinstance(raw_wh, pd.DataFrame) else pd.DataFrame(raw_wh)
            if not df_wh.empty:
                for _, r in df_wh.iterrows():
                    w_name = str(r.get("Nome_Armazem", r.get("name", ""))).strip()
                    if w_name:
                        wh_item = {"Nome_Armazem": w_name}
                        wh_rows.append(wh_item)
                        norm_k = re.sub(r'[^a-zA-Z0-9]', '', w_name.lower())
                        store_map[norm_k] = wh_item
                        store_map[w_name.lower()] = wh_item

        default_wh_name = wh_rows[0]["Nome_Armazem"] if wh_rows else "Armazém Principal"

        # 2. Ler ficheiros de frota
        fleet_dict = {}
        veh_code_to_name = {}
        drivers_list = []
        fleet_rows_for_db = []

        for f in files:
            content_bytes = await f.read()
            text_file = _decode_file(content_bytes)
            raw_lines = [l.strip("\r\n") for l in text_file.split("\n") if l.strip()]
            if not raw_lines:
                continue

            for line in raw_lines:
                parts = line.split("\t")
                if len(parts) < 2:
                    continue

                num_cols = len(parts)

                # Formato Alimentar (~33 colunas)
                if num_cols < 38:
                    v_id = parts[0].strip().replace('\ufeff', '')
                    v_plate = parts[1].strip() if len(parts) > 1 else ""
                    v_name = f"Viatura {v_id} ({v_plate})" if v_plate else f"Viatura {v_id}"
                    d_id = parts[2].strip() if len(parts) > 2 else ""
                    d_name = parts[3].strip() if len(parts) > 3 else ""
                    v_store_key = parts[4].strip() if len(parts) > 4 else ""
                    v_rules = parts[5].strip() if len(parts) > 5 else ""
                    v_start = parts[15].strip() if len(parts) > 15 and parts[15].strip() else "08:00:00"
                    v_end = parts[16].strip() if len(parts) > 16 and parts[16].strip() else "20:00:00"
                    v_kg = _parse_flt(parts[10], 1000.0) if len(parts) > 10 else 1000.0
                    v_vol = 10.0

                    target_wh = default_wh_name
                    if v_store_key:
                        norm_sk = re.sub(r'[^a-zA-Z0-9]', '', v_store_key.lower())
                        for k, s in store_map.items():
                            if k in norm_sk or norm_sk in k:
                                target_wh = s["Nome_Armazem"]
                                break

                    v_obj = FleetVehicle(
                        capacidade_kg=v_kg,
                        capacidade_vol=v_vol,
                        custo_km=0.65,
                        velocidade_media=50.0,
                        horario_inicio=v_start[:5],
                        horario_fim=v_end[:5],
                        armazem=target_wh
                    )
                    v_obj.custo_hora = 12.50
                    v_obj.max_entregas = 30
                    v_obj.regras = v_rules
                    v_obj.motorista_nome = d_name
                    v_obj.codigo_veiculo = v_id
                    v_obj.codigo_motorista = d_id
                    v_obj.segunda_volta = "Não"
                    fleet_dict[v_name] = v_obj
                    veh_code_to_name[v_id] = v_name

                    fleet_rows_for_db.append({
                        "veiculo": v_name,
                        "capacidade_kg": v_kg,
                        "capacidade_volume": v_vol,
                        "custo_km": 0.65,
                        "velocidade_media": 50.0,
                        "horario_inicio": v_start[:5],
                        "horario_fim": v_end[:5],
                        "armazem": target_wh,
                        "regras": v_rules,
                        "max_entregas": 30,
                        "motorista_nome": d_name,
                        "motorista_telemovel": "910000000",
                        "codigo_veiculo": v_id,
                        "codigo_motorista": d_id,
                        "is_active": 1,
                        "segunda_volta": "Não"
                    })

                    if d_name:
                        drivers_list.append({
                            "name": d_name,
                            "pin": "1234",
                            "phone": "910000000",
                            "vehicle": v_name,
                            "matricula": v_plate,
                            "route": v_name,
                            "is_active": 1
                        })

                # Formato Mobiliário (~41 colunas)
                else:
                    v_id = parts[0].strip().replace('\ufeff', '')
                    v_name = parts[1].strip() or f"Viatura {v_id}"
                    d_id = parts[2].strip() if len(parts) > 2 else ""
                    d_name = parts[3].strip() if len(parts) > 3 else ""
                    v_store_id = parts[4].strip() if len(parts) > 4 else ""
                    v_rules = parts[6].strip() if len(parts) > 6 else ""
                    v_kg = _parse_flt(parts[11], 1000.0) if len(parts) > 11 else 1000.0
                    raw_vol = _parse_flt(parts[13], 10.0) if len(parts) > 13 else 10.0
                    v_vol = round(raw_vol / 1000.0, 2) if raw_vol > 50 else raw_vol
                    v_max = int(_parse_flt(parts[15], 30)) if len(parts) > 15 else 30
                    v_start = parts[19].strip() if len(parts) > 19 and parts[19].strip() else "08:00"
                    v_end = parts[20].strip() if len(parts) > 20 and parts[20].strip() else "20:00"

                    target_wh = default_wh_name
                    if v_store_id:
                        norm_sk = re.sub(r'[^a-zA-Z0-9]', '', v_store_id.lower())
                        for k, s in store_map.items():
                            if k in norm_sk or norm_sk in k:
                                target_wh = s["Nome_Armazem"]
                                break

                    v_obj = FleetVehicle(
                        capacidade_kg=v_kg,
                        capacidade_vol=v_vol,
                        custo_km=0.65,
                        velocidade_media=50.0,
                        horario_inicio=v_start[:5],
                        horario_fim=v_end[:5],
                        armazem=target_wh
                    )
                    v_obj.custo_hora = 12.50
                    v_obj.max_entregas = v_max
                    v_obj.regras = v_rules
                    v_obj.motorista_nome = d_name
                    v_obj.codigo_veiculo = v_id
                    v_obj.codigo_motorista = d_id
                    v_obj.segunda_volta = "Não"
                    fleet_dict[v_name] = v_obj

                    fleet_rows_for_db.append({
                        "veiculo": v_name,
                        "capacidade_kg": v_kg,
                        "capacidade_volume": v_vol,
                        "custo_km": 0.65,
                        "velocidade_media": 50.0,
                        "horario_inicio": v_start[:5],
                        "horario_fim": v_end[:5],
                        "armazem": target_wh,
                        "regras": v_rules,
                        "max_entregas": v_max,
                        "motorista_nome": d_name,
                        "motorista_telemovel": "910000000",
                        "codigo_veiculo": v_id,
                        "codigo_motorista": d_id,
                        "is_active": 1,
                        "segunda_volta": "Não"
                    })

                    if d_name:
                        drivers_list.append({
                            "name": d_name,
                            "pin": "1234",
                            "phone": "910000000",
                            "vehicle": v_name,
                            "matricula": "",
                            "route": v_name,
                            "is_active": 1
                        })

        if not fleet_rows_for_db:
            raise HTTPException(status_code=400, detail="Não foi possível identificar registos válidos no ficheiro de frota.")

        # 3. Guardar na tabela frota
        save_frota_projeto(project_id, fleet_rows_for_db)

        # 4. Atualizar o snapshot preservando o que já existia
        updated_state = dict(existing_state)
        updated_state["fleet_config"] = fleet_dict
        updated_state["drivers"] = drivers_list
        updated_state["motoristas"] = drivers_list
        updated_state["phase_2_complete"] = True

        payload = serialize_state(updated_state)
        snap_title = f"Importação de Frota ({datetime.now().strftime('%H:%M:%S')})"

        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json) VALUES (?, ?, ?, ?, ?)",
                (project_id, current_user.id, 2, snap_title, payload)
            )
            conn.commit()

        return {
            "status": "success",
            "message": f"Frota importada com sucesso! ({len(fleet_rows_for_db)} viaturas registadas).",
            "num_vehicles": len(fleet_rows_for_db)
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao importar ficheiro de frota: {str(e)}")


class RuleSimulatePayload(BaseModel):
    vehicle_name: Optional[str] = "Viatura"
    vehicle_tags: Optional[str] = ""
    delivery_tags: Optional[str] = ""
    delivery_cp: Optional[str] = ""
    rules_matrix: Optional[List[Dict[str, Any]]] = None

@router.post("/{project_id}/rules/simulate")
def simulate_fleet_rule(
    project_id: int,
    payload: RuleSimulatePayload,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Simulador interativo de regras para testar compatibilidade entre viaturas e entregas,
    considerando tags, restrições e faixas de Código Postal.
    """
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")

    from utils.rules_engine import simulate_rule_evaluation

    res = simulate_rule_evaluation(
        vehicle_tags=payload.vehicle_tags or "",
        delivery_tags=payload.delivery_tags or "",
        rules_matrix=payload.rules_matrix,
        delivery_cp=payload.delivery_cp or "",
        vehicle_name=payload.vehicle_name or "Viatura"
    )
    return res
