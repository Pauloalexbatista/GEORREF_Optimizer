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
        
        # --- SPATIAL DRAWING TOOLKIT (NIVEL 2) ---
        # Integrates industrial-grade GIS interactive drawing tools. User can draw circles, rectangles
        # and custom polygons over spatial territory directly on the live web map!
        from folium.plugins import Draw
        Draw(
            export=False,
            filename='drawn_area.geojson',
            position='topleft',
            draw_options={
                'polyline': False, # Disable line drawing
                'polygon': True, # Enable custom polygon areas
                'circle': True, # Enable radial radius select
                'rectangle': True, # Enable bounding boxes
                'marker': False,
                'circlemarker': False
            },
            edit_options={'remove': True}
        ).add_to(m)
        
        # Display map and capture marker click interactions!
        # Uses container width scaling so it auto-shrinks/grows when placed in a multi-column layout!
        return st_folium(m, use_container_width=True, height=600, returned_objects=["last_object_clicked"])
    
    @staticmethod
    def _fetch_real_roads(coords):
        """
        Queries the Public OSRM API to transform straight lines into real driving roads.
        Handles chunks to ensure URL length safety and provides fault-tolerant straight-line fallbacks.
        """
        import requests
        
        if len(coords) < 2:
            return coords
            
        try:
            road_coords = []
            
            # Public OSRM limits coordinates length. We query in overlapping chunks of 15 points
            chunk_size = 15
            for i in range(0, len(coords) - 1, chunk_size - 1):
                chunk = coords[i : i + chunk_size]
                if len(chunk) < 2:
                    continue
                
                # OSRM format requires "lon,lat;lon,lat..."
                coords_str = ";".join([f"{lon},{lat}" for lat, lon in chunk])
                
                url = f"http://router.project-osrm.org/route/v1/driving/{coords_str}?overview=full&geometries=geojson"
                
                # Set reasonable 3-second timeout to not lock the UI
                r = requests.get(url, timeout=3.0)
                if r.status_code == 200:
                    res_data = r.json()
                    if 'routes' in res_data and len(res_data['routes']) > 0:
                        # Extract geojson geometry (lon, lat pairs)
                        geom = res_data['routes'][0]['geometry']['coordinates']
                        # Convert back to folium's [lat, lon]
                        segment_coords = [[p[1], p[0]] for p in geom]
                        
                        # Avoid duplicating connecting points
                        if road_coords:
                            road_coords.extend(segment_coords[1:])
                        else:
                            road_coords.extend(segment_coords)
                    else:
                        # Chunk level fallback
                        road_coords.extend(chunk)
                else:
                    # Request failed level fallback
                    road_coords.extend(chunk)
            
            return road_coords if road_coords else coords
            
        except Exception:
            # Absolute fallback to original straight lines in case of no internet or timeout
            return coords

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
            
            # Extract robust variables
            arrive = row.get('Chegada', 'N/A')
            depart = row.get('Saida', 'N/A')
            req_window = row.get('Janela_Horaria', 'Livre')
            
            popup_html = f"""
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; min-width: 260px; color: #333; font-size: 13px;">
                <div style="background-color: {color}; color: white; padding: 8px 12px; border-radius: 4px 4px 0 0; margin: -10px -10px 8px -10px;">
                    <h4 style="margin: 0; font-size: 14px; font-weight: 600;">📍 Paragem #{int(row['Ordem'])} - {row['Cliente']}</h4>
                    <small style="opacity: 0.9;">{route_name}</small>
                </div>
                <div style="padding: 2px 0;">
                    <p style="margin: 4px 0;"><b>🏠 Morada:</b> {row['Morada']}</p>
                    <p style="margin: 4px 0;"><b>📮 CP / Loc:</b> {cp_info} {localidade_info}</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
                    <p style="margin: 4px 0; font-size: 12px; color: #E67E22;"><b>⏰ Janela Escolhida:</b> {req_window}</p>
                    <p style="margin: 4px 0; font-weight: bold; color: #2E86C1;"><b>🕒 Previsão Chegada:</b> {arrive}</p>
                    <p style="margin: 4px 0;"><b>🕒 Saída Prevista:</b> {depart}</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 8px 0;">
                    <table style="width: 100%; font-size: 12px; text-align: left;">
                        <tr>
                            <td><b>📦 Carga:</b> {row.get('Carga_Acum', 0):.1f} kg</td>
                            <td><b>📦 Volume:</b> {row.get('Carga_Vol_Acum', 0):.2f} m³</td>
                        </tr>
                        <tr>
                            <td colspan="2"><b>🛣️ Dist. Acumulada:</b> {row.get('Dist_Acum', 0):.2f} km</td>
                        </tr>
                    </table>
                </div>
            </div>
            """
            
            # Get the character to display inside the Pin
            pin_label = str(int(row['Ordem']))
            if "PENDENTE" in route_name:
                pin_label = "⚠️"
                
            # --- COLLAPSED PREMIUM CUSTOM TEARDROP MARKER ---
            # Eradicates the redundant red "i" markers. Combines info popup, number, and precise route color 
            # into a single, mathematical CSS Teardrop Pin anchored perfectly!
            folium.Marker(
                location=[lat, lon],
                popup=folium.Popup(popup_html, max_width=300),
                icon=folium.DivIcon(
                    icon_size=(36, 36),
                    icon_anchor=(18, 36),
                    html=f"""
                    <div style="
                        position: relative;
                        width: 36px;
                        height: 36px;
                        background-color: {color};
                        border-radius: 50% 50% 50% 0;
                        transform: rotate(-45deg);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border: 2px solid white;
                        box-shadow: 0 3px 10px rgba(0,0,0,0.5);
                        cursor: pointer;
                        transition: transform 0.2s ease;
                    " onmouseover="this.style.transform='rotate(-45deg) scale(1.2)';" onmouseout="this.style.transform='rotate(-45deg) scale(1.0)';">
                        <div style="
                            transform: rotate(45deg);
                            color: white;
                            font-weight: 800;
                            font-size: 13px;
                            font-family: 'Arial', sans-serif;
                            margin-top: -3px;
                            margin-left: 3px;
                            text-align: center;
                        ">{pin_label}</div>
                    </div>
                    """
                ),
                tooltip=f"Paragem #{pin_label} - {row['Cliente']}"
            ).add_to(m)
        
        # Add return to warehouse
        route_coords.append([warehouse['Latitude'], warehouse['Longitude']])
        
        # --- ROAD-ACCURATE ROUTING (OSRM) ---
        # Queries public OpenStreetMap routing service to fetch real roads instead of straight lines!
        final_draw_coords = RouteVisualizer._fetch_real_roads(route_coords)
        
        # Draw route line
        folium.PolyLine(
            final_draw_coords,
            color=color,
            weight=4,
            opacity=0.8,
            popup=f"<b>Rota: {route_name}</b><br>(Passa por vias reais)"
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
        """Render metrics in a premium, unified Excel-style DataFrame grid"""
        import pandas as pd
        
        if not selected_routes:
            return
            
        st.markdown("### 📊 Resumo Consolidado das Rotas (Excel Grid)")
        
        summary_rows = []
        
        for route_name in selected_routes:
            route_data = routes_df[routes_df['Rota'] == route_name]
            if len(route_data) == 0:
                continue
                
            # Calculate aggregated metrics
            num_deliveries = len(route_data)
            
            # Check if it's a real route or a pending queue to correctly represent metrics
            if "PENDENTE" in route_name:
                total_dist = 0.0
                est_time = 0.0
                # For pending list, demands do not accumulate chronologically, we sum them directly!
                total_load = route_data['Carga_Acum'].sum() if 'Carga_Acum' in route_data.columns else 0.0
                total_vol = route_data['Carga_Vol_Acum'].sum() if 'Carga_Vol_Acum' in route_data.columns else 0.0
            else:
                total_dist = float(route_data['Dist_Acum'].max())
                total_load = float(route_data['Carga_Acum'].max())
                total_vol = float(route_data['Carga_Vol_Acum'].max()) if 'Carga_Vol_Acum' in route_data.columns else 0.0
                # Standard logic: travel + 15m per delivery stop
                est_time = (total_dist / 40.0) + (num_deliveries * 0.25)
            
            summary_rows.append({
                "Veículo / Rota": route_name,
                "Nº Entregas": int(num_deliveries),
                "Distância Total (km)": round(total_dist, 2),
                "Duração Prevista (h)": round(est_time, 1),
                "Peso Ocupado (kg)": round(total_load, 1),
                "Volume Ocupado (m3)": round(total_vol, 2)
            })
            
        if not summary_rows:
            st.info("Nenhuma métrica a exibir.")
            return
            
        df_summary = pd.DataFrame(summary_rows)
        
        # Configure columns to give that ultimate premium feeling
        column_config = {
            "Veículo / Rota": st.column_config.TextColumn("🚚 Veículo / Rota", required=True),
            "Nº Entregas": st.column_config.NumberColumn("📦 Nº Entregas", format="%d paragens"),
            "Distância Total (km)": st.column_config.NumberColumn("🛣️ Distância", format="%.2f km"),
            "Duração Prevista (h)": st.column_config.NumberColumn("🕒 Duração", format="%.1f h"),
            "Peso Ocupado (kg)": st.column_config.NumberColumn("⚖️ Peso Carga", format="%.1f kg"),
            "Volume Ocupado (m3)": st.column_config.NumberColumn("🧊 Volume Carga", format="%.2f m³")
        }
        
        # Render interactive excel grid
        st.dataframe(
            df_summary,
            column_config=column_config,
            hide_index=True,
            use_container_width=True,
            key="visual_summary_metrics_grid"
        )
        
        # Add a super fast summary footer metrics block for the WHOLE operations day!
        real_routes_df = df_summary[~df_summary['Veículo / Rota'].str.contains("PENDENTE", na=False)]
        
        st.markdown("---")
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("🏆 Total Distância", f"{real_routes_df['Distância Total (km)'].sum():.1f} km")
        with col2:
            st.metric("⌛ Horas Totais Frota", f"{real_routes_df['Duração Prevista (h)'].sum():.1f} h")
        with col3:
            st.metric("⚖️ Peso Total Entregue", f"{real_routes_df['Peso Ocupado (kg)'].sum():.1f} kg")
        with col4:
            st.metric("🧊 Volume Total Entregue", f"{real_routes_df['Volume Ocupado (m3)'].sum():.1f} m³")
