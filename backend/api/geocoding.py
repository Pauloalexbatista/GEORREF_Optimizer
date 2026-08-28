
def clean_str_val(val):
    if val is None or pd.isna(val):
        return ""
    s = str(val).strip()
    s = s.replace("_x000D_", "").replace("\r", "").strip()
    return s
from fastapi.responses import StreamingResponse

import sqlite3

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File

from pydantic import BaseModel

from typing import List, Optional

import io

import uuid

import os
DB_MULTI_PATH = os.getenv("DB_MULTI_PATH", "geocoding_multi.db")
DB_GEO_PATH = os.getenv("DB_GEO_PATH", "geocoding.db")



import shutil

import pandas as pd

import sys



# Resolve imports from root

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from database import get_db, get_projeto, ensure_entregas_columns

from utils.geocoder_engine import WaterfallGeocoder

from backend.api.auth import get_current_user, UserResponse



router = APIRouter(prefix="/geocoding", tags=["geocoding"])



# Directory to store temporary uploaded files

TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "temp_uploads")

os.makedirs(TEMP_DIR, exist_ok=True)



class ColumnMapping(BaseModel):

    file_id: str

    project_id: int

    col_code: str

    col_name: Optional[str] = None

    col_addr: str

    col_cp: str

    col_city: str

    col_weight: str

    col_volume: str

    col_priority: Optional[str] = None

    col_start_window: Optional[str] = None

    col_end_window: Optional[str] = None

    col_lat: Optional[str] = None

    col_lon: Optional[str] = None
    col_vendedor: Optional[str] = None



class DeliveryCorrection(BaseModel):

    morada: str

    codigo_postal: str

    concelho: str

    latitude: float

    longitude: float



@router.post("/upload")

async def upload_file(file: UploadFile = File(...), current_user: UserResponse = Depends(get_current_user)):

    # Verify file extension

    ext = os.path.splitext(file.filename)[1].lower()

    if ext not in [".xlsx", ".xls", ".csv"]:

        raise HTTPException(status_code=400, detail="Apenas ficheiros Excel (.xlsx, .xls) ou CSV são suportados.")

        

    file_id = str(uuid.uuid4())

    temp_path = os.path.join(TEMP_DIR, f"{file_id}{ext}")

    

    try:

        with open(temp_path, "wb") as buffer:

            shutil.copyfileobj(file.file, buffer)

            

        # Read columns

        if ext == ".csv":

            try:

                df = pd.read_csv(temp_path, nrows=2, sep=";")

            except Exception:

                df = pd.read_csv(temp_path, nrows=2, sep=",")

        else:

            xls = pd.ExcelFile(temp_path)
            sheet_to_read = None
            for s in xls.sheet_names:
                if s.lower().strip() in ['entregas', 'clientes', 'encomendas', 'deliveries', 'orders']:
                    sheet_to_read = s
                    break
            if not sheet_to_read:
                for s in xls.sheet_names:
                    if s.lower().strip() in ['rotas', 'routes', 'planeamento', 'plano_rotas']:
                        sheet_to_read = s
                        break
            if sheet_to_read:
                df = pd.read_excel(xls, sheet_name=sheet_to_read, nrows=2)
            else:
                df = pd.read_excel(temp_path, nrows=2)

            

        return {

            "file_id": file_id,

            "filename": file.filename,

            "columns": list(df.columns)

        }

    except Exception as e:

        if os.path.exists(temp_path):

            os.remove(temp_path)

        raise HTTPException(status_code=500, detail=f"Erro ao ler colunas do ficheiro: {str(e)}")



@router.post("/start")

