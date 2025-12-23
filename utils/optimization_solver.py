"""
Advanced Route Optimization with OR-Tools
Supports: capacity constraints, time windows, multiple depots, balanced routes
"""

from ortools.constraint_solver import routing_enums_pb2
from ortools.constraint_solver import pywrapcp
import numpy as np


class AdvancedRouteOptimizer:
    """Advanced VRP solver with multiple constraints"""
    
    def __init__(self):
        self.solution = None
        self.manager = None
        self.routing = None
    
    def optimize_routes(
        self,
        distance_matrix,
        demands,
        vehicle_capacities,
        depot_indices,
        time_windows=None,
        optimization_params=None
    ):
        """
        Solve VRP with advanced constraints
        
        Args:
            distance_matrix: NxN matrix of distances
            demands: List of demands for each location
            vehicle_capacities: List of capacities for each vehicle
            depot_indices: List of depot indices (one per vehicle)
            time_windows: Optional list of (earliest, latest) time windows
            optimization_params: Dict with weights for objectives
        
        Returns:
            {
                'routes': List of routes (each route is list of location indices)
                'total_distance': Total distance of all routes
                'route_distances': List of distances per route
                'route_loads': List of loads per route
                'status': Solution status
            }
        """
        
        if optimization_params is None:
            optimization_params = {
                'distance_weight': 100,
                'balance_weight': 10,
                'max_route_duration': 8 * 60,  # 8 hours in minutes
                'time_limit_seconds': 30
            }
        
        num_locations = len(distance_matrix)
        num_vehicles = len(vehicle_capacities)
        
        # Create routing model
        self.manager = pywrapcp.RoutingIndexManager(
            num_locations,
            num_vehicles,
            depot_indices,  # Start depots
            depot_indices   # End depots
        )
        
        self.routing = pywrapcp.RoutingModel(self.manager)
        
        # 1. Distance callback
        def distance_callback(from_index, to_index):
            from_node = self.manager.IndexToNode(from_index)
            to_node = self.manager.IndexToNode(to_index)
            return int(distance_matrix[from_node][to_node] * 100)  # Scale for precision
        
        transit_callback_index = self.routing.RegisterTransitCallback(distance_callback)
        self.routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)
        
        # 2. Capacity constraint
        def demand_callback(from_index):
            from_node = self.manager.IndexToNode(from_index)
            return demands[from_node]
        
        demand_callback_index = self.routing.RegisterUnaryTransitCallback(demand_callback)
        
        self.routing.AddDimensionWithVehicleCapacity(
            demand_callback_index,
            0,  # null capacity slack
            vehicle_capacities,
            True,  # start cumul to zero
            'Capacity'
        )
        
        # 3. Time/Distance dimension for balancing
        self.routing.AddDimension(
            transit_callback_index,
            0,  # no slack
            optimization_params['max_route_duration'] * 100,  # maximum time per vehicle
            True,  # start cumul to zero
            'Time'
        )
        
        # 4. Balance routes (penalize imbalance)
        time_dimension = self.routing.GetDimensionOrDie('Time')
        
        for vehicle_id in range(num_vehicles):
            index = self.routing.End(vehicle_id)
            time_dimension.SetCumulVarSoftUpperBound(
                index,
                optimization_params['max_route_duration'] * 100,
                optimization_params['balance_weight'] * 100
            )
        
        # 5. Time windows (if provided)
        if time_windows:
            for location_idx, time_window in enumerate(time_windows):
                if time_window:
                    index = self.manager.NodeToIndex(location_idx)
                    time_dimension.CumulVar(index).SetRange(
                        time_window[0],
                        time_window[1]
                    )
        
        # 6. Search parameters
        search_parameters = pywrapcp.DefaultRoutingSearchParameters()
        search_parameters.first_solution_strategy = (
            routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        )
        search_parameters.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        search_parameters.time_limit.seconds = optimization_params['time_limit_seconds']
        search_parameters.log_search = False
        
        # Solve
        self.solution = self.routing.SolveWithParameters(search_parameters)
        
        if not self.solution:
            return {
                'routes': [],
                'total_distance': 0,
                'route_distances': [],
                'route_loads': [],
                'status': 'NO_SOLUTION'
            }
        
        # Extract solution
        return self._extract_solution(distance_matrix, demands)
    
    def _extract_solution(self, distance_matrix, demands):
        """Extract routes from OR-Tools solution"""
        
        routes = []
        route_distances = []
        route_loads = []
        total_distance = 0
        
        for vehicle_id in range(self.routing.vehicles()):
            index = self.routing.Start(vehicle_id)
            route = []
            route_distance = 0
            route_load = 0
            
            while not self.routing.IsEnd(index):
                node_index = self.manager.IndexToNode(index)
                route.append(node_index)
                route_load += demands[node_index]
                
                previous_index = index
                index = self.solution.Value(self.routing.NextVar(index))
                
                if not self.routing.IsEnd(index):
                    from_node = self.manager.IndexToNode(previous_index)
                    to_node = self.manager.IndexToNode(index)
                    route_distance += distance_matrix[from_node][to_node]
            
            # Add final depot
            final_node = self.manager.IndexToNode(index)
            route.append(final_node)
            
            # Add distance back to depot
            if len(route) > 1:
                route_distance += distance_matrix[route[-2]][route[-1]]
            
            if len(route) > 2:  # Only add routes with actual deliveries
                routes.append(route)
                route_distances.append(route_distance)
                route_loads.append(route_load)
                total_distance += route_distance
        
        return {
            'routes': routes,
            'total_distance': total_distance,
            'route_distances': route_distances,
            'route_loads': route_loads,
            'status': 'SUCCESS'
        }
    
    def get_solution_quality(self):
        """Get quality metrics of the solution"""
        
        if not self.solution:
            return None
        
        return {
            'objective_value': self.solution.ObjectiveValue(),
            'num_routes': self.routing.vehicles(),
            'computation_time': self.solution.WallTime()
        }


class RouteOptimizer:
    """Wrapper to maintain compatibility with existing code"""
    
    def __init__(self):
        self.advanced_optimizer = AdvancedRouteOptimizer()
    
    def solve_vrp(self, distance_matrix, num_vehicles, depot_index=0):
        """
        Legacy interface - converts to new format
        """
        
        num_locations = len(distance_matrix)
        
        # Create default parameters
        demands = [0] * num_locations  # No demand constraints for legacy
        vehicle_capacities = [999999] * num_vehicles  # Unlimited capacity
        depot_indices = [depot_index] * num_vehicles
        
        result = self.advanced_optimizer.optimize_routes(
            distance_matrix,
            demands,
            vehicle_capacities,
            depot_indices
        )
        
        return {
            'routes': result['routes'],
            'total_distance': result['total_distance']
        }
