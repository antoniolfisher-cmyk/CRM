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

SECRET_KEY          = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM           = "HS256"
TOKEN_EXPIRE_HOURS  = 24 * 7   # 7 days

BOOTSTRAP_USERNAME   = os.getenv("CRM_USERNAME", "admin")
BOOTSTRAP_PASSWORD   = os.getenv("CRM_PASSWORD", "changeme")
SUPERADMIN_USERNAME  = os.getenv("SUPERADMIN_USERNAME", BOOTSTRAP_USERNAME)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer      = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    company_name: str
    slug: str            # workspace slug e.g. "acme-store"
    username: str
    email: str
    password: str
    plan: str = "starter"


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(username: str, role: str, tenant_id: int) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {
            "sub":           username,
            "role":          role,
            "tenant_id":     tenant_id,
            "is_superadmin": (username == SUPERADMIN_USERNAME),
            "exp":           expire,
        },
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
    """Returns JWT payload dict: {sub, role, tenant_id}"""
    return _decode(credentials)


def require_admin(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    """Returns JWT payload only for admin users."""
    payload = _decode(credentials)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload


def require_superadmin(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    """Platform-level superadmin only. Reads SUPERADMIN_USERNAME env var fresh every call."""
    payload = _decode(credentials)
    superadmin = os.getenv("SUPERADMIN_USERNAME", os.getenv("CRM_USERNAME", "admin"))
    if payload.get("sub") != superadmin:
        raise HTTPException(status_code=403, detail="Platform admin access required")
    return payload


def get_tenant_id(current: dict = Depends(require_auth)) -> int:
    """Extracts tenant_id from the JWT payload."""
    tid = current.get("tenant_id")
    if not tid:
        raise HTTPException(status_code=401, detail="No tenant associated with this account")
    return int(tid)


def ensure_bootstrap_admin(db: Session):
    """
    On first startup:
    1. Create the default Tenant (id auto-assigned)
    2. Create the admin user tied to that tenant
    3. If Amazon env vars are set, migrate them into AmazonCredential for tenant 1

    Emergency recovery:
    Set RESET_PASSWORD_FOR=username:newpassword in Railway Variables.
    On next deploy the password is reset, then remove the variable.
    """
    # ── Emergency password reset via env var ─────────────────────────────────
    _reset = os.getenv("RESET_PASSWORD_FOR", "").strip()
    if _reset and ":" in _reset:
        _reset_user, _reset_pass = _reset.split(":", 1)
        _reset_user = _reset_user.strip()
        _reset_pass = _reset_pass.strip()
        if _reset_user and _reset_pass:
            _u = db.query(models.User).filter(models.User.username == _reset_user).first()
            if _u:
                _u.password_hash = hash_password(_reset_pass)
                _u.is_active = True
                db.commit()
                print(f"[recovery] Password reset for user '{_reset_user}' via RESET_PASSWORD_FOR env var. REMOVE THIS VARIABLE NOW.")
            else:
                # List all users to help debug
                _all = db.query(models.User).all()
                print(f"[recovery] User '{_reset_user}' not found. Existing users: {[u.username for u in _all]}")

    if db.query(models.Tenant).count() == 0:
        tenant = models.Tenant(
            name="Default",
            slug="default",
            plan="enterprise",   # full access for self-hosted
            is_active=True,
        )
        db.add(tenant)
        db.flush()   # get the auto-assigned id

        admin = models.User(
            tenant_id=tenant.id,
            username=BOOTSTRAP_USERNAME,
            password_hash=hash_password(BOOTSTRAP_PASSWORD),
            role="admin",
            is_active=True,
        )
        db.add(admin)

        # Migrate env var Amazon credentials into the tenant record
        _migrate_env_amazon_creds(db, tenant.id)

        db.commit()
        print(f"[bootstrap] Created default tenant + admin: {BOOTSTRAP_USERNAME}")

    elif db.query(models.User).filter(models.User.tenant_id == None).count() > 0:
        # Migrate existing users to tenant 1 (first-time multi-tenant upgrade)
        tenant = db.query(models.Tenant).first()
        if tenant:
            db.query(models.User).filter(models.User.tenant_id == None).update(
                {"tenant_id": tenant.id}, synchronize_session=False
            )
            db.commit()
            print(f"[migration] Assigned {db.query(models.User).count()} users to tenant {tenant.id}")


def _migrate_env_amazon_creds(db: Session, tenant_id: int):
    """If Amazon SP-API env vars are set, seed an AmazonCredential record."""
    import os
    keys = ["AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET",
            "AMAZON_SP_REFRESH_TOKEN", "AMAZON_SELLER_ID"]
    if all(os.getenv(k, "").strip() for k in keys):
        if not db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first():
            db.add(models.AmazonCredential(
                tenant_id=tenant_id,
                lwa_client_id=os.getenv("AMAZON_LWA_CLIENT_ID"),
                lwa_client_secret=os.getenv("AMAZON_LWA_CLIENT_SECRET"),
                sp_refresh_token=os.getenv("AMAZON_SP_REFRESH_TOKEN"),
                seller_id=os.getenv("AMAZON_SELLER_ID"),
                marketplace_id=os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER"),
                is_sandbox=os.getenv("AMAZON_SP_SANDBOX", "").lower() in ("1", "true", "yes"),
            ))
            print("[migration] Seeded Amazon credentials from env vars")
