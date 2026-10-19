from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
import sys
import os
import io

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_projetos, get_projeto, criar_projeto, eliminar_projeto, get_db, limpar_projetos_expirados
from backend.api.auth import get_current_user, UserResponse
from datetime import datetime, date

router = APIRouter(prefix='/projects', tags=['projects'])

class ProjectCreate(BaseModel):
    nome: str
    descricao: Optional[str] = ''
    data_distribuicao: Optional[str] = None

class ProjectResponse(BaseModel):
    id: int
    nome: str
    descricao: Optional[str] = ''
    created_at: str
    data_distribuicao: Optional[str] = None
    dias_restantes: Optional[int] = 10
    status: Optional[str] = 'draft'
    is_active: Optional[int] = 0
    is_archived: Optional[bool] = False
    archive_available: Optional[bool] = False

@router.get('', response_model=List[ProjectResponse])
def list_projects(current_user: UserResponse = Depends(get_current_user)):
    try:
        # RGPD & Ciclo de Vida: Auto-arquivo de salvaguarda e purga aos 10 dias
        limpar_projetos_expirados(current_user.empresa_id, dias=10)

        projects = get_projetos(current_user.empresa_id)
        res = []
        today = datetime.now().date()
        for p in projects:
            p_status = p['status'] if 'status' in p.keys() and p['status'] else 'draft'
            is_archived = (p_status == 'arquivado')
            
            # Determinar data de referência: data_distribuicao tem precedência sobre created_at
            p_dist = p['data_distribuicao'] if 'data_distribuicao' in p.keys() and p['data_distribuicao'] else None
            ref_str = p_dist or str(p['created_at'])[:10]
            
            ref_date = today
            try:
                ref_date = datetime.strptime(str(ref_str)[:10], "%Y-%m-%d").date()
            except Exception:
                try:
                    ref_date = datetime.strptime(str(p['created_at'])[:10], "%Y-%m-%d").date()
                except Exception:
                    ref_date = today

            elapsed_days = (today - ref_date).days
            dias_rest = 0 if is_archived else max(0, 10 - elapsed_days)

            arch_path = p['archive_file_path'] if 'archive_file_path' in p.keys() and p['archive_file_path'] else ''
            archive_available = is_archived and bool(arch_path and os.path.exists(arch_path))

            res.append(ProjectResponse(
                id=p['id'],
                nome=p['nome'],
                descricao=p['descricao'] or '',
                created_at=str(p['created_at']),
                data_distribuicao=p_dist or str(p['created_at'])[:10],
                dias_restantes=dias_rest,
                status=p_status,
                is_active=int(p['is_active'] if 'is_active' in p.keys() and p['is_active'] is not None else 0),
                is_archived=is_archived,
                archive_available=archive_available
            ))
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('', response_model=ProjectResponse)
def create_new_project(req: ProjectCreate, current_user: UserResponse = Depends(get_current_user)):
    if not req.nome.strip():
        raise HTTPException(status_code=400, detail='O nome do projeto não pode ser vazio.')
        
    # Limit to 10 projects per company
    existing_projects = get_projetos(current_user.empresa_id)
    if len(existing_projects) >= 10 and not getattr(current_user, "is_superadmin", False):
        raise HTTPException(
            status_code=400,
            detail='Atingiu o limite máximo de 10 projetos por empresa. Por favor, elimine um projeto antigo para criar um novo.'
        )
        
    try:
        dist_date = req.data_distribuicao or datetime.now().strftime("%Y-%m-%d")
        proj_id = criar_projeto(current_user.empresa_id, req.nome, req.descricao, dist_date)
        proj = get_projeto(proj_id)
        if proj:
            return ProjectResponse(
                id=proj['id'],
                nome=proj['nome'],
                descricao=proj['descricao'] or '',
                created_at=str(proj['created_at']),
                data_distribuicao=dist_date,
                dias_restantes=10,
                status='draft',
                is_active=0,
                is_archived=False,
                archive_available=False
            )
        raise HTTPException(status_code=404, detail='Projeto criado mas não pôde ser recuperado.')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/{project_id}', response_model=ProjectResponse)
