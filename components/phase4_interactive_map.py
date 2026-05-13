import streamlit as st
import pandas as pd
from components.route_visualizer import RouteVisualizer
from components.phase3_planning import Phase3Planning

class Phase4InteractiveMap:
    @staticmethod
    def render():
        routes_df = st.session_state.get('routes_solution')
        warehouses_df = st.session_state.get('warehouses_used')
        
        if warehouses_df is None:
            warehouses_df = st.session_state.get('warehouses_geocoded')
            
        if routes_df is None:
            st.warning("⚠️ Calcule as rotas na Etapa 4 primeiro para aceder ao mapa interativo.")
            return
            
        # Top Header
        st.markdown("""
            <div style='background: linear-gradient(135deg, #8DA7BE 0%, #554640 100%); padding: 15px; border-radius: 8px; color: white; margin-bottom: 15px;'>
                <h2 style='color: white; margin: 0;'>🗺️ Mapa de Controlo Aéreo (Full-Screen)</h2>
                <span style='opacity: 0.9;'>Vista tática de todo o território com reatribuição de frota interativa.</span>
            </div>
        """, unsafe_allow_html=True)
        
        # --- DUAL MONITOR SYNC PROTOCOL ---
        st.markdown("### 🖥️ Sistema Multi-Monitor")
        col_sync1, col_sync2, col_sync3 = st.columns(3)
        
        with col_sync1:
            if st.button("🚀 1. Abrir Mapa Noutro Ecrã", use_container_width=True, help="Abre esta mesma interface numa janela nova para arrastares para o 2º monitor"):
                from utils.persistence_manager import create_snapshot
                snap_id = create_snapshot(st.session_state['projeto_atual'], st.session_state.get('utilizador_id', 1), 5, "SYNC_TRANSFER")
                st.markdown(f'<a href="/?snapshot_id={snap_id}" target="_blank" style="background:#554640; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; display:block; text-align:center; margin-top:10px; font-weight:bold;">👉 Clica aqui para Abrir Nova Janela</a>', unsafe_allow_html=True)
                
        with col_sync2:
            if st.button("💾 2. Enviar Edições para Principal", use_container_width=True, type="primary", help="Clica aqui no teu 2º monitor após fazeres edições"):
                from utils.persistence_manager import create_snapshot
                create_snapshot(st.session_state['projeto_atual'], st.session_state.get('utilizador_id', 1), 5, "SYNC_BACK")
                st.success("✅ Alterações enviadas! Vai à janela principal e clica em 'Receber'")
                
        with col_sync3:
            if st.button("🔄 3. Receber Edições do 2º Ecrã", use_container_width=True, help="Clica aqui na tua janela principal para atualizar o sistema"):
                from utils.persistence_manager import get_snapshots_for_project, load_snapshot_into_session
                snaps = get_snapshots_for_project(st.session_state['projeto_atual'], limit=20)
                sync_back_snaps = [s for s in snaps if s['nome_snapshot'] == "SYNC_BACK"]
                if sync_back_snaps:
                    latest_snap_id = sync_back_snaps[0]['id']
                    if load_snapshot_into_session(latest_snap_id):
                        st.success("✅ Sistema atualizado com as edições do Mapa!")
                        st.rerun()
                else:
                    st.warning("⚠️ Não foram encontradas edições pendentes do 2º ecrã.")
                    
        st.markdown("---")
        
        # Dual layout: Narrow control panel (1.2) and Huge Map (3.8)
        col_ctrl, col_map = st.columns([1.2, 3.8], gap="medium")
        
        with col_ctrl:
            st.markdown("### 🎛️ Painel Tático")
            
            # Reassignment Commander at the top for easy access
            Phase3Planning._render_commander_deck(routes_df)
            
            st.markdown("---")
            
            # Quick route selector
            selected_routes = RouteVisualizer.render_route_selector(routes_df)
            
            st.markdown("---")
            
            # Simple metrics
            RouteVisualizer.render_route_metrics(routes_df, selected_routes)
            
        with col_map:
            # Huge Interactive Map
            map_output = RouteVisualizer.render_interactive_map(routes_df, selected_routes, warehouses_df, height=750)
            
        # Register map clicks using Phase3's robust telemetry processor
        # This allows clicking a marker on the map to auto-fill the Commander Deck!
        Phase3Planning._process_telemetry_to_state(map_output, routes_df)
