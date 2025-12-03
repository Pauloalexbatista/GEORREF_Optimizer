from utils.optimization_solver import RouteOptimizer
import random

def test_vrp():
    print("Testing Custom VRP Solver...")
    optimizer = RouteOptimizer()
    
    # Mock Distance Matrix (5 nodes)
    # 0: Depot, 1-4: Customers
    # Simple grid for easy verification
    # 0=(0,0), 1=(0,1), 2=(1,1), 3=(1,0), 4=(0,2)
    # Distances are approx Euclidean
    
    # Let's just use a random symmetric matrix for a smoke test
    size = 10
    matrix = [[0]*size for _ in range(size)]
    for i in range(size):
        for j in range(i+1, size):
            d = random.randint(10, 100)
            matrix[i][j] = d
            matrix[j][i] = d
            
    print(f"Generated {size}x{size} distance matrix.")
    
    # Solve for 2 vehicles
    print("Solving for 2 vehicles...")
    result = optimizer.solve_vrp(matrix, num_vehicles=2, depot_index=0)
    
    print(f"Total Distance: {result['total_distance']}")
    for i, route in enumerate(result['routes']):
        print(f"Vehicle {i+1} Route: {route}")
        
    print("Test Complete.")

if __name__ == "__main__":
    test_vrp()
