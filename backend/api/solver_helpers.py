"""Modelos Pydantic e funções auxiliares puras para o módulo solver."""
import math
from typing import List, Dict, Any, Optional
import pandas as pd
from pydantic import BaseModel

from utils.distance_calculator import haversine_distance as _river_haversine
from utils.rules_engine import is_vehicle_compatible

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

def diagnose_unassigned_delivery(
    client_row: dict,
    wh_name: str,
    fleet_dict: dict,
    ejection_reason: str = "",
    was_proximity_ejected: bool = False,
    dist_km: float = 0.0,
    rules_matrix: list = None,
    has_wh_filter: bool = False,
    target_wh_filter: str = ""
) -> str:
    """Diagnóstico auditável e rigoroso de por que uma entrega ficou em Por Distribuir."""
    import unicodedata
    def _strip_norm(t):
        return "".join(c for c in unicodedata.normalize("NFD", str(t or "")) if unicodedata.category(c) != "Mn").lower().strip()

    c_rules = str(client_row.get("Regras") or client_row.get("regras") or "").strip()
    c_wh = str(client_row.get("Armazem") or wh_name or "").strip()
    c_kg = float(client_row.get("Peso_KG") or client_row.get("peso_kg") or 0.0)
    c_vol = float(client_row.get("Volume_m3") or client_row.get("volume_m3") or 0.0)

    # 0. Verificação Suprema de Capacidade Física:
    wh_vehs = {k: v for k, v in fleet_dict.items() if _strip_norm(v.get("warehouse", "")) == _strip_norm(c_wh) or _strip_norm(v.get("warehouse", "")) in _strip_norm(c_wh) or _strip_norm(c_wh) in _strip_norm(v.get("warehouse", ""))}
    ref_fleet = wh_vehs if wh_vehs else fleet_dict
    if ref_fleet:
        max_f_kg = max(float(v.get("capacity") or v.get("capacity_kg") or v.get("Capacidade_KG") or 1000.0) for v in ref_fleet.values())
        max_f_vol = max(float(v.get("capacity_volume") or v.get("capacity_vol") or v.get("Capacidade_Vol") or 10.0) for v in ref_fleet.values())
        if c_kg > max_f_kg or c_vol > max_f_vol:
            excess_parts = []
            if c_kg > max_f_kg:
                excess_parts.append(f"{c_kg:.1f} kg > máx {max_f_kg:.1f} kg")
            if c_vol > max_f_vol:
                excess_parts.append(f"{c_vol:.2f} m³ > máx {max_f_vol:.2f} m³")
            return f"Carga incompatível: não cabe em nenhuma viatura ({' e '.join(excess_parts)})"

    if ejection_reason:
        return ejection_reason
    if was_proximity_ejected:
        return f"Retida junto ao armazém ({dist_km:.1f} km) por priorização de entregas distantes"

    # 1. Distância inviável ao armazém base (ex: Mem Martins para Vila Real, ou Aveiro para Algoz, ou Ilhas cruzadas)
    if dist_km > 150.0:
        return f"Distância excessiva ao armazém ({dist_km:.0f} km): excede o raio de operação de 1 turno da frota de {c_wh}"

    # 2. Se foi executado um filtro para um armazém específico e esta entrega pertence a OUTRO armazém:
    if has_wh_filter and target_wh_filter:
        w_c = _strip_norm(c_wh)
        w_t = _strip_norm(target_wh_filter)
        if w_c and w_t and w_c != w_t and w_t not in w_c and w_c not in w_t:
            return f"Aguardando cálculo do armazém '{c_wh}' no planeamento"

    # 3. Verificar se o armazém tem viaturas configuradas na frota
    if not wh_vehs:
        return f"Armazém '{c_wh}' sem viaturas configuradas na frota"

    # 4. Verificar restrições de compatibilidade REAIS
    c_cp = str(client_row.get("CP") or client_row.get("Codigo_Postal") or client_row.get("codigo_postal") or "")
    matching_v = []
    for v_n, v_d in wh_vehs.items():
        v_rules = str(v_d.get("regras") or "")
        if is_vehicle_compatible(v_rules, c_rules, rules_matrix=rules_matrix, delivery_cp=c_cp, vehicle_name=v_n):
            matching_v.append((v_n, v_d))
        
    if not matching_v:
        if rules_matrix and len(rules_matrix) > 0:
            return f"Restrição de acesso: viaturas de '{c_wh}' não autorizadas para regras/zona ({c_rules or c_cp})"
        return f"Sem viatura compatível no armazém '{c_wh}'"

    # 5. Janela horária estrita
    win_s = str(client_row.get("Janela_Inicio") or client_row.get("Slot1_Inicio") or "").strip()
    win_e = str(client_row.get("Janela_Fim") or client_row.get("Slot1_Fim") or "").strip()
    if win_s and win_e and win_e not in ["18:00", "20:00", "23:59", ""]:
        return f"Janela horária restrita ({win_s}-{win_e}) conflituante com turnos da frota"
        
    return f"Capacidade de carga ou turnos esgotados na frota do armazém '{c_wh}'"


