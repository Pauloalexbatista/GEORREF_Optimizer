"""
Persistence Manager Utility
Handles serialization and storage of working Streamlit sessions into the database snapshots.
"""
import json
import pandas as pd
from database import get_db
from datetime import datetime

# Define which session keys we actually want to save between phases
CRITICAL_KEYS = [
    'clients_geocoded',
    'phase_1_complete',
    'warehouses',
    'warehouses_geocoded',
    'fleet_config',
    'phase_2_complete',
    'routes_solution',
    'fleet_config_used',
    'warehouses_used',
    'optimization_params'
]

def serialize_state(session_state):
    """Converts streamlit session state payload into a serializable JSON dictionary."""
    import dataclasses
    from core.session_state import FleetVehicle
    payload = {}
    
    for key in CRITICAL_KEYS:
        if key not in session_state:
            continue
            
        val = session_state[key]
        
        # Handle Pandas Dataframes
        if isinstance(val, pd.DataFrame):
            payload[key] = {
                '__type__': 'pd_dataframe',
                'data': val.to_json(orient='split', date_format='iso')
            }
        # Handle FleetVehicle dataclass dicts specifically
        elif isinstance(val, dict):
            serialized_dict = {}
            for k, v in val.items():
                if isinstance(v, FleetVehicle):
                    d = dataclasses.asdict(v)
                    d['__type__'] = 'FleetVehicle'
                    serialized_dict[k] = d
                else:
                    serialized_dict[k] = v
            payload[key] = serialized_dict
        elif isinstance(val, (list, int, float, str, bool)) or val is None:
             payload[key] = val
             
    return json.dumps(payload)

def deserialize_state(payload_json):
    """Reconstructs actual Python objects (like DataFrames) from JSON payload."""
    from core.session_state import FleetVehicle
    try:
        raw = json.loads(payload_json)
        restored = {}
        
        for key, val in raw.items():
            # Detect packed dataframe markers
            if isinstance(val, dict) and val.get('__type__') == 'pd_dataframe':
                from io import StringIO
                json_data = val['data']
                restored[key] = pd.read_json(StringIO(json_data), orient='split')
            # Detect packed FleetVehicle dicts
            elif isinstance(val, dict):
                reconstructed_dict = {}
                for k, v in val.items():
                    if isinstance(v, dict) and v.get('__type__') == 'FleetVehicle':
                        data = {inner_k: inner_v for inner_k, inner_v in v.items() if inner_k != '__type__'}
                        reconstructed_dict[k] = FleetVehicle(**data)
                    else:
                        reconstructed_dict[k] = v
                restored[key] = reconstructed_dict
            else:
                restored[key] = val
                
        return restored
    except Exception as e:
        print(f"[PERSISTENCE ERROR] Failed to deserialize: {e}")
        return {}

def create_snapshot(projeto_id, utilizador_id, fase_atual, snapshot_name=None):
    """
    Takes current runtime session_state, serializes it and stores into DB.
    Returns the snapshot ID.
    """
    import streamlit as st
    
    payload = serialize_state(st.session_state)
    
    if not snapshot_name:
        snapshot_name = f"Auto-Save Fase {fase_atual} - {datetime.now().strftime('%H:%M:%S')}"
        
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Delete older autosaves beyond a limit to keep table clean (optional housekeeping)
        
        cursor.execute("""
            INSERT INTO snapshots (projeto_id, utilizador_id, fase_atual, nome_snapshot, payload_json)
            VALUES (?, ?, ?, ?, ?)
        """, (projeto_id, utilizador_id, fase_atual, snapshot_name, payload))
        
        conn.commit()
        return cursor.lastrowid

def get_snapshots_for_project(projeto_id, limit=5):
    """Retrieves list of recent snapshots for picking."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, fase_atual, nome_snapshot, created_at 
            FROM snapshots 
            WHERE projeto_id = ? 
            ORDER BY id DESC 
            LIMIT ?
        """, (projeto_id, limit))
        return cursor.fetchall()

def load_snapshot_into_session(snapshot_id):
    """Fetches payload from DB and overwrites streamlit session state."""
    import streamlit as st
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT fase_atual, payload_json FROM snapshots WHERE id = ?", (snapshot_id,))
        row = cursor.fetchone()
        
        if row:
            fase = row['fase_atual']
            payload = row['payload_json']
            
            restored = deserialize_state(payload)
            
            # Perform update
            from core.session_state import get_state, set_state
            state = get_state()
            for k, v in restored.items():
                st.session_state[k] = v
                if hasattr(state, k):
                    setattr(state, k, v)
            set_state(state)
                
            # --- RETRO-COMPATIBILITY BRIDGE FOR OLD SNAPSHOTS ---
            # If an old snapshot lacks the geocoded DF but has the raw array, reconstruct it instantly!
            if 'warehouses' in st.session_state and 'warehouses_geocoded' not in st.session_state:
                wh = st.session_state['warehouses']
                if wh and isinstance(wh, list):
                    try:
                        df_wh = pd.DataFrame(wh)
                        if not df_wh.empty:
                            df_wh = df_wh.rename(columns={
                                'name': 'Nome_Armazem',
                                'address': 'Morada',
                                'lat': 'Latitude',
                                'lon': 'Longitude',
                                'quality': 'Nivel_Qualidade'
                            })
                            st.session_state['warehouses_geocoded'] = df_wh
                    except Exception:
                        pass

            if 'warehouses_geocoded' in st.session_state and 'phase_2_complete' not in st.session_state:
                 st.session_state['phase_2_complete'] = True

            if 'warehouses_geocoded' in st.session_state and 'warehouses_used' not in st.session_state:
                 st.session_state['warehouses_used'] = st.session_state['warehouses_geocoded']

            if 'fleet_config' in st.session_state and 'fleet_config_used' not in st.session_state:
                 st.session_state['fleet_config_used'] = st.session_state['fleet_config']
            # ---------------------------------------------------

            # Update current phase context
            from core.session_state import get_state, set_state
            state = get_state()
            state.next_phase_queued = fase
            set_state(state)
            st.session_state['next_phase_queued'] = fase
            return True
            
    return False
