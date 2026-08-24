from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, datetime
import sys
import os

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_utilizador_por_id, criar_empresa, criar_utilizador, get_empresa_por_email, get_utilizador
from backend.auth_utils import verify_password, get_password_hash, create_access_token, decode_access_token

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    empresa_nome: str
    utilizador_nome: str
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str

class UserResponse(BaseModel):
    id: int
    nome: str
    email: str
    empresa_id: int
    is_admin: bool
    is_superadmin: bool = False
    data_validade: Optional[str] = "2099-12-31"
    programas: Optional[str] = "site,app"
    dias_restantes: Optional[int] = 9999

def get_current_user(token: str = Depends(oauth2_scheme)) -> UserResponse:
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido ou expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token malformado",
        )
    user = None
    try:
        user = get_utilizador_por_id(int(user_id))
    except (ValueError, TypeError):
        pass
    if not user:
        user = get_utilizador(str(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Utilizador não encontrado",
        )

    user_dict = dict(user)
    val_str = user_dict.get("data_validade") or "2099-12-31"
    dias = 9999
    try:
        dt = datetime.strptime(val_str[:10], "%Y-%m-%d").date()
        dias = (dt - date.today()).days
    except Exception:
        pass

    return UserResponse(
        id=user_dict["id"],
        nome=user_dict["nome"],
        email=user_dict["email"],
        empresa_id=user_dict["empresa_id"],
        is_admin=bool(user_dict["is_admin"]),
        is_superadmin=bool(user_dict.get("is_superadmin", 0) == 1),
        data_validade=val_str,
        programas=user_dict.get("programas", "site,app"),
        dias_restantes=dias
    )

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    user_raw = get_utilizador(req.email.strip().lower())
    if not user_raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou password incorretos"
        )
    
    user = dict(user_raw)

    # Check active status
    if not user.get("is_active", 1):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A sua conta encontra-se desativada pelo Administrador."
        )

    # Check license expiration date (if not superadmin)
    is_super = bool(user.get("is_superadmin", 0) == 1)
    valid_date_str = user.get("data_validade")
    if not is_super and valid_date_str:
        try:
            dt = datetime.strptime(valid_date_str[:10], "%Y-%m-%d").date()
            if dt < date.today():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"A sua subscrição expirou em {dt.strftime('%d/%m/%Y')}. Por favor, contacte o Administrador para renovar o seu acesso."
                )
        except HTTPException:
            raise
        except Exception:
            pass

    # Check password
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou password incorretos"
        )
    
    # Generate token
    token = create_access_token(data={"sub": str(user["id"]), "email": user["email"]})
    return TokenResponse(access_token=token, token_type="bearer")

@router.post("/register")
def register():
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="O registo público de contas está desativado. O acesso é gerido exclusivamente pelo Administrador."
    )

@router.get("/me", response_model=UserResponse)
def get_me(current_user: UserResponse = Depends(get_current_user)):
    return current_user