async def start_geocoding(mapping: ColumnMapping, current_user: UserResponse = Depends(get_current_user)):

    # 1. Find the uploaded file

    file_path = None

    for f in os.listdir(TEMP_DIR):

        if f.startswith(mapping.file_id):

            file_path = os.path.join(TEMP_DIR, f)

            break

            

    if not file_path:

        raise HTTPException(status_code=404, detail="Ficheiro temporário expirou ou não foi encontrado. Por favor faça upload novamente.")

        

    # 2. Check project permission

    proj = get_projeto(mapping.project_id)

    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):

        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

        

    ext = os.path.splitext(file_path)[1].lower()

    try:

        # Read the entire file

        if ext == ".csv":

            try:

                df = pd.read_csv(file_path, sep=";")

            except Exception:

                df = pd.read_csv(file_path, sep=",")

        else:

            xls = pd.ExcelFile(file_path)
            sheet_to_read = None
            for s in xls.sheet_names:
                if s.lower().strip() in ['entregas', 'clientes', 'encomendas', 'deliveries', 'orders']:
                    sheet_to_read = s
                    break
            if not sheet_to_read:
                for s in xls.sheet_names:
                    if s.lower().strip() in ['rotas', 'routes', 'planeamento', 'plano_rotas']:
                        sheet_to_read = s
                        break
            if sheet_to_read:
                df = pd.read_excel(xls, sheet_name=sheet_to_read)
            else:
                df = pd.read_excel(file_path)

            

        # Validate that mapped columns exist in df

        required_cols = [mapping.col_code, mapping.col_addr, mapping.col_cp, mapping.col_city, mapping.col_weight, mapping.col_volume]

        for col in required_cols:

            if col not in df.columns:

                raise HTTPException(status_code=400, detail=f"Coluna mapeada '{col}' não encontrada no ficheiro.")

                

        # Initialize Geocoder

        google_api_key = current_user.google_api_key if hasattr(current_user, 'google_api_key') else None

        if not google_api_key:

            from database import get_google_api_key

            google_api_key = get_google_api_key()

            

        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)

        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)

        

        # Clear existing deliveries for project

        with get_db() as conn:

            cursor = conn.cursor()

            cursor.execute("DELETE FROM entregas WHERE projeto_id = ?", (mapping.project_id,))

            conn.commit()

            

        success_count = 0

        fail_count = 0

        

        ensure_entregas_columns()
        for idx, row in df.iterrows():

            code = str(row[mapping.col_code])

            name = str(row[mapping.col_name]) if (mapping.col_name and mapping.col_name in df.columns) else code

            addr = str(row[mapping.col_addr])

            vendedor = ""
            if mapping.col_vendedor and mapping.col_vendedor in df.columns and pd.notna(row[mapping.col_vendedor]):
                vendedor = str(row[mapping.col_vendedor]).strip()
            else:
                for cand in ["vendedor", "Vendedor", "comercial", "Comercial", "agente", "Agente", "sales_rep", "salesperson"]:
                    if cand in df.columns and pd.notna(row[cand]):
                        vendedor = str(row[cand]).strip()
                        break

            cp = str(row[mapping.col_cp]) if pd.notna(row[mapping.col_cp]) else ""

            city = str(row[mapping.col_city]) if pd.notna(row[mapping.col_city]) else ""

            weight = float(row[mapping.col_weight]) if pd.notna(row[mapping.col_weight]) else 0.0

            volume = float(row[mapping.col_volume]) if pd.notna(row[mapping.col_volume]) else 0.0

            

            priority = 2

            if mapping.col_priority and mapping.col_priority in df.columns:

                try:

                    priority = int(row[mapping.col_priority])

                except Exception:

                    priority = 2

                    

            start_window = "08:00"

            if mapping.col_start_window and mapping.col_start_window in df.columns:

                start_window = str(row[mapping.col_start_window])

                

            end_window = "18:00"

            if mapping.col_end_window and mapping.col_end_window in df.columns:

                end_window = str(row[mapping.col_end_window])

                

            has_coords = False

            lat_val = 0.0

            lon_val = 0.0

            if mapping.col_lat and mapping.col_lat in df.columns and mapping.col_lon and mapping.col_lon in df.columns:

                try:

                    e_lat = row[mapping.col_lat]

                    e_lon = row[mapping.col_lon]

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

                    resolve_res = geocoder.resolve_address(addr, cp, city, fast_mode=True)

                    if isinstance(resolve_res, tuple):

                        res = resolve_res[0]

                    else:

                        res = resolve_res

                except Exception:

                    res = None

                    

            if res and res.get('lat') and res.get('lon'):

                lat = res['lat']

                lon = res['lon']

                quality = res.get('quality_level', 1)

                source = res.get('source', 'NOMINATIM')

                morada_encontrada = res.get('morada_encontrada', addr)

                success_count += 1

            else:

                lat = 0.0

                lon = 0.0

                quality = 99

                source = "FALHA"

                morada_encontrada = ""

                fail_count += 1

                

            with get_db() as conn:

                cursor = conn.cursor()

                cursor.execute("""

                    INSERT INTO entregas (

                        projeto_id, codigo_cliente, nome_cliente, morada, codigo_postal, _concelho,

                        peso_kg, volume_m3, prioridade, janela_inicio, janela_fim,

                        vendedor, latitude, longitude, nivel_qualidade, fonte_match, morada_encontrada

                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

                """, (

                    mapping.project_id, code, name, addr, cp, city,

                    weight, volume, priority, start_window, end_window,

                    vendedor, lat, lon, quality, source, morada_encontrada

                ))

                conn.commit()

                

        os.remove(file_path)

        

        return {

            "status": "success",

            "total": len(df),

            "success": success_count,

            "failed": fail_count

        }

    except Exception as e:

        if os.path.exists(file_path):

            os.remove(file_path)

        raise HTTPException(status_code=500, detail=f"Erro durante a geocodificação: {str(e)}")





