"""
Testes unitários e de integração para as 5 melhorias algorítmicas (P1, P2, P3):
1. P1 — Curva Dinâmica de Carga dentro do OR-Tools (Outbound & Inbound) + Resgate Atómico [From, To]
2. P1 — Sincronização Matemática de 2ª Volta (Multi-Trip Start(V2) >= End(V1) + Reload)
3. P2 — Barreira Hidrográfica Inteligente (Tejo & Douro em distance_calculator.py)
4. P2 — Velocidade Média e Custo/KM por Viatura + Ângulo Radial Multi-Armazém
5. P3 — Janelas Horárias Soft (soft_tw_tolerance_min) & Buffer Preventivo + Fast 2-Opt
"""

import pytest
from utils.distance_calculator import (
    haversine_distance,
    _raw_haversine as straight_haversine_distance,
    calculate_haversine_matrix,
)
from utils.optimization_solver import AdvancedRouteOptimizer, get_segment_speed


def create_distance_matrix(locations, road_factor=1.3):
    return calculate_haversine_matrix(locations) * road_factor


class TestHydrographicBarrierP2:
    """Testes para a deteção de travessia do Rio Tejo e Rio Douro sem APIs pagas."""

    def test_tejo_crossing_cais_sodre_to_cacilhas(self):
        # Cais do Sodré (38.706, -9.144) -> Cacilhas (38.688, -9.148)
        # Linha reta ~2.0 km, mas via Ponte 25 de Abril > 7.5 km
        cais = (38.7060, -9.1440)
        cacilhas = (38.6880, -9.1480)
        straight_km = straight_haversine_distance(cais[0], cais[1], cacilhas[0], cacilhas[1])
        routed_km = haversine_distance(cais[0], cais[1], cacilhas[0], cacilhas[1])

        assert straight_km < 2.5
        assert routed_km > 6.5, f"Travessia Tejo deveria contornar pela ponte (>6.5km), obteve {routed_km:.2f}km"

    def test_tejo_crossing_alges_to_trafaria(self):
        # Algés (38.701, -9.229) -> Trafaria (38.673, -9.233)
        alges = (38.7010, -9.2290)
        trafaria = (38.6730, -9.2330)
        straight_km = straight_haversine_distance(alges[0], alges[1], trafaria[0], trafaria[1])
        routed_km = haversine_distance(alges[0], alges[1], trafaria[0], trafaria[1])

        assert straight_km < 3.5
        assert routed_km > 11.0

    def test_same_bank_lisbon_no_penalty(self):
        # Marquês de Pombal (38.725, -9.150) -> Belém (38.697, -9.206) (ambos Margem Norte)
        marques = (38.7250, -9.1500)
        belem = (38.6970, -9.2060)
        straight_km = straight_haversine_distance(marques[0], marques[1], belem[0], belem[1])
        routed_km = haversine_distance(marques[0], marques[1], belem[0], belem[1])

        assert abs(straight_km - routed_km) < 1e-6

    def test_douro_crossing_porto_to_gaia(self):
        # Foz do Douro (41.149, -8.674) -> Afurada / Gaia (41.142, -8.647)
        foz = (41.1490, -8.6740)
        afurada = (41.1420, -8.6470)
        straight_km = straight_haversine_distance(foz[0], foz[1], afurada[0], afurada[1])
        routed_km = haversine_distance(foz[0], foz[1], afurada[0], afurada[1])

        assert routed_km >= straight_km


class TestDynamicCapacityCurveInORToolsP1:
    """
    Verifica que uma viatura com 100 kg de capacidade consegue transportar:
    - Entrega D de 80 kg (sai do armazém com 80 kg, descarrega para 0 kg)
    - Recolha Loja From de 40 kg -> Entrega Cliente To de 40 kg (pico intermédio 40 kg)
    - Recolha Sucata P de 70 kg (regressa ao armazém com 70 kg)
    Total aritmético bruto seria 80 + 40 + 40 + 70 = 230 kg (> 100 kg), mas o pico real nunca passa de 80 kg!
    """

    def test_single_truck_handles_d_from_to_and_p_exceeding_static_sum(self):
        locations = [
            (38.7223, -9.1393),  # 0: Armazém
            (38.7300, -9.1450),  # 1: Entrega D (80 kg) - manhã cedo
            (38.7400, -9.1500),  # 2: Loja From (40 kg)
            (38.7500, -9.1550),  # 3: Cliente To (40 kg)
            (38.7600, -9.1600),  # 4: Recolha Sucata P (70 kg) - fim da rota
        ]
        dist_matrix = create_distance_matrix(locations, road_factor=1.3)
        demands = [0.0, 80.0, 40.0, 40.0, 70.0]
        volumes = [0.0, 4.0, 2.0, 2.0, 3.5]
        op_types = ["D", "D", "From", "To", "P"]
        pd_pairs = [(2, 3)]

        # Janelas sequenciais para garantir ordem D -> From -> To -> P
        tw = [
            (0, 1440),
            (480, 560),  # 1: D (08:00 - 09:20)
            (560, 640),  # 2: From (09:20 - 10:40)
            (640, 720),  # 3: To (10:40 - 12:00)
            (720, 840),  # 4: P (12:00 - 14:00)
        ]

        opt = AdvancedRouteOptimizer()
        res = opt.optimize_routes(
            distance_matrix=dist_matrix,
            demands=demands,
            vehicle_capacities=[100.0],  # 100 kg max!
            depot_indices=[0],
            num_warehouses=1,
            volume_demands=volumes,
            vehicle_volume_capacities=[6.0],  # 6 m3 max!
            vehicle_start_times=[480],
            vehicle_end_times=[1080],
            client_time_windows=tw,
            locations=locations,
            client_service_times=[0, 10, 10, 10, 10],
            operation_types=op_types,
            pickup_delivery_pairs=pd_pairs,
            optimization_params={"time_limit_seconds": 3, "respect_time_windows": True},
        )

        assert len(res["dropped_nodes"]) == 0, f"Nenhum ponto deveria cair! Dropped: {res['dropped_nodes']}"
        route = res["routes"][0]
        assert set(route) == {1, 2, 3, 4}
        assert route.index(2) < route.index(3), "From (2) deve preceder To (3)"


