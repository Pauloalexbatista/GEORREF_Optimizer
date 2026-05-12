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
    'warehouses',
    'fleet_config',
    'routes_solution',
    'optimization_params'
]

def serialize_state(session_state):
    """Converts streamlit session state payload into a serializable JSON dictionary."""
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
        # Handle Dicts/Lists directly
        elif isinstance(val, (dict, list, int, float, str, bool)):
             payload[key] = val
        else:
             # Log warning if something skipped, or convert to string fallback
             pass
             
    return json.dumps(payload)

def deserialize_state(payload_json):
    """Reconstructs actual Python objects (like DataFrames) from JSON payload."""
    try:
        raw = json.loads(payload_json)
        restored = {}
        
        for key, val in raw.items():
            # Detect packed dataframe markers
            if isinstance(val, dict) and val.get('__type__') == 'pd_dataframe':
                from io import StringIO
                json_data = val['data']
                restored[key] = pd.read_json(StringIO(json_data), orient='split')
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
            for k, v in restored.items():
                st.session_state[k] = v
                
            # Update current phase context
            st.session_state['next_phase_queued'] = fase
            return True
            
    return False
