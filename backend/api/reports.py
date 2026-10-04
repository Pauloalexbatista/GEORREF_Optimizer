from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List
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
def export_project_final_report(project_id: int):
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="Sem dados para exportar.")
            
        state_dict = deserialize_state(row["payload_json"])
        raw_routes = state_dict.get("routes_solution")
        if raw_routes is None:
            raise HTTPException(status_code=400, detail="Sem rotas para exportar.")
            
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        df_deliveries = state_dict.get("df_entregas", state_dict.get("deliveries_df"))
        df_warehouses = state_dict.get("warehouses_df", state_dict.get("warehouses"))
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
