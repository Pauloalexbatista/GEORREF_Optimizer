import sqlite3
import os

def analyze_database():
    """Analyze the geocoding database and generate a report"""
    
    db_path = 'geocoding.db'
    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("=" * 60)
    print("ANÁLISE DA BASE DE DADOS DE GEOCODING")
    print("=" * 60)
    
    # Get table schema
    print("\n📋 Tabelas:")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()
    for table in tables:
        print(f"  - {table[0]}")
    
    # Analyze pt_addresses
    print("\n� Tabela: pt_addresses")
    cursor.execute('SELECT COUNT(*) FROM pt_addresses')
    total = cursor.fetchone()[0]
    print(f"  Total de registos: {total:,}")
    
    # Get column info
    cursor.execute('PRAGMA table_info(pt_addresses)')
    columns = cursor.fetchall()
    print("\n  Colunas:")
    for col in columns:
        print(f"    - {col[1]} ({col[2]})")
    
    # Sample data
    print("\n  Amostra de dados (primeiros 3 registos):")
    cursor.execute('SELECT * FROM pt_addresses LIMIT 3')
    rows = cursor.fetchall()
    for i, row in enumerate(rows, 1):
        print(f"    Registo {i}: {row[:5]}...")  # Show first 5 fields
    
    # Analyze geocoding_logs
    print("\n📊 Tabela: geocoding_logs")
    cursor.execute('SELECT COUNT(*) FROM geocoding_logs')
    log_count = cursor.fetchone()[0]
    print(f"  Total de registos: {log_count:,}")
    
    if log_count > 0:
        cursor.execute('PRAGMA table_info(geocoding_logs)')
        columns = cursor.fetchall()
        print("\n  Colunas:")
        for col in columns:
            print(f"    - {col[1]} ({col[2]})")
    
    # Database size
    db_size_mb = os.path.getsize(db_path) / (1024 * 1024)
    print(f"\n💾 Tamanho da Base de Dados: {db_size_mb:.2f} MB")
    
    # Check for backup
    backup_path = 'geocoding_backup.db'
    if os.path.exists(backup_path):
        backup_size_mb = os.path.getsize(backup_path) / (1024 * 1024)
        print(f"💾 Tamanho do Backup: {backup_size_mb:.2f} MB")
    
    conn.close()
    print("\n" + "=" * 60)

if __name__ == "__main__":
    analyze_database()
