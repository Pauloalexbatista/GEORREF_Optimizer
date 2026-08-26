"""
GEOREF Optimizer — Advanced VRPTW Engine (6-Phase Layered Architecture)
=======================================================================
Corrigido: Mapeamento de depósito correto por veículo (depot_idx em vez de 0).
"""

from utils.rules_engine import is_vehicle_compatible, extract_tags
import math
import time
from typing import List, Dict, Any, Tuple, Optional

SPEED_KMH   = 32.0
ROAD_FACTOR = 1.30
SERVICE_MIN = 15.0
MAX_STOPS   = 40

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
    ) -> Dict[str, Any]:
        params          = optimization_params or {}
        strategy        = str(params.get("strategy",       "clusters") or "clusters").lower()
        load_mode       = str(params.get("load_mode",      "full")     or "full").lower()
        solving_depth   = str(params.get("solving_depth",  "balanced") or "balanced").lower()
        time_limit      = float(params.get("time_limit_seconds", 45)   or 45)

        return self._solve_layered_vrptw(
            distance_matrix, demands, vehicle_capacities, depot_indices,
            num_warehouses, volume_demands, vehicle_volume_capacities,
            client_warehouses, vehicle_warehouses,
            vehicle_start_times, vehicle_end_times, client_time_windows,
            locations=locations,
            strategy=strategy,
            load_mode=load_mode,
            solving_depth=solving_depth,
            time_limit_seconds=time_limit,
        )

    def _solve_layered_vrptw(
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
    ) -> Dict[str, Any]:
        num_vehicles = len(vehicle_capacities)
        num_clients  = len(demands) - num_warehouses
        if num_vehicles == 0 or num_clients <= 0:
            return {"routes": [[] for _ in range(num_vehicles)], "dropped_nodes": [], "status": "no_data"}

        if solving_depth in ("deep", "profundo", "high"):
            max_iters = 2000
            max_time  = max(time_limit_seconds, 120.0)
        elif solving_depth in ("fast", "rapido"):
            max_iters = 100
            max_time  = min(time_limit_seconds, 15.0)
        else:
            max_iters = 500
            max_time  = max(time_limit_seconds, 45.0)

        t0 = time.time()

        # Build warehouse name to index mapping using vehicles config
        wh_name_to_idx = {}
        if vehicle_warehouses and depot_indices:
            for v in range(num_vehicles):
                wh_name = vehicle_warehouses[v]
                wh_name_to_idx[wh_name] = depot_indices[v]

        # Build client data
        client_data: Dict[int, Dict] = {}
        for c in range(num_warehouses, len(demands)):
            lat = lon = 0.0
            if locations and c < len(locations):
                lat, lon = locations[c]

            c_wh = client_warehouses[c - num_warehouses] if client_warehouses and (c - num_warehouses) < len(client_warehouses) else ""
            c_depot_idx = wh_name_to_idx.get(c_wh, 0)

            angle = math.atan2(lat - locations[c_depot_idx][0], lon - locations[c_depot_idx][1]) if locations else 0.0
            dist  = distance_matrix[c_depot_idx][c] if c < len(distance_matrix[c_depot_idx]) else 10.0

            tw_s, tw_e = 0, 1440
            if client_time_windows and (c - num_warehouses) < len(client_time_windows):
                tw_s, tw_e = client_time_windows[c - num_warehouses]

            client_data[c] = {
                "idx":           c,
                "lat":           lat,
                "lon":           lon,
                "angle":         angle,
                "dist_to_depot": dist,
                "weight":        float(demands[c]),
                "volume":        float(volume_demands[c]) if volume_demands and c < len(volume_demands) else 0.1,
                "tw_start":      tw_s,
                "tw_end":        tw_e,
                "wh":            c_wh,
                "depot_idx":     c_depot_idx
            }

        # Build vehicle data
        vehicle_data: List[Dict] = []
        for v in range(num_vehicles):
            vs = vehicle_start_times[v] if vehicle_start_times and v < len(vehicle_start_times) else 480
            ve = vehicle_end_times[v]   if vehicle_end_times   and v < len(vehicle_end_times)   else 1080
            cw = float(vehicle_capacities[v])
            cv = float(vehicle_volume_capacities[v]) if vehicle_volume_capacities and v < len(vehicle_volume_capacities) else 100000.0
            wh = vehicle_warehouses[v] if vehicle_warehouses and v < len(vehicle_warehouses) else ""
            v_depot_idx = depot_indices[v] if depot_indices and v < len(depot_indices) else 0

            vehicle_data.append({
                "id": v, "start": vs, "end": ve,
                "cap_w": cw, "cap_v": cv, "wh": wh, "depot_idx": v_depot_idx
            })

        # ------------------------------------------------------------------
        # HELPERS
        # ------------------------------------------------------------------
        def _sequence(nodes, v):
            v_depot = vehicle_data[v]["depot_idx"]
            return sorted(nodes, key=lambda c: (client_data[c]["tw_start"],
                                                distance_matrix[v_depot][c]))

        def _eval(nodes, v):
            if not nodes:
                return True, 0.0, 0, 0
            vd  = vehicle_data[v]
            v_depot = vd["depot_idx"]
            seq = nodes  # Evaluate literal physical order
            cur_t = float(vd["start"])
            cur_l = v_depot
            total_km = 0.0
            total_wait = 0
            late_count = 0
            for c in seq:
                cd = client_data[c]
                d  = distance_matrix[cur_l][c] * ROAD_FACTOR
                total_km += d
                cur_t    += (d / max(SPEED_KMH, 15.0)) * 60.0
                if cur_t < cd["tw_start"]:
                    total_wait += int(cd["tw_start"] - cur_t)
                    cur_t = float(cd["tw_start"])
                elif cd["tw_end"] < 1440 and cur_t > cd["tw_end"]:
                    late_count += 1
                cur_t += SERVICE_MIN
                cur_l  = c
            d_ret     = distance_matrix[cur_l][v_depot] * ROAD_FACTOR
            total_km += d_ret
            cur_t    += (d_ret / max(SPEED_KMH, 15.0)) * 60.0
            duration  = int(round(cur_t - vd["start"]))
            is_feasible = (
                late_count == 0
                and cur_t <= vd["end"] + 30
                and duration <= (vd["end"] - vd["start"] + 60)
                and len(nodes) <= MAX_STOPS
            )
            return is_feasible, total_km, late_count, total_wait

        def _quick_ok(c, v, cur_w, cur_vol):
            vd = vehicle_data[v]
            cd = client_data[c]
            if cd["tw_start"] >= vd["end"]:   return False
            if cd["tw_end"]   <  vd["start"]: return False
            if cd["wh"] and vd["wh"] and cd["wh"] != vd["wh"]: return False
            if cur_w   + cd["weight"] > vd["cap_w"]: return False
            if cur_vol + cd["volume"] > vd["cap_v"]: return False
            return True

        def _insert_cost(c, route, v):
            cd = client_data[c]
            v_depot = vehicle_data[v]["depot_idx"]
            if not route:
                return distance_matrix[v_depot][c] * ROAD_FACTOR
            if strategy == "min_km":
                best = float("inf")
                seq  = _sequence(route, v)
                prev_seq = [v_depot] + seq
                next_seq = seq + [v_depot]
                for i in range(len(seq) + 1):
                    pn = prev_seq[i]
                    nn = next_seq[i]
                    extra = (distance_matrix[pn][c] + distance_matrix[c][nn]
                             - distance_matrix[pn][nn]) * ROAD_FACTOR
                    if extra < best:
                        best = extra
                return best
            else:
                lats = [client_data[r]["lat"] for r in route]
                lons = [client_data[r]["lon"] for r in route]
                cg_lat = sum(lats) / len(lats)
                cg_lon = sum(lons) / len(lons)
                return math.sqrt((cd["lat"] - cg_lat) ** 2 +
                                 (cd["lon"] - cg_lon) ** 2) * 111.0

        def _route_km(v):
            _, km, _, _ = _eval(routes[v], v)
            return km

        def _total_lates(v):
            _, _, lates, _ = _eval(routes[v], v)
            return lates

        # ------------------------------------------------------------------
        # PHASE 1 — FAR-FIRST GREEDY FILL
        # ------------------------------------------------------------------
        all_clients = sorted(client_data.keys(),
                             key=lambda c: -client_data[c]["dist_to_depot"])

        routes:   List[List[int]] = [[] for _ in range(num_vehicles)]
        veh_w:    List[float]     = [0.0] * num_vehicles
        veh_v:    List[float]     = [0.0] * num_vehicles
        assigned: set             = set()
        dropped:  set             = set(all_clients)

        for c in all_clients:
            cd        = client_data[c]
            best_v    = None
            best_cost = float("inf")

            for v in range(num_vehicles):
                if not _quick_ok(c, v, veh_w[v], veh_v[v]):
                    continue
                test_r = _sequence(routes[v] + [c], v)
                feas, _, lates, wait = _eval(test_r, v)
                if not feas:
                    continue
                cost = _insert_cost(c, routes[v], v) + wait * 0.5
                if cost < best_cost:
                    best_cost = cost
                    best_v    = v

            if best_v is not None:
                routes[best_v] = _sequence(routes[best_v] + [c], best_v)
                veh_w[best_v]  += cd["weight"]
                veh_v[best_v]  += cd["volume"]
                assigned.add(c)
                dropped.discard(c)

        # ------------------------------------------------------------------
        # PHASE 2 — PUSH-INWARD
        # ------------------------------------------------------------------
        def _run_push_inward():
            drop_sorted = sorted(dropped, key=lambda c: -client_data[c]["dist_to_depot"])
            did_swap    = True
            while did_swap:
                did_swap = False
                for drop_c in list(drop_sorted):
                    drop_cd  = client_data[drop_c]
                    best_v   = None
                    best_sw  = None
                    best_dist = float("inf")

                    for v in range(num_vehicles):
                        vd = vehicle_data[v]
                        for asgn_c in routes[v]:
                            acd = client_data[asgn_c]
                            if drop_cd["dist_to_depot"] <= acd["dist_to_depot"]:
                                continue
                            new_w   = veh_w[v] - acd["weight"] + drop_cd["weight"]
                            new_vol = veh_v[v] - acd["volume"] + drop_cd["volume"]
                            if new_w   > vd["cap_w"]: continue
                            if new_vol > vd["cap_v"]: continue
                            if drop_cd["tw_start"] >= vd["end"]:   continue
                            if drop_cd["tw_end"]   <  vd["start"]: continue
                            if drop_cd["wh"] and vd["wh"] and drop_cd["wh"] != vd["wh"]: continue
                            test_r = _sequence([x for x in routes[v] if x != asgn_c] + [drop_c], v)
                            feas, _, lates, _ = _eval(test_r, v)
                            if not feas:
                                continue
                            if acd["dist_to_depot"] < best_dist:
                                best_v    = v
                                best_sw   = asgn_c
                                best_dist = acd["dist_to_depot"]

                    if best_sw is not None:
                        acd = client_data[best_sw]
                        routes[best_v] = _sequence([x for x in routes[best_v] if x != best_sw] + [drop_c], best_v)
                        veh_w[best_v] += drop_cd["weight"]  - acd["weight"]
                        veh_v[best_v] += drop_cd["volume"]  - acd["volume"]
                        assigned.add(drop_c);    dropped.discard(drop_c)
                        assigned.discard(best_sw); dropped.add(best_sw)
                        drop_sorted = sorted(dropped, key=lambda c: -client_data[c]["dist_to_depot"])
                        did_swap = True
                        break

        _run_push_inward()

        # ------------------------------------------------------------------
        # PHASES 3+4 — INTER-ROUTE OPTIMISATION LOOP
        # ------------------------------------------------------------------
        def _run_inter_route_loop():
            improved  = True
            iteration = 0

            while improved and iteration < max_iters and (time.time() - t0) < max_time:
                improved  = False
                iteration += 1

                # Phase 3: Full Route Swap
                for va in range(num_vehicles):
                    for vb in range(va + 1, num_vehicles):
                        if not routes[va] and not routes[vb]:
                            continue
                        late_a = _total_lates(va)
                        late_b = _total_lates(vb)

                        new_w_a = sum(client_data[c]["weight"] for c in routes[vb])
                        new_v_a = sum(client_data[c]["volume"] for c in routes[vb])
                        new_w_b = sum(client_data[c]["weight"] for c in routes[va])
                        new_v_b = sum(client_data[c]["volume"] for c in routes[va])

                        if new_w_a > vehicle_data[va]["cap_w"]: continue
                        if new_v_a > vehicle_data[va]["cap_v"]: continue
                        if new_w_b > vehicle_data[vb]["cap_w"]: continue
                        if new_v_b > vehicle_data[vb]["cap_v"]: continue

                        feas_asw, km_asw, late_asw, _ = _eval(routes[vb], va)
                        feas_bsw, km_bsw, late_bsw, _ = _eval(routes[va], vb)
                        if not feas_asw or not feas_bsw:
                            continue

                        cur_late = late_a + late_b
                        new_late = late_asw + late_bsw
                        accept   = False

                        if new_late < cur_late:
                            accept = True
                        elif new_late == cur_late == 0:
                            cur_km = _route_km(va) + _route_km(vb)
                            if (km_asw + km_bsw) < cur_km - 0.5:
                                accept = True

                        if accept:
                            routes[va], routes[vb] = list(routes[vb]), list(routes[va])
                            veh_w[va], veh_w[vb]   = new_w_a, new_w_b
                            veh_v[va], veh_v[vb]   = new_v_a, new_v_b
                            improved = True

                if improved:
                    continue

                # Phase 4a: Relocate
                for va in range(num_vehicles):
                    if not routes[va]:
                        continue
                    for ca in list(routes[va]):
                        cda = client_data[ca]
                        km_a_cur = _route_km(va)
                        for vb in range(num_vehicles):
                            if va == vb:
                                continue
                            if not _quick_ok(ca, vb, veh_w[vb], veh_v[vb]):
                                continue
                            test_rb = _sequence(routes[vb] + [ca], vb)
                            feas_b, km_b_new, late_b, _ = _eval(test_rb, vb)
                            if not feas_b:
                                continue
                            test_ra = _sequence([x for x in routes[va] if x != ca], va)
                            _, km_a_new, _, _ = _eval(test_ra, va) if test_ra else (True, 0.0, 0, 0)
                            km_b_cur = _route_km(vb)
                            if (km_a_new + km_b_new) < (km_a_cur + km_b_cur) - 0.1:
                                routes[va] = test_ra
                                routes[vb] = test_rb
                                veh_w[va] -= cda["weight"]; veh_w[vb] += cda["weight"]
                                veh_v[va] -= cda["volume"]; veh_v[vb] += cda["volume"]
                                improved = True
                                break
                        if improved: break
                    if improved: break

                if improved:
                    continue

                # Phase 4b: Swap
                for va in range(num_vehicles):
                    if not routes[va]:
                        continue
                    for ca in list(routes[va]):
                        cda    = client_data[ca]
                        km_a_c = _route_km(va)
                        for vb in range(num_vehicles):
                            if va == vb or not routes[vb]:
                                continue
                            vda = vehicle_data[va]
                            vdb = vehicle_data[vb]
                            km_b_c = _route_km(vb)
                            for cb in list(routes[vb]):
                                cdb = client_data[cb]
                                nw_a = veh_w[va] - cda["weight"] + cdb["weight"]
                                nw_b = veh_w[vb] - cdb["weight"] + cda["weight"]
                                nv_a = veh_v[va] - cda["volume"] + cdb["volume"]
                                nv_b = veh_v[vb] - cdb["volume"] + cda["volume"]
                                if nw_a > vda["cap_w"] or nw_b > vdb["cap_w"]: continue
                                if nv_a > vda["cap_v"] or nv_b > vdb["cap_v"]: continue
                                if cdb["tw_start"] >= vda["end"] or cdb["tw_end"] < vda["start"]: continue
                                if cda["tw_start"] >= vdb["end"] or cda["tw_end"] < vdb["start"]: continue
                                test_ra = _sequence([cb if x == ca else x for x in routes[va]], va)
                                test_rb = _sequence([ca if x == cb else x for x in routes[vb]], vb)
                                feas_a, km_a_n, _, _ = _eval(test_ra, va)
                                feas_b, km_b_n, _, _ = _eval(test_rb, vb)
                                if not feas_a or not feas_b: continue
                                if (km_a_n + km_b_n) < (km_a_c + km_b_c) - 0.1:
                                    routes[va], routes[vb] = test_ra, test_rb
                                    veh_w[va], veh_w[vb]   = nw_a, nw_b
                                    veh_v[va], veh_v[vb]   = nv_a, nv_b
                                    improved = True
                                    break
                            if improved: break
                        if improved: break
                    if improved: break

            return iteration

        iters = _run_inter_route_loop()

        # ------------------------------------------------------------------
        # PHASE 5 — 2-OPT + CONSOLIDATION
        # ------------------------------------------------------------------
        def _two_opt(route, v):
            best = _sequence(route, v)
            n    = len(best)
            if n < 3:
                return best
            v_depot = vehicle_data[v]["depot_idx"]
            imp = True
            while imp:
                imp = False
                for i in range(n - 1):
                    for j in range(i + 2, n):
                        ca = best[i];     cb = best[i + 1]
                        cc = best[j];     cd_ = best[j + 1] if j + 1 < n else 0
                        cur = (distance_matrix[ca][cb]
                               + (distance_matrix[cc][cd_] if cd_ else distance_matrix[cc][v_depot])) * ROAD_FACTOR
                        new = (distance_matrix[ca][cc]
                               + (distance_matrix[cb][cd_] if cd_ else distance_matrix[cb][v_depot])) * ROAD_FACTOR
                        if new < cur - 0.01:
                            cand = best[:i+1] + list(reversed(best[i+1:j+1])) + best[j+1:]
                            feas, _, lates, _ = _eval(cand, v)
                            if feas and lates == 0:
                                best = cand
                                imp  = True
            return best

        final: List[List[int]] = []
        for v in range(num_vehicles):
            final.append(_two_opt(routes[v], v) if routes[v] else [])

        # Consolidation: absorb routes with 1-2 stops
        for vs in range(num_vehicles):
            if 1 <= len(final[vs]) <= 2:
                for ca in list(final[vs]):
                    cda = client_data[ca]
                    for vt in range(num_vehicles):
                        if vt == vs or not final[vt]:
                            continue
                        if not _quick_ok(ca, vt, veh_w[vt], veh_v[vt]):
                            continue
                        test_r = final[vt] + [ca]
                        feas, _, lates, _ = _eval(test_r, vt)
                        if feas and lates == 0:
                            final[vs].remove(ca)
                            final[vt].append(ca)
                            veh_w[vs] -= cda["weight"]; veh_w[vt] += cda["weight"]
                            veh_v[vs] -= cda["volume"]; veh_v[vt] += cda["volume"]
                            break

        # ------------------------------------------------------------------
        # PHASE 6 — SECOND CHANCE RE-INSERTION
        # ------------------------------------------------------------------
        dropped_sorted = sorted(dropped, key=lambda c: -client_data[c]["dist_to_depot"])
        affected_veh: set = set()

        for drop_c in dropped_sorted:
            drop_cd  = client_data[drop_c]
            best_v   = None
            best_cost = float("inf")
            for v in range(num_vehicles):
                if not _quick_ok(drop_c, v, veh_w[v], veh_v[v]):
                    continue
                test_r = _sequence(final[v] + [drop_c], v)
                feas, _, lates, _ = _eval(test_r, v)
                if not feas:
                    continue
                cost = _insert_cost(drop_c, final[v], v)
                if cost < best_cost:
                    best_cost = cost
                    best_v    = v
            if best_v is not None:
                final[best_v] = _sequence(final[best_v] + [drop_c], best_v)
                veh_w[best_v] += drop_cd["weight"]
                veh_v[best_v] += drop_cd["volume"]
                assigned.add(drop_c)
                dropped.discard(drop_c)
                affected_veh.add(best_v)

        # Phase 6b: re-polish affected routes
        for v in affected_veh:
            if len(final[v]) > 2:
                final[v] = _two_opt(final[v], v)

        # ------------------------------------------------------------------
        # RESULT
        # ------------------------------------------------------------------
        final_dropped = [c for c in range(num_warehouses, len(demands))
                         if c not in assigned]

        return {
            "routes":          final,
            "dropped_nodes":   final_dropped,
            "status":          "success",
            "iterations":      iters,
            "elapsed_seconds": round(time.time() - t0, 2),
        }
