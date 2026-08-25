from utils.rules_engine import is_vehicle_compatible, extract_tags
import numpy as np
import math
import time
import random
from typing import List, Dict, Any, Tuple, Optional

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
        params = optimization_params or {}
        strategy = str(params.get("strategy", "clusters") or "clusters").lower()
        load_mode = str(params.get("load_mode", "full") or "full").lower()
        balance_weight = float(params.get("balance_weight", 0.0) or 0.0)
        solving_depth = str(params.get("solving_depth", "balanced") or "balanced").lower()
        time_limit = float(params.get("time_limit_seconds", 30) or 30)

        # Max allowed shift duration in minutes (default 8.5h = 510 min, max 9h = 540 min)
        max_shift_hours = float(params.get("max_travel_time_hours", 8.5) or 8.5)
        max_shift_minutes = int(round(min(max_shift_hours, 9.0) * 60))

        if load_mode in ["balanced", "equilibrado"] and balance_weight <= 0:
            balance_weight = 50.0

        return self._solve_enterprise_lns_optimizer(
            distance_matrix, demands, vehicle_capacities, depot_indices,
            num_warehouses, volume_demands, vehicle_volume_capacities,
            client_warehouses, vehicle_warehouses,
            vehicle_start_times, vehicle_end_times, client_time_windows,
            locations=locations, balance_weight=balance_weight, load_mode=load_mode,
            strategy=strategy, solving_depth=solving_depth, time_limit_seconds=time_limit,
            max_shift_minutes=max_shift_minutes
        )

    def _solve_enterprise_lns_optimizer(
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
        locations: Optional[List[Tuple[float, float]]] = None,
        balance_weight: float = 0.0,
        load_mode: str = "full",
        strategy: str = "clusters",
        solving_depth: str = "balanced",
        time_limit_seconds: float = 30.0,
        max_shift_minutes: int = 510
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_clients = len(demands) - num_warehouses
        if num_vehicles == 0 or num_clients <= 0:
            return {"routes": [[] for _ in range(num_vehicles)], "dropped_nodes": [], "status": "no_data"}

        # Iteration budget based on depth
        if solving_depth in ["deep", "profundo", "high"]:
            max_iterations = 2500
            max_time = max(time_limit_seconds, 120.0)
        elif solving_depth in ["fast", "rapido"]:
            max_iterations = 150
            max_time = min(time_limit_seconds, 15.0)
        else: # balanced
            max_iterations = 600
            max_time = max(time_limit_seconds, 45.0)

        start_solve_time = time.time()

        # 1. Coordinate & Polar Angle Setup
        depot_lat, depot_lon = (40.6405, -8.6538)
        if locations and len(locations) > 0:
            depot_lat, depot_lon = locations[0]

        client_data = {}
        for c_idx in range(num_warehouses, len(demands)):
            lat, lon = depot_lat, depot_lon
            if locations and c_idx < len(locations):
                lat, lon = locations[c_idx]

            dlat = lat - depot_lat
            dlon = lon - depot_lon
            angle = math.atan2(dlat, dlon)
            dist_to_depot = distance_matrix[0][c_idx] if len(distance_matrix) > 0 and len(distance_matrix[0]) > c_idx else 10.0

            tw_start, tw_end = 480, 1080
            if client_time_windows and (c_idx - num_warehouses) < len(client_time_windows):
                tw_start, tw_end = client_time_windows[c_idx - num_warehouses]

            c_wh = client_warehouses[c_idx - num_warehouses] if client_warehouses and (c_idx - num_warehouses) < len(client_warehouses) else ""

            client_data[c_idx] = {
                "idx": c_idx,
                "lat": lat,
                "lon": lon,
                "angle": angle,
                "dist_to_depot": dist_to_depot,
                "weight": demands[c_idx],
                "volume": volume_demands[c_idx] if volume_demands and c_idx < len(volume_demands) else 0.1,
                "tw_start": tw_start,
                "tw_end": tw_end,
                "wh": c_wh
            }

        # 2. Vehicle Shift Setup with Strict Duration Caps
        vehicle_data = []
        for v in range(num_vehicles):
            v_start = vehicle_start_times[v] if vehicle_start_times and v < len(vehicle_start_times) else 480
            v_end = vehicle_end_times[v] if vehicle_end_times and v < len(vehicle_end_times) else 1080
            v_cap_w = vehicle_capacities[v]
            v_cap_v = vehicle_volume_capacities[v] if vehicle_volume_capacities and v < len(vehicle_volume_capacities) else 1000.0
            v_wh = vehicle_warehouses[v] if vehicle_warehouses and v < len(vehicle_warehouses) else ""

            # Effective max duration: minimum of configured shift length or max_shift_minutes
            v_allowed_shift_len = min(v_end - v_start, max_shift_minutes)
            if v_allowed_shift_len <= 0:
                v_allowed_shift_len = max_shift_minutes

            vehicle_data.append({
                "id": v,
                "start": v_start,
                "end": v_start + v_allowed_shift_len,
                "max_duration": v_allowed_shift_len,
                "cap_w": v_cap_w,
                "cap_v": v_cap_v,
                "wh": v_wh
            })

        # Helper: Route Schedule & Time Window Feasibility Evaluator with Dynamic Departure
        def evaluate_route(route_nodes: List[int], v_idx: int, speed_kmh: float = 50.0) -> Tuple[bool, float, int, int]:
            if not route_nodes:
                return True, 0.0, 0, 0
            vd = vehicle_data[v_idx]
            ordered = sorted(route_nodes, key=lambda c: (client_data[c]["tw_start"], distance_matrix[0][c]))

            first_c = ordered[0]
            t_first_travel = (distance_matrix[0][first_c] / max(speed_kmh, 20.0)) * 60.0
            actual_dep_time = max(vd["start"], client_data[first_c]["tw_start"] - t_first_travel)
            actual_dep_time = min(actual_dep_time, vd["end"] - 60)

            cur_time = actual_dep_time
            cur_loc = 0
            total_dist = 0.0
            late_count = 0

            for c_idx in ordered:
                cd = client_data[c_idx]
                d_km = distance_matrix[cur_loc][c_idx]
                total_dist += d_km
                cur_time += (d_km / max(speed_kmh, 20.0)) * 60.0

                if cur_time < cd["tw_start"]:
                    cur_time = float(cd["tw_start"])
                elif cur_time > cd["tw_end"] + 10:
                    late_count += 1

                cur_time += 15.0
                cur_loc = c_idx

            # Return to depot
            d_ret = distance_matrix[cur_loc][0]
            total_dist += d_ret
            cur_time += (d_ret / max(speed_kmh, 20.0)) * 60.0

            total_duration = int(round(cur_time - actual_dep_time))
            is_feasible = (late_count == 0) and (cur_time <= vd["end"] + 20) and (total_duration <= vd["max_duration"] + 30) and (len(route_nodes) <= 25)
            return is_feasible, total_dist, total_duration, late_count

        # 3. Initial Partitioning: Polar Sector Sweeping + Strict Shift Limits
        if strategy in ["far_first", "distance"]:
            sorted_clients = sorted(client_data.keys(), key=lambda c: (-client_data[c]["dist_to_depot"], client_data[c]["angle"]))
        else: # clusters / balanced
            sorted_clients = sorted(client_data.keys(), key=lambda c: (round(client_data[c]["angle"], 2), -client_data[c]["dist_to_depot"]))

        routes = [[] for _ in range(num_vehicles)]
        vehicle_w = [0.0] * num_vehicles
        vehicle_v = [0.0] * num_vehicles
        assigned_set = set()

        for c_idx in sorted_clients:
            cd = client_data[c_idx]
            best_v = None
            best_cost = float("inf")

            for v in range(num_vehicles):
                vd = vehicle_data[v]
                # Shift compatibility
                if cd["tw_start"] >= vd["end"] or cd["tw_end"] <= vd["start"]:
                    continue
                # Warehouse match
                if cd["wh"] and vd["wh"] and cd["wh"] != vd["wh"]:
                    continue
                # Capacity
                if vehicle_w[v] + cd["weight"] > vd["cap_w"] or vehicle_v[v] + cd["volume"] > vd["cap_v"]:
                    continue

                # Test route time feasibility
                test_r = routes[v] + [c_idx]
                is_feas, d_km, dur_min, late = evaluate_route(test_r, v)
                if not is_feas and len(routes[v]) > 0:
                    continue

                # Cost metric: distance + angular alignment
                if not routes[v]:
                    cost = cd["dist_to_depot"]
                else:
                    last_c = routes[v][-1]
                    dist_to_last = distance_matrix[last_c][c_idx]
                    angle_diff = abs(client_data[last_c]["angle"] - cd["angle"])
                    if angle_diff > math.pi:
                        angle_diff = 2 * math.pi - angle_diff
                    cost = dist_to_last + (angle_diff * 30.0)

                if balance_weight > 0:
                    cost += (len(routes[v]) * balance_weight * 0.1)

                if cost < best_cost:
                    best_cost = cost
                    best_v = v

            if best_v is not None:
                routes[best_v].append(c_idx)
                vehicle_w[best_v] += cd["weight"]
                vehicle_v[best_v] += cd["volume"]
                assigned_set.add(c_idx)

        # 4. Phase 2: Metaheuristic LNS (Inter-Route Relocate & Swap with Feasibility Guarantee)
        improved = True
        iteration = 0

        while improved and iteration < max_iterations and (time.time() - start_solve_time) < max_time:
            improved = False
            iteration += 1

            # A. Inter-Route Relocate
            for va in range(num_vehicles):
                if not routes[va]:
                    continue
                for pos_a, ca in enumerate(routes[va]):
                    cda = client_data[ca]
                    for vb in range(num_vehicles):
                        if va == vb:
                            continue
                        vbd = vehicle_data[vb]
                        if cda["tw_start"] >= vbd["end"] or cda["tw_end"] <= vbd["start"]:
                            continue
                        if cda["wh"] and vbd["wh"] and cda["wh"] != vbd["wh"]:
                            continue
                        if vehicle_w[vb] + cda["weight"] > vbd["cap_w"] or vehicle_v[vb] + cda["volume"] > vbd["cap_v"]:
                            continue

                        # Feasibility of route vb with ca added
                        test_rb = routes[vb] + [ca]
                        is_feas_b, d_b, _, _ = evaluate_route(test_rb, vb)
                        if not is_feas_b:
                            continue

                        _, cur_da, _, _ = evaluate_route(routes[va], va)
                        _, cur_db, _, _ = evaluate_route(routes[vb], vb)
                        test_ra = routes[va][:pos_a] + routes[va][pos_a+1:]
                        _, new_da, _, _ = evaluate_route(test_ra, va)

                        if (new_da + d_b) < (cur_da + cur_db) - 0.05:
                            routes[va].pop(pos_a)
                            routes[vb].append(ca)
                            vehicle_w[va] -= cda["weight"]
                            vehicle_w[vb] += cda["weight"]
                            vehicle_v[va] -= cda["volume"]
                            vehicle_v[vb] += cda["volume"]
                            improved = True
                            break
                    if improved:
                        break
                if improved:
                    break

        # 5. Phase 3: Final Chronological Sequence & 2-Opt Refinement
        final_routes = []
        for v in range(num_vehicles):
            raw_r = routes[v]
            if not raw_r:
                final_routes.append([])
                continue

            sorted_by_tw = sorted(raw_r, key=lambda c: (client_data[c]["tw_start"], distance_matrix[0][c]))

            n = len(sorted_by_tw)
            improved_2opt = True
            while improved_2opt and n > 3:
                improved_2opt = False
                for i in range(n - 1):
                    for j in range(i + 2, n):
                        if client_data[sorted_by_tw[i]]["tw_start"] != client_data[sorted_by_tw[j]]["tw_start"]:
                            continue
                        c_a, c_b = sorted_by_tw[i], sorted_by_tw[i+1]
                        c_c = sorted_by_tw[j]
                        c_d = sorted_by_tw[j+1] if j+1 < n else 0
                        cur_seg = distance_matrix[c_a][c_b] + (distance_matrix[c_c][c_d] if c_d != 0 else distance_matrix[c_c][0])
                        new_seg = distance_matrix[c_a][c_c] + (distance_matrix[c_b][c_d] if c_d != 0 else distance_matrix[c_b][0])
                        if new_seg < cur_seg - 0.01:
                            sorted_by_tw[i+1:j+1] = reversed(sorted_by_tw[i+1:j+1])
                            improved_2opt = True

            final_routes.append(sorted_by_tw)

        dropped = [c for c in range(num_warehouses, len(demands)) if c not in assigned_set]
        return {
            "routes": final_routes,
            "dropped_nodes": dropped,
            "status": "success",
            "iterations": iteration,
            "elapsed_seconds": round(time.time() - start_solve_time, 2)
        }
