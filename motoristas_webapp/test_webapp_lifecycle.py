import os
import sys
import asyncio
import httpx
import pandas as pd

# Ensure UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

# Ensure backend package is on path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from backend.app import app

async def run_tests():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        print("--- 1. Testing Login ---")
        res_mgr = await client.post("/api/login", json={"password": "admin123"})
        assert res_mgr.status_code == 200, f"Manager login failed: {res_mgr.text}"
        assert res_mgr.json()["role"] == "manager"
        print("[OK] Manager login successful")
        
        print("\n--- 2. Testing Daily Excel Import ---")
        sample_file = os.path.join(BASE_DIR, "Template_AppGeoRoutePlan_Exemplo.xlsx")
        with open(sample_file, "rb") as f:
            res_import = await client.post("/api/import", files={"file": ("sample.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
        assert res_import.status_code == 200, f"Import failed: {res_import.text}"
        data_import = res_import.json()
        assert data_import["success"] is True
        assert data_import["summary"]["total_stops"] == 5
        assert data_import["summary"]["total_routes"] == 2
        print(f"[OK] Excel imported: {data_import['summary']['total_stops']} stops, {data_import['summary']['total_routes']} routes")
        
        print("\n--- 3. Testing Driver Login & Route Fetch ---")
        # Driver 1 (PIN 1111)
        res_drv = await client.post("/api/login", json={"password": "1111"})
        assert res_drv.status_code == 200, f"Driver login failed: {res_drv.text}"
        drv_data = res_drv.json()
        assert drv_data["role"] == "driver"
        driver_id = drv_data["driver_id"]
        print(f"[OK] Driver {drv_data['name']} logged in (ID: {driver_id}, Route: {drv_data['route_id']})")
        
        # Fetch driver stops
        res_stops = await client.get(f"/api/driver/data?driver_id={driver_id}")
        assert res_stops.status_code == 200
        stops = res_stops.json()["stops"]
        assert len(stops) == 3
        print(f"[OK] Driver stops retrieved: {len(stops)} stops in {drv_data['route_id']}")
        
        print("\n--- 4. Testing Delivery Status Updates & POD (Signature + Photo) ---")
        # Mark stop 1 as Entregue with Signature, Receiver and Photo
        stop1_id = stops[0]["id"]
        fake_signature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        fake_photo = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="
        
        res_s1 = await client.post("/api/driver/update_stop", json={
            "stop_id": stop1_id,
            "status": "Entregue",
            "fail_reason": "",
            "driver_notes": "Portao das traseiras aberto",
            "driver_id": driver_id,
            "lat": 41.1496,
            "lng": -8.6109,
            "signature_data": fake_signature,
            "receiver_name": "António Silva (Porteiro)",
            "photo_data": fake_photo
        })
        assert res_s1.status_code == 200, f"Update stop 1 failed: {res_s1.text}"
        print("[OK] Stop 1 marked as Entregue with Digital Signature & Photo POD")
        
        # Verify stop 1 persisted in DB
        res_stops_updated = await client.get(f"/api/driver/data?driver_id={driver_id}")
        s1_updated = next(s for s in res_stops_updated.json()["stops"] if s["id"] == stop1_id)
        assert s1_updated["receiver_name"] == "António Silva (Porteiro)"
        assert s1_updated["signature_data"] == fake_signature
        assert s1_updated["photo_data"] == fake_photo
        print("[OK] POD Signature, Receiver Name and Photo verified in Driver Data response")
        
        # Mark stop 2 as Não Entregue with incident photo
        stop2_id = stops[1]["id"]
        res_s2 = await client.post("/api/driver/update_stop", json={
            "stop_id": stop2_id,
            "status": "Não Entregue",
            "fail_reason": "Cliente Ausente / Fechado",
            "driver_notes": "Tentado as 11h45. Loja fechada.",
            "driver_id": driver_id,
            "lat": 41.1579,
            "lng": -8.6291,
            "photo_data": fake_photo
        })
        assert res_s2.status_code == 200
        print("[OK] Stop 2 marked as Nao Entregue with Incident Photo (Motivo: Cliente Ausente)")
        
        print("\n--- 5. Testing GPS Ping ---")
        res_gps = await client.post("/api/driver/gps_ping", json={
            "driver_id": driver_id,
            "lat": 41.1600,
            "lng": -8.6300
        })
        assert res_gps.status_code == 200
        print("[OK] GPS ping registered")
        
        print("\n--- 6. Testing Manager Live Dashboard ---")
        res_dash = await client.get("/api/manager/dashboard")
        assert res_dash.status_code == 200
        dash = res_dash.json()
        assert dash["totals"]["total_stops"] == 5
        assert dash["totals"]["entregues"] == 1
        assert dash["totals"]["falhadas"] == 1
        assert dash["totals"]["pendentes"] == 3
        assert len(dash["activity"]) >= 2
        print(f"[OK] Manager Dashboard verified: Entregues={dash['totals']['entregues']}, Falhadas={dash['totals']['falhadas']}, Pendentes={dash['totals']['pendentes']}")
        
        print("\n--- 7. Testing Excel Export ---")
        res_export = await client.get("/api/export")
        assert res_export.status_code == 200
        temp_export = os.path.join(BASE_DIR, "data", "test_exported.xlsx")
        with open(temp_export, "wb") as f:
            f.write(res_export.content)
        
        with pd.ExcelFile(temp_export) as excel_exported:
            assert "Rotas" in excel_exported.sheet_names
            assert "Motoristas e Carros" in excel_exported.sheet_names
            assert "Justificação entregas" in excel_exported.sheet_names
            assert "Relatório de distribuição" in excel_exported.sheet_names
            df_rep = pd.read_excel(excel_exported, sheet_name="Relatório de distribuição")
            print(f"[OK] Export verified with all 4 sheets. Summary row count: {len(df_rep)}")
            
        if os.path.exists(temp_export):
            os.remove(temp_export)
            
        print("\n--- 8. Testing Clear Day Session ---")
        res_clear = await client.post("/api/clear")
        assert res_clear.status_code == 200
        res_dash_after = await client.get("/api/manager/dashboard")
        assert res_dash_after.json()["totals"]["total_stops"] == 0
        print("[OK] Day session cleared successfully")
        
        print("\n====================================================")
        print("ALL TESTS PASSED SUCCESSFULLY! 100% OPERATIONAL.")
        print("====================================================")

if __name__ == "__main__":
    asyncio.run(run_tests())
