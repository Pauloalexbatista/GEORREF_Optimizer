"""
Typed Session State Contract for GeoRoute Pro
Defines the canonical structure of st.session_state to eliminate magic strings
and provide type safety across phases.
"""

try:
    import streamlit as st
except ImportError:
    st = None

from dataclasses import dataclass, field
from typing import Optional, Dict
import pandas as pd
from datetime import datetime


@dataclass
class FleetVehicle:
    """Configuration for a single vehicle in the fleet."""
    capacidade_kg: float
    capacidade_vol: float
    custo_km: float
    velocidade_media: float
    horario_inicio: str
    horario_fim: str
    armazem: str


@dataclass
class AppState:
    """
    Canonical application state. All phase components should read/write
    exclusively through this structured state to avoid key collisions and
    ensure data integrity.
    """
    
    # ========== AUTHENTICATION ==========
    logged_in: bool = False
    utilizador_id: Optional[int] = None
    utilizador_nome: Optional[str] = None
    utilizador_email: Optional[str] = None
    empresa_id: Optional[int] = None
    empresa_nome: Optional[str] = None
    is_admin: bool = False
    
    # ========== PROJECT CONTEXT ==========
    projeto_atual: Optional[int] = None
    projeto_nome: Optional[str] = None
    
    # ========== PHASE 1: GEOREFERENCIAÇÃO ==========
    clients_geocoded: Optional[pd.DataFrame] = None          # Final geocoded clients
    clients_original_df: Optional[pd.DataFrame] = None       # Raw upload for reference
    phase_1_complete: bool = False
    
    # ========== PHASE 2: FROTA E ARMAZÉNS ==========
    warehouses_geocoded: Optional[pd.DataFrame] = None       # Geocoded warehouses (Lat/Lon)
    fleet_config: Dict[str, FleetVehicle] = field(default_factory=dict)  # Vehicle configs
    phase_2_complete: bool = False
    
    # ========== PHASE 3: PLANEAMENTO ==========
    routes_solution: Optional[pd.DataFrame] = None           # Optimized routes
    fleet_config_used: Dict[str, FleetVehicle] = field(default_factory=dict)  # Snapshot of fleet used
    warehouses_used: Optional[pd.DataFrame] = None           # Snapshot of warehouses used
    optimization_params: dict = field(default_factory=dict)  # Last solver params
    
    # ========== UI / UX STATE ==========
    current_phase: int = 1                                   # Active tab (1-5)
    view_mode: str = "full"                                  # full | mapa | tabelas
    google_api_key: Optional[str] = None                     # User-provided key (overrides global)
    
    # ========== TEMPORARY / WORK STATE ==========
    # These are cleared between phases or after use
    learned_count: int = 0                                   # From geocoder learning
    processing_time: str = ""                                # Last geocoding duration
    failed_clients: Optional[pd.DataFrame] = None            # For correction UI
    manual_correction_mode: bool = False                     # Flag for correction flow
    
    # ========== MULTI-MONITOR SYNC ==========
    # These are managed by persistence_manager but exposed for UI
    next_phase_queued: Optional[int] = None                  # For programmatic phase jumps
    show_dashboard: bool = False                             # Sidebar dashboard toggle


def init_session_state() -> None:
    """
    Initialize session state with the canonical AppState structure.
    Call this once at app startup.
    """
    if 'app_state' not in st.session_state:
        st.session_state['app_state'] = AppState()


def get_state() -> AppState:
    """
    Get the typed application state from session state.
    Initializes if not present.
    """
    if 'app_state' not in st.session_state:
        init_session_state()
    return st.session_state['app_state']


def set_state(state: AppState) -> None:
    """
    Replace the entire application state.
    Use with caution - prefer direct attribute updates for most cases.
    """
    st.session_state['app_state'] = state


# Convenience properties for backward compatibility during migration
# These will be removed once all components migrate to AppState
def _get_legacy_compat():
    """Temporary shim for legacy code - DO NOT USE in new code."""
    state = get_state()
    return {
        # Auth
        'logged_in': state.logged_in,
        'utilizador_id': state.utilizador_id,
        'utilizador_nome': state.utilizador_nome,
        'utilizador_email': state.utilizador_email,
        'empresa_id': state.empresa_id,
        'empresa_nome': state.empresa_nome,
        'is_admin': state.is_admin,
        
        # Project
        'projeto_atual': state.projeto_atual,
        
        # Phase 1
        'clients_geocoded': state.clients_geocoded,
        'clients_original_df': state.clients_original_df,
        'phase_1_complete': state.phase_1_complete,
        
        # Phase 2
        'warehouses_geocoded': state.warehouses_geocoded,
        'fleet_config': state.fleet_config,
        'phase_2_complete': state.phase_2_complete,
        
        # Phase 3
        'routes_solution': state.routes_solution,
        'fleet_config_used': state.fleet_config_used,
        'warehouses_used': state.warehouses_used,
        'optimization_params': state.optimization_params,
        
        # UI
        'current_phase': state.current_phase,
        'view_mode': state.view_mode,
        'google_api_key': state.google_api_key,
        
        # Temp
        'learned_count': state.learned_count,
        'processing_time': state.processing_time,
        'failed_clients': state.failed_clients,
        'manual_correction_mode': state.manual_correction_mode,
        
        # Multi-monitor
        'next_phase_queued': state.next_phase_queued,
        'show_dashboard': state.show_dashboard,
    }


# Migration helper - copy legacy keys to AppState (run once)
def migrate_legacy_state() -> None:
    """
    Migrate legacy session state keys to the new AppState structure.
    Call this once after deploying the new structure.
    """
    if 'app_state' in st.session_state:
        return  # Already migrated
    
    state = AppState()
    
    # Map legacy keys to AppState attributes
    legacy_mapping = {
        # Auth
        'logged_in': 'logged_in',
        'utilizador_id': 'utilizador_id',
        'utilizador_nome': 'utilizador_nome',
        'utilizador_email': 'utilizador_email',
        'empresa_id': 'empresa_id',
        'empresa_nome': 'empresa_nome',
        'is_admin': 'is_admin',
        
        # Project
        'projeto_atual': 'projeto_atual',
        
        # Phase 1
        'clients_geocoded': 'clients_geocoded',
        'clients_original_df': 'clients_original_df',
        'phase_1_complete': 'phase_1_complete',
        'learned_count': 'learned_count',
        'processing_time': 'processing_time',
        
        # Phase 2
        'warehouses_geocoded': 'warehouses_geocoded',
        'fleet_config': 'fleet_config',
        'phase_2_complete': 'phase_2_complete',
        
        # Phase 3
        'routes_solution': 'routes_solution',
        'fleet_config_used': 'fleet_config_used',
        'warehouses_used': 'warehouses_used',
        'optimization_params': 'optimization_params',
        
        # UI
        'current_phase': 'current_phase',
        'view_mode': 'view_mode',
        'google_api_key': 'google_api_key',
        
        # Temp
        'failed_clients': 'failed_clients',
        'manual_correction_mode': 'manual_correction_mode',
        
        # Multi-monitor
        'next_phase_queued': 'next_phase_queued',
        'show_dashboard': 'show_dashboard',
    }
    
    for legacy_key, attr_name in legacy_mapping.items():
        if legacy_key in st.session_state:
            setattr(state, attr_name, st.session_state[legacy_key])
    
    st.session_state['app_state'] = state
    
    # Optional: Clear legacy keys to force migration
    # for legacy_key in legacy_mapping.keys():
    #     if legacy_key in st.session_state:
    #         del st.session_state[legacy_key]