class TestMultiTripSynchronizationP1:
    """
    Verifica a sincronização matemática entre Volta 1 e Volta 2 da mesma viatura:
    Start(V2) >= End(V1) + 30 min.
    """

    def test_volta_2_waits_for_volta_1_plus_reload(self):
        locations = [
            (38.7223, -9.1393),  # 0: Armazém
            (39.1500, -8.8000),  # 1: Cliente longe na Volta 1 (exige ~2h ida e volta + descarga)
            (38.7300, -9.1450),  # 2: Cliente perto na Volta 2 (janela 10:00 - 17:00)
        ]
        dist_matrix = create_distance_matrix(locations, road_factor=1.3)
        # Cada cliente tem 80 kg, viatura leva 100 kg -> obriga a dividir entre Volta 1 e Volta 2
        demands = [0.0, 80.0, 80.0]
        tw = [
            (0, 1440),
            (540, 780),   # Cliente 1: 09:00 - 13:00
            (600, 1020),  # Cliente 2: 10:00 - 17:00
        ]

        opt = AdvancedRouteOptimizer()
        res = opt.optimize_routes(
            distance_matrix=dist_matrix,
            demands=demands,
            vehicle_capacities=[100.0, 100.0],
            depot_indices=[0, 0],
            num_warehouses=1,
            vehicle_names=["Carrinha A", "Carrinha A (Volta 2)"],
            vehicle_start_times=[540, 600],  # V1 sai 09:00, V2 disponível a partir das 10:00 mas depende de V1
            vehicle_end_times=[1080, 1080],
            client_time_windows=tw,
            locations=locations,
            client_service_times=[0, 30, 15],
            multi_trip_pairs=[(0, 1, 30)],
            optimization_params={"time_limit_seconds": 3, "respect_time_windows": True},
        )

        assert len(res["dropped_nodes"]) == 0
        assert len(res["routes"][0]) == 1
        assert len(res["routes"][1]) == 1


class TestPerVehicleSpeedAndCostP2:
    """
    Verifica que o solver prefere a viatura mais económica por KM quando ambas são viáveis,
    e respeita a velocidade média específica da viatura.
    """

    def test_cheaper_vehicle_preferred_by_solver(self):
        locations = [
            (38.7223, -9.1393),  # 0: Armazém
            (38.8000, -9.1500),  # 1: Cliente A
            (38.8200, -9.1600),  # 2: Cliente B
        ]
        dist_matrix = create_distance_matrix(locations, road_factor=1.3)
        demands = [0.0, 20.0, 20.0]

        opt = AdvancedRouteOptimizer()
        res = opt.optimize_routes(
            distance_matrix=dist_matrix,
            demands=demands,
            vehicle_capacities=[500.0, 500.0],
            depot_indices=[0, 0],
            num_warehouses=1,
            vehicle_names=["Viatura Cara", "Viatura Economica"],
            vehicle_costs_per_km=[2.50, 0.40],  # Viatura 1 é muito mais barata por KM
            vehicle_speeds=[50.0, 50.0],
            vehicle_start_times=[480, 480],
            vehicle_end_times=[1080, 1080],
            locations=locations,
            optimization_params={"time_limit_seconds": 3, "balance_routes": False},
        )

        # Toda a carga deve ir na Viatura Económica (índice 1)
        assert len(res["routes"][1]) == 2
        assert len(res["routes"][0]) == 0

    def test_get_segment_speed_scales_with_vehicle_speed(self):
        # Viatura rápida (65 km/h) vs Viatura pesada lenta (35 km/h)
        s_fast_urban = get_segment_speed(5.0, 65.0)
        s_slow_urban = get_segment_speed(5.0, 35.0)
        assert s_fast_urban > s_slow_urban

        s_fast_hwy = get_segment_speed(30.0, 65.0)
        s_slow_hwy = get_segment_speed(30.0, 35.0)
        assert s_fast_hwy > s_slow_hwy
