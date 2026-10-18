from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional
from datetime import datetime
import io
import pandas as pd
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_db, get_projeto
from backend.api.auth import get_current_user, UserResponse
from utils.persistence_manager import deserialize_state
from utils.export_engine import generate_full_project_excel

router = APIRouter(prefix="/reports", tags=["reports"])

@router.get("/{project_id}/summary")
def get_project_reports_summary(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        
        if not row:
            return {"empty": True}
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        
        if raw_routes is None:
            return {"empty": True}
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if df_routes.empty:
            return {"empty": True}
            
        total_stops = len(df_routes)
        estado_series = df_routes.get("Estado", pd.Series(["Pendente"] * total_stops))
        entregues = int((estado_series == "Entregue").sum())
        falhadas = int((estado_series == "Não Entregue").sum())
        pendentes = total_stops - entregues - falhadas
        rate = round((entregues / total_stops * 100), 1) if total_stops > 0 else 0.0
        
        total_km = round(float(df_routes["KM_Anterior"].fillna(0).astype(float).sum()), 1) if "KM_Anterior" in df_routes.columns else 0.0
        total_weight = round(float(df_routes["Peso"].fillna(0).astype(float).sum()), 1) if "Peso" in df_routes.columns else 0.0
        total_packages = int(df_routes["Volumes"].fillna(1).astype(int).sum()) if "Volumes" in df_routes.columns else total_stops
        
        # Timing metrics
        times = []
        if "Hora_Picagem" in df_routes.columns:
            for t in df_routes["Hora_Picagem"].dropna():
                t_str = str(t).strip()
                if t_str and t_str not in ["-", "None", "nan", ""]:
                    times.append(t_str)
        times.sort()
        first_time = times[0] if times else "--:--"
        last_time = times[-1] if times else "--:--"
        
        # Route & driver breakdown
        route_stats = []
        for r_name, group in df_routes.groupby("Rota"):
            if str(r_name).lower() in ["por distribuir", "pendente", "nan", ""]:
                continue
            r_total = len(group)
            r_est_series = group.get("Estado", pd.Series(["Pendente"] * r_total))
            r_ent = int((r_est_series == "Entregue").sum())
            r_fal = int((r_est_series == "Não Entregue").sum())
            r_km = round(float(group["KM_Anterior"].fillna(0).astype(float).sum()), 1) if "KM_Anterior" in group.columns else 0.0
            r_weight = round(float(group["Peso"].fillna(0).astype(float).sum()), 1) if "Peso" in group.columns else 0.0
            r_vol = int(group["Volumes"].fillna(1).astype(int).sum()) if "Volumes" in group.columns else r_total
            
            drv_name = str(group.iloc[0].get("Motorista", "Não Atribuído")) if "Motorista" in group.columns and pd.notna(group.iloc[0].get("Motorista")) else "Não Atribuído"
            veh_name = str(group.iloc[0].get("Viatura", group.iloc[0].get("Matricula", "-"))) if "Viatura" in group.columns and pd.notna(group.iloc[0].get("Viatura")) else "-"
            
            route_stats.append({
                "route_name": str(r_name),
                "driver_name": drv_name,
                "vehicle": veh_name,
                "total": r_total,
                "entregues": r_ent,
                "falhadas": r_fal,
                "pendentes": r_total - r_ent - r_fal,
                "rate": round((r_ent / r_total * 100), 1) if r_total > 0 else 0.0,
                "km": r_km,
                "weight": r_weight,
                "volumes": r_vol
            })
            
        # Failure reasons count
        reasons_dist = {}
        if "Motivo_Falha" in df_routes.columns:
            for val in df_routes["Motivo_Falha"].dropna():
                val_str = str(val).strip()
                if val_str and val_str not in ["-", "None", "nan", ""]:
                    reasons_dist[val_str] = reasons_dist.get(val_str, 0) + 1
                    
        return {
            "empty": False,
            "project_name": proj["nome"],
            "totals": {
                "total_stops": total_stops,
                "entregues": entregues,
                "falhadas": falhadas,
                "pendentes": pendentes,
                "rate": rate,
                "total_km": total_km,
                "total_weight": total_weight,
                "total_packages": total_packages,
                "total_routes": len(route_stats),
                "first_delivery_time": first_time,
                "last_delivery_time": last_time
            },
            "routes": route_stats,
            "reasons": reasons_dist
        }

@router.get("/{project_id}/export")
def export_project_final_report(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    proj = get_projeto(project_id)
    if not proj or (proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False)):
        raise HTTPException(status_code=403, detail="Não tem permissão para aceder aos dados deste projeto.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        if not row:
            from utils.template_manager import create_unified_project_template
            from fastapi.responses import Response
            template_data = create_unified_project_template()
            return Response(
                content=template_data,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename=GeoRoutePlan_Modelo_{project_id}.xlsx"}
            )
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        if raw_routes is None:
            from utils.template_manager import create_unified_project_template
            from fastapi.responses import Response
            template_data = create_unified_project_template()
            return Response(
                content=template_data,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename=GeoRoutePlan_Modelo_{project_id}.xlsx"}
            )
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        df_deliveries = (
            state_dict.get("clients_geocoded")
            if state_dict.get("clients_geocoded") is not None
            else state_dict.get("df_entregas", state_dict.get("deliveries_df"))
        )
        df_warehouses = (
            state_dict.get("warehouses_geocoded")
            if state_dict.get("warehouses_geocoded") is not None
            else state_dict.get("df_warehouses", state_dict.get("warehouses_used", state_dict.get("warehouses")))
        )
        fleet_cfg = state_dict.get("fleet_config", state_dict.get("fleet"))
        opt_params = state_dict.get("optimization_params")
        rules_mat = state_dict.get("rules_matrix")
        drivers_data = state_dict.get("drivers", state_dict.get("motoristas"))
        reasons_data = state_dict.get("failure_reasons", [
            {"reason": "Cliente Ausente / Fechado", "category": "Ausência"},
            {"reason": "Cliente Recusou a Carga", "category": "Recusa"},
            {"reason": "Morada Não Encontrada / Errada", "category": "Morada"},
            {"reason": "Mercadoria Danificada", "category": "Avaria"},
            {"reason": "Falta de Tempo / Fora de Horas", "category": "Operacional"},
            {"reason": "Sem Dinheiro para Cobrança", "category": "Financeiro"}
        ])

    # Generate canonical 9-sheet Excel
    excel_bytes = generate_full_project_excel(
        routes_df=df_routes,
        deliveries_df=df_deliveries,
        warehouses_df=df_warehouses,
        fleet_config=fleet_cfg,
        optimization_params=opt_params,
        rules_matrix=rules_mat,
        drivers_data=drivers_data,
        reasons_data=reasons_data
    )
    
    filename = f"GeoRoutePlan_Fecho_{proj['nome'].replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/{project_id}/export-mobiliario")
def export_mobiliario_files(
    project_id: int,
    single_file: Optional[str] = None,
    current_user: UserResponse = Depends(get_current_user)
):
    """
    Exportação Mobiliário: gera 'RotasMobiliario+data.txt' e 'coordenadasMobiliaria+data.txt'
    no formato estrito compatível com o sistema ERP da empresa (ex: WinRoute).
    """
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    if proj["empresa_id"] != current_user.empresa_id and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este projeto.")

    import zipfile
    import re

    date_str = datetime.now().strftime("%Y%m%d")
    today_disp = datetime.now().strftime("%d/%m/%Y")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        
        cursor.execute("SELECT codigo_cliente, latitude, longitude, armazem, rota, ordem_paragem FROM entregas WHERE projeto_id = ?", (project_id,))
        db_entregas = cursor.fetchall()
        
        cursor.execute("SELECT veiculo, armazem, horario_inicio, horario_fim, motorista_nome, codigo_veiculo, codigo_motorista FROM frota WHERE projeto_id = ? AND is_active = 1", (project_id,))
        db_frota = cursor.fetchall()

    if not row and not db_entregas:
        raise HTTPException(status_code=400, detail="Sem dados para exportar.")

    state_dict = deserialize_state(row["payload_json"]) if row else {}
    raw_routes = state_dict.get("routes_solution")
    df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes or [])
    
    mob_meta = state_dict.get("mobiliario_meta", {})
    store_map = mob_meta.get("store_map", {})
    veh_to_id = mob_meta.get("veh_to_id", {})
    driver_to_id = mob_meta.get("driver_to_id", {})
    service_date = state_dict.get("service_date", datetime.now().strftime("%Y-%m-%d"))

    # Mapear frota
    fleet_meta = {}
    for f_row in db_frota:
        v_name = f_row["veiculo"]
        fleet_meta[v_name] = {
            "armazem": f_row["armazem"],
            "horario_inicio": f_row["horario_inicio"] or "07:00:00",
            "horario_fim": f_row["horario_fim"] or "20:00:00",
            "codigo_veiculo": f_row["codigo_veiculo"] or veh_to_id.get(v_name, v_name),
            "codigo_motorista": f_row["codigo_motorista"] or driver_to_id.get(v_name, "6765")
        }

    # 1. Gerar coordenadasMobiliaria+data.txt
    coord_lines = []
    seen_docs = set()
    for d in db_entregas:
        doc = str(d["codigo_cliente"]).strip()
        lat = float(d["latitude"] or 0.0)
        lon = float(d["longitude"] or 0.0)
        if doc and doc not in seen_docs and (lat != 0.0 or lon != 0.0):
            seen_docs.add(doc)
            coord_lines.append(f"{doc}\t{lon:.6f}\t{lat:.6f}\n")

    if not coord_lines and "clients_geocoded" in state_dict:
        cg = state_dict["clients_geocoded"]
        if isinstance(cg, pd.DataFrame):
            for _, r in cg.iterrows():
                doc = str(r.get("Doc_ID") or r.get("Codigo_Cliente") or "").strip()
                lat = float(r.get("Latitude") or 0.0)
                lon = float(r.get("Longitude") or 0.0)
                if doc and doc not in seen_docs and (lat != 0.0 or lon != 0.0):
                    seen_docs.add(doc)
                    coord_lines.append(f"{doc}\t{lon:.6f}\t{lat:.6f}\n")

    coord_content = "".join(coord_lines)

    # 2. Gerar RotasMobiliario+data.txt (17 colunas canónicas)
    rotas_lines = []
    if not df_routes.empty:
        route_col = None
        for cand in ["Rota", "Veiculo", "veiculo", "rota"]:
            if cand in df_routes.columns:
                route_col = cand
                break

        if route_col:
            valid_routes_df = df_routes[~df_routes[route_col].isin(["Por Distribuir", "Não Distribuído", "Pendente", ""])]
            route_groups = valid_routes_df.groupby(route_col)
            
            for r_idx, (veh_name, g_df) in enumerate(route_groups, 1):
                f_info = fleet_meta.get(veh_name, {})
                v_code = f_info.get("codigo_veiculo") or veh_to_id.get(veh_name, str(r_idx + 5500))
                d_code = f_info.get("codigo_motorista") or driver_to_id.get(veh_name, "6765")
                wh_name = f_info.get("armazem", "19")
                
                wh_id = "19"
                for s_id, s_info in store_map.items():
                    if s_info.get("Nome") == wh_name or s_id in wh_name:
                        wh_id = s_id
                        break
                if wh_id == "19":
                    m = re.search(r'\b(\d{1,3})\b', wh_name)
                    if m:
                        wh_id = m.group(1)

                start_hour = f_info.get("horario_inicio", "07:00:00")
                if len(start_hour) == 5:
                    start_hour += ":00"
                start_dt = f"{today_disp} {start_hour}"

                km_col = None
                for k in ["Distancia_Acumulada_KM", "Distancia_KM", "KM", "km"]:
                    if k in g_df.columns:
                        km_col = k
                        break
                total_km = 0.0
                if km_col:
                    try:
                        total_km = float(g_df[km_col].dropna().iloc[-1])
                    except Exception:
                        total_km = float(g_df[km_col].sum())
                if total_km == 0.0:
                    total_km = round(len(g_df) * 18.5, 3)

                end_hour = f_info.get("horario_fim", "18:00:00")
                if len(end_hour) == 5:
                    end_hour += ":00"
                end_dt = f"{today_disp} {end_hour}"

                ord_col = None
                for oc in ["Ordem", "Ordem_Paragem", "ordem", "seq"]:
                    if oc in g_df.columns:
                        ord_col = oc
                        break
                sorted_stops = g_df.sort_values(ord_col) if ord_col else g_df

                for stop_idx, (_, s_row) in enumerate(sorted_stops.iterrows(), 1):
                    doc_id = str(s_row.get("Doc_ID") or s_row.get("Codigo_Cliente") or s_row.get("ID_Original") or f"CLI_{stop_idx}").strip()
                    num_doc = re.sub(r'[^0-9]', '', doc_id) or doc_id

                    arr_val = str(s_row.get("Hora_Chegada_Prevista") or "").strip()
                    dep_val = str(s_row.get("Hora_Saida_Prevista") or "").strip()
                    if not arr_val or arr_val in ["-", "None", "nan"]:
                        base_h = 8 + (stop_idx * 35) // 60
                        base_m = (stop_idx * 35) % 60
                        arr_val = f"{base_h:02d}:{base_m:02d}:00"
                    elif len(arr_val) == 5:
                        arr_val += ":00"

                    if not dep_val or dep_val in ["-", "None", "nan"]:
                        dep_val = arr_val
                    elif len(dep_val) == 5:
                        dep_val += ":00"

                    arr_dt = f"{today_disp} {arr_val}" if " " not in arr_val else arr_val
                    dep_dt = f"{today_disp} {dep_val}" if " " not in dep_val else dep_val

                    step_val = str(stop_idx * 3)

                    row_parts = [
                        str(r_idx),              # 0: Route_Num
                        str(wh_id),              # 1: Wh_ID
                        str(v_code),             # 2: Veh_ID
                        str(d_code),             # 3: Driver_ID
                        start_dt,                # 4: Start_DT
                        end_dt,                  # 5: End_DT
                        f"{total_km:.6f}",       # 6: Total_KM
                        step_val,                # 7: Step_Idx
                        arr_dt,                  # 8: Arrival_DT
                        dep_dt,                  # 9: Departure_DT
                        "2",                     # 10
                        "2",                     # 11
                        "",                      # 12
                        doc_id,                  # 13: Doc_ID
                        service_date,            # 14: Data (YYYY-MM-DD)
                        "5",                     # 15
                        num_doc                  # 16: Doc_ID numérico
                    ]
                    rotas_lines.append("\t".join(row_parts) + "\n")

    rotas_content = "".join(rotas_lines)

    if single_file == "coordenadas":
        fn = f"coordenadasMobiliaria_{date_str}.txt"
        return StreamingResponse(
            io.BytesIO(coord_content.encode("utf-8")),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={fn}"}
        )
    elif single_file == "rotas":
        fn = f"RotasMobiliario_{date_str}.txt"
        return StreamingResponse(
            io.BytesIO(rotas_content.encode("utf-8")),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f"attachment; filename={fn}"}
        )
    else:
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"coordenadasMobiliaria_{date_str}.txt", coord_content.encode("utf-8"))
            zf.writestr(f"RotasMobiliario_{date_str}.txt", rotas_content.encode("utf-8"))
        zip_buffer.seek(0)

        zip_fn = f"Exportacao_Mobiliario_{date_str}.zip"
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={zip_fn}"}
        )
