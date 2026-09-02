import sqlite3
import os
from contextlib import contextmanager

# Reference the central database file with environment variable override
DB_MULTI_PATH = os.getenv("DB_MULTI_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'geocoding_multi.db'))
DB_FILE = DB_MULTI_PATH

def get_db_connection():
    db_dir = os.path.dirname(os.path.abspath(DB_FILE))
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

@contextmanager
def get_db():
    conn = get_db_connection()
    try:
        yield conn
    finally:
        conn.close()
