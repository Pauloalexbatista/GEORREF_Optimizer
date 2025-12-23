import streamlit as st
import pandas as pd
import os
import time
import webbrowser
import simplekml
from streamlit_folium import st_folium
import folium
from utils.geocoder_engine import WaterfallGeocoder
from utils.optimization_solver import RouteOptimizer
from utils.export_engine import generate_route_excel
from utils.geocoding_logs import save_geocoding_log, get_geocoding_stats, get_recent_logs
import numpy as np
import json
from utils.distance_calculator import calculate_haversine_matrix, calculate_euclidean_matrix
from utils.map_generator import generate_route_map_html, open_route_map_in_browser
from utils.schedule_generator import generate_route_schedule_html, open_route_schedule_in_browser
from utils.failure_handler import GeocodingFailureHandler
from components.manual_correction_ui import ManualCorrectionUI
from datetime import datetime

# Page Config
st.set_page_config(
    page_title="Geocoding App Pro",
    page_icon="🌍",
    layout="wide"
)

# Constants
DB_FILE = 'geocoding.db'

# --- CUSTOM CSS (New Color Palette) ---
st.markdown("""
<style>
    /* Color Palette */
    :root {
        --cool-steel: #8DA7BE;
        --ash-brown: #554640;
        --pale-sky: #CDE6F5;
        --cool-steel-dark: #87919E;
        --dim-gray: #707078;
    }
    
    /* Fix button text visibility */
    .stButton > button {
        color: #FFFFFF !important;
        background-color: var(--cool-steel) !important;
        border: 1px solid var(--dim-gray) !important;
        font-weight: 500 !important;
    }
    
    .stButton > button:hover {
        background-color: #6B8AA6 !important;
        border-color: var(--ash-brown) !important;
    }
    
    .stDownloadButton > button {
        color: #FFFFFF !important;
        background-color: var(--cool-steel) !important;
    }
    
    /* Fix input field text visibility */
    .stTextInput > div > div > input,
    .stNumberInput > div > div > input {
        color: #000000 !important;
        background-color: #FFFFFF !important;
    }
    
    .stTextInput > div > div > input::placeholder {
        color: #666666 !important;
    }
    
    /* Headers */
    h1, h2, h3 {
        color: var(--ash-brown) !important;
    }
    
    /* Buttons */
    div.stButton > button {
        background: linear-gradient(135deg, var(--cool-steel) 0%, var(--cool-steel-dark) 100%);
        color: white;
        border: 2px solid var(--ash-brown);
        border-radius: 8px;
        font-weight: bold;
        padding: 0.5rem 1rem;
        transition: all 0.3s ease;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    }
    div.stButton > button:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 8px rgba(0,0,0,0.2);
        background: linear-gradient(135deg, var(--ash-brown) 0%, var(--dim-gray) 100%);
    }
    
    /* Metrics */
    [data-testid="stMetricValue"] {
        color: var(--ash-brown);
        font-weight: bold;
    }
    
    /* Info boxes */
    .stAlert {
        background-color: var(--pale-sky);
        border-left: 4px solid var(--cool-steel);
    }
    
    /* Sidebar */
    [data-testid="stSidebar"] {
        background: linear-gradient(180deg, var(--cool-steel) 0%, var(--cool-steel-dark) 100%);
    }
    [data-testid="stSidebar"] * {
        color: white !important;
    }
    
    /* Fix number input visibility in sidebar */
    [data-testid="stSidebar"] input[type="number"] {
        color: #000000 !important;
        background-color: #ffffff !important;
    }
    
    [data-testid="stSidebar"] .stNumberInput input {
        color: #000000 !important;
        background-color: #ffffff !important;
    }
    
    /* Data Editor */
    .stDataFrame {
        border: 2px solid var(--cool-steel);
        border-radius: 8px;
    }
    
    /* Expanders */
    .streamlit-expanderHeader {
        background-color: var(--pale-sky);
        border-radius: 4px;
        color: var(--ash-brown) !important;
    }
    
    /* Progress bars */
    .stProgress > div > div {
        background-color: var(--cool-steel);
    }
    
    /* Success messages */
    .stSuccess {
        background-color: #d4edda;
        border-left: 4px solid var(--cool-steel);
    }
    
    /* File uploader */
    [data-testid="stFileUploader"] {
        border: 2px dashed var(--cool-steel);
        border-radius: 8px;
        background-color: var(--pale-sky);
    }
    
    /* Fix image flicker */
    img {
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
    }
    .stImage {
        animation: none !important;
    }
</style>
""", unsafe_allow_html=True)

def get_quality_color(level):
    if level == 0: return 'purple' # Cliente
    elif level == 1: return 'green' # Ouro
    elif level == 2: return 'blue' # Prata
    elif level == 3: return 'lightblue' # Bronze
    elif level == 4: return 'orange' # Ferro
    elif level == 5: return 'lightgray' # Pedra
    elif level == 6: return 'gray' # Concelho
    elif level == 7: return 'black' # Distrito
    else: return 'red' # Falha

def get_quality_label(level):
    if level == 0: return "👤 Nível 0 (Cliente)"
    elif level == 1: return "🥇 Nível 1 (Rua+Porta)"
    elif level == 2: return "🥈 Nível 2 (Rua+CP4)"
    elif level == 3: return "🥉 Nível 3 (CP7)"
    elif level == 4: return "🔩 Nível 4 (CP4)"
    elif level == 5: return "🪨 Nível 5 (Localidade)"
    elif level == 6: return "🏙️ Nível 6 (Concelho)"
    elif level == 7: return "🗺️ Nível 7 (Distrito)"
    else: return "❌ Nível 8 (Falha)"

