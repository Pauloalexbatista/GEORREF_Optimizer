from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from pydantic import BaseModel
from typing import List, Optional
import sqlite3
import math
import os
DB_MULTI_PATH = os.getenv("DB_MULTI_PATH", DB_MULTI_PATH)
DB_GEO_PATH = os.getenv("DB_GEO_PATH", DB_GEO_PATH)


import json
import urllib.request
import urllib.parse
import re
import pandas as pd
import io
import unicodedata
from backend.api.auth import get_current_user, UserResponse

router = APIRouter()

DB_GEO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', DB_GEO_PATH)
DB_MULTI_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', DB_MULTI_PATH)
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'cache_geoapi')

os.makedirs(CACHE_DIR, exist_ok=True)

def get_geo_db():
    conn = sqlite3.connect(DB_GEO_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_multi_db():
    conn = sqlite3.connect(DB_MULTI_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db_tables():
    conn = get_multi_db()
    try:
        c = conn.cursor()
        c.execute("""
            CREATE TABLE IF NOT EXISTS custom_maps (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id INTEGER NOT NULL,
                nome TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """).execute("""
            CREATE TABLE IF NOT EXISTS custom_map_regions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                map_id INTEGER NOT NULL,
                zona TEXT NOT NULL,
                cp TEXT NOT NULL,
                cor TEXT NOT NULL,
                concelho TEXT,
                distrito TEXT,
                freguesia TEXT,
                FOREIGN KEY (map_id) REFERENCES custom_maps (id) ON DELETE CASCADE
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db_tables()

class RegionSchema(BaseModel):
    zona: str
    cp: str
    cor: str
    concelho: Optional[str] = None
    distrito: Optional[str] = None
    freguesia: Optional[str] = None

class MapSaveRequest(BaseModel):
    id: Optional[str] = None
    nome: str
    mapeamentos: List[RegionSchema]

def clean_name(name):
    if not name: return ""
    # Normalize unicode to remove accents, lowercase and remove punctuation
    n = ''.join(c for c in unicodedata.normalize('NFD', name) if unicodedata.category(c) != 'Mn')
    n = n.lower()
    n = re.sub(r'[^a-z0-9\s]', ' ', n)
    return ' '.join(n.split())

def get_concelho_freguesias(concelho_name):
    cache_file = os.path.join(CACHE_DIR, f"{clean_name(concelho_name)}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
            
    # Fetch from geoapi.pt
    municipio_escaped = urllib.parse.quote(concelho_name)
    url = f'https://json.geoapi.pt/municipio/{municipio_escaped}/freguesias'
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            data = json.loads(r.read())
            freg_features = data.get('geojsons', {}).get('freguesias', [])
            # Cache locally
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(freg_features, f, ensure_ascii=False)
            return freg_features
    except Exception as e:
        print(f"Failed to fetch freguesias for {concelho_name}: {e}")
        return []



def log_unresolved_postcode(cp: str, error_msg: str, country: str):
    conn = get_multi_db()
    try:
        c = conn.cursor()
        c.execute(
            "INSERT OR REPLACE INTO unresolved_postcodes (cp, error_message, country) VALUES (?, ?, ?)",
            (cp.strip(), error_msg, country)
        )
        conn.commit()
    except Exception as e:
        print(f"Failed to log unresolved postcode {cp}: {e}")
    finally:
        conn.close()

def get_spanish_cp_info(cp5: str):
    # Step 1: Check database cache first
    conn = get_multi_db()
    try:
        c = conn.cursor()
        c.execute(
            "SELECT distrito, concelho, freguesia, latitude, longitude FROM cached_geocoding WHERE cp = ? AND country = 'ES'",
            (cp5.strip(),)
        )
        row = c.fetchone()
        if row:
            return {
                "cp4": cp5.strip(),
                "distrito": row[0],
                "concelho": row[1],
                "freguesia": row[2],
                "lat": row[3],
                "lon": row[4]
            }
    except Exception as e:
        print(f"Database lookup failed for ES CP {cp5}: {e}")
    finally:
        conn.close()
            
    # Step 2: Try Zippopotam API
    url = f"https://api.zippopotam.us/es/{cp5.strip()}"
    info = None
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
            places = data.get('places', [])
            
            valid_p = None
            for p in places:
                lat_str = p.get('latitude')
                lon_str = p.get('longitude')
                if lat_str and lon_str:
                    try:
                        float(lat_str)
                        float(lon_str)
                        valid_p = p
                        break
                    except ValueError:
                        continue
                        
            if valid_p:
                info = {
                    "cp4": cp5.strip(),
                    "distrito": valid_p.get('state', ''),
                    "concelho": valid_p.get('place name', ''),
                    "freguesia": "",
                    "lat": float(valid_p.get('latitude')),
                    "lon": float(valid_p.get('longitude'))
                }
    except Exception as e:
        print(f"Zippopotam failed for ES CP {cp5}: {e}")
        
    # Step 3: Fallback to Nominatim API
    if not info:
        try:
            url_nom = f"https://nominatim.openstreetmap.org/search?postalcode={cp5.strip()}&country=Spain&format=json"
            req_nom = urllib.request.Request(url_nom, headers={'User-Agent': 'AntigravityGeocodingApp/1.0'})
            with urllib.request.urlopen(req_nom, timeout=5) as r:
                data = json.loads(r.read())
                if data:
                    first = data[0]
                    disp = first.get('display_name', '')
                    parts = [p.strip() for p in disp.split(',')]
                    concelho = parts[1] if len(parts) > 1 else parts[0]
                    distrito = parts[2] if len(parts) > 2 else ""
                    
                    info = {
                        "cp4": cp5.strip(),
                        "distrito": distrito,
                        "concelho": concelho,
                        "freguesia": "",
                        "lat": float(first.get('lat')),
                        "lon": float(first.get('lon'))
                    }
        except Exception as e:
            print(f"Nominatim fallback failed for ES CP {cp5}: {e}")
            
    # Step 4: Write to database cache if found
    if not info:
        log_unresolved_postcode(cp5, "Spanish CP not found in Zippopotam and Nominatim APIs", "ES")
    if info:
        conn = get_multi_db()
        try:
            c = conn.cursor()
            c.execute(
                "INSERT OR REPLACE INTO cached_geocoding (cp, distrito, concelho, freguesia, latitude, longitude, country) VALUES (?, ?, ?, ?, ?, ?, 'ES')",
                (cp5.strip(), info["distrito"], info["concelho"], info["freguesia"], info["lat"], info["lon"])
            )
            conn.commit()
        except Exception as e:
            print(f"Failed to save ES CP {cp5} to database: {e}")
        finally:
            conn.close()
            
    return info

def make_circle_geometry(lat, lon, cp):
    radius = 0.015
    circle_points = [
        [lon + radius * math.cos(math.radians(a)), lat + radius * math.sin(math.radians(a))]
        for a in range(0, 361, 10)
    ]
    return {
        "type": "Feature",
        "properties": {"CP4": cp},
        "geometry": {"type": "Polygon", "coordinates": [circle_points]}
    }

def get_fallback_circle(cp4):
    conn = get_geo_db()
    try:
        c = conn.cursor()
        c.execute(
            "SELECT LONGITUDE, LATITUDE FROM pt_addresses WHERE CP4 = ? AND LATITUDE != 0 AND LONGITUDE != 0 LIMIT 100",
            (cp4.strip(),)
        )
        rows = c.fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="CP4 not found")
        points = [(r[0], r[1]) for r in rows]
        lon = sum(p[0] for p in points) / len(points)
        lat = sum(p[1] for p in points) / len(points)
        radius = 0.005
        circle_points = [
            [lon + radius * math.cos(math.radians(a)), lat + radius * math.sin(math.radians(a))]
            for a in range(0, 361, 10)
        ]
        return {
            "type": "Feature",
            "properties": {"CP4": cp4},
            "geometry": {"type": "Polygon", "coordinates": [circle_points]}
        }
    finally:
        conn.close()

@router.get("/api/maps/cp4-polygon/{cp4}")
def get_cp4_polygon(cp4: str):
    cp_clean = cp4.strip()
    if len(cp_clean) == 5:
        es_info = get_spanish_cp_info(cp_clean)
        if es_info:
            return make_circle_geometry(es_info["lat"], es_info["lon"], cp_clean)
            
    conn = get_geo_db()
    try:
        c = conn.cursor()
        # Find which concelhos and freguesias this CP4 touches
        c.execute(
            "SELECT cc_desig, CPALF, COUNT(*) as cnt FROM pt_addresses WHERE CP4 = ? GROUP BY cc_desig, CPALF ORDER BY cnt DESC",
            (cp4.strip(),)
        )
        rows = c.fetchall()
        if not rows:
            log_unresolved_postcode(cp4, "Portuguese CP4 not found in CTT address database", "PT")
            return get_fallback_circle(cp4)
            
        concelho_db = rows[0][0].strip()
        freg_features = get_concelho_freguesias(concelho_db)
        if not freg_features:
            return get_fallback_circle(cp4)
            
        matched_features = []
        matched_ids = set()
        
        for row in rows:
            freg_db = row[1].strip() if row[1] else ""
            if not freg_db: continue
            
            freg_db_clean = clean_name(freg_db)
            
            for feature in freg_features:
                props = feature.get('properties', {})
                fid = props.get('Dicofre') or props.get('id')
                if fid in matched_ids:
                    continue
                    
                freg_geojson = props.get('freguesia', '')
                freg_geojson_clean = clean_name(freg_geojson)
                
                db_words = set(freg_db_clean.split())
                geo_words = set(freg_geojson_clean.split())
                filler = {'de', 'do', 'da', 'dos', 'das', 'e', 'uniao', 'freguesias', 'paroquia', 'nossa', 'senhora', 'sao', 'santa', 'santo'}
                db_keywords = db_words - filler
                geo_keywords = geo_words - filler
                
                is_match = False
                if freg_db_clean == freg_geojson_clean:
                    is_match = True
                elif freg_db_clean in freg_geojson_clean or freg_geojson_clean in freg_db_clean:
                    is_match = True
                elif db_keywords and db_keywords.intersection(geo_keywords):
                    is_match = True
                    
                if is_match:
                    # Inject CP4 property so Leaflet layer retains the info
                    feature['properties']['CP4'] = cp4
                    matched_features.append(feature)
                    if fid: matched_ids.add(fid)
                    
        if not matched_features:
            return get_fallback_circle(cp4)
            
        return {
            "type": "FeatureCollection",
            "features": matched_features
        }
    except Exception as e:
        print(f"Error resolving CP4 polygon: {e}")
        return get_fallback_circle(cp4)
    finally:
        conn.close()

@router.post("/api/maps/save")
def save_map(req: MapSaveRequest, current_user: UserResponse = Depends(get_current_user)):
    conn = get_multi_db()
    try:
        c = conn.cursor()
        map_id = None
        if req.id:
            c.execute("SELECT id FROM custom_maps WHERE id = ? AND empresa_id = ?", (req.id, current_user.empresa_id))
            row = c.fetchone()
            if row:
                map_id = row[0]
                c.execute("UPDATE custom_maps SET nome = ? WHERE id = ?", (req.nome, map_id))
                c.execute("DELETE FROM custom_map_regions WHERE map_id = ?", (map_id,))
        if not map_id:
            c.execute("INSERT INTO custom_maps (empresa_id, nome) VALUES (?, ?)", (current_user.empresa_id, req.nome))
            map_id = c.lastrowid
        for m in req.mapeamentos:
            c.execute(
                "INSERT INTO custom_map_regions (map_id, zona, cp, cor, concelho, distrito, freguesia) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (map_id, m.zona, m.cp, m.cor, m.concelho, m.distrito, m.freguesia)
            )
        conn.commit()
        return {"status": "success", "id": str(map_id)}
    finally:
        conn.close()

@router.get("/api/maps/list")
def list_maps(current_user: UserResponse = Depends(get_current_user)):
    conn = get_multi_db()
    try:
        c = conn.cursor()
        c.execute("SELECT id, nome, created_at FROM custom_maps WHERE empresa_id = ? ORDER BY created_at DESC", (current_user.empresa_id,))
        rows = c.fetchall()
        return [{"id": str(row[0]), "nome": row[1], "created_at": row[2]} for row in rows]
    finally:
        conn.close()

@router.get("/api/maps/{map_id}")
def get_map(map_id: int, current_user: UserResponse = Depends(get_current_user)):
    conn = get_multi_db()
    try:
        c = conn.cursor()
        c.execute("SELECT id, nome, empresa_id FROM custom_maps WHERE id = ?", (map_id,))
        map_row = c.fetchone()
        if not map_row:
            raise HTTPException(status_code=404, detail="Map not found")
        if map_row[2] != current_user.empresa_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        c.execute("SELECT zona, cp, cor, concelho, distrito, freguesia FROM custom_map_regions WHERE map_id = ?", (map_id,))
        regions = c.fetchall()
        return {
            "id": str(map_row[0]),
            "nome": map_row[1],
            "mapeamentos": [{"zona": r[0], "cp": r[1], "cor": r[2], "concelho": r[3], "distrito": r[4], "freguesia": r[5]} for r in regions]
        }
    finally:
        conn.close()

@router.delete("/api/maps/{map_id}")
def delete_map(map_id: int, current_user: UserResponse = Depends(get_current_user)):
    conn = get_multi_db()
    try:
        c = conn.cursor()
        c.execute("SELECT id, empresa_id FROM custom_maps WHERE id = ?", (map_id,))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Map not found")
        if row[1] != current_user.empresa_id:
            raise HTTPException(status_code=403, detail="Forbidden")
        c.execute("DELETE FROM custom_maps WHERE id = ?", (map_id,))
        c.execute("DELETE FROM custom_map_regions WHERE map_id = ?", (map_id,))
        conn.commit()
        return {"status": "success"}
    finally:
        conn.close()

@router.post("/api/maps/upload-excel")
async def upload_excel(file: UploadFile = File(...), current_user: UserResponse = Depends(get_current_user)):
    contents = await file.read()
    df = pd.read_excel(io.BytesIO(contents))
    cp_col, zona_col = None, None
    for col in df.columns:
        c_low = str(col).lower().strip()
        if any(x in c_low for x in ['cp4', 'cp', 'codigo postal', 'código postal', 'postal', 'zip', 'cod_postal']):
            cp_col = col
            break
    for col in df.columns:
        if col == cp_col: continue
        c_low = str(col).lower().strip()
        if any(x in c_low for x in ['zona', 'zone', 'regiao', 'região', 'region', 'area', 'área', 'name', 'nome', 'distrito', 'concelho', 'freguesia']):
            zona_col = col
            break
    if cp_col is None: cp_col = df.columns[0]
    if zona_col is None or zona_col == cp_col:
        remaining = [c for c in df.columns if c != cp_col]
        zona_col = remaining[0] if remaining else cp_col
        
    presets = [
        "#ef4444","#f97316","#eab308","#22c55e","#14b8a6",
        "#3b82f6","#8b5cf6","#ec4899","#f43f5e","#06b6d4",
        "#84cc16","#a855f7","#f59e0b","#10b981","#6366f1"
    ]
    
    raw_rows = []
    unique_cps = set()
    for _, row in df.iterrows():
        cp_val = str(row[cp_col]).strip()
        zona_val = str(row[zona_col]).strip()
        cp_digits = ''.join(filter(str.isdigit, cp_val))
        if len(cp_digits) == 5:
            pass
        elif len(cp_digits) >= 4:
            cp_digits = cp_digits[:4]
        else:
            continue
        raw_rows.append((zona_val, cp_digits))
        unique_cps.add(cp_digits)

    cp_info_cache = {}
    if unique_cps:
        conn = get_geo_db()
        try:
            pt_cps = [c for c in unique_cps if len(c) == 4]
            es_cps = [c for c in unique_cps if len(c) == 5]
            
            # Look up Portuguese CPs in batch
            if pt_cps:
                c = conn.cursor()
                c.execute(
                    "SELECT CP4, dd_desig, cc_desig, CPALF FROM pt_addresses WHERE CP4 IN ({}) GROUP BY CP4".format(','.join('?' * len(pt_cps))),
                    pt_cps
                )
                for r in c.fetchall():
                    cp_info_cache[r[0]] = {
                        "distrito": r[1].strip() if r[1] else "",
                        "concelho": r[2].strip() if r[2] else "",
                        "freguesia": r[3].strip() if r[3] else ""
                    }
            
            # Look up Spanish CPs
            for escp in es_cps:
                es_info = get_spanish_cp_info(escp)
                if es_info:
                    cp_info_cache[escp] = {
                        "distrito": es_info["distrito"],
                        "concelho": es_info["concelho"],
                        "freguesia": ""
                    }
        finally:
            conn.close()

    mapeamentos = []
    zona_colors = {}
    color_index = 0
    
    for zona_val, cp_digits in raw_rows:
        if zona_val not in zona_colors:
            zona_colors[zona_val] = presets[color_index % len(presets)]
            color_index += 1
            
        info = cp_info_cache.get(cp_digits, {"concelho": "", "distrito": "", "freguesia": ""})
        mapeamentos.append({
            "zona": zona_val,
            "cp": cp_digits,
            "cor": zona_colors[zona_val],
            "concelho": info["concelho"],
            "distrito": info["distrito"],
            "freguesia": info["freguesia"]
        })
        
    return {"mapeamentos": mapeamentos}

@router.get("/api/maps/cp4-info/{cp4}")
def get_cp4_info(cp4: str):
    cp_clean = cp4.strip()
    if len(cp_clean) == 5:
        es_info = get_spanish_cp_info(cp_clean)
        if es_info:
            return es_info
            
    conn = get_geo_db()
    try:
        c = conn.cursor()
        c.execute(
            "SELECT dd_desig, cc_desig, CPALF FROM pt_addresses WHERE CP4 = ? LIMIT 1",
            (cp4.strip(),)
        )
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"CP4 {cp4} not found")
        return {
            "cp4": cp4,
            "distrito": row[0].strip() if row[0] else "",
            "concelho": row[1].strip() if row[1] else "",
            "freguesia": row[2].strip() if row[2] else ""
        }
    finally:
        conn.close()

from fastapi.responses import StreamingResponse

class ExportExcelRequest(BaseModel):
    mapeamentos: List[RegionSchema]

@router.post("/api/maps/export-excel")
def export_excel(req: ExportExcelRequest):
    data = []
    for m in req.mapeamentos:
        data.append({
            "Zona": m.zona,
            "Código Postal": m.cp,
            "Cor": m.cor,
            "Concelho": m.concelho or "",
            "Distrito": m.distrito or "",
            "Freguesia": m.freguesia or ""
        })
    df = pd.DataFrame(data)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Zonas e CPs')
    output.seek(0)
    headers = {'Content-Disposition': 'attachment; filename="mapeamento_zonas.xlsx"'}
    return StreamingResponse(output, headers=headers, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
