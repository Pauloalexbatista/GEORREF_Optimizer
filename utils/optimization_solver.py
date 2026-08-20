import numpy as np
import math
from typing import List, Dict, Any, Tuple, Optional
from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp

def _safe_int_scale(arr, factor=100):
    if arr is None:
        return []
    return [int(round(float(x) * factor)) for x in arr]

def _calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate forward azimuth / bearing in degrees between two coordinates."""
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    diff_lon_rad = math.radians(lon2 - lon1)
    
    x = math.sin(diff_lon_rad) * math.cos(lat2_rad)
    y = math.cos(lat1_rad) * math.sin(lat2_rad) - (math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(diff_lon_rad))
    initial_bearing = math.atan2(x, y)
    initial_bearing = math.degrees(initial_bearing)
    return (initial_bearing + 360.0) % 360.0

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
        locations: Optional[List[Tuple[float, float]]] = None
    ) -> Dict[str, Any]:
        """
        Main optimization entry point with 2x2 Decision Matrix support:
        - Strategy: 'distance' (Global Minimum KM) vs 'far_first' (Outermost-Seed Sector Clustering)
        - Load Distribution: 'full' (Max fill to save vehicles) vs 'balanced' (Equilíbrio de carga)
        """
        params = optimization_params or {}
        strategy = str(params.get("strategy", "distance") or "distance").lower()
        load_mode = str(params.get("load_mode", "full") or "full").lower()
        balance_weight = float(params.get("balance_weight", 0.0) or 0.0)
        
        # If load_mode is 'balanced', ensure balance_weight is active
        if load_mode in ["balanced", "equilibrado"] and balance_weight <= 0:
            balance_weight = 50.0

        if strategy in ["far_first", "zona", "zonas", "radial"]:
            return self._solve_far_first_clustering(
                distance_matrix, demands, vehicle_capacities, depot_indices,
                num_warehouses, volume_demands, vehicle_volume_capacities,
                client_warehouses, vehicle_warehouses,
                vehicle_start_times, vehicle_end_times, client_time_windows,
                locations, balance_weight=balance_weight, load_mode=load_mode
            )
        else:
            return self._solve_ortools_vrp(
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

    def _solve_ortools_vrp(
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
        balance_weight: float = 0.0
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
            
            # 1. Distance callback & cost
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
            
            # 2. Weight Capacity
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
            
            # 3. Volume Capacity
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

            # 6. Warehouse routing restriction
            if client_warehouses and vehicle_warehouses:
                for location_idx in range(num_warehouses, num_locations):
                    client_idx = location_idx - num_warehouses
                    if client_idx < len(client_warehouses):
                        wh_name = client_warehouses[client_idx]
                        if wh_name and str(wh_name).strip() and str(wh_name).strip().upper() not in ["", "N/A", "NONE"]:
                            allowed_vehicles = [
                                v_idx for v_idx, v_wh in enumerate(vehicle_warehouses)
                                if str(v_wh).strip().lower() == str(wh_name).strip().lower()
                            ]
                            if allowed_vehicles:
                                node_idx_in_model = self.manager.NodeToIndex(location_idx)
                                if node_idx_in_model != -1:
                                    self.routing.VehicleVar(node_idx_in_model).SetValues(allowed_vehicles)

            # 7. Search Parameters
            search_parameters = pywrapcp.DefaultRoutingSearchParameters()
            search_parameters.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
            search_parameters.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
            search_parameters.time_limit.seconds = max(3, min(time_limit, 30))
            
            solution = self.routing.SolveWithParameters(search_parameters)
            
            if solution:
                return self._extract_solution(
                    solution, num_vehicles, num_locations, num_warehouses,
                    distance_matrix, demands, volume_demands
                )
        except Exception as e:
            print(f"[OR-Tools VRP Error: {e}] Falling back to heuristic solver.")
            
        return self._fallback_heuristic_solver(
            distance_matrix, demands, vehicle_capacities, depot_indices,
            num_warehouses, volume_demands, vehicle_volume_capacities,
            v_starts, v_ends, client_time_windows
        )

    def _solve_far_first_clustering(
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
        locations: Optional[List[Tuple[float, float]]],
        balance_weight: float = 0.0,
        load_mode: str = "full"
    ) -> Dict[str, Any]:
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
        
        depot_info = {}
        for c in unassigned_clients:
            c_idx = c - num_warehouses
            target_wh = client_warehouses[c_idx] if client_warehouses and c_idx < len(client_warehouses) else None
            depot_node = 0
            if vehicle_warehouses and target_wh:
                for vi, v_wh in enumerate(vehicle_warehouses):
                    if str(v_wh).strip().lower() == str(target_wh).strip().lower():
                        depot_node = depot_indices[vi]
                        break
            
            dist_to_depot = float(distance_matrix[depot_node][c])
            bearing = 0.0
            if locations and len(locations) > c and len(locations) > depot_node:
                d_lat, d_lon = locations[depot_node]
                c_lat, c_lon = locations[c]
                bearing = _calculate_bearing(d_lat, d_lon, c_lat, c_lon)
                
            depot_info[c] = {
                "dist": dist_to_depot,
                "bearing": bearing,
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
                if not depot_info[c]["target_wh"] or not v_wh or str(depot_info[c]["target_wh"]).strip().lower() == str(v_wh).strip().lower()
            ]
            if not eligible:
                continue
                
            eligible.sort(key=lambda c: depot_info[c]["dist"], reverse=True)
            seed = eligible[0]
            
            assigned_to_v = [seed]
            unassigned_clients.remove(seed)
            cur_kg = float(demands[seed]) if seed < len(demands) else 0.0
            cur_vol = float(volume_demands[seed]) if volume_demands and seed < len(volume_demands) else 0.0
            
            seed_bearing = depot_info[seed]["bearing"]
            
            while unassigned_clients:
                rem_eligible = [
                    c for c in unassigned_clients
                    if not depot_info[c]["target_wh"] or not v_wh or str(depot_info[c]["target_wh"]).strip().lower() == str(v_wh).strip().lower()
                ]
                if not rem_eligible:
                    break
                    
                best_candidate = None
                best_score = float('inf')
                
                for c in rem_eligible:
                    c_kg = float(demands[c]) if c < len(demands) else 0.0
                    c_vol = float(volume_demands[c]) if volume_demands and c < len(volume_demands) else 0.0
                    
                    if (cur_kg + c_kg) > effective_cap_kg or (cur_vol + c_vol) > max_vol:
                        continue
                        
                    min_cluster_dist = min(float(distance_matrix[node][c]) for node in assigned_to_v)
                    
                    angle_diff = abs(depot_info[c]["bearing"] - seed_bearing)
                    if angle_diff > 180:
                        angle_diff = 360 - angle_diff
                        
                    score = min_cluster_dist + (angle_diff * 0.15)
                    
                    if score < best_score:
                        best_score = score
                        best_candidate = c
                        
                if best_candidate is not None:
                    assigned_to_v.append(best_candidate)
                    unassigned_clients.remove(best_candidate)
                    cur_kg += float(demands[best_candidate]) if best_candidate < len(demands) else 0.0
                    cur_vol += float(volume_demands[best_candidate]) if volume_demands and best_candidate < len(volume_demands) else 0.0
                else:
                    break
                    
            vehicle_routes[v] = assigned_to_v

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
            
            improved = True
            iterations = 0
            while improved and iterations < 25:
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

    def _fallback_heuristic_solver(
        self, distance_matrix, demands, vehicle_capacities, depot_indices,
        num_warehouses, volume_demands=None, vehicle_volume_capacities=None,
        v_starts=None, v_ends=None, client_time_windows=None
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_locations = len(distance_matrix)
        
        routes = [[depot_indices[v], depot_indices[v]] for v in range(num_vehicles)]
        route_loads = [0.0] * num_vehicles
        route_vols = [0.0] * num_vehicles
        route_dists = [0.0] * num_vehicles
        route_times = [0.0] * num_vehicles
        
        unassigned = list(range(num_warehouses, num_locations))
        
        for v in range(num_vehicles):
            depot = depot_indices[v]
            cap_kg = float(vehicle_capacities[v])
            cap_vol = float(vehicle_volume_capacities[v]) if vehicle_volume_capacities else 999999.0
            
            s_min = v_starts[v] if v_starts else 590
            e_min = v_ends[v] if v_ends else 1080
            if e_min <= s_min or cap_kg <= 0:
                continue
                
            curr_node = depot
            curr_time = s_min
            v_stops = []
            
            while unassigned:
                best_candidate = None
                best_score = float('inf')
                
                for c in unassigned:
                    c_kg = float(demands[c]) if c < len(demands) else 0.0
                    c_vol = float(volume_demands[c]) if volume_demands and c < len(volume_demands) else 0.0
                    
                    if (route_loads[v] + c_kg) > cap_kg or (route_vols[v] + c_vol) > cap_vol:
                        continue
                        
                    dist = float(distance_matrix[curr_node][c])
                    t_arr = curr_time + (dist / 45.0) * 60.0
                    
                    win_s, win_e = 0, 1440
                    c_idx = c - num_warehouses
                    if client_time_windows and 0 <= c_idx < len(client_time_windows):
                        win_s, win_e = client_time_windows[c_idx]
                        
                    wait_m = max(0.0, win_s - t_arr) if win_s > 0 else 0.0
                    serv_start = t_arr + wait_m
                    late_m = max(0.0, serv_start - win_e) if win_e < 1440 else 0.0
                    
                    ret_dist = float(distance_matrix[c][depot])
                    t_finish = serv_start + 15.0 + (ret_dist / 45.0) * 60.0
                    if t_finish > e_min + 60.0:
                        continue
                        
                    score = dist + (wait_m * 0.4) + (late_m * 3.0)
                    if score < best_score:
                        best_score = score
                        best_candidate = c
                        
                if best_candidate is not None:
                    unassigned.remove(best_candidate)
                    v_stops.append(best_candidate)
                    dist = float(distance_matrix[curr_node][best_candidate])
                    route_dists[v] += dist
                    route_loads[v] += float(demands[best_candidate]) if best_candidate < len(demands) else 0.0
                    route_vols[v] += float(volume_demands[best_candidate]) if volume_demands and best_candidate < len(volume_demands) else 0.0
                    
                    t_arr = curr_time + (dist / 45.0) * 60.0
                    win_s = client_time_windows[best_candidate - num_warehouses][0] if client_time_windows else 0
                    curr_time = max(t_arr, win_s) + 15.0
                    curr_node = best_candidate
                else:
                    break
                    
            if v_stops:
                ret_dist = float(distance_matrix[curr_node][depot])
                route_dists[v] += ret_dist
                routes[v] = [depot] + v_stops + [depot]
                route_times[v] = round(curr_time + (ret_dist / 45.0) * 60.0 - s_min, 1)

        return {
            "routes": routes,
            "dropped_nodes": unassigned,
            "total_distance": round(sum(route_dists), 2),
            "route_distances": [round(d, 2) for d in route_dists],
            "route_loads": [round(l, 2) for l in route_loads],
            "route_volumes": [round(v, 2) for v in route_vols],
            "route_times": route_times,
            "status": "SUCCESS"
        }
