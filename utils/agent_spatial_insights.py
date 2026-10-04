import json
import math
import requests
from typing import List, Dict, Any, Optional
import pandas as pd
from utils.validation_auditor import haversine_distance, parse_time_to_minutes, minutes_to_time_str

def detect_geographic_outliers(
    deliveries_list: List[Dict[str, Any]],
    warehouses_list: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Deteta paragens que estao geometricamente anomalas ou isoladas
    (ex: ponto a mais de 100km do armazem ou a grande distancia do cluster principal).
    """
    if not deliveries_list:
        return []

    # Coordenadas do armazem principal
    depot_lat, depot_lon = 38.7436, -9.1602 # Lisboa default
    if warehouses_list:
        w0 = warehouses_list[0]
        try:
            depot_lat = float(w0.get("Latitude") or w0.get("latitude") or depot_lat)
            depot_lon = float(w0.get("Longitude") or w0.get("longitude") or depot_lon)
        except Exception:
            pass

    outliers = []
    for d in deliveries_list:
        try:
            lat = float(d.get("Latitude") or d.get("latitude") or 0.0)
            lon = float(d.get("Longitude") or d.get("longitude") or 0.0)
            if lat == 0.0 or lon == 0.0:
                continue

            dist_depot = haversine_distance(depot_lat, depot_lon, lat, lon)
            
            # Se esta a mais de 120km do armazem central ou muito acima/abaixo do cluster
            # (Exemplo tipico: entrega de Lisboa que caiu no Minho por erro de CP)
            localidade = str(d.get("Localidade") or d.get("concelho") or "").strip().lower()
            cp = str(d.get("CP") or d.get("codigo_postal") or "")
            morada = str(d.get("Morada") or d.get("morada") or "")

            # Heuristica de desvio: morada de Lisboa/Setubal/Sintra mas coordenada no Norte (lat > 41.0)
            is_suspicious_geo = False
            suspect_reason = ""

            if dist_depot > 120.0:
                if any(k in localidade or k in morada.lower() for k in ["lisboa", "sintra", "cascais", "oeiras", "amadora", "loures", "almada", "setubal"]):
                    is_suspicious_geo = True
                    suspect_reason = f"Morada refere zona da Grande Lisboa mas as coordenadas estao a {int(dist_depot)} km (possivel erro de codigo postal)."
                elif lat > 41.0 and depot_lat < 39.5:
                    is_suspicious_geo = True
                    suspect_reason = f"Ponto isolado no Norte ({int(dist_depot)} km do armazem principal)."

            if is_suspicious_geo or dist_depot > 180.0:
                outliers.append({
                    "id": d.get("id") or d.get("ID_Original"),
                    "cliente": d.get("Cliente") or d.get("Nome_Cliente") or d.get("nome_cliente"),
                    "morada": morada,
                    "cp": cp,
                    "localidade": localidade,
                    "lat": lat,
                    "lon": lon,
                    "dist_km_armazem": round(dist_depot, 1),
                    "motivo_suspeita": suspect_reason or f"Distancia anormalmente elevada ao centro de operacoes ({int(dist_depot)} km)"
                })
        except Exception:
            continue

    return outliers


def analyze_unassigned_clustering(
    routes_solution: Any,
    warehouses_list: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Analisa os clientes em 'Por Distribuir': quais estao perto do armazem (<15km)
    vs quais estao longe ou isolados.
    """
    if isinstance(routes_solution, pd.DataFrame):
        df = routes_solution.copy()
    elif routes_solution:
        df = pd.DataFrame(routes_solution).copy()
    else:
        df = pd.DataFrame()

    if df.empty:
        return {"total_unassigned": 0, "near_depot": [], "far_depot": []}

    depot_lat, depot_lon = 38.7436, -9.1602
    if warehouses_list:
        w0 = warehouses_list[0]
        try:
            depot_lat = float(w0.get("Latitude") or w0.get("latitude") or depot_lat)
            depot_lon = float(w0.get("Longitude") or w0.get("longitude") or depot_lon)
        except Exception:
            pass

    col_map = {c.lower(): c for c in df.columns}
    rota_col = col_map.get("rota", "Rota")
    unassigned_mask = df[rota_col].astype(str).str.strip().str.lower().isin(["por distribuir", "pendente", "nan", "", "none"])
    unassigned_df = df[unassigned_mask].copy()

    near = []
    far = []

    for idx, row in unassigned_df.iterrows():
        try:
            lat = float(row.get(col_map.get("latitude", "Latitude"), 0.0))
            lon = float(row.get(col_map.get("longitude", "Longitude"), 0.0))
            d_km = haversine_distance(depot_lat, depot_lon, lat, lon) if (lat and lon) else 0.0
            
            c_info = {
                "id": row.get(col_map.get("id", "id")),
                "cliente": str(row.get(col_map.get("cliente", "Cliente"), "")),
                "morada": str(row.get(col_map.get("morada", "Morada"), "")),
                "dist_km_armazem": round(d_km, 1),
                "peso_kg": float(row.get(col_map.get("peso_kg", "Peso_KG"), 0.0) or 0.0),
                "volume_m3": float(row.get(col_map.get("volume_m3", "Volume_m3"), 0.1) or 0.1),
            }

            if d_km <= 15.0:
                near.append(c_info)
            else:
                far.append(c_info)
        except Exception:
            continue

    return {
        "total_unassigned": len(unassigned_df),
        "near_depot_count": len(near),
        "far_depot_count": len(far),
        "near_depot": near,
        "far_depot": far
    }
