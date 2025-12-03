import sqlite3

db_path = 'geocoding.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Checking cc_desig for CP4 2610:")
cursor.execute("SELECT DISTINCT cc_desig FROM pt_addresses WHERE CP4 = '2610'")
results = cursor.fetchall()

for row in results:
    print(f"- '{row[0]}'")

conn.close()
