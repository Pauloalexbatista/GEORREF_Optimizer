import requests
import json
import polyline

class OSRMRouter:
    def __init__(self, base_url="http://router.project-osrm.org"):
        self.base_url = base_url

    def get_distance_matrix(self, locations):
        """
        Fetches the distance and duration matrix for a list of locations.
        locations: List of (lat, lon) tuples.
        Returns:
            {
                'durations': [[float]], # Seconds
                'distances': [[float]]  # Meters
            }
        """
        if not locations:
            return None

        # Format coordinates string: "lon,lat;lon,lat;..."
        coords_str = ";".join([f"{lon},{lat}" for lat, lon in locations])
        
        url = f"{self.base_url}/table/v1/driving/{coords_str}"
        params = {
            'annotations': 'duration,distance'
        }

        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data['code'] != 'Ok':
                print(f"OSRM Error: {data.get('message')}")
                return None
                
            return {
                'durations': data['durations'],
                'distances': data['distances']
            }
        except Exception as e:
            print(f"Error fetching matrix: {e}")
            return None

    def get_route(self, locations):
        """
        Fetches the route geometry (polyline) visiting locations in order.
        locations: List of (lat, lon) tuples.
        Returns:
            {
                'geometry': str, # Encoded polyline
                'duration': float, # Total seconds
                'distance': float  # Total meters
            }
        """
        if len(locations) < 2:
            return None

        coords_str = ";".join([f"{lon},{lat}" for lat, lon in locations])
        url = f"{self.base_url}/route/v1/driving/{coords_str}"
        params = {
            'overview': 'full',
            'geometries': 'polyline'
        }

        try:
            response = requests.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data['code'] != 'Ok':
                print(f"OSRM Error: {data.get('message')}")
                return None
            
            route = data['routes'][0]
            return {
                'geometry': route['geometry'],
                'duration': route['duration'],
                'distance': route['distance']
            }
        except Exception as e:
            print(f"Error fetching route: {e}")
            return None
