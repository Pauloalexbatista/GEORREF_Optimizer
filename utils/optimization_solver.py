# -*- coding: utf-8 -*-
"""
GEOREF Optimizer - Official Google OR-Tools VRPTW Engine
=========================================================
Enterprise-grade Vehicle Routing Problem with Time Windows (VRPTW):
- Strict Fleet Minimization (Fixed Vehicle Cost to consolidate routes into minimum trucks)
- Full Capacity Constraints (Weight in KG and Volume in m3)
- Strict Time Windows & Driver Shift Bounds
- Multi-Depot and Dynamic Fleet Support
- Multi-Warehouse Disjunction Handling (Zero penalty for unused depots)
- Business Rules & Multi-Tag Matrix Compatibility (VehicleVar Constraints)
- Guided Local Search (GLS) Metaheuristic for Global Cost and Mileage Minimization
"""

import math
import time
from typing import List, Dict, Any, Tuple, Optional
from ortools.constraint_solver import pywrapcp, routing_enums_pb2
from utils.rules_engine import is_vehicle_compatible, extract_tags

SPEED_KMH = 45.0
ROAD_FACTOR = 1.30
SERVICE_MIN = 10.0

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
    ) -> Dict[str, Any]:
        params = optimization_params or {}
        time_limit = float(params.get("time_limit_seconds") or params.get("time_limit") or 20.0)
        respect_tw = bool(params.get("respect_time_windows", True))

        return self._solve_ortools_vrptw(
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
            vehicle_max_stops=vehicle_max_stops
        )

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
        time_limit_seconds=20.0,
        client_rules=None,
        vehicle_rules=None,
        rules_matrix=None,
        respect_time_windows=True,
        vehicle_max_stops=None
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_nodes = len(distance_matrix)
        num_clients = num_nodes - num_warehouses

        if num_vehicles == 0 or num_clients <= 0:
            return {"routes": [[] for _ in range(num_vehicles)], "dropped_nodes": [], "status": "no_data"}

        t0 = time.time()

        # Multi-depot starts and ends
        starts = [depot_indices[v] if v < len(depot_indices) else 0 for v in range(num_vehicles)]
        ends = [depot_indices[v] if v < len(depot_indices) else 0 for v in range(num_vehicles)]

        manager = pywrapcp.RoutingIndexManager(num_nodes, num_vehicles, starts, ends)
        routing = pywrapcp.RoutingModel(manager)

        # 1. Distance & Arc Cost (in meters)
        def distance_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            dist_km = distance_matrix[from_node][to_node] * ROAD_FACTOR
            return int(dist_km * 1000)

        transit_callback_index = routing.RegisterTransitCallback(distance_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

        # 2. FLEET MINIMIZATION (Fixed Vehicle Cost)
        # Adding a huge fixed cost (500 km equivalent) per active vehicle strictly forces OR-Tools
        # to consolidate stops and use the minimum possible number of vehicles.
        FIXED_VEHICLE_COST = 500000
        for v in range(num_vehicles):
            routing.SetFixedCostOfVehicle(FIXED_VEHICLE_COST, v)

        # 3. Weight Capacity Dimension (KG)
        def demand_callback(from_index):
            from_node = manager.IndexToNode(from_index)
            return int(demands[from_node] * 10) if from_node < len(demands) else 0

        demand_callback_index = routing.RegisterUnaryTransitCallback(demand_callback)
        int_capacities = [int(cap * 10) for cap in vehicle_capacities]
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
                return int((volume_demands[from_node] if from_node < len(volume_demands) else 0.0) * 100)

            volume_callback_index = routing.RegisterUnaryTransitCallback(volume_callback)
            int_vol_caps = [int(vcap * 100) for vcap in vehicle_volume_capacities]
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

        # 6. Time Windows & Working Shifts Dimension
        def time_callback(from_index, to_index):
            from_node = manager.IndexToNode(from_index)
            to_node = manager.IndexToNode(to_index)
            dist_km = distance_matrix[from_node][to_node] * ROAD_FACTOR
            travel_time_min = (dist_km / SPEED_KMH) * 60.0
            service_time = SERVICE_MIN if from_node >= num_warehouses else 0
            return int(travel_time_min + service_time)

        time_callback_index = routing.RegisterTransitCallback(time_callback)
        routing.AddDimension(
            time_callback_index,
            1440,  # Max slack / waiting time
            1440,  # Total horizon in minutes (24h)
            False, # start cumul to zero
            "Time"
        )
        time_dimension = routing.GetDimensionOrDie("Time")

        if respect_time_windows:
            for node in range(num_warehouses, num_nodes):
                tw = client_time_windows[node] if client_time_windows and node < len(client_time_windows) else (480, 1080)
                index = manager.NodeToIndex(node)
                if index != -1:
                    s_win = max(0, min(1440, int(tw[0])))
                    e_win = max(s_win, min(1440, int(tw[1])))
                    time_dimension.CumulVar(index).SetRange(s_win, e_win)

        for v in range(num_vehicles):
            v_start = int(vehicle_start_times[v] if vehicle_start_times and v < len(vehicle_start_times) else 480)
            v_end = int(vehicle_end_times[v] if vehicle_end_times and v < len(vehicle_end_times) else 1080)
            time_dimension.CumulVar(routing.Start(v)).SetRange(v_start, v_end)
            time_dimension.CumulVar(routing.End(v)).SetRange(v_start, v_end)

        # 7. Disjunctions:
        # Crucial: Unused warehouse nodes get 0 penalty to be omitted.
        # Client nodes get high penalty (10,000,000) so solver assigns as many as physically feasible.
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

                # Multi-warehouse check
                if num_warehouses > 1 and c_wh and v_wh and c_wh not in ["armazém principal", "armazem principal", "n/a", "none", ""]:
                    if c_wh != v_wh and c_wh not in v_wh and v_wh not in c_wh:
                        continue

                # Rules/Tags check
                if is_vehicle_compatible(v_rules, c_rules, rules_matrix):
                    allowed_vehicles.append(v)

            if allowed_vehicles and len(allowed_vehicles) < num_vehicles:
                routing.VehicleVar(index).SetValues(allowed_vehicles)
            elif not allowed_vehicles:
                # Incompatible with all vehicles -> Force node to be dropped
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
