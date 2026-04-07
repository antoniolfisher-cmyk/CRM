import os
from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
import models

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 24

# Used only to bootstrap the first admin account
BOOTSTRAP_USERNAME = os.getenv("CRM_USERNAME", "admin")
BOOTSTRAP_PASSWORD = os.getenv("CRM_PASSWORD", "changeme")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(username: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": username, "role": role, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def _decode(credentials: HTTPAuthorizationCredentials):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    """Returns (username, role) for any authenticated user."""
    return _decode(credentials)


def require_admin(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    """Returns (username, role) only for admin users."""
    payload = _decode(credentials)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def ensure_bootstrap_admin(db: Session):
    """Create the default admin from env vars if no users exist yet."""
    if db.query(models.User).count() == 0:
        db.add(models.User(
            username=BOOTSTRAP_USERNAME,
            password_hash=hash_password(BOOTSTRAP_PASSWORD),
            role="admin",
            is_active=True,
        ))
        db.commit()
        print(f"Created bootstrap admin: {BOOTSTRAP_USERNAME}")