def get_failure_reason(morada: str, cp: str, concelho: str, lat: float, lon: float, quality: int) -> str:

    if lat != 0.0 and lon != 0.0 and quality < 99:

        return ""

        

    morada = str(morada).strip() if morada else ""

    cp = str(cp).strip() if cp else ""

    concelho = str(concelho).strip() if concelho else ""

    

    reasons = []

    has_data = False

    

    if not morada or morada.lower() in ["nan", "none", ""]:

        reasons.append("Morada vazia")

    else:

        has_data = True

        

    if not cp or cp.lower() in ["nan", "none", ""]:

        reasons.append("Código Postal vazio")

    else:

        has_data = True

        cp_clean = cp.replace('-', '').replace(' ', '')

        if len(cp_clean) < 4:

            reasons.append("Código Postal inválido (muito curto)")

        elif cp_clean[:4] in ['0000', '9999']:

            reasons.append("Código Postal inválido (não existe)")

        elif not cp_clean.isdigit():

            reasons.append("Código Postal inválido (formato incorreto)")

            

    if not concelho or concelho.lower() in ["nan", "none", ""]:

        reasons.append("Concelho vazio")

    else:

        has_data = True

        

    if not reasons and has_data:

        reasons.append("Endereço não encontrado em nenhuma fonte")

    elif not reasons and not has_data:

        reasons.append("Todos os campos vazios")

        

    return " | ".join(reasons)







class ResolveAddressRequest(BaseModel):
    morada: str
    cp: Optional[str] = ""
    concelho: Optional[str] = ""

@router.post("/resolve")
def resolve_address_endpoint(
    req: ResolveAddressRequest,
    current_user: UserResponse = Depends(get_current_user)
):
    try:
        google_api_key = current_user.google_api_key if hasattr(current_user, 'google_api_key') else None
        if not google_api_key:
            from database import get_google_api_key
            google_api_key = get_google_api_key()
        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)
        geocoder = WaterfallGeocoder(db_path, google_api_key=google_api_key)
        res_tuple = geocoder.resolve_address(req.morada, req.cp or "", req.concelho or "", fast_mode=False)
        res = res_tuple[0] if isinstance(res_tuple, tuple) else res_tuple
        if res and res.get('lat') and res.get('lon'):
            return {
                "lat": float(res['lat']),
                "lon": float(res['lon']),
                "quality": int(res.get('quality', 1)),
                "source": str(res.get('source', 'GEOCODER')),
                "address": str(res.get('address', req.morada))
            }
        return {
            "lat": 0.0,
            "lon": 0.0,
            "quality": 99,
            "source": "NOT_FOUND",
            "address": req.morada
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao georreferenciar morada: {str(e)}")

@router.get("/suggest")
@router.get("/suggestions")
def get_suggestions(
    q: Optional[str] = None,
    morada: Optional[str] = None,
    cp: Optional[str] = None,
    concelho: Optional[str] = None,
    current_user: UserResponse = Depends(get_current_user)
):
    if q and not morada and not cp:
        import re
        cp_match = re.search(r'\b(\d{4}(?:-\d{3})?)\b', q)
        if cp_match:
            cp = cp_match.group(1)
        morada = q

    try:

        from rapidfuzz import fuzz

        db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)

        conn = sqlite3.connect(db_path)

        conn.row_factory = sqlite3.Row

        cursor = conn.cursor()

        

        query_parts = []

        params = []

        

        if cp and len(cp.replace('-', '')) >= 4:

            cp4 = cp.replace('-', '')[:4]

            query_parts.append("CP4 = ?")

            params.append(cp4)

            

        if concelho:

            query_parts.append("LOWER(cc_desig) LIKE ?")

            params.append(f"%{concelho.lower().strip()}%")

            

        if not query_parts:

            return []

            

        query = f"""

            SELECT DISTINCT full_street, CP4, cc_desig, LATITUDE, LONGITUDE

            FROM pt_addresses

            WHERE {' AND '.join(query_parts)}

            AND LATITUDE IS NOT NULL

            LIMIT 50

        """

        

        cursor.execute(query, params)

        rows = cursor.fetchall()

        conn.close()

        

        if not rows:

            return []

            

        suggestions = []

        for r in rows:

            db_morada = r["full_street"]

            db_cp4 = r["CP4"]

            db_concelho = r["cc_desig"]

            db_lat = r["LATITUDE"]

            db_lon = r["LONGITUDE"]

            

            if morada:

                score = fuzz.ratio(morada.lower(), db_morada.lower())

            else:

                score = 50

                

            suggestions.append({

                "morada": db_morada,

                "cp": db_cp4,

                "concelho": db_concelho,

                "lat": db_lat,

                "lon": db_lon,

                "score": score,

                "display": f"{db_morada}, {db_cp4} {db_concelho}"

            })

            

        suggestions.sort(key=lambda x: x["score"], reverse=True)

        return suggestions[:5]

    except Exception as e:

        raise HTTPException(status_code=500, detail=f"Erro ao obter sugestoes: {str(e)}")





