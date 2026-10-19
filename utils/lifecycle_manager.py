# -*- coding: utf-8 -*-
"""
GEORREF Optimizer - Lifecycle Manager
Gestão do Ciclo de Vida da Distribuição (7 a 10 dias) com Auto-Arquivo de Salvaguarda e Purga SQLite.
"""

import os
import re
import io
import pandas as pd
from datetime import datetime, date
from typing import Optional

from database import get_db, get_projeto
from utils.persistence_manager import deserialize_state
from utils.export_engine import generate_full_project_excel
from utils.template_manager import create_unified_project_template

STORAGE_BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "archives")

def ensure_archive_storage(empresa_id: int) -> str:
    """Garante que a pasta de arquivo para a empresa existe no disco."""
    empresa_dir = os.path.join(STORAGE_BASE_DIR, str(empresa_id))
    os.makedirs(empresa_dir, exist_ok=True)
    return empresa_dir

def parse_date_safely(date_val) -> Optional[date]:
    """Converte valores variados para um objeto date."""
    if not date_val:
        return None
    s = str(date_val).strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None

def auto_archive_project(project_id: int) -> Optional[str]:
    """
    Gera o ficheiro Excel canónico final de 9 abas de salvaguarda
    e grava-o na pasta de arquivo da empresa.
    Retorna o caminho do ficheiro gerado ou None se falhar.
    """
    proj = get_projeto(project_id)
    if not proj:
        return None

    empresa_id = proj["empresa_id"]
    archive_dir = ensure_archive_storage(empresa_id)

    # 1. Recuperar snapshot mais recente se existir
    excel_bytes = None
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()

        if row and row["payload_json"]:
            try:
                state_dict = deserialize_state(row["payload_json"])
                raw_routes = state_dict.get("routes_solution")
                df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes or [])
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
            except Exception as e:
                print(f"[Lifecycle Manager] Erro ao serializar snapshot do projeto {project_id}: {e}")

    # Fallback se não conseguiu gerar a partir do snapshot
    if not excel_bytes:
        try:
            excel_bytes = create_unified_project_template()
        except Exception as e:
            print(f"[Lifecycle Manager] Falha no template base para auto-arquivo: {e}")
            return None

    # Formatar nome seguro do ficheiro de arquivo
    safe_name = re.sub(r'[^\w\s-]', '', str(proj['nome'])).strip().replace(' ', '_') or f"Projeto_{project_id}"
    data_str = str(proj['data_distribuicao'] if 'data_distribuicao' in proj.keys() and proj['data_distribuicao'] else str(proj['created_at'])[:10]).replace('-', '')
    filename = f"GeoRoutePlan_ARQUIVO_{safe_name}_{data_str}_{project_id}.xlsx"
    filepath = os.path.join(archive_dir, filename)

    try:
        with open(filepath, "wb") as f:
            f.write(excel_bytes)
        print(f"[Lifecycle Manager] Auto-Arquivo gravado com sucesso: {filepath}")
        return filepath
    except Exception as e:
        print(f"[Lifecycle Manager] Erro ao gravar ficheiro de arquivo: {e}")
        return None

def process_project_lifecycle(empresa_id: Optional[int] = None):
    """
    Avalia a temporalidade dos projetos (10 dias a contar da data_distribuicao).
    Se atingir os 10 dias:
    1. Salva automaticamente o Excel canónico no storage permanente de arquivo da empresa.
    2. Purga as tabelas operacionais da BD SQLite (entregas, rotas, snapshots).
    3. Marca o projeto como 'arquivado'.
    """
    today = datetime.now().date()
    query = "SELECT * FROM projetos WHERE (status IS NULL OR status != 'arquivado')"
    params = []
    if empresa_id is not None:
        query += " AND empresa_id = ?"
        params.append(empresa_id)

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(query, tuple(params))
        projects = cursor.fetchall()

    for p in projects:
        proj_id = p["id"]
        # Determinar data de referência: data_distribuicao tem precedência sobre created_at
        p_dist = p["data_distribuicao"] if "data_distribuicao" in p.keys() and p["data_distribuicao"] else None
        p_created = p["created_at"]

        ref_date = parse_date_safely(p_dist) or parse_date_safely(p_created) or today
        days_elapsed = (today - ref_date).days

        # Limite rígido de 10 dias
        if days_elapsed >= 10:
            print(f"[Lifecycle Manager] Projeto {proj_id} atingiu {days_elapsed} dias (>=10). A iniciar Auto-Arquivo e Purga...")
            # 1. Gerar Excel de salvaguarda
            archive_path = auto_archive_project(proj_id)
            
            # 2. Purgar tabelas operacionais e marcar como arquivado
            with get_db() as conn:
                cur = conn.cursor()
                cur.execute("DELETE FROM entregas WHERE projeto_id = ?", (proj_id,))
                cur.execute("DELETE FROM rotas WHERE projeto_id = ?", (proj_id,))
                cur.execute("DELETE FROM snapshots WHERE projeto_id = ?", (proj_id,))
                try:
                    cur.execute("DELETE FROM consumos_google WHERE projeto_id = ?", (proj_id,))
                except Exception:
                    pass

                cur.execute("""
                    UPDATE projetos 
                    SET status = 'arquivado', 
                        is_active = 0, 
                        archived_at = CURRENT_TIMESTAMP, 
                        archive_file_path = ? 
                    WHERE id = ?
                """, (archive_path or '', proj_id))
                conn.commit()
            print(f"[Lifecycle Manager] Projeto {proj_id} purgado da BD operacional e arquivado com sucesso.")
