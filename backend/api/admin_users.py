from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, date
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import (
    listar_todos_utilizadores_admin,
    criar_utilizador_admin,
    atualizar_utilizador_admin,
    eliminar_utilizador_admin,
    toggle_utilizador_status_admin,
    get_utilizador
)
from backend.auth_utils import get_password_hash
from backend.api.auth import get_current_user, UserResponse

router = APIRouter(prefix="/admin", tags=["admin"])

def require_admin(current_user: UserResponse = Depends(get_current_user)):
    if not getattr(current_user, "is_superadmin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acesso reservado ao Administrador do Sistema."
        )
    return current_user

class AdminUserItem(BaseModel):
    id: int
    empresa_id: int
    empresa_nome: str
    responsavel: str
    email: str
    is_admin: bool
    is_superadmin: bool
    is_active: bool
    data_validade: str
    programas: str
    dias_restantes: int
    password_plain: Optional[str] = None
    driver_password: Optional[str] = ""
    created_at: Optional[str] = None

class CreateUserPayload(BaseModel):
    empresa_nome: str
    responsavel: str
    email: EmailStr
    password: str
    data_validade: str = "2027-12-31"
    programas: str = "site,app"
    driver_password: Optional[str] = ""
    is_admin: bool = False

class UpdateUserPayload(BaseModel):
    empresa_nome: str
    responsavel: str
    email: EmailStr
    password: Optional[str] = None
    data_validade: str = "2027-12-31"
    programas: str = "site,app"
    is_active: bool = True

def compute_days_left(valid_date_str: str) -> int:
    try:
        dt = datetime.strptime(valid_date_str[:10], "%Y-%m-%d").date()
        today = date.today()
        diff = (dt - today).days
        return diff
    except Exception:
        return 9999

@router.get("/users", response_model=List[AdminUserItem])
def get_all_users(admin: UserResponse = Depends(require_admin)):
    raw_users = listar_todos_utilizadores_admin()
    results = []
    for u in raw_users:
        dias = compute_days_left(u.get("data_validade", "2099-12-31"))
        results.append(AdminUserItem(
            id=u["id"],
            empresa_id=u.get("empresa_id", 0),
            empresa_nome=u.get("empresa_nome") or "Sem Empresa",
            responsavel=u.get("responsavel") or u.get("nome") or "Utilizador",
            email=u.get("email", ""),
            is_admin=bool(u.get("is_admin", 0)),
            is_superadmin=bool(u.get("is_superadmin", 0)),
            is_active=bool(u.get("is_active", 1)),
            data_validade=u.get("data_validade", "2099-12-31"),
            programas=u.get("programas", "site,app"),
            dias_restantes=dias,
            password_plain=u.get("password_plain") if admin.is_superadmin else None,
            created_at=str(u.get("created_at", ""))
        ))
    return results

@router.post("/users", response_model=AdminUserItem)
def create_user(payload: CreateUserPayload, admin: UserResponse = Depends(require_admin)):
    if get_utilizador(payload.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Já existe uma conta com este endereço de email."
        )
    if len(payload.password) < 4:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A password deve conter pelo menos 4 caracteres."
        )

    pwd_hash = get_password_hash(payload.password)
    user_id = criar_utilizador_admin(
        empresa_nome=payload.empresa_nome,
        responsavel=payload.responsavel,
        email=payload.email,
        password_plain=payload.password,
        password_hash=pwd_hash,
        data_validade=payload.data_validade,
        programas=payload.programas,
        is_admin=payload.is_admin
    )
    
    dias = compute_days_left(payload.data_validade)
    return AdminUserItem(
        id=user_id,
        empresa_id=1,
        empresa_nome=payload.empresa_nome,
        responsavel=payload.responsavel,
        email=payload.email,
        is_admin=payload.is_admin,
        is_superadmin=False,
        is_active=True,
        data_validade=payload.data_validade,
        programas=payload.programas,
        dias_restantes=dias,
        password_plain=payload.password
    )

@router.put("/users/{user_id}")
def update_user(user_id: int, payload: UpdateUserPayload, admin: UserResponse = Depends(require_admin)):
    pwd_hash = None
    pwd_plain = None
    if payload.password and len(payload.password.strip()) > 0:
        if len(payload.password) < 4:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A password deve conter pelo menos 4 caracteres."
            )
        pwd_plain = payload.password.strip()
        pwd_hash = get_password_hash(pwd_plain)

    try:
        atualizar_utilizador_admin(
            user_id=user_id,
            empresa_nome=payload.empresa_nome,
            responsavel=payload.responsavel,
            email=payload.email,
            password_plain=pwd_plain,
            password_hash=pwd_hash,
            data_validade=payload.data_validade,
            programas=payload.programas,
            is_active=1 if payload.is_active else 0
        )
        return {"status": "success", "message": "Utilizador atualizado com sucesso."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: UserResponse = Depends(require_admin)):
    try:
        success = eliminar_utilizador_admin(user_id)
        if not success:
            raise HTTPException(status_code=404, detail="Utilizador não encontrado.")
        return {"status": "success", "message": "Utilizador eliminado com sucesso."}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/users/{user_id}/toggle-status")
def toggle_status(user_id: int, admin: UserResponse = Depends(require_admin)):
    try:
        new_status = toggle_utilizador_status_admin(user_id)
        if new_status is None:
            raise HTTPException(status_code=404, detail="Utilizador não encontrado.")
        return {"status": "success", "is_active": new_status}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/consumptions")
def get_admin_consumptions(current_user: UserResponse = Depends(require_admin)):
    try:
        from database import obter_resumo_consumos_admin
        from utils.google_routes_engine import USAGE_FILE
        import json
        
        resumo = obter_resumo_consumos_admin()
        
        quota_limit = 1000
        count_json = 0
        total_all_time = 0
        current_month = ""
        if os.path.exists(USAGE_FILE):
            try:
                with open(USAGE_FILE, "r", encoding="utf-8") as f:
                    u_data = json.load(f)
                    quota_limit = u_data.get("limit", 1000)
                    count_json = u_data.get("count", 0)
                    total_all_time = u_data.get("total_all_time", 0)
                    current_month = u_data.get("current_month", "")
            except Exception:
                pass
                
        resumo["quota_limit"] = quota_limit
        resumo["quota_count"] = max(count_json, resumo["total_pedidos_mes"])
        resumo["total_all_time"] = total_all_time
        resumo["current_month"] = current_month
        
        return resumo
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
