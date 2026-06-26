"""
Phase 2: Complete Validation Component
Validates clients, warehouses, and fleet before proceeding to planning.
"""

import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium

from utils.geocoder_engine import WaterfallGeocoder
from core.session_state import get_state, set_state, FleetVehicle


class Phase2Validation:
    """Phase 2: Complete validation of all prerequisites"""
    
    DB_FILE = 'geocoding.db'
    
    @staticmethod
    def render():
        st.title("✅ Fase 2: Validação e Preparação")
        st.markdown("Valide todos os dados antes de avançar para o planeamento de rotas.")
        
        st.markdown("---")
        
        # 3 Vertical Zones
        Phase2Validation.render_validation_zones()
        
        # Final check and advance button
        st.markdown("---")
        Phase2Validation.render_completion_check()
    
    @staticmethod
    def render_validation_zones():
        """Render 3 vertical validation zones"""
        
        # Zone 1: Clients
        with st.container():
            st.markdown("### 👥 Zona 1: Clientes Georreferenciados")
            Phase2Validation.render_clients_zone()
        
        st.markdown("---")
        
        # Zone 2: Warehouses
        with st.container():
            st.markdown("### 🏢 Zona 2: Armazéns/Lojas")
            Phase2Validation.render_warehouses_zone()
        
        st.markdown("---")
        
        # Zone 3: Fleet
        with st.container():
            st.markdown("### 🚚 Zona 3: Frota")
            Phase2Validation.render_fleet_zone()
    
    @staticmethod
    def render_clients_zone():
        """Zone 1: Validate clients are geocoded"""
        state = get_state()
        clients_geocoded = state.clients_geocoded
        
        if clients_geocoded is None:
            st.error("❌ **Nenhum cliente georreferenciado**")
            st.info("💡 Volte à **Fase 1** para carregar e georreferenciar clientes.")
            return
        
        # Check for failures
        failed_clients = clients_geocoded[clients_geocoded['Nivel_Qualidade'] == 8]
        
        if len(failed_clients) > 0:
            st.warning(f"⚠️ **{len(failed_clients)} clientes** precisam de correção manual.")
            
            # Store failed clients in state
            state.failed_clients = failed_clients
            set_state(state)
            
            # Correction interface
            Phase2Validation.render_client_correction(failed_clients)
        else:
            # All good!
            total = len(clients_geocoded)
            st.success(f"✅ **{total} clientes** georreferenciados com sucesso!")
            
            # Show summary
            col1, col2, col3 = st.columns(3)
            sucesso = len(clients_geocoded[clients_geocoded['Nivel_Qualidade'] <= 2])
            medio = len(clients_geocoded[(clients_geocoded['Nivel_Qualidade'] >= 3) & (clients_geocoded['Nivel_Qualidade'] <= 7)])
            
            col1.metric("Total", total)
            col2.metric("Alta Qualidade (1-2)", sucesso)
            col3.metric("Média Qualidade (3-7)", medio)
    
    @staticmethod
    def render_client_correction(failed_clients):
        """Correction interface for failed clients"""
        state = get_state()
        
        with st.expander("🛠️ Corrigir Clientes Falhados", expanded=True):
            # Progress
            total_failed = st.session_state.get('total_failed_count', len(failed_clients))
            if 'total_failed_count' not in st.session_state:
                st.session_state['total_failed_count'] = total_failed
            
            corrections_made = total_failed - len(failed_clients)
            
            if corrections_made > 0:
                progress = corrections_made / total_failed
                st.progress(progress)
                st.info(f"📈 Progresso: {corrections_made}/{total_failed} corrigidos ({progress*100:.1f}%)")
            
            # Select client
            client_options = [
                f"{row.get('Codigo_Cliente', f'Cliente {idx}')} - {row.get('Morada', 'N/A')}"
                for idx, row in failed_clients.iterrows()
            ]
            
            selected_idx = st.selectbox(
                "Selecione o cliente:",
                range(len(client_options)),
                format_func=lambda i: client_options[i],
                key="client_selector_v2"
            )
            
            client_row = failed_clients.iloc[selected_idx]
            
            # Correction methods
            col1, col2 = st.columns(2)
            
            with col1:
                st.markdown("**🗺️ Método 1: Selecionar no Mapa**")
                if st.button("Usar Mapa", use_container_width=True):
                    st.session_state['correction_method'] = 'map'
            
            with col2:
                st.markdown("**✏️ Método 2: Editar Morada**")
                if st.button("Editar Morada", use_container_width=True):
                    st.session_state['correction_method'] = 'edit'
            
            # Render selected method
            method = st.session_state.get('correction_method', 'map')
            
            if method == 'map':
                Phase2Validation._map_correction(client_row, selected_idx)
            else:
                Phase2Validation._edit_correction(client_row, selected_idx)
    
    @staticmethod
    def _map_correction(client_row, client_idx):
        """Map-based correction"""
        st.info("📍 Clique no mapa para definir a localização")
        
        center_lat = st.session_state.get('temp_correction', {}).get('lat', 39.5)
        center_lon = st.session_state.get('temp_correction', {}).get('lon', -8.0)
        
        m = folium.Map(location=[center_lat, center_lon], zoom_start=7)
        
        if 'temp_correction' in st.session_state:
            folium.Marker(
                [st.session_state['temp_correction']['lat'], st.session_state['temp_correction']['lon']],
                popup="Selecionado",
                icon=folium.Icon(color='green', icon='check', prefix='fa')
            ).add_to(m)
        
        map_data = st_folium(m, height=400, width=None, key=f"map_corr_{client_idx}")
        
        if map_data and map_data.get("last_clicked"):
            clicked = map_data["last_clicked"]
            st.session_state['temp_correction'] = {
                'lat': clicked['lat'],
                'lon': clicked['lng'],
                'client_idx': client_idx
            }
            st.success(f"📍 Localização: {clicked['lat']:.5f}, {clicked['lng']:.5f}")
        
        if st.button("💾 Guardar", disabled='temp_correction' not in st.session_state, type="primary"):
            Phase2Validation._save_correction(client_row)
    
    @staticmethod
    def _edit_correction(client_row, client_idx):
        """Edit-based correction"""
        state = get_state()
        col1, col2 = st.columns(2)
        
        with col1:
            new_addr = st.text_input("Morada", value=client_row.get('Morada', ''), key=f"addr_{client_idx}")
            new_cp = st.text_input("CP", value=client_row.get('Codigo_Postal', ''), key=f"cp_{client_idx}")
        
        with col2:
            new_conc = st.text_input("Concelho", value=client_row.get('Concelho', ''), key=f"conc_{client_idx}")
        
        if st.button("🔍 Re-geocodificar", type="primary"):
            api_key = state.google_api_key
            geocoder = WaterfallGeocoder(Phase2Validation.DB_FILE, google_api_key=api_key)
            
            with st.spinner("Geocodificando..."):
                result, _ = geocoder.resolve_address(new_addr, new_cp, new_conc)
            
            if result and result['lat'] and result['quality_level'] < 8:
                st.success(f"✅ Sucesso! Nível {result['quality_level']}")
                st.session_state['temp_correction'] = {
                    'lat': result['lat'],
                    'lon': result['lon'],
                    'address': new_addr,
                    'cp': new_cp,
                    'concelho': new_conc,
                    'quality_level': result['quality_level'],
                    'source': result['source'],
                    'client_idx': client_idx
                }
                
                if st.button("💾 Guardar", type="primary"):
                    Phase2Validation._save_correction(client_row)
            else:
                st.error("❌ Falhou. Tente o método do mapa.")
    
    @staticmethod
    def _save_correction(client_row):
        """Save correction"""
        state = get_state()
        correction = st.session_state['temp_correction']
        clients_geocoded = state.clients_geocoded.copy()
        
        codigo = client_row.get('Codigo_Cliente')
        mask = clients_geocoded['Codigo_Cliente'] == codigo if codigo else clients_geocoded['Morada'] == client_row.get('Morada')
        
        clients_geocoded.loc[mask, 'Latitude'] = correction['lat']
        clients_geocoded.loc[mask, 'Longitude'] = correction['lon']
        clients_geocoded.loc[mask, 'Nivel_Qualidade'] = correction.get('quality_level', 0)
        clients_geocoded.loc[mask, 'Fonte_Match'] = correction.get('source', 'MANUAL')
        
        if 'address' in correction:
            clients_geocoded.loc[mask, 'Morada'] = correction['address']
            clients_geocoded.loc[mask, 'Codigo_Postal'] = correction['cp']
            clients_geocoded.loc[mask, 'Concelho'] = correction['concelho']
        
        failed_clients = state.failed_clients.copy()
        failed_clients = failed_clients[failed_clients['Codigo_Cliente'] != codigo] if codigo else failed_clients[failed_clients['Morada'] != client_row.get('Morada')]
        
        state.clients_geocoded = clients_geocoded
        state.failed_clients = failed_clients
        set_state(state)
        
        if 'temp_correction' in st.session_state:
            del st.session_state['temp_correction']
        
        st.success("✅ Guardado!")
        st.rerun()
    
    @staticmethod
    def render_warehouses_zone():
        """Zone 2: Validate warehouses"""
        state = get_state()
        warehouses_df = state.warehouses_geocoded
        
        if warehouses_df is None or warehouses_df.empty:
            st.error("❌ **Nenhum armazém definido**")
            st.info("💡 Volte à **Fase 2** (tab Armazéns e Frota) para adicionar armazéns.")
        else:
            st.success(f"✅ **{len(warehouses_df)} armazém(s)** configurado(s)")
            
            # Show list
            for idx, row in warehouses_df.iterrows():
                col1, col2, col3 = st.columns([3, 2, 1])
                col1.write(f"**{row['Nome_Armazem']}**")
                col2.write(f"{row['Latitude']:.5f}, {row['Longitude']:.5f}")
                if col3.button("🗑️", key=f"del_wh_v2_{idx}"):
                    state.warehouses_geocoded = warehouses_df.drop(idx).reset_index(drop=True)
                    set_state(state)
                    st.rerun()
    
    @staticmethod
    def render_fleet_zone():
        """Zone 3: Validate fleet"""
        state = get_state()
        
        # Convert dict to DataFrame for display
        fleet_data = []
        if state.fleet_config:
            for vehicle_name, vehicle_data in state.fleet_config.items():
                fleet_data.append({
                    'Veiculo': vehicle_name,
                    'Capacidade_KG': vehicle_data.capacidade_kg,
                    'Cap_Volume_m3': vehicle_data.capacidade_vol,
                    'Custo_KM': vehicle_data.custo_km,
                    'Velocidade_Media': vehicle_data.velocidade_media,
                    'Horario_Inicio': vehicle_data.horario_inicio,
                    'Horario_Fim': vehicle_data.horario_fim,
                    'Armazem': vehicle_data.armazem
                })
        
        fleet_df = pd.DataFrame(fleet_data)
        if fleet_df.empty:
            # Setup defaults if empty
            fleet_df = pd.DataFrame({
                'Veiculo': ['Veículo 1', 'Veículo 2', 'Veículo 3'],
                'Capacidade_KG': [500, 750, 1000],
                'Cap_Volume_m3': [0.0, 0.0, 0.0],
                'Custo_KM': [0.50, 0.60, 0.70],
                'Velocidade_Media': [40, 40, 40],
                'Horario_Inicio': ['08:00', '08:00', '08:00'],
                'Horario_Fim': ['18:00', '18:00', '18:00'],
                'Armazem': ['' for _ in range(3)]
            })
            # Try to associate first warehouse if exists
            if state.warehouses_geocoded is not None and not state.warehouses_geocoded.empty:
                first_wh = state.warehouses_geocoded.iloc[0]['Nome_Armazem']
                fleet_df['Armazem'] = first_wh
        
        if len(fleet_df) == 0:
            st.error("❌ **Nenhum veículo configurado**")
        else:
            st.success(f"✅ **{len(fleet_df)} veículo(s)** configurado(s)")
        
        # Get warehouse names for selectbox
        warehouse_names = []
        if state.warehouses_geocoded is not None:
            warehouse_names = state.warehouses_geocoded['Nome_Armazem'].tolist()
            
        # Editable table
        edited_fleet = st.data_editor(
            fleet_df,
            num_rows="dynamic",
            use_container_width=True,
            hide_index=True,
            column_config={
                "Armazem": st.column_config.SelectboxColumn(
                    "Armazém",
                    options=warehouse_names,
                    required=True
                )
            },
            key="fleet_editor_v2"
        )
        
        # Save back to state as dict of FleetVehicle
        new_fleet_dict = {}
        if isinstance(edited_fleet, pd.DataFrame) and not edited_fleet.empty:
            for _, row in edited_fleet.iterrows():
                new_fleet_dict[row['Veiculo']] = FleetVehicle(
                    capacidade_kg=row['Capacidade_KG'],
                    capacidade_vol=row.get('Cap_Volume_m3', 0.0),
                    custo_km=row['Custo_KM'],
                    velocidade_media=row['Velocidade_Media'],
                    horario_inicio=str(row['Horario_Inicio']),
                    horario_fim=str(row['Horario_Fim']),
                    armazem=row['Armazem']
                )
        
        if new_fleet_dict != state.fleet_config:
            state.fleet_config = new_fleet_dict
            set_state(state)
    
    @staticmethod
    def render_completion_check():
        """Check if all zones are complete"""
        state = get_state()
        
        # Check each zone
        clients_ok = (
            state.clients_geocoded is not None and
            len(state.clients_geocoded[state.clients_geocoded['Nivel_Qualidade'] == 8]) == 0
        )
        
        warehouses_ok = state.warehouses_geocoded is not None and len(state.warehouses_geocoded) > 0
        fleet_ok = len(state.fleet_config) > 0
        
        all_ok = clients_ok and warehouses_ok and fleet_ok
        
        # Visual summary
        st.markdown("### 📊 Resumo de Validação")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            if clients_ok:
                st.success("✅ Clientes OK")
            else:
                st.error("❌ Clientes")
        
        with col2:
            if warehouses_ok:
                st.success("✅ Armazéns OK")
            else:
                st.error("❌ Armazéns")
        
        with col3:
            if fleet_ok:
                st.success("✅ Frota OK")
            else:
                st.error("❌ Frota")
        
        # Advance button
        if all_ok:
            st.balloons()
            st.success("🎉 **Tudo validado!** Pronto para planeamento de rotas.")
            state.phase_2_complete = True
            set_state(state)
            
            if st.button("🚀 Avançar para Fase 3: Planeamento", type="primary", use_container_width=True):
                from components.phase_navigator import PhaseNavigator
                PhaseNavigator.set_phase(3)
                st.rerun()
        else:
            st.warning("⚠️ Complete todas as zonas para avançar.")
            state.phase_2_complete = False
            set_state(state)
