import pandas as pd
import sqlite3
import random
from datetime import datetime, time
from io import BytesIO

DB_FILE = 'geocoding.db'

# ==================== TEMPLATE STRUCTURES ====================

DELIVERIES_COLUMNS = [
    'Codigo_Cliente',
    'Morada',
    'Codigo_Postal',
    'Concelho',
    'Peso_KG',
    'Prioridade',
    'Janela_Inicio',
    'Janela_Fim',
    'Observacoes'
]

FLEET_COLUMNS = [
    'Veiculo',
    'Capacidade_KG',
    'Custo_KM',
    'Velocidade_Media',
    'Horario_Inicio',
    'Horario_Fim'
]

# ==================== EMPTY TEMPLATE GENERATION ====================

def create_deliveries_template():
    """Generate empty deliveries template Excel file."""
    df = pd.DataFrame(columns=DELIVERIES_COLUMNS)
    
    # Add example row
    df.loc[0] = [
        'CL001',
        'Rua Exemplo, 123',
        '1000-001',
        'Lisboa',
        50.0,
        2,
        '09:00',
        '18:00',
        'Exemplo de entrega'
    ]
    
    buffer = BytesIO()
    df.to_excel(buffer, index=False, engine='openpyxl')
    buffer.seek(0)
    return buffer.getvalue()

def create_fleet_template():
    """Generate empty fleet template Excel file."""
    df = pd.DataFrame(columns=FLEET_COLUMNS)
    
    # Add example rows
    df.loc[0] = ['Veiculo 1', 500, 0.50, 40, '08:00', '18:00']
    df.loc[1] = ['Veiculo 2', 750, 0.60, 40, '08:00', '18:00']
    df.loc[2] = ['Veiculo 3', 1000, 0.70, 40, '08:00', '18:00']
    
    buffer = BytesIO()
    df.to_excel(buffer, index=False, engine='openpyxl')
    buffer.seek(0)
    return buffer.getvalue()

# ==================== RANDOM DATA GENERATION ====================

def generate_random_deliveries(n_deliveries=50, quality_levels=None, db_path=DB_FILE, distrito='Lisboa'):
    """
    Generate random deliveries using real addresses from the database.
    
    Args:
        n_deliveries: Number of deliveries to generate
        quality_levels: List of quality levels to filter (1-7), None for all
        db_path: Path to geocoding database
        distrito: District to filter addresses (default: Lisboa)
    
    Returns:
        Excel file bytes
    """
    if quality_levels is None:
        quality_levels = [1, 2, 3, 4, 5]  # Default to good quality
    
    # Sample addresses from database - same district
    conn = sqlite3.connect(db_path)
    
    # Build quality filter
    quality_filter = ','.join(map(str, quality_levels))
    
    # Filter by distrito (using cc_desig as proxy for now)
    query = f"""
        SELECT full_street, CP4, cc_desig, LATITUDE, LONGITUDE
        FROM pt_addresses
        WHERE quality_score IN ({quality_filter})
        AND LATITUDE IS NOT NULL
        AND LONGITUDE IS NOT NULL
        AND (cc_desig LIKE '%{distrito}%' OR cc_desig IN ('Lisboa', 'Cascais', 'Sintra', 'Oeiras', 'Loures', 'Odivelas', 'Amadora', 'Vila Franca de Xira', 'Mafra'))
        ORDER BY RANDOM()
        LIMIT ?
    """
    
    df_addresses = pd.read_sql_query(query, conn, params=(n_deliveries,))
    conn.close()
    
    if len(df_addresses) == 0:
        raise ValueError("No addresses found in database with specified quality levels and district")
    
    # Generate delivery data
    deliveries = []
    
    for i, row in df_addresses.iterrows():
        # Generate CP7 from CP4 if available
        cp4 = str(row['CP4']) if pd.notna(row['CP4']) else ''
        cp7 = f"{cp4}-{random.randint(100, 999):03d}" if cp4 else ''
        
        delivery = {
            'Codigo_Cliente': f"CL{i+1:04d}",
            'Morada': row['full_street'],
            'Codigo_Postal': cp7 if cp7 else cp4,
            'Concelho': row['cc_desig'] if pd.notna(row['cc_desig']) else '',
            'Peso_KG': round(random.uniform(5, 200), 1),
            'Prioridade': random.choice([1, 1, 2, 2, 2, 3]),  # Weighted towards normal
            'Janela_Inicio': random.choice(['08:00', '09:00', '10:00']),
            'Janela_Fim': random.choice(['17:00', '18:00', '19:00']),
            'Observacoes': random.choice(['', '', '', 'Fragil', 'Urgente', 'Confirmar chegada'])
        }
        deliveries.append(delivery)
    
    df = pd.DataFrame(deliveries)
    
    buffer = BytesIO()
    df.to_excel(buffer, index=False, engine='openpyxl')
    buffer.seek(0)
    return buffer.getvalue()

