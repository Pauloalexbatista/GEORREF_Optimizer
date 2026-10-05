import json
import math
import sqlite3
import os
from typing import List, Dict, Any, Optional
import pandas as pd
from utils.validation_auditor import haversine_distance

DB_GEO_PATH = os.getenv("DB_GEO_PATH", "geocoding.db")
_CP_CENTROIDS_CACHE = None

def get_cp_centroids_cache(db_path: str = None) -> Dict[str, tuple]:
    global _CP_CENTROIDS_CACHE
    if _CP_CENTROIDS_CACHE is not None:
        return _CP_CENTROIDS_CACHE
    
    path = db_path or DB_GEO_PATH
    if not os.path.exists(path) and os.path.exists("/app/data/geocoding.db"):
        path = "/app/data/geocoding.db"

    cache = {}
    try:
        conn = sqlite3.connect(path)
        c = conn.cursor()
        c.execute("SELECT CP4, AVG(LATITUDE), AVG(LONGITUDE) FROM pt_addresses WHERE LATITUDE != 0 AND LONGITUDE != 0 GROUP BY CP4")
        for row in c.fetchall():
            if row[0] and row[1] and row[2]:
                cache[str(row[0]).strip()] = (float(row[1]), float(row[2]))
        conn.close()
    except Exception as e:
        print(f"[Aviso] Falha ao carregar centroides de CP: {e}")
    
    _CP_CENTROIDS_CACHE = cache
    return cache

def detect_geographic_outliers(
    deliveries_list: List[Dict[str, Any]],
    warehouses_list: List[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    Audita clientes genuinamente mal georreferenciados comparando as coordenadas
    reais com o centroide oficial do seu Código Postal (BD canónica geocoding.db).
    NUNCA usa distâncias arbitrárias ao armazém para evitar falsos positivos
    em rotas longas, transfronteiriças ou regionais.
    """
    if not deliveries_list:
        return []

    cp_centroids = get_cp_centroids_cache()
    outliers = []

    for d in deliveries_list:
        try:
            lat = float(d.get("Latitude") or d.get("latitude") or 0.0)
            lon = float(d.get("Longitude") or d.get("longitude") or 0.0)
            if lat == 0.0 or lon == 0.0:
                continue

            cp = str(d.get("CP") or d.get("codigo_postal") or "").strip()
            cp4 = cp.split("-")[0].strip()
            morada = str(d.get("Morada") or d.get("morada") or "").strip()
            localidade = str(d.get("Localidade") or d.get("concelho") or "").strip()
            rota = str(d.get("Rota") or d.get("rota") or "")
            c_nome = d.get("Cliente") or d.get("Nome_Cliente") or d.get("nome_cliente") or f"Cliente #{d.get('id')}"

            # Verificar coerência contra a nossa base de dados oficial de Códigos Postais
            if cp4 in cp_centroids:
                expected_lat, expected_lon = cp_centroids[cp4]
                dist_cp_km = haversine_distance(lat, lon, expected_lat, expected_lon)

                # Se estiver a mais de 35 km do centroide do seu Código Postal, há erro de geocodificação
                if dist_cp_km > 35.0:
                    outliers.append({
                        "id": d.get("id") or d.get("ID_Original") or d.get("codigo_cliente"),
                        "cliente": str(c_nome),
                        "morada": morada,
                        "cp": cp,
                        "localidade": localidade,
                        "rota_atual": rota,
                        "lat": round(lat, 6),
                        "lon": round(lon, 6),
                        "dist_km_armazem": round(dist_cp_km, 1), # Usado no UI para mostrar o desvio do CP
                        "motivo_suspeita": f"Incoerência com Código Postal {cp}: as coordenadas atuais estão a {int(dist_cp_km)} km da zona oficial do seu CP."
                    })
        except Exception:
            continue

    outliers.sort(key=lambda x: x["dist_km_armazem"], reverse=True)
    return outliers

def analyze_unassigned_clustering(
    routes_solution: Any,
    warehouses_list: List[Dict[str, Any]] = None
) -> Dict[str, Any]:
    if isinstance(routes_solution, pd.DataFrame):
        df = routes_solution.copy()
    elif routes_solution:
        df = pd.DataFrame(routes_solution).copy()
    else:
        df = pd.DataFrame()

    if df.empty:
        return {"total_unassigned": 0, "near_depot_count": 0, "far_depot_count": 0, "near_depot": [], "far_depot": []}

    col_map = {c.lower(): c for c in df.columns}
    rota_col = col_map.get("rota") or col_map.get("veiculo") or col_map.get("assigned_vehicle") or "Rota"
    if rota_col not in df.columns:
        df["Rota"] = "Por Distribuir"
        rota_col = "Rota"

    unassigned_tokens = [
        "por distribuir", "por_distribuir", "por identificar", "por_identificar",
        "não atribuído", "nao atribuido", "nao_atribuido", "unassigned",
        "pendente", "nan", "", "none", "0", "-1"
    ]
    unassigned_mask = df[rota_col].astype(str).str.strip().str.lower().isin(unassigned_tokens)
    unassigned_df = df[unassigned_mask].copy()

    return {
        "total_unassigned": len(unassigned_df),
        "near_depot_count": 0,
        "far_depot_count": len(unassigned_df),
        "near_depot": [],
        "far_depot": []
    }
