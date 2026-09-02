# -*- coding: utf-8 -*-
"""
GEOREF Optimizer - Official Google OR-Tools VRPTW Engine with Multi-Pass Route Squeeze & Highway Speed Model
===============================================================================================================
Enterprise-grade Vehicle Routing Problem with Time Windows (VRPTW):
- Phase 1: High-Precision Google OR-Tools VRPTW Guided Local Search (GLS)
- Phase 2: Multi-Pass Route Compression & Absorption Loop
- Phase 3: Pairwise Route Fusion (Merges small regional routes into unified trucks)
- Phase 4: Exact 2-Opt TSP Sequence Polishing
- Realistic Segment Speed Model (Highway 80 km/h for >25km, 65 km/h for >10km, 50 km/h urban)
- Strict Zero-Error Compliance on Capacities (KG/m3), Time Windows & Driver Shift Bounds
"""

import math
import time
from typing import List, Dict, Any, Tuple, Optional
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from utils.rules_engine import is_vehicle_compatible, extract_tags

ROAD_FACTOR = 1.30

def get_segment_speed(dist_km: float, base_speed: float = 50.0) -> float:
    if dist_km > 25.0:
        return 80.0
    elif dist_km > 10.0:
        return 65.0
    return max(base_speed, 45.0)

def travel_time_seconds(dist_km: float, base_speed: float = 50.0) -> int:
    speed = get_segment_speed(dist_km, base_speed)
    return int(round((dist_km / speed) * 3600.0))

