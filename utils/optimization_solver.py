from utils.rules_engine import is_vehicle_compatible, extract_tags
import numpy as np
import math
from typing import List, Dict, Any, Tuple, Optional
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

def _safe_int_scale(arr, factor=100):
    if arr is None:
        return []
    return [int(round(float(x) * factor)) for x in arr]

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
        rules_matrix: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Pure Distance-Matrix VRP & Far-First Clustering Optimizer:
        Uses full (N x N) distance matrix D[i][j] (Depot + Clients).
        """
        params = optimization_params or {}
        strategy = str(params.get("strategy", "distance") or "distance").lower()
        load_mode = str(params.get("load_mode", "full") or "full").lower()
        balance_weight = float(params.get("balance_weight", 0.0) or 0.0)
        
        if load_mode in ["balanced", "equilibrado"] and balance_weight <= 0:
            balance_weight = 50.0

        if strategy in ["far_first", "zona", "zonas", "radial"]:
            return self._solve_far_first_matrix_clustering(
                distance_matrix, demands, vehicle_capacities, depot_indices,
                num_warehouses, volume_demands, vehicle_volume_capacities,
                client_warehouses, vehicle_warehouses,
                vehicle_start_times, vehicle_end_times, client_time_windows,
                balance_weight=balance_weight, load_mode=load_mode
            )
        else:
            return self._solve_ortools_vrp_savings(
                distance_matrix, demands, vehicle_capacities, depot_indices,
                optimization_params=params,
                volume_demands=volume_demands,
                vehicle_volume_capacities=vehicle_volume_capacities,
                client_warehouses=client_warehouses,
                vehicle_warehouses=vehicle_warehouses,
                num_warehouses=num_warehouses,
                vehicle_start_times=vehicle_start_times,
                vehicle_end_times=vehicle_end_times,
                client_time_windows=client_time_windows,
                balance_weight=balance_weight
            )

    def _solve_ortools_vrp_savings(
        self,
        distance_matrix: List[List[float]],
        demands: List[float],
        vehicle_capacities: List[float],
        depot_indices: List[int],
        optimization_params: Dict[str, Any],
        volume_demands: Optional[List[float]],
        vehicle_volume_capacities: Optional[List[float]],
        client_warehouses: Optional[List[str]],
        vehicle_warehouses: Optional[List[str]],
        num_warehouses: int,
        vehicle_start_times: Optional[List[int]],
        vehicle_end_times: Optional[List[int]],
        client_time_windows: Optional[List[Tuple[int, int]]],
        balance_weight: float = 0.0,
        client_rules: Optional[List[str]] = None,
        vehicle_rules: Optional[List[str]] = None,
        rules_matrix: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        num_locations = len(distance_matrix)
        num_vehicles = len(vehicle_capacities)
        
        if num_locations <= num_warehouses or num_vehicles == 0:
            return {
                "routes": [[depot_indices[i], depot_indices[i]] for i in range(num_vehicles)],
                "dropped_nodes": [],
                "total_distance": 0.0,
                "route_distances": [0.0] * num_vehicles,
                "route_loads": [0.0] * num_vehicles,
                "route_volumes": [0.0] * num_vehicles,
                "route_times": [0.0] * num_vehicles,
                "status": "EMPTY"
            }

        v_starts = vehicle_start_times if vehicle_start_times else [590] * num_vehicles
        v_ends = vehicle_end_times if vehicle_end_times else [1080] * num_vehicles
        time_limit = int(optimization_params.get("time_limit_seconds", optimization_params.get("time_limit", 15)))

        try:
            starts = [int(depot_indices[i]) for i in range(num_vehicles)]
            ends = [int(depot_indices[i]) for i in range(num_vehicles)]
            
            self.manager = pywrapcp.RoutingIndexManager(num_locations, num_vehicles, starts, ends)
            self.routing = pywrapcp.RoutingModel(self.manager)
            
            # 1. Distance callback & cost on Matrix D[i][j]
            def distance_callback(from_index, to_index):
                try:
                    from_node = self.manager.IndexToNode(from_index)
                    to_node = self.manager.IndexToNode(to_index)
                    if 0 <= from_node < len(distance_matrix) and 0 <= to_node < len(distance_matrix[0]):
                        return int(round(float(distance_matrix[from_node][to_node]) * 100))
                except Exception:
                    pass
                return 0
                
            transit_callback_index = self.routing.RegisterTransitCallback(distance_callback)
            self.routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
            
            # 2. Weight Capacity Dimension
            clean_demands = _safe_int_scale(demands)
            clean_capacities = _safe_int_scale(vehicle_capacities)
            clean_capacities = [max(100, c) for c in clean_capacities]
            
            def demand_callback(from_index):
                try:
                    from_node = self.manager.IndexToNode(from_index)
                    if 0 <= from_node < len(clean_demands):
                        return clean_demands[from_node]
                except Exception:
                    pass
                return 0
                
            demand_callback_index = self.routing.RegisterUnaryTransitCallback(demand_callback)
            self.routing.AddDimensionWithVehicleCapacity(
                demand_callback_index,
                0,
                clean_capacities,
                True,
                'Capacity'
            )
            
            if balance_weight > 0:
                cap_dimension = self.routing.GetDimensionOrDie('Capacity')
                cap_dimension.SetGlobalSpanCostCoefficient(int(balance_weight * 50))
            
            # 3. Volume Dimension
            if volume_demands is not None and vehicle_volume_capacities is not None:
                clean_v_demands = _safe_int_scale(volume_demands)
                clean_v_capacities = _safe_int_scale(vehicle_volume_capacities)
                clean_v_capacities = [max(10, vc) for vc in clean_v_capacities]
                
                def volume_callback(from_index):
                    try:
                        from_node = self.manager.IndexToNode(from_index)
                        if 0 <= from_node < len(clean_v_demands):
                            return clean_v_demands[from_node]
                    except Exception:
                        pass
                    return 0
                        
                volume_callback_index = self.routing.RegisterUnaryTransitCallback(volume_callback)
                self.routing.AddDimensionWithVehicleCapacity(
                    volume_callback_index,
                    0,
                    clean_v_capacities,
                    True,
                    'Volume'
                )
                
            # 4. Time Dimension
            def time_callback(from_index, to_index):
                try:
                    from_node = self.manager.IndexToNode(from_index)
                    to_node = self.manager.IndexToNode(to_index)
                    if 0 <= from_node < len(distance_matrix) and 0 <= to_node < len(distance_matrix[0]):
                        dist = float(distance_matrix[from_node][to_node])
                        travel_min = (dist / 45.0) * 60.0
                        service_min = 15.0 if from_node >= num_warehouses else 0.0
                        return int((travel_min + service_min) * 100)
                except Exception:
                    pass
                return 0
                
            time_callback_index = self.routing.RegisterTransitCallback(time_callback)
            horizon_scaled = int(1440 * 100)
            self.routing.AddDimension(
                time_callback_index,
                horizon_scaled,
                horizon_scaled,
                False,
                'Time'
            )
            
            time_dimension = self.routing.GetDimensionOrDie('Time')
            
            for vehicle_id in range(num_vehicles):
                s_min = v_starts[vehicle_id]
                e_min = v_ends[vehicle_id]
                start_idx = self.routing.Start(vehicle_id)
                end_idx = self.routing.End(vehicle_id)
                
                if e_min <= s_min:
                    time_dimension.CumulVar(start_idx).SetRange(0, 0)
                    time_dimension.CumulVar(end_idx).SetRange(0, 0)
                else:
                    time_dimension.CumulVar(start_idx).SetRange(s_min * 100, s_min * 100)
                    time_dimension.SetCumulVarSoftUpperBound(end_idx, e_min * 100, 50000)
                    
            # 5. Client Time Windows & Disjunctions
            base_penalty = 5000000
            ref_depot = depot_indices[0] if depot_indices else 0
            
            for node_idx in range(num_warehouses, num_locations):
                model_idx = self.manager.NodeToIndex(node_idx)
                if model_idx != -1:
                    dist_to_depot = float(distance_matrix[ref_depot][node_idx])
                    dynamic_penalty = int(base_penalty + (dist_to_depot * 2000.0))
                    self.routing.AddDisjunction([model_idx], dynamic_penalty)
                    
                    if client_time_windows and (node_idx - num_warehouses) < len(client_time_windows):
                        c_start, c_end = client_time_windows[node_idx - num_warehouses]
                        if c_end > c_start:
                            time_dimension.CumulVar(model_idx).SetRange(c_start * 100, horizon_scaled)
                            time_dimension.SetCumulVarSoftUpperBound(model_idx, c_end * 100, 200000)

            # 6. Warehouse & Multi-Tag Rule Routing Restrictions
            for location_idx in range(num_warehouses, num_locations):
                client_idx = location_idx - num_warehouses
                allowed_vehicles = []
                c_wh = str(client_warehouses[client_idx]).strip() if (client_warehouses and client_idx < len(client_warehouses)) else ""
                c_rule = str(client_rules[client_idx]).strip() if (client_rules and client_idx < len(client_rules)) else ""
                
                for v_idx in range(num_vehicles):
                    # Check warehouse compatibility
                    if vehicle_warehouses and c_wh and c_wh.upper() not in ["", "N/A", "NONE", "NAN"]:
                        v_wh = str(vehicle_warehouses[v_idx]).strip()
                        if v_wh.lower() != c_wh.lower():
                            continue
                            
                    # Check Multi-Tag rule compatibility
                    v_rule = str(vehicle_rules[v_idx]).strip() if (vehicle_rules and v_idx < len(vehicle_rules)) else ""
                    if not is_vehicle_compatible(v_rule, c_rule, rules_matrix):
                        continue
                        
                    allowed_vehicles.append(v_idx)
                    
                if allowed_vehicles and len(allowed_vehicles) < num_vehicles:
                    node_idx_in_model = self.manager.NodeToIndex(location_idx)
                    if node_idx_in_model != -1:
                        self.routing.VehicleVar(node_idx_in_model).SetValues(allowed_vehicles)

            # 7. Search Parameters: CLARKE-WRIGHT SAVINGS STRATEGY
            search_parameters = pywrapcp.DefaultRoutingSearchParameters()
            search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.SAVINGS
            search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
            search_parameters.time_limit.seconds = max(3, min(time_limit, 30))
            
            solution = self.routing.SolveWithParameters(search_parameters)
            
            if solution:
                return self._extract_solution(
                    solution, num_vehicles, num_locations, num_warehouses,
                    distance_matrix, demands, volume_demands
                )
        except Exception as e:
            print(f"[OR-Tools Savings Error: {e}] Falling back to matrix clustering.")
            
        return self._solve_far_first_matrix_clustering(
            distance_matrix, demands, vehicle_capacities, depot_indices,
            num_warehouses, volume_demands, vehicle_volume_capacities,
            client_warehouses, vehicle_warehouses,
            v_starts, v_ends, client_time_windows,
            balance_weight=balance_weight, load_mode="full"
        )

    def _solve_far_first_matrix_clustering(
        self,
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
        balance_weight: float = 0.0,
        load_mode: str = "full"
    ) -> Dict[str, Any]:
        """
        PURE DISTANCE-MATRIX FAR-FIRST & SAVINGS CLUSTERING:
        1. Uses D[depot][c] to identify the outermost unassigned client.
        2. Recruits unassigned clients k that minimize D[c, k] (closest pair in distance matrix).
        3. Enforces that neighboring nodes in distance matrix are packed into the same vehicle.
        4. Sequences each vehicle using 2-Opt and window feasibility.
        """
        num_vehicles = len(vehicle_capacities)
        num_locations = len(distance_matrix)
        
        v_starts = vehicle_start_times if vehicle_start_times else [590] * num_vehicles
        v_ends = vehicle_end_times if vehicle_end_times else [1080] * num_vehicles
        
        active_vehicle_indices = [
            v for v in range(num_vehicles)
            if v_ends[v] > v_starts[v] and float(vehicle_capacities[v]) > 0
        ]
        active_vehicle_indices.sort(key=lambda v: (v_starts[v], -float(vehicle_capacities[v])))
        
        unassigned_clients = list(range(num_warehouses, num_locations))
        
        # Precompute distance to depot from matrix D
        depot_dists = {}
        for c in unassigned_clients:
            c_idx = c - num_warehouses
            target_wh = client_warehouses[c_idx] if client_warehouses and c_idx < len(client_warehouses) else None
            depot_node = 0
            if vehicle_warehouses and target_wh:
                for vi, v_wh in enumerate(vehicle_warehouses):
                    if str(v_wh).strip().lower() == str(target_wh).strip().lower():
                        depot_node = depot_indices[vi]
                        break
            
            depot_dists[c] = {
                "dist": float(distance_matrix[depot_node][c]),
                "depot": depot_node,
                "target_wh": target_wh
            }

        total_demand = sum(demands[c] for c in unassigned_clients if c < len(demands))
        avg_target_load = (total_demand / max(1, len(active_vehicle_indices))) * 1.15 if load_mode in ["balanced", "equilibrado"] else 999999.0

        vehicle_routes = {v: [] for v in range(num_vehicles)}
        
        for v in active_vehicle_indices:
            if not unassigned_clients:
                break
                
            depot = depot_indices[v]
            v_wh = vehicle_warehouses[v] if vehicle_warehouses and v < len(vehicle_warehouses) else None
            max_kg = float(vehicle_capacities[v])
            max_vol = float(vehicle_volume_capacities[v]) if vehicle_volume_capacities and v < len(vehicle_volume_capacities) else 999999.0
            
            effective_cap_kg = min(max_kg, avg_target_load) if load_mode in ["balanced", "equilibrado"] else max_kg
            shift_duration_min = max(60, v_ends[v] - v_starts[v])
            
            eligible = [
                c for c in unassigned_clients
                if not depot_dists[c]["target_wh"] or not v_wh or str(depot_dists[c]["target_wh"]).strip().lower() == str(v_wh).strip().lower()
            ]
            if not eligible:
                continue
                
            # 1. Outermost client from matrix D[depot][c]
            eligible.sort(key=lambda c: depot_dists[c]["dist"], reverse=True)
            seed = eligible[0]
            
            assigned_to_v = [seed]
            unassigned_clients.remove(seed)
            cur_kg = float(demands[seed]) if seed < len(demands) else 0.0
            cur_vol = float(volume_demands[seed]) if volume_demands and seed < len(volume_demands) else 0.0
            
            # 2. Recruit closest unassigned clients enforcing CAPACITY AND TIME WINDOWS
            current_time = v_starts[v]
            current_node = seed
            win_s = client_time_windows[seed - num_warehouses][0] if client_time_windows and (seed - num_warehouses) < len(client_time_windows) else 0
            dist_to_seed = float(distance_matrix[depot][seed])
            t_arr_seed = current_time + (dist_to_seed / 45.0) * 60.0
            current_time = max(t_arr_seed, win_s) + 15.0
            
            while unassigned_clients:
                rem_eligible = [
                    c for c in unassigned_clients
                    if not depot_dists[c]["target_wh"] or not v_wh or str(depot_dists[c]["target_wh"]).strip().lower() == str(v_wh).strip().lower()
                ]
                if not rem_eligible:
                    break
                    
                best_candidate = None
                best_score = float('inf')
                best_new_time = current_time
                
                for c in rem_eligible:
                    c_kg = float(demands[c]) if c < len(demands) else 0.0
                    c_vol = float(volume_demands[c]) if volume_demands and c < len(volume_demands) else 0.0
                    
                    if (cur_kg + c_kg) > effective_cap_kg or (cur_vol + c_vol) > max_vol:
                        continue
                        
                    dist_from_last = float(distance_matrix[current_node][c])
                    t_arr_c = current_time + (dist_from_last / 45.0) * 60.0
                    
                    c_win_s, c_win_e = 0, 1440
                    c_idx = c - num_warehouses
                    if client_time_windows and 0 <= c_idx < len(client_time_windows):
                        c_win_s, c_win_e = client_time_windows[c_idx]
                        
                    wait_m = max(0.0, c_win_s - t_arr_c) if c_win_s > 0 else 0.0
                    serv_start = t_arr_c + wait_m
                    
                    # Do not assign if it arrives after window end
                    if serv_start > c_win_e:
                        continue
                        
                    t_serv_end = serv_start + 15.0
                    ret_dist = float(distance_matrix[c][depot])
                    t_return = t_serv_end + (ret_dist / 45.0) * 60.0
                    
                    # Do not exceed vehicle shift end
                    if t_return > v_ends[v] + 15.0:
                        continue
                        
                    dist_to_cluster = min(float(distance_matrix[node][c]) for node in assigned_to_v)
                    score = dist_to_cluster + (wait_m * 0.3)
                    
                    if score < best_score:
                        best_score = score
                        best_candidate = c
                        best_new_time = t_serv_end
                        
                if best_candidate is not None:
                    assigned_to_v.append(best_candidate)
                    unassigned_clients.remove(best_candidate)
                    cur_kg += float(demands[best_candidate]) if best_candidate < len(demands) else 0.0
                    cur_vol += float(volume_demands[best_candidate]) if volume_demands and best_candidate < len(volume_demands) else 0.0
                    current_node = best_candidate
                    current_time = best_new_time
                else:
                    break
                    
            vehicle_routes[v] = assigned_to_v

        # 3. Sequencing with 2-Opt & Time Windows
        final_routes = []
        route_distances = []
        route_loads = []
        route_volumes = []
        route_times = []
        visited_nodes = set()

        for v in range(num_vehicles):
            depot = depot_indices[v]
            cluster = vehicle_routes.get(v, [])
            
            if not cluster:
                final_routes.append([depot, depot])
                route_distances.append(0.0)
                route_loads.append(0.0)
                route_volumes.append(0.0)
                route_times.append(0.0)
                continue
                
            def get_window_start(node):
                c_idx = node - num_warehouses
                if client_time_windows and 0 <= c_idx < len(client_time_windows):
                    return client_time_windows[c_idx][0]
                return 0
                
            ordered = sorted(cluster, key=lambda n: (get_window_start(n) // 120, distance_matrix[depot][n]))
            
            # 2-Opt local refinement
            improved = True
            iterations = 0
            while improved and iterations < 30:
                improved = False
                iterations += 1
                for i in range(len(ordered) - 1):
                    for j in range(i + 1, len(ordered)):
                        if get_window_start(ordered[i]) > get_window_start(ordered[j]):
                            continue
                            
                        prev_node = depot if i == 0 else ordered[i - 1]
                        next_node = depot if j == len(ordered) - 1 else ordered[j + 1]
                        
                        curr_dist = (
                            distance_matrix[prev_node][ordered[i]] +
                            distance_matrix[ordered[j]][next_node]
                        )
                        new_dist = (
                            distance_matrix[prev_node][ordered[j]] +
                            distance_matrix[ordered[i]][next_node]
                        )
                        
                        if new_dist < curr_dist - 0.05:
                            ordered[i:j+1] = reversed(ordered[i:j+1])
                            improved = True
                            
            route_path = [depot] + ordered + [depot]
            final_routes.append(route_path)
            
            r_dist = 0.0
            r_kg = 0.0
            r_vol = 0.0
            for k in range(len(route_path) - 1):
                n1, n2 = route_path[k], route_path[k+1]
                r_dist += float(distance_matrix[n1][n2])
                if n1 >= num_warehouses:
                    visited_nodes.add(n1)
                    if n1 < len(demands):
                        r_kg += float(demands[n1])
                    if volume_demands and n1 < len(volume_demands):
                        r_vol += float(volume_demands[n1])
                        
            route_distances.append(round(r_dist, 2))
            route_loads.append(round(r_kg, 2))
            route_volumes.append(round(r_vol, 2))
            route_times.append(round((r_dist / 45.0) * 60.0 + len(ordered) * 15.0, 1))

        dropped_nodes = [
            node for node in range(num_warehouses, num_locations)
            if node not in visited_nodes
        ]

        return {
            "routes": final_routes,
            "dropped_nodes": dropped_nodes,
            "total_distance": round(sum(route_distances), 2),
            "route_distances": route_distances,
            "route_loads": route_loads,
            "route_volumes": route_volumes,
            "route_times": route_times,
            "status": "SUCCESS"
        }

    def _extract_solution(
        self, solution, num_vehicles, num_locations, num_warehouses,
        distance_matrix, demands, volume_demands
    ) -> Dict[str, Any]:
        routes = []
        route_distances = []
        route_loads = []
        route_volumes = []
        route_times = []
        visited_nodes = set()
        
        for vehicle_id in range(num_vehicles):
            index = self.routing.Start(vehicle_id)
            plan_output = []
            route_dist = 0.0
            route_load = 0.0
            route_vol = 0.0
            
            while not self.routing.IsEnd(index):
                node_index = self.manager.IndexToNode(index)
                plan_output.append(node_index)
                if node_index >= num_warehouses:
                    visited_nodes.add(node_index)
                    if node_index < len(demands):
                        route_load += float(demands[node_index])
                    if volume_demands and node_index < len(volume_demands):
                        route_vol += float(volume_demands[node_index])
                        
                previous_index = index
                index = solution.Value(self.routing.NextVar(index))
                next_node = self.manager.IndexToNode(index)
                route_dist += float(distance_matrix[node_index][next_node])
                
            end_node = self.manager.IndexToNode(index)
            plan_output.append(end_node)
            
            routes.append(plan_output)
            route_distances.append(round(route_dist, 2))
            route_loads.append(round(route_load, 2))
            route_volumes.append(round(route_vol, 2))
            route_times.append(round(route_dist / 45.0 * 60.0 + max(0, len(plan_output) - 2) * 15.0, 1))
            
        dropped_nodes = [
            node for node in range(num_warehouses, num_locations)
            if node not in visited_nodes
        ]
        
        return {
            "routes": routes,
            "dropped_nodes": dropped_nodes,
            "total_distance": round(sum(route_distances), 2),
            "route_distances": route_distances,
            "route_loads": route_loads,
            "route_volumes": route_volumes,
            "route_times": route_times,
            "status": "SUCCESS"
        }
