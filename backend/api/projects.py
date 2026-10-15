from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import sys
import os

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_projetos, get_projeto, criar_projeto, eliminar_projeto, get_db, limpar_projetos_expirados
from backend.api.auth import get_current_user, UserResponse
from datetime import datetime

router = APIRouter(prefix='/projects', tags=['projects'])

class ProjectCreate(BaseModel):
    nome: str
    descricao: Optional[str] = ''

class ProjectResponse(BaseModel):
    id: int
    nome: str
    descricao: Optional[str] = ''
    created_at: str
    dias_restantes: Optional[int] = 7
    is_active: Optional[int] = 0

@router.get('', response_model=List[ProjectResponse])
def list_projects(current_user: UserResponse = Depends(get_current_user)):
    try:
        # RGPD & Clean-up: Auto-limpeza de projetos não ativos com mais de 7 dias
        limpar_projetos_expirados(current_user.empresa_id, dias=7)

        projects = get_projetos(current_user.empresa_id)
        res = []
        now = datetime.now()
        for p in projects:
            dias_rest = 7
            try:
                c_date = datetime.strptime(str(p['created_at'])[:19], "%Y-%m-%d %H:%M:%S")
                elapsed_days = (now - c_date).total_seconds() / 86400.0
                dias_rest = max(0, int(7 - elapsed_days))
            except Exception:
                dias_rest = 7

            res.append(ProjectResponse(
                id=p['id'],
                nome=p['nome'],
                descricao=p['descricao'] or '',
                created_at=str(p['created_at']),
                dias_restantes=dias_rest,
                is_active=int(p['is_active'] if 'is_active' in p.keys() and p['is_active'] is not None else 0)
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
        proj_id = criar_projeto(current_user.empresa_id, req.nome, req.descricao)
        proj = get_projeto(proj_id)
        if proj:
            return ProjectResponse(
                id=proj['id'],
                nome=proj['nome'],
                descricao=proj['descricao'] or '',
                created_at=proj['created_at']
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
            
        return ProjectResponse(
            id=proj['id'],
            nome=proj['nome'],
            descricao=proj['descricao'] or '',
            created_at=proj['created_at']
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