@router.get("/{project_id}")

def get_deliveries(project_id: int, current_user: UserResponse = Depends(get_current_user)):

    proj = get_projeto(project_id)

    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):

        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

        

    try:

        with get_db() as conn:

            cursor = conn.cursor()

            cursor.execute("SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC", (project_id,))

            rows = cursor.fetchall()

            

            res = []

            for r in rows:

                lat = r["latitude"]

                lon = r["longitude"]

                quality = r["nivel_qualidade"]

                reason = ""

                if lat == 0.0 or lon == 0.0 or quality == 99:

                    reason = get_failure_reason(r["morada"], r["codigo_postal"], r["_concelho"], lat, lon, quality)

                    

                res.append({

                    "id": r["id"],

                    "codigo_cliente": r["codigo_cliente"],
                    "nome_cliente": r["nome_cliente"] if ("nome_cliente" in r.keys() and r["nome_cliente"]) else r["codigo_cliente"],

                    "morada": r["morada"],

                    "codigo_postal": r["codigo_postal"],

                    "concelho": r["_concelho"],

                    "peso_kg": r["peso_kg"],

                    "volume_m3": r["volume_m3"],

                    "prioridade": r["prioridade"],

                    "janela_inicio": r["janela_inicio"],

                    "janela_fim": r["janela_fim"],

                    "latitude": lat,

                    "longitude": lon,

                    "nivel_qualidade": quality,

                    "fonte_match": r["fonte_match"],

                    "morada_encontrada": r["morada_encontrada"],

                    "motivo_falha": reason,

                    "armazem": r["armazem"] if "armazem" in r.keys() else None,

                    "vendedor": r["vendedor"] if "vendedor" in r.keys() else "" 

                })

            return res

    except Exception as e:

        raise HTTPException(status_code=500, detail=str(e))



@router.put("/delivery/{delivery_id}")

