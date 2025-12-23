import sqlite3

conn = sqlite3.connect('geocoding.db')
cursor = conn.cursor()

print("Tabelas na base de dados:")
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = cursor.fetchall()
for table in tables:
    print(f"  - {table[0]}")

conn.close()
