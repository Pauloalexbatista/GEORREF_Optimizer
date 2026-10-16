import math
import numpy as np

# ==============================================================================
# BARREIRAS HIDROGRÁFICAS DE PORTUGAL (100% Low-Cost / Sem APIs Externas)
# Evita que o cálculo Haversine una margens opostas (ex: Almada <-> Lisboa
# ou Gaia <-> Porto) em linha reta "a nado", roteando virtualmente pelo
# waypoint da ponte mais próxima quando o segmento cruza o eixo do rio.
# ==============================================================================

# Polilinha aproximada do eixo do Rio Tejo / Estuário (Foz -> Vila Franca de Xira)
TEJO_RIVER_POLYLINE = [
    (38.6650, -9.3300),  # Foz / São Julião da Barra - Bugio
    (38.6850, -9.2300),  # Algés / Trafaria
    (38.6896, -9.1771),  # Eixo Ponte 25 de Abril
    (38.6980, -9.1360),  # Terreiro do Paço / Cacilhas
    (38.7250, -9.0850),  # Beato / Montijo Oeste
    (38.7630, -9.0390),  # Eixo Ponte Vasco da Gama
    (38.8600, -9.0150),  # Alverca / Alcochete
    (38.9535, -8.9800),  # Ponte Marechal Carmona (Vila Franca de Xira)
    (39.0400, -8.8600),  # Carregado / Benavente
]

# Pontes de travessia do Tejo com fator de sinuosidade de acessos/viadutos
TEJO_BRIDGES = [
    (38.6896, -9.1771, 1.15),  # Ponte 25 de Abril
    (38.7630, -9.0390, 1.12),  # Ponte Vasco da Gama
    (38.9535, -8.9800, 1.10),  # Ponte de Vila Franca de Xira
]

# Polilinha aproximada do Rio Douro na Área Metropolitana do Porto (Foz -> Crestuma)
DOURO_RIVER_POLYLINE = [
    (41.1400, -8.6850),  # Foz do Douro / Afurada
    (41.1475, -8.6365),  # Ponte da Arrábida
    (41.1400, -8.6095),  # Ponte Luís I / Infante
    (41.1415, -8.5800),  # Ponte do Freixo
    (41.0950, -8.5000),  # Gondomar / Avintes
    (41.0720, -8.4200),  # Barragem de Crestuma-Lever
]

DOURO_BRIDGES = [
    (41.1475, -8.6365, 1.12),  # Ponte da Arrábida
    (41.1408, -8.6060, 1.15),  # Ponte do Infante
    (41.1415, -8.5800, 1.10),  # Ponte do Freixo
]


def _ccw(A, B, C):
    return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0])


def _segments_intersect(A, B, C, D) -> bool:
    """Verifica se o segmento geográfico AB interseta o segmento CD."""
    return (_ccw(A, C, D) != _ccw(B, C, D)) and (_ccw(A, B, C) != _ccw(A, B, D))


def _crosses_polyline(p1, p2, polyline) -> bool:
    """Retorna True se o segmento P1-P2 cruzar um número ímpar de vezes a polilinha do rio."""
    crossings = 0
    for k in range(len(polyline) - 1):
        if _segments_intersect(p1, p2, polyline[k], polyline[k + 1]):
            crossings += 1
    return (crossings % 2) == 1


def _raw_haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distância Haversine pura em linha reta (km)."""
    rlat1 = math.radians(lat1)
    rlon1 = math.radians(lon1)
    rlat2 = math.radians(lat2)
    rlon2 = math.radians(lon2)
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2.0) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2.0) ** 2
    c = 2.0 * math.asin(min(1.0, math.sqrt(a)))
    return 6371.0 * c


def haversine_distance(lat1, lon1, lat2, lon2, respect_river_barriers: bool = True):
    """
    Calcula a distância geodésica entre dois pontos (em km), corrigindo
    automaticamente travessias de barreiras hidrográficas (Rio Tejo e Rio Douro)
    através do encaminhamento virtual pela ponte mais próxima.
    """
    lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)
    if abs(lat1 - lat2) < 1e-7 and abs(lon1 - lon2) < 1e-7:
        return 0.0

    direct_km = _raw_haversine(lat1, lon1, lat2, lon2)
    if not respect_river_barriers:
        return direct_km

    # 1. Verificar Bounding Box do Estuário do Tejo (Grande Lisboa / Margem Sul)
    min_lat, max_lat = min(lat1, lat2), max(lat1, lat2)
    min_lon, max_lon = min(lon1, lon2), max(lon1, lon2)

    if max_lat >= 38.55 and min_lat <= 39.05 and max_lon >= -9.35 and min_lon <= -8.85:
        if _crosses_polyline((lat1, lon1), (lat2, lon2), TEJO_RIVER_POLYLINE):
            best_bridge_km = float("inf")
            for b_lat, b_lon, b_factor in TEJO_BRIDGES:
                d_bridge = (_raw_haversine(lat1, lon1, b_lat, b_lon) + _raw_haversine(b_lat, b_lon, lat2, lon2)) * b_factor
                if d_bridge < best_bridge_km:
                    best_bridge_km = d_bridge
            return max(direct_km, best_bridge_km)

    # 2. Verificar Bounding Box do Rio Douro (Grande Porto / Gaia)
    if max_lat >= 41.05 and min_lat <= 41.20 and max_lon >= -8.70 and min_lon <= -8.40:
        if _crosses_polyline((lat1, lon1), (lat2, lon2), DOURO_RIVER_POLYLINE):
            best_bridge_km = float("inf")
            for b_lat, b_lon, b_factor in DOURO_BRIDGES:
                d_bridge = (_raw_haversine(lat1, lon1, b_lat, b_lon) + _raw_haversine(b_lat, b_lon, lat2, lon2)) * b_factor
                if d_bridge < best_bridge_km:
                    best_bridge_km = d_bridge
            return max(direct_km, best_bridge_km)

    return direct_km


def calculate_haversine_matrix(locations, respect_river_barriers: bool = True):
    """
    Calcula a matriz de distâncias (em km) usando Haversine com correção
    de barreiras hidrográficas (pontes do Tejo e Douro).
    """
    n = len(locations)
    matrix = np.zeros((n, n))

    for i in range(n):
        lat_i, lon_i = locations[i][0], locations[i][1]
        for j in range(i + 1, n):
            d = haversine_distance(
                lat_i, lon_i,
                locations[j][0], locations[j][1],
                respect_river_barriers=respect_river_barriers
            )
            matrix[i][j] = d
            matrix[j][i] = d

    return matrix


def calculate_euclidean_matrix(locations):
    """
    Calculate distance matrix using Euclidean distance (current method).
    Returns in degrees (for backward compatibility).
    """
    loc_array = np.array(locations)
    n = len(locations)
    matrix = np.zeros((n, n))

    for i in range(n):
        for j in range(n):
            matrix[i][j] = np.linalg.norm(loc_array[i] - loc_array[j])

    return matrix

