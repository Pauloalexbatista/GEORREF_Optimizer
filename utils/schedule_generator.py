import pandas as pd
import webbrowser
import os
import tempfile
from datetime import datetime, timedelta

def generate_route_schedule_html(solution, locations, valid_df, fleet_config, dist_matrix, depot_lat, depot_lon, output_path=None):
    """
    Generate a detailed route schedule HTML table with timings, weights, volumes, etc.
    
    Args:
        solution: Route optimization solution dict
        locations: List of (lat, lon) tuples
        valid_df: DataFrame with geocoded addresses
        fleet_config: DataFrame with fleet configuration
        dist_matrix: Distance matrix in KM
        depot_lat: Depot latitude
        depot_lon: Depot longitude
        output_path: Optional path to save HTML
        
    Returns:
        Path to generated HTML file
    """
    
    # Average speed for time calculations
    avg_speed_kmh = 40
    service_time_minutes = 15  # Time spent at each customer
    
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Planeamento de Rotas Detalhado</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 20px;
                background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            }
            h1 {
                color: #554640;
                text-align: center;
                margin-bottom: 30px;
            }
            .summary {
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                margin-bottom: 30px;
            }
            .summary-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 15px;
            }
            .summary-item {
                text-align: center;
                padding: 15px;
                background: #CDE6F5;
                border-radius: 8px;
            }
            .summary-item h3 {
                margin: 0;
                color: #554640;
                font-size: 14px;
            }
            .summary-item p {
                margin: 5px 0 0 0;
                font-size: 24px;
                font-weight: bold;
                color: #8DA7BE;
            }
            .vehicle-section {
                background: white;
                padding: 20px;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                margin-bottom: 20px;
            }
            .vehicle-header {
                background: linear-gradient(135deg, #8DA7BE 0%, #87919E 100%);
                color: white;
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 15px;
            }
            .vehicle-stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 10px;
                margin-bottom: 15px;
            }
            .stat-box {
                background: #f8f9fa;
                padding: 10px;
                border-radius: 5px;
                border-left: 4px solid #8DA7BE;
            }
            .stat-box strong {
                color: #554640;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 10px;
            }
            th {
                background: #554640;
                color: white;
                padding: 12px;
                text-align: left;
                font-size: 13px;
            }
            td {
                padding: 10px;
                border-bottom: 1px solid #ddd;
                font-size: 12px;
            }
            tr:hover {
                background: #f8f9fa;
            }
            .depot-row {
                background: #CDE6F5 !important;
                font-weight: bold;
            }
            .time-col {
                color: #8DA7BE;
                font-weight: bold;
            }
            @media print {
                body {
                    background: white;
                }
                .vehicle-section {
                    page-break-inside: avoid;
                }
            }
        </style>
    </head>
    <body>
        <h1>📋 Planeamento de Rotas Detalhado</h1>
    """
    
    # Overall summary
    total_distance = solution['total_distance']
    total_time = total_distance / avg_speed_kmh
    total_stops = sum(len(r) - 1 for r in solution['routes'])
    
    html += f"""
    <div class="summary">
        <div class="summary-grid">
            <div class="summary-item">
                <h3>Distância Total</h3>
                <p>{total_distance:.1f} km</p>
            </div>
            <div class="summary-item">
                <h3>Tempo Total (condução)</h3>
                <p>{total_time:.1f}h</p>
            </div>
            <div class="summary-item">
                <h3>Veículos</h3>
                <p>{len(solution['routes'])}</p>
            </div>
            <div class="summary-item">
                <h3>Total de Paragens</h3>
                <p>{total_stops}</p>
            </div>
        </div>
    </div>
    """
    
    # Per-vehicle details
    for v_idx, route_indices in enumerate(solution['routes']):
        if len(route_indices) <= 1:
            continue
        
        vehicle_name = fleet_config.iloc[v_idx]['Veiculo'] if v_idx < len(fleet_config) else f"Veículo {v_idx+1}"
        start_time_str = fleet_config.iloc[v_idx]['Horario_Inicio'] if v_idx < len(fleet_config) else "08:00"
        
        # Parse start time
        start_time = datetime.strptime(start_time_str, "%H:%M")
        current_time = start_time
        
        # Calculate route distance
        route_dist = 0
        for i in range(len(route_indices) - 1):
            route_dist += dist_matrix[route_indices[i]][route_indices[i+1]]
        
        route_time = route_dist / avg_speed_kmh
        stops = len(route_indices) - 1
        
        html += f"""
        <div class="vehicle-section">
            <div class="vehicle-header">
                <h2 style="margin:0;">🚗 {vehicle_name}</h2>
            </div>
            <div class="vehicle-stats">
                <div class="stat-box">
                    <strong>Distância:</strong> {route_dist:.1f} km
                </div>
                <div class="stat-box">
                    <strong>Tempo Condução:</strong> {route_time:.1f}h
                </div>
                <div class="stat-box">
                    <strong>Paragens:</strong> {stops}
                </div>
                <div class="stat-box">
                    <strong>Início:</strong> {start_time_str}
                </div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Local</th>
                        <th>Morada</th>
                        <th>Chegada</th>
                        <th>Tempo Entrega</th>
                        <th>Saída</th>
                        <th>KM</th>
                    </tr>
                </thead>
                <tbody>
        """
        
        # Add depot start
        html += f"""
                    <tr class="depot-row">
                        <td>0</td>
                        <td>🏠 Depósito (Partida)</td>
                        <td>Lat: {depot_lat:.5f}, Lon: {depot_lon:.5f}</td>
                        <td class="time-col">-</td>
                        <td>-</td>
                        <td class="time-col">{current_time.strftime('%H:%M')}</td>
                        <td>-</td>
                    </tr>
        """
        
        # Add each stop
        for stop_num, loc_idx in enumerate(route_indices[1:], 1):
            prev_loc_idx = route_indices[stop_num - 1]
            segment_dist = dist_matrix[prev_loc_idx][loc_idx]
            travel_time_hours = segment_dist / avg_speed_kmh
            travel_time_minutes = travel_time_hours * 60
            
            # Update current time (travel)
            current_time += timedelta(minutes=travel_time_minutes)
            arrival_time = current_time
            
            # Service time
            current_time += timedelta(minutes=service_time_minutes)
            departure_time = current_time
            
            # Get address info
            if loc_idx > 0:  # Not depot
                row_idx = loc_idx - 1
                row_data = valid_df.iloc[row_idx]
                address = row_data.get('Morada_Encontrada', 'N/A')
                
                html += f"""
                <tr>
                    <td>{stop_num}</td>
                    <td>📍 Cliente {stop_num}</td>
                    <td>{address}</td>
                    <td class="time-col">{arrival_time.strftime('%H:%M')}</td>
                    <td>{service_time_minutes:.0f} min</td>
                    <td class="time-col">{departure_time.strftime('%H:%M')}</td>
                    <td>{segment_dist:.1f}</td>
                </tr>
                """
        
        # Add return to depot
        last_loc_idx = route_indices[-1]
        depot_idx = 0
        return_dist = dist_matrix[last_loc_idx][depot_idx]
        return_travel_time = (return_dist / avg_speed_kmh) * 60
        current_time += timedelta(minutes=return_travel_time)
        
        html += f"""
                <tr class="depot-row">
                    <td>{len(route_indices)}</td>
                    <td>🏠 Depósito (Regresso)</td>
                    <td>Lat: {depot_lat:.5f}, Lon: {depot_lon:.5f}</td>
                    <td class="time-col">{current_time.strftime('%H:%M')}</td>
                    <td>-</td>
                    <td class="time-col">-</td>
                    <td>{return_dist:.1f}</td>
                </tr>
                <tr style="background: #f0f0f0; font-weight: bold;">
                    <td colspan="6" style="text-align: right;">TOTAL DA ROTA:</td>
                    <td>{route_dist + return_dist:.1f} km</td>
                </tr>
        """
        
        html += """
                </tbody>
            </table>
        </div>
        """
    
    html += """
    </body>
    </html>
    """
    
    # Save to file
    if output_path is None:
        temp_dir = tempfile.gettempdir()
        output_path = os.path.join(temp_dir, 'route_schedule.html')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)
    
    return output_path

def open_route_schedule_in_browser(html_path):
    """Open the route schedule HTML file in the default browser."""
    webbrowser.open('file://' + os.path.abspath(html_path))
