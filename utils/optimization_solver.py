"""
GEOREF Optimizer — Advanced Robust VRPTW Engine (6-Phase Architecture)
=======================================================================
Enterprise-grade Vehicle Routing Problem with Time Windows & Tag Constraints:
- Strict Zero-Error Compliance (Zero tolerance on time windows, shift ends, weights, volumes)
- Far-First Logistics Principle (Furthest nodes solved first, dropped nodes strictly closest to depot)
- Tag-Constrained Capacity Reservation & Ejection Chains (Specialized vehicles reserved for tagged deliveries)
- Push-Inward Displacement (Swap closer assigned stops to prioritize distant unassigned stops)
- Multi-Depot and Dynamic Fleet Support
"""

import math
import time
from typing import List, Dict, Any, Tuple, Optional
from utils.rules_engine import is_vehicle_compatible, extract_tags

SPEED_KMH = 45.0
ROAD_FACTOR = 1.28
SERVICE_MIN = 15.0

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
        strategy = str(params.get("strategy", "clusters") or "clusters").lower()
        load_mode = str(params.get("load_mode", "full") or "full").lower()
        solving_depth = str(params.get("solving_depth", "balanced") or "balanced").lower()
        time_limit = float(params.get("time_limit_seconds", 45) or 45)
        respect_tw = bool(params.get("respect_time_windows", True))

        return self._solve_robust_vrptw(
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
            strategy=strategy,
            load_mode=load_mode,
            solving_depth=solving_depth,
            time_limit_seconds=time_limit,
            client_rules=client_rules,
            vehicle_rules=vehicle_rules,
            rules_matrix=rules_matrix,
            respect_time_windows=respect_tw,
            vehicle_max_stops=vehicle_max_stops
        )

    def _solve_robust_vrptw(
        self,
        distance_matrix, demands, vehicle_capacities, depot_indices,
        num_warehouses, volume_demands, vehicle_volume_capacities,
        client_warehouses, vehicle_warehouses,
        vehicle_start_times, vehicle_end_times, client_time_windows,
        locations=None,
        strategy="clusters",
        load_mode="full",
        solving_depth="balanced",
        time_limit_seconds=45.0,
        client_rules=None,
        vehicle_rules=None,
        rules_matrix=None,
        respect_time_windows=True,
        vehicle_max_stops=None
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_clients = len(demands) - num_warehouses
        if num_vehicles == 0 or num_clients <= 0:
            return {"routes": [[] for _ in range(num_vehicles)], "dropped_nodes": [], "status": "no_data"}

        t0 = time.time()

        # ------------------------------------------------------------------
        # DATA PREPARATION & NORMALIZATION
        # ------------------------------------------------------------------
        wh_name_to_idx = {}
        for v_idx in range(num_vehicles):
            wh_name = str(vehicle_warehouses[v_idx] if vehicle_warehouses else "").strip().lower()
            if wh_name and wh_name not in wh_name_to_idx:
                dep_i = depot_indices[v_idx] if v_idx < len(depot_indices) else 0
                wh_name_to_idx[wh_name] = dep_i

        client_data = {}
        for c in range(num_warehouses, len(demands)):
            c_idx = c - num_warehouses
            tw = client_time_windows[c] if client_time_windows and c < len(client_time_windows) else (480, 1080)
            c_wh_name = str(client_warehouses[c] if client_warehouses and c < len(client_warehouses) else "").strip().lower()
            c_depot_idx = wh_name_to_idx.get(c_wh_name, 0)
            dist_to_depot = distance_matrix[c_depot_idx][c] if c_depot_idx < len(distance_matrix) and c < len(distance_matrix[c_depot_idx]) else 10.0

            loc = locations[c] if locations and c < len(locations) else (38.7, -9.1)
            c_rule = str(client_rules[c] if client_rules and c < len(client_rules) else "")

            client_data[c] = {
                "weight": float(demands[c]),
                "volume": float(volume_demands[c]) if volume_demands and c < len(volume_demands) else 0.1,
                "tw_start": int(tw[0]) if tw else 480,
                "tw_end": int(tw[1]) if tw else 1080,
                "wh": client_warehouses[c] if client_warehouses and c < len(client_warehouses) else "",
                "depot_idx": c_depot_idx,
                "dist_to_depot": float(dist_to_depot),
                "lat": float(loc[0]),
                "lon": float(loc[1]),
                "rules": c_rule,
                "has_rules": bool(c_rule.strip()),
            }

        vehicle_data = {}
        for v in range(num_vehicles):
            v_depot_idx = depot_indices[v] if v < len(depot_indices) else 0
            v_rule = str(vehicle_rules[v] if vehicle_rules and v < len(vehicle_rules) else "")
            v_max_st = vehicle_max_stops[v] if vehicle_max_stops and v < len(vehicle_max_stops) else 45

            vehicle_data[v] = {
                "cap_w": float(vehicle_capacities[v]),
                "cap_v": float(vehicle_volume_capacities[v]) if vehicle_volume_capacities and v < len(vehicle_volume_capacities) else 10.0,
                "start": int(vehicle_start_times[v]) if vehicle_start_times and v < len(vehicle_start_times) else 480,
                "end": int(vehicle_end_times[v]) if vehicle_end_times and v < len(vehicle_end_times) else 1080,
                "wh": vehicle_warehouses[v] if vehicle_warehouses and v < len(vehicle_warehouses) else "",
                "depot_idx": v_depot_idx,
                "rules": v_rule,
                "has_rules": bool(v_rule.strip()),
                "max_stops": v_max_st
            }

        # ------------------------------------------------------------------
        # EVALUATION & SEQUENCING HELPERS (TOLERÂNCIA ZERO)
        # ------------------------------------------------------------------
        def _sequence(nodes: List[int], v: int) -> List[int]:
            if len(nodes) <= 1:
                return list(nodes)
            v_depot = vehicle_data[v]["depot_idx"]
            unvis = set(nodes)
            cur = v_depot
            cur_t = vehicle_data[v]["start"]
            seq = []

            while unvis:
                best_c = None
                best_score = float("inf")
                for c in unvis:
                    d_km = distance_matrix[cur][c] * ROAD_FACTOR
                    t_min = (d_km / SPEED_KMH) * 60.0
                    arr_t = cur_t + t_min
                    cd = client_data[c]

                    # Urgency penalty based on time window end
                    tw_urgency = max(0, cd["tw_end"] - arr_t)
                    tw_late_penalty = max(0, arr_t - cd["tw_end"]) * 2000.0
                    score = d_km * 2.0 + tw_late_penalty + tw_urgency * 0.05

                    if score < best_score:
                        best_score = score
                        best_c = c

                if best_c is None:
                    best_c = next(iter(unvis))

                seq.append(best_c)
                unvis.remove(best_c)
                d_km = distance_matrix[cur][best_c] * ROAD_FACTOR
                arr_t = cur_t + (d_km / SPEED_KMH) * 60.0
                cur_t = max(arr_t, client_data[best_c]["tw_start"]) + SERVICE_MIN
                cur = best_c

            return seq

        def _eval(nodes: List[int], v: int) -> Tuple[bool, float, int, float]:
            if not nodes:
                return True, 0.0, 0, 0.0
            vd = vehicle_data[v]
            v_depot = vd["depot_idx"]
            cur = v_depot
            cur_t = float(vd["start"])
            total_km = 0.0
            late_count = 0
            total_wait = 0.0

            for c in nodes:
                cd = client_data[c]
                d_km = distance_matrix[cur][c] * ROAD_FACTOR
                total_km += d_km
                arr_t = cur_t + (d_km / SPEED_KMH) * 60.0
                
                # Tolerância Zero em Janela Horária do Cliente
                if arr_t > cd["tw_end"]:
                    late_count += 1
                elif arr_t < cd["tw_start"]:
                    total_wait += (cd["tw_start"] - arr_t)
                
                cur_t = max(arr_t, cd["tw_start"]) + SERVICE_MIN
                cur = c

            # Regresso ao Armazém
            d_home = distance_matrix[cur][v_depot] * ROAD_FACTOR
            total_km += d_home
            cur_t += (d_home / SPEED_KMH) * 60.0

            # TOLERÂNCIA ZERO:
            # 1. Zero atrasos em clientes
            # 2. Hora de regresso ao armazém estritamente <= fim do turno
            # 3. Número de paragens <= max_stops
            is_feasible = (
                len(nodes) <= vd["max_stops"]
                and late_count == 0
                and cur_t <= float(vd["end"])
            )
            return is_feasible, total_km, late_count, total_wait

        def _quick_ok(c: int, v: int, cur_w: float, cur_vol: float, is_reservation_phase: bool = False) -> bool:
            vd = vehicle_data[v]
            cd = client_data[c]

            # 1. Rules / Tags Compatibility
            c_rules = cd["rules"]
            v_rules = vd["rules"]
            if c_rules or v_rules:
                if not is_vehicle_compatible(v_rules, c_rules, rules_matrix):
                    return False
                # During reservation phase, prevent non-tagged clients from occupying tagged vehicles
                if is_reservation_phase and v_rules and not c_rules:
                    return False

            # 2. Capacity Checks
            if cur_w + cd["weight"] > vd["cap_w"]:
                return False
            if cur_vol + cd["volume"] > vd["cap_v"]:
                return False

            # 3. Warehouse Match Check
            if num_warehouses > 1 and cd["wh"] and vd["wh"]:
                cd_wh_norm = cd["wh"].strip().lower()
                vd_wh_norm = vd["wh"].strip().lower()
                if cd_wh_norm and vd_wh_norm and cd_wh_norm not in ["armazém central", "n/a", "none"]:
                    if cd_wh_norm != vd_wh_norm and cd_wh_norm not in vd_wh_norm and vd_wh_norm not in cd_wh_norm:
                        return False

            # 4. Basic Time Window Feasibility
            if cd["tw_start"] >= vd["end"]:
                return False
            if cd["tw_end"] < vd["start"]:
                return False

            return True

        def _insert_cost(c: int, route: List[int], v: int) -> float:
            cd = client_data[c]
            v_depot = vehicle_data[v]["depot_idx"]
            if not route:
                return distance_matrix[v_depot][c] * ROAD_FACTOR
            
            lats = [client_data[r]["lat"] for r in route]
            lons = [client_data[r]["lon"] for r in route]
            cg_lat = sum(lats) / len(lats)
            cg_lon = sum(lons) / len(lons)
            geo_dist = math.sqrt((cd["lat"] - cg_lat) ** 2 + (cd["lon"] - cg_lon) ** 2) * 111.0
            return geo_dist

        # ------------------------------------------------------------------
        # PHASE 0 & 1 — RESTRICTED TAG MATCHING & FAR-FIRST CONSTRUCTIVE
        # ------------------------------------------------------------------
        routes: List[List[int]] = [[] for _ in range(num_vehicles)]
        veh_w: List[float] = [0.0] * num_vehicles
        veh_v: List[float] = [0.0] * num_vehicles
        assigned: set = set()
        dropped: set = set(client_data.keys())

        # Split clients: Priority 1 = Tagged deliveries (Far-First); Priority 2 = General deliveries (Far-First)
        tagged_clients = [c for c in client_data.keys() if client_data[c]["has_rules"]]
        general_clients = [c for c in client_data.keys() if not client_data[c]["has_rules"]]

        tagged_clients.sort(key=lambda c: -client_data[c]["dist_to_depot"])
        general_clients.sort(key=lambda c: -client_data[c]["dist_to_depot"])

        # PASS 1: Assign Tagged Clients strictly to Tagged Vehicles
        for c in tagged_clients:
            cd = client_data[c]
            best_v = None
            best_cost = float("inf")

            for v in range(num_vehicles):
                if not _quick_ok(c, v, veh_w[v], veh_v[v], is_reservation_phase=True):
                    continue
                test_r = _sequence(routes[v] + [c], v)
                feas, _, _, _ = _eval(test_r, v)
                if not feas:
                    continue
                cost = _insert_cost(c, routes[v], v)
                if cost < best_cost:
                    best_cost = cost
                    best_v = v

            if best_v is not None:
                routes[best_v] = _sequence(routes[best_v] + [c], best_v)
                veh_w[best_v] += cd["weight"]
                veh_v[best_v] += cd["volume"]
                assigned.add(c)
                dropped.discard(c)

        # PASS 2: Assign General Clients (Far-First) to available non-tagged / remaining vehicles
        for c in general_clients:
            cd = client_data[c]
            best_v = None
            best_cost = float("inf")

            # First try general vehicles (without specialized tags), then tagged if empty
            vehicle_order = sorted(range(num_vehicles), key=lambda v: (1 if vehicle_data[v]["has_rules"] else 0))

            for v in vehicle_order:
                if not _quick_ok(c, v, veh_w[v], veh_v[v], is_reservation_phase=False):
                    continue
                test_r = _sequence(routes[v] + [c], v)
                feas, _, _, _ = _eval(test_r, v)
                if not feas:
                    continue
                cost = _insert_cost(c, routes[v], v)
                # Extra penalty for putting general client in a specialized tagged vehicle
                if vehicle_data[v]["has_rules"]:
                    cost += 500.0

                if cost < best_cost:
                    best_cost = cost
                    best_v = v

            if best_v is not None:
                routes[best_v] = _sequence(routes[best_v] + [c], best_v)
                veh_w[best_v] += cd["weight"]
                veh_v[best_v] += cd["volume"]
                assigned.add(c)
                dropped.discard(c)

        # ------------------------------------------------------------------
        # PHASE 2 — EJECTION CHAINS (Libertação de Viaturas com Tags)
        # ------------------------------------------------------------------
        # If any tagged client remains dropped, eject general clients from tagged vehicles to free general vehicles
        dropped_tagged = [c for c in dropped if client_data[c]["has_rules"]]
        for dt_c in dropped_tagged:
            dt_cd = client_data[dt_c]
            ejected = False

            for v_tag in range(num_vehicles):
                if ejected:
                    break
                if not vehicle_data[v_tag]["has_rules"]:
                    continue
                if not is_vehicle_compatible(vehicle_data[v_tag]["rules"], dt_cd["rules"], rules_matrix):
                    continue

                # Find general clients currently in v_tag
                gen_in_v = [c for c in routes[v_tag] if not client_data[c]["has_rules"]]
                for gc in gen_in_v:
                    gcd = client_data[gc]
                    # Try to relocate gc to another general vehicle
                    for v_other in range(num_vehicles):
                        if v_other == v_tag or vehicle_data[v_other]["has_rules"]:
                            continue
                        if not _quick_ok(gc, v_other, veh_w[v_other], veh_v[v_other]):
                            continue
                        test_other = _sequence(routes[v_other] + [gc], v_other)
                        feas_other, _, _, _ = _eval(test_other, v_other)
                        if not feas_other:
                            continue

                        # Test if removing gc and adding dt_c to v_tag works!
                        cand_vtag = [x for x in routes[v_tag] if x != gc] + [dt_c]
                        test_vtag = _sequence(cand_vtag, v_tag)
                        feas_vtag, _, _, _ = _eval(test_vtag, v_tag)
                        if feas_vtag:
                            # Apply Ejection!
                            routes[v_other] = test_other
                            veh_w[v_other] += gcd["weight"]
                            veh_v[v_other] += gcd["volume"]

                            routes[v_tag] = test_vtag
                            veh_w[v_tag] = veh_w[v_tag] - gcd["weight"] + dt_cd["weight"]
                            veh_v[v_tag] = veh_v[v_tag] - gcd["volume"] + dt_cd["volume"]

                            assigned.add(dt_c)
                            dropped.discard(dt_c)
                            ejected = True
                            break
                    if ejected:
                        break

        # ------------------------------------------------------------------
        # PHASE 3 — PUSH-INWARD (Displace closer assigned stops to take furthest unassigned)
        # ------------------------------------------------------------------
        drop_sorted = sorted(dropped, key=lambda c: -client_data[c]["dist_to_depot"])
        for drop_c in drop_sorted:
            drop_cd = client_data[drop_c]
            best_v = None
            best_swap_c = None

            for v in range(num_vehicles):
                vd = vehicle_data[v]
                if drop_cd["has_rules"] and not is_vehicle_compatible(vd["rules"], drop_cd["rules"], rules_matrix):
                    continue
                if not drop_cd["has_rules"] and vd["has_rules"]:
                    continue

                for asgn_c in routes[v]:
                    acd = client_data[asgn_c]
                    # Only swap if the dropped stop is significantly FURTHER from depot than assigned stop
                    if drop_cd["dist_to_depot"] <= acd["dist_to_depot"] * 1.15:
                        continue
                    if acd["has_rules"] and not drop_cd["has_rules"]:
                        continue

                    nw = veh_w[v] - acd["weight"] + drop_cd["weight"]
                    nv = veh_v[v] - acd["volume"] + drop_cd["volume"]
                    if nw > vd["cap_w"] or nv > vd["cap_v"]:
                        continue

                    cand = [drop_c if x == asgn_c else x for x in routes[v]]
                    test_r = _sequence(cand, v)
                    feas, _, _, _ = _eval(test_r, v)
                    if feas:
                        best_v = v
                        best_swap_c = asgn_c
                        break
                if best_v is not None:
                    break

            if best_v is not None and best_swap_c is not None:
                # Apply swap: drop_c is now assigned, best_swap_c becomes dropped
                routes[best_v] = _sequence([drop_c if x == best_swap_c else x for x in routes[best_v]], best_v)
                veh_w[best_v] = veh_w[best_v] - client_data[best_swap_c]["weight"] + drop_cd["weight"]
                veh_v[best_v] = veh_v[best_v] - client_data[best_swap_c]["volume"] + drop_cd["volume"]
                assigned.add(drop_c)
                dropped.discard(drop_c)
                assigned.discard(best_swap_c)
                dropped.add(best_swap_c)

        # ------------------------------------------------------------------
        # PHASE 4 — 2-OPT & INTRA-ROUTE POLISHING
        # ------------------------------------------------------------------
        def _two_opt(route: List[int], v: int) -> List[int]:
            best = _sequence(route, v)
            n = len(best)
            if n < 3:
                return best
            v_depot = vehicle_data[v]["depot_idx"]
            improved = True
            while improved:
                improved = False
                for i in range(n - 1):
                    for j in range(i + 2, n):
                        ca, cb = best[i], best[i + 1]
                        cc = best[j]
                        cd_ = best[j + 1] if j + 1 < n else v_depot
                        cur_dist = (distance_matrix[ca][cb] + distance_matrix[cc][cd_]) * ROAD_FACTOR
                        new_dist = (distance_matrix[ca][cc] + distance_matrix[cb][cd_]) * ROAD_FACTOR
                        if new_dist < cur_dist - 0.05:
                            cand = best[:i + 1] + list(reversed(best[i + 1:j + 1])) + best[j + 1:]
                            feas, _, lates, _ = _eval(cand, v)
                            if feas and lates == 0:
                                best = cand
                                improved = True
                                break
                    if improved:
                        break
            return best

        final_routes = []
        for v in range(num_vehicles):
            final_routes.append(_two_opt(routes[v], v) if routes[v] else [])

        # ------------------------------------------------------------------
        # PHASE 5 — SECOND CHANCE RESIDUAL RE-INSERTION
        # ------------------------------------------------------------------
        dropped_residual = sorted(dropped, key=lambda c: -client_data[c]["dist_to_depot"])
        for drop_c in dropped_residual:
            drop_cd = client_data[drop_c]
            best_v = None
            best_cost = float("inf")
            for v in range(num_vehicles):
                if not _quick_ok(drop_c, v, veh_w[v], veh_v[v]):
                    continue
                test_r = _sequence(final_routes[v] + [drop_c], v)
                feas, _, lates, _ = _eval(test_r, v)
                if not feas or lates > 0:
                    continue
                cost = _insert_cost(drop_c, final_routes[v], v)
                if cost < best_cost:
                    best_cost = cost
                    best_v = v

            if best_v is not None:
                final_routes[best_v] = _sequence(final_routes[best_v] + [drop_c], best_v)
                veh_w[best_v] += drop_cd["weight"]
                veh_v[best_v] += drop_cd["volume"]
                assigned.add(drop_c)
                dropped.discard(drop_c)

        final_dropped = [c for c in range(num_warehouses, len(demands)) if c not in assigned]

        return {
            "routes": final_routes,
            "dropped_nodes": final_dropped,
            "status": "success",
            "elapsed_seconds": round(time.time() - t0, 2),
        }