def generate_kml(df):
    kml = simplekml.Kml()
    for _, row in df.iterrows():
        if pd.notna(row['Latitude']) and pd.notna(row['Longitude']):
            pnt = kml.newpoint(name=str(row.get('Morada_Encontrada', 'Point')))
            pnt.coords = [(row['Longitude'], row['Latitude'])]
            pnt.description = f"Nível: {row['Nivel_Qualidade']} ({row['Fonte_Match']})"
    return kml.kml()

def find_column_index(columns, keywords):
    """
    Find the index of a column that matches any of the keywords.
    Uses exact matching first, then partial matching with strict validation.
    """
    lower_cols = [c.lower() for c in columns]
    
    # First pass: exact match (whole word)
    for i, col in enumerate(lower_cols):
        for kw in keywords:
            if col == kw:  # Exact match
                return i
    
    # Second pass: starts with keyword (with validation)
    for i, col in enumerate(lower_cols):
        for kw in keywords:
            # Avoid false positives like "codigo_cliente" when looking for "codigo_postal"
            if col.startswith(kw):
                # Extra validation: if looking for postal/cp, reject if contains 'cliente'
                if kw in ['cp', 'postal', 'codigo_postal'] and 'cliente' in col:
                    continue
                return i
    
    # Third pass: contains keyword (strict validation to avoid false positives)
    for i, col in enumerate(lower_cols):
        for kw in keywords:
            if kw in col:
                # Reject if contains 'cliente' when looking for postal codes
                if kw in ['cp', 'postal', 'codigo_postal'] and 'cliente' in col:
                    continue
                return i
    
    return 0

# --- CORE LOGIC ---

def render_debug_page():
    st.header("🔧 Debug Geocoding")
    st.markdown("Teste o motor de geocoding passo-a-passo para um único endereço.")
    
    c1, c2, c3 = st.columns(3)
    d_addr = c1.text_input("Morada")
    d_cp4 = c2.text_input("CP4 (Ex: 2750)")
    d_concelho = c3.text_input("Concelho")
    
    if st.button("🔍 Testar Motor"):
        api_key = st.session_state.get('google_api_key')
        geocoder = WaterfallGeocoder(DB_FILE, google_api_key=api_key)
        
        st.markdown("### 1. Smart Cleaning")
        clean_addr = geocoder._clean_address(d_addr)
        st.code(f"Original: '{d_addr}' -> Limpo: '{clean_addr}'")
        
        st.markdown("### 2. Teste Local (DB)")
        start = time.time()
        res_local = geocoder._try_local(clean_addr, d_cp4, d_concelho)
        dur = time.time() - start
        st.write(f"Tempo: {dur:.4f}s")
        if res_local:
            st.success(f"Encontrado! Nível {res_local['quality_level']} ({res_local['match_type']})")
            st.json(res_local)
        else:
            st.error("Não encontrado na DB Local.")

        st.markdown("### 2.5. Teste Web Scraper (CP7)")
        if d_cp4 and len(d_cp4) == 8 and '-' in d_cp4:
            start = time.time()
            cp4_part, cp3_part = d_cp4.split('-')
            res_web = geocoder._try_web_scraper(cp4_part, cp3_part)
            dur = time.time() - start
            st.write(f"Tempo: {dur:.4f}s")
            if res_web:
                st.success(f"Encontrado! Nível {res_web['quality_level']} ({res_web['match_type']})")
                st.json(res_web)
            else:
                st.warning("Não encontrado pelo Scraper.")
        else:
            st.info("Insira um CP7 válido (xxxx-xxx) para testar o Scraper.")
            
        st.markdown("### 3. Teste OSM (Nominatim)")
        start = time.time()
        res_osm = geocoder._try_nominatim(clean_addr, d_cp4, d_concelho)
        dur = time.time() - start
        st.write(f"Tempo: {dur:.4f}s")
        if res_osm:
            st.success(f"Encontrado! Nível {res_osm['quality_level']} ({res_osm['match_type']})")
            st.json(res_osm)
        else:
            st.warning("Não encontrado no OSM.")

