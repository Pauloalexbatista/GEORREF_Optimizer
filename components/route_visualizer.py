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
        
        st.markdown("### 🗺️ Selecionar e Filtrar Rotas")
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
        
        # Sort by Sequence
        route_sorted = route_data.sort_values(by='Sequencia')
        
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
        
        # 3. Add client markers
        for idx, row in route_sorted.iterrows():
            tooltip_txt = f"{row['Nome']} ({row['Sequencia']}º)"
            popup_html = f"""
                <div style='font-family: Arial; font-size: 12px;'>
                    <b>Cliente:</b> {row['Cliente']}<br/>
                    <b>Nome:</b> {row['Nome']}<br/>
                    <b>Morada:</b> {row['Morada']}<br/>
                    <b>Volume:</b> {row['Volume_m3']:.2f} m3<br/>
                    <b>Peso:</b> {row['Peso_KG']:.1f} kg<br/>
                    <b>Janela:</b> {row['Janela_Horaria']}<br/>
                    <b>Chegada:</b> {row['Hora_Chegada']}<br/>
                    <b>Paragem:</b> Rota {row['Rota']} (#{row['Sequencia']})
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
            
        routes_grp = routes_df.groupby('Rota')
        
        tot_veic = len(routes_df['Rota'].unique())
        tot_entregas = len(routes_df)
        tot_dist = routes_df.groupby('Rota')['Distancia_Acumulada_KM'].max().sum()
        
        # Total weight/volume delivered
        tot_peso = routes_df['Peso_KG'].sum()
        tot_vol = routes_df['Volume_m3'].sum()
        
        # Cost estimate
        tot_custo = routes_df.groupby('Rota')['Custo_Acumulado_EUR'].max().sum()
        
        st.markdown(
            f"""
            <div style='background-color:#f1f3f5; border-left: 5px solid #554640; padding:10px 15px; border-radius:4px; font-weight:bold; font-size:14px; margin-bottom:15px;'>
                🚚 {tot_veic} Veículos &nbsp;&nbsp;|&nbsp;&nbsp; 
                📦 {tot_entregas} Entregas &nbsp;&nbsp;|&nbsp;&nbsp; 
                ⚖️ {tot_peso:.1f} kg &nbsp;&nbsp;|&nbsp;&nbsp; 
                📏 {tot_vol:.2f} m³ &nbsp;&nbsp;|&nbsp;&nbsp; 
                🗺️ {tot_dist:.1f} km Totais &nbsp;&nbsp;|&nbsp;&nbsp; 
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
        
        for name in selected_routes:
            r_data = routes_df[routes_df['Rota'] == name]
            if len(r_data) == 0:
                continue
                
            dist = r_data['Distancia_Acumulada_KM'].max()
            cost = r_data['Custo_Acumulado_EUR'].max()
            wt = r_data['Peso_KG'].sum()
            vol = r_data['Volume_m3'].sum()
            
            # Calculate duration in hours
            last_stop_time = r_data['Hora_Chegada'].iloc[-1]
            try:
                h, m = map(int, last_stop_time.split(':'))
                dur_h = (h * 60 + m - 480) / 60.0 # Shift 08:00
            except Exception:
                dur_h = 4.0 # default fallback
                
            # Get configured limit or default
            veh_info = fleet_config.get(name)
            cap_wt = veh_info.capacidade_kg if veh_info else 1000.0
            cap_vol = veh_info.capacidade_vol if veh_info else 10.0
            
            wt_pct = (wt / cap_wt) * 100
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