def generate_random_fleet(n_vehicles=3):
    """
    Generate random fleet configuration.
    
    Args:
        n_vehicles: Number of vehicles to generate (3-10)
    
    Returns:
        Excel file bytes
    """
    n_vehicles = max(3, min(10, n_vehicles))  # Clamp between 3-10
    
    fleet = []
    
    vehicle_types = [
        ('Carrinha Pequena', 300, 0.40, 45),
        ('Carrinha Media', 500, 0.50, 40),
        ('Carrinha Grande', 750, 0.60, 40),
        ('Camiao Pequeno', 1000, 0.70, 35),
        ('Camiao Medio', 1500, 0.80, 35),
    ]
    
    for i in range(n_vehicles):
        vtype = random.choice(vehicle_types)
        
        vehicle = {
            'Veiculo': f"{vtype[0]} {i+1}",
            'Capacidade_KG': vtype[1] + random.randint(-50, 50),
            'Custo_KM': round(vtype[2] + random.uniform(-0.05, 0.05), 2),
            'Velocidade_Media': vtype[3] + random.randint(-5, 5),
            'Horario_Inicio': random.choice(['07:00', '08:00', '09:00']),
            'Horario_Fim': random.choice(['17:00', '18:00', '19:00'])
        }
        fleet.append(vehicle)
    
    df = pd.DataFrame(fleet)
    
    buffer = BytesIO()
    df.to_excel(buffer, index=False, engine='openpyxl')
    buffer.seek(0)
    return buffer.getvalue()

# ==================== VALIDATION ====================

def validate_deliveries_file(df):
    """
    Validate uploaded deliveries file format.
    
    Returns:
        (is_valid, error_message)
    """
    # Check required columns
    missing_cols = set(DELIVERIES_COLUMNS) - set(df.columns)
    if missing_cols:
        return False, f"Colunas em falta: {', '.join(missing_cols)}"
    
    # Check for empty required fields
    required_fields = ['Codigo_Cliente', 'Morada', 'Peso_KG']
    for field in required_fields:
        if df[field].isna().any():
            return False, f"Campo obrigatório '{field}' tem valores vazios"
    
    # Validate priority values
    if not df['Prioridade'].isin([1, 2, 3]).all():
        return False, "Prioridade deve ser 1 (Alta), 2 (Normal) ou 3 (Baixa)"
    
    return True, "Ficheiro válido"

def validate_fleet_file(df):
    """
    Validate uploaded fleet file format.
    
    Returns:
        (is_valid, error_message)
    """
    # Check required columns
    missing_cols = set(FLEET_COLUMNS) - set(df.columns)
    if missing_cols:
        return False, f"Colunas em falta: {', '.join(missing_cols)}"
    
    # Check for empty required fields
    required_fields = ['Veiculo', 'Capacidade_KG', 'Custo_KM']
    for field in required_fields:
        if df[field].isna().any():
            return False, f"Campo obrigatório '{field}' tem valores vazios"
    
    # Validate numeric fields
    if (df['Capacidade_KG'] <= 0).any():
        return False, "Capacidade deve ser maior que 0"
    
    if (df['Custo_KM'] < 0).any():
        return False, "Custo/KM não pode ser negativo"
    
    return True, "Ficheiro válido"
