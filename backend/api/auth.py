from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, datetime
import sys
import os

# Resolve imports from root
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from database import get_utilizador_por_id, criar_empresa, criar_utilizador, get_empresa_por_email, get_utilizador, get_db
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


from database import get_projeto_ativo, get_empresa_por_driver_password
import pandas as pd

class DriverLoginRequest(BaseModel):
    company_key: str
    pin: str

class DriverLoginResponse(BaseModel):
    access_token: str
    token_type: str
    role: str = "driver"
    empresa_id: int
    empresa_nome: str
    project_id: int
    route_name: str
    driver_name: str
    vehicle: Optional[str] = ""

@router.post("/driver-login", response_model=DriverLoginResponse)
def driver_login(req: DriverLoginRequest):
    comp_key = req.company_key.strip().upper()
    pin = req.pin.strip()
    
    if not comp_key or not pin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chave da Empresa e PIN do Motorista sao obrigatorios."
        )
        
    empresa = get_empresa_por_driver_password(comp_key)
    if not empresa:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Chave da Empresa incorreta ou empresa inativa."
        )
        
    empresa_id = empresa["id"]
    empresa_nome = empresa["nome"]
    
    # Obter projeto ativo
    active_proj = get_projeto_ativo(empresa_id)
    if not active_proj:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A distribuicao ainda nao foi ativada pelo Gestor de Trafego. Aguarde ativacao."
        )
        
    project_id = active_proj["id"]
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT payload_json FROM snapshots WHERE projeto_id = ? ORDER BY id DESC LIMIT 1", (project_id,))
        row = cursor.fetchone()
        
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nenhuma rota encontrada para o projeto ativo."
        )
        
    from utils.persistence_manager import deserialize_state
    state_dict = deserialize_state(row["payload_json"])
    raw_routes = state_dict.get("routes_solution", state_dict.get("routes_df"))
    drivers_list = state_dict.get("drivers", state_dict.get("fleet_drivers", []))
    
    assigned_route = None
    driver_name = None
    vehicle_name = None
    
    # Check in drivers list first
    if isinstance(drivers_list, list):
        for drv in drivers_list:
            if isinstance(drv, dict):
                d_pin = str(drv.get("pin", drv.get("password", ""))).strip()
                if d_pin == pin:
                    driver_name = str(drv.get("name", drv.get("driver_name", "Motorista"))).strip()
                    assigned_route = str(drv.get("route", drv.get("assigned_route_id", ""))).strip()
                    vehicle_name = str(drv.get("vehicle", drv.get("matricula", ""))).strip()
                    break
                    
    # Check in routes dataframe
    if not assigned_route and raw_routes is not None:
        df_routes = raw_routes if isinstance(raw_routes, pd.DataFrame) else pd.DataFrame(raw_routes)
        if not df_routes.empty:
            for _, r in df_routes.iterrows():
                r_pin = str(r.get("motorista_pin", r.get("pin", ""))).strip()
                if r_pin == pin:
                    driver_name = str(r.get("motorista_nome", r.get("driver_name", "Motorista"))).strip()
                    assigned_route = str(r.get("nome_rota", r.get("route_name", r.get("Rota", "")))).strip()
                    vehicle_name = str(r.get("veiculo", r.get("matricula", ""))).strip()
                    break
                    
    if not assigned_route or not driver_name:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"PIN '{pin}' nao encontrado ou sem rota atribuida no projeto ativo de hoje."
        )
        
    token = create_access_token(data={
        "sub": f"driver_{empresa_id}_{pin}",
        "role": "driver",
        "empresa_id": empresa_id,
        "empresa_nome": empresa_nome,
        "project_id": project_id,
        "route_name": assigned_route,
        "driver_name": driver_name,
        "driver_pin": pin
    })
    
    return DriverLoginResponse(
        access_token=token,
        token_type="bearer",
        role="driver",
        empresa_id=empresa_id,
        empresa_nome=empresa_nome,
        project_id=project_id,
        route_name=assigned_route,
        driver_name=driver_name,
        vehicle=vehicle_name or ""
    )
