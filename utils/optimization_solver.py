# -*- coding: utf-8 -*-
"""
GEOREF Optimizer - Official Google OR-Tools VRPTW Engine with Multi-Pass Route Squeeze & Highway Speed Model
===============================================================================================================
Enterprise-grade Vehicle Routing Problem with Time Windows (VRPTW):
- Phase 1: High-Precision Google OR-Tools VRPTW Guided Local Search (GLS)
  - Dynamic Outbound & Inbound Load Dimensions (D, P, From, To)
  - Mathematical Multi-Trip ("2ª Volta") Synchronization (Start(V2) >= End(V1) + Reload)
  - Per-Vehicle Speed & Cost-per-KM Evaluators + Multi-Depot Radial Angle Clustering
  - Soft Time Windows & Safety Buffer Support
- Phase 2: Multi-Pass Route Compression & Atomic Paired Absorption Loop
- Phase 3: Pairwise Route Fusion (Merges small regional routes into unified trucks)
- Phase 4: Paired & Single Greedy Rescue + Fast 2-Opt TSP Sequence Polishing
"""

import math
import time
from typing import List, Dict, Any, Tuple, Optional
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from utils.rules_engine import is_vehicle_compatible, extract_tags
from utils.operation_types import calculate_dynamic_route_loads, normalize_op_type

ROAD_FACTOR = 1.30


def get_segment_speed(dist_km: float, base_speed: float = 50.0) -> float:
    """
    Calcula a velocidade efetiva do segmento escalonando autoestrada/via rápida
    proporcionalmente à velocidade base da viatura (ex: camião pesado vs carrinha ligeira).
    """
    speed_ratio = max(0.6, min(1.4, float(base_speed or 50.0) / 50.0))
    if dist_km > 25.0:
        return 80.0 * speed_ratio
    elif dist_km > 10.0:
        return 65.0 * speed_ratio
    return max(float(base_speed or 50.0), 35.0)


def travel_time_seconds(dist_km: float, base_speed: float = 50.0) -> int:
    speed = get_segment_speed(dist_km, base_speed)
    return int(round((dist_km / speed) * 3600.0))


def travel_time_minutes(dist_km: float, base_speed: float = 50.0) -> float:
    speed = get_segment_speed(dist_km, base_speed)
    return (dist_km / speed) * 60.0


def _infer_multi_trip_pairs(
    vehicle_names: Optional[List[str]],
    explicit_pairs: Optional[List[Tuple[int, int, int]]] = None
) -> List[Tuple[int, int, int]]:
    """
    Deteta pares de (v1_idx, v2_idx, reload_minutes) para viaturas com '2ª Volta'.
    Se explicit_pairs for fornecido, usa-o; caso contrário, infere pelo sufixo ' (Volta 2)'.
    """
    if explicit_pairs:
        return list(explicit_pairs)
    if not vehicle_names:
        return []
    name_to_idx = {str(name).strip(): idx for idx, name in enumerate(vehicle_names)}
    inferred = []
    for idx, name in enumerate(vehicle_names):
        s_name = str(name).strip()
        if s_name.endswith("(Volta 2)"):
            base_name = s_name.replace(" (Volta 2)", "").replace("(Volta 2)", "").strip()
            if base_name in name_to_idx:
                inferred.append((name_to_idx[base_name], idx, 30))
    return inferred