def clean_num(val, default=0.0):
    if val is None or pd.isna(val):
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except Exception:
        return default

def clean_int(val, default=0):
    if val is None or pd.isna(val):
        return default
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return default
        return int(f)
    except Exception:
        return default

def sanitize_json_data(obj):
    """Recursively replaces NaN, Inf, -Inf with safe values for JSON compliance."""
    if isinstance(obj, dict):
        return {k: sanitize_json_data(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_json_data(v) for v in obj]
    elif isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return 0.0
        return obj
    elif pd.isna(obj):
        return None
    return obj


class SolverRequest(BaseModel):
    project_id: int
    params: Dict[str, Any]

from typing import Optional

class ReorderRequest(BaseModel):
    project_id: int
    route_name: str
    client_code: Optional[str] = None
    delivery_id: Optional[int] = None
    address: Optional[str] = None
    new_order: int

class ReassignRequest(BaseModel):
    project_id: int
    client_code: Optional[Any] = None
    clientName: Optional[Any] = None
    delivery_id: Optional[Any] = None
    deliveryId: Optional[Any] = None
    address: Optional[Any] = None
    lat: Optional[Any] = None
    lon: Optional[Any] = None
    new_route: Any

    def get_code(self):
        val = self.client_code if self.client_code is not None else self.clientName
        return str(val).strip() if val is not None else ""

    def get_id(self):
        return self.delivery_id if self.delivery_id is not None else self.deliveryId

class BulkReassignSelectionItem(BaseModel):
    client_code: Optional[Any] = None
    clientName: Optional[Any] = None
    delivery_id: Optional[Any] = None
    deliveryId: Optional[Any] = None
    address: Optional[Any] = None
    lat: Optional[Any] = None
    lon: Optional[Any] = None

    def get_code(self):
        val = self.client_code if self.client_code is not None else self.clientName
        return str(val).strip() if val is not None else ""

    def get_id(self):
        return self.delivery_id if self.delivery_id is not None else self.deliveryId

class BulkReassignSelectionRequest(BaseModel):
    project_id: int
    items: List[BulkReassignSelectionItem]
    new_route: str

class BulkReassignRouteRequest(BaseModel):
    project_id: int
    source_route: str
    target_route: str

class ResetAllRoutesRequest(BaseModel):
    project_id: int

class OptimizeRouteRequest(BaseModel):
    project_id: int
    route_name: str

def haversine_distance(lat1, lon1, lat2, lon2):
    if not lat1 or not lon1 or not lat2 or not lon2:
        return 0.0
    return _river_haversine(lat1, lon1, lat2, lon2)

def is_pending_route(route_name: str) -> bool:
    if not route_name:
        return True
    s = str(route_name).upper()
    return "PENDENTE" in s or "DISTRIBUIR" in s

def format_time_slot(t_val) -> str:
    if t_val is None or pd.isna(t_val):
        return ""
    s = str(t_val).strip()
    if not s or s.lower() in ["none", "nan", "qualquer", "n/a", "nat", "0", "0.0"]:
        return ""
    if " " in s:
        s = s.split(" ")[-1].strip()
    if "T" in s:
        s = s.split("T")[-1].strip()
    if ":" in s:
        parts = s.split(":")
        try:
            h = int(parts[0])
            m = int(parts[1])
            return f"{h:02d}:{m:02d}"
        except Exception:
            pass
    return s[:5]

def format_time_window_display(start_val, end_val) -> str:
    s1 = format_time_slot(start_val)
    s2 = format_time_slot(end_val)
    if s1 and s2:
        return f"{s1} - {s2}"
    if s1:
        return f"{s1} - 23:59"
    return "Qualquer"

def parse_time_to_minutes(t_val, default=480) -> int:
    if not t_val or pd.isna(t_val):
        return default
    s = str(t_val).strip()
    if not s or s.lower() in ["none", "nan", "qualquer", "n/a", "nat"]:
        return default
    extra_days = 0
    if "+1d" in s.lower() or "+1 d" in s.lower():
        extra_days = 1
    elif "+2d" in s.lower() or "+2 d" in s.lower():
        extra_days = 2
    if " " in s:
        s = s.split(" ")[-1].strip()
    if "T" in s:
        s = s.split("T")[-1].strip()
    try:
        parts = s.split(":")
        if len(parts) >= 2:
            return (extra_days * 1440) + int(parts[0]) * 60 + int(parts[1])
        return default
    except Exception:
        return default


def minutes_to_time_str(m: int) -> str:
    total_m = int(round(m))
    h = total_m // 60
    mins = total_m % 60
    if h >= 24:
        return f"+1d {h % 24:02d}:{mins:02d}"
    return f"{h:02d}:{mins:02d}"

def parse_time_window_str(win_str: str) -> tuple:
    if not win_str or str(win_str).strip().lower() in ["qualquer", "none", "", "nan", "n/a"]:
        return 0, 1440
    s = str(win_str).strip()
    if "-" in s:
        parts = s.split("-")
        s_m = parse_time_to_minutes(parts[0].strip(), 0)
        e_m = parse_time_to_minutes(parts[1].strip(), 1440)
        if e_m <= s_m:
            e_m = 1440
        return s_m, e_m
    return 0, 1440

def extract_fleet_dict(fleet_config, warehouses_df=None):
    fleet_dict = {}
    default_wh = "Armazém Loures 19"
    if warehouses_df is not None and not warehouses_df.empty:
        # Apenas o Armazém de Loures tem viaturas na frota ativa
        name_c = "Nome_Armazem" if "Nome_Armazem" in warehouses_df.columns else "Nome" if "Nome" in warehouses_df.columns else None
        if name_c:
            loures_m = warehouses_df[warehouses_df[name_c].astype(str).str.lower().str.contains("loures", na=False)]
            if not loures_m.empty:
                default_wh = str(loures_m.iloc[0][name_c])
            else:
                default_wh = str(warehouses_df.iloc[0][name_c])
    
    if isinstance(fleet_config, pd.DataFrame):
        for _, row in fleet_config.iterrows():
            raw_2v = str(row.get("2ª Volta", row.get("2a Volta", row.get("segunda_volta", "Não")))).strip()
            val_2v = "Sim" if raw_2v.lower() in ["sim", "s", "yes", "true", "1"] else "Não"
            fleet_dict[str(row["Veiculo"])] = {
                "capacity": float(row.get("Capacidade_KG", 1000.0)),
                "capacity_volume": float(row.get("Cap_Volume_m3", row.get("Capacidade_Vol", 5.0))),
                "cap_cx_total": float(row.get("cap_cx_total", row.get("Cap_Cx_Total", 0.0)) or 0.0),
                "cap_cx_ambiente": float(row.get("cap_cx_ambiente", row.get("Cap_Cx_Ambiente", 0.0)) or 0.0),
                "cap_cx_frio": float(row.get("cap_cx_frio", row.get("Cap_Cx_Frio", 0.0)) or 0.0),
                "cap_cx_congelado": float(row.get("cap_cx_congelado", row.get("Cap_Cx_Congelado", 0.0)) or 0.0),
                "cost_per_km": float(row.get("Custo_KM", 0.65)),
                "speed": float(row.get("Velocidade_Media", 50.0)),
                "start_time": str(row.get("Hora_Inicio_Turno", row.get("Horario_Inicio", "08:00:00"))),
                "end_time": str(row.get("Hora_Fim_Turno", row.get("Horario_Fim", "18:00:00"))),
                "warehouse": str(row.get("Armazem", default_wh)),
                "regras": str(row.get("Regras", "")),
                "max_entregas": int(row.get("Max_Entregas", row.get("max_entregas", 30)) or 30),
                "segunda_volta": val_2v
            }
    elif isinstance(fleet_config, dict):
        for v_k, v_v in fleet_config.items():
            if isinstance(v_v, dict):
                raw_2v = str(v_v.get("segunda_volta", v_v.get("2ª Volta", v_v.get("2a Volta", "Não")))).strip()
                val_2v = "Sim" if raw_2v.lower() in ["sim", "s", "yes", "true", "1"] else "Não"
                fleet_dict[str(v_k)] = {
                    "capacity": float(v_v.get("capacity", v_v.get("capacidade_kg", 1000.0))),
                    "capacity_volume": float(v_v.get("capacity_volume", v_v.get("capacidade_vol", 5.0))),
                    "cap_cx_total": float(v_v.get("cap_cx_total", v_v.get("Cap_Cx_Total", 0.0)) or 0.0),
                    "cap_cx_ambiente": float(v_v.get("cap_cx_ambiente", v_v.get("Cap_Cx_Ambiente", 0.0)) or 0.0),
                    "cap_cx_frio": float(v_v.get("cap_cx_frio", v_v.get("Cap_Cx_Frio", 0.0)) or 0.0),
                    "cap_cx_congelado": float(v_v.get("cap_cx_congelado", v_v.get("Cap_Cx_Congelado", 0.0)) or 0.0),
                    "cost_per_km": float(v_v.get("cost_per_km", v_v.get("custo_km", 0.65))),
                    "speed": float(v_v.get("speed", v_v.get("velocidade_media", 50.0))),
                    "start_time": str(v_v.get("start_time", v_v.get("horario_inicio", "08:00:00"))),
                    "end_time": str(v_v.get("end_time", v_v.get("horario_fim", "18:00:00"))),
                    "warehouse": str(v_v.get("warehouse", v_v.get("armazem", default_wh))),
                    "regras": str(v_v.get("regras", v_v.get("Regras", ""))),
                    "max_entregas": int(v_v.get("max_entregas", v_v.get("Max_Entregas", 30)) or 30),
                    "segunda_volta": val_2v
                }
            else:
                raw_2v = str(getattr(v_v, "segunda_volta", getattr(v_v, "2ª Volta", "Não"))).strip()
                val_2v = "Sim" if raw_2v.lower() in ["sim", "s", "yes", "true", "1"] else "Não"
                fleet_dict[str(v_k)] = {
                    "capacity": float(getattr(v_v, "capacidade_kg", 1000.0)),
                    "capacity_volume": float(getattr(v_v, "capacidade_vol", 5.0)),
                    "cap_cx_total": float(getattr(v_v, "cap_cx_total", 0.0) or 0.0),
                    "cap_cx_ambiente": float(getattr(v_v, "cap_cx_ambiente", 0.0) or 0.0),
                    "cap_cx_frio": float(getattr(v_v, "cap_cx_frio", 0.0) or 0.0),
                    "cap_cx_congelado": float(getattr(v_v, "cap_cx_congelado", 0.0) or 0.0),
                    "cost_per_km": float(getattr(v_v, "custo_km", 0.65)),
                    "speed": float(getattr(v_v, "velocidade_media", 50.0)),
                    "start_time": str(getattr(v_v, "horario_inicio", "08:00:00")),
                    "end_time": str(getattr(v_v, "horario_fim", "18:00:00")),
                    "warehouse": str(getattr(v_v, "armazem", default_wh)),
                    "regras": str(getattr(v_v, "regras", getattr(v_v, "Regras", ""))),
                    "max_entregas": int(getattr(v_v, "max_entregas", getattr(v_v, "Max_Entregas", 30)) or 30),
                    "segunda_volta": val_2v
                }
    return fleet_dict

def get_depot_coords(warehouses_df, wh_name=None):
    try:
        if warehouses_df is not None:
            if isinstance(warehouses_df, list):
                warehouses_df = pd.DataFrame(warehouses_df)
            if isinstance(warehouses_df, pd.DataFrame) and not warehouses_df.empty:
                # Find name column
                name_col = None
                for col in ["Nome_Armazem", "Nome_Armazém", "Armazem", "Armazém", "Nome", "name", "warehouse", "Armazem_Nome"]:
                    if col in warehouses_df.columns:
                        name_col = col
                        break
                
                # Find lat and lon columns
                lat_col = None
                for col in ["Latitude", "latitude", "lat", "Lat", "LAT"]:
                    if col in warehouses_df.columns:
                        lat_col = col
                        break
                        
                lon_col = None
                for col in ["Longitude", "longitude", "lon", "Lon", "lng", "Lng", "LON", "LNG"]:
                    if col in warehouses_df.columns:
                        lon_col = col
                        break
                        
                if lat_col and lon_col:
                    if wh_name and name_col:
                        wh_str = str(wh_name).strip().lower()
                        match = warehouses_df[warehouses_df[name_col].astype(str).str.strip().str.lower() == wh_str]
                        if not match.empty:
                            return float(match.iloc[0][lat_col]), float(match.iloc[0][lon_col])
                        # Fuzzy match
                        for _, w_row in warehouses_df.iterrows():
                            w_n = str(w_row[name_col]).strip().lower()
                            if w_n in wh_str or wh_str in w_n:
                                return float(w_row[lat_col]), float(w_row[lon_col])
                    # Se não encontrou correspondência específica, priorizar o Armazém de Loures onde a frota está sediada
                    if name_col:
                        loures_row = warehouses_df[warehouses_df[name_col].astype(str).str.lower().str.contains("loures", na=False)]
                        if not loures_row.empty:
                            return float(loures_row.iloc[0][lat_col]), float(loures_row.iloc[0][lon_col])
                    # Fallback continental
                    cont_df = warehouses_df[warehouses_df[lon_col].astype(float) > -15.0]
                    if not cont_df.empty:
                        return float(cont_df.iloc[0][lat_col]), float(cont_df.iloc[0][lon_col])
                    return float(warehouses_df.iloc[0][lat_col]), float(warehouses_df.iloc[0][lon_col])
    except Exception as e:
        print(f"Notice in get_depot_coords: {e}")
    return 38.6593, -9.1758

