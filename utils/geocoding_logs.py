import sqlite3
from datetime import datetime

DB_FILE = 'geocoding.db'

def init_geocoding_logs():
    """Initialize geocoding logs table if it doesn't exist."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS geocoding_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            data_processamento TEXT NOT NULL,
            total_clientes INTEGER NOT NULL,
            tempo_segundos REAL NOT NULL,
            enderecos_aprendidos INTEGER DEFAULT 0,
            sucesso_nivel_1_2 INTEGER DEFAULT 0,
            falhas_nivel_8 INTEGER DEFAULT 0
        )
    """)
    
    conn.commit()
    conn.close()

def save_geocoding_log(total_clientes, tempo_segundos, enderecos_aprendidos, sucesso, falhas):
    """
    Save geocoding session log.
    
    Args:
        total_clientes: Total number of addresses processed
        tempo_segundos: Processing time in seconds
        enderecos_aprendidos: Number of new addresses learned
        sucesso: Number of successful geocodings (level 1-2)
        falhas: Number of failures (level 8)
    """
    init_geocoding_logs()
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO geocoding_logs 
        (data_processamento, total_clientes, tempo_segundos, enderecos_aprendidos, sucesso_nivel_1_2, falhas_nivel_8)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        total_clientes,
        tempo_segundos,
        enderecos_aprendidos,
        sucesso,
        falhas
    ))
    
    conn.commit()
    conn.close()

def get_geocoding_stats():
    """
    Get geocoding statistics.
    
    Returns:
        dict with average time, total sessions, total addresses, etc.
    """
    init_geocoding_logs()
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            COUNT(*) as total_sessoes,
            SUM(total_clientes) as total_enderecos,
            AVG(tempo_segundos) as tempo_medio,
            SUM(enderecos_aprendidos) as total_aprendidos,
            AVG(sucesso_nivel_1_2 * 100.0 / total_clientes) as taxa_sucesso_media
        FROM geocoding_logs
    """)
    
    row = cursor.fetchone()
    conn.close()
    
    if row and row[0] > 0:
        return {
            'total_sessoes': row[0],
            'total_enderecos': row[1] or 0,
            'tempo_medio_segundos': row[2] or 0,
            'total_aprendidos': row[3] or 0,
            'taxa_sucesso_media': row[4] or 0
        }
    else:
        return {
            'total_sessoes': 0,
            'total_enderecos': 0,
            'tempo_medio_segundos': 0,
            'total_aprendidos': 0,
            'taxa_sucesso_media': 0
        }

def get_recent_logs(limit=10):
    """Get recent geocoding logs."""
    init_geocoding_logs()
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            data_processamento,
            total_clientes,
            tempo_segundos,
            enderecos_aprendidos,
            sucesso_nivel_1_2,
            falhas_nivel_8
        FROM geocoding_logs
        ORDER BY id DESC
        LIMIT ?
    """, (limit,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return rows