def update_delivery_correction(delivery_id: int, corr: DeliveryCorrection, current_user: UserResponse = Depends(get_current_user)):

    try:

        with get_db() as conn:

            cursor = conn.cursor()

            cursor.execute("""

                SELECT e.id, p.empresa_id 

                FROM entregas e 

                JOIN projetos p ON e.projeto_id = p.id 

                WHERE e.id = ?

            """, (delivery_id,))

            row = cursor.fetchone()

            

            if not row:

                raise HTTPException(status_code=404, detail="Entrega não encontrada.")

            if row["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):

                raise HTTPException(status_code=403, detail="Não tem permissão para editar esta entrega.")

                

            cursor.execute("""
                UPDATE entregas 
                SET morada = ?, codigo_postal = ?, _concelho = ?,
                    latitude = ?, longitude = ?, nivel_qualidade = 1, fonte_match = 'CORRECAO_MANUAL'
                WHERE id = ?
            """, (corr.morada, corr.codigo_postal, corr.concelho, corr.latitude, corr.longitude, delivery_id))

            # Persistir / Enriquecer a Base de Dados Permanente (geocoding.db)
            if corr.latitude != 0.0 and corr.longitude != 0.0:
                try:
                    import sqlite3
                    from datetime import datetime
                    with sqlite3.connect(DB_GEO_PATH) as geo_conn:
                        geo_cur = geo_conn.cursor()
                        cp_raw = str(corr.codigo_postal or "").strip()
                        cp4_str = cp_raw.split("-")[0].strip() if cp_raw else ""
                        cp3_str = cp_raw.split("-")[1].strip() if "-" in cp_raw else ""
                        
                        geo_cur.execute("""
                            INSERT INTO pt_addresses 
                            (full_street, ART_DESIG, cc_desig, CP4, CP3, CPALF, LATITUDE, LONGITUDE, quality_score, match_type, source, last_validated)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'MANUAL_EXACT', 'CORRECAO_UTILIZADOR', ?)
                        """, (
                            corr.morada,
                            corr.morada,
                            corr.concelho or "",
                            cp4_str,
                            cp3_str,
                            cp_raw,
                            corr.latitude,
                            corr.longitude,
                            datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                        ))
                        geo_conn.commit()
                except Exception as geo_err:
                    print(f"[AVISO] Não foi possível persistir endereço em geocoding.db: {geo_err}")

            cursor.execute("SELECT e.projeto_id, e.codigo_cliente, e.nome_cliente, e.peso_kg, e.volume_m3, e.janela_inicio, e.janela_fim FROM entregas e WHERE e.id = ?", (delivery_id,))
            deliv_info = cursor.fetchone()
            if deliv_info:
                proj_id = deliv_info["projeto_id"]
                client_code = deliv_info["codigo_cliente"]
                
                cursor.execute("SELECT id, payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (proj_id,))
                snap_row = cursor.fetchone()
                if snap_row and snap_row["payload_json"]:
                    try:
                        state_dict = deserialize_state(snap_row["payload_json"])
                        raw_routes = state_dict.get("routes_solution")
                        if raw_routes is not None:
                            df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
                            if not df_routes.empty:
                                c_idx = []
                                if "id" in df_routes.columns:
                                    c_idx = df_routes[df_routes["id"] == delivery_id].index
                                if len(c_idx) == 0 and "ID_Original" in df_routes.columns:
                                    c_idx = df_routes[df_routes["ID_Original"] == delivery_id].index
                                if len(c_idx) == 0 and "Cliente" in df_routes.columns:
                                    c_idx = df_routes[df_routes["Cliente"].astype(str).str.strip().str.upper() == str(client_code).strip().upper()].index
                                
                                if len(c_idx) > 0:
                                    df_routes.loc[c_idx, "Latitude"] = corr.latitude
                                    df_routes.loc[c_idx, "Longitude"] = corr.longitude
                                    df_routes.loc[c_idx, "Morada"] = corr.morada
                                    df_routes.loc[c_idx, "Localidade"] = corr.concelho
                                    df_routes.loc[c_idx, "CP"] = corr.codigo_postal
                                else:
                                    # Append as Por Distribuir
                                    new_stop = {
                                        "id": delivery_id,
                                        "ID_Original": delivery_id,
                                        "Rota": "Por Distribuir",
                                        "Armazem": "N/A",
                                        "Ordem": len(df_routes) + 1,
                                        "Cliente": str(client_code),
                                        "Nome_Cliente": str(deliv_info["nome_cliente"] or client_code),
                                        "Morada": str(corr.morada),
                                        "CP": str(corr.codigo_postal),
                                        "Localidade": str(corr.concelho),
                                        "Janela_Horaria": f"{deliv_info['janela_inicio']} - {deliv_info['janela_fim']}" if (deliv_info.get("janela_inicio") and deliv_info.get("janela_fim")) else "Qualquer",
                                        "Latitude": corr.latitude,
                                        "Longitude": corr.longitude,
                                        "Chegada": "00:00",
                                        "Tempo_Espera": 0,
                                        "Tempo_Entrega": 0,
                                        "Saida": "00:00",
                                        "Nivel_Qualidade": 1,
                                        "KM_Anterior": 0.0,
                                        "Dist_Acum": 0.0,
                                        "Peso_KG": float(deliv_info.get("peso_kg") or 50.0),
                                        "Carga_Acum": round(float(deliv_info.get("peso_kg") or 50.0), 1),
                                        "Carga_Vol_Acum": round(float(deliv_info.get("volume_m3") or 0.1), 2)
                                    }
                                    df_routes = pd.concat([df_routes, pd.DataFrame([new_stop])], ignore_index=True)
                                    
                                state_dict["routes_solution"] = df_routes
                                new_payload = serialize_state(state_dict)
                                cursor.execute("UPDATE snapshots SET payload_json = ? WHERE id = ?", (new_payload, snap_row["id"]))
                    except Exception as snap_e:
                        print(f"Error updating snapshot coords: {snap_e}")

            conn.commit()

            

            try:

                db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), DB_GEO_PATH)

                geocoder = WaterfallGeocoder(db_path)

                learned_entry = {

                    "result": {

                        "address": corr.morada,

                        "lat": corr.latitude,

                        "lon": corr.longitude,

                        "quality_level": 1,

                        "match_type": "MANUAL",

                        "source": "CORRECAO_MANUAL",

                        "google_place_id": None

                    },

                    "cp4": corr.codigo_postal[:4] if len(corr.codigo_postal) >= 4 else "",

                    "concelho": corr.concelho

                }

                geocoder.save_learned_batch([learned_entry])

            except Exception as e:

                print(f"Error saving learned batch: {e}")

                

            return {"status": "success", "message": "Geocodificação corrigida e guardada no sistema."}

    except HTTPException as he:

        raise he

    except Exception as e:

        raise HTTPException(status_code=500, detail=str(e))





