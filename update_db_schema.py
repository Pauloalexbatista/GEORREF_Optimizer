import sqlite3
import datetime

DB_FILE = 'geocoding.db'

def update_schema():
    print(f"Connecting to {DB_FILE}...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # 1. Add new columns
    columns_to_add = [
        ("quality_score", "INTEGER"),
        ("match_type", "TEXT"),
        ("source", "TEXT"),
        ("google_place_id", "TEXT"),
        ("last_validated", "DATETIME")
    ]

    print("Checking/Adding columns...")
    # Get existing columns
    cursor.execute("PRAGMA table_info(pt_addresses)")
    existing_cols = [row[1] for row in cursor.fetchall()]

    for col_name, col_type in columns_to_add:
        if col_name not in existing_cols:
            print(f"Adding column: {col_name} ({col_type})")
            try:
                cursor.execute(f"ALTER TABLE pt_addresses ADD COLUMN {col_name} {col_type}")
            except sqlite3.OperationalError as e:
                print(f"Error adding {col_name}: {e}")
        else:
            print(f"Column {col_name} already exists.")

    # 2. Create Indices
    print("Creating indices...")
    indices = [
        ("idx_cp4", "CP4"),
        ("idx_quality", "quality_score"),
        ("idx_google_id", "google_place_id")
    ]

    for idx_name, col_name in indices:
        try:
            cursor.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON pt_addresses ({col_name})")
            print(f"Index {idx_name} created/verified.")
        except Exception as e:
            print(f"Error creating index {idx_name}: {e}")

    # 3. Initialize quality_score for existing records
    # Assume existing records are "Imported" and unverified, so maybe Level 3 or just NULL?
    # Let's set source to 'IMPORT' where it's NULL
    print("Initializing metadata for existing records...")
    cursor.execute("UPDATE pt_addresses SET source = 'IMPORT' WHERE source IS NULL")
    
    # Commit changes
    conn.commit()
    conn.close()
    print("Schema update completed successfully.")

if __name__ == "__main__":
    update_schema()
