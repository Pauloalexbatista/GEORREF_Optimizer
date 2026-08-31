import os
import json
import time
import requests
from datetime import datetime

USAGE_FILE = 'config/usage.json'
LOG_FILE = 'config/google_api_log.csv'
CONFIG_FILE = 'config/google_config.json'

def get_google_api_key():
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                key = data.get('google_maps_api_key', '')
                if key and not key.startswith('AIzaSy_YOUR'):
                    return key
    except Exception:
        pass
    return os.getenv('GOOGLE_MAPS_API_KEY', '')

def check_google_budget():
    """Checks if we are within the budget limit."""
    if not os.path.exists(USAGE_FILE):
        return True
    try:
        with open(USAGE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        current_month = datetime.now().strftime("%Y-%m")
        if data.get('current_month') != current_month:
            data['current_month'] = current_month
            data['count'] = 0
            with open(USAGE_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
            return True
        return data.get('count', 0) < data.get('limit', 5000)
    except Exception:
        return True

def record_google_usage(empresa_id: int = 1, projeto_id: int = 0, servico: str = "routes_traffic", num_pedidos: int = 1):
    """Records usage in usage.json, CSV log, and SQLite database."""
    # 1. Update usage.json
    try:
        data = {}
        if os.path.exists(USAGE_FILE):
            with open(USAGE_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
        current_month = datetime.now().strftime("%Y-%m")
        if data.get('current_month') != current_month:
            data['current_month'] = current_month
            data['count'] = 0
        data['count'] = data.get('count', 0) + num_pedidos
        data['total_all_time'] = data.get('total_all_time', 0) + num_pedidos
        with open(USAGE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        print(f"Error updating usage.json: {e}")

    # 2. Append to CSV log
    try:
        if not os.path.exists(LOG_FILE):
            with open(LOG_FILE, 'w', encoding='utf-8') as f:
                f.write("Timestamp,Empresa_ID,Projeto_ID,Servico,Num_Pedidos,Status\n")
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(f"{timestamp},{empresa_id},{projeto_id},{servico},{num_pedidos},SUCCESS\n")
    except Exception as e:
        print(f"Error logging transaction to CSV: {e}")

    # 3. Save to database table consumos_google
    try:
        from database import registar_consumo_google
        custo_unitario = 0.005 if servico == "routes_traffic" else 0.005
        custo_total = round(num_pedidos * custo_unitario, 4)
        registar_consumo_google(empresa_id, projeto_id, servico, num_pedidos, custo_total)
    except Exception as e:
        pass

def calculate_google_traffic_route(origin_coords: tuple, stops_coords: list, departure_time_min: int = 540, api_key: str = None, empresa_id: int = 1, projeto_id: int = 0):
    """
    Computes road route with real traffic using Google Maps Routes API (New).
    Origin & Destination: origin_coords (depot_lat, depot_lon)
    stops_coords: [(lat1, lon1), (lat2, lon2), ...]
    Returns dict with legs: duration_min, distance_km, polyline, etc.
    """
    if not api_key:
        api_key = get_google_api_key()
        
    if not api_key or not check_google_budget():
        return None

    try:
        depot_lat, depot_lon = origin_coords
        if not stops_coords:
            return None

        # Prepare intermediates for Routes API v2
        intermediates = []
        for lat, lon in stops_coords[:25]:
            intermediates.append({
                "location": {
                    "latLng": {
                        "latitude": float(lat),
                        "longitude": float(lon)
                    }
                }
            })

        routes_url = "https://routes.googleapis.com/directions/v2:computeRoutes"
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.legs,routes.polyline.encodedPolyline"
        }
        payload = {
            "origin": {
                "location": {
                    "latLng": {
                        "latitude": float(depot_lat),
                        "longitude": float(depot_lon)
                    }
                }
            },
            "destination": {
                "location": {
                    "latLng": {
                        "latitude": float(depot_lat),
                        "longitude": float(depot_lon)
                    }
                }
            },
            "intermediates": intermediates,
            "travelMode": "DRIVE",
            "routingPreference": "TRAFFIC_AWARE"
        }

        resp = requests.post(routes_url, headers=headers, json=payload, timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("routes"):
                record_google_usage(empresa_id, projeto_id, "routes_traffic", 1)
                
                route_obj = data["routes"][0]
                legs = route_obj.get("legs", [])
                
                legs_info = []
                total_dist_km = 0.0
                total_dur_min = 0.0
                
                for leg in legs:
                    dur_str = leg.get("duration", "0s")
                    dur_sec = int(dur_str.replace("s", "")) if "s" in dur_str else 0
                    dist_m = leg.get("distanceMeters", 0)
                    
                    dur_min = dur_sec / 60.0
                    dist_km = dist_m / 1000.0
                    
                    total_dur_min += dur_min
                    total_dist_km += dist_km
                    
                    legs_info.append({
                        "distance_km": round(dist_km, 2),
                        "duration_min": round(dur_min, 1)
                    })
                    
                return {
                    "status": "OK",
                    "total_distance_km": round(total_dist_km, 2),
                    "total_duration_min": round(total_dur_min, 1),
                    "legs": legs_info,
                    "overview_polyline": route_obj.get("polyline", {}).get("encodedPolyline", "")
                }
    except Exception as e:
        print(f"[Google Routes API Error]: {e}")
        
    return None
