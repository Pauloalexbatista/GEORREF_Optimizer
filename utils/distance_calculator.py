import numpy as np

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees).
    Returns distance in kilometers.
    """
    # Convert decimal degrees to radians
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    
    # Haversine formula
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat/2)**2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon/2)**2
    c = 2 * np.arcsin(np.sqrt(a))
    
    # Radius of earth in kilometers
    r = 6371
    
    return c * r

def calculate_haversine_matrix(locations):
    """
    Calculate distance matrix using Haversine formula.
    
    Args:
        locations: List of (lat, lon) tuples
        
    Returns:
        2D numpy array with distances in kilometers
    """
    n = len(locations)
    matrix = np.zeros((n, n))
    
    for i in range(n):
        for j in range(n):
            if i != j:
                matrix[i][j] = haversine_distance(
                    locations[i][0], locations[i][1],
                    locations[j][0], locations[j][1]
                )
    
    return matrix

def calculate_euclidean_matrix(locations):
    """
    Calculate distance matrix using Euclidean distance (current method).
    Returns in degrees (for backward compatibility).
    """
    loc_array = np.array(locations)
    n = len(locations)
    matrix = np.zeros((n, n))
    
    for i in range(n):
        for j in range(n):
            matrix[i][j] = np.linalg.norm(loc_array[i] - loc_array[j])
    
    return matrix
