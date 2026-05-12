"""
Phase Navigator Component
Manages navigation between the 3 main phases of the application.
"""

import streamlit as st
from utils.persistence_manager import (
    create_snapshot, get_snapshots_for_project, load_snapshot_into_session
)


class PhaseNavigator:
    """Manages navigation between the 3 main phases"""
    
    PHASES = {
        1: {"name": "📍 Georreferenciação", "icon": "📍"},
        2: {"name": "✅ Validação", "icon": "✅"},
        3: {"name": "🚚 Planeamento", "icon": "🚚"}
    }
    
    @staticmethod
    def render_sidebar():
        """Render phase navigation in sidebar"""
        st.sidebar.markdown("---")
        st.sidebar.markdown("### 🗺️ Fases do Processo")
        
        current_phase = st.session_state.get('current_phase', 1)
        
        for phase_num, phase_info in PhaseNavigator.PHASES.items():
            # Check if phase is unlocked
            is_unlocked = PhaseNavigator.is_phase_unlocked(phase_num)
            is_current = (phase_num == current_phase)
            
            # Visual indicator
            if is_current:
                prefix = "▶️"
            elif PhaseNavigator.is_phase_complete(phase_num):
                prefix = "✅"
            elif is_unlocked:
                prefix = "⭕"
            else:
                prefix = "🔒"
            
            # Button
            button_label = f"{prefix} {phase_info['name']}"
            
            if st.sidebar.button(
                button_label,
                disabled=not is_unlocked,
                use_container_width=True,
                key=f"nav_phase_{phase_num}"
            ):
                st.session_state['next_phase_queued'] = phase_num
                st.rerun()
        
        # Show phase description
        st.sidebar.markdown("---")
        PhaseNavigator._show_phase_description(current_phase)
        
        # New: Persistence & Snapshot Controls
        PhaseNavigator._render_persistence_controls()
    
    @staticmethod
    def _show_phase_description(phase_num):
        """Show description of current phase"""
        descriptions = {
            1: "**Georreferenciar** clientes e armazéns usando geocoding automático.",
            2: "**Validar e corrigir** manualmente os endereços que falharam.",
            3: "**Planear rotas** otimizadas com base nos dados validados."
        }
        
        if phase_num in descriptions:
            st.sidebar.info(descriptions[phase_num])
    
    @staticmethod
    def is_phase_unlocked(phase_num):
        """Check if a phase can be accessed"""
        if phase_num == 1:
            return True  # Always unlocked
        
        elif phase_num == 2:
            # Unlock if geocoding has been done
            return st.session_state.get('clients_geocoded') is not None
        
        elif phase_num == 3:
            # Unlock only if Phase 2 is complete (all clients geocoded successfully)
            return st.session_state.get('phase_2_complete', False)
        
        return False
    
    @staticmethod
    def is_phase_complete(phase_num):
        """Check if a phase is marked as complete"""
        return st.session_state.get(f'phase_{phase_num}_complete', False)
    
    @staticmethod
    def mark_phase_complete(phase_num):
        """Mark a phase as complete"""
        st.session_state[f'phase_{phase_num}_complete'] = True
    
    @staticmethod
    def get_current_phase():
        """Get the current active phase"""
        return st.session_state.get('current_phase', 1)
    
    @staticmethod
    def set_phase(phase_num):
        """Set the current phase"""
        if PhaseNavigator.is_phase_unlocked(phase_num):
            st.session_state['next_phase_queued'] = phase_num
            return True
        return False
        
    @staticmethod
    def _render_persistence_controls():
        """Renders Save and Load snapshot controls in the sidebar."""
        
        proj_id = st.session_state.get('projeto_atual')
        user_id = st.session_state.get('utilizador_id')
        current_fase = st.session_state.get('current_phase', 1)
        
        if not proj_id:
            return
            
        st.sidebar.markdown("---")
        st.sidebar.markdown("### 💾 Gestão de Sessão")
        
        # 1. Save Button
        if st.sidebar.button("📤 Guardar Progresso", key="btn_save_snapshot", use_container_width=True):
            with st.sidebar.spinner("A guardar..."):
                snap_id = create_snapshot(proj_id, user_id, current_fase)
                if snap_id:
                    st.sidebar.success("Snapshot guardado!")
                else:
                    st.sidebar.error("Falha ao guardar.")
                    
        # 2. Load Selector
        snapshots = get_snapshots_for_project(proj_id, limit=5)
        
        if snapshots:
            with st.sidebar.expander("📂 Recuperar Sessão", expanded=False):
                options = {row['id']: f"Fase {row['fase_atual']} ({row['created_at'][11:16]})" for row in snapshots}
                selected_snap = st.selectbox(
                    "Escolher ponto de restauro:",
                    options=list(options.keys()),
                    format_func=lambda x: options[x],
                    key="snap_restore_select"
                )
                
                if st.button("📥 Restaurar", key="btn_restore_snap", use_container_width=True):
                    if load_snapshot_into_session(selected_snap):
                        st.success("Sessão restaurada!")
                        st.rerun()
                    else:
                        st.error("Erro ao restaurar.")

    @staticmethod
    def render_snapshots_tab():
        """Renders full Gravações (Snapshots) experience as a full page tab content."""
        import streamlit as st
        from utils.persistence_manager import create_snapshot, get_snapshots_for_project, load_snapshot_into_session
        import pandas as pd
        
        proj_id = st.session_state.get('projeto_atual')
        user_id = st.session_state.get('utilizador_id')
        
        if not proj_id:
            st.warning("⚠️ Por favor, crie ou selecione um Projeto primeiro.")
            return
            
        st.markdown("## 💾 Gestão de Gravações")
        st.markdown("Guarde o progresso do seu planeamento ou recupere sessões de trabalho passadas.")
        
        col1, col2 = st.columns([1, 2])
        
        with col1:
            st.markdown("### 📤 Criar Nova Gravação")
            st.info("Guarda os clientes carregados, georreferenciação, frota e rotas atuais.")
            
            nome_snap = st.text_input("Nome da gravação (opcional)", placeholder="Ex: Manhã Segunda v1")
            
            if st.button("💾 Guardar Estado Atual", type="primary", use_container_width=True):
                with st.spinner("A gravar..."):
                    current_fase = st.session_state.get('current_phase', 1)
                    sid = create_snapshot(proj_id, user_id, current_fase, snapshot_name=nome_snap if nome_snap else None)
                    if sid:
                        st.success("✅ Gravado com sucesso na base de dados!")
                        st.rerun()
                    else:
                        st.error("❌ Falha ao gravar.")
        
        with col2:
            st.markdown("### 📂 Recuperar Histórico")
            snapshots = get_snapshots_for_project(proj_id, limit=20)
            
            if not snapshots:
                st.info("ℹ️ Ainda não existem gravações para este projeto.")
            else:
                st.markdown("##### 1. Selecione o registo que deseja na tabela:")
                
                # Format visually in a dataframe
                rows = []
                for s in snapshots:
                     rows.append({
                         "ID": s['id'],
                         "Data": s['created_at'],
                         "Etapa": f"Fase {s['fase_atual']}",
                         "Nome": s['nome_snapshot']
                     })
                
                df_snaps = pd.DataFrame(rows)
                
                # --- INTERACTIVE HIGH-PREMIUM DATAFRAME SELECTION ---
                # Replaces redundant selectbox. User clicks row -> interacts directly!
                selection_event = st.dataframe(
                    df_snaps,
                    hide_index=True,
                    use_container_width=True,
                    on_select="rerun", # Triggers rerun automatically upon click
                    selection_mode="single-row", # Limits to 1 selection
                    key="history_interactive_table"
                )
                
                # Check if user physically clicked a row in the table
                selected_indices = selection_event.get("selection", {}).get("rows", [])
                
                st.markdown("---")
                
                if len(selected_indices) > 0:
                    idx = selected_indices[0]
                    target_row = df_snaps.iloc[idx]
                    target_id = int(target_row["ID"])
                    target_nome = target_row["Nome"]
                    
                    st.markdown(f"##### 2. Confirmar Ação:")
                    st.info(f"🎯 **Selecionado:** ID #{target_id} — {target_nome}")
                    
                    if st.button(f"📥 Restaurar Agora: {target_nome}", type="primary", use_container_width=True, key="btn_restore_interactive"):
                        with st.spinner("A carregar estado da sessão..."):
                            if load_snapshot_into_session(target_id):
                                st.success("🎉 Sessão restaurada com sucesso!")
                                st.rerun()
                            else:
                                st.error("❌ Erro ao carregar sessão.")
                else:
                    st.warning("💡 **Dica:** Clique em cima de qualquer linha na tabela acima para a selecionar e ativar o botão de restauro!")

