import math
import random

class RouteOptimizer:
    def __init__(self):
        pass

    def solve_vrp(self, distance_matrix, num_vehicles, depot_index=0):
        """
        Solves the VRP using a Cluster-First, Route-Second approach with heuristics.
        1. Clustering: Simple K-Means or just splitting the list (for MVP we might just do 1 vehicle or simple split).
        2. Routing: Nearest Neighbor + 2-Opt.
        
        For this Beta, we will assume a Single Vehicle (TSP) or simple split if multiple.
        Returns:
            {
                'routes': [[stop_idx, ...], ...],
                'total_distance': float
            }
        """
        num_locations = len(distance_matrix)
        all_nodes = list(range(num_locations))
        all_nodes.remove(depot_index)
        
        # Simple Logic for MVP: Split nodes among vehicles (naive) then optimize each route
        # In a real VRP we would consider capacity, but here we just balance the count
        random.shuffle(all_nodes) # Shuffle to randomize initial assignment
        
        avg_stops = math.ceil(len(all_nodes) / num_vehicles)
        vehicle_routes = []
        
        for i in range(num_vehicles):
            start = i * avg_stops
            end = start + avg_stops
            nodes = all_nodes[start:end]
            if nodes:
                optimized_route = self._solve_tsp(nodes, depot_index, distance_matrix)
                vehicle_routes.append(optimized_route)
        
        total_dist = 0
        for route in vehicle_routes:
            total_dist += self._calculate_route_distance(route, distance_matrix)
            
        return {
            'routes': vehicle_routes,
            'total_distance': total_dist
        }

    def _solve_tsp(self, nodes, depot_index, dist_matrix):
        """
        Solves TSP for a subset of nodes including the depot.
        Uses Nearest Neighbor construction + 2-Opt improvement.
        """
        # 1. Construction: Nearest Neighbor
        current_node = depot_index
        unvisited = set(nodes)
        route = [depot_index]
        
        while unvisited:
            nearest_node = min(unvisited, key=lambda node: dist_matrix[current_node][node])
            route.append(nearest_node)
            unvisited.remove(nearest_node)
            current_node = nearest_node
            
        route.append(depot_index) # Return to depot
        
        # 2. Improvement: 2-Opt
        improved = True
        while improved:
            improved = False
            for i in range(1, len(route) - 2):
                for j in range(i + 1, len(route) - 1):
                    if j - i == 1: continue
                    
                    # Calculate change in distance
                    # Old edges: (i-1, i) and (j, j+1)
                    # New edges: (i-1, j) and (i, j+1)
                    d_old = dist_matrix[route[i-1]][route[i]] + dist_matrix[route[j]][route[j+1]]
                    d_new = dist_matrix[route[i-1]][route[j]] + dist_matrix[route[i]][route[j+1]]
                    
                    if d_new < d_old:
                        # Reverse segment [i, j]
                        route[i:j+1] = route[i:j+1][::-1]
                        improved = True
                        
        return route

    def _calculate_route_distance(self, route, dist_matrix):
        dist = 0
        for i in range(len(route) - 1):
            dist += dist_matrix[route[i]][route[i+1]]
        return dist