def get_project_details(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    try:
        proj = get_projeto(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail='Projeto não encontrado.')
            
        # Ensure it belongs to the user's company
        if proj['empresa_id'] != current_user.empresa_id and not getattr(current_user, 'is_superadmin', False):
            raise HTTPException(status_code=403, detail='Não tem permissão para aceder a este projeto.')
            
        p_status = proj['status'] if 'status' in proj.keys() and proj['status'] else 'draft'
        is_archived = (p_status == 'arquivado')
        p_dist = proj['data_distribuicao'] if 'data_distribuicao' in proj.keys() and proj['data_distribuicao'] else None
        
        today = datetime.now().date()
        try:
            ref_date = datetime.strptime(str(p_dist or proj['created_at'])[:10], "%Y-%m-%d").date()
        except Exception:
            ref_date = today
        elapsed_days = (today - ref_date).days
        dias_rest = 0 if is_archived else max(0, 10 - elapsed_days)

        arch_path = proj['archive_file_path'] if 'archive_file_path' in proj.keys() and proj['archive_file_path'] else ''
        archive_available = is_archived and bool(arch_path and os.path.exists(arch_path))

        return ProjectResponse(
            id=proj['id'],
            nome=proj['nome'],
            descricao=proj['descricao'] or '',
            created_at=str(proj['created_at']),
            data_distribuicao=p_dist or str(proj['created_at'])[:10],
            dias_restantes=dias_rest,
            status=p_status,
            is_active=int(proj['is_active'] if 'is_active' in proj.keys() and proj['is_active'] is not None else 0),
            is_archived=is_archived,
            archive_available=archive_available
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get('/{project_id}/download-archive')
def download_archived_project_excel(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    """
    Download do ficheiro Excel canónico arquivado pelo auto-arquivo de salvaguarda.
    Permite ao cliente descarregar o ficheiro mesmo após a purga da BD aos 10 dias.
    """
    proj = get_projeto(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail='Projeto não encontrado.')
    if proj['empresa_id'] != current_user.empresa_id and not getattr(current_user, 'is_superadmin', False):
        raise HTTPException(status_code=403, detail='Não tem permissão para aceder a este ficheiro.')

    arch_path = proj['archive_file_path'] if 'archive_file_path' in proj.keys() and proj['archive_file_path'] else ''
    if arch_path and os.path.exists(arch_path):
        filename = os.path.basename(arch_path)
        return FileResponse(
            path=arch_path,
            filename=filename,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    # Se não encontrar arquivo mas ainda tiver snapshot, auto-arquiva no momento
    try:
        from utils.lifecycle_manager import auto_archive_project
        new_path = auto_archive_project(project_id)
        if new_path and os.path.exists(new_path):
            with get_db() as conn:
                conn.execute("UPDATE projetos SET archive_file_path = ? WHERE id = ?", (new_path, project_id))
                conn.commit()
            return FileResponse(
                path=new_path,
                filename=os.path.basename(new_path),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
    except Exception as e:
        print(f"[Archive Download] Erro ao gerar ficheiro de arquivo sob demanda: {e}")

    raise HTTPException(status_code=404, detail='Ficheiro de arquivo não localizado no servidor.')

@router.delete('/{project_id}')
def delete_project(project_id: int, current_user: UserResponse = Depends(get_current_user)):
    try:
        proj = get_projeto(project_id)
        if not proj:
            raise HTTPException(status_code=404, detail='Projeto não encontrado.')
            
        if proj['empresa_id'] != current_user.empresa_id and not getattr(current_user, 'is_superadmin', False):
            raise HTTPException(status_code=403, detail='Não tem permissão para eliminar este projeto.')
            
        eliminar_projeto(project_id)
        return {'status': 'success', 'message': f'Projeto {project_id} eliminado com sucesso.'}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
