import sqlite3
import time
import random
import logging
import sys
import os
from utils.cp_scraper import scrape_cp_data

# --- CONFIGURATION ---
DB_FILE = 'harvested_data.db'
START_CP4 = 4000
END_CP4 = 4999
# CP3 range to scan per CP4. Scanning all 999 is huge (1000 * 999 = ~1M requests).
# For this prototype, we'll scan a subset or random ones, or sequential.
# Let's try sequential but maybe limit the scope for testing.
START_CP3 = 1
END_CP3 = 50 # Scan first 50 CP3s of each CP4 for now (Adjustable)

# Delays (Politeness)
MIN_DELAY = 2.0
MAX_DELAY = 5.0

# Safety Limit for Testing
# MAX_REQUESTS = 5

# Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("mining_bot.log"),
        logging.StreamHandler(sys.stdout)
    ]
)

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS harvested_addresses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cp4 TEXT,
            cp3 TEXT,
            full_address TEXT,
            latitude REAL,
            longitude REAL,
            concelho TEXT,
            distrito TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    return conn

def save_address(conn, data, cp4, cp3):
    try:
        cursor = conn.cursor()
        # Check if exists
        cursor.execute("SELECT id FROM harvested_addresses WHERE cp4=? AND cp3=?", (cp4, cp3))
        if cursor.fetchone():
            logging.info(f"Skipping {cp4}-{cp3} (Already exists)")
            return

        cursor.execute("""
            INSERT INTO harvested_addresses (cp4, cp3, full_address, latitude, longitude, concelho, distrito)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            cp4, 
            cp3, 
            data['address'], 
            data['lat'], 
            data['lon'], 
            data.get('concelho', ''), # Scraper might need update to return these if available
            data.get('distrito', '')
        ))
        conn.commit()
        logging.info(f"SAVED: {cp4}-{cp3} -> {data['address']}")
    except Exception as e:
        logging.error(f"Error saving DB: {e}")

def run_miner():
    logging.info("--- STARTING MINING BOT ---")
    logging.info(f"Target: CP4 {START_CP4}-{END_CP4}, CP3 {START_CP3}-{END_CP3}")
    
    conn = init_db()
    
    requests_count = 0
    
    try:
        for cp4_int in range(START_CP4, END_CP4 + 1):
            cp4_str = str(cp4_int)
            
            for cp3_int in range(START_CP3, END_CP3 + 1):
                # if requests_count >= MAX_REQUESTS:
                #    logging.info(f"Reached MAX_REQUESTS limit ({MAX_REQUESTS}). Stopping for now.")
                #    return

                cp3_str = f"{cp3_int:03d}"
                
                logging.info(f"Scanning {cp4_str}-{cp3_str}...")
                requests_count += 1
                
                # 1. Scrape
                try:
                    result = scrape_cp_data(cp4_str, cp3_str)
                except Exception as e:
                    logging.error(f"Scraper crashed on {cp4_str}-{cp3_str}: {e}")
                    result = None
                
                # 2. Save if found
                if result:
                    save_address(conn, result, cp4_str, cp3_str)
                else:
                    logging.info(f"Not found: {cp4_str}-{cp3_str}")
                
                # 3. Politeness Delay
                delay = random.uniform(MIN_DELAY, MAX_DELAY)
                logging.info(f"Sleeping {delay:.2f}s...")
                time.sleep(delay)
                
    except KeyboardInterrupt:
        logging.warning("Mining Bot stopped by user (Ctrl+C).")
    finally:
        conn.close()
        logging.info("--- MINING BOT FINISHED ---")

if __name__ == "__main__":
    run_miner()
