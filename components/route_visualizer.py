"""
Route Visualizer Component - Interactive map with route filtering
"""

import streamlit as st
from core.session_state import get_state
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
        
        st.markdown("### 🔍 Selecionar e Filtrar Rotas")
        st.caption("Poupe espaço de ecrã: clique na caixa abaixo para adicionar ou remover as rotas visíveis.")
        
        route_names = sorted(routes_df['Rota'].unique())
        selected_routes = st.multiselect("Rotas Ativas:", route_names, default=route_names)
        
        return selected_routes
        
    @staticmethod
    def render_interactive_map(routes_df, selected_routes, warehouses_df, height=600):
        """
        Render dynamic folium map with routes, start-markers, client-markers,
        and click actions.
        """
        if routes_df is None or len(routes_df) == 0:
            return None
            
        # Color mapper
        route_names = sorted(routes_df['Rota'].unique())
        route_colors = {
            name: RouteVisualizer.COLORS[i % len(RouteVisualizer.COLORS)]
            for i, name in enumerate(route_names)
        }
        
        # Center coordinates
        active_coords = routes_df[routes_df['Rota'].isin(selected_routes)]
        if len(active_coords) > 0:
            center_lat = active_coords['Latitude'].mean()
            center_lon = active_coords['Longitude'].mean()
        else:
            center_lat, center_lon = 39.5, -8.0 # Default center
            
        m = folium.Map(location=[center_lat, center_lon], zoom_start=8)
        
        # Add routes layer
        for route_name in selected_routes:
            route_data = routes_df[routes_df['Rota'] == route_name]
            RouteVisualizer._add_route_to_map(
                m,
                route_data,
                warehouses_df,
                route_name,
                route_colors[route_name]
            )
            
        # Call Streamlit Folium
        map_output = st_folium(
            m,
            width=None,
            height=height,
            key="route_planning_folium_map",
            returned_objects=["last_object_clicked", "last_clicked"]
        )
        
        return map_output
        
    @staticmethod
    def _add_route_to_map(m, route_data, warehouses_df, route_name, color):
        """Add route path and marker points to map"""
        import math
        
        if len(route_data) == 0:
            return
          
        # Get warehouse
        if warehouses_df is None:
            warehouses_df = get_state().warehouses_geocoded
              
        if warehouses_df is None or len(warehouses_df) == 0:
            return # Absolute fail-safe to protect visualization
              
        warehouse = warehouses_df[warehouses_df['Nome_Armazem'] == route_name]
        
        # Fallback if no specific warehouse corresponds to vehicle name
        if len(warehouse) == 0:
            warehouse = warehouses_df.iloc[0]
        else:
            warehouse = warehouse.iloc[0]
            
        depot_coords = (float(warehouse['Latitude']), float(warehouse['Longitude']))
        
        # 1. Start Warehouse Marker
        folium.Marker(
            depot_coords,
            popup=f"Origem: {warehouse['Nome_Armazem']}",
            tooltip=f"Armazém de {route_name}",
            icon=folium.Icon(color='red', icon='warehouse', prefix='fa')
        ).add_to(m)
        
        # Sort by Order (since Sequencia is old schema)
        sort_col = 'Ordem' if 'Ordem' in route_data.columns else ('Sequencia' if 'Sequencia' in route_data.columns else None)
        if sort_col:
            route_sorted = route_data.sort_values(by=sort_col)
        else:
            route_sorted = route_data
        
        # Coordinate list
        coords_list = [depot_coords]
        for _, row in route_sorted.iterrows():
            coords_list.append((float(row['Latitude']), float(row['Longitude'])))
        coords_list.append(depot_coords) # return to base
        
        # 2. Draw line path
        folium.PolyLine(
            coords_list,
            color=color,
            weight=4,
            opacity=0.85,
            tooltip=f"Rota {route_name}"
        ).add_to(m)
        
        # Get geocoded clients for dynamic lookups of Name, Weight, Volume
        clients_geocoded = get_state().clients_geocoded
        
        # 3. Add client markers
        for idx, row in route_sorted.iterrows():
            client_id = row['Cliente']
            client_name = row.get('Nome', client_id)
            client_weight = row.get('Peso_KG', row.get('Carga_Acum', 0.0))
            client_vol = row.get('Volume_m3', row.get('Carga_Vol_Acum', 0.0))
            
            # Dynamic lookup for extra robustness
            if clients_geocoded is not None:
                match = clients_geocoded[clients_geocoded['Codigo_Cliente'] == client_id]
                if len(match) > 0:
                    client_name = match.iloc[0].get('Nome', client_id)
                    client_weight = match.iloc[0].get('Peso_KG', client_weight)
                    client_vol = match.iloc[0].get('Volume_m3', client_vol)
            
            order_val = row.get('Ordem', row.get('Sequencia', 1))
            arrival_val = row.get('Chegada', row.get('Hora_Chegada', '00:00'))
            
            tooltip_txt = f"{client_name} ({order_val}°)"
            popup_html = f"""
                <div style='font-family: Arial; font-size: 12px;'>
                    <b>Cliente:</b> {client_id}<br/>
                    <b>Nome:</b> {client_name}<br/>
                    <b>Morada:</b> {row['Morada']}<br/>
                    <b>Volume:</b> {client_vol:.2f} m3<br/>
                    <b>Peso:</b> {client_weight:.1f} kg<br/>
                    <b>Janela:</b> {row['Janela_Horaria']}<br/>
                    <b>Chegada:</b> {arrival_val}<br/>
                    <b>Paragem:</b> Rota {row['Rota']} (#{order_val})
                </div>
            """
            
            # Highlight with warning colors if constraint broken
            icon_color = 'blue'
            if 'Broken' in row and row['Broken']:
                icon_color = 'orange' # Constraint warning marker!
                
            folium.Marker(
                (float(row['Latitude']), float(row['Longitude'])),
                popup=folium.Popup(popup_html, max_width=300),
                tooltip=tooltip_txt,
                icon=folium.Icon(
                    color=icon_color,
                    icon='shopping-cart',
                    prefix='fa'
                )
            ).add_to(m)
            
    @staticmethod
    def render_total_summary_line(routes_df):
        """Render total metrics in a single compact line"""
        import pandas as pd
        
        if routes_df is None or len(routes_df) == 0:
            return
            
        tot_veic = len(routes_df['Rota'].unique())
        tot_entregas = len(routes_df)
        
        # Column names robust fallback
        dist_col = 'Dist_Acum' if 'Dist_Acum' in routes_df.columns else ('Distancia_Acumulada_KM' if 'Distancia_Acumulada_KM' in routes_df.columns else None)
        if dist_col:
            tot_dist = routes_df.groupby('Rota')[dist_col].max().sum()
        else:
            tot_dist = 0.0
            
        # Weight / Volume fallbacks
        if 'Peso_KG' in routes_df.columns:
            tot_peso = routes_df['Peso_KG'].sum()
        elif 'Carga_Acum' in routes_df.columns:
            tot_peso = routes_df.groupby('Rota')['Carga_Acum'].max().sum()
        else:
            tot_peso = 0.0
            
        if 'Volume_m3' in routes_df.columns:
            tot_vol = routes_df['Volume_m3'].sum()
        elif 'Carga_Vol_Acum' in routes_df.columns:
            tot_vol = routes_df.groupby('Rota')['Carga_Vol_Acum'].max().sum()
        else:
            tot_vol = 0.0
            
        # Dynamic Cost calculation based on distance and vehicle cost_per_km
        tot_custo = 0.0
        fleet_config = get_state().fleet_config_used or {}
        for name in routes_df['Rota'].unique():
            r_data = routes_df[routes_df['Rota'] == name]
            dist = r_data[dist_col].max() if dist_col in r_data.columns else 0.0
            veh_info = fleet_config.get(name)
            cost_per_km = 0.5
            if veh_info:
                if hasattr(veh_info, 'custo_km'):
                    cost_per_km = veh_info.custo_km
                elif isinstance(veh_info, dict):
                    cost_per_km = veh_info.get('cost_per_km', 0.5)
            tot_custo += dist * cost_per_km
            
        st.markdown(
            f"""
            <div style='background-color:#f1f3f5; border-left: 5px solid #554640; padding:10px 15px; border-radius:4px; font-weight:bold; font-size:14px; margin-bottom:15px;'>
                🚌 {tot_veic} Veículos &nbsp;&nbsp;|&nbsp;&nbsp; 
                📦 {tot_entregas} Entregas &nbsp;&nbsp;|&nbsp;&nbsp; 
                ⚖️ {tot_peso:.1f} kg &nbsp;&nbsp;|&nbsp;&nbsp; 
                🪣 {tot_vol:.2f} m³ &nbsp;&nbsp;|&nbsp;&nbsp; 
                🏁 {tot_dist:.1f} km Totais &nbsp;&nbsp;|&nbsp;&nbsp; 
                💰 Custo Est. € {tot_custo:.2f}
            </div>
            """, 
            unsafe_allow_html=True
        )

    @staticmethod
    def render_route_metrics(routes_df, selected_routes=None):
        """Render metrics in a premium, unified Excel-style DataFrame grid. Returns selected route names."""
        import pandas as pd
        
        if selected_routes is None:
            selected_routes = sorted(routes_df['Rota'].unique())
            
        if len(routes_df) == 0:
            return []
            
        st.markdown("#### 📊 Selecione os veículos na grelha para filtrar a tabela de edição:")
        
        # Obter capacidades da frota para as cores
        fleet_config = get_state().fleet_config_used
        opt_params = get_state().optimization_params
        max_duration_h = opt_params.get('max_route_duration', 480) / 60.0
        
        summary_rows = []
        
        # Column names robust fallbacks
        dist_col = 'Dist_Acum' if 'Dist_Acum' in routes_df.columns else ('Distancia_Acumulada_KM' if 'Distancia_Acumulada_KM' in routes_df.columns else None)
        
        for name in selected_routes:
            r_data = routes_df[routes_df['Rota'] == name]
            if len(r_data) == 0:
                continue
                
            dist = r_data[dist_col].max() if dist_col and dist_col in r_data.columns else 0.0
            
            # Resolve cost
            veh_info = fleet_config.get(name)
            cost_per_km = 0.5
            if veh_info:
                if hasattr(veh_info, 'custo_km'):
                    cost_per_km = veh_info.custo_km
                elif isinstance(veh_info, dict):
                    cost_per_km = veh_info.get('cost_per_km', 0.5)
            cost = dist * cost_per_km
            
            # Weight and volume
            if 'Peso_KG' in r_data.columns:
                wt = r_data['Peso_KG'].sum()
            elif 'Carga_Acum' in r_data.columns:
                wt = r_data['Carga_Acum'].max()
            else:
                wt = 0.0
                
            if 'Volume_m3' in r_data.columns:
                vol = r_data['Volume_m3'].sum()
            elif 'Carga_Vol_Acum' in r_data.columns:
                vol = r_data['Carga_Vol_Acum'].max()
            else:
                vol = 0.0
            
            # Calculate duration in hours
            time_col = 'Chegada' if 'Chegada' in r_data.columns else ('Hora_Chegada' if 'Hora_Chegada' in r_data.columns else None)
            if time_col:
                last_stop_time = r_data[time_col].iloc[-1]
                try:
                    h, m = map(int, last_stop_time.split(':'))
                    dur_h = (h * 60 + m - 480) / 60.0 # Shift 08:00
                except Exception:
                    dur_h = 4.0 # default fallback
            else:
                dur_h = 4.0
                
            # Get configured limit or default
            cap_wt = veh_info.capacidade_kg if (veh_info and hasattr(veh_info, 'capacidade_kg')) else (veh_info.get('capacity', 1000.0) if isinstance(veh_info, dict) else 1000.0)
            cap_vol = veh_info.capacidade_vol if (veh_info and hasattr(veh_info, 'capacidade_vol')) else (veh_info.get('capacity_volume', 10.0) if isinstance(veh_info, dict) else 10.0)
            
            wt_pct = (wt / cap_wt) * 100 if cap_wt > 0 else 0
            vol_pct = (vol / cap_vol) * 100 if cap_vol > 0 else 0
            dur_pct = (dur_h / max_duration_h) * 100 if max_duration_h > 0 else 0
            
            summary_rows.append({
                'Veículo (Rota)': name,
                'Clientes': len(r_data),
                'Distância (km)': round(dist, 1),
                'Peso (kg)': round(wt, 1),
                'Vol (m³)': round(vol, 2),
                'Custo (€)': round(cost, 2),
                'Carga %': f"{wt_pct:.1f}%",
                'Vol %': f"{vol_pct:.1f}%",
                'Tempo %': f"{dur_pct:.1f}%"
            })
            
        summary_df = pd.DataFrame(summary_rows)
        
        # Display with dynamic row selection
        event = st.dataframe(
            summary_df,
            use_container_width=True,
            hide_index=True,
            on_select="rerun",
            selection_mode="single-row"
        )
        
        if event and event.selection.rows:
            sel_idx = event.selection.rows[0]
            selected_vehs = [summary_df.iloc[sel_idx]['Veículo (Rota)']]
            return selected_vehs
            
        return selected_routes
