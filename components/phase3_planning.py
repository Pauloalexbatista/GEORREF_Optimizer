"""
Phase 3: Interactive Route Planning and Editing
Handles route optimization, interactive editing, and final export.
"""

import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium

from utils.optimization_solver import AdvancedRouteOptimizer
from utils.distance_calculator import calculate_haversine_matrix
from utils.export_engine import generate_route_excel
from components.route_editor import RouteEditor
from components.route_visualizer import RouteVisualizer


class Phase3Planning:
    """Phase 3: Interactive route planning"""
    
    @staticmethod
    def render():
        st.title("🚚 Fase 3: Planeamento de Rotas")
        
        # Check prerequisites
        if not Phase3Planning.check_prerequisites():
            Phase3Planning.render_prerequisites_checklist()
            return
        
        # Main interface
        Phase3Planning.render_planning_interface()
    
    @staticmethod
    def check_prerequisites():
        """Check if all prerequisites are met"""
        has_clients = st.session_state.get('clients_geocoded') is not None
        has_fleet = st.session_state.get('fleet_config') is not None
        has_warehouses = st.session_state.get('warehouses_geocoded') is not None
        
        return has_clients and has_fleet and has_warehouses
    
    @staticmethod
    def render_prerequisites_checklist():
        """Show what's missing"""
        st.warning("⚠️ **Pré-requisitos em falta**")
        
        st.markdown("Para avançar para o planeamento de rotas, precisa de:")
        
        has_clients = st.session_state.get('clients_geocoded') is not None
        has_fleet = st.session_state.get('fleet_config') is not None
        has_warehouses = st.session_state.get('warehouses_geocoded') is not None
        
        status_clients = "✅" if has_clients else "❌"
        status_fleet = "✅" if has_fleet else "❌"
        status_warehouses = "✅" if has_warehouses else "❌"
        
        st.markdown(f"""
        - {status_clients} **Clientes georreferenciados** (Fase 1)
        - {status_warehouses} **Armazéns georreferenciados** (Fase 2)
        - {status_fleet} **Frota configurada** (Fase 2)
        """)
        
        if not has_clients:
            if st.button("⬅️ Voltar para Fase 1", use_container_width=True):
                st.session_state['current_phase'] = 1
                st.rerun()
        elif not (has_fleet and has_warehouses):
            if st.button("⬅️ Voltar para Fase 2", use_container_width=True):
                st.session_state['current_phase'] = 2
                st.rerun()
    
    @staticmethod
    def render_planning_interface():
        """Main planning interface"""
        
        # Step 1: Execute Optimization
        st.markdown("## 1️⃣ Calcular Rotas Otimizadas")
        
        if 'routes_solution' not in st.session_state:
            Phase3Planning.render_optimization_config()
        else:
            st.success("✅ Rotas calculadas!")
            
            if st.button("🔄 Recalcular Rotas", key="recalc_routes"):
                del st.session_state['routes_solution']
                if 'edited_routes' in st.session_state:
                    del st.session_state['edited_routes']
                st.rerun()
        
        # Step 2: Edit Routes (if solution exists)
        if 'routes_solution' in st.session_state:
            st.markdown("---")
            st.markdown("## 2️⃣ Editar Rotas")
            
            Phase3Planning.render_route_editor()
            
            st.markdown("---")
            st.markdown("## 3️⃣ Visualizar Rotas")
            
            Phase3Planning.render_route_visualization()
            
            st.markdown("---")
            st.markdown("## 4️⃣ Exportar Resultado Final")
            
            Phase3Planning.render_export_section()
    
    @staticmethod
    def render_optimization_config():
        """Configuration and execution of optimization"""
        
        st.info("📋 Configure os parâmetros de otimização e clique em 'Calcular Rotas'.")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            distance_weight = st.slider(
                "Peso: Minimizar Distância",
                0, 100, 60,
                help="Quanto maior, mais foco em reduzir distância total"
            )
        
        with col2:
            balance_weight = st.slider(
                "Peso: Balancear Rotas",
                0, 100, 30,
                help="Quanto maior, mais equilibradas ficam as rotas"
            )
        
        with col3:
            max_hours = st.number_input(
                "Máx. Horas por Rota",
                min_value=4, max_value=12, value=8,
                help="Duração máxima de cada rota"
            )
        
        if st.button("🚀 Calcular Rotas Otimizadas", type="primary", use_container_width=True):
            Phase3Planning.run_optimization({
                'distance_weight': distance_weight,
                'balance_weight': balance_weight,
                'max_route_duration': max_hours * 60,
                'time_limit_seconds': 30  # OR-Tools search time limit
            })
    
    @staticmethod
    def run_optimization(params):
        """Execute route optimization"""
        
        clients_df = st.session_state['clients_geocoded']
        fleet_config = st.session_state['fleet_config']
        warehouses_df = st.session_state['warehouses_geocoded']
        
        with st.spinner("🔄 Calculando rotas otimizadas..."):
            # Prepare data
            locations = []
            location_names = []
            demands = []
            
            # Add warehouses first
            warehouse_indices = {}
            for idx, row in warehouses_df.iterrows():
                locations.append((row['Latitude'], row['Longitude']))
                location_names.append(row['Nome_Armazem'])
                demands.append(0)  # Warehouses have no demand
                warehouse_indices[row['Nome_Armazem']] = len(locations) - 1
            
            # Add clients
            client_start_idx = len(locations)
            for idx, row in clients_df.iterrows():
                locations.append((row['Latitude'], row['Longitude']))
                location_names.append(row.get('Codigo_Cliente', f'Cliente_{idx}'))
                demands.append(row.get('Demanda_KG', 50))  # Default 50kg
            
            # Calculate distance matrix
            distance_matrix = calculate_haversine_matrix(locations)
            
            # Prepare fleet
            vehicle_capacities = []
            depot_indices = []
            vehicle_names = []
            
            for vehicle_name, vehicle_data in fleet_config.items():
                vehicle_capacities.append(vehicle_data['capacity'])
                warehouse_name = vehicle_data.get('warehouse', warehouses_df.iloc[0]['Nome_Armazem'])
                depot_indices.append(warehouse_indices.get(warehouse_name, 0))
                vehicle_names.append(vehicle_name)
            
            # Optimize
            optimizer = AdvancedRouteOptimizer()
            
            try:
                result = optimizer.optimize_routes(
                    distance_matrix,
                    demands,
                    vehicle_capacities,
                    depot_indices,
                    optimization_params=params
                )
                
                if result['status'] != 'SUCCESS':
                    st.error("❌ **Falha na otimização**")
                    
                    # Detailed diagnostics
                    st.markdown("### 🔍 Diagnóstico")
                    
                    total_demand = sum(demands)
                    total_capacity = sum(vehicle_capacities)
                    
                    col1, col2, col3 = st.columns(3)
                    col1.metric("Total a Entregar", f"{total_demand:.0f} kg")
                    col2.metric("Capacidade Total", f"{total_capacity:.0f} kg")
                    col3.metric("Diferença", f"{total_capacity - total_demand:.0f} kg", 
                               delta_color="normal" if total_capacity >= total_demand else "inverse")
                    
                    st.markdown("### 💡 Possíveis Causas")
                    
                    issues = []
                    
                    # Check capacity
                    if total_capacity < total_demand:
                        issues.append("🔴 **Capacidade insuficiente**: A frota não tem capacidade para todas as entregas")
                        st.error(f"A capacidade total da frota ({total_capacity:.0f} kg) é menor que o peso total das entregas ({total_demand:.0f} kg).")
                        st.info(f"💡 **Solução**: Adicione mais veículos ou aumente a capacidade dos existentes em pelo menos {total_demand - total_capacity:.0f} kg")
                    
                    # Check time limits
                    max_duration = params.get('max_route_duration', 480)
                    if max_duration < 120:
                        issues.append("🟡 **Tempo muito restrito**: Duração máxima por rota pode ser muito baixa")
                        st.warning(f"A duração máxima por rota está definida para {max_duration/60:.1f} horas. Isto pode ser muito restritivo.")
                        st.info("💡 **Solução**: Aumente o valor de 'Máx. Horas por Rota' para 6-8 horas")
                    
                    # Check number of vehicles vs clients
                    num_clients = len(clients_df)
                    num_vehicles = len(vehicle_capacities)
                    if num_vehicles > num_clients:
                        issues.append("🟡 **Mais veículos que clientes**: Pode causar problemas de otimização")
                        st.warning(f"Tem {num_vehicles} veículos para apenas {num_clients} clientes.")
                        st.info("💡 **Solução**: Reduza o número de veículos ou adicione mais clientes")
                    
                    # Check if demands are too large
                    max_demand = max(demands) if demands else 0
                    max_capacity = max(vehicle_capacities) if vehicle_capacities else 0
                    if max_demand > max_capacity:
                        issues.append("🔴 **Cliente com peso excessivo**: Há clientes que não cabem em nenhum veículo")
                        st.error(f"Há pelo menos um cliente com {max_demand:.0f} kg, mas o maior veículo só tem {max_capacity:.0f} kg de capacidade.")
                        st.info("💡 **Solução**: Aumente a capacidade do maior veículo ou divida a entrega")
                    
                    if not issues:
                        st.warning("⚠️ Não foi possível identificar a causa específica. Tente:")
                        st.markdown("""
                        - Aumentar o tempo máximo por rota
                        - Reduzir o peso de balanceamento
                        - Verificar se todos os clientes têm coordenadas válidas
                        - Verificar se os armazéns estão corretamente configurados
                        """)
                    
                    st.markdown("### ⚙️ Parâmetros Atuais")
                    st.json({
                        "Clientes": num_clients,
                        "Veículos": num_vehicles,
                        "Peso Distância": params.get('distance_weight', 100),
                        "Peso Balanceamento": params.get('balance_weight', 10),
                        "Máx. Duração (min)": params.get('max_route_duration', 480),
                        "Tempo Limite Busca (s)": params.get('time_limit_seconds', 30)
                    })
                    
                    return
                    
            except Exception as e:
                st.error(f"❌ **Erro inesperado durante a otimização**")
                st.exception(e)
                st.info("💡 Se o erro persistir, tente reduzir o número de clientes ou veículos.")
                return
            
            # Convert to DataFrame
            routes_df = Phase3Planning._convert_solution_to_dataframe(
                result,
                location_names,
                locations,
                vehicle_names,
                clients_df,
                client_start_idx
            )
            
            st.session_state['routes_solution'] = routes_df
            st.session_state['fleet_config_used'] = fleet_config
            st.session_state['warehouses_used'] = warehouses_df
            
            st.success(f"✅ Rotas calculadas! {len(result['routes'])} rotas geradas.")
            st.rerun()
    
    @staticmethod
    def _convert_solution_to_dataframe(result, location_names, locations, vehicle_names, clients_df, client_start_idx):
        """Convert optimization result to editable DataFrame with detailed timing"""
        from datetime import datetime, timedelta
        import math
        
        def haversine_distance(lat1, lon1, lat2, lon2):
            R = 6371
            lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            return R * c
        
        rows = []
        
        for vehicle_idx, route in enumerate(result['routes']):
            vehicle_name = vehicle_names[vehicle_idx] if vehicle_idx < len(vehicle_names) else f"Veículo {vehicle_idx + 1}"
            
            order = 1
            cumulative_dist = 0
            cumulative_load = 0
            
            # Start time (departure from warehouse)
            current_time = datetime.strptime("08:00", "%H:%M")
            
            # Get warehouse location (first point in route)
            depot_idx = route[0]
            prev_lat, prev_lon = locations[depot_idx]
            
            # Skip first (depot) and last (return to depot)
            for i in range(1, len(route) - 1):
                loc_idx = route[i]
                
                # Only process clients (skip warehouses)
                if loc_idx >= client_start_idx:
                    client_idx = loc_idx - client_start_idx
                    client_row = clients_df.iloc[client_idx]
                    
                    # Get client location
                    client_lat = client_row['Latitude']
                    client_lon = client_row['Longitude']
                    
                    # Calculate distance from previous point
                    dist_from_prev = haversine_distance(prev_lat, prev_lon, client_lat, client_lon)
                    cumulative_dist += dist_from_prev
                    
                    # Calculate travel time (assuming 40 km/h average)
                    travel_time_minutes = (dist_from_prev / 40) * 60
                    
                    # Arrival time at client
                    arrival_time = current_time + timedelta(minutes=travel_time_minutes)
                    
                    # Service time (15 minutes)
                    service_time = 15
                    
                    # Departure time from client
                    departure_time = arrival_time + timedelta(minutes=service_time)
                    
                    # Get demand
                    demand = client_row.get('Demanda_KG', 50)
                    cumulative_load += demand
                    
                    # Get CP and Localidade
                    cp = client_row.get('Codigo_Postal', client_row.get('CP', 'N/A'))
                    localidade = client_row.get('Localidade', client_row.get('Concelho', ''))
                    
                    rows.append({
                        'Rota': vehicle_name,
                        'Ordem': order,
                        'Cliente': client_row.get('Codigo_Cliente', f'Cliente_{client_idx}'),
                        'Morada': client_row.get('Morada', 'N/A'),
                        'CP': cp,
                        'Localidade': localidade,
                        'Latitude': client_lat,
                        'Longitude': client_lon,
                        'Chegada': arrival_time.strftime("%H:%M"),
                        'Tempo_Entrega': service_time,
                        'Saida': departure_time.strftime("%H:%M"),
                        'KM_Anterior': round(dist_from_prev, 2),
                        'Dist_Acum': round(cumulative_dist, 2),
                        'Carga_Acum': round(cumulative_load, 1)
                    })
                    
                    # Update for next iteration
                    prev_lat, prev_lon = client_lat, client_lon
                    current_time = departure_time
                    order += 1
        
        return pd.DataFrame(rows)
    
    @staticmethod
    def render_route_editor():
        """Render interactive route editor"""
        
        routes_df = st.session_state.get('routes_solution')
        fleet_config = st.session_state.get('fleet_config_used', {})
        
        if routes_df is None:
            return
        
        # Toggle for auto-optimization
        col1, col2 = st.columns([3, 1])
        with col1:
            pass  # Title is in the main render
        with col2:
            auto_optimize = st.checkbox(
                "🎯 Auto-otimizar",
                value=True,
                help="Quando moves clientes, reordena automaticamente para minimizar distância",
                key="auto_optimize_routes"
            )
        
        if auto_optimize:
            st.caption("✅ Ao mover clientes, a ordem será otimizada automaticamente para minimizar KM")
        else:
            st.caption("✋ Modo manual: a ordem que defines será mantida")
        
        # Editable table
        edited_df = RouteEditor.render_editable_routes_table(routes_df, fleet_config)
        
        if edited_df is not None:
            # Check if changed
            if not edited_df.equals(routes_df):
                auto_opt = st.session_state.get('auto_optimize_routes', True)
                
                if auto_opt:
                    # Smart reordering
                    optimized_df = Phase3Planning._smart_reorder_routes(edited_df)
                    st.session_state['routes_solution'] = optimized_df
                    st.success("✅ Rotas otimizadas automaticamente para minimizar distância!")
                else:
                    # Simple reordering
                    reordered_df = Phase3Planning._simple_reorder_routes(edited_df)
                    st.session_state['routes_solution'] = reordered_df
                    st.success("✅ Alterações aplicadas (ordem manual mantida)!")
                
                st.info("💡 Clica em 'Recalcular Métricas' para atualizar distâncias e horários.")
    
    @staticmethod
    def _simple_reorder_routes(df):
        """Simple sequential reordering"""
        reordered_rows = []
        
        for route_name in df['Rota'].unique():
            route_data = df[df['Rota'] == route_name].copy()
            route_data = route_data.sort_values('Ordem')
            route_data['Ordem'] = range(1, len(route_data) + 1)
            reordered_rows.append(route_data)
        
        return pd.concat(reordered_rows, ignore_index=True)
    
    @staticmethod
    def _smart_reorder_routes(df):
        """Smart reordering using nearest neighbor to minimize distance"""
        import math
        
        def haversine_distance(lat1, lon1, lat2, lon2):
            R = 6371
            lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            return R * c
        
        reordered_rows = []
        
        for route_name in df['Rota'].unique():
            route_data = df[df['Rota'] == route_name].copy()
            
            if len(route_data) <= 1:
                route_data['Ordem'] = range(1, len(route_data) + 1)
                reordered_rows.append(route_data)
                continue
            
            warehouses_df = st.session_state.get('warehouses_used')
            if warehouses_df is not None and len(warehouses_df) > 0:
                depot_lat = warehouses_df.iloc[0]['Latitude']
                depot_lon = warehouses_df.iloc[0]['Longitude']
            else:
                depot_lat = route_data.iloc[0]['Latitude']
                depot_lon = route_data.iloc[0]['Longitude']
            
            unvisited = route_data.to_dict('records')
            ordered = []
            current_lat, current_lon = depot_lat, depot_lon
            
            while unvisited:
                nearest_idx = 0
                min_dist = float('inf')
                
                for idx, client in enumerate(unvisited):
                    dist = haversine_distance(
                        current_lat, current_lon,
                        client['Latitude'], client['Longitude']
                    )
                    if dist < min_dist:
                        min_dist = dist
                        nearest_idx = idx
                
                nearest = unvisited.pop(nearest_idx)
                ordered.append(nearest)
                current_lat = nearest['Latitude']
                current_lon = nearest['Longitude']
            
            optimized_route = pd.DataFrame(ordered)
            optimized_route['Ordem'] = range(1, len(optimized_route) + 1)
            reordered_rows.append(optimized_route)
        
        return pd.concat(reordered_rows, ignore_index=True)
    
    @staticmethod
    def render_route_visualization():
        """Render interactive map visualization"""
        
        routes_df = st.session_state.get('routes_solution')
        warehouses_df = st.session_state.get('warehouses_used')
        
        if routes_df is None:
            return
        
        # Route selector
        selected_routes = RouteVisualizer.render_route_selector(routes_df)
        
        # Metrics
        RouteVisualizer.render_route_metrics(routes_df, selected_routes)
        
        st.markdown("---")
        
        # Map
        RouteVisualizer.render_interactive_map(routes_df, selected_routes, warehouses_df)
        
        # External window buttons
        st.markdown("---")
        st.markdown("### 🖥️ Abrir em Janela Separada")
        st.caption("Útil para visualizar em múltiplos monitores")
        
        col1, col2 = st.columns(2)
        
        with col1:
            if st.button("🌍 Abrir Mapa Interativo", use_container_width=True, help="Abre o mapa numa nova janela do browser"):
                Phase3Planning._open_map_in_browser(routes_df, warehouses_df)
        
        with col2:
            if st.button("📋 Abrir Quadro de Horários", use_container_width=True, help="Abre o quadro de horários numa nova janela do browser"):
                Phase3Planning._open_schedule_in_browser(routes_df)
    
    @staticmethod
    def render_export_section():
        """Render final export section"""
        
        routes_df = st.session_state.get('routes_solution')
        
        if routes_df is None:
            return
        
        st.info("📦 Quando estiver satisfeito com as rotas, clique em 'Exportar' para gerar os ficheiros finais.")
        
        col1, col2 = st.columns(2)
        
        with col1:
            if st.button("📊 Exportar Excel Detalhado", type="primary", use_container_width=True):
                Phase3Planning.export_excel()
        
        with col2:
            if st.button("🗺️ Exportar Mapa HTML", use_container_width=True):
                Phase3Planning.export_map()
    
    @staticmethod
    def export_excel():
        """Export routes to Excel"""
        
        routes_df = st.session_state.get('routes_solution')
        
        if routes_df is None:
            st.error("❌ Nenhuma rota para exportar.")
            return
        
        try:
            # Generate Excel
            excel_data = generate_route_excel(routes_df)
            
            st.download_button(
                label="💾 Download Excel",
                data=excel_data,
                file_name="rotas_otimizadas.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
            
            st.success("✅ Excel gerado com sucesso!")
            
        except Exception as e:
            st.error(f"❌ Erro ao gerar Excel: {str(e)}")
    
    @staticmethod
    def export_map():
        """Export interactive map to HTML"""
        
        routes_df = st.session_state.get('routes_solution')
        warehouses_df = st.session_state.get('warehouses_used')
        
        if routes_df is None:
            st.error("❌ Nenhuma rota para exportar.")
            return
        
        try:
            # Create map with all routes
            all_routes = routes_df['Rota'].unique().tolist()
            
            # Generate map HTML
            map_html = Phase3Planning._generate_map_html(routes_df, all_routes, warehouses_df)
            
            st.download_button(
                label="💾 Download Mapa HTML",
                data=map_html,
                file_name="mapa_rotas.html",
                mime="text/html"
            )
            
            st.success("✅ Mapa HTML gerado com sucesso!")
            
        except Exception as e:
            st.error(f"❌ Erro ao gerar mapa: {str(e)}")
    
    @staticmethod
    def _open_map_in_browser(routes_df, warehouses_df):
        """Open map in external browser window"""
        import webbrowser
        import tempfile
        
        try:
            # Generate map HTML
            all_routes = routes_df['Rota'].unique().tolist()
            map_html = Phase3Planning._generate_map_html(routes_df, all_routes, warehouses_df)
            
            # Save to temp file
            temp_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.html', encoding='utf-8')
            temp_file.write(map_html)
            temp_file.close()
            
            # Open in browser
            webbrowser.open('file://' + temp_file.name)
            
            st.success("✅ Mapa aberto em nova janela!")
            st.info(f"💡 Ficheiro temporário: {temp_file.name}")
            
        except Exception as e:
            st.error(f"❌ Erro ao abrir mapa: {str(e)}")
    
    @staticmethod
    def _open_schedule_in_browser(routes_df):
        """Open schedule table in external browser window"""
        import webbrowser
        import tempfile
        
        try:
            # Generate schedule HTML
            schedule_html = Phase3Planning._generate_schedule_html(routes_df)
            
            # Save to temp file
            temp_file = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.html', encoding='utf-8')
            temp_file.write(schedule_html)
            temp_file.close()
            
            # Open in browser
            webbrowser.open('file://' + temp_file.name)
            
            st.success("✅ Quadro de horários aberto em nova janela!")
            st.info(f"💡 Ficheiro temporário: {temp_file.name}")
            
        except Exception as e:
            st.error(f"❌ Erro ao abrir horários: {str(e)}")
    
    @staticmethod
    def _generate_schedule_html(routes_df):
        """Generate standalone HTML schedule table"""
        
        html = """
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Quadro de Horários - Rotas</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 20px;
                    background-color: #f5f5f5;
                }
                h1 {
                    color: #333;
                    text-align: center;
                }
                .route-section {
                    background: white;
                    margin: 20px 0;
                    padding: 15px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .route-header {
                    background: #4CAF50;
                    color: white;
                    padding: 10px;
                    border-radius: 5px;
                    margin-bottom: 15px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 10px;
                }
                th {
                    background-color: #f0f0f0;
                    padding: 10px;
                    text-align: left;
                    border-bottom: 2px solid #ddd;
                }
                td {
                    padding: 8px;
                    border-bottom: 1px solid #eee;
                }
                tr:hover {
                    background-color: #f9f9f9;
                }
                .metrics {
                    display: flex;
                    justify-content: space-around;
                    margin-top: 10px;
                    padding: 10px;
                    background: #e8f5e9;
                    border-radius: 5px;
                }
                .metric {
                    text-align: center;
                }
                .metric-value {
                    font-size: 24px;
                    font-weight: bold;
                    color: #2e7d32;
                }
                .metric-label {
                    font-size: 12px;
                    color: #666;
                }
            </style>
        </head>
        <body>
            <h1>📋 Quadro de Horários - Rotas Otimizadas</h1>
        """
        
        # Group by route
        for route_name in sorted(routes_df['Rota'].unique()):
            route_data = routes_df[routes_df['Rota'] == route_name].sort_values('Ordem')
            
            # Calculate metrics
            total_dist = route_data['Dist_Acum'].max()
            total_load = route_data['Carga_Acum'].max()
            num_stops = len(route_data)
            
            html += f"""
            <div class="route-section">
                <div class="route-header">
                    <h2 style="margin: 0;">{route_name}</h2>
                </div>
                
                <div class="metrics">
                    <div class="metric">
                        <div class="metric-value">{num_stops}</div>
                        <div class="metric-label">Paragens</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">{total_dist:.1f} km</div>
                        <div class="metric-label">Distância</div>
                    </div>
                    <div class="metric">
                        <div class="metric-value">{total_load:.0f} kg</div>
                        <div class="metric-label">Carga</div>
                    </div>
                </div>
                
                <table>
                    <thead>
                        <tr>
                            <th>Ordem</th>
                            <th>Cliente</th>
                            <th>Morada</th>
                            <th>CP</th>
                            <th>Chegada</th>
                            <th>Tempo Entrega</th>
                            <th>Saída</th>
                            <th>KM do Anterior</th>
                            <th>Dist. Acum</th>
                            <th>Carga Acum</th>
                        </tr>
                    </thead>
                    <tbody>
            """
            
            for _, row in route_data.iterrows():
                cp = row.get('CP', 'N/A')
                chegada = row.get('Chegada', 'N/A')
                saida = row.get('Saida', 'N/A')
                tempo_entrega = row.get('Tempo_Entrega', 15)
                km_anterior = row.get('KM_Anterior', 0)
                
                html += f"""
                        <tr>
                            <td>{int(row['Ordem'])}</td>
                            <td><strong>{row['Cliente']}</strong></td>
                            <td>{row['Morada']}</td>
                            <td>{cp}</td>
                            <td>{chegada}</td>
                            <td>{tempo_entrega} min</td>
                            <td>{saida}</td>
                            <td>{km_anterior:.2f} km</td>
                            <td>{row.get('Dist_Acum', 0):.2f} km</td>
                            <td>{row.get('Carga_Acum', 0):.1f} kg</td>
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
        
        return html
    
    @staticmethod
    def _generate_map_html(routes_df, selected_routes, warehouses_df):
        """Generate standalone HTML map"""
        
        # Calculate center
        center_lat = routes_df['Latitude'].mean()
        center_lon = routes_df['Longitude'].mean()
        
        # Create map
        m = folium.Map(
            location=[center_lat, center_lon],
            zoom_start=11,
            tiles='OpenStreetMap'
        )
        
        # Add routes using visualizer logic
        route_colors = {}
        for idx, route_name in enumerate(selected_routes):
            route_colors[route_name] = RouteVisualizer.COLORS[idx % len(RouteVisualizer.COLORS)]
        
        for route_name in selected_routes:
            route_data = routes_df[routes_df['Rota'] == route_name]
            RouteVisualizer._add_route_to_map(m, route_data, warehouses_df, route_name, route_colors[route_name])
        
        # Add legend
        RouteVisualizer._add_legend(m, route_colors)
        
        return m._repr_html_()