@router.get("/export/{project_id}")

def export_geocoding_results(

    project_id: int,

    type: str,

    current_user: UserResponse = Depends(get_current_user)

):

    proj = get_projeto(project_id)

    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):

        raise HTTPException(status_code=403, detail="Não tem permissão para aceder a este projeto.")

        

    try:

        with get_db() as conn:

            cursor = conn.cursor()

            cursor.execute("SELECT * FROM entregas WHERE projeto_id = ? ORDER BY id ASC", (project_id,))

            rows = cursor.fetchall()

            

        if not rows:

            raise HTTPException(status_code=400, detail="Não existem clientes carregados para exportar.")

            

        df_rows = []

        for r in rows:

            df_rows.append({

                "Codigo_Cliente": r["codigo_cliente"],

                "Morada": r["morada"],

                "Codigo_Postal": r["codigo_postal"],

                "Concelho": r["_concelho"],

                "Peso_KG": r["peso_kg"],

                "Volume_m3": r["volume_m3"],

                "Latitude": r["latitude"],

                "Longitude": r["longitude"],

                "Nivel_Qualidade": r["nivel_qualidade"],

                "Fonte": r["fonte_match"],

                "Morada_Encontrada": r["morada_encontrada"]

            })

        df = pd.DataFrame(df_rows)

        

        output = io.BytesIO()

        

        if type == "success":

            df_success = df[df["Nivel_Qualidade"] < 8].copy()

            if df_success.empty:

                raise HTTPException(status_code=400, detail="Não existem clientes georreferenciados com sucesso para exportar.")

            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:

                df_success.to_excel(writer, index=False, sheet_name='Geocodificados')

            filename = f"clientes_georreferenciados_{project_id}.xlsx"

            

        elif type == "failed":

            df_failed = df[(df["Nivel_Qualidade"] == 99) | (df["Latitude"] == 0.0) | (df["Longitude"] == 0.0)].copy()

            if df_failed.empty:

                raise HTTPException(status_code=400, detail="Não existem falhas de georreferenciação para exportar.")

                

            df_failed["Motivo_Falha"] = df_failed.apply(

                lambda row: get_failure_reason(row["Morada"], row["Codigo_Postal"], row["Concelho"], row["Latitude"], row["Longitude"], row["Nivel_Qualidade"]),

                axis=1

            )

            df_failed["Sugestao_Correcao"] = ""

            

            cols = list(df_failed.columns)

            priority_cols = ['Codigo_Cliente', 'Morada', 'Codigo_Postal', 'Concelho', 'Motivo_Falha', 'Sugestao_Correcao']

            other_cols = [c for c in cols if c not in priority_cols]

            df_failed = df_failed[priority_cols + other_cols]

            

            with pd.ExcelWriter(output, engine='xlsxwriter') as writer:

                df_failed.to_excel(writer, index=False, sheet_name='Falhas')

                

                workbook = writer.book

                ws_instructions = workbook.add_worksheet('Como Corrigir')

                

                instructions_data = [

                    ['Instrucoes para Correcao de Enderecos'],

                    ['1. Corrija os dados nas colunas Morada, Codigo_Postal e Concelho nesta folha.'],

                    ['2. Certifique-se que todos os campos obrigatorios estao preenchidos.'],

                    ['3. Use o formato CP7 (1000-001) sempre que possivel para maior precisao.'],

                    ['4. Normalize os nomes dos concelhos (ex: Lisboa, Porto, Braga).'],

                    ['5. Evite abreviaturas (ex: Rua em vez de R.).'],

                    ['6. Apos a correcao, guarde o ficheiro e volte a importa-lo na aplicacao.']

                ]

                

                for idx, row in enumerate(instructions_data):

                    ws_instructions.write(idx, 0, row[0])

                    

            filename = f"falhas_georreferenciacao_{project_id}.xlsx"

            

        else:

            raise HTTPException(status_code=400, detail="Tipo de exportação inválido.")

            

        output.seek(0)

        

        headers = {

            'Content-Disposition': f'attachment; filename="{filename}"'

        }

        return StreamingResponse(
            output,
            media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            headers=headers
        )

        

    except HTTPException as he:

        raise he

    except Exception as e:

        raise HTTPException(status_code=500, detail=f"Erro ao exportar ficheiro: {str(e)}")




