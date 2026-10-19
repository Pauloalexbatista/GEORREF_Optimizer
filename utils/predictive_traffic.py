"""
Módulo de Matriz Histórica e Trânsito Preditivo 24h (Estratégia Low-Cost)
Armazena incrementalmente em SQLite velocidades e tempos reais observados por:
- Origem (CP4)
- Destino (CP4)
- Dia da Semana (0..6)
- Faixa Horária (0..23)

Permite calibrar o solver OR-Tools e o cálculo de rotas e ETAs a custo zero,
sem necessidade de APIs pagas de matriz de trânsito em tempo real.
"""

import re
import math
from datetime import datetime
from typing import Optional, Tuple, Dict, Any
from database import get_db
from utils.distance_calculator import haversine_distance


def extract_cp4(cp_str: Any) -> str:
    """Extrai os 4 primeiros dígitos do Código Postal (ex: '2670-350' -> '2670')."""
    if not cp_str:
        return "1000"
    s = str(cp_str).strip()
    digits = re.findall(r"\d+", s)
    if digits:
        combined = "".join(digits)
        if len(combined) >= 4:
            return combined[:4]
        return combined.ljust(4, "0")
    return "1000"


def get_default_speed_profile(cp4: str, hour: int) -> float:
    """
    Retorna velocidade média estimada (km/h) baseada no perfil geográfico
    e horário de tráfego típico em Portugal continental.
    """
    try:
        cp_num = int(cp4)
    except Exception:
        cp_num = 1000

    hour = max(0, min(23, int(hour)))
    is_morning_rush = 8 <= hour <= 10
    is_evening_rush = 17 <= hour <= 19
    is_rush = is_morning_rush or is_evening_rush
    is_night = hour < 7 or hour >= 21

    # 1. Área Metropolitana de Lisboa (Centro Urbano / Coroa 1)
    if 1000 <= cp_num <= 1999:
        if is_rush:
            return 18.0 if is_evening_rush else 22.0
        elif is_night:
            return 45.0
        else:
            return 28.0

    # 2. Área Metropolitana do Porto (Centro / Circunvalação)
    elif 4000 <= cp_num <= 4499:
        if is_rush:
            return 22.0
        elif is_night:
            return 48.0
        else:
            return 32.0

    # 3. Grande Lisboa / Margem Sul / Cintura Suburbana (2xxx, Sintra, Loures, Almada, etc.)
    elif 2000 <= cp_num <= 2999:
        if is_rush:
            return 36.0
        elif is_night:
            return 65.0
        else:
            return 48.0

    # 4. Restantes Regiões / Vias Interurbanas e Autoestradas
    else:
        if is_rush:
            return 48.0
        elif is_night:
            return 72.0
        else:
            return 58.0