class AdvancedRouteOptimizer:
    def __init__(self):
        self.manager = None
        self.routing = None

    def optimize_routes(
        self,
        distance_matrix: List[List[float]],
        demands: List[float],
        vehicle_capacities: List[float],
        depot_indices: List[int],
        optimization_params: Optional[Dict[str, Any]] = None,
        volume_demands: Optional[List[float]] = None,
        vehicle_volume_capacities: Optional[List[float]] = None,
        client_warehouses: Optional[List[str]] = None,
        vehicle_warehouses: Optional[List[str]] = None,
        num_warehouses: int = 1,
        vehicle_start_times: Optional[List[int]] = None,
        vehicle_end_times: Optional[List[int]] = None,
        client_time_windows: Optional[List[Tuple[int, int]]] = None,
        locations: Optional[List[Tuple[float, float]]] = None,
        client_rules: Optional[List[str]] = None,
        vehicle_rules: Optional[List[str]] = None,
        rules_matrix: Optional[List[Dict[str, Any]]] = None,
        vehicle_max_stops: Optional[List[int]] = None,
        client_service_times: Optional[List[int]] = None,
        client_priorities: Optional[List[int]] = None,
        vehicle_returns_to_depot: Optional[List[bool]] = None,
        client_cps: Optional[List[str]] = None,
        vehicle_names: Optional[List[str]] = None,
        operation_types: Optional[List[str]] = None,
        pickup_delivery_pairs: Optional[List[Tuple[int, int]]] = None,
        vehicle_speeds: Optional[List[float]] = None,
        vehicle_costs_per_km: Optional[List[float]] = None,
        multi_trip_pairs: Optional[List[Tuple[int, int, int]]] = None,
    ) -> Dict[str, Any]:
        params = optimization_params or {}
        time_limit = float(params.get("time_limit_seconds") or params.get("time_limit") or 25.0)
        respect_tw = bool(params.get("respect_time_windows", True))
        balance_load = bool(params.get("balance_load", False))
        strategy = str(params.get("strategy", "clusters")).lower()
        soft_tw_tolerance_min = int(params.get("soft_tw_tolerance_min", 0) or 0)

        resolved_mt_pairs = _infer_multi_trip_pairs(vehicle_names, multi_trip_pairs)

        # Phase 1: Global OR-Tools VRPTW Solve
        initial_solution = self._solve_ortools_vrptw(
            distance_matrix=distance_matrix,
            demands=demands,
            vehicle_capacities=vehicle_capacities,
            depot_indices=depot_indices,
            num_warehouses=num_warehouses,
            volume_demands=volume_demands,
            vehicle_volume_capacities=vehicle_volume_capacities,
            client_warehouses=client_warehouses,
            vehicle_warehouses=vehicle_warehouses,
            vehicle_start_times=vehicle_start_times,
            vehicle_end_times=vehicle_end_times,
            client_time_windows=client_time_windows,
            locations=locations,
            time_limit_seconds=time_limit,
            client_rules=client_rules,
            vehicle_rules=vehicle_rules,
            rules_matrix=rules_matrix,
            respect_time_windows=respect_tw,
            vehicle_max_stops=vehicle_max_stops,
            client_service_times=client_service_times,
            client_priorities=client_priorities,
            balance_load=balance_load,
            strategy=strategy,
            vehicle_returns_to_depot=vehicle_returns_to_depot,
            client_cps=client_cps,
            vehicle_names=vehicle_names,
            operation_types=operation_types,
            pickup_delivery_pairs=pickup_delivery_pairs,
            vehicle_speeds=vehicle_speeds,
            vehicle_costs_per_km=vehicle_costs_per_km,
            multi_trip_pairs=resolved_mt_pairs,
            soft_tw_tolerance_min=soft_tw_tolerance_min,
        )

        if not initial_solution.get("routes"):
            return initial_solution

        # Phase 2 & 3: Multi-Pass Route Compression, Fusion & 2-Opt Polishing
        squeezed_solution = self._compress_and_squeeze_routes(
            initial_solution=initial_solution,
            distance_matrix=distance_matrix,
            demands=demands,
            vehicle_capacities=vehicle_capacities,
            depot_indices=depot_indices,
            num_warehouses=num_warehouses,
            volume_demands=volume_demands,
            vehicle_volume_capacities=vehicle_volume_capacities,
            client_warehouses=client_warehouses,
            vehicle_warehouses=vehicle_warehouses,
            vehicle_start_times=vehicle_start_times,
            vehicle_end_times=vehicle_end_times,
            client_time_windows=client_time_windows,
            client_rules=client_rules,
            vehicle_rules=vehicle_rules,
            rules_matrix=rules_matrix,
            vehicle_max_stops=vehicle_max_stops,
            client_service_times=client_service_times,
            respect_time_windows=respect_tw,
            balance_load=balance_load,
            vehicle_returns_to_depot=vehicle_returns_to_depot,
            client_cps=client_cps,
            vehicle_names=vehicle_names,
            operation_types=operation_types,
            pickup_delivery_pairs=pickup_delivery_pairs,
            vehicle_speeds=vehicle_speeds,
            multi_trip_pairs=resolved_mt_pairs,
            soft_tw_tolerance_min=soft_tw_tolerance_min,
        )

        return squeezed_solution

    def _solve_ortools_vrptw(
        self,
        distance_matrix,
        demands,
        vehicle_capacities,
        depot_indices,
        num_warehouses,
        volume_demands,
        vehicle_volume_capacities,
        client_warehouses,
        vehicle_warehouses,
        vehicle_start_times,
        vehicle_end_times,
        client_time_windows,
        locations=None,
        time_limit_seconds=25.0,
        client_rules=None,
        vehicle_rules=None,
        rules_matrix=None,
        respect_time_windows=True,
        vehicle_max_stops=None,
        client_service_times=None,
        client_priorities=None,
        balance_load: bool = False,
        strategy: str = "clusters",
        vehicle_returns_to_depot: Optional[List[bool]] = None,
        client_cps: Optional[List[str]] = None,
        vehicle_names: Optional[List[str]] = None,
        operation_types: Optional[List[str]] = None,
        pickup_delivery_pairs: Optional[List[Tuple[int, int]]] = None,
        vehicle_speeds: Optional[List[float]] = None,
        vehicle_costs_per_km: Optional[List[float]] = None,
        multi_trip_pairs: Optional[List[Tuple[int, int, int]]] = None,
        soft_tw_tolerance_min: int = 0,
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_nodes = len(distance_matrix)
        num_clients = num_nodes - num_warehouses

        if num_vehicles == 0 or num_clients <= 0:
            return {"routes": [[] for _ in range(num_vehicles)], "dropped_nodes": [], "status": "no_data"}

        t0 = time.time()

        has_open_routes = vehicle_returns_to_depot is not None and any(not r for r in vehicle_returns_to_depot)
        dummy_end_node = num_nodes if has_open_routes else None
        num_nodes_manager = (num_nodes + 1) if has_open_routes else num_nodes

        starts = [depot_indices[v] if v < len(depot_indices) else 0 for v in range(num_vehicles)]
        ends = []
        for v in range(num_vehicles):
            ret = vehicle_returns_to_depot[v] if (vehicle_returns_to_depot and v < len(vehicle_returns_to_depot)) else True
            if ret or dummy_end_node is None:
                ends.append(depot_indices[v] if v < len(depot_indices) else 0)
            else:
                ends.append(dummy_end_node)

        manager = pywrapcp.RoutingIndexManager(num_nodes_manager, num_vehicles, starts, ends)
        routing = pywrapcp.RoutingModel(manager)

        # 1. Distance & Arc Cost (in meters) com suporte a agrupamento radial por armazém real da viatura e Custo_KM
        arc_cb_cache = {}
        for v in range(num_vehicles):
            v_depot = starts[v] if v < len(starts) else 0
            v_cost_km = float(vehicle_costs_per_km[v]) if (vehicle_costs_per_km and v < len(vehicle_costs_per_km) and vehicle_costs_per_km[v]) else 0.65
            cost_mult = max(0.3, min(3.0, round(v_cost_km / 0.65, 2)))
            cache_key = (v_depot, cost_mult)

            if cache_key not in arc_cb_cache:
                def make_distance_callback(depot_node_idx: int, c_mult: float):
                    def _cb(from_index, to_index):
                        from_node = manager.IndexToNode(from_index)
                        to_node = manager.IndexToNode(to_index)
                        if dummy_end_node is not None and (to_node == dummy_end_node or from_node == dummy_end_node):
                            return 0
                        dist_km = distance_matrix[from_node][to_node] * ROAD_FACTOR

                        # Em modo 'clusters': penalizar conexões entre clientes em ângulos opostos face ao armazém da viatura
                        if strategy == "clusters" and from_node >= num_warehouses and to_node >= num_warehouses and locations:
                            depot_lat, depot_lon = locations[depot_node_idx]
                            lat1, lon1 = locations[from_node]
                            lat2, lon2 = locations[to_node]
                            d1_lat, d1_lon = lat1 - depot_lat, lon1 - depot_lon
                            d2_lat, d2_lon = lat2 - depot_lat, lon2 - depot_lon
                            norm1 = math.sqrt(d1_lat * d1_lat + d1_lon * d1_lon)
                            norm2 = math.sqrt(d2_lat * d2_lat + d2_lon * d2_lon)
                            # Aplicar penalização angular apenas quando ambos os pontos distam > ~2km do armazém
                            if norm1 > 0.018 and norm2 > 0.018:
                                dot = (d1_lat * d2_lat) + (d1_lon * d2_lon)
                                cos_theta = max(-1.0, min(1.0, dot / (norm1 * norm2)))
                                if cos_theta < 0.65:
                                    dist_km *= (1.0 + (0.65 - cos_theta) * 0.45)

                        return int(round(dist_km * 1000 * c_mult))
                    return _cb

                arc_cb_cache[cache_key] = routing.RegisterTransitCallback(make_distance_callback(v_depot, cost_mult))

            routing.SetArcCostEvaluatorOfVehicle(arc_cb_cache[cache_key], v)

        # 2. Fixed Vehicle Cost: Se balance_load for True, não penalizamos o uso de mais viaturas
        # As 2ªs Voltas têm um ligeiro acréscimo de custo fixo para priorizar sempre o enchimento da 1ª Volta
        v2_indices = {v2 for _, v2, _ in (multi_trip_pairs or [])}
        BASE_FIXED_COST = 0 if balance_load else 500000
        for v in range(num_vehicles):
            fc = BASE_FIXED_COST + (25000 if v in v2_indices else 0)
            routing.SetFixedCostOfVehicle(fc, v)

        # 3 & 4. Dynamic Weight (KG) & Volume (m3) Capacity Dimensions
        # Mapeia os nós 'To' que possuem um par 'From' válido para descontarem a carga levantada na loja (-peso),
        # evitando dupla contagem e modelando separadamente a carga de saída (Outbound: D + From - To)
        # e a carga de recolha/retorno (Inbound: P + From - To).
        paired_to_map: Dict[int, int] = {}
        if pickup_delivery_pairs:
            for p_node, d_node in pickup_delivery_pairs:
                if 0 <= p_node < num_nodes and 0 <= d_node < num_nodes:
                    paired_to_map[d_node] = p_node

        def outbound_kg_callback(from_index):
            from_node = manager.IndexToNode(from_index)
            if dummy_end_node is not None and from_node == dummy_end_node:
                return 0
            if from_node < num_warehouses or from_node >= len(demands):
                return 0
            op = normalize_op_type(operation_types[from_node]) if (operation_types and from_node < len(operation_types)) else "D"
            if op == "P":
                return 0  # Sucata não sai do armazém
            if op == "To" and from_node in paired_to_map:
                p_node = paired_to_map[from_node]
                return -int(round(demands[p_node] * 10))
            return int(round(demands[from_node] * 10))

        def inbound_kg_callback(from_index):
            from_node = manager.IndexToNode(from_index)
            if dummy_end_node is not None and from_node == dummy_end_node:
                return 0
            if from_node < num_warehouses or from_node >= len(demands):
                return 0
            op = normalize_op_type(operation_types[from_node]) if (operation_types and from_node < len(operation_types)) else "D"
            if op == "D":
                return 0  # Entrega normal já foi descarregada
            if op == "To" and from_node in paired_to_map:
                p_node = paired_to_map[from_node]
                return -int(round(demands[p_node] * 10))
            if op in ("P", "From"):
                return int(round(demands[from_node] * 10))
            return 0

        out_kg_cb_idx = routing.RegisterUnaryTransitCallback(outbound_kg_callback)
        int_capacities = [int(round(cap * 10)) for cap in vehicle_capacities]
        routing.AddDimensionWithVehicleCapacity(
            out_kg_cb_idx,
            0,
            int_capacities,
            True,
            "Capacity_KG"
        )
        if balance_load:
            try:
                routing.GetDimensionOrDie("Capacity_KG").SetGlobalSpanCostTracker(80)
            except Exception:
                pass

        # Se existirem recolhas (P) ou levantamentos em loja (From), ativar também dimensão Inbound_KG
        has_reverse_or_pd = bool(
            (operation_types and any(normalize_op_type(op) in ("P", "From", "To") for op in operation_types))
            or pickup_delivery_pairs
        )
        if has_reverse_or_pd:
            in_kg_cb_idx = routing.RegisterUnaryTransitCallback(inbound_kg_callback)
            routing.AddDimensionWithVehicleCapacity(
                in_kg_cb_idx,
                0,
                int_capacities,
                True,
                "Inbound_KG"
            )

        # 4. Volume Capacity Dimension (m3)
        if volume_demands and vehicle_volume_capacities:
            def outbound_vol_callback(from_index):
                from_node = manager.IndexToNode(from_index)
                if dummy_end_node is not None and from_node == dummy_end_node:
                    return 0
                if from_node < num_warehouses or from_node >= len(volume_demands):
                    return 0
                op = normalize_op_type(operation_types[from_node]) if (operation_types and from_node < len(operation_types)) else "D"
                if op == "P":
                    return 0
                if op == "To" and from_node in paired_to_map:
                    p_node = paired_to_map[from_node]
                    return -int(round(volume_demands[p_node] * 100))
                return int(round(volume_demands[from_node] * 100))

            vol_cb_idx = routing.RegisterUnaryTransitCallback(outbound_vol_callback)
            int_vol_caps = [int(round(vcap * 100)) for vcap in vehicle_volume_capacities]
            routing.AddDimensionWithVehicleCapacity(
                vol_cb_idx,
                0,
                int_vol_caps,
                True,
                "Capacity_Volume"
            )

            if has_reverse_or_pd:
                def inbound_vol_callback(from_index):
                    from_node = manager.IndexToNode(from_index)
                    if dummy_end_node is not None and from_node == dummy_end_node:
                        return 0
                    if from_node < num_warehouses or from_node >= len(volume_demands):
                        return 0
                    op = normalize_op_type(operation_types[from_node]) if (operation_types and from_node < len(operation_types)) else "D"
                    if op == "D":
                        return 0
                    if op == "To" and from_node in paired_to_map:
                        p_node = paired_to_map[from_node]
                        return -int(round(volume_demands[p_node] * 100))
                    if op in ("P", "From"):
                        return int(round(volume_demands[from_node] * 100))
                    return 0

                in_vol_cb_idx = routing.RegisterUnaryTransitCallback(inbound_vol_callback)
                routing.AddDimensionWithVehicleCapacity(
                    in_vol_cb_idx,
                    0,
                    int_vol_caps,
                    True,
                    "Inbound_Volume"
                )

        # 5. Max Stops Dimension com balanceamento dinâmico
        effective_max_stops = vehicle_max_stops
        if balance_load and num_vehicles > 1 and num_clients > num_vehicles:
            target_stops = int(math.ceil((num_clients / num_vehicles) * 1.35)) + 1
            if vehicle_max_stops:
                effective_max_stops = [min(m, max(4, target_stops)) for m in vehicle_max_stops]
            else:
                effective_max_stops = [max(4, target_stops) for _ in range(num_vehicles)]

        if effective_max_stops:
            def stop_callback(from_index):
                from_node = manager.IndexToNode(from_index)
                if dummy_end_node is not None and from_node == dummy_end_node:
                    return 0
                return 1 if from_node >= num_warehouses else 0

            stop_callback_index = routing.RegisterUnaryTransitCallback(stop_callback)
            routing.AddDimensionWithVehicleCapacity(
                stop_callback_index,
                0,
                effective_max_stops,
                True,
                "Max_Stops"
            )
            if balance_load:
                try:
                    routing.GetDimensionOrDie("Max_Stops").SetGlobalSpanCostTracker(1500)
                except Exception:
                    pass

        # 6. Time Dimension in SECONDS with Per-Vehicle Speed Model
        HORIZON_SEC = 24 * 3600
        MAX_WAIT_SLACK_SEC = 1800  # Máximo 30 minutos de espera permitidos antes da abertura de uma paragem
        time_cb_cache = {}
        vehicle_time_cb_indices = []

        for v in range(num_vehicles):
            v_spd = round(float(vehicle_speeds[v]) if (vehicle_speeds and v < len(vehicle_speeds) and vehicle_speeds[v]) else 50.0, 1)
            if v_spd not in time_cb_cache:
                def make_time_cb(base_spd: float):
                    def _t_cb(from_index, to_index):
                        from_node = manager.IndexToNode(from_index)
                        to_node = manager.IndexToNode(to_index)
                        if dummy_end_node is not None and (to_node == dummy_end_node or from_node == dummy_end_node):
                            return 0
                        dist_km = distance_matrix[from_node][to_node] * ROAD_FACTOR
                        travel_sec = travel_time_seconds(dist_km, base_speed=base_spd)
                        serv_sec = (client_service_times[from_node] * 60) if (client_service_times and from_node < len(client_service_times)) else (600 if from_node >= num_warehouses else 0)
                        return int(round(travel_sec + serv_sec))
                    return _t_cb
                time_cb_cache[v_spd] = routing.RegisterTransitCallback(make_time_cb(v_spd))
            vehicle_time_cb_indices.append(time_cb_cache[v_spd])

        routing.AddDimensionWithVehicleTransits(
            vehicle_time_cb_indices,
            MAX_WAIT_SLACK_SEC,
            HORIZON_SEC,
            False,
            "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")

        if respect_time_windows:
            tol_sec = max(0, int(soft_tw_tolerance_min) * 60)
            for node in range(num_warehouses, num_nodes):
                tw = client_time_windows[node] if client_time_windows and node < len(client_time_windows) else (480, 1080)
                index = manager.NodeToIndex(node)
                if index != -1:
                    s_win_sec = max(0, min(HORIZON_SEC, int(tw[0]) * 60))
                    e_win_sec = max(s_win_sec, min(HORIZON_SEC, int(tw[1]) * 60))
                    hard_end_sec = min(HORIZON_SEC, e_win_sec + tol_sec)
                    time_dimension.CumulVar(index).SetRange(s_win_sec, hard_end_sec)

                    # Se houver tolerância soft configurada, penalizar fortemente cada segundo após o fecho oficial
                    if tol_sec > 0 and e_win_sec < HORIZON_SEC:
                        time_dimension.SetCumulVarSoftUpperBound(index, e_win_sec, 2500)
                    # Margem de segurança preventiva: se a janela tiver >= 60 min, incentivar chegada 5 min antes do fecho
                    elif (e_win_sec - s_win_sec) >= 3600 and e_win_sec < HORIZON_SEC:
                        time_dimension.SetCumulVarSoftUpperBound(index, e_win_sec - 300, 10)

        v2_to_v1_map = {v2: (v1, reload_min) for v1, v2, reload_min in (multi_trip_pairs or [])}
        for v in range(num_vehicles):
            v_start_sec = int(vehicle_start_times[v] if vehicle_start_times and v < len(vehicle_start_times) else 480) * 60
            v_end_sec = int(vehicle_end_times[v] if vehicle_end_times and v < len(vehicle_end_times) else 1080) * 60
            if v in v2_to_v1_map:
                v1_idx, reload_min = v2_to_v1_map[v]
                v1_start_sec = int(vehicle_start_times[v1_idx] if vehicle_start_times and v1_idx < len(vehicle_start_times) else 480) * 60
                # Permitir que a 2ª volta arranque dinamicamente assim que a 1ª volta terminar + tempo de recarga
                earliest_v2_sec = min(v_start_sec, max(v1_start_sec + 3600, 10 * 3600))
                time_dimension.CumulVar(routing.Start(v)).SetRange(earliest_v2_sec, v_end_sec)
                time_dimension.CumulVar(routing.End(v)).SetRange(earliest_v2_sec, v_end_sec)
                routing.solver().Add(
                    time_dimension.CumulVar(routing.Start(v)) >= time_dimension.CumulVar(routing.End(v1_idx)) + int(reload_min * 60)
                )
            else:
                time_dimension.CumulVar(routing.Start(v)).SetRange(v_start_sec, v_start_sec)
                time_dimension.CumulVar(routing.End(v)).SetRange(v_start_sec, v_end_sec)

        # 7. Disjunctions: REGRA DE OURO DA DISTRIBUIÇÃO
        # Clientes distantes são PRIORITÁRIOS. Se faltar tempo ou capacidade,
        # os clientes que ficam de fora são SEMPRE os mais perto da loja/armazém.
        BASE_DROP_PENALTY = 5000000
        for node in range(num_nodes):
            if node in starts or node in ends:
                continue
            index = manager.NodeToIndex(node)
            if index != -1:
                if node < num_warehouses:
                    penalty = 0
                else:
                    min_depot_dist = min(distance_matrix[d_idx][node] for d_idx in starts) if starts else distance_matrix[0][node]
                    dist_priority_factor = 1.0 + ((min_depot_dist / 10.0) ** 1.65)
                    prio = client_priorities[node] if client_priorities and node < len(client_priorities) else 2
                    prio_multiplier = 2.0 if prio == 1 else (1.2 if prio == 2 else 1.0)
                    penalty = int(BASE_DROP_PENALTY * dist_priority_factor * prio_multiplier)
                routing.AddDisjunction([index], penalty)

        # 7.5 Pickup and Delivery Pairs (From -> To com mesmo veículo e precedência estrita)
        if pickup_delivery_pairs:
            for p_node, d_node in pickup_delivery_pairs:
                p_idx = manager.NodeToIndex(p_node)
                d_idx = manager.NodeToIndex(d_node)
                if p_idx != -1 and d_idx != -1:
                    routing.AddPickupAndDelivery(p_idx, d_idx)
                    routing.solver().Add(routing.VehicleVar(p_idx) == routing.VehicleVar(d_idx))
                    routing.solver().Add(time_dimension.CumulVar(p_idx) <= time_dimension.CumulVar(d_idx))

        # 8. Business Rules & Multi-Tag Matrix Compatibility (VehicleVar)
        for node in range(num_warehouses, num_nodes):
            index = manager.NodeToIndex(node)
            if index == -1:
                continue
            c_rules = client_rules[node] if client_rules and node < len(client_rules) else ""
            c_cp = client_cps[node] if client_cps and node < len(client_cps) else ""
            c_wh = str(client_warehouses[node] if client_warehouses and node < len(client_warehouses) else "").strip().lower()

            allowed_vehicles = []
            for v in range(num_vehicles):
                v_rules = vehicle_rules[v] if vehicle_rules and v < len(vehicle_rules) else ""
                v_name = vehicle_names[v] if vehicle_names and v < len(vehicle_names) else ""
                v_wh = str(vehicle_warehouses[v] if vehicle_warehouses and v < len(vehicle_warehouses) else "").strip().lower()

                if num_warehouses > 1 and c_wh and v_wh and c_wh not in ["armazém principal", "armazem principal", "n/a", "none", ""]:
                    if c_wh != v_wh and c_wh not in v_wh and v_wh not in c_wh:
                        continue

                if is_vehicle_compatible(v_rules, c_rules, rules_matrix, delivery_cp=c_cp, vehicle_name=v_name):
                    allowed_vehicles.append(v)

            if allowed_vehicles and len(allowed_vehicles) < num_vehicles:
                routing.VehicleVar(index).SetValues(allowed_vehicles)
            elif not allowed_vehicles:
                routing.VehicleVar(index).SetValues([-1])

        # 9. Search Metaheuristic Parameters
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        if strategy == "clusters":
            search_parameters.first_solution_strategy = (
                routing_enums_pb2.FirstSolutionStrategy.SAVINGS
            )
        else:
            search_parameters.first_solution_strategy = (
                routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
            )

        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        search_parameters.time_limit.seconds = max(3, int(time_limit_seconds))

        solution = routing.SolveWithParameters(search_parameters)

        final_routes: List[List[int]] = [[] for _ in range(num_vehicles)]
        assigned_nodes = set()

        if solution:
            for v in range(num_vehicles):
                idx = routing.Start(v)
                v_route = []
                while not routing.IsEnd(idx):
                    node = manager.IndexToNode(idx)
                    if node >= num_warehouses and (dummy_end_node is None or node != dummy_end_node):
                        v_route.append(node)
                        assigned_nodes.add(node)
                    idx = solution.Value(routing.NextVar(idx))
                final_routes[v] = v_route

        final_dropped = [c for c in range(num_warehouses, num_nodes) if c not in assigned_nodes]

        return {
            "routes": final_routes,
            "dropped_nodes": final_dropped,
            "status": "success" if solution else "infeasible",
            "elapsed_seconds": round(time.time() - t0, 2),
            "solver": "Google OR-Tools VRPTW (Guided Local Search)"
        }

    def _compress_and_squeeze_routes(
        self,
        initial_solution: Dict[str, Any],
        distance_matrix: List[List[float]],
        demands: List[float],
        vehicle_capacities: List[float],
        depot_indices: List[int],
        num_warehouses: int,
        volume_demands: Optional[List[float]],
        vehicle_volume_capacities: Optional[List[float]],
        client_warehouses: Optional[List[str]],
        vehicle_warehouses: Optional[List[str]],
        vehicle_start_times: Optional[List[int]],
        vehicle_end_times: Optional[List[int]],
        client_time_windows: Optional[List[Tuple[int, int]]],
        client_rules: Optional[List[str]],
        vehicle_rules: Optional[List[str]],
        rules_matrix: Optional[List[Dict[str, Any]]],
        vehicle_max_stops: Optional[List[int]],
        client_service_times: Optional[List[int]],
        respect_time_windows: bool = True,
        balance_load: bool = False,
        vehicle_returns_to_depot: Optional[List[bool]] = None,
        client_cps: Optional[List[str]] = None,
        vehicle_names: Optional[List[str]] = None,
        operation_types: Optional[List[str]] = None,
        pickup_delivery_pairs: Optional[List[Tuple[int, int]]] = None,
        vehicle_speeds: Optional[List[float]] = None,
        multi_trip_pairs: Optional[List[Tuple[int, int, int]]] = None,
        soft_tw_tolerance_min: int = 0,
    ) -> Dict[str, Any]:
        """
        Multi-Pass Route Squeeze & Pairwise Fusion Engine:
        1. Absorbs small donor routes into larger compliant routes (incluindo pares From -> To atómicos).
        2. Fuses pairs of small regional routes into unified trucks.
        3. Rescues unassigned nodes (incluindo pares casados e sucatas P com curva dinâmica).
        4. Applies fast 2-opt TSP sequence polishing.
        """
        routes = [list(r) for r in initial_solution.get("routes", [])]
        num_vehicles = len(routes)

        v2_to_v1 = {v2: (v1, reload_m) for v1, v2, reload_m in (multi_trip_pairs or [])}
        v1_to_v2 = {v1: (v2, reload_m) for v1, v2, reload_m in (multi_trip_pairs or [])}
        pair_from_to = {p: d for p, d in (pickup_delivery_pairs or [])}
        pair_to_from = {d: p for p, d in (pickup_delivery_pairs or [])}

        def compute_route_finish_minutes(v_idx: int, stop_nodes: List[int], override_start: Optional[float] = None) -> float:
            v_start = float(override_start if override_start is not None else (vehicle_start_times[v_idx] if vehicle_start_times and v_idx < len(vehicle_start_times) else 390))
            if not stop_nodes:
                return v_start
            v_spd = float(vehicle_speeds[v_idx]) if (vehicle_speeds and v_idx < len(vehicle_speeds) and vehicle_speeds[v_idx]) else 50.0
            cur_t = v_start
            p_node = depot_indices[v_idx] if v_idx < len(depot_indices) else 0
            for n in stop_nodes:
                d = distance_matrix[p_node][n] * ROAD_FACTOR
                arr = cur_t + travel_time_minutes(d, base_speed=v_spd)
                if respect_time_windows and client_time_windows and n < len(client_time_windows):
                    w_s, _ = client_time_windows[n]
                    if arr < w_s:
                        arr = float(w_s)
                serv = client_service_times[n] if client_service_times and n < len(client_service_times) else 10
                cur_t = arr + serv
                p_node = n
            v_returns = vehicle_returns_to_depot[v_idx] if (vehicle_returns_to_depot and v_idx < len(vehicle_returns_to_depot)) else True
            if v_returns:
                d_ret = distance_matrix[p_node][depot_indices[v_idx]] * ROAD_FACTOR
                cur_t += travel_time_minutes(d_ret, base_speed=v_spd)
            return cur_t

        def evaluate_feasibility(v_idx: int, stop_nodes: List[int], current_routes_state: Optional[Dict[int, List[int]]] = None) -> Tuple[bool, float]:
            if not stop_nodes:
                return True, 0.0
            v_cap = vehicle_capacities[v_idx]
            v_vol_cap = vehicle_volume_capacities[v_idx] if vehicle_volume_capacities else 20000.0
            v_max_s = vehicle_max_stops[v_idx] if vehicle_max_stops else 40
            v_start = float(vehicle_start_times[v_idx] if vehicle_start_times and v_idx < len(vehicle_start_times) else 390)
            v_end = float(vehicle_end_times[v_idx] if vehicle_end_times and v_idx < len(vehicle_end_times) else 1080)
            v_r = vehicle_rules[v_idx] if vehicle_rules else ""
            v_wh = str(vehicle_warehouses[v_idx] if vehicle_warehouses else "").strip().lower()
            v_name = vehicle_names[v_idx] if vehicle_names and v_idx < len(vehicle_names) else ""
            v_spd = float(vehicle_speeds[v_idx]) if (vehicle_speeds and v_idx < len(vehicle_speeds) and vehicle_speeds[v_idx]) else 50.0

            # Se esta viatura for uma 2ª Volta (v2), a sua hora de partida real depende do regresso da 1ª Volta (v1)
            if v_idx in v2_to_v1:
                v1_idx, reload_m = v2_to_v1[v_idx]
                v1_stops = current_routes_state[v1_idx] if (current_routes_state and v1_idx in current_routes_state) else routes[v1_idx]
                if v1_stops:
                    v1_finish = compute_route_finish_minutes(v1_idx, v1_stops)
                    v_start = max(v_start, v1_finish + reload_m)

            if len(stop_nodes) > v_max_s:
                return False, 0.0

            # 1. Precedência e integridade estrita de pares casados (From -> To)
            if pickup_delivery_pairs:
                for p_node, d_node in pickup_delivery_pairs:
                    has_p = p_node in stop_nodes
                    has_d = d_node in stop_nodes
                    if has_p != has_d:
                        return False, 0.0
                    if has_p and has_d:
                        if stop_nodes.index(p_node) > stop_nodes.index(d_node):
                            return False, 0.0

            # 2. Avaliação de Carga Dinâmica Física (D, P, From, To)
            if operation_types or pickup_delivery_pairs:
                stops_load_data = []
                for n in stop_nodes:
                    op_n = operation_types[n] if (operation_types and n < len(operation_types)) else "D"
                    w_kg = demands[n] if n < len(demands) else 50.0
                    w_vol = volume_demands[n] if volume_demands and n < len(volume_demands) else 0.1
                    stops_load_data.append({"Tipo_Operacao": op_n, "Peso_KG": w_kg, "Volume_m3": w_vol})
                load_res = calculate_dynamic_route_loads(stops_load_data, vehicle_cap_kg=v_cap, vehicle_cap_vol=v_vol_cap)
                if load_res["has_overload"]:
                    return False, 0.0
            else:
                tot_kg = sum(demands[n] for n in stop_nodes)
                if tot_kg > v_cap:
                    return False, 0.0
                if volume_demands:
                    tot_vol = sum(volume_demands[n] for n in stop_nodes)
                    if tot_vol > v_vol_cap:
                        return False, 0.0

            cur_t = v_start
            p_node = depot_indices[v_idx]
            tot_dist = 0.0
            tol_min = max(1, int(soft_tw_tolerance_min))

            for n in stop_nodes:
                c_r = client_rules[n] if client_rules and n < len(client_rules) else ""
                c_cp = client_cps[n] if client_cps and n < len(client_cps) else ""
                c_wh = str(client_warehouses[n] if client_warehouses and n < len(client_warehouses) else "").strip().lower()
                if num_warehouses > 1 and c_wh and v_wh and c_wh not in ["armazém principal", "armazem principal", "n/a", "none", ""]:
                    if c_wh != v_wh and c_wh not in v_wh and v_wh not in c_wh:
                        return False, 0.0
                if not is_vehicle_compatible(v_r, c_r, rules_matrix, delivery_cp=c_cp, vehicle_name=v_name):
                    return False, 0.0

                d = distance_matrix[p_node][n] * ROAD_FACTOR
                tot_dist += d
                arr = cur_t + travel_time_minutes(d, base_speed=v_spd)

                if respect_time_windows and client_time_windows and n < len(client_time_windows):
                    w_s, w_e = client_time_windows[n]
                    if arr > (w_e + tol_min):
                        return False, 0.0
                    if arr < w_s:
                        # Rejeitar paragens onde a viatura chegue com mais de 30 minutos de avanço (não deixar motorista à espera)
                        if (w_s - arr) > 30:
                            return False, 0.0
                        arr = float(w_s)

                serv = client_service_times[n] if client_service_times and n < len(client_service_times) else 10
                cur_t = arr + serv
                p_node = n

            # Return to depot check
            v_returns = vehicle_returns_to_depot[v_idx] if (vehicle_returns_to_depot and v_idx < len(vehicle_returns_to_depot)) else True
            if v_returns:
                d_ret = distance_matrix[p_node][depot_indices[v_idx]] * ROAD_FACTOR
                tot_dist += d_ret
                ret_arr = cur_t + travel_time_minutes(d_ret, base_speed=v_spd)
                if ret_arr > (v_end + 1):
                    return False, 0.0
                finish_min = ret_arr
            else:
                if cur_t > (v_end + 1):
                    return False, 0.0
                finish_min = cur_t

            # Se esta viatura for uma 1ª Volta (v1) e a respetiva 2ª Volta (v2) tiver entregas,
            # garantir que o novo horário de fim da 1ª Volta não inviabiliza a 2ª Volta!
            if v_idx in v1_to_v2:
                v2_idx, reload_m = v1_to_v2[v_idx]
                v2_stops = current_routes_state[v2_idx] if (current_routes_state and v2_idx in current_routes_state) else routes[v2_idx]
                if v2_stops:
                    v2_base_start = float(vehicle_start_times[v2_idx] if vehicle_start_times and v2_idx < len(vehicle_start_times) else 780)
                    v2_eff_start = max(v2_base_start, finish_min + reload_m)
                    v2_finish = compute_route_finish_minutes(v2_idx, v2_stops, override_start=v2_eff_start)
                    v2_end_limit = float(vehicle_end_times[v2_idx] if vehicle_end_times and v2_idx < len(vehicle_end_times) else 1080)
                    if v2_finish > (v2_end_limit + 1):
                        return False, 0.0
                    # Verificar janelas da v2 com o novo arranque
                    if respect_time_windows and client_time_windows:
                        v2_spd = float(vehicle_speeds[v2_idx]) if (vehicle_speeds and v2_idx < len(vehicle_speeds) and vehicle_speeds[v2_idx]) else 50.0
                        t_sim = v2_eff_start
                        p_sim = depot_indices[v2_idx]
                        for n2 in v2_stops:
                            d2 = distance_matrix[p_sim][n2] * ROAD_FACTOR
                            arr2 = t_sim + travel_time_minutes(d2, base_speed=v2_spd)
                            if n2 < len(client_time_windows):
                                ws2, we2 = client_time_windows[n2]
                                if arr2 > (we2 + tol_min):
                                    return False, 0.0
                                if arr2 < ws2:
                                    if (ws2 - arr2) > 30:
                                        return False, 0.0
                                    arr2 = float(ws2)
                            s2 = client_service_times[n2] if client_service_times and n2 < len(client_service_times) else 10
                            t_sim = arr2 + s2
                            p_sim = n2

            return True, tot_dist

        def optimize_stops_2opt(v_idx: int, stops: List[int], current_routes_state: Optional[Dict[int, List[int]]] = None) -> List[int]:
            if len(stops) <= 2:
                return stops
            best_stops = list(stops)
            ok_best, best_dist = evaluate_feasibility(v_idx, best_stops, current_routes_state)
            if not ok_best:
                return stops
            improved = True
            iterations = 0
            while improved and iterations < 15:
                improved = False
                iterations += 1
                for i in range(len(best_stops) - 1):
                    for j in range(i + 1, len(best_stops)):
                        cand = best_stops[:i] + best_stops[i:j+1][::-1] + best_stops[j+1:]
                        ok_cand, cand_dist = evaluate_feasibility(v_idx, cand, current_routes_state)
                        if ok_cand and cand_dist < (best_dist - 0.01):
                            best_stops = cand
                            best_dist = cand_dist
                            improved = True
                            break
                    if improved:
                        break
            return best_stops

        def _try_insert_unit(target_v: int, curr_stops: List[int], unit: List[int], routes_state: Dict[int, List[int]]) -> Tuple[bool, float, Optional[List[int]]]:
            """
            Tenta inserir uma unidade atómica (1 paragem simples [n] ou 1 par casado [p_node, d_node])
            na melhor posição de curr_stops, aplicando 2-opt apenas ao vencedor para alta performance.
            """
            ok_base, base_dist = evaluate_feasibility(target_v, curr_stops, routes_state)
            if not ok_base:
                return False, float("inf"), None

            best_seq = None
            best_added = float("inf")

            if len(unit) == 1:
                stop_n = unit[0]
                for pos in range(len(curr_stops) + 1):
                    cand_stops = curr_stops[:pos] + [stop_n] + curr_stops[pos:]
                    ok_cand, cand_dist = evaluate_feasibility(target_v, cand_stops, routes_state)
                    if ok_cand:
                        added = cand_dist - base_dist
                        if added < best_added:
                            best_added = added
                            best_seq = cand_stops
            elif len(unit) == 2:
                p_node, d_node = unit[0], unit[1]
                n_len = len(curr_stops)
                for pos_p in range(n_len + 1):
                    with_p = curr_stops[:pos_p] + [p_node] + curr_stops[pos_p:]
                    for pos_d in range(pos_p + 1, len(with_p) + 1):
                        cand_stops = with_p[:pos_d] + [d_node] + with_p[pos_d:]
                        ok_cand, cand_dist = evaluate_feasibility(target_v, cand_stops, routes_state)
                        if ok_cand:
                            added = cand_dist - base_dist
                            if added < best_added:
                                best_added = added
                                best_seq = cand_stops

            if best_seq is not None:
                polished = optimize_stops_2opt(target_v, best_seq, routes_state)
                ok_pol, pol_dist = evaluate_feasibility(target_v, polished, routes_state)
                if ok_pol:
                    return True, pol_dist - base_dist, polished
                return True, best_added, best_seq

            return False, float("inf"), None

        # Compression & Fusion Loop (Apenas ativo quando NÃO se pede balanceamento de frota)
        changed = not balance_load
        while changed:
            changed = False
            active_indices = [v for v, r in enumerate(routes) if len(r) > 0]
            sorted_candidates = sorted(active_indices, key=lambda v: len(routes[v]))

            # 1. Multi-Pass Absorption (Suporta nós simples e pares casados From -> To)
            for donor_v in sorted_candidates:
                donor_stops = list(routes[donor_v])
                if not donor_stops:
                    continue

                # Agrupar paragens da rota doadora em unidades atómicas (par [From, To] ou simples [n])
                donor_units: List[List[int]] = []
                visited_in_donor = set()
                for n in donor_stops:
                    if n in visited_in_donor:
                        continue
                    if n in pair_from_to and pair_from_to[n] in donor_stops:
                        d_partner = pair_from_to[n]
                        donor_units.append([n, d_partner])
                        visited_in_donor.add(n)
                        visited_in_donor.add(d_partner)
                    elif n in pair_to_from and pair_to_from[n] in donor_stops:
                        p_partner = pair_to_from[n]
                        donor_units.append([p_partner, n])
                        visited_in_donor.add(p_partner)
                        visited_in_donor.add(n)
                    else:
                        donor_units.append([n])
                        visited_in_donor.add(n)

                test_routes = {v: list(routes[v]) for v in range(num_vehicles)}
                test_routes[donor_v] = []
                all_inserted = True

                for unit in donor_units:
                    best_target_v = None
                    best_stops_seq = None
                    best_added_dist = float("inf")

                    for target_v in active_indices:
                        if target_v == donor_v:
                            continue
                        curr_stops = test_routes[target_v]
                        ok_ins, added_d, cand_opt = _try_insert_unit(target_v, curr_stops, unit, test_routes)
                        if ok_ins and added_d < best_added_dist:
                            best_added_dist = added_d
                            best_target_v = target_v
                            best_stops_seq = cand_opt

                    if best_target_v is not None and best_stops_seq is not None:
                        test_routes[best_target_v] = best_stops_seq
                    else:
                        all_inserted = False
                        break

                if all_inserted:
                    for v_k, v_stops in test_routes.items():
                        routes[v_k] = v_stops
                    changed = True
                    break

            if changed:
                continue

            # 2. Pairwise Regional Route Fusion (Merge R_A + R_B -> Single Vehicle)
            active_indices = [v for v, r in enumerate(routes) if len(r) > 0]
            sorted_candidates = sorted(active_indices, key=lambda v: len(routes[v]))

            for i in range(len(sorted_candidates)):
                v_a = sorted_candidates[i]
                stops_a = routes[v_a]
                if not stops_a or len(stops_a) > 12:
                    continue

                for j in range(i + 1, len(sorted_candidates)):
                    v_b = sorted_candidates[j]
                    stops_b = routes[v_b]
                    if not stops_b or len(stops_b) > 12:
                        continue

                    # Não fundir 1ª Volta e 2ª Volta do mesmo carro numa única volta se exceder turno
                    test_state_a = {v: list(routes[v]) for v in range(num_vehicles)}
                    test_state_a[v_b] = []
                    merged_a = optimize_stops_2opt(v_a, stops_a + stops_b, test_state_a)
                    ok_a, _ = evaluate_feasibility(v_a, merged_a, test_state_a)
                    if ok_a:
                        routes[v_a] = merged_a
                        routes[v_b] = []
                        changed = True
                        break

                    test_state_b = {v: list(routes[v]) for v in range(num_vehicles)}
                    test_state_b[v_a] = []
                    merged_b = optimize_stops_2opt(v_b, stops_b + stops_a, test_state_b)
                    ok_b, _ = evaluate_feasibility(v_b, merged_b, test_state_b)
                    if ok_b:
                        routes[v_b] = merged_b
                        routes[v_a] = []
                        changed = True
                        break

                if changed:
                    break

        # Phase 2.5: Active Greedy Absorption for Unassigned Clients (Suporta Pares Casados e Curva Dinâmica)
        assigned_nodes = {n for r in routes for n in r}
        num_nodes = len(distance_matrix)
        unassigned_raw = [c for c in range(num_warehouses, num_nodes) if c not in assigned_nodes]

        if unassigned_raw:
            d_zero = depot_indices[0] if depot_indices else 0
            # Ordenar por maior distância ao armazém primeiro (Regra de Ouro: salvar clientes mais distantes primeiro!)
            unassigned_raw.sort(key=lambda c: distance_matrix[d_zero][c], reverse=True)

            unassigned_units: List[List[int]] = []
            seen_unassigned = set()
            for c in unassigned_raw:
                if c in seen_unassigned:
                    continue
                if c in pair_from_to:
                    d_partner = pair_from_to[c]
                    if d_partner not in assigned_nodes:
                        unassigned_units.append([c, d_partner])
                        seen_unassigned.add(c)
                        seen_unassigned.add(d_partner)
                elif c in pair_to_from:
                    p_partner = pair_to_from[c]
                    if p_partner not in assigned_nodes:
                        unassigned_units.append([p_partner, c])
                        seen_unassigned.add(p_partner)
                        seen_unassigned.add(c)
                else:
                    unassigned_units.append([c])
                    seen_unassigned.add(c)

            for unit in unassigned_units:
                best_v = None
                best_cand_seq = None
                best_extra_km = float("inf")
                routes_state = {v: list(routes[v]) for v in range(num_vehicles)}

                for v in range(num_vehicles):
                    curr_stops = routes[v]
                    v_max = vehicle_max_stops[v] if vehicle_max_stops and v < len(vehicle_max_stops) else 30
                    if len(curr_stops) + len(unit) > v_max:
                        continue

                    ok_ins, added_km, cand_seq = _try_insert_unit(v, curr_stops, unit, routes_state)
                    if ok_ins and added_km < best_extra_km:
                        best_extra_km = added_km
                        best_v = v
                        best_cand_seq = cand_seq

                if best_v is not None and best_cand_seq is not None:
                    routes[best_v] = best_cand_seq
                    for n_u in unit:
                        assigned_nodes.add(n_u)

        # Final 2-Opt Polish on all active routes
        final_state = {v: list(routes[v]) for v in range(num_vehicles)}
        for v in range(num_vehicles):
            if routes[v]:
                routes[v] = optimize_stops_2opt(v, routes[v], final_state)
                final_state[v] = routes[v]

        final_assigned = {n for r in routes for n in r}
        final_dropped = [c for c in range(num_warehouses, num_nodes) if c not in final_assigned]

        return {
            "routes": routes,
            "dropped_nodes": final_dropped,
            "status": "success",
            "elapsed_seconds": initial_solution.get("elapsed_seconds", 0.0),
            "solver": "Google OR-Tools VRPTW + Multi-Pass Squeeze & Dynamic Load Engine"
        }
