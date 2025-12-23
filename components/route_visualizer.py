"""
Route Visualizer Component - Interactive map with route filtering
"""

import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium


class RouteVisualizer:
    """Interactive route visualization with filtering"""
    
    # Color palette for routes
    COLORS = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'
    ]
    
    @staticmethod
    def render_route_selector(routes_df):
        """Render checkboxes to select which routes to display"""
        
        if routes_df is None or len(routes_df) == 0:
            return []
        
        st.markdown("### 🗺️ Visualizar Rotas")
        
        route_names = sorted(routes_df['Rota'].unique())
        
        st.markdown("**Selecione as rotas a visualizar:**")
        
        # Create columns for checkboxes
        cols = st.columns(min(len(route_names), 4))
        
        selected_routes = []
        for idx, route_name in enumerate(route_names):
            col_idx = idx % len(cols)
            with cols[col_idx]:
                if st.checkbox(route_name, value=True, key=f"route_select_{route_name}"):
                    selected_routes.append(route_name)
        
        return selected_routes
    
    @staticmethod
    def render_interactive_map(routes_df, selected_routes, warehouses_df):
        """Render interactive map with selected routes"""
        
        if not selected_routes:
            st.info("👆 Selecione pelo menos uma rota para visualizar no mapa.")
            return
        
        # Filter routes
        filtered_df = routes_df[routes_df['Rota'].isin(selected_routes)].copy()
        
        if len(filtered_df) == 0:
            st.warning("⚠️ Nenhuma entrega nas rotas selecionadas.")
            return
        
        # Calculate map center
        center_lat = filtered_df['Latitude'].mean()
        center_lon = filtered_df['Longitude'].mean()
        
        # Create map
        m = folium.Map(
            location=[center_lat, center_lon],
            zoom_start=11,
            tiles='OpenStreetMap'
        )
        
        # Add routes
        route_colors = {}
        for idx, route_name in enumerate(selected_routes):
            route_colors[route_name] = RouteVisualizer.COLORS[idx % len(RouteVisualizer.COLORS)]
        
        for route_name in selected_routes:
            RouteVisualizer._add_route_to_map(
                m,
                filtered_df[filtered_df['Rota'] == route_name],
                warehouses_df,
                route_name,
                route_colors[route_name]
            )
        
        # Add legend
        RouteVisualizer._add_legend(m, route_colors)
        
        # Display map
        st_folium(m, width=900, height=600, returned_objects=[])
    
    @staticmethod
    def _add_route_to_map(m, route_data, warehouses_df, route_name, color):
        """Add a single route to the map"""
        
        if len(route_data) == 0:
            return
        
        # Get warehouse
        warehouse = warehouses_df[warehouses_df['Nome_Armazem'] == route_name]
        if len(warehouse) == 0:
            # Use first warehouse as fallback
            warehouse = warehouses_df.iloc[0]
        else:
            warehouse = warehouse.iloc[0]
        
        # Add warehouse marker
        folium.Marker(
            location=[warehouse['Latitude'], warehouse['Longitude']],
            popup=f"<b>{route_name}</b><br>Armazém",
            icon=folium.Icon(color='green', icon='home', prefix='fa'),
            tooltip=route_name
        ).add_to(m)
        
        # Sort by order
        route_data = route_data.sort_values('Ordem')
        
        # Create route line
        route_coords = [[warehouse['Latitude'], warehouse['Longitude']]]
        
        # Add client markers
        for idx, row in route_data.iterrows():
            lat = row['Latitude']
            lon = row['Longitude']
            
            route_coords.append([lat, lon])
            
            # Popup content with CP and Localidade
            cp_info = row.get('Codigo_Postal', row.get('CP', 'N/A'))
            localidade_info = row.get('Localidade', row.get('Concelho', 'N/A'))
            
            popup_html = f"""
            <div style="font-family: Arial; min-width: 200px;">
                <h4 style="margin: 0; color: {color};">{route_name}</h4>
                <hr style="margin: 5px 0;">
                <b>Ordem:</b> {int(row['Ordem'])}<br>
                <b>Cliente:</b> {row['Cliente']}<br>
                <b>Morada:</b> {row['Morada'][:50]}...<br>
                <b>CP:</b> {cp_info}<br>
                <b>Localidade:</b> {localidade_info}<br>
                <b>Horário:</b> {row.get('Horario', 'N/A')}<br>
                <b>Carga Acum:</b> {row.get('Carga_Acum', 0):.1f} kg<br>
                <b>Dist. Acum:</b> {row.get('Dist_Acum', 0):.2f} km
            </div>
            """
            
            folium.Marker(
                location=[lat, lon],
                popup=folium.Popup(popup_html, max_width=300),
                icon=folium.Icon(color='red', icon='info-sign'),
                tooltip=f"{route_name} - {row['Cliente']}"
            ).add_to(m)
            
            # Add order number
            folium.Marker(
                location=[lat, lon],
                icon=folium.DivIcon(html=f"""
                    <div style="
                        background-color: {color};
                        color: white;
                        border-radius: 50%;
                        width: 24px;
                        height: 24px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-weight: bold;
                        font-size: 12px;
                        border: 2px solid white;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    ">{int(row['Ordem'])}</div>
                """)
            ).add_to(m)
        
        # Add return to warehouse
        route_coords.append([warehouse['Latitude'], warehouse['Longitude']])
        
        # Draw route line
        folium.PolyLine(
            route_coords,
            color=color,
            weight=3,
            opacity=0.7,
            popup=f"Rota {route_name}"
        ).add_to(m)
    
    @staticmethod
    def _add_legend(m, route_colors):
        """Add legend to map"""
        
        legend_html = '''
        <div style="
            position: fixed;
            bottom: 50px;
            right: 50px;
            width: 200px;
            background-color: white;
            border: 2px solid grey;
            border-radius: 5px;
            padding: 10px;
            font-size: 14px;
            z-index: 9999;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        ">
        <h4 style="margin: 0 0 10px 0;">Rotas</h4>
        '''
        
        for route_name, color in route_colors.items():
            legend_html += f'''
            <div style="margin: 5px 0;">
                <span style="
                    display: inline-block;
                    width: 20px;
                    height: 20px;
                    background-color: {color};
                    border-radius: 50%;
                    margin-right: 8px;
                    vertical-align: middle;
                "></span>
                <span style="vertical-align: middle;">{route_name}</span>
            </div>
            '''
        
        legend_html += '</div>'
        
        m.get_root().html.add_child(folium.Element(legend_html))
    
    @staticmethod
    def render_route_metrics(routes_df, selected_routes):
        """Render metrics for selected routes"""
        
        if not selected_routes:
            return
        
        st.markdown("### 📊 Métricas por Rota")
        
        # Create metrics for each route
        cols = st.columns(min(len(selected_routes), 3))
        
        for idx, route_name in enumerate(selected_routes):
            route_data = routes_df[routes_df['Rota'] == route_name]
            
            if len(route_data) == 0:
                continue
            
            col_idx = idx % len(cols)
            
            with cols[col_idx]:
                st.markdown(f"**{route_name}**")
                
                # Calculate metrics
                total_dist = route_data['Dist_Acum'].max()
                total_load = route_data['Carga_Acum'].max()
                num_deliveries = len(route_data)
                
                # Display metrics
                metric_col1, metric_col2 = st.columns(2)
                with metric_col1:
                    st.metric("Entregas", num_deliveries)
                    st.metric("Distância", f"{total_dist:.1f} km")
                with metric_col2:
                    st.metric("Carga", f"{total_load:.0f} kg")
                    est_time = (total_dist / 40) + (num_deliveries * 0.25)  # 15 min per stop
                    st.metric("Tempo Est.", f"{est_time:.1f}h")