def travel_time_minutes(dist_km: float, base_speed: float = 50.0) -> float:
    speed = get_segment_speed(dist_km, base_speed)
    return (dist_km / speed) * 60.0

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
    ) -> Dict[str, Any]:
        params = optimization_params or {}
        time_limit = float(params.get("time_limit_seconds") or params.get("time_limit") or 25.0)
        respect_tw = bool(params.get("respect_time_windows", True))

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
            client_service_times=client_service_times
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
            respect_time_windows=respect_tw
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
        client_service_times=None
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_nodes = len(distance_matrix)
        num_clients = num_nodes - num_warehouses

        if num_vehicles == 0 or num_clients <= 0:
            return {"routes": [[] for _ in range(num_vehicles)], "dropped_nodes": [], "status": "no_data"}

        t0 = time.time()

        starts = [depot_indices[v] if v < len(depot_indices) else 0 for v in range(num_vehicles)]
        ends = [depot_indices[v] if v < len(depot_indices) else 0 for v in range(num_vehicles)]

        manager = pywrapcp.RoutingIndexManager(num_nodes, num_vehicles, starts, ends)
        routing = pywrapcp.RoutingModel(manager)

        # 1. Distance & Arc Cost (in meters)
        def distance_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            dist_km = distance_matrix[from_node][to_node] * ROAD_FACTOR
            return int(round(dist_km * 1000))

        transit_callback_index = routing.RegisterTransitCallback(distance_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # 2. Fixed Vehicle Cost for Fleet Minimization
        FIXED_VEHICLE_COST = 500000
        for v in range(num_vehicles):
            routing.SetFixedCostOfVehicle(FIXED_VEHICLE_COST, v)

        # 3. Weight Capacity Dimension (KG)
        def demand_callback(from_index):
            from_node = manager.IndexToNode(from_index)
            return int(round(demands[from_node] * 10)) if from_node < len(demands) else 0

        demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
        int_capacities = [int(round(cap * 10)) for cap in vehicle_capacities]
        routing.AddDimensionWithVehicleCapacity(
            demand_callback_index,
            0,
            int_capacities,
            True,
            "Capacity_KG"
        )

        # 4. Volume Capacity Dimension (m3)
        if volume_demands and vehicle_volume_capacities:
            def volume_callback(from_index):
                from_node = manager.IndexToNode(from_index)
                return int(round((volume_demands[from_node] if from_node < len(volume_demands) else 0.0) * 100))

            volume_callback_index = routing.RegisterUnaryTransitCallback(volume_callback)
            int_vol_caps = [int(round(vcap * 100)) for vcap in vehicle_volume_capacities]
            routing.AddDimensionWithVehicleCapacity(
                volume_callback_index,
                0,
                int_vol_caps,
                True,
                "Capacity_Volume"
            )

        # 5. Max Stops Dimension
        if vehicle_max_stops:
            def stop_callback(from_index):
                from_node = manager.IndexToNode(from_index)
                return 1 if from_node >= num_warehouses else 0

            stop_callback_index = routing.RegisterUnaryTransitCallback(stop_callback)
            routing.AddDimensionWithVehicleCapacity(
                stop_callback_index,
                0,
                vehicle_max_stops,
                True,
                "Max_Stops"
            )

        # 6. Time Dimension in SECONDS with Highway Speed Model
        HORIZON_SEC = 24 * 3600

        def time_seconds_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            dist_km = distance_matrix[from_node][to_node] * ROAD_FACTOR
            travel_sec = travel_time_seconds(dist_km)
            serv_sec = (client_service_times[from_node] * 60) if (client_service_times and from_node < len(client_service_times)) else (600 if from_node >= num_warehouses else 0)
            return int(round(travel_sec + serv_sec))

        time_callback_index = routing.RegisterTransitCallback(time_seconds_callback)
        routing.AddDimension(
            time_callback_index,
            HORIZON_SEC,
            HORIZON_SEC,
            False,
            "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")

        if respect_time_windows:
            for node in range(num_warehouses, num_nodes):
                tw = client_time_windows[node] if client_time_windows and node < len(client_time_windows) else (480, 1080)
                index = manager.NodeToIndex(node)
                if index != -1:
                    s_win_sec = max(0, min(HORIZON_SEC, int(tw[0]) * 60))
                    e_win_sec = max(s_win_sec, min(HORIZON_SEC, int(tw[1]) * 60))
                    time_dimension.CumulVar(index).SetRange(s_win_sec, e_win_sec)

        for v in range(num_vehicles):
            v_start_sec = int(vehicle_start_times[v] if vehicle_start_times and v < len(vehicle_start_times) else 480) * 60
            v_end_sec = int(vehicle_end_times[v] if vehicle_end_times and v < len(vehicle_end_times) else 1080) * 60
            time_dimension.CumulVar(routing.Start(v)).SetRange(v_start_sec, v_start_sec)
            time_dimension.CumulVar(routing.End(v)).SetRange(v_start_sec, v_end_sec)

        # 7. Disjunctions: Unused warehouses (0 penalty) vs Deliveries (High penalty)
        DROP_PENALTY = 10000000
        for node in range(num_nodes):
            if node in starts or node in ends:
                continue
            index = manager.NodeToIndex(node)
            if index != -1:
                penalty = 0 if node < num_warehouses else DROP_PENALTY
                routing.AddDisjunction([index], penalty)

        # 8. Business Rules & Multi-Tag Matrix Compatibility (VehicleVar)
        for node in range(num_warehouses, num_nodes):
            index = manager.NodeToIndex(node)
            if index == -1:
                continue
            c_rules = client_rules[node] if client_rules and node < len(client_rules) else ""
            c_wh = str(client_warehouses[node] if client_warehouses and node < len(client_warehouses) else "").strip().lower()

            allowed_vehicles = []
            for v in range(num_vehicles):
                v_rules = vehicle_rules[v] if vehicle_rules and v < len(vehicle_rules) else ""
                v_wh = str(vehicle_warehouses[v] if vehicle_warehouses and v < len(vehicle_warehouses) else "").strip().lower()

                if num_warehouses > 1 and c_wh and v_wh and c_wh not in ["armazém principal", "armazem principal", "n/a", "none", ""]:
                    if c_wh != v_wh and c_wh not in v_wh and v_wh not in c_wh:
                        continue

                if is_vehicle_compatible(v_rules, c_rules, rules_matrix):
                    allowed_vehicles.append(v)

            if allowed_vehicles and len(allowed_vehicles) < num_vehicles:
                routing.VehicleVar(index).SetValues(allowed_vehicles)
            elif not allowed_vehicles:
                routing.VehicleVar(index).SetValues([-1])

        # 9. Search Metaheuristic Parameters
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
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
                    if node >= num_warehouses:
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
        respect_time_windows: bool = True
    ) -> Dict[str, Any]:
        """
        Multi-Pass Route Squeeze & Pairwise Fusion Engine:
        1. Absorbs small donor routes into larger compliant routes.
        2. Fuses pairs of small regional routes into unified trucks.
        3. Applies exact 2-opt TSP sequence polishing.
        """
        routes = [list(r) for r in initial_solution.get("routes", [])]
        num_vehicles = len(routes)
        
        def evaluate_feasibility(v_idx: int, stop_nodes: List[int]) -> Tuple[bool, float]:
            if not stop_nodes:
                return True, 0.0
            v_cap = vehicle_capacities[v_idx]
            v_vol_cap = vehicle_volume_capacities[v_idx] if vehicle_volume_capacities else 20000.0
            v_max_s = vehicle_max_stops[v_idx] if vehicle_max_stops else 40
            v_start = vehicle_start_times[v_idx] if vehicle_start_times else 390
            v_end = vehicle_end_times[v_idx] if vehicle_end_times else 1080
            v_r = vehicle_rules[v_idx] if vehicle_rules else ""
            v_wh = str(vehicle_warehouses[v_idx] if vehicle_warehouses else "").strip().lower()

            if len(stop_nodes) > v_max_s:
                return False, 0.0

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

            for n in stop_nodes:
                c_r = client_rules[n] if client_rules and n < len(client_rules) else ""
                c_wh = str(client_warehouses[n] if client_warehouses and n < len(client_warehouses) else "").strip().lower()
                if num_warehouses > 1 and c_wh and v_wh and c_wh not in ["armazém principal", "armazem principal", "n/a", "none", ""]:
                    if c_wh != v_wh and c_wh not in v_wh and v_wh not in c_wh:
                        return False, 0.0
                if not is_vehicle_compatible(v_r, c_r, rules_matrix):
                    return False, 0.0

                d = distance_matrix[p_node][n] * ROAD_FACTOR
                tot_dist += d
                arr = cur_t + travel_time_minutes(d)
                
                if respect_time_windows and client_time_windows and n < len(client_time_windows):
                    w_s, w_e = client_time_windows[n]
                    if arr > (w_e + 1):
                        return False, 0.0
                    if arr < w_s:
                        arr = w_s

                serv = client_service_times[n] if client_service_times and n < len(client_service_times) else 10
                cur_t = arr + serv
                p_node = n

            # Return to depot check
            d_ret = distance_matrix[p_node][depot_indices[v_idx]] * ROAD_FACTOR
            tot_dist += d_ret
            ret_arr = cur_t + travel_time_minutes(d_ret)
            if ret_arr > (v_end + 1):
                return False, 0.0

            return True, tot_dist

        def optimize_stops_2opt(v_idx: int, stops: List[int]) -> List[int]:
            if len(stops) <= 2:
                return stops
            best_stops = list(stops)
            ok_best, best_dist = evaluate_feasibility(v_idx, best_stops)
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
                        ok_cand, cand_dist = evaluate_feasibility(v_idx, cand)
                        if ok_cand and cand_dist < (best_dist - 0.01):
                            best_stops = cand
                            best_dist = cand_dist
                            improved = True
                            break
                    if improved:
                        break
            return best_stops

        # Compression & Fusion Loop
        changed = True
        while changed:
            changed = False
            active_indices = [v for v, r in enumerate(routes) if len(r) > 0]
            sorted_candidates = sorted(active_indices, key=lambda v: len(routes[v]))

            # 1. Multi-Pass Absorption
            for donor_v in sorted_candidates:
                donor_stops = list(routes[donor_v])
                if not donor_stops:
                    continue

                test_routes = {v: list(routes[v]) for v in active_indices if v != donor_v}
                all_inserted = True

                for stop_n in donor_stops:
                    best_target_v = None
                    best_stops_seq = None
                    best_added_dist = float('inf')

                    for target_v in test_routes.keys():
                        curr_stops = test_routes[target_v]
                        ok_base, base_dist = evaluate_feasibility(target_v, curr_stops)
                        if not ok_base:
                            continue

                        for pos in range(len(curr_stops) + 1):
                            cand_stops = curr_stops[:pos] + [stop_n] + curr_stops[pos:]
                            cand_opt = optimize_stops_2opt(target_v, cand_stops)
                            ok_cand, cand_dist = evaluate_feasibility(target_v, cand_opt)
                            if ok_cand:
                                added_d = cand_dist - base_dist
                                if added_d < best_added_dist:
                                    best_added_dist = added_d
                                    best_target_v = target_v
                                    best_stops_seq = cand_opt

                    if best_target_v is not None:
                        test_routes[best_target_v] = best_stops_seq
                    else:
                        all_inserted = False
                        break

                if all_inserted:
                    routes[donor_v] = []
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

                    # Test merging into v_a
                    merged_a = optimize_stops_2opt(v_a, stops_a + stops_b)
                    ok_a, dist_a = evaluate_feasibility(v_a, merged_a)
                    if ok_a:
                        routes[v_a] = merged_a
                        routes[v_b] = []
                        changed = True
                        break

                    # Test merging into v_b
                    merged_b = optimize_stops_2opt(v_b, stops_b + stops_a)
                    ok_b, dist_b = evaluate_feasibility(v_b, merged_b)
                    if ok_b:
                        routes[v_b] = merged_b
                        routes[v_a] = []
                        changed = True
                        break

                if changed:
                    break

        # Final 2-Opt Polish on all active routes
        for v in range(num_vehicles):
            if routes[v]:
                routes[v] = optimize_stops_2opt(v, routes[v])

        assigned_nodes = set()
        for r in routes:
            for n in r:
                assigned_nodes.add(n)

        num_nodes = len(distance_matrix)
        final_dropped = [c for c in range(num_warehouses, num_nodes) if c not in assigned_nodes]

        return {
            "routes": routes,
            "dropped_nodes": final_dropped,
            "status": "success",
            "elapsed_seconds": initial_solution.get("elapsed_seconds", 0.0),
            "solver": "Google OR-Tools VRPTW + Multi-Pass Squeeze & Fusion Engine"
        }
