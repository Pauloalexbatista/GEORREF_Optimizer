"""
Phase Navigator Component
Manages navigation between the 3 main phases of the application.
"""

import streamlit as st


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
                st.session_state['current_phase'] = phase_num
                st.rerun()
        
        # Show phase description
        st.sidebar.markdown("---")
        PhaseNavigator._show_phase_description(current_phase)
    
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
            st.session_state['current_phase'] = phase_num
            return True
        return False
