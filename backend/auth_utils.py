import jwt
import hashlib
from datetime import datetime, timedelta
import bcrypt
from typing import Optional
import os

import warnings

_env = os.getenv('ENVIRONMENT', os.getenv('ENV', 'development')).lower()
raw_secret = os.getenv('SECRET_KEY')
if raw_secret and raw_secret.strip():
    SECRET_KEY = raw_secret.strip().strip('"').strip("'")
elif _env == 'production':
    raise RuntimeError("A variável de ambiente SECRET_KEY é obrigatória em produção.")
else:
    warnings.warn(
        "SECRET_KEY não definida no ambiente; a usar chave temporária apenas para desenvolvimento.",
        RuntimeWarning,
    )
    SECRET_KEY = 'georoute_dev_only_secret_key'

ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours for ease of multi-monitor use

def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    # 1. Try legacy SHA-256 hash
    salt = 'georoute2024'
    legacy_hash = hashlib.sha256((plain_password + salt).encode()).hexdigest()
    if legacy_hash == hashed_password:
        return True
    # 2. Try bcrypt
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        pass
    return False

def get_password_hash(password: str) -> str:
    # We default to bcrypt for new hashes
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({'exp': expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    try:
        decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return decoded
    except jwt.PyJWTError:
        return None
