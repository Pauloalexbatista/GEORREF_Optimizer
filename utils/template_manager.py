import pandas as pd
import sqlite3
import random
from datetime import datetime, time
from io import BytesIO

DB_FILE = 'geocoding.db'

# ==================== TEMPLATE STRUCTURES ====================

DELIVERIES_COLUMNS = [
    'Codigo_Cliente',
    'Nome_Cliente',
    'Morada',
    'Codigo_Postal',
    'Concelho',
    'Latitude',
    'Longitude',
    'Peso_KG',
    'Volume_m3',
    'Prioridade',
    'Janela_Inicio', 'Janela_Fim',
    'Janela2_Inicio', 'Janela2_Fim',
    'Janela3_Inicio', 'Janela3_Fim',
    'Observacoes'
]

FLEET_COLUMNS = [
    'Veiculo',
    'Capacidade_KG',
    'Cap_Volume_m3',
    'Custo_KM',
    'Velocidade_Media',
    'Horario_Inicio',
    'Horario_Fim'
]

WAREHOUSE_COLUMNS = [
    'Nome_Armazem',
    'Morada',
    'CP',
    'Localidade',
    'Latitude',
    'Longitude'
]

# ==================== EMPTY TEMPLATE GENERATION ====================

def create_deliveries_template():
    """Generate empty deliveries template Excel file."""
    df = pd.DataFrame(columns=DELIVERIES_COLUMNS)
    
    # Add example row aligning with expanded schema
    df.loc[0] = [
        'CL001',
        'Rua Exemplo, 123',
        '1000-001',
        'Lisboa',
        38.71667,  # Example Latitude
        -9.13333,  # Example Longitude
        50.0,
        0.5,
        2,
        '09:00', '13:00', # Slot 1
        '14:00', '18:00', # Slot 2
        None, None,       # Slot 3 (Empty)
        'Exemplo de entrega'
    ]
    
    buffer = BytesIO()
    df.to_excel(buffer, index=False, engine='openpyxl')
    buffer.seek(0)
    return buffer.getvalue()

def create_fleet_template():
    """Generate empty fleet template Excel file (OLD - deprecated)."""
    df = pd.DataFrame(columns=FLEET_COLUMNS)
    
    # Add example rows
    df.loc[0] = ['Veiculo 1', 500, 5, 0.50, 40, '08:00', '18:00']
    df.loc[1] = ['Veiculo 2', 750, 8, 0.60, 40, '08:00', '18:00']
    df.loc[2] = ['Veiculo 3', 1000, 12, 0.70, 40, '08:00', '18:00']
    
    buffer = BytesIO()
    df.to_excel(buffer, index=False, engine='openpyxl')
    buffer.seek(0)
    return buffer.getvalue()

def create_fleet_warehouses_template():
    """Generate combined Fleet+Warehouses template with 2 sheets."""
    
    # Sheet 1: Warehouses (3 examples)
    df_warehouses = pd.DataFrame(columns=WAREHOUSE_COLUMNS)
    df_warehouses.loc[0] = ['Armazém Lisboa Centro', 'Rua do Comércio, 45', '1100-150', 'Lisboa']
    df_warehouses.loc[1] = ['Armazém Cascais', 'Avenida Marginal, 200', '2750-374', 'Cascais']
    df_warehouses.loc[2] = ['Armazém Sintra', 'Rua das Flores, 78', '2710-405', 'Sintra']
    
    # Sheet 2: Fleet (at least 1 vehicle per warehouse)
    df_fleet = pd.DataFrame(columns=['Veiculo', 'Armazem', 'Capacidade_KG', 'Cap_Volume_m3', 'Custo_KM', 'Velocidade_Media', 'Horario_Inicio', 'Horario_Fim'])
    df_fleet.loc[0] = ['Van 1', 'Armazém Lisboa Centro', 500, 5, 0.50, 40, '08:00', '18:00']
    df_fleet.loc[1] = ['Van 2', 'Armazém Lisboa Centro', 750, 8, 0.60, 40, '08:00', '18:00']
    df_fleet.loc[2] = ['Camião 1', 'Armazém Cascais', 1000, 12, 0.70, 40, '08:00', '18:00']
    df_fleet.loc[3] = ['Van 3', 'Armazém Sintra', 600, 6, 0.55, 40, '08:00', '18:00']
    
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df_warehouses.to_excel(writer, sheet_name='Armazéns', index=False)
        df_fleet.to_excel(writer, sheet_name='Frota', index=False)
    
    buffer.seek(0)
    return buffer.getvalue()

