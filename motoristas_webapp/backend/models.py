import sqlite3
import os
import json
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "daily_session.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    cursor = conn.cursor()
    
    # Metadata table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS session_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    
    # Drivers and Vehicles
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        vehicle TEXT,
        password TEXT NOT NULL,
        assigned_route_id TEXT,
        last_lat REAL,
        last_lng REAL,
        last_gps_time TEXT
    )
    """)
    
    # Routes stops / clients
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS route_stops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT NOT NULL,
        sequence INTEGER DEFAULT 0,
        client_name TEXT NOT NULL,
        address TEXT,
        postal_code TEXT,
        city TEXT,
        phone TEXT,
        contact_person TEXT,
        volume REAL DEFAULT 0,
        weight REAL DEFAULT 0,
        packages INTEGER DEFAULT 0,
        seller TEXT,
        notes TEXT,
        cod_amount REAL DEFAULT 0.0,
        status TEXT DEFAULT 'Pendente', -- Pendente, Entregue, Não Entregue
        fail_reason TEXT,
        driver_notes TEXT,
        updated_at TEXT,
        delivered_lat REAL,
        delivered_lng REAL
    )
    """)
    
    # Failure reasons
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS failure_reasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT,
        reason TEXT NOT NULL
    )
    """)
    
    # Activity log for state changes (with timestamps)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        route_id TEXT,
        stop_id INTEGER,
        client_name TEXT,
        action TEXT,
        previous_status TEXT,
        new_status TEXT,
        reason TEXT,
        notes TEXT,
        driver_name TEXT,
        timestamp TEXT NOT NULL
    )
    """)
    
    conn.commit()
    conn.close()

def clear_session_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM session_meta")
    cursor.execute("DELETE FROM drivers")
    cursor.execute("DELETE FROM route_stops")
    cursor.execute("DELETE FROM failure_reasons")
    cursor.execute("DELETE FROM activity_log")
    conn.commit()
    conn.close()

def set_session_meta(key: str, value: str):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO session_meta (key, value) VALUES (?, ?)", (key, str(value)))
    conn.commit()
    conn.close()

def get_session_meta(key: str) -> Optional[str]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM session_meta WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else None

init_db()
