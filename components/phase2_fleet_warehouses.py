"""
Phase 2: Fleet and Warehouses Component
Import combined Excel file with 2 sheets: Warehouses + Fleet
"""

import streamlit as st
import pandas as pd
import folium
from streamlit_folium import st_folium

from utils.geocoder_engine import WaterfallGeocoder


class Phase2FleetWarehouses:
    """Phase 2: Configure fleet and warehouses"""
    
    DB_FILE = 'geocoding.db'
    
    @staticmethod
    def render():
        st.title("🚚 Fase 2: Frota e Armazéns")
        st.markdown("Importe ou configure a sua frota e armazéns.")
        
        # Check if already configured
        if Phase2FleetWarehouses.is_complete():
            Phase2FleetWarehouses.show_summary()
        else:
            Phase2FleetWarehouses.show_configuration()
    
    @staticmethod
    def is_complete():
        """Check if phase 2 is complete"""
        warehouses = st.session_state.get('warehouses', [])
        fleet = st.session_state.get('fleet_config')
        
        return len(warehouses) > 0 and fleet is not None and len(fleet) > 0
    
    @staticmethod
    def show_configuration():
        """Show configuration interface"""
        
        st.header("Importar Frota e Armazéns")
        
        st.info("📋 **Ficheiro Excel com 2 sheets:**\n"
                "- **Sheet 1 'Armazéns':** Nome_Armazem, Morada, CP, Localidade\n"
                "- **Sheet 2 'Frota':** Veiculo, Armazem, Capacidade_KG, Custo_KM, Velocidade_Media, Horario_Inicio, Horario_Fim")
        
        # File upload
        uploaded_file = st.file_uploader(
            "📁 Carregar Ficheiro de Frota e Armazéns",
            type=['xlsx'],
            key="fleet_warehouses_upload",
            help="Ficheiro Excel com 2 sheets: Armazéns e Frota"
        )
        
        if uploaded_file:
            Phase2FleetWarehouses.process_upload(uploaded_file)
        
        # Manual configuration option
        st.markdown("---")
        st.markdown("### Ou Configure Manualmente")
        
        tab1, tab2 = st.tabs(["🏭 Armazéns", "🚗 Frota"])
        
        with tab1:
            Phase2FleetWarehouses.render_warehouses_manual()
        
        with tab2:
            Phase2FleetWarehouses.render_fleet_manual()
    
    @staticmethod
    def process_upload(uploaded_file):
        """Process uploaded Excel file with 2 sheets"""
        
        try:
            # Read both sheets
            excel_file = pd.ExcelFile(uploaded_file)
            
            # Check sheets exist
            if 'Armazéns' not in excel_file.sheet_names or 'Frota' not in excel_file.sheet_names:
                st.error("❌ Ficheiro deve ter 2 sheets: 'Armazéns' e 'Frota'")
                return
            
            df_warehouses = pd.read_excel(uploaded_file, sheet_name='Armazéns')
            df_fleet = pd.read_excel(uploaded_file, sheet_name='Frota')
            
            # Validate warehouses
            required_wh_cols = ['Nome_Armazem', 'Morada', 'CP', 'Localidade']
            missing_wh = set(required_wh_cols) - set(df_warehouses.columns)
            if missing_wh:
                st.error(f"❌ Sheet 'Armazéns' - Colunas em falta: {', '.join(missing_wh)}")
                return
            
            # Validate fleet
            required_fleet_cols = ['Veiculo', 'Armazem', 'Capacidade_KG', 'Custo_KM', 'Velocidade_Media', 'Horario_Inicio', 'Horario_Fim']
            missing_fleet = set(required_fleet_cols) - set(df_fleet.columns)
            if missing_fleet:
                st.error(f"❌ Sheet 'Frota' - Colunas em falta: {', '.join(missing_fleet)}")
                return
            
            st.success(f"✅ Ficheiro válido! {len(df_warehouses)} armazéns, {len(df_fleet)} veículos")
            
            # Geocode warehouses
            if st.button("🚀 Processar e Georreferenciar Armazéns", type="primary"):
                Phase2FleetWarehouses.geocode_warehouses(df_warehouses, df_fleet)
        
        except Exception as e:
            st.error(f"❌ Erro ao ler ficheiro: {str(e)}")
    
    @staticmethod
    def geocode_warehouses(df_warehouses, df_fleet):
        """Geocode all warehouses from the file"""
        
        api_key = st.session_state.get('google_api_key')
        geocoder = WaterfallGeocoder(Phase2FleetWarehouses.DB_FILE, google_api_key=api_key)
        
        warehouses = []
        progress_bar = st.progress(0)
        status_text = st.empty()
        
        for i, row in df_warehouses.iterrows():
            nome = row['Nome_Armazem']
            morada = row['Morada']
            cp = str(row['CP']) if pd.notna(row['CP']) else ""
            localidade = row['Localidade']
            
            status_text.text(f"Geocodificando {i+1}/{len(df_warehouses)}: {nome}")
            
            # Geocode
            result, _ = geocoder.resolve_address(morada, cp, localidade)
            
            if result and result['lat'] and result['quality_level'] < 8:
                warehouses.append({
                    'name': nome,
                    'address': morada,
                    'lat': result['lat'],
                    'lon': result['lon'],
                    'quality': result['quality_level']
                })
                progress_bar.progress((i + 1) / len(df_warehouses))
            else:
                st.warning(f"⚠️ Falha ao georreferenciar '{nome}' - será necessário correção manual")
        
        
        # Save warehouses as DataFrame with correct column names
        warehouses_df = pd.DataFrame(warehouses)
        warehouses_df = warehouses_df.rename(columns={
            'name': 'Nome_Armazem',
            'address': 'Morada',
            'lat': 'Latitude',
            'lon': 'Longitude',
            'quality': 'Nivel_Qualidade'
        })
        
        st.session_state['warehouses_geocoded'] = warehouses_df
        st.session_state['warehouses'] = warehouses  # Keep for compatibility
        
        # Save fleet as dict (Phase 3 expects dict not DataFrame)
        fleet_dict = {}
        for _, row in df_fleet.iterrows():
            fleet_dict[row['Veiculo']] = {
                'capacity': row['Capacidade_KG'],
                'cost_per_km': row['Custo_KM'],
                'speed': row['Velocidade_Media'],
                'start_time': str(row['Horario_Inicio']),
                'end_time': str(row['Horario_Fim']),
                'warehouse': row['Armazem']
            }
        
        st.session_state['fleet_config'] = fleet_dict
        
        st.success(f"✅ {len(warehouses)} armazéns georreferenciados!")
        st.session_state['phase_2_complete'] = True
        
        st.rerun()
    
    @staticmethod
    def render_warehouses_manual():
        """Manual warehouse configuration"""
        
        warehouses = st.session_state.get('warehouses', [])
        
        st.subheader("Adicionar Armazém")
        
        with st.form("add_warehouse_form"):
            col1, col2 = st.columns(2)
            
            with col1:
                wh_name = st.text_input("Nome do Armazém")
                wh_address = st.text_input("Morada")
            
            with col2:
                wh_cp = st.text_input("CP")
                wh_locality = st.text_input("Localidade")
            
            submitted = st.form_submit_button("📍 Adicionar e Georreferenciar")
            
            if submitted and wh_name and wh_address:
                api_key = st.session_state.get('google_api_key')
                geocoder = WaterfallGeocoder(Phase2FleetWarehouses.DB_FILE, google_api_key=api_key)
                
                result, _ = geocoder.resolve_address(wh_address, wh_cp, wh_locality)
                
                if result and result['lat'] and result['quality_level'] < 8:
                    if 'warehouses' not in st.session_state:
                        st.session_state['warehouses'] = []
                    
                    st.session_state['warehouses'].append({
                        'name': wh_name,
                        'address': wh_address,
                        'lat': result['lat'],
                        'lon': result['lon'],
                        'quality': result['quality_level']
                    })
                    st.success(f"✅ Armazém '{wh_name}' adicionado!")
                    st.rerun()
                else:
                    st.error("❌ Não foi possível georreferenciar. Verifique a morada.")
        
        # List warehouses
        if len(warehouses) > 0:
            st.markdown("---")
            st.markdown("### Armazéns Configurados")
            
            for idx, wh in enumerate(warehouses):
                col1, col2, col3, col4 = st.columns([3, 2, 2, 1])
                col1.write(f"**{wh['name']}**")
                col2.write(f"{wh['lat']:.5f}, {wh['lon']:.5f}")
                col3.write(f"Nível {wh['quality']}")
                
                if col4.button("🗑️", key=f"del_wh_{idx}"):
                    st.session_state['warehouses'].pop(idx)
                    st.rerun()
    
    @staticmethod
    def render_fleet_manual():
        """Manual fleet configuration"""
        
        warehouses = st.session_state.get('warehouses', [])
        
        if len(warehouses) == 0:
            st.warning("⚠️ Adicione armazéns primeiro (tab Armazéns)")
            return
        
        if 'fleet_config' not in st.session_state:
            st.session_state['fleet_config'] = pd.DataFrame(columns=[
                'Veiculo', 'Armazem', 'Capacidade_KG', 'Custo_KM', 
                'Velocidade_Media', 'Horario_Inicio', 'Horario_Fim'
            ])
        
        fleet = st.session_state['fleet_config']
        
        st.info(f"💡 Atribua cada veículo a um dos {len(warehouses)} armazém(s) disponível(is).")
        
        # Editable table
        edited_fleet = st.data_editor(
            fleet,
            num_rows="dynamic",
            use_container_width=True,
            hide_index=True,
            column_config={
                "Armazem": st.column_config.SelectboxColumn(
                    "Armazém",
                    help="Selecione o armazém de origem",
                    options=[wh['name'] for wh in warehouses],
                    required=True
                ),
                "Veiculo": st.column_config.TextColumn("Veículo", required=True),
                "Capacidade_KG": st.column_config.NumberColumn("Capacidade (kg)", min_value=0, required=True),
                "Custo_KM": st.column_config.NumberColumn("Custo/km (€)", min_value=0.0, format="%.2f", required=True),
                "Velocidade_Media": st.column_config.NumberColumn("Velocidade (km/h)", min_value=0, required=True),
                "Horario_Inicio": st.column_config.TimeColumn("Início", format="HH:mm", required=True),
                "Horario_Fim": st.column_config.TimeColumn("Fim", format="HH:mm", required=True)
            },
            key="fleet_editor_manual"
        )
        
        st.session_state['fleet_config'] = edited_fleet
    
    @staticmethod
    def show_summary():
        """Show summary when complete"""
        
        warehouses = st.session_state.get('warehouses', [])
        fleet = st.session_state.get('fleet_config')
        
        st.success("✅ **Frota e Armazéns Configurados!**")
        
        col1, col2 = st.columns(2)
        col1.metric("Armazéns", len(warehouses))
        col2.metric("Veículos", len(fleet))
        
        # Show warehouses map
        st.markdown("### Mapa de Armazéns")
        
        m = folium.Map(location=[39.5, -8.0], zoom_start=7)
        
        for wh in warehouses:
            folium.Marker(
                [wh['lat'], wh['lon']],
                popup=wh['name'],
                tooltip=wh['address'],
                icon=folium.Icon(color='red', icon='home', prefix='fa')
            ).add_to(m)
        
        st_folium(m, width=None, height=400, key="warehouses_summary_map")
        
        # Show fleet table (editable)
        st.markdown("### Frota Configurada")
        
        # Convert dict to DataFrame if needed
        if isinstance(fleet, dict):
            fleet_rows = []
            for vehicle_name, vehicle_data in fleet.items():
                fleet_rows.append({
                    'Veiculo': vehicle_name,
                    'Capacidade_KG': vehicle_data['capacity'],
                    'Custo_KM': vehicle_data['cost_per_km'],
                    'Velocidade_Media': vehicle_data['speed'],
                    'Horario_Inicio': vehicle_data['start_time'],
                    'Horario_Fim': vehicle_data['end_time'],
                    'Armazem': vehicle_data.get('warehouse', warehouses[0]['name'] if warehouses else '')
                })
            fleet_df = pd.DataFrame(fleet_rows)
        else:
            fleet_df = fleet
        
        # Editable fleet table
        edited_fleet = st.data_editor(
            fleet_df,
            num_rows="dynamic",
            use_container_width=True,
            hide_index=True,
            column_config={
                "Armazem": st.column_config.SelectboxColumn(
                    "Armazém",
                    help="Selecione o armazém de origem",
                    options=[wh['name'] for wh in warehouses],
                    required=True
                ),
                "Veiculo": st.column_config.TextColumn("Veículo", required=True),
                "Capacidade_KG": st.column_config.NumberColumn("Capacidade (kg)", min_value=0, required=True),
                "Custo_KM": st.column_config.NumberColumn("Custo/km (€)", min_value=0.0, format="%.2f", required=True),
                "Velocidade_Media": st.column_config.NumberColumn("Velocidade (km/h)", min_value=0, required=True),
                "Horario_Inicio": st.column_config.TextColumn("Início (HH:MM)", required=True),
                "Horario_Fim": st.column_config.TextColumn("Fim (HH:MM)", required=True)
            },
            key="fleet_editor_summary"
        )
        
        # Update fleet config if changed
        if not edited_fleet.equals(fleet_df):
            # Convert back to dict format
            new_fleet_dict = {}
            for _, row in edited_fleet.iterrows():
                new_fleet_dict[row['Veiculo']] = {
                    'capacity': row['Capacidade_KG'],
                    'cost_per_km': row['Custo_KM'],
                    'speed': row['Velocidade_Media'],
                    'start_time': str(row['Horario_Inicio']),
                    'end_time': str(row['Horario_Fim']),
                    'warehouse': row['Armazem']
                }
            st.session_state['fleet_config'] = new_fleet_dict
            st.info("💡 Alterações guardadas automaticamente!")
        
        # Actions
        st.markdown("---")
        
        col1, col2 = st.columns(2)
        
        with col1:
            if st.button("🔄 Reconfigurar", use_container_width=True):
                for key in ['warehouses', 'fleet_config', 'phase_2_complete']:
                    if key in st.session_state:
                        del st.session_state[key]
                st.rerun()
        
        with col2:
            if st.button("➡️ Avançar para Fase 3: Planeamento", type="primary", use_container_width=True):
                st.session_state['current_phase'] = 3
                st.rerun()