def generate_random_fleet_warehouses(n_vehicles=5, db_path=DB_FILE):
    """
    Generate random fleet and warehouses for testing.
    Creates 3 random warehouses in Lisboa area and distributes vehicles among them.
    
    Args:
        n_vehicles: Number of vehicles to generate (3-10)
        db_path: Path to geocoding database
    
    Returns:
        Excel file bytes with 2 sheets
    """
    n_vehicles = max(3, min(10, n_vehicles))
    
    # Sample 3 random addresses from Lisboa area for warehouses
    conn = sqlite3.connect(db_path)
    
    query = """
        SELECT full_street, CP4, cc_desig, LATITUDE, LONGITUDE
        FROM pt_addresses
        WHERE quality_score IN (1, 2, 3)
        AND LATITUDE IS NOT NULL
        AND LONGITUDE IS NOT NULL
        AND cc_desig IN ('Lisboa', 'Cascais', 'Sintra', 'Oeiras', 'Loures')
        ORDER BY RANDOM()
        LIMIT 3
    """
    
    df_wh_addresses = pd.read_sql_query(query, conn)
    conn.close()
    
    if len(df_wh_addresses) < 3:
        raise ValueError("Not enough addresses in database for warehouses")
    
    # Create warehouses
    warehouses = []
    warehouse_names = ['Armazém Central', 'Armazém Norte', 'Armazém Sul']
    
    for i, row in df_wh_addresses.iterrows():
        cp4 = str(row['CP4']) if pd.notna(row['CP4']) else ''
        cp7 = f"{cp4}-{random.randint(100, 999):03d}" if cp4 else ''
        
        warehouses.append({
            'Nome_Armazem': warehouse_names[i],
            'Morada': row['full_street'],
            'CP': cp7 if cp7 else cp4,
            'Localidade': row['cc_desig'] if pd.notna(row['cc_desig']) else 'Lisboa'
        })
    
    df_warehouses = pd.DataFrame(warehouses)
    
    # Create fleet - ensure at least 1 vehicle per warehouse
    fleet = []
    vehicle_types = [
        ('Carrinha Pequena', 300, 3, 0.40, 45),
        ('Carrinha Média', 500, 5, 0.50, 40),
        ('Carrinha Grande', 750, 8, 0.60, 40),
        ('Camião Pequeno', 1000, 12, 0.70, 35),
        ('Camião Médio', 1500, 20, 0.80, 35),
    ]
    
    # First, assign 1 vehicle to each warehouse
    for i in range(3):
        vtype = random.choice(vehicle_types)
        fleet.append({
            'Veiculo': f"{vtype[0]} {i+1}",
            'Armazem': warehouse_names[i],
            'Capacidade_KG': vtype[1] + random.randint(-50, 50),
            'Cap_Volume_m3': vtype[2] + round(random.uniform(-0.5, 0.5), 1),
            'Custo_KM': round(vtype[3] + random.uniform(-0.05, 0.05), 2),
            'Velocidade_Media': vtype[4] + random.randint(-5, 5),
            'Horario_Inicio': random.choice(['07:00', '08:00', '09:00']),
            'Horario_Fim': random.choice(['17:00', '18:00', '19:00'])
        })
    
    # Add remaining vehicles randomly
    for i in range(3, n_vehicles):
        vtype = random.choice(vehicle_types)
        fleet.append({
            'Veiculo': f"{vtype[0]} {i+1}",
            'Armazem': random.choice(warehouse_names),
            'Capacidade_KG': vtype[1] + random.randint(-50, 50),
            'Cap_Volume_m3': vtype[2] + round(random.uniform(-0.5, 0.5), 1),
            'Custo_KM': round(vtype[3] + random.uniform(-0.05, 0.05), 2),
            'Velocidade_Media': vtype[4] + random.randint(-5, 5),
            'Horario_Inicio': random.choice(['07:00', '08:00', '09:00']),
            'Horario_Fim': random.choice(['17:00', '18:00', '19:00'])
        })
    
    df_fleet = pd.DataFrame(fleet)
    
    # Create Excel with 2 sheets
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df_warehouses.to_excel(writer, sheet_name='Armazéns', index=False)
        df_fleet.to_excel(writer, sheet_name='Frota', index=False)
    
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
    # Use dd_desig (Distrito) for reliable region filtering, falling back to cc_desig (Concelho)
    query = f"""
        SELECT full_street, CP4, cc_desig, LATITUDE, LONGITUDE
        FROM pt_addresses
        WHERE quality_score IN ({quality_filter})
        AND LATITUDE IS NOT NULL
        AND LONGITUDE IS NOT NULL
        AND (
            dd_desig LIKE '%{distrito}%' 
            OR cc_desig LIKE '%{distrito}%'
        )
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
        
        # Randomly hide coordinates for 30% of rows to simulate realistic messy inputs!
        provide_coords = random.random() < 0.7 
        
        delivery = {
            'Codigo_Cliente': f"CL{i+1:04d}",
            'Nome_Cliente': f"Cliente CL{i+1:04d}",
            'Morada': row['full_street'],
            'Codigo_Postal': cp7 if cp7 else cp4,
            'Concelho': row['cc_desig'] if pd.notna(row['cc_desig']) else '',
            'Latitude': row['LATITUDE'] if provide_coords else None,
            'Longitude': row['LONGITUDE'] if provide_coords else None,
            'Peso_KG': round(random.uniform(5, 200), 1),
            'Volume_m3': round(random.uniform(0.1, 2.0), 2),
            'Prioridade': random.choice([1, 1, 2, 2, 2, 3]),
            'Janela_Inicio': random.choice(['08:00', '09:00', '10:00']),
            'Janela_Fim': '13:00',
            'Janela2_Inicio': '14:00',
            'Janela2_Fim': '18:00',
            'Janela3_Inicio': None,
            'Janela3_Fim': None,
            'Observacoes': random.choice(['', '', '', 'Fragil', 'Urgente'])
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
        ('Carrinha Pequena', 300, 3, 0.40, 45),
        ('Carrinha Media', 500, 5, 0.50, 40),
        ('Carrinha Grande', 750, 8, 0.60, 40),
        ('Camiao Pequeno', 1000, 12, 0.70, 35),
        ('Camiao Medio', 1500, 20, 0.80, 35),
    ]
    
    for i in range(n_vehicles):
        vtype = random.choice(vehicle_types)
        
        vehicle = {
            'Veiculo': f"{vtype[0]} {i+1}",
            'Capacidade_KG': vtype[1] + random.randint(-50, 50),
            'Cap_Volume_m3': vtype[2] + round(random.uniform(-0.5, 0.5), 1),
            'Custo_KM': round(vtype[3] + random.uniform(-0.05, 0.05), 2),
            'Velocidade_Media': vtype[4] + random.randint(-5, 5),
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
    required_fields = ['Codigo_Cliente', 'Morada', 'Peso_KG', 'Volume_m3']
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
    required_fields = ['Veiculo', 'Capacidade_KG', 'Cap_Volume_m3', 'Custo_KM']
    for field in required_fields:
        if df[field].isna().any():
            return False, f"Campo obrigatório '{field}' tem valores vazios"
    
    # Validate numeric fields
    if (df['Capacidade_KG'] <= 0).any():
        return False, "Capacidade KG deve ser maior que 0"
    
    if (df['Cap_Volume_m3'] <= 0).any():
        return False, "Capacidade Volume deve ser maior que 0"
    
    if (df['Custo_KM'] < 0).any():
        return False, "Custo/KM não pode ser negativo"
    
    return True, "Ficheiro válido"


def create_unified_project_template():
    """Generate a unified template with 3 sheets: Armazéns, Frota, Entregas."""
        # Sheet 1: Armazéns
    df_warehouses = pd.DataFrame(columns=WAREHOUSE_COLUMNS)
    df_warehouses.loc[0] = ['Armazém Central', 'Avenida Severiano Falcão, 16A', '2685-379', 'Prior Velho', 38.78420, -9.12380]
    df_warehouses.loc[1] = ['Armazém Norte', 'R. de Manuel Sousa Moreira Cruz 240', '4470-396', 'Maia', 41.22910, -8.66200]
    
    # Sheet 2: Frota
    df_fleet = pd.DataFrame(columns=['Veiculo', 'Armazem', 'Capacidade_KG', 'Cap_Volume_m3', 'Custo_KM', 'Velocidade_Media', 'Horario_Inicio', 'Horario_Fim'])
    df_fleet.loc[0] = ['Veiculo1', 'Armazém Central', 1500, 20.0, 0.73, 50, '07:00', '19:00']
    df_fleet.loc[1] = ['Veiculo2', 'Armazém Central', 1500, 20.0, 0.73, 50, '07:00', '19:00']
    df_fleet.loc[2] = ['Veiculo_Norte_1', 'Armazém Norte', 1200, 15.0, 0.65, 45, '08:00', '18:00']
    
    # Sheet 3: Entregas
    cols = [
        'Codigo_Cliente', 'Nome_Cliente', 'Morada', 'Codigo_Postal', 'Concelho', 
        'Latitude', 'Longitude', 'Peso_KG', 'Volume_m3', 'Prioridade', 
        'Janela_Inicio', 'Janela_Fim', 'Janela2_Inicio', 'Janela2_Fim', 
        'Janela3_Inicio', 'Janela3_Fim', 'Observacoes', 'Armazem'
    ]
    df_deliveries = pd.DataFrame(columns=cols)
    df_deliveries.loc[0] = ['CL0001', 'Cliente Exemplo 1', 'Avenida da República, 100', '1050-191', 'Lisboa', '', '', 115.5, 1.9, 1, '08:00', '13:00', '14:00', '18:00', '', '', 'Fragil', 'Armazém Central']
    df_deliveries.loc[1] = ['CL0002', 'Cliente Exemplo 2', 'Avenida dos Aliados, 50', '4000-064', 'Porto', 41.1478, -8.6111, 83.9, 0.51, 1, '10:00', '13:00', '14:00', '18:00', '', '', 'Urgente', 'Armazém Norte']
    
    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df_warehouses.to_excel(writer, sheet_name='Armazéns', index=False)
        df_fleet.to_excel(writer, sheet_name='Frota', index=False)
        df_deliveries.to_excel(writer, sheet_name='Entregas', index=False)
        
    buffer.seek(0)
    return buffer.getvalue()
