"""
Route Editor Component - Interactive route editing with validations
"""

import streamlit as st
import pandas as pd
from datetime import datetime, timedelta


class RouteEditor:
    """Interactive route editor with real-time validations"""
    
    @staticmethod
    def render_editable_routes_table(routes_df, fleet_config):
        """Render editable routes table with validations"""
        
        if routes_df is None or len(routes_df) == 0:
            st.warning("⚠️ Nenhuma rota gerada ainda.")
            return None
        
        st.markdown("### 📝 Editar Rotas")
        
        # Get vehicle list from keys (include unused vehicles + pending marker)
        fleet_vehicles = list(fleet_config.keys())
        vehicle_options = fleet_vehicles + ["⚠️ PENDENTE"]
        
        # Configure editable columns with explicit ordering and styling
        column_config = {
            "Rota": st.column_config.SelectboxColumn(
                "Veículo",
                help="Veículo atribuído",
                options=vehicle_options,
                required=True
            ),
            "Ordem": st.column_config.NumberColumn("Ordem", min_value=1, step=1, format="%d"),
            "Cliente": st.column_config.TextColumn("ID Cliente"),
            "Morada": st.column_config.TextColumn("Morada de Entrega"),
            "Janela_Horaria": st.column_config.TextColumn("⏰ Janela Solicitada", help="Slot horário definido no Excel"),
            "Chegada": st.column_config.TextColumn("🕒 Previsão Chegada"),
            "Tempo_Entrega": st.column_config.NumberColumn("⏳ Duração (min)"),
            "Saida": st.column_config.TextColumn("🕒 Partida"),
            "Carga_Acum": st.column_config.NumberColumn("📦 Carga (kg)", format="%.1f"),
            "Carga_Vol_Acum": st.column_config.NumberColumn("📦 Vol. Acum (m3)", format="%.2f"),
            "Dist_Acum": st.column_config.NumberColumn("🛣️ Distância (km)", format="%.2f"),
            "KM_Anterior": st.column_config.NumberColumn("📏 KM Trecho", format="%.2f"),
            
            # Hide technical columns
            "Latitude": None,
            "Longitude": None,
            "Nivel_Qualidade": None,
            "CP": None,
            "Localidade": None
        }

        # Explicit logical column ordering for absolute professional layout
        logical_order = [
            "Rota", "Ordem", "Cliente", "Morada", 
            "Janela_Horaria", "Chegada", "Tempo_Entrega", "Saida", 
            "KM_Anterior", "Dist_Acum", "Carga_Acum", "Carga_Vol_Acum"
        ]
        
        # Filter valid columns physically present in dataframe to avoid crashes
        valid_cols = [col for col in logical_order if col in routes_df.columns]
        
        # Editable table (Excel-like display)
        edited_df = st.data_editor(
            routes_df,
            column_config=column_config,
            column_order=valid_cols, # Force standard premium alignment!
            use_container_width=True,
            hide_index=True,
            num_rows="fixed",
            disabled=["Cliente", "Morada", "Janela_Horaria", "Chegada", "Tempo_Entrega", "Saida", "KM_Anterior", "Dist_Acum", "Carga_Acum", "Carga_Vol_Acum"],
            key="routes_editor"
        )
        
        # Validate and show warnings
        RouteEditor._show_validations(edited_df, fleet_config)
        
        return edited_df
    
    @staticmethod
    def _show_validations(routes_df, fleet_config):
        """Show real-time validations"""
        
        issues = []
        
        # Group by route
        for route_name, route_data in routes_df.groupby('Rota'):
            # Get vehicle config
            vehicle = fleet_config.get(route_name, {})
            max_capacity = vehicle.get('capacity', 1000)
            max_vol = vehicle.get('capacity_volume', 10.0)
            max_duration = vehicle.get('max_hours', 8)
            
            # Check weight capacity
            max_load = route_data['Carga_Acum'].max()
            if max_load > max_capacity:
                issues.append({
                    'type': 'error',
                    'route': route_name,
                    'message': f"⚠️ Capacidade Peso excedida: {max_load:.1f}kg / {max_capacity}kg"
                })
            
            # Check volume capacity
            if 'Carga_Vol_Acum' in route_data.columns:
                max_vol_accum = route_data['Carga_Vol_Acum'].max()
                if max_vol_accum > max_vol:
                    issues.append({
                        'type': 'error',
                        'route': route_name,
                        'message': f"⚠️ Capacidade Volume excedida: {max_vol_accum:.2f}m3 / {max_vol:.2f}m3"
                    })
            
            # Check duration
            max_dist = route_data['Dist_Acum'].max()
            est_duration = max_dist / 40  # Assuming 40 km/h average
            if est_duration > max_duration:
                issues.append({
                    'type': 'warning',
                    'route': route_name,
                    'message': f"⚠️ Duração estimada excedida: {est_duration:.1f}h / {max_duration}h"
                })
        
        # Display issues
        if issues:
            st.markdown("#### ⚠️ Validações")
            for issue in issues:
                if issue['type'] == 'error':
                    st.error(f"**{issue['route']}:** {issue['message']}")
                else:
                    st.warning(f"**{issue['route']}:** {issue['message']}")
        else:
            st.success("✅ Todas as rotas são válidas!")
    
    @staticmethod
    def recalculate_metrics(routes_df, distance_matrix, clients_df, warehouses_df):
        """Recalculate all metrics after edits"""
        
        updated_routes = []
        
        for route_name, route_data in routes_df.groupby('Rota'):
            # Skip recalculation for unassigned dummy route
            if route_name == "⚠️ PENDENTE":
                route_data = route_data.copy()
                route_data['Dist_Acum'] = 0
                route_data['Horario'] = "00:00"
                # Keep individual weights
                updated_routes.append(route_data)
                continue
                
            # Sort by order
            route_data = route_data.sort_values('Ordem').copy()
            
            # Get vehicle's warehouse location
            vehicle_info = fleet_config.get(route_name, {})
            wh_name = vehicle_info.get('warehouse')
            
            # Safely get coordinates
            if wh_name:
                matching_wh = warehouses_df[warehouses_df['Nome_Armazem'] == wh_name]
            else:
                matching_wh = warehouses_df.head(1) # Fallback
                
            if len(matching_wh) > 0:
                warehouse = matching_wh.iloc[0]
                current_lat = warehouse['Latitude']
                current_lon = warehouse['Longitude']
            else:
                # Emergency fallback if warehouse table is broken
                current_lat, current_lon = 38.7, -9.1
            
            cumulative_dist = 0
            cumulative_load = 0
            cumulative_vol = 0
            current_time = datetime.strptime("08:00", "%H:%M")
            
            for idx, row in route_data.iterrows():
                # Get client location
                client = clients_df[clients_df['Codigo_Cliente'] == row['Cliente']].iloc[0]
                client_lat = client['Latitude']
                client_lon = client['Longitude']
                client_demand = client.get('Peso_KG', 50)
                client_vol = client.get('Volume_m3', 0.1)
                
                # Calculate distance from previous point
                dist = RouteEditor._haversine(current_lat, current_lon, client_lat, client_lon)
                cumulative_dist += dist
                
                # Calculate time (assuming 40 km/h + 15 min per stop)
                travel_time = (dist / 40) * 60  # minutes
                current_time += timedelta(minutes=travel_time + 15)
                
                # Update cumulative load and volume
                cumulative_load += client_demand
                cumulative_vol += client_vol
                
                # Update row
                route_data.loc[idx, 'Dist_Acum'] = cumulative_dist
                route_data.loc[idx, 'Carga_Acum'] = cumulative_load
                route_data.loc[idx, 'Carga_Vol_Acum'] = cumulative_vol
                route_data.loc[idx, 'Horario'] = current_time.strftime("%H:%M")
                
                # Update current position
                current_lat = client_lat
                current_lon = client_lon
            
            updated_routes.append(route_data)
        
        return pd.concat(updated_routes, ignore_index=True)
    
    @staticmethod
    def _haversine(lat1, lon1, lat2, lon2):
        """Calculate distance between two points in km"""
        from math import radians, sin, cos, sqrt, atan2
        
        R = 6371  # Earth radius in km
        
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * atan2(sqrt(a), sqrt(1-a))
        
        return R * c
    
    @staticmethod
    def move_client_to_route(routes_df, client_id, from_route, to_route):
        """Move a client from one route to another"""
        
        # Update route assignment
        mask = (routes_df['Cliente'] == client_id) & (routes_df['Rota'] == from_route)
        routes_df.loc[mask, 'Rota'] = to_route
        
        # Reorder both routes
        routes_df = RouteEditor._reorder_route(routes_df, from_route)
        routes_df = RouteEditor._reorder_route(routes_df, to_route)
        
        return routes_df
    
    @staticmethod
    def _reorder_route(routes_df, route_name):
        """Reorder a specific route"""
        
        mask = routes_df['Rota'] == route_name
        route_data = routes_df[mask].copy()
        
        # Reassign order numbers
        route_data['Ordem'] = range(1, len(route_data) + 1)
        
        routes_df.loc[mask, 'Ordem'] = route_data['Ordem'].values
        
        return routes_df
