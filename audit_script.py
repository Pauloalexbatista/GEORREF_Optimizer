import sqlite3
import random
import webbrowser
import os

DB_FILE = 'geocoding.db'

def run_audit():
    print("Starting Manual Audit (20 Random Records)...")
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Get total count
    cursor.execute("SELECT count(*) FROM pt_addresses")
    total = cursor.fetchone()[0]
    
    # Get 20 random IDs
    random_ids = random.sample(range(1, total + 1), 20)
    
    placeholders = ','.join('?' for _ in random_ids)
    query = f"SELECT full_street, LATITUDE, LONGITUDE, CP4, cc_desig FROM pt_addresses WHERE rowid IN ({placeholders})"
    
    cursor.execute(query, random_ids)
    rows = cursor.fetchall()
    
    html_content = """
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            tr:nth-child(even) { background-color: #f2f2f2; }
            th { background-color: #4CAF50; color: white; }
            a { text-decoration: none; color: blue; }
        </style>
    </head>
    <body>
        <h2>Audit Report - 20 Random Records</h2>
        <table>
            <tr>
                <th>Address</th>
                <th>CP4</th>
                <th>Concelho</th>
                <th>Lat/Lon</th>
                <th>OSM Link</th>
            </tr>
    """
    
    print(f"{'Address':<50} | {'Lat':<10} | {'Lon':<10} | {'OSM Link'}")
    print("-" * 100)
    
    for row in rows:
        addr, lat, lon, cp4, concelho = row
        osm_url = f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=18/{lat}/{lon}"
        
        print(f"{addr[:50]:<50} | {lat:<10} | {lon:<10} | {osm_url}")
        
        html_content += f"""
            <tr>
                <td>{addr}</td>
                <td>{cp4}</td>
                <td>{concelho}</td>
                <td>{lat}, {lon}</td>
                <td><a href="{osm_url}" target="_blank">Check on OSM</a></td>
            </tr>
        """
        
    html_content += """
        </table>
    </body>
    </html>
    """
    
    with open("audit_report.html", "w", encoding="utf-8") as f:
        f.write(html_content)
        
    print("\nAudit report saved to 'audit_report.html'. Opening in browser...")
    webbrowser.open('file://' + os.path.abspath("audit_report.html"))
    
    conn.close()

if __name__ == "__main__":
    run_audit()
