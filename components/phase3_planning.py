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
        st.title("🧠 Etapa 4: Planeamento de Rotas")
        
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
                st.session_state['next_phase_queued'] = 1
                st.rerun()
        elif not (has_fleet and has_warehouses):
            if st.button("⬅️ Voltar para Fase 2", use_container_width=True):
                st.session_state['next_phase_queued'] = 2
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
            
            # --- PRO-ACTIVE FINAL AUTO-SAVE & ADVANCE ---
            # Delivers the final promise: Complete step 3 and safeguard data before export.
            st.markdown('<div style="margin-top: 40px;"></div>', unsafe_allow_html=True)
            col_sp1, col_final, col_sp2 = st.columns([1, 2, 1])
            
            with col_final:
                st.info("💡 Satisfeito com os resultados? Clique abaixo para concluir.")
                if st.button("🏁 Guardar e Concluir Planeamento", type="primary", use_container_width=True, help="Garante que os resultados calculados são salvos e avança para Exportação."):
                    import utils.persistence_manager as pm
                    active_proj = st.session_state.get('projeto_atual')
                    curr_user = st.session_state.get('utilizador_id', 1)
                    
                    if active_proj:
                        try:
                            with st.spinner("A fazer o último Auto-Save do seu planeamento..."):
                                pm.create_snapshot(
                                    projeto_id=active_proj,
                                    utilizador_id=curr_user,
                                    fase_atual=4, # Logical state checkpoint
                                    snapshot_name=f"Auto-Save: Resultados Calculados"
                                )
                        except Exception:
                            pass # Fault-tolerant backup

                    # Jump forward to the final Tab 5 (Export)
                    st.session_state['next_phase_queued'] = 5
                    st.rerun()
    
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
            volume_demands = []
            
            # Add warehouses first
            warehouse_indices = {}
            for idx, row in warehouses_df.iterrows():
                locations.append((row['Latitude'], row['Longitude']))
                location_names.append(row['Nome_Armazem'])
                demands.append(0)  # Warehouses have no demand
                volume_demands.append(0)
                warehouse_indices[row['Nome_Armazem']] = len(locations) - 1
            
            # Add clients
            client_start_idx = len(locations)
            for idx, row in clients_df.iterrows():
                locations.append((row['Latitude'], row['Longitude']))
                location_names.append(row.get('Codigo_Cliente', f'Cliente_{idx}'))
                demands.append(row.get('Peso_KG', 50))  # Use correct column name from template
                volume_demands.append(row.get('Volume_m3', 0.1))
            
            # Calculate distance matrix
            distance_matrix = calculate_haversine_matrix(locations)
            
            # --- DEFENSIVE DATA CASTING: Ensure fleet_config is a working dict ---
            # In case of legacy dataframes leaking from Phase 2 manual configuration!
            import pandas as pd
            if isinstance(fleet_config, pd.DataFrame):
                temp_dict = {}
                for _, row in fleet_config.iterrows():
                    temp_dict[row['Veiculo']] = {
                        'capacity': row['Capacidade_KG'],
                        'capacity_volume': row.get('Cap_Volume_m3', 0),
                        'cost_per_km': row['Custo_KM'],
                        'speed': row['Velocidade_Media'],
                        'start_time': str(row['Horario_Inicio']),
                        'end_time': str(row['Horario_Fim']),
                        'warehouse': row['Armazem']
                    }
                fleet_config = temp_dict

            # Prepare fleet
            vehicle_capacities = []
            vehicle_volume_capacities = []
            depot_indices = []
            vehicle_names = []
            
            for vehicle_name, vehicle_data in fleet_config.items():
                # Safe extraction with fallbacks in case key capitalization varies
                vehicle_capacities.append(vehicle_data.get('capacity', 1000))
                vehicle_volume_capacities.append(vehicle_data.get('capacity_volume', 5.0))
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
                    optimization_params=params,
                    volume_demands=volume_demands,
                    vehicle_volume_capacities=vehicle_volume_capacities
                )
                
                if result['status'] != 'SUCCESS':
                    st.error("❌ **Falha na otimização**")
                    
                    # Detailed diagnostics
                    st.markdown("### 🔍 Diagnóstico")
                    
                    total_demand = sum(demands)
                    total_capacity = sum(vehicle_capacities)
                    
                    total_vol_demand = sum(volume_demands)
                    total_vol_capacity = sum(vehicle_volume_capacities)
                    
                    col1, col2, col3 = st.columns(3)
                    col1.metric("Total Peso", f"{total_demand:.0f} kg")
                    col2.metric("Capac. Peso Total", f"{total_capacity:.0f} kg")
                    col3.metric("Diferença Peso", f"{total_capacity - total_demand:.0f} kg", 
                               delta_color="normal" if total_capacity >= total_demand else "inverse")
                    
                    col4, col5, col6 = st.columns(3)
                    col4.metric("Total Volume", f"{total_vol_demand:.1f} m3")
                    col5.metric("Capac. Volume Total", f"{total_vol_capacity:.1f} m3")
                    col6.metric("Diferença Volume", f"{total_vol_capacity - total_vol_demand:.1f} m3", 
                               delta_color="normal" if total_vol_capacity >= total_vol_demand else "inverse")
                    
                    st.markdown("### 💡 Possíveis Causas")
                    
                    issues = []
                    
                    # Check capacity (Weight)
                    if total_capacity < total_demand:
                        issues.append("🔴 **Capacidade de Peso insuficiente**: A frota não tem capacidade para todas as entregas")
                        st.error(f"A capacidade total de peso da frota ({total_capacity:.0f} kg) é menor que o peso total das entregas ({total_demand:.0f} kg).")
                        st.info(f"💡 **Solução**: Adicione mais veículos ou aumente a capacidade dos existentes em pelo menos {total_demand - total_capacity:.0f} kg")
                    
                    # Check capacity (Volume)
                    if total_vol_capacity < total_vol_demand:
                        issues.append("🔴 **Capacidade de Volume insuficiente**: Volume total excede a frota")
                        st.error(f"A capacidade volumétrica total ({total_vol_capacity:.1f} m3) é menor que o volume total das entregas ({total_vol_demand:.1f} m3).")
                        st.info(f"💡 **Solução**: Adicione mais veículos ou use veículos com maior capacidade volumétrica.")
                    
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
                    
                    # Check if demands are too large (Weight)
                    max_demand = max(demands) if demands else 0
                    max_capacity = max(vehicle_capacities) if vehicle_capacities else 0
                    if max_demand > max_capacity:
                        issues.append("🔴 **Cliente com peso excessivo**: Há clientes que não cabem em nenhum veículo")
                        st.error(f"Há pelo menos um cliente com {max_demand:.0f} kg, mas o maior veículo só tem {max_capacity:.0f} kg de capacidade.")
                        st.info("💡 **Solução**: Aumente a capacidade do maior veículo ou divida a entrega")
                    
                    # Check if demands are too large (Volume)
                    max_vol_dem = max(volume_demands) if volume_demands else 0
                    max_vol_cap = max(vehicle_volume_capacities) if vehicle_volume_capacities else 0
                    if max_vol_dem > max_vol_cap:
                        issues.append("🔴 **Cliente com volume excessivo**: Há clientes que não cabem em nenhum veículo")
                        st.error(f"Há pelo menos um cliente com {max_vol_dem:.1f} m3, mas o maior veículo só tem {max_vol_cap:.1f} m3 de capacidade volumétrica.")
                        st.info("💡 **Solução**: Divida a entrega volumosa.")
                    
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
            
            # Show status alerts about unassigned items
            dropped_count = len(result.get('dropped_nodes', []))
            if dropped_count > 0:
                st.warning(f"⚠️ Otimização concluída, mas {dropped_count} entrega(s) ficaram de fora por falta de capacidade e foram colocadas na lista 'PENDENTES'.")
            
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
        
        # 1. Process successful routes
        for vehicle_idx, route in enumerate(result['routes']):
            vehicle_name = vehicle_names[vehicle_idx] if vehicle_idx < len(vehicle_names) else f"Veículo {vehicle_idx + 1}"
            
            order = 1
            cumulative_dist = 0
            cumulative_load = 0
            cumulative_volume = 0
            
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
                    demand = client_row.get('Peso_KG', 50)
                    vol_demand = client_row.get('Volume_m3', 0.1)
                    cumulative_load += demand
                    cumulative_volume += vol_demand
                    
                    # Get CP and Localidade
                    cp = client_row.get('Codigo_Postal', client_row.get('CP', 'N/A'))
                    localidade = client_row.get('Localidade', client_row.get('Concelho', ''))
                    qualidade = client_row.get('Nivel_Qualidade', 0)

                    # --- HELPER: Standardize user time slots into one column ---
                    def _fmt_slot(val):
                        import pandas as pd
                        if pd.isna(val) or not val: return ""
                        if hasattr(val, 'strftime'): return val.strftime('%H:%M')
                        v_str = str(val).strip()
                        if not v_str or v_str.lower() == 'nan': return ""
                        return v_str[:5] if ':' in v_str else v_str
                    
                    win_s = _fmt_slot(client_row.get('Slot1_Inicio', ''))
                    win_e = _fmt_slot(client_row.get('Slot1_Fim', ''))
                    combined_window = f"{win_s} - {win_e}" if (win_s and win_e) else "Qualquer"
                    
                    rows.append({
                        'Rota': vehicle_name,
                        'Ordem': order,
                        'Cliente': client_row.get('Codigo_Cliente', f'Cliente_{client_idx}'),
                        'Morada': client_row.get('Morada', 'N/A'),
                        'CP': cp,
                        'Localidade': localidade,
                        'Janela_Horaria': combined_window, # USER REQUEST: Concatenated Window!
                        'Latitude': client_lat,
                        'Longitude': client_lon,
                        'Chegada': arrival_time.strftime("%H:%M"),
                        'Tempo_Entrega': service_time,
                        'Saida': departure_time.strftime("%H:%M"),
                        'Nivel_Qualidade': qualidade,
                        'KM_Anterior': round(dist_from_prev, 2),
                        'Dist_Acum': round(cumulative_dist, 2),
                        'Carga_Acum': round(cumulative_load, 1),
                        'Carga_Vol_Acum': round(cumulative_volume, 2)
                    })
                    
                    # Update for next iteration
                    prev_lat, prev_lon = client_lat, client_lon
                    current_time = departure_time
                    order += 1
        
        # 2. Process dropped nodes (Pendentes)
        dropped_nodes = result.get('dropped_nodes', [])
        if dropped_nodes:
            order = 1
            for loc_idx in dropped_nodes:
                if loc_idx >= client_start_idx:
                    client_idx = loc_idx - client_start_idx
                    client_row = clients_df.iloc[client_idx]
                    
                    # Format slot for pending list
                    def _fmt_slot(val):
                        import pandas as pd
                        if pd.isna(val) or not val: return ""
                        if hasattr(val, 'strftime'): return val.strftime('%H:%M')
                        v_str = str(val).strip()
                        if not v_str or v_str.lower() == 'nan': return ""
                        return v_str[:5] if ':' in v_str else v_str
                    
                    win_s = _fmt_slot(client_row.get('Slot1_Inicio', ''))
                    win_e = _fmt_slot(client_row.get('Slot1_Fim', ''))
                    combined_window = f"{win_s} - {win_e}" if (win_s and win_e) else "Qualquer"

                    rows.append({
                        'Rota': "⚠️ PENDENTE",
                        'Ordem': order,
                        'Cliente': client_row.get('Codigo_Cliente', f'Cliente_{client_idx}'),
                        'Morada': client_row.get('Morada', 'N/A'),
                        'CP': client_row.get('Codigo_Postal', client_row.get('CP', 'N/A')),
                        'Localidade': client_row.get('Localidade', client_row.get('Concelho', '')),
                        'Janela_Horaria': combined_window,
                        'Latitude': client_row['Latitude'],
                        'Longitude': client_row['Longitude'],
                        'Chegada': "00:00",
                        'Tempo_Entrega': 0,
                        'Saida': "00:00",
                        'Nivel_Qualidade': client_row.get('Nivel_Qualidade', 0),
                        'KM_Anterior': 0,
                        'Dist_Acum': 0,
                        'Carga_Acum': client_row.get('Peso_KG', 0),
                        'Carga_Vol_Acum': client_row.get('Volume_m3', 0)
                    })
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
        
        # --- PAINEL CENTRAL DE DESPACHO (BULK LOGISTICS OVERRIDES) ---
        # Renders the enterprise console to transfer or swap complete vehicle payloads!
        Phase3Planning.render_fleet_dispatch_panel()
        
        st.markdown("---")
        
        # Map - Advanced bidirectional telemetry binding
        map_output = RouteVisualizer.render_interactive_map(routes_df, selected_routes, warehouses_df)
        
        # --- LIGAR O CÉREBRO AO CLIQUE (SPACE COMMAND PANEL) ---
        # Captures marker interaction coordinates and renders real-time manual re-assignment controller
        Phase3Planning._handle_map_clicks(map_output, routes_df)
        
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
        
        # Fetch configuration metadata for payload limit displays!
        import streamlit as st
        fleet_config = st.session_state.get('fleet_config_used', {})
        
        active_route_num = 1
        
        # Group by route
        for route_name in sorted(routes_df['Rota'].unique()):
            route_data = routes_df[routes_df['Rota'] == route_name].sort_values('Ordem')
            
            # Calculate metrics
            total_dist = float(route_data['Dist_Acum'].max())
            total_load = float(route_data['Carga_Acum'].max())
            total_vol = float(route_data['Carga_Vol_Acum'].max()) if 'Carga_Vol_Acum' in route_data.columns else 0.0
            num_stops = len(route_data)
            
            # Construct enriched header string
            if "PENDENTE" in route_name:
                display_title = "⚠️ Clientes Pendentes (Não Atribuídos)"
            else:
                # Extract safe operational parameters from runtime configuration
                v_cfg = fleet_config.get(route_name, {})
                max_kg = v_cfg.get('capacity', 0.0)
                max_m3 = v_cfg.get('capacity_volume', 0.0)
                
                limits = ""
                if max_kg > 0:
                    limits += f" — Peso Máx: {max_kg:.0f} kg"
                if max_m3 > 0:
                    limits += f" — Vol. Máx: {max_m3:.1f} m³"
                    
                display_title = f"Rota {active_route_num} — {route_name}{limits}"
                active_route_num += 1
            
            html += f"""
            <div class="route-section">
                <div class="route-header">
                    <h2 style="margin: 0; font-size: 20px; display: flex; justify-content: space-between; align-items: center;">
                        <span>{display_title}</span>
                    </h2>
                </div>"""
                
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
                    <div class="metric">
                        <div class="metric-value">{total_vol:.2f} m3</div>
                        <div class="metric-label">Volume</div>
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
                            <th>Vol. Acum</th>
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
                            <td>{row.get('Carga_Vol_Acum', 0):.2f} m3</td>
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

    @staticmethod
    def _handle_map_clicks(map_output, routes_df):
        """
        Listens to live Folium javascript click events. Maps the geographic coordinate telemetry
        to the nearest spreadsheet entity and renders the industrial Commander Panel in the sidebar.
        """
        if not map_output:
            return
            
        last_clicked = map_output.get("last_object_clicked")
        if not last_clicked:
            return
            
        click_lat = float(last_clicked.get("lat", 0))
        click_lon = float(last_clicked.get("lng", 0))
        
        if click_lat == 0 and click_lon == 0:
            return
            
        # 1. Identify Closest Element via absolute distance vector
        # We use temporary vectorized arrays to guarantee read-only safety on global dataframe!
        lat_vector = routes_df['Latitude'].astype(float)
        lon_vector = routes_df['Longitude'].astype(float)
        
        manhattan_diff = (lat_vector - click_lat).abs() + (lon_vector - click_lon).abs()
        
        closest_idx = manhattan_diff.idxmin()
        min_diff = manhattan_diff.loc[closest_idx]
        
        # Threshold check: 0.0001 degrees is ~10 meters. Prevents depot or road clicks from triggering.
        if min_diff > 0.0001:
            return
            
        target_row = routes_df.loc[closest_idx]
        client_id = str(target_row['Cliente'])
        client_addr = str(target_row['Morada'])
        current_route = str(target_row['Rota'])
        
        # --- RENDER HIGH-PREMIUM SPACE COMMAND PANEL IN SIDEBAR ---
        st.sidebar.markdown("---")
        st.sidebar.markdown("### 🛰️ Comando de Frota (Clique no Mapa)")
        
        st.sidebar.info(f"""
        🎯 **Cliente Selecionado:**
        **{client_id}**
        *{client_addr[:60]}...*
        
        🔹 **Rota Atual:** `{current_route}`
        """)
        
        # Fetch all active vehicles to populate target destinations
        fleet_config = st.session_state.get('fleet_config_used', {})
        all_vehicles = list(fleet_config.keys())
        
        # Ensure PENDENTE exists in choices
        if "⚠️ PENDENTE" not in all_vehicles:
            all_vehicles.append("⚠️ PENDENTE")
            
        # Safely set starting dropdown index
        try:
            start_idx = all_vehicles.index(current_route)
        except ValueError:
            start_idx = len(all_vehicles) - 1 if "PENDENTE" in current_route else 0
            
        target_dest = st.sidebar.selectbox(
            "📦 Mover este cliente para:",
            options=all_vehicles,
            index=start_idx,
            key="map_command_vehicle_select"
        )
        
        if target_dest == current_route:
            st.sidebar.caption("ℹ️ Selecione um veículo diferente para ativar a transferência.")
            return
            
        if st.sidebar.button(f"⚡ Transferir para {target_dest}", type="primary", use_container_width=True):
            with st.spinner("A recalcular horários e métricas operacionais..."):
                # Extract current solution
                raw_df = st.session_state['routes_solution']
                
                # 2. Mutate the assignment
                raw_df.loc[raw_df['Cliente'] == client_id, 'Rota'] = target_dest
                
                # 3. Apply Automatic Logical Sequence Alignment
                # Sort to ensure consistency (puts newly added at the end of target route)
                reordered_df = Phase3Planning._simple_reorder_routes(raw_df)
                
                # 4. RUN THE MASTER RECALCULATOR (Syncs Dist_Acum, Hours, and Carga_Acum instantly!)
                synced_df = Phase3Planning._recalculate_all_metrics(reordered_df)
                
                # 5. Commit state and refresh UI
                st.session_state['routes_solution'] = synced_df
                st.sidebar.success(f"✅ Transferido com sucesso!")
                st.rerun()

    @staticmethod
    def _recalculate_all_metrics(df):
        """
        Industrial mathematical engine that completely rebuilds distance vectors, cumulative 
        weight and volume metrics, and arrival/departure schedules across all vehicles.
        Runs instantaneously without demanding expensive full OR-Tools convergence cycles!
        """
        import math
        from datetime import datetime, timedelta
        import pandas as pd
        
        def haversine_distance(lat1, lon1, lat2, lon2):
            R = 6371
            lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            return R * c
            
        warehouses_df = st.session_state.get('warehouses_used')
        if warehouses_df is None or len(warehouses_df) == 0:
            ref_lat, ref_lon = 38.7223, -9.1393
        else:
            ref_lat = float(warehouses_df.iloc[0]['Latitude'])
            ref_lon = float(warehouses_df.iloc[0]['Longitude'])
            
        clients_geocoded = st.session_state.get('clients_geocoded')
        
        recalc_rows = []
        
        for route_name in df['Rota'].unique():
            route_data = df[df['Rota'] == route_name].copy()
            
            # Enforce sequential processing
            route_data = route_data.sort_values('Ordem')
            
            if "PENDENTE" in route_name:
                # Format overflow bucket metrics
                route_data['KM_Anterior'] = 0.0
                route_data['Dist_Acum'] = 0.0
                route_data['Ordem'] = range(1, len(route_data) + 1)
                route_data['Chegada'] = "00:00"
                route_data['Saida'] = "00:00"
                recalc_rows.append(route_data)
                continue
                
            # Compute operational timeline
            curr_lat, curr_lon = ref_lat, ref_lon
            curr_time = datetime.strptime("08:00", "%H:%M")
            cum_dist = 0.0
            cum_load = 0.0
            cum_vol = 0.0
            
            processed_records = []
            order = 1
            
            for idx, row in route_data.iterrows():
                lat = float(row['Latitude'])
                lon = float(row['Longitude'])
                
                # Delta distance and summation
                dist = haversine_distance(curr_lat, curr_lon, lat, lon)
                cum_dist += dist
                
                # Velocity-based temporal projection
                travel_mins = (dist / 40.0) * 60.0
                arrival = curr_time + timedelta(minutes=travel_mins)
                
                service_mins = 15.0 # Standard drop cycle
                departure = arrival + timedelta(minutes=service_mins)
                
                # Robust absolute demand lookups to recover clean unaccumulated scales
                weight = 50.0
                vol = 0.1
                
                if clients_geocoded is not None:
                    cid = str(row['Cliente'])
                    match = clients_geocoded[clients_geocoded['Codigo_Cliente'].astype(str) == cid]
                    if len(match) > 0:
                        weight = float(match.iloc[0].get('Peso_KG', 50.0))
                        vol = float(match.iloc[0].get('Volume_m3', 0.1))
                
                cum_load += weight
                cum_vol += vol
                
                row_dict = dict(row)
                row_dict['Ordem'] = order
                row_dict['KM_Anterior'] = round(dist, 2)
                row_dict['Dist_Acum'] = round(cum_dist, 2)
                row_dict['Carga_Acum'] = round(cum_load, 1)
                row_dict['Carga_Vol_Acum'] = round(cum_vol, 2)
                row_dict['Chegada'] = arrival.strftime("%H:%M")
                row_dict['Saida'] = departure.strftime("%H:%M")
                
                processed_records.append(row_dict)
                
                # Cycle progression variables
                curr_lat, curr_lon = lat, lon
                curr_time = departure
                order += 1
                
            if processed_records:
                recalc_rows.append(pd.DataFrame(processed_records))
            
        return pd.concat(recalc_rows, ignore_index=True) if recalc_rows else df


    @staticmethod
    def render_fleet_dispatch_panel():
        """
        Renders the Advanced Fleet Dispatch Console. Empowers layout managers to transfer 
        entire vehicle payloads, invert routes between drivers, and unlock 100% of empty 
        idle fleet vehicles.
        """
        import pandas as pd
        
        routes_df = st.session_state.get('routes_solution')
        fleet_config = st.session_state.get('fleet_config_used', {})
        
        if routes_df is None:
            return
            
        st.markdown("### 🏢 Painel Central de Despacho (Operações em Massa)")
        st.caption("Gere a frota inteira. Transfira cargas completas ou permute carros com um clique!")
        
        # 1. Build absolute master vehicle roster including UNUSED/EMPTY configured vehicles!
        all_configured = list(fleet_config.keys())
        all_active = routes_df['Rota'].unique().tolist()
        
        # Consolidate union list to ensure empty cars are accessible
        union_vehicles = list(dict.fromkeys(all_configured + all_active))
        
        # Guarantee default Overflow Bucket exists
        if "⚠️ PENDENTE" not in union_vehicles:
            union_vehicles.append("⚠️ PENDENTE")
            
        # Order lists cleanly for display (Alphabetical, with Pendente at the end)
        union_vehicles.sort(key=lambda x: "ZZZ" if "PENDENTE" in x else x)
        
        # Render 2 parallel command decks
        deck1, deck2 = st.columns(2)
        
        with deck1:
            with st.container(border=True):
                st.markdown("##### 🚚 Mover Carga Completa")
                st.caption("Passa TODOS os clientes atribuídos de um carro para outro.")
                
                origin_veh = st.selectbox(
                    "Veículo de Origem (De onde sai):", 
                    options=union_vehicles, 
                    key="bulk_op_move_origin"
                )
                dest_veh = st.selectbox(
                    "Veículo de Destino (Para onde vai):", 
                    options=union_vehicles, 
                    key="bulk_op_move_dest"
                )
                
                # Add counts preview so user knows exactly what they are doing
                origin_count = len(routes_df[routes_df['Rota'] == origin_veh])
                st.caption(f"⚡ *Origem contém {origin_count} cliente(s).*")
                
                if st.button("⚡ Executar Transferência Total", type="primary", use_container_width=True, key="btn_bulk_transfer"):
                    if origin_veh == dest_veh:
                        st.error("O veículo de origem e destino devem ser diferentes!")
                        return
                        
                    if origin_count == 0:
                        st.error(f"O veículo de origem ({origin_veh}) está vazio! Não há carga para transferir.")
                        return
                        
                    with st.spinner("A realizar transferência de cargas em massa..."):
                        raw_df = st.session_state['routes_solution'].copy()
                        
                        # Fast bulk pandas assignment override
                        raw_df.loc[raw_df['Rota'] == origin_veh, 'Rota'] = dest_veh
                        
                        # Restore temporal continuity & recalc
                        reordered = Phase3Planning._simple_reorder_routes(raw_df)
                        final_df = Phase3Planning._recalculate_all_metrics(reordered)
                        
                        st.session_state['routes_solution'] = final_df
                        st.toast(f"✅ Transferidos {origin_count} clientes para {dest_veh}!", icon="🚛")
                        st.rerun()
                        
        with deck2:
            with st.container(border=True):
                st.markdown("##### 🔄 Trocar Cargas (Permuta)")
                st.caption("Inverte a totalidade das cargas atribuídas entre dois veículos.")
                
                veh_a = st.selectbox("Veículo A:", options=union_vehicles, index=0, key="bulk_op_swap_a")
                
                # Try to default vehicle B to second element to be helpful
                b_idx = 1 if len(union_vehicles) > 1 else 0
                veh_b = st.selectbox("Veículo B:", options=union_vehicles, index=b_idx, key="bulk_op_swap_b")
                
                count_a = len(routes_df[routes_df['Rota'] == veh_a])
                count_b = len(routes_df[routes_df['Rota'] == veh_b])
                st.caption(f"🔄 *Troca {count_a} cliente(s) por {count_b} cliente(s).*")
                
                if st.button("🔄 Inverter Cargas de Veículos", use_container_width=True, key="btn_bulk_swap_payloads"):
                    if veh_a == veh_b:
                        st.error("Selecione dois veículos diferentes para realizar a permuta!")
                        return
                        
                    with st.spinner("A realizar permuta cruzada de frotas..."):
                        raw_df = st.session_state['routes_solution'].copy()
                        
                        # Perform robust cross-swap using memory safe token
                        swap_token = "__DISPATCH_SWAP_TOKEN_GUARD__"
                        raw_df.loc[raw_df['Rota'] == veh_a, 'Rota'] = swap_token
                        raw_df.loc[raw_df['Rota'] == veh_b, 'Rota'] = veh_a
                        raw_df.loc[raw_df['Rota'] == swap_token, 'Rota'] = veh_b
                        
                        # Rebuild distances, times, and aggregations
                        reordered = Phase3Planning._simple_reorder_routes(raw_df)
                        final_df = Phase3Planning._recalculate_all_metrics(reordered)
                        
                        st.session_state['routes_solution'] = final_df
                        st.toast(f"✅ Cargas trocadas com sucesso!", icon="🔄")
                        st.rerun()
