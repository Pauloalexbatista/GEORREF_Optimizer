import folium
import webbrowser
import os
import tempfile

def generate_route_map_html(locations, depot_lat, depot_lon, solution, fleet_config, dist_matrix, output_path=None):
    """
    Generate a standalone HTML file with the route map.
    
    Args:
        locations: List of (lat, lon) tuples
        depot_lat: Depot latitude
        depot_lon: Depot longitude
        solution: Route optimization solution dict
        fleet_config: DataFrame with fleet configuration
        dist_matrix: Distance matrix in KM
        output_path: Optional path to save HTML (default: temp file)
        
    Returns:
        Path to generated HTML file
    """
    # Create map
    m = folium.Map(location=[depot_lat, depot_lon], zoom_start=10)
    
    # Add title
    title_html = '''
    <div style="position: fixed; 
                top: 10px; left: 50px; width: 400px; height: auto; 
                background-color: white; border:2px solid grey; z-index:9999; 
                font-size:16px; padding: 10px; border-radius: 5px; box-shadow: 2px 2px 6px rgba(0,0,0,0.3);">
        <h3 style="margin:0; color:#2c5364;">🚚 Rotas Otimizadas</h3>
        <p style="margin:5px 0; font-size:14px;">
            <b>Distância Total:</b> {:.1f} km<br>
            <b>Veículos:</b> {}<br>
            <b>Paragens:</b> {}
        </p>
    </div>
    '''.format(
        solution['total_distance'],
        len(solution['routes']),
        sum(len(r) - 1 for r in solution['routes'])  # Exclude depot from each route
    )
    m.get_root().html.add_child(folium.Element(title_html))
    
    # Plot Depot
    folium.Marker(
        [depot_lat, depot_lon],
        popup="<b>Depósito</b><br>Ponto de partida/chegada",
        icon=folium.Icon(color='black', icon='home', prefix='fa'),
        tooltip="Depósito"
    ).add_to(m)
    
    # Colors for vehicles
    colors = ['red', 'blue', 'green', 'purple', 'orange', 'darkred', 
              'lightred', 'beige', 'darkblue', 'darkgreen', 'cadetblue', 
              'darkpurple', 'pink', 'lightblue', 'lightgreen', 'gray']
    
    # Draw routes
    for v_idx, route_indices in enumerate(solution['routes']):
        if len(route_indices) <= 1:  # Skip empty routes
            continue
            
        color = colors[v_idx % len(colors)]
        route_coords = [locations[i] for i in route_indices]
        
        # Calculate route distance
        route_dist = 0
        for i in range(len(route_indices) - 1):
            route_dist += dist_matrix[route_indices[i]][route_indices[i+1]]
        
        # Get vehicle name
        vehicle_name = fleet_config.iloc[v_idx]['Veiculo'] if v_idx < len(fleet_config) else f"Veículo {v_idx+1}"
        
        # Draw polyline
        folium.PolyLine(
            route_coords,
            color=color,
            weight=5,
            opacity=0.7,
            tooltip=f"{vehicle_name}<br>Distância: {route_dist:.1f} km"
        ).add_to(m)
        
        # Draw markers for stops
        for stop_idx, loc_idx in enumerate(route_indices):
            if loc_idx != 0:  # Skip depot (already drawn)
                # Create custom icon with stop number
                icon_html = f'''
                <div style="
                    background-color: {color};
                    border: 2px solid white;
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    font-size: 14px;
                    color: white;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                ">{stop_idx}</div>
                '''
                
                folium.Marker(
                    location=locations[loc_idx],
                    icon=folium.DivIcon(html=icon_html),
                    popup=f"<b>{vehicle_name}</b><br>Paragem {stop_idx}<br>Coordenadas: {locations[loc_idx][0]:.5f}, {locations[loc_idx][1]:.5f}",
                    tooltip=f"{vehicle_name} - Paragem {stop_idx}"
                ).add_to(m)
    
    # Add legend
    legend_html = '''
    <div style="position: fixed; 
                bottom: 50px; left: 50px; width: 250px; height: auto; 
                background-color: white; border:2px solid grey; z-index:9999; 
                font-size:12px; padding: 10px; border-radius: 5px; box-shadow: 2px 2px 6px rgba(0,0,0,0.3);">
        <h4 style="margin:0 0 10px 0;">Legenda</h4>
        <p style="margin:5px 0;"><span style="color:black;">⬤</span> Depósito</p>
    '''
    
    for v_idx, route_indices in enumerate(solution['routes']):
        if len(route_indices) > 1:
            color = colors[v_idx % len(colors)]
            vehicle_name = fleet_config.iloc[v_idx]['Veiculo'] if v_idx < len(fleet_config) else f"Veículo {v_idx+1}"
            stops = len(route_indices) - 1
            legend_html += f'<p style="margin:5px 0;"><span style="color:{color};">⬤</span> {vehicle_name} ({stops} paragens)</p>'
    
    legend_html += '</div>'
    m.get_root().html.add_child(folium.Element(legend_html))
    
    # Save to file
    if output_path is None:
        # Create temp file
        temp_dir = tempfile.gettempdir()
        output_path = os.path.join(temp_dir, 'route_map.html')
    
    m.save(output_path)
    return output_path

def open_route_map_in_browser(html_path):
    """
    Open the route map HTML file in the default browser.
    
    Args:
        html_path: Path to the HTML file
    """
    webbrowser.open('file://' + os.path.abspath(html_path))