@router.delete("/delivery/{delivery_id}")
def delete_delivery(delivery_id: int, current_user: UserResponse = Depends(get_current_user)):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            
            # Check owner
            cursor.execute("""
                SELECT e.id, e.projeto_id, p.empresa_id, e.codigo_cliente
                FROM entregas e 
                JOIN projetos p ON e.projeto_id = p.id 
                WHERE e.id = ?
            """, (delivery_id,))
            row = cursor.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Entrega não encontrada.")
            if row["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
                raise HTTPException(status_code=403, detail="Não tem permissão para eliminar esta entrega.")
                
            proj_id = row["projeto_id"]
            client_code = row["codigo_cliente"]
            
            # Delete from deliveries table
            cursor.execute("DELETE FROM entregas WHERE id = ?", (delivery_id,))
            
            # Remove from the latest snapshot if it exists
            cursor.execute("SELECT id, payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (proj_id,))
            snap_row = cursor.fetchone()
            if snap_row and snap_row["payload_json"]:
                try:
                    from utils.snapshot_serializer import deserialize_state, serialize_state
                    import pandas as pd
                    state_dict = deserialize_state(snap_row["payload_json"])
                    raw_routes = state_dict.get("routes_solution")
                    if raw_routes is not None:
                        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
                        if not df_routes.empty:
                            # Filter out this stop
                            c_idx = []
                            if "id" in df_routes.columns:
                                c_idx = df_routes[df_routes["id"] == delivery_id].index
                            if len(c_idx) == 0 and "ID_Original" in df_routes.columns:
                                c_idx = df_routes[df_routes["ID_Original"] == delivery_id].index
                            if len(c_idx) == 0 and "Cliente" in df_routes.columns:
                                c_idx = df_routes[df_routes["Cliente"].astype(str).str.strip().str.upper() == str(client_code).strip().upper()].index
                                
                            if len(c_idx) > 0:
                                df_routes = df_routes.drop(c_idx).reset_index(drop=True)
                                # Recalculate stop orders for safety
                                df_routes["Ordem"] = range(1, len(df_routes) + 1)
                                state_dict["routes_solution"] = df_routes
                                new_payload = serialize_state(state_dict)
                                cursor.execute("UPDATE snapshots SET payload_json = ? WHERE id = ?", (new_payload, snap_row["id"]))
                except Exception as snap_e:
                    print(f"Error updating snapshot during delete: {snap_e}")
                    
            conn.commit()
            return {"status": "success", "message": "Entrega eliminada com sucesso."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
