from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
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
    return UserResponse(
        id=user["id"],
        nome=user["nome"],
        email=user["email"],
        empresa_id=user["empresa_id"],
        is_admin=bool(user["is_admin"])
    )

@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    user = get_utilizador(req.email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou password incorretos"
        )
    # Check password
    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou password incorretos"
        )
    
    # Generate token
    token = create_access_token(data={"sub": str(user["id"]), "email": user["email"]})
    return TokenResponse(access_token=token, token_type="bearer")

@router.post("/register", response_model=UserResponse)
def register(req: RegisterRequest):
    if len(req.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A password deve ter pelo menos 6 caracteres."
        )
        
    # Check if email exists
    if get_empresa_por_email(req.email) or get_utilizador(req.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este email já está registado."
        )
        
    try:
        empresa_id = criar_empresa(req.empresa_nome, req.email, plano="starter")
        # Store password using bcrypt hash
        hashed_pwd = get_password_hash(req.password)
        user_id = criar_utilizador(empresa_id, req.utilizador_nome, req.email, hashed_pwd, is_admin=True)
        return UserResponse(
            id=user_id,
            nome=req.utilizador_nome,
            email=req.email,
            empresa_id=empresa_id,
            is_admin=True
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao criar conta: {str(e)}"
        )

@router.get("/me", response_model=UserResponse)
def get_me(current_user: UserResponse = Depends(get_current_user)):
    return current_user
