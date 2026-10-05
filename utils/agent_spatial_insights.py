import json
import math
from typing import List, Dict, Any, Optional
import pandas as pd
from utils.validation_auditor import haversine_distance

def detect_geographic_outliers(
    deliveries_list: List[Dict[str, Any]],
    warehouses_list: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """
    Deteta paragens geometricamente anomalas ou isoladas:
    - Entregas no extremo Norte (Ponte de Lima, Viana, Valenca, Braganca)
    - Entregas nas Ilhas (Madeira / Acores)
    - Entregas a grande distancia (>120 km) com suspeita de erro de geocodificacao ou CP trocado
    """
    if not deliveries_list:
        return []

    # Mapa de armaz?ns por nome/id para correlacionar com o armaz?m real de cada rota/entrega
    warehouses_map = {}
    default_depot_lat, default_depot_lon = 38.8727, -9.0530

    if warehouses_list is not None and len(warehouses_list) > 0:
        w_items = warehouses_list if isinstance(warehouses_list, list) else warehouses_list.to_dict(orient="records")
        for w in w_items:
            w_name = str(w.get("Nome_Armazem") or w.get("Nome") or w.get("name") or "").strip().lower()
            try:
                w_lat = float(w.get("Latitude") or w.get("latitude") or 0.0)
                w_lon = float(w.get("Longitude") or w.get("longitude") or 0.0)
                # Ignorar armaz?ns com coordenadas 0 ou A?ores/Madeira se estivermos a calcular padr?o continental
                if w_lat != 0.0 and w_lon != 0.0:
                    warehouses_map[w_name] = (w_lat, w_lon)
                    # Preferir armaz?m continental de refer?ncia como default (ex: S?o Jo?o da Talha, Vialonga, Santar?m)
                    if default_depot_lat == 38.8727 and w_lat > 36.5 and w_lon > -10.5:
                        default_depot_lat, default_depot_lon = w_lat, w_lon
            except Exception:
                pass

    outliers = []
    for d in deliveries_list:
        try:
            lat = float(d.get("Latitude") or d.get("latitude") or 0.0)
            lon = float(d.get("Longitude") or d.get("longitude") or 0.0)
            if lat == 0.0 or lon == 0.0:
                continue

            # Obter armaz?m espec?fico da paragem ou o armaz?m continental ativo
            ent_armazem = str(d.get("Armazem") or d.get("armazem") or "").strip().lower()
            depot_lat, depot_lon = warehouses_map.get(ent_armazem, (default_depot_lat, default_depot_lon))
            dist_depot = haversine_distance(depot_lat, depot_lon, lat, lon)
            
            localidade = str(d.get("Localidade") or d.get("concelho") or "").strip()
            cp = str(d.get("CP") or d.get("codigo_postal") or "")
            morada = str(d.get("Morada") or d.get("morada") or "")
            rota = str(d.get("Rota") or d.get("rota") or "")

            is_suspicious_geo = False
            suspect_reason = ""

            # 1. Ilhas (Madeira / Acores)
            if lat < 34.0 or lon < -15.0 or cp.startswith("9"):
                is_suspicious_geo = True
                suspect_reason = f"Destino insular / Ilhas (Madeira/Acores) a {int(dist_depot)} km da base continental."
            
            # 2. Extremo Norte (Ponte de Lima, Viana do Castelo, Valenca, Minho, Braganca)
            elif lat >= 41.5 and depot_lat < 40.0:
                is_suspicious_geo = True
                suspect_reason = f"Extremo Norte de Portugal / Alto Minho ou Tras-os-Montes ({int(dist_depot)} km do armazem principal). Verificar se o cliente deve estar nesta distribuicao."
            
            # 3. Grande distancia com possivel confusao de localidade/CP
            elif dist_depot > 120.0:
                loc_lower = localidade.lower()
                mor_lower = morada.lower()
                if any(k in loc_lower or k in mor_lower for k in ["lisboa", "sintra", "cascais", "oeiras", "amadora", "loures", "almada", "setubal"]):
                    is_suspicious_geo = True
                    suspect_reason = f"Morada refere zona da Grande Lisboa mas coordenadas estao a {int(dist_depot)} km (forte suspeita de erro de codigo postal)."
                elif dist_depot > 180.0:
                    is_suspicious_geo = True
                    suspect_reason = f"Distancia anormalmente elevada ao centro de operacoes ({int(dist_depot)} km)."

            if is_suspicious_geo:
                c_nome = d.get("Cliente") or d.get("Nome_Cliente") or d.get("nome_cliente") or f"Cliente #{d.get('id')}"
                outliers.append({
                    "id": d.get("id") or d.get("ID_Original") or d.get("codigo_cliente"),
                    "cliente": str(c_nome),
                    "morada": morada,
                    "cp": cp,
                    "localidade": localidade,
                    "rota_atual": rota,
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "dist_km_armazem": round(dist_depot, 1),
                    "motivo_suspeita": suspect_reason
                })
        except Exception:
            continue

    outliers.sort(key=lambda x: x["dist_km_armazem"], reverse=True)
    return outliers


def analyze_unassigned_clustering(
    routes_solution: Any,
    warehouses_list: List[Dict[str, Any]]
) -> Dict[str, Any]:
    if isinstance(routes_solution, pd.DataFrame):
        df = routes_solution.copy()
    elif routes_solution:
        df = pd.DataFrame(routes_solution).copy()
    else:
        df = pd.DataFrame()

    if df.empty:
        return {"total_unassigned": 0, "near_depot_count": 0, "far_depot_count": 0, "near_depot": [], "far_depot": []}

    depot_lat, depot_lon = 38.82279, -9.08900
    if warehouses_list is not None and len(warehouses_list) > 0:
        w_items = warehouses_list if isinstance(warehouses_list, list) else warehouses_list.to_dict(orient="records")
        for w in w_items:
            try:
                w_lat = float(w.get("Latitude") or w.get("latitude") or 0.0)
                w_lon = float(w.get("Longitude") or w.get("longitude") or 0.0)
                if w_lat > 36.5 and w_lon > -10.5:
                    depot_lat, depot_lon = w_lat, w_lon
                    if "talha" in str(w.get("Nome_Armazem") or w.get("Nome") or "").lower():
                        break
            except Exception:
                pass

    col_map = {c.lower(): c for c in df.columns}
    rota_col = col_map.get("rota") or col_map.get("veiculo") or col_map.get("assigned_vehicle") or "Rota"
    if rota_col not in df.columns:
        df = df.copy()
        df["Rota"] = "Por Distribuir"
        rota_col = "Rota"
    
    unassigned_tokens = [
        "por distribuir", "por_distribuir", "por identificar", "por_identificar",
        "não atribuído", "nao atribuido", "nao_atribuido", "unassigned",
        "pendente", "nan", "", "none", "0", "-1"
    ]
    unassigned_mask = df[rota_col].astype(str).str.strip().str.lower().isin(unassigned_tokens)
    unassigned_df = df[unassigned_mask].copy()

    near = []
    far = []

    for idx, row in unassigned_df.iterrows():
        try:
            lat = float(row.get(col_map.get("latitude", "Latitude"), 0.0) or 0.0)
            lon = float(row.get(col_map.get("longitude", "Longitude"), 0.0) or 0.0)
            d_km = haversine_distance(depot_lat, depot_lon, lat, lon) if (lat and lon) else 0.0
            
            c_info = {
                "id": row.get(col_map.get("id", "id")),
                "cliente": str(row.get(col_map.get("cliente", "Cliente"), "") or row.get(col_map.get("nome_cliente", "Nome_Cliente"), "")),
                "morada": str(row.get(col_map.get("morada", "Morada"), "")),
                "localidade": str(row.get(col_map.get("localidade", "Localidade"), "")),
                "cp": str(row.get(col_map.get("cp", "CP"), "")),
                "dist_km_armazem": round(d_km, 1),
                "peso_kg": float(row.get(col_map.get("peso_kg", "Peso_KG"), 0.0) or 0.0),
                "volume_m3": float(row.get(col_map.get("volume_m3", "Volume_m3"), 0.1) or 0.1),
            }

            if d_km <= 15.0 and d_km > 0.0:
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
