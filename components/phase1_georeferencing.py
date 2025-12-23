"""
Phase 1: Client Georeferencing Component (with mandatory correction)
All clients must be georeferenced before advancing.
"""

import streamlit as st
import pandas as pd
import time
from datetime import datetime
import folium
from streamlit_folium import st_folium

from utils.geocoder_engine import WaterfallGeocoder
from utils.geocoding_logs import save_geocoding_log, get_geocoding_stats


class Phase1Georeferencing:
    """Phase 1: Geocode all clients (100% required)"""
    
    DB_FILE = 'geocoding.db'
    
    @staticmethod
    def render():
        st.title("📍 Fase 1: Georreferenciação de Clientes")
        st.markdown("**Todos os clientes devem estar georreferenciados antes de avançar.**")
        
        # Clear any problematic file uploader state
        if 'clients_upload' in st.session_state and st.session_state.get('clients_geocoded') is None:
            # If there's an upload key but no geocoded data, it might be from a failed upload
            # Let Streamlit handle it naturally
            pass
        
        # Check if already geocoded
        if st.session_state.get('clients_geocoded') is not None:
            Phase1Georeferencing.show_results_and_corrections()
        else:
            Phase1Georeferencing.render_upload_and_geocode()
    
    @staticmethod
    def render_upload_and_geocode():
        """Upload and geocode clients"""
        
        st.header("Upload de Clientes")
        
        # File upload
        uploaded_file = st.file_uploader(
            "📁 Carregar Excel com Clientes",
            type=['xlsx'],
            key="clients_upload",
            help="Ficheiro deve conter colunas: Morada, Codigo_Postal, Concelho"
        )
        
        if not uploaded_file:
            st.info("👆 Carregue um ficheiro Excel para começar.")
            return
        
        # Read file with error handling
        try:
            df = pd.read_excel(uploaded_file)
            st.success(f"✅ Carregadas **{len(df)}** linhas.")
        except Exception as e:
            st.error(f"❌ Erro ao ler ficheiro: {str(e)}")
            st.info("💡 Certifique-se que carregou um ficheiro Excel válido (.xlsx)")
            return
        
        # Column Mapping
        st.markdown("#### Mapeamento de Colunas")
        cols = df.columns.tolist()
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            col_addr = st.selectbox(
                "Coluna Morada",
                cols,
                index=Phase1Georeferencing._find_column_index(cols, ['morada', 'address', 'rua'])
            )
        
        with col2:
            col_cp = st.selectbox(
                "Coluna CP",
                cols,
                index=Phase1Georeferencing._find_column_index(cols, ['codigo_postal', 'cp', 'postal'])
            )
        
        with col3:
            col_city = st.selectbox(
                "Coluna Concelho/Cidade",
                cols,
                index=Phase1Georeferencing._find_column_index(cols, ['concelho', 'cidade', 'localidade'])
            )
        
        # Show performance stats
        geo_stats = get_geocoding_stats()
        
        if geo_stats['total_sessoes'] > 0:
            tempo_por_100 = (geo_stats['tempo_medio_segundos'] / geo_stats['total_enderecos']) * 100 if geo_stats['total_enderecos'] > 0 else 0
            tempo_min_100 = tempo_por_100 / 60
            
            st.info(f"⏱️ **Estimativa:** ~{tempo_min_100:.1f} min/100 clientes | "
                   f"📊 {geo_stats['total_sessoes']} sessões | "
                   f"{geo_stats['total_enderecos']} endereços processados")
        
        # Start geocoding button
        if st.button("🚀 Iniciar Geocoding", type="primary", use_container_width=True):
            Phase1Georeferencing._run_geocoding(df, col_addr, col_cp, col_city)
    
    @staticmethod
    def _run_geocoding(df, col_addr, col_cp, col_city):
        """Execute geocoding process"""
        api_key = st.session_state.get('google_api_key')
        geocoder = WaterfallGeocoder(Phase1Georeferencing.DB_FILE, google_api_key=api_key)
        
        progress_bar = st.progress(0)
        status_text = st.empty()
        
        results = []
        learned_batch = []
        start_time = time.time()
        
        for i, row in df.iterrows():
            addr = str(row[col_addr])
            cp = str(row[col_cp]) if pd.notna(row[col_cp]) else ""
            city = str(row[col_city]) if pd.notna(row[col_city]) else ""
            
            percent = int((i + 1) / len(df) * 100)
            status_text.text(f"Processando {i+1}/{len(df)} ({percent}%): {addr}")
            
            res, learned = geocoder.resolve_address(addr, cp, city)
            
            if learned:
                learned_batch.append(learned)
            
            # Flatten result for DataFrame
            flat_res = row.to_dict()
            flat_res['Latitude'] = res['lat']
            flat_res['Longitude'] = res['lon']
            flat_res['Nivel_Qualidade'] = res['quality_level']
            flat_res['Fonte_Match'] = res['source']
            flat_res['Morada_Encontrada'] = res['address']
            flat_res['Score_Match'] = res.get('score', 0)
            
            results.append(flat_res)
            progress_bar.progress((i + 1) / len(df))
        
        # Save learned addresses
        learned_count = 0
        if learned_batch:
            geocoder.save_learned_batch(learned_batch)
            learned_count = len(learned_batch)
        
        total_time = time.time() - start_time
        minutes = int(total_time // 60)
        seconds = int(total_time % 60)
        time_str = f"{minutes}m {seconds}s"
        
        st.success(f"✅ Concluído em {time_str}!")
        
        df_res = pd.DataFrame(results)
        
        # Calculate success/failure counts
        sucesso = len(df_res[df_res['Nivel_Qualidade'] <= 2])
        falhas = len(df_res[df_res['Nivel_Qualidade'] == 8])
        
        # Save to geocoding logs
        save_geocoding_log(
            total_clientes=len(df_res),
            tempo_segundos=total_time,
            enderecos_aprendidos=learned_count,
            sucesso=sucesso,
            falhas=falhas
        )
        
        # Save to session state
        st.session_state['clients_geocoded'] = df_res
        st.session_state['clients_original_df'] = df
        st.session_state['processing_time'] = time_str
        st.session_state['learned_count'] = learned_count
        
        # Store failed clients for correction
        if falhas > 0:
            failures = df_res[df_res['Nivel_Qualidade'] == 8]
            st.session_state['failed_clients'] = failures
            st.session_state['total_failed_count'] = len(failures)
        
        st.rerun()
    
    @staticmethod
    def show_results_and_corrections():
        """Show results with integrated correction interface"""
        
        df_res = st.session_state['clients_geocoded']
        failed_clients = df_res[df_res['Nivel_Qualidade'] == 8]
        
        # Summary
        total = len(df_res)
        sucesso = len(df_res[df_res['Nivel_Qualidade'] < 8])
        falhas = len(failed_clients)
        
        st.header("Resultados do Geocoding")
        
        col1, col2, col3, col4 = st.columns(4)
        col1.metric("Total", total)
        col2.metric("Georreferenciados", sucesso, delta=f"{sucesso/total*100:.1f}%")
        col3.metric("Falhas", falhas, delta=f"{falhas/total*100:.1f}%", delta_color="inverse")
        col4.metric("Taxa Sucesso", f"{sucesso/total*100:.1f}%")
        
        st.markdown("---")
        
        # If there are failures, show correction interface
        if len(failed_clients) > 0:
            st.warning(f"⚠️ **{len(failed_clients)} clientes** precisam de correção manual.")
            st.info("👉 Corrija todos os clientes abaixo para avançar para a Fase 2.")
            
            Phase1Georeferencing.render_correction_interface(failed_clients)
        else:
            st.success("🎉 **Todos os clientes georreferenciados!**")
            st.session_state['phase_1_complete'] = True
            
            # Show map
            Phase1Georeferencing.show_map(df_res)
            
            # Advance button
            if st.button("➡️ Avançar para Fase 2: Frota e Armazéns", type="primary", use_container_width=True):
                st.session_state['current_phase'] = 2
                st.rerun()
        
        # Option to reload with clearer label
        st.markdown("---")
        if st.button(
            "🔄 Recomeçar com Novos Clientes",
            help="Limpar dados atuais e carregar um novo ficheiro Excel",
            type="secondary"
        ):
            for key in ['clients_geocoded', 'failed_clients', 'clients_original_df', 'total_failed_count', 'corrected_clients', 'current_correction_idx']:
                if key in st.session_state:
                    del st.session_state[key]
            st.rerun()
    
    @staticmethod
    def render_correction_interface(failed_clients):
        """Integrated correction interface with linear navigation"""
        
        # Initialize correction storage
        if 'corrected_clients' not in st.session_state:
            st.session_state['corrected_clients'] = {}
        
        # Initialize current index
        if 'current_correction_idx' not in st.session_state:
            st.session_state['current_correction_idx'] = 0
        
        # Ensure index is valid
        if st.session_state['current_correction_idx'] >= len(failed_clients):
            st.session_state['current_correction_idx'] = 0
        
        total_failed = len(failed_clients)
        corrected_count = len(st.session_state['corrected_clients'])
        
        # Compact progress header
        col1, col2 = st.columns([3, 1])
        with col1:
            st.markdown(f"### 🔧 Correção de Clientes")
        with col2:
            st.metric("Progresso", f"{corrected_count}/{total_failed}")
        
        if corrected_count > 0:
            progress = corrected_count / total_failed
            st.progress(progress)
        
        # Status list (collapsed by default to save space)
        with st.expander("📋 Lista de Clientes", expanded=False):
            status_data = []
            for idx, row in failed_clients.iterrows():
                codigo = row.get('Codigo_Cliente', f'Cliente {idx}')
                is_corrected = codigo in st.session_state['corrected_clients']
                status_data.append({
                    'Status': '🟢 Corrigido' if is_corrected else '🔴 Pendente',
                    'Código': codigo,
                    'Morada': row.get('Morada', 'N/A')[:50],
                    'CP': row.get('Codigo_Postal', 'N/A')
                })
            
            df_status = pd.DataFrame(status_data)
            st.dataframe(df_status, use_container_width=True, hide_index=True)
        
        st.markdown("---")
        
        # Current client
        current_idx = st.session_state['current_correction_idx']
        client_row = failed_clients.iloc[current_idx]
        codigo = client_row.get('Codigo_Cliente', f'Cliente {current_idx}')
        
        # Navigation buttons
        col1, col2, col3 = st.columns([1, 2, 1])
        
        with col1:
            if st.button("⬅️ Anterior", disabled=(current_idx == 0), use_container_width=True):
                st.session_state['current_correction_idx'] = max(0, current_idx - 1)
                st.rerun()
        
        with col2:
            st.markdown(f"**Cliente {current_idx + 1} de {total_failed}**")
        
        with col3:
            if st.button("Próximo ➡️", disabled=(current_idx >= total_failed - 1), use_container_width=True):
                st.session_state['current_correction_idx'] = min(total_failed - 1, current_idx + 1)
                st.rerun()
        
        st.markdown("---")
        
        # Compact client details
        st.markdown(f"### Cliente: {codigo}")
        
        # Use compact single-line display
        st.caption(f"📍 {client_row.get('Morada', 'N/A')} | CP: {client_row.get('Codigo_Postal', 'N/A')} | {client_row.get('Concelho', 'N/A')}")
        
        # Check if already corrected
        if codigo in st.session_state['corrected_clients']:
            correction = st.session_state['corrected_clients'][codigo]
            st.success(f"✅ Cliente já corrigido! Lat: {correction['lat']:.6f}, Lon: {correction['lon']:.6f}")
            
            if st.button("🔄 Corrigir Novamente", key=f"redo_{current_idx}"):
                del st.session_state['corrected_clients'][codigo]
                st.rerun()
        else:
            # Correction form
            st.markdown("#### Corrigir Cliente")
            
            method = st.radio(
                "Método:",
                ["✏️ Editar e Re-geocodificar", "🗺️ Selecionar no Mapa"],
                horizontal=True,
                key=f"method_{current_idx}"
            )
            
            if method == "✏️ Editar e Re-geocodificar":
                Phase1Georeferencing._edit_correction_inline(client_row, current_idx, codigo)
            else:
                Phase1Georeferencing._map_correction_inline(client_row, current_idx, codigo)
        
        st.markdown("---")
        
        # Final save button
        if corrected_count == total_failed:
            st.success("🎉 Todos os clientes foram corrigidos!")
            
            if st.button("💾 Guardar Todas as Correções e Continuar", type="primary", use_container_width=True):
                Phase1Georeferencing._save_all_corrections()
        elif corrected_count > 0:
            st.info(f"💡 {total_failed - corrected_count} clientes ainda precisam de correção.")
    
    @staticmethod
    def _map_correction(client_row, client_idx):
        """Map-based correction"""
        st.info("👆 Clique no mapa para definir a localização")
        
        center_lat = st.session_state.get('temp_correction', {}).get('lat', 39.5)
        center_lon = st.session_state.get('temp_correction', {}).get('lon', -8.0)
        
        m = folium.Map(location=[center_lat, center_lon], zoom_start=7)
        
        if 'temp_correction' in st.session_state:
            folium.Marker(
                [st.session_state['temp_correction']['lat'], st.session_state['temp_correction']['lon']],
                popup="Selecionado",
                icon=folium.Icon(color='green', icon='check', prefix='fa')
            ).add_to(m)
        
        map_data = st_folium(m, height=400, width=None, key=f"map_phase1_{client_idx}")
        
        if map_data and map_data.get("last_clicked"):
            clicked = map_data["last_clicked"]
            st.session_state['temp_correction'] = {
                'lat': clicked['lat'],
                'lon': clicked['lng'],
                'client_idx': client_idx
            }
            st.success(f"✅ Localização: {clicked['lat']:.5f}, {clicked['lng']:.5f}")
        
        if st.button("💾 Guardar", disabled='temp_correction' not in st.session_state, type="primary"):
            Phase1Georeferencing._save_correction(client_row)
    
    @staticmethod
    def _edit_correction(client_row, client_idx):
        """Edit-based correction"""
        
        # Clear temp correction when switching clients
        if 'last_correction_idx' not in st.session_state or st.session_state['last_correction_idx'] != client_idx:
            if 'temp_correction' in st.session_state:
                del st.session_state['temp_correction']
            st.session_state['last_correction_idx'] = client_idx
        
        col1, col2 = st.columns(2)
        
        with col1:
            new_addr = st.text_input("Morada", value=client_row.get('Morada', ''), key=f"addr_p1_{client_idx}")
            new_cp = st.text_input("CP", value=client_row.get('Codigo_Postal', ''), key=f"cp_p1_{client_idx}")
        
        with col2:
            new_conc = st.text_input("Concelho", value=client_row.get('Concelho', ''), key=f"conc_p1_{client_idx}")
        
        if st.button("🔍 Re-geocodificar", type="primary", key=f"regeo_btn_{client_idx}"):
            api_key = st.session_state.get('google_api_key')
            geocoder = WaterfallGeocoder(Phase1Georeferencing.DB_FILE, google_api_key=api_key)
            
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
                
                if st.button("💾 Guardar", type="primary", key=f"save_btn_{client_idx}"):
                    Phase1Georeferencing._save_correction(client_row)
            else:
                st.error("❌ Falhou. Tente o método do mapa.")
    
    @staticmethod
    def _save_correction(client_row):
        """Save correction to temporary list"""
        correction = st.session_state['temp_correction']
        
        # Add to corrected list
        if 'corrected_clients' not in st.session_state:
            st.session_state['corrected_clients'] = []
        
        corrected_data = {
            'codigo': client_row.get('Codigo_Cliente'),
            'morada': correction.get('address', client_row.get('Morada')),
            'cp': correction.get('cp', client_row.get('Codigo_Postal')),
            'concelho': correction.get('concelho', client_row.get('Concelho')),
            'lat': correction['lat'],
            'lon': correction['lon'],
            'quality_level': correction.get('quality_level', 0),
            'source': correction.get('source', 'MANUAL'),
            'original_index': client_row.name
        }
        
        st.session_state['corrected_clients'].append(corrected_data)
        
        # Remove from failed clients
        clients_geocoded = st.session_state['clients_geocoded'].copy()
        codigo = client_row.get('Codigo_Cliente')
        mask = clients_geocoded['Codigo_Cliente'] == codigo if codigo else clients_geocoded['Morada'] == client_row.get('Morada')
        
        # Mark as corrected in main dataframe (temporarily)
        clients_geocoded.loc[mask, 'Latitude'] = correction['lat']
        clients_geocoded.loc[mask, 'Longitude'] = correction['lon']
        clients_geocoded.loc[mask, 'Nivel_Qualidade'] = correction.get('quality_level', 0)
        clients_geocoded.loc[mask, 'Fonte_Match'] = correction.get('source', 'MANUAL')
        
        if 'address' in correction:
            clients_geocoded.loc[mask, 'Morada'] = correction['address']
            clients_geocoded.loc[mask, 'Codigo_Postal'] = correction['cp']
            clients_geocoded.loc[mask, 'Concelho'] = correction['concelho']
        
        st.session_state['clients_geocoded'] = clients_geocoded
        
        # Clear temporary data
        if 'temp_correction' in st.session_state:
            del st.session_state['temp_correction']
        if 'last_correction_idx' in st.session_state:
            del st.session_state['last_correction_idx']
        
        # Check remaining failed clients
        remaining_failed = clients_geocoded[clients_geocoded['Nivel_Qualidade'] == 8]
        
        if len(remaining_failed) > 0:
            st.success(f"✅ Cliente corrigido! Restam {len(remaining_failed)} clientes por corrigir.")
        else:
            st.success("🎉 Último cliente corrigido! Clique em 'Guardar Todas as Correções'.")
        
        st.rerun()
    
    @staticmethod
    def _save_all_corrections():
        """Save all corrections at once"""
        
        clients_geocoded = st.session_state['clients_geocoded'].copy()
        corrected_clients = st.session_state.get('corrected_clients', {})
        
        # Apply all corrections
        for codigo, correction in corrected_clients.items():
            mask = clients_geocoded['Codigo_Cliente'] == codigo
            
            clients_geocoded.loc[mask, 'Latitude'] = correction['lat']
            clients_geocoded.loc[mask, 'Longitude'] = correction['lon']
            clients_geocoded.loc[mask, 'Nivel_Qualidade'] = correction.get('quality_level', 0)
            clients_geocoded.loc[mask, 'Fonte_Match'] = correction.get('source', 'MANUAL')
            
            if 'address' in correction:
                clients_geocoded.loc[mask, 'Morada'] = correction['address']
                clients_geocoded.loc[mask, 'Codigo_Postal'] = correction['cp']
                clients_geocoded.loc[mask, 'Concelho'] = correction['concelho']
        
        st.session_state['clients_geocoded'] = clients_geocoded
        
        # Clear temporary storage
        st.session_state['corrected_clients'] = {}
        if 'current_correction_idx' in st.session_state:
            del st.session_state['current_correction_idx']
        if 'total_failed_count' in st.session_state:
            del st.session_state['total_failed_count']
        
        st.success("✅ Todas as correções aplicadas com sucesso!")
        st.rerun()
    
    @staticmethod
    def _edit_correction_inline(client_row, client_idx, codigo):
        """Inline edit-based correction"""
        
        col1, col2 = st.columns(2)
        
        with col1:
            new_addr = st.text_input("Morada", value=client_row.get('Morada', ''), key=f"addr_{client_idx}")
            new_cp = st.text_input("CP", value=client_row.get('Codigo_Postal', ''), key=f"cp_{client_idx}")
        
        with col2:
            new_conc = st.text_input("Concelho", value=client_row.get('Concelho', ''), key=f"conc_{client_idx}")
        
        if st.button("🔍 Re-geocodificar e Marcar como Corrigido", type="primary", key=f"regeo_{client_idx}", use_container_width=True):
            api_key = st.session_state.get('google_api_key')
            geocoder = WaterfallGeocoder(Phase1Georeferencing.DB_FILE, google_api_key=api_key)
            
            with st.spinner("Geocodificando..."):
                result, _ = geocoder.resolve_address(new_addr, new_cp, new_conc)
            
            if result and result['lat'] and result['quality_level'] < 8:
                # Save to temp storage
                st.session_state['corrected_clients'][codigo] = {
                    'lat': result['lat'],
                    'lon': result['lon'],
                    'address': new_addr,
                    'cp': new_cp,
                    'concelho': new_conc,
                    'quality_level': result['quality_level'],
                    'source': result['source']
                }
                
                st.success(f"✅ Sucesso! Nível {result['quality_level']} - Cliente marcado como corrigido!")
                
                # Auto-advance to next
                total = len(st.session_state.get('clients_geocoded', pd.DataFrame()))
                if client_idx < total - 1:
                    st.session_state['current_correction_idx'] = client_idx + 1
                
                st.rerun()
            else:
                st.error("❌ Falhou. Tente ajustar a morada ou use o método do mapa.")
    
    @staticmethod
    def _map_correction_inline(client_row, client_idx, codigo):
        """Inline map-based correction"""
        
        st.info("🗺️ Clique no mapa para selecionar a localização correta")
        
        # Create map centered on Lisbon or last known location
        center_lat = client_row.get('Latitude', 38.7223)
        center_lon = client_row.get('Longitude', -9.1393)
        
        if pd.isna(center_lat) or center_lat == 0:
            center_lat, center_lon = 38.7223, -9.1393
        
        m = folium.Map(location=[center_lat, center_lon], zoom_start=13)
        m.add_child(folium.LatLngPopup())
        
        map_data = st_folium(m, width=700, height=400, key=f"map_{client_idx}")
        
        if map_data and map_data.get('last_clicked'):
            clicked_lat = map_data['last_clicked']['lat']
            clicked_lon = map_data['last_clicked']['lng']
            
            st.success(f"📍 Localização selecionada: {clicked_lat:.6f}, {clicked_lon:.6f}")
            
            if st.button("💾 Confirmar e Marcar como Corrigido", type="primary", key=f"confirm_map_{client_idx}", use_container_width=True):
                # Save to temp storage
                st.session_state['corrected_clients'][codigo] = {
                    'lat': clicked_lat,
                    'lon': clicked_lon,
                    'address': client_row.get('Morada'),
                    'cp': client_row.get('Codigo_Postal'),
                    'concelho': client_row.get('Concelho'),
                    'quality_level': 0,
                    'source': 'MANUAL_MAP'
                }
                
                st.success("✅ Cliente marcado como corrigido!")
                
                # Auto-advance to next
                total = len(st.session_state.get('clients_geocoded', pd.DataFrame()))
                if client_idx < total - 1:
                    st.session_state['current_correction_idx'] = client_idx + 1
                
                st.rerun()
    
    @staticmethod
    def show_map(df_res):
        """Show map with all clients"""
        st.markdown("### Mapa de Clientes")
        
        m = folium.Map(location=[39.5, -8.0], zoom_start=7)
        
        for _, row in df_res.iterrows():
            if pd.notna(row['Latitude']) and row['Nivel_Qualidade'] < 8:
                color = ['green','blue','cyan','orange','gray','purple','black'][min(row['Nivel_Qualidade'], 6)]
                folium.CircleMarker(
                    location=(row['Latitude'], row['Longitude']),
                    radius=4,
                    color=color,
                    fill=True,
                    popup=f"{row.get('Morada', 'N/A')} (Nível {row['Nivel_Qualidade']})"
                ).add_to(m)
        
        st_folium(m, width=None, height=400, key="clients_final_map")
    
    @staticmethod
    def _find_column_index(columns, keywords):
        """Find the index of a column that matches any of the keywords"""
        lower_cols = [c.lower() for c in columns]
        
        for i, col in enumerate(lower_cols):
            for kw in keywords:
                if col == kw:
                    return i
        
        for i, col in enumerate(lower_cols):
            for kw in keywords:
                if col.startswith(kw):
                    if kw in ['cp', 'postal', 'codigo_postal'] and 'cliente' in col:
                        continue
                    return i
        
        for i, col in enumerate(lower_cols):
            for kw in keywords:
                if kw in col:
                    if kw in ['cp', 'postal', 'codigo_postal'] and 'cliente' in col:
                        continue
                    return i
        
        return 0