def render_main_app():
    st.title("Geocoding App Pro 🚀")
    
    uploaded_file = st.file_uploader("Carregar Excel com Moradas", type=['xlsx'])
    
    if uploaded_file:
        df = pd.read_excel(uploaded_file)
        st.write(f"Carregadas {len(df)} linhas.")
        
        # Column Mapping
        cols = df.columns.tolist()
        c1, c2, c3 = st.columns(3)
        col_addr = c1.selectbox("Coluna Morada", cols, index=find_column_index(cols, ['morada', 'address', 'rua']))
        col_cp = c2.selectbox("Coluna CP", cols, index=find_column_index(cols, ['codigo_postal', 'cp', 'postal']))
        col_city = c3.selectbox("Coluna Concelho/Cidade", cols, index=find_column_index(cols, ['concelho', 'cidade', 'localidade']))
        
        # Show performance stats before geocoding
        geo_stats = get_geocoding_stats()
        
        # Create button and stats side by side
        btn_col, stats_col = st.columns([1, 2])
        
        with btn_col:
            start_geocoding = st.button("🚀 Iniciar Geocoding")
        
        with stats_col:
            if geo_stats['total_sessoes'] > 0:
                # Calculate time per 100 clients
                tempo_por_100 = (geo_stats['tempo_medio_segundos'] / geo_stats['total_enderecos']) * 100 if geo_stats['total_enderecos'] > 0 else 0
                tempo_min_100 = tempo_por_100 / 60
                
                st.info(f"⏱️ **Estimativa:** ~{tempo_min_100:.1f} min/100 clientes | "
                       f"📊 {geo_stats['total_sessoes']} sessões | "
                       f"{geo_stats['total_enderecos']} endereços processados")
            else:
                st.info("ℹ️ Primeira sessão - sem estatísticas ainda")
        
        if start_geocoding:
            api_key = st.session_state.get('google_api_key')
            geocoder = WaterfallGeocoder(DB_FILE, google_api_key=api_key)
            
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
                st.session_state['learned_count'] = learned_count
                
            total_time = time.time() - start_time
            minutes = int(total_time // 60)
            seconds = int(total_time % 60)
            time_str = f"{minutes}m {seconds}s"
            
            st.success(f"Concluído em {time_str}!")
            status_text.text(f"Processo terminado em {time_str}.")
            
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
            
            # ===== FAILURE HANDLING LOGIC =====
            # Check if there are any failures (nivel 8)
            if falhas > 0:
                # Import here to avoid caching issues
                from utils.failure_handler import GeocodingFailureHandler
                
                # Analyze failures
                geocoding_results_list = []
                for _, row in df_res.iterrows():
                    geocoding_results_list.append({
                        'lat': row.get('Latitude'),
                        'lon': row.get('Longitude'),
                        'nivel': row.get('Nivel_Qualidade', 8),
                        'morada_encontrada': row.get('Morada_Encontrada', ''),
                        'fonte': row.get('Fonte_Match', 'FALHA'),
                        'score': row.get('Score_Match', 0)
                    })
                
                failure_report = GeocodingFailureHandler.analyze_failures(df, geocoding_results_list)
                
                # Show failure modal
                with st.expander("⚠️ ATENÇÃO: Geocoding Incompleto", expanded=True):
                    st.warning(f"""
                    **Foram geocodificados com sucesso:** {failure_report.success}/{failure_report.total} clientes ({failure_report.success_rate:.1f}%)  
                    **Falharam:** {failure_report.failures} clientes ({failure_report.failure_rate:.1f}%) - Nível 8
                    """)
                    
                    # Show failure reasons
                    if failure_report.failure_reasons:
                        st.markdown("**Motivos das falhas:**")
                        for reason, count in failure_report.failure_reasons.items():
                            st.markdown(f"• {count} cliente(s): {reason}")
                    
                    # Show failure details table
                    with st.expander("📋 Ver detalhes dos clientes falhados"):
                        display_cols = ['Codigo_Cliente', 'Morada', 'Codigo_Postal', 'Concelho', 'Motivo_Falha']
                        available_cols = [c for c in display_cols if c in failure_report.failure_details.columns]
                        st.dataframe(failure_report.failure_details[available_cols], use_container_width=True)
                    
                    st.markdown("---")
                    st.markdown("### O que pretende fazer?")
                    
                    # Three decision buttons
                    col1, col2, col3 = st.columns(3)
                    
                    with col1:
                        st.markdown("#### 🔴 Opção 1: Cancelar e Exportar")
                        st.caption("Exportar ficheiros e corrigir dados offline")
                        if st.button("Cancelar e Exportar Ficheiros", use_container_width=True, key="option_1"):
                            # Mark that we want to export
                            st.session_state['export_mode'] = True
                        
                        # Show download buttons if export mode is active
                        if st.session_state.get('export_mode', False):
                            # Export success file
                            success_file = GeocodingFailureHandler.export_success_file(df, geocoding_results_list)
                            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                            
                            st.download_button(
                                label="📥 Download Clientes Geocodificados",
                                data=success_file,
                                file_name=f"geocodificados_sucesso_{timestamp}.xlsx",
                                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                key="download_success",
                                use_container_width=True
                            )
                            
                            # Export failure file
                            failure_file = GeocodingFailureHandler.export_failure_file(df, geocoding_results_list)
                            
                            st.download_button(
                                label="📥 Download Clientes Falhados",
                                data=failure_file,
                                file_name=f"geocodificados_falhas_{timestamp}.xlsx",
                                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                key="download_failures",
                                use_container_width=True
                            )
                            
                            st.success("✅ Ficheiros prontos para download!")
                            st.info("💡 Após fazer download, clique em 'Reiniciar Processo' para voltar ao início.")
                            
                            # Option to reset AFTER downloading
                            if st.button("🔄 Reiniciar Processo", use_container_width=True, key="reset_after_export"):
                                # Clear session state
                                for key in ['geocoded_df', 'processing_time', 'learned_count', 'export_mode']:
                                    if key in st.session_state:
                                        del st.session_state[key]
                                st.rerun()
                    
                    with col2:
                        st.markdown("#### 🟡 Opção 2: Continuar com Limitações")
                        st.caption("Atribuir coordenadas do armazém aos falhados")
                        if st.button("Continuar Mesmo Assim", use_container_width=True, key="option_2"):
                            # Mark that we're continuing with failures
                            st.session_state['continue_with_failures'] = True
                            st.session_state['geocoded_df'] = df_res
                            st.session_state['processing_time'] = time_str
                            st.success("✅ A continuar com limitações. Os clientes não geocodificados serão marcados separadamente.")
                            st.rerun()
                    
                    with col3:
                        st.markdown("#### 🟢 Opção 3: Corrigir Agora")
                        st.caption("Interface para correção manual assistida")
                        if st.button("Corrigir Manualmente", use_container_width=True, key="option_3"):
                            st.session_state['manual_correction_mode'] = True
                            st.session_state['failed_clients'] = failure_report.failure_details
                            st.session_state['original_df'] = df
                            st.session_state['geocoding_results'] = geocoding_results_list
                            st.rerun()
                
                # Stop here - don't store in session until user decides
                st.stop()
            
            # If no failures, continue normally
            st.session_state['geocoded_df'] = df_res
            st.session_state['processing_time'] = time_str
            
        # Handle manual correction mode
        if st.session_state.get('manual_correction_mode', False):
            # Import here to avoid caching issues
            from components.manual_correction_ui import ManualCorrectionUI
            
            api_key = st.session_state.get('google_api_key')
            geocoder = WaterfallGeocoder(DB_FILE, google_api_key=api_key)
            correction_ui = ManualCorrectionUI(geocoder)
            
            corrections_complete, corrected_results = correction_ui.show_correction_interface(
                st.session_state['failed_clients']
            )
            
            if corrections_complete:
                # Merge corrected results with original successful results
                original_results = st.session_state.get('geocoding_results', [])
                
                # Update the dataframe with corrected results
                df_original = st.session_state.get('original_df')
                
                # Rebuild results with corrections
                # This is a simplified merge - in production you'd want more robust matching
                st.success("✅ Correções aplicadas! A continuar para otimização...")
                
                # Clear correction mode
                st.session_state['manual_correction_mode'] = False
                ManualCorrectionUI.reset_correction_state()
                
                # TODO: Properly merge corrected results back into df_res
                # For now, just continue with what we have
                st.rerun()
            
            # Stop here while in correction mode
            st.stop()
            
    if 'geocoded_df' in st.session_state:
        df_res = st.session_state['geocoded_df']
        
        # Display processing time and learning info
        info_cols = st.columns(2)
        if 'processing_time' in st.session_state:
            info_cols[0].info(f"⏱️ Tempo de processamento: {st.session_state['processing_time']}")
        if 'learned_count' in st.session_state and st.session_state['learned_count'] > 0:
            info_cols[1].success(f"🧠 O sistema aprendeu {st.session_state['learned_count']} novos endereços!")
        
        # Stats and Map side by side
        st.markdown("### Resultados")
        col_stats, col_map = st.columns([1, 1], gap="medium")
        
        with col_stats:
            st.markdown("#### Estatísticas")
            stats = df_res['Nivel_Qualidade'].value_counts().sort_index()
            
            # Metrics in compact layout
            m1, m2, m3, m4 = st.columns(4)
            m1.metric("Total", len(df_res))
            m2.metric("Sucesso", len(df_res[df_res['Nivel_Qualidade'] <= 2]))
            m3.metric("Médio", len(df_res[(df_res['Nivel_Qualidade'] >= 4) & (df_res['Nivel_Qualidade'] <= 5)]))
            m4.metric("Falhas", len(df_res[df_res['Nivel_Qualidade'] == 8]))
            
            # Compact table with card styling
            st.markdown("""
            <style>
            div[data-testid="stDataFrame"] {
                background-color: #CDE6F5;
                padding: 15px;
                border-radius: 10px;
                border-left: 4px solid #8DA7BE;
            }
            </style>
            """, unsafe_allow_html=True)
            
            st.dataframe(stats.rename("Qtd"), height=200, use_container_width=True)
            
            # Geocoding stats
            st.markdown("#### Histórico")
            geo_stats = get_geocoding_stats()
            if geo_stats['total_sessoes'] > 0:
                # Calculate time per 100 clients
                tempo_por_100 = (geo_stats['tempo_medio_segundos'] / geo_stats['total_enderecos']) * 100 if geo_stats['total_enderecos'] > 0 else 0
                tempo_min_100 = tempo_por_100 / 60
                st.info(f"📊 **{geo_stats['total_sessoes']}** sessões | "
                       f"**{geo_stats['total_enderecos']}** endereços | "
                       f"Média: **{tempo_min_100:.1f}min/100 clientes**")
        
        with col_map:
            st.markdown("#### Mapa")
            m = folium.Map(location=[39.5, -8.0], zoom_start=7)
            
            for _, row in df_res.iterrows():
                if pd.notna(row['Latitude']):
                    nivel = row['Nivel_Qualidade']
                    
                    # Special handling for nivel 8 (failures)
                    if nivel == 8:
                        # Red warning marker for failed geocoding
                        folium.Marker(
                            location=(row['Latitude'], row['Longitude']),
                            popup=f"⚠️ {row.get('Codigo_Cliente', 'Cliente')} - FALHA DE GEOCODING",
                            tooltip=f"⚠️ Localização Aproximada - {row.get('Morada', 'N/A')}",
                            icon=folium.Icon(color='red', icon='exclamation-triangle', prefix='fa')
                        ).add_to(m)
                    else:
                        # Normal circle markers for successful geocoding
                        color = ['red','green','blue','cyan','orange','gray','purple','black'][min(nivel, 7)]
                        folium.CircleMarker(
                            location=(row['Latitude'], row['Longitude']),
                            radius=5,
                            color=color,
                            fill=True,
                            fill_color=color,
                            popup=f"{row['Morada_Encontrada']} (Nível {nivel})",
                            tooltip=f"Nível {nivel} - {row.get('Fonte_Match', 'N/A')}"
                        ).add_to(m)
            
            
            # Render map only once inside the column
            st_folium(m, width=None, height=400, key="results_map")
        
        # Detailed Results Table
        st.markdown("---")
        st.markdown("### 📋 Detalhes dos Endereços Processados")
        
        # Add filter for quality levels
        filter_col1, filter_col2 = st.columns([3, 1])
        with filter_col1:
            show_filter = st.multiselect(
                "Filtrar por Nível de Qualidade",
                options=[1, 2, 4, 5, 8],
                default=[1, 2, 4, 5, 8],
                help="Selecione os níveis que deseja visualizar. Nível 8 = Falhas"
            )
        with filter_col2:
            show_only_failures = st.checkbox("Apenas Falhas (Nível 8)", value=False)
        
        # Apply filter
        if show_only_failures:
            df_filtered = df_res[df_res['Nivel_Qualidade'] == 8]
        else:
            df_filtered = df_res[df_res['Nivel_Qualidade'].isin(show_filter)]
        
        # Display count
        st.info(f"📊 Mostrando **{len(df_filtered)}** de **{len(df_res)}** endereços")
        
        # Get available columns
        available_cols = df_filtered.columns.tolist()
        
        # Select columns to display (only if they exist)
        display_cols = []
        for col in ['Morada', 'Morada_Encontrada', 'Latitude', 'Longitude', 'Nivel_Qualidade', 'Fonte_Match']:
            if col in available_cols:
                display_cols.append(col)
        
        # If no specific columns found, show first 6 columns
        if not display_cols:
            display_cols = available_cols[:6]
        
        # Display table with color coding
        st.dataframe(
            df_filtered[display_cols].style.apply(
                lambda row: ['background-color: #ffcccc' if row['Nivel_Qualidade'] == 8 
                            else 'background-color: #ccffcc' if row['Nivel_Qualidade'] <= 2
                            else 'background-color: #ffffcc' for _ in row],
                axis=1
            ),
            use_container_width=True,
            height=400
        )

        
        # Optimization Section
        st.markdown("---")
        st.markdown("### 🚚 Otimização de Rotas")
        
        # Fleet Configuration
        st.markdown("##### Configuração da Frota")
        
        # Initialize default fleet if not exists
        if 'fleet_config' not in st.session_state:
            st.session_state['fleet_config'] = pd.DataFrame({
                'Veiculo': ['Veículo 1', 'Veículo 2', 'Veículo 3'],
                'Capacidade_KG': [500, 750, 1000],
                'Custo_KM': [0.50, 0.60, 0.70],
                'Velocidade_Media': [40, 40, 40],
                'Horario_Inicio': ['08:00', '08:00', '08:00'],
                'Horario_Fim': ['18:00', '18:00', '18:00']
            })
        
        # Fleet Import Option
        with st.expander("📂 Importar Frota de Excel"):
            # Clear file uploader if import was successful
            if 'fleet_imported' in st.session_state and st.session_state['fleet_imported']:
                st.success("✅ Frota importada com sucesso! Pode editar abaixo.")
                if st.button("🔄 Importar Nova Frota"):
                    st.session_state['fleet_imported'] = False
                    st.rerun()
            else:
                fleet_file = st.file_uploader("Carregar ficheiro de frota", type=['xlsx'], key='fleet_upload')
                if fleet_file:
                    try:
                        from utils.template_manager import validate_fleet_file, FLEET_COLUMNS
                        df_fleet = pd.read_excel(fleet_file)
                        
                        # Validate
                        is_valid, msg = validate_fleet_file(df_fleet)
                        if is_valid:
                            # Map to internal format (match template exactly)
                            fleet_mapped = pd.DataFrame({
                                'Veiculo': df_fleet['Veiculo'],
                                'Capacidade_KG': df_fleet['Capacidade_KG'],
                                'Custo_KM': df_fleet['Custo_KM'],
                                'Velocidade_Media': df_fleet['Velocidade_Media'],
                                'Horario_Inicio': df_fleet['Horario_Inicio'],
                                'Horario_Fim': df_fleet['Horario_Fim']
                            })
                            st.session_state['fleet_config'] = fleet_mapped
                            st.session_state['fleet_imported'] = True
                            st.rerun()
                        else:
                            st.error(f"❌ {msg}")
                    except Exception as e:
                        st.error(f"Erro ao importar: {str(e)}")
        
        # Editable Fleet Table
        edited_fleet = st.data_editor(
            st.session_state['fleet_config'],
            num_rows="dynamic",
            use_container_width=True,
            hide_index=True
        )
        
        # Update session state
        st.session_state['fleet_config'] = edited_fleet
        num_vehicles = len(edited_fleet)
        
        # Depot Selection
        st.markdown("##### Localização do Armazém")
        depot_method = st.radio("Definir Armazém por:", ["Coordenadas", "Pesquisa de Morada", "Selecionar no Mapa"], horizontal=True)
        
        # Default/Current Values
        d_lat = st.session_state.get('depot_lat', 38.736946)
        d_lon = st.session_state.get('depot_lon', -9.142685)

        if depot_method == "Pesquisa de Morada":
            depot_search = st.text_input("Pesquisar Morada do Armazém")
            if st.button("📍 Encontrar Armazém"):
                api_key = st.session_state.get('google_api_key')
                geocoder = WaterfallGeocoder(DB_FILE, google_api_key=api_key)
                d_res, _ = geocoder.resolve_address(depot_search)
                if d_res and d_res['lat']:
                    st.session_state['depot_lat'] = d_res['lat']
                    st.session_state['depot_lon'] = d_res['lon']
                    st.rerun() # Refresh to update values
                else:
                    st.error("Morada não encontrada.")
        
        elif depot_method == "Selecionar no Mapa":
            with st.expander("🗺️ Mapa Interativo", expanded=True):
                st.info("Clique no mapa para definir a localização do armazém.")
                m_depot = folium.Map(location=[d_lat, d_lon], zoom_start=13)
                folium.Marker([d_lat, d_lon], popup="Armazém Atual", icon=folium.Icon(color='red', icon='home')).add_to(m_depot)
                
                # Capture clicks
                map_data = st_folium(m_depot, height=400, width=700, key="depot_map")
                
                if map_data and map_data.get("last_clicked"):
                    clicked = map_data["last_clicked"]
                    st.session_state['depot_lat'] = clicked['lat']
                    st.session_state['depot_lon'] = clicked['lng']
                    st.success(f"Localização definida: {clicked['lat']:.5f}, {clicked['lng']:.5f}")
        
        # Update d_lat/d_lon from session state again in case they changed
        d_lat = st.session_state.get('depot_lat', 38.736946)
        d_lon = st.session_state.get('depot_lon', -9.142685)
        
        c_lat, c_lon = st.columns(2)
        depot_lat = c_lat.number_input("Latitude", value=float(d_lat), format="%.6f")
        depot_lon = c_lon.number_input("Longitude", value=float(d_lon), format="%.6f")
        
        if st.button("🛠️ Otimizar Rotas"):
            # Filter valid coordinates AND exclude nivel 8 (failed geocoding)
            valid_df = df_res.dropna(subset=['Latitude', 'Longitude'])
            
            # Separate nivel 8 (failed) from valid clients
            failed_df = valid_df[valid_df['Nivel_Qualidade'] == 8]
            optimizable_df = valid_df[valid_df['Nivel_Qualidade'] < 8]
            
            if len(optimizable_df) == 0:
                st.error("Não há coordenadas válidas para otimizar (todos os clientes falharam geocoding).")
            else:
                # Show warning if there are failed clients
                if len(failed_df) > 0:
                    st.warning(f"⚠️ {len(failed_df)} cliente(s) com geocoding falhado serão colocados numa rota separada não otimizada.")
                
                # Prepare Data for Solver (only optimizable clients)
                locations = [(depot_lat, depot_lon)]
                for _, row in optimizable_df.iterrows():
                    locations.append((row['Latitude'], row['Longitude']))
                
                # Calculate Distance Matrix
                st.info("📊 Calculando distâncias reais (Haversine)...")
                dist_matrix = calculate_haversine_matrix(locations)
                
                fleet_costs = edited_fleet['Custo_KM'].fillna(0.50)
                avg_cost_per_km = fleet_costs.mean() if len(fleet_costs) > 0 else 0.50
                
                optimizer = RouteOptimizer()
                solution = optimizer.solve_vrp(dist_matrix, num_vehicles, depot_index=0)
                
                total_distance_km = solution['total_distance']
                avg_speed_kmh = 40
                total_time_hours = total_distance_km / avg_speed_kmh
                total_cost = total_distance_km * avg_cost_per_km
                
                # Add special route for failed geocoding if any
                if len(failed_df) > 0:
                    from utils.failure_handler import GeocodingFailureHandler
                    special_route = GeocodingFailureHandler.create_warehouse_fallback_route(
                        failed_df, (depot_lat, depot_lon)
                    )
                    st.session_state['special_route'] = special_route
                    st.session_state['failed_clients_count'] = len(failed_df)
                
                # Display metrics
                st.markdown("### 🎯 Análise da Solução")
                
                if len(failed_df) > 0:
                    st.warning(f"""
                    ⚠️ **Rota Especial Criada**: {len(failed_df)} cliente(s) não geocodificados foram colocados numa rota separada.
                    Esta rota usa coordenadas aproximadas (armazém) e **não foi otimizada**.
                    """)
                
                col1, col2, col3, col4 = st.columns(4)
                col1.metric("Distância Total", f"{total_distance_km:.1f} km")
                col2.metric("Tempo Estimado", f"{total_time_hours:.1f}h")
                col3.metric("Custo Total", f"{total_cost:.2f}€")
                col4.metric("Veículos", num_vehicles)
                
                # Per-vehicle metrics
                st.markdown("#### Detalhes por Veículo")
                for v_idx, route_indices in enumerate(solution['routes']):
                    if len(route_indices) > 1:
                        route_dist = 0
                        for i in range(len(route_indices) - 1):
                            route_dist += dist_matrix[route_indices[i]][route_indices[i+1]]
                        
                        stops = len(route_indices) - 1
                        route_time = route_dist / avg_speed_kmh
                        
                        vehicle_cost_per_km = edited_fleet.iloc[v_idx]['Custo_KM']
                        if pd.isna(vehicle_cost_per_km):
                            vehicle_cost_per_km = 0.50
                        route_cost = route_dist * vehicle_cost_per_km
                        
                        if 'Veiculo' in edited_fleet.columns:
                            vehicle_name = edited_fleet.iloc[v_idx]['Veiculo']
                        else:
                            vehicle_name = f"Veículo {v_idx + 1}"
                        
                        with st.expander(f"🚗 {vehicle_name} - {stops} paragens"):
                            c1, c2, c3 = st.columns(3)
                            c1.metric("Distância", f"{route_dist:.1f} km")
                            c2.metric("Tempo", f"{route_time:.1f}h")
                            c3.metric("Custo", f"{route_cost:.2f}€")
                
                # Show special route if exists
                if len(failed_df) > 0:
                    with st.expander(f"⚠️ Entregas Pendentes de Validação - {len(failed_df)} paragens", expanded=True):
                        st.error("""
                        **ATENÇÃO**: Esta rota contém clientes que não foram geocodificados corretamente.
                        - Coordenadas são aproximadas (localização do armazém)
                        - Distâncias e tempos NÃO são reais
                        - Esta rota NÃO foi otimizada
                        - Requer planeamento manual
                        """)
                        
                        st.dataframe(
                            failed_df[['Codigo_Cliente', 'Morada', 'Codigo_Postal', 'Concelho']],
                            use_container_width=True
                        )
                
                # Generate standalone HTML map
                html_map_path = generate_route_map_html(
                    locations, depot_lat, depot_lon, solution, 
                    edited_fleet, dist_matrix
                )
                
                # Generate detailed schedule
                html_schedule_path = generate_route_schedule_html(
                    solution, locations, optimizable_df, edited_fleet, 
                    dist_matrix, depot_lat, depot_lon
                )
                
                # Save to session state
                st.session_state['route_map_html'] = html_map_path
                st.session_state['route_schedule_html'] = html_schedule_path
                st.session_state['route_solution'] = solution
                st.session_state['route_locations'] = locations
                st.session_state['route_valid_df'] = optimizable_df
                
        # Buttons to open visualizations
        if 'route_map_html' in st.session_state:
            st.markdown("### 🗺️ Visualização de Rotas")
            col1, col2, col3 = st.columns([1, 1, 2])
            with col1:
                if st.button("🌍 Abrir Mapa", use_container_width=True):
                    open_route_map_in_browser(st.session_state['route_map_html'])
                    st.success("Mapa aberto!")
            with col2:
                if st.button("📋 Ver Horários", use_container_width=True):
                    open_route_schedule_in_browser(st.session_state['route_schedule_html'])
                    st.success("Horários abertos!")
            with col3:
                st.info("💡 Ambos abrem em janelas separadas do browser!")
            
            # Export
            if 'route_solution' in st.session_state:
                excel_data = generate_route_excel(
                    st.session_state['route_solution'], 
                    st.session_state['route_locations'], 
                    st.session_state['route_valid_df']
                )
                st.download_button(
                    label="📥 Descarregar Folhas de Rota (Excel)",
                    data=excel_data,
                    file_name="Rotas_Otimizadas.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                )

def main():
    # Initialize session state for phases
    if 'current_phase' not in st.session_state:
        st.session_state['current_phase'] = 1
    
    # Import phase components
    from components.phase_navigator import PhaseNavigator
    from components.phase1_georeferencing import Phase1Georeferencing
    from components.phase2_fleet_warehouses import Phase2FleetWarehouses
    from components.phase3_planning import Phase3Planning
    
    # Render phase navigator in sidebar
    PhaseNavigator.render_sidebar()
    
    # Render current phase
    current_phase = st.session_state['current_phase']
    
    if current_phase == 1:
        Phase1Georeferencing.render()
    elif current_phase == 2:
        Phase2FleetWarehouses.render()
    elif current_phase == 3:
        Phase3Planning.render()
    
    # --- SIDEBAR EXTRAS ---
    render_sidebar_extras()


def render_sidebar_extras():
    """Render additional sidebar content (templates, Google config, etc.)"""
    
    # --- TEMPLATES ---
    st.sidebar.markdown("---")
    st.sidebar.header("📁 Gestão de Templates")
    
    from utils.template_manager import (
        create_deliveries_template, create_fleet_warehouses_template,
        generate_random_deliveries, generate_random_fleet
    )
    
    # ===== SECTION 1: Empty Templates =====
    st.sidebar.markdown("### 📋 Templates Vazios")
    st.sidebar.caption("Para começar do zero com os seus próprios dados")
    
    col1, col2 = st.sidebar.columns(2)
    
    with col1:
        st.download_button(
            label="📥 Entregas",
            data=create_deliveries_template(),
            file_name="Template_Entregas.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            key="download_deliveries_template",
            help="Template vazio para preencher com as suas entregas"
        )
    
    with col2:
        st.download_button(
            label="📥 Frota",
            data=create_fleet_warehouses_template(),
            file_name="Template_Frota_Armazens.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            key="download_fleet_warehouses_template",
            help="Template vazio para configurar frota e armazéns"
        )
    
    # ===== SECTION 2: Test Data Generation =====
    st.sidebar.markdown("---")
    st.sidebar.markdown("### 🎲 Gerar Dados de Teste")
    st.sidebar.caption("Ficheiros de exemplo para testar o sistema")
    
    # Configuration for test data
    with st.sidebar.expander("⚙️ Configurar Dados de Teste", expanded=False):
        n_deliveries = st.number_input(
            "Nº Entregas",
            min_value=10,
            max_value=500,
            value=50,
            step=10,
            help="Quantidade de entregas a gerar"
        )
        
        quality_levels = st.multiselect(
            "Níveis de Qualidade",
            options=[1, 2, 3, 4, 5, 6, 7],
            default=[1, 2, 3, 4, 5],
            help="Filtrar moradas por nível de qualidade (1=melhor, 7=pior)"
        )
        
        n_vehicles = st.slider(
            "Nº Veículos", 
            min_value=3, 
            max_value=10, 
            value=5,
            help="Quantidade de veículos na frota de teste"
        )
    
    # Generate buttons
    col1, col2 = st.sidebar.columns(2)
    
    with col1:
        if st.button("🎲 Entregas", use_container_width=True, help="Gerar ficheiro de entregas aleatórias"):
            try:
                if not quality_levels:
                    st.sidebar.warning("⚠️ Selecione pelo menos 1 nível de qualidade!")
                else:
                    random_deliveries = generate_random_deliveries(n_deliveries, quality_levels)
                    st.session_state['random_deliveries'] = random_deliveries
                    st.sidebar.success(f"✅ {n_deliveries} entregas geradas!")
            except Exception as e:
                st.sidebar.error(f"Erro: {str(e)}")
    
    with col2:
        if st.button("🎲 Frota", use_container_width=True, help="Gerar ficheiro de frota e armazéns aleatórios"):
            try:
                from utils.template_manager import generate_random_fleet_warehouses
                random_fleet = generate_random_fleet_warehouses(n_vehicles)
                st.session_state['random_fleet'] = random_fleet
                st.sidebar.success(f"✅ Frota gerada com {n_vehicles} veículos!")
            except Exception as e:
                st.sidebar.error(f"Erro: {str(e)}")
    
    # Download generated files
    if 'random_deliveries' in st.session_state:
        st.sidebar.download_button(
            label="📥 Download Entregas Geradas",
            data=st.session_state['random_deliveries'],
            file_name=f"Entregas_Teste_{n_deliveries}.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            help="Descarregar ficheiro de entregas de teste gerado"
        )
    
    if 'random_fleet' in st.session_state:
        st.sidebar.download_button(
            label="📥 Download Frota Gerada",
            data=st.session_state['random_fleet'],
            file_name=f"Frota_Armazens_Teste_{n_vehicles}v.xlsx",
            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            use_container_width=True,
            help="Descarregar ficheiro de frota de teste gerado"
        )
    
    # --- GOOGLE CONFIG ---
    st.sidebar.markdown("---")
    st.sidebar.header("⚙️ Configuração Google")
    
    # Try to load from secrets
    default_key = ""
    try:
        if "general" in st.secrets and "google_api_key" in st.secrets["general"]:
            default_key = st.secrets["general"]["google_api_key"]
    except FileNotFoundError:
        pass
    except Exception:
        pass

    api_key = st.sidebar.text_input(
        "Google Maps API Key",
        value=default_key,
        type="password",
        help="Insira a sua chave para ativar o geocoding de alta precisão."
    )
    
    if api_key:
        st.session_state['google_api_key'] = api_key
    
    # Usage Stats
    usage_file = 'config/usage.json'
    if os.path.exists(usage_file):
        try:
            with open(usage_file, 'r') as f:
                usage = json.load(f)
            
            count = usage.get('count', 0)
            limit = usage.get('limit', 1000)
            
            # Calculate percentage
            percent = min(count / limit, 1.0) if limit > 0 else 1.0
            
            # Determine color
            if percent < 0.5: bar_color = "green"
            elif percent < 0.8: bar_color = "orange"
            else: bar_color = "red"
            
            st.sidebar.markdown(f"### 📊 Orçamento Google")
            st.sidebar.markdown(f"**Usado:** {count} / {limit}")
            
            # Custom Progress Bar with Color
            st.sidebar.markdown(
                f"""
                <div style="background-color: #ddd; border-radius: 5px; height: 10px; width: 100%;">
                    <div style="background-color: {bar_color}; width: {percent*100}%; height: 100%; border-radius: 5px;"></div>
                </div>
                """, 
                unsafe_allow_html=True
            )
            
            # Credits Remaining
            remaining = limit - count
            st.sidebar.caption(f"Restam {remaining} créditos este mês.")
            
            if count >= limit:
                st.sidebar.error("⚠️ Limite Atingido! Google Maps desativado.")
            else:
                st.sidebar.success("✅ Google Maps Ativo")
                
        except Exception:
            st.sidebar.warning("Erro ao ler estatísticas de uso.")
    
    # --- RESET BUTTON ---
    st.sidebar.markdown("---")
    st.sidebar.header("🔄 Sistema")
    
    if st.sidebar.button("🔄 Reiniciar Aplicação", use_container_width=True, type="secondary"):
        # Clear all session state
        keys_to_clear = [
            'geocoded_df', 'processing_time', 'learned_count',
            'fleet_config', 'fleet_imported', 'depot_lat', 'depot_lon',
            'route_map_html', 'route_schedule_html', 'route_solution',
            'route_locations', 'route_valid_df', 'random_deliveries', 'random_fleet',
            'continue_with_failures', 'manual_correction_mode', 'failed_clients',
            'original_df', 'geocoding_results', 'corrections', 'current_correction_index',
            'corrected_results', 'clients_geocoded', 'clients_original_df',
            'warehouses', 'current_phase', 'phase_1_complete', 'phase_2_complete',
            'total_failed_count', 'temp_correction', 'route_distance_matrix', 'route_metrics'
        ]
        
        for key in keys_to_clear:
            if key in st.session_state:
                del st.session_state[key]
        
        st.sidebar.success("✅ Sistema reiniciado!")
        st.rerun()


if __name__ == "__main__":
    main()