def record_traffic_segment(
    origem_cp: str,
    destino_cp: str,
    duration_seconds: int,
    distance_km: float,
    departure_dt: Optional[datetime] = None,
    source: str = "driver_app"
) -> bool:
    """
    Regista incrementalmente uma observação real de viagem entre dois CPs.
    Atualiza a velocidade média observada para a combinação (CP4, CP4, Dia, Hora).
    """
    if duration_seconds <= 10 or distance_km <= 0.05:
        return False

    origem_cp4 = extract_cp4(origem_cp)
    destino_cp4 = extract_cp4(destino_cp)

    dt = departure_dt or datetime.now()
    dia_semana = dt.weekday()  # 0=Segunda ... 6=Domingo
    faixa_horaria = dt.hour    # 0 a 23

    # Calcular velocidade média registada (km/h)
    speed_kmh = distance_km / (duration_seconds / 3600.0)

    # Filtrar anomalias/paragens prolongadas ou teletransporte
    if speed_kmh < 4.0 or speed_kmh > 130.0:
        return False

    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT velocidade_kmh, amostras, tempo_medio_segundos, distancia_media_km
                FROM predictive_traffic_matrix
                WHERE origem_cp4 = ? AND destino_cp4 = ? AND dia_semana = ? AND faixa_horaria = ?
            """, (origem_cp4, destino_cp4, dia_semana, faixa_horaria))
            row = cursor.fetchone()

            if row:
                old_speed = row["velocidade_kmh"]
                old_samples = row["amostras"]
                old_time = row["tempo_medio_segundos"] or duration_seconds
                old_dist = row["distancia_media_km"] or distance_km

                new_samples = old_samples + 1
                new_speed = round((old_speed * old_samples + speed_kmh) / new_samples, 2)
                new_time = int((old_time * old_samples + duration_seconds) / new_samples)
                new_dist = round((old_dist * old_samples + distance_km) / new_samples, 3)

                cursor.execute("""
                    UPDATE predictive_traffic_matrix
                    SET velocidade_kmh = ?, amostras = ?, tempo_medio_segundos = ?, distancia_media_km = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE origem_cp4 = ? AND destino_cp4 = ? AND dia_semana = ? AND faixa_horaria = ?
                """, (new_speed, new_samples, new_time, new_dist, origem_cp4, destino_cp4, dia_semana, faixa_horaria))
            else:
                cursor.execute("""
                    INSERT INTO predictive_traffic_matrix 
                    (origem_cp4, destino_cp4, dia_semana, faixa_horaria, velocidade_kmh, amostras, tempo_medio_segundos, distancia_media_km)
                    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                """, (origem_cp4, destino_cp4, dia_semana, faixa_horaria, round(speed_kmh, 2), int(duration_seconds), round(distance_km, 3)))

            conn.commit()
            return True
    except Exception as e:
        print(f"[PREDICTIVE TRAFFIC] Erro ao gravar segmento ({origem_cp4} -> {destino_cp4}): {e}")
        return False


def get_predictive_speed(
    origem_cp: str,
    destino_cp: str,
    departure_hour: int = 9,
    dia_semana: int = 1,
    fallback_speed: Optional[float] = None
) -> float:
    """
    Retorna a velocidade média prevista (km/h) para uma viagem entre dois Códigos Postais.
    1º Procura observação histórica exata no SQLite.
    2º Procura média para o mesmo par em dias úteis similares.
    3º Recorre ao modelo calibrado de perfil horário por zona postal.
    """
    origem_cp4 = extract_cp4(origem_cp)
    destino_cp4 = extract_cp4(destino_cp)
    hour = max(0, min(23, int(departure_hour)))
    wday = max(0, min(6, int(dia_semana)))

    try:
        with get_db() as conn:
            cursor = conn.cursor()
            # 1. Busca exata (origem, destino, dia, hora)
            cursor.execute("""
                SELECT velocidade_kmh FROM predictive_traffic_matrix
                WHERE origem_cp4 = ? AND destino_cp4 = ? AND dia_semana = ? AND faixa_horaria = ?
            """, (origem_cp4, destino_cp4, wday, hour))
            row = cursor.fetchone()
            if row and row["velocidade_kmh"] > 0:
                return float(row["velocidade_kmh"])

            # 2. Busca pelo par na mesma hora (média geral de dias úteis)
            if wday < 5:
                cursor.execute("""
                    SELECT AVG(velocidade_kmh) as avg_speed FROM predictive_traffic_matrix
                    WHERE origem_cp4 = ? AND destino_cp4 = ? AND dia_semana < 5 AND faixa_horaria = ?
                """, (origem_cp4, destino_cp4, hour))
                row_weekday = cursor.fetchone()
                if row_weekday and row_weekday["avg_speed"]:
                    return float(round(row_weekday["avg_speed"], 2))
    except Exception:
        pass

    # 3. Fallback: perfil horário dinâmico por zona postal de origem
    profile_speed = get_default_speed_profile(origem_cp4, hour)
    if fallback_speed and fallback_speed > 0:
        # Ponderação entre a velocidade configurada da viatura e o perfil de trânsito local
        return round((profile_speed * 0.7) + (fallback_speed * 0.3), 1)
    return profile_speed


def calculate_predictive_travel_time(
    lat1: float,
    lon1: float,
    cp1: str,
    lat2: float,
    lon2: float,
    cp2: str,
    departure_hour: int = 9,
    dia_semana: int = 1,
    distance_km: Optional[float] = None
) -> Tuple[float, float]:
    """
    Calcula o tempo de viagem (em minutos) e a velocidade estimada (km/h)
    entre dois pontos geográficos considerando as barreiras fluviais e o trânsito preditivo.
    """
    if distance_km is None:
        distance_km = haversine_distance(lat1, lon1, lat2, lon2, respect_river_barriers=True)

    if distance_km <= 0.001:
        return 0.0, 50.0

    speed_kmh = get_predictive_speed(cp1, cp2, departure_hour=departure_hour, dia_semana=dia_semana)
    travel_time_min = (distance_km / max(5.0, speed_kmh)) * 60.0

    return round(travel_time_min, 2), round(speed_kmh, 1)


def get_traffic_matrix_stats() -> Dict[str, Any]:
    """Retorna estatísticas operacionais da base de dados de trânsito preditivo."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as total_records, SUM(amostras) as total_samples, AVG(velocidade_kmh) as avg_speed FROM predictive_traffic_matrix")
            r1 = cursor.fetchone()
            
            cursor.execute("SELECT COUNT(DISTINCT origem_cp4) as unique_origins, COUNT(DISTINCT destino_cp4) as unique_destinations FROM predictive_traffic_matrix")
            r2 = cursor.fetchone()

            return {
                "total_routes_learned": r1["total_records"] or 0 if r1 else 0,
                "total_samples": r1["total_samples"] or 0 if r1 else 0,
                "avg_speed_kmh": round(r1["avg_speed"], 1) if r1 and r1["avg_speed"] else 0.0,
                "unique_origins": r2["unique_origins"] or 0 if r2 else 0,
                "unique_destinations": r2["unique_destinations"] or 0 if r2 else 0
            }
    except Exception as e:
        return {
            "error": str(e),
            "total_routes_learned": 0,
            "total_samples": 0,
            "avg_speed_kmh": 0.0
        }
