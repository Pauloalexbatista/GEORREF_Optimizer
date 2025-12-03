from utils.routing_engine import OSRMRouter

def test_osrm():
    router = OSRMRouter()
    
    # Lisbon, Porto, Faro
    locations = [
        (38.7223, -9.1393), # Lisbon
        (41.1579, -8.6291), # Porto
        (37.0179, -7.9308)  # Faro
    ]
    
    print("Testing Distance Matrix...")
    matrix = router.get_distance_matrix(locations)
    if matrix:
        print("Matrix Success!")
        print(f"Durations (3x3): {len(matrix['durations'])}x{len(matrix['durations'][0])}")
        print(f"Lisbon -> Porto: {matrix['durations'][0][1] / 60:.1f} min")
    else:
        print("Matrix Failed.")

    print("\nTesting Route Geometry...")
    route = router.get_route(locations)
    if route:
        print("Route Success!")
        print(f"Total Distance: {route['distance'] / 1000:.1f} km")
        print(f"Polyline (first 20 chars): {route['geometry'][:20]}...")
    else:
        print("Route Failed.")

if __name__ == "__main__":
    test_osrm()
