import sqlite3
from utils.validation import is_in_portugal, is_swapped_coords

DB_FILE = 'geocoding.db'

def run_sanity_check():
    print("Starting Sanity Check...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()

    # 1. Check for invalid coordinates
    print("Checking for invalid coordinates...")
    cursor.execute("SELECT rowid, LATITUDE, LONGITUDE FROM pt_addresses")
    rows = cursor.fetchall()
    
    invalid_count = 0
    swapped_count = 0
    valid_count = 0
    
    updates = []
    
    for row in rows:
        rowid, lat, lon = row
        
        if is_in_portugal(lat, lon):
            # Valid
            updates.append((2, 'IMPORT_VALID', rowid))
            valid_count += 1
        elif is_swapped_coords(lat, lon):
            # Swapped - Mark as Level 5 but with specific match_type
            updates.append((5, 'SWAPPED_COORDS', rowid))
            swapped_count += 1
            invalid_count += 1
        else:
            # Invalid
            updates.append((5, 'INVALID_COORDS', rowid))
            invalid_count += 1
            
        if len(updates) >= 1000:
            cursor.executemany("UPDATE pt_addresses SET quality_score = ?, match_type = ? WHERE rowid = ?", updates)
            conn.commit()
            updates = []
            print(f"Processed {valid_count + invalid_count} records...")

    if updates:
        cursor.executemany("UPDATE pt_addresses SET quality_score = ?, match_type = ? WHERE rowid = ?", updates)
        conn.commit()

    print(f"Sanity Check Complete.")
    print(f"Total Records: {len(rows)}")
    print(f"Valid: {valid_count}")
    print(f"Invalid: {invalid_count}")
    print(f"  - Swapped Coords: {swapped_count}")
    print(f"  - Out of Bounds: {invalid_count - swapped_count}")
    
    conn.close()

if __name__ == "__main__":
    run_sanity_check()
