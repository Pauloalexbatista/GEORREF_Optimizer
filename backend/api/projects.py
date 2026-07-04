from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional
import sys
import os

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_projetos, get_projeto, criar_projeto, get_db
from backend.api.auth import get_current_user, UserResponse

router = APIRouter(prefix='/projects', tags=['projects'])

class ProjectCreate(BaseModel):
    nome: str
    descricao: Optional[str] = ''

class ProjectResponse(BaseModel):
    id: int
    nome: str
    descricao: Optional[str] = ''
    created_at: str

@router.get('/', response_model=List[ProjectResponse])
def list_projects(current_user: UserResponse = Depends(get_current_user)):
    try:
        projects = get_projetos(current_user.empresa_id)
        res = []
        for p in projects:
            res.append(ProjectResponse(
                id=p['id'],
                nome=p['nome'],
                descricao=p['descricao'] or '',
                created_at=p['created_at']
            ))
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post('/', response_model=ProjectResponse)
def create_new_project(req: ProjectCreate, current_user: UserResponse = Depends(get_current_user)):
    if not req.nome.strip():
        raise HTTPException(status_code=400, detail='O nome do projeto não pode ser vazio.')
        
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
        if proj['empresa_id'] != current_user.empresa_id:
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
