import pandas as pd
import sqlite3
import os

# Configuration
CSV_FILE = 'ctt-lat-lng - Original.csv'
DB_FILE = 'geocoding.db'
CHUNK_SIZE = 50000  # Process in chunks to save memory

def setup_database():
    print(f"Connecting to {DB_FILE}...")
    conn = sqlite3.connect(DB_FILE)
    
    # Check if table exists
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pt_addresses'")
    if cursor.fetchone():
        print("Table 'pt_addresses' already exists. Skipping import.")
        conn.close()
        return

    print(f"Reading {CSV_FILE}...")
    
    # We need to read in chunks because the file is large
    # Encoding is likely 'latin1' or 'cp1252' given the Portuguese characters
    chunk_iterator = pd.read_csv(
        CSV_FILE, 
        sep=';', 
        encoding='latin1', 
        decimal=',',
        chunksize=CHUNK_SIZE,
        dtype={
            'CP4': str, 
            'CP3': str, 
            'dd': str, 
            'cc': str
        }
    )

    total_rows = 0
    
    for i, chunk in enumerate(chunk_iterator):
        # Create a clean 'Full Address' column for matching
        # Concatenate relevant fields, handling NaNs
        chunk = chunk.fillna('')
        
        # Construct a searchable address string
        # Priority: ART_TITULO + ART_DESIG + ART_LOCAL
        chunk['full_street'] = (
            chunk['ART_TITULO'] + ' ' + 
            chunk['ART_DESIG'] + ' ' + 
            chunk['ART_LOCAL']
        ).str.strip()
        
        # If street is empty, use LOCALIDADE
        chunk.loc[chunk['full_street'] == '', 'full_street'] = chunk['LOCALIDADE']
        
        # Save to SQLite
        if i == 0:
            chunk.to_sql('pt_addresses', conn, if_exists='replace', index=False)
        else:
            chunk.to_sql('pt_addresses', conn, if_exists='append', index=False)
            
        total_rows += len(chunk)
        print(f"Processed {total_rows} rows...")

    print("Creating indices for fast search...")
    cursor.execute("CREATE INDEX idx_cp4 ON pt_addresses(CP4)")
    cursor.execute("CREATE INDEX idx_concelho ON pt_addresses(cc_desig)")
    cursor.execute("CREATE INDEX idx_distrito ON pt_addresses(dd_desig)")
    
    conn.commit()
    conn.close()
    print("Database setup complete!")

if __name__ == "__main__":
    setup_database()
