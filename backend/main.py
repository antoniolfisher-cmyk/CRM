import os
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import datetime, timedelta
import models
import schemas
from database import engine, get_db
from auth import (
    LoginRequest, create_token, require_auth, require_admin,
    hash_password, verify_password, ensure_bootstrap_admin,
)
from notifications import start_scheduler, stop_scheduler, send_daily_digests, send_email, build_digest_html, _smtp_configured
import aura as aura_client

models.Base.metadata.create_all(bind=engine)

# ─── Migrations: add new columns to existing tables ───────────────────────────
try:
    from sqlalchemy import inspect as sa_inspect, text
    _inspector = sa_inspect(engine)
    for _table in ["accounts", "contacts", "follow_ups", "orders", "products"]:
        try:
            _cols = [c["name"] for c in _inspector.get_columns(_table)]
            if "created_by" not in _cols:
                with engine.connect() as _conn:
                    _conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN created_by VARCHAR"))
                    _conn.commit()
        except Exception:
            pass
    # Pipeline stage columns on accounts
    try:
        _cols = [c["name"] for c in _inspector.get_columns("accounts")]
        with engine.connect() as _conn:
            for _col, _ddl in [
                ("pipeline_stage", "VARCHAR NOT NULL DEFAULT 'new'"),
                ("pipeline_updated_at", "DATETIME"),
                ("last_auto_followup_at", "DATETIME"),
            ]:
                if _col not in _cols:
                    _conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {_col} {_ddl}"))
            _conn.commit()
    except Exception:
        pass
    # Keepa columns on products
    try:
        _cols = [c["name"] for c in _inspector.get_columns("products")]
        with engine.connect() as _conn:
            for _col, _ddl in [
                ("keepa_bsr", "INTEGER"),
                ("keepa_category", "VARCHAR"),
                ("keepa_last_synced", "DATETIME"),
            ]:
                if _col not in _cols:
                    _conn.execute(text(f"ALTER TABLE products ADD COLUMN {_col} {_ddl}"))
            _conn.commit()
    except Exception:
        pass
except Exception:
    pass

# Create default admin on startup if no users exist
try:
    _startup_db = next(get_db())
    try:
        ensure_bootstrap_admin(_startup_db)
    finally:
        _startup_db.close()
except Exception as _e:
    print(f"Warning: bootstrap admin setup failed ({_e}), continuing anyway.")

app = FastAPI(title="Delight Shoppe API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    start_scheduler()


@app.on_event("shutdown")
def shutdown():
    stop_scheduler()


# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.post("/api/auth/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == data.username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    return {"access_token": create_token(user.username, user.role), "token_type": "bearer"}


@app.get("/api/auth/me")
def me(payload: dict = Depends(require_auth)):
    return {"username": payload["sub"], "role": payload["role"]}


# ─── Debug (admin only) ───────────────────────────────────────────────────────

@app.get("/api/debug/net")
def debug_net():
    import socket, httpx
    results = {}
    try:
        socket.create_connection(("api.sendgrid.com", 443), timeout=5)
        results["tcp_443"] = "ok"
    except Exception as e:
        results["tcp_443"] = str(e)
    key = os.getenv("SENDGRID_API_KEY", "").strip()
    try:
        r = httpx.post(
            "https://api.sendgrid.com/v3/mail/send",
            json={"personalizations": [{"to": [{"email": "test@example.com"}]}],
                  "from": {"email": "noreply@delightshoppe.org"},
                  "subject": "test", "content": [{"type": "text/plain", "value": "test"}]},
            headers={"Authorization": f"Bearer {key}"},
            timeout=15,
        )
        results["api_post"] = r.status_code
        results["api_body"] = r.text[:300]
    except Exception as e:
        results["api_post"] = str(e)
    return results


# ─── Notification endpoints ───────────────────────────────────────────────────

@app.post("/api/notifications/send-now")
def trigger_digest_now(_=Depends(require_admin)):
    """Manually trigger the digest for all users right now."""
    send_daily_digests()
    return {"detail": "Digest sent"}


@app.post("/api/notifications/test")
def send_test_email(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    """Send a test email to the requesting admin."""
    import httpx as _httpx
    user = db.query(models.User).filter(models.User.username == current["sub"]).first()
    if not user:
        user = db.query(models.User).filter(
            func.lower(models.User.username) == current["sub"].lower()
        ).first()
    if not user or not user.email:
        raise HTTPException(status_code=400, detail="Set your email address first")
    api_key = os.getenv("SENDGRID_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="SENDGRID_API_KEY not set in Railway")
    from_raw = os.getenv("SMTP_FROM", "Delight Shoppe <noreply@delightshoppe.org>")
    if '<' in from_raw:
        name_part = from_raw[:from_raw.index('<')].strip()
        email_from = from_raw[from_raw.index('<')+1:from_raw.index('>')].strip().lower()
    else:
        name_part, email_from = "Delight Shoppe", from_raw.strip().lower()
    try:
        resp = _httpx.post(
            "https://api.sendgrid.com/v3/mail/send",
            json={
                "personalizations": [{"to": [{"email": user.email}]}],
                "from": {"email": email_from, "name": name_part},
                "subject": "Delight Shoppe - Test Email",
                "content": [{"type": "text/plain", "value": f"Hi {user.username}, your email notifications are working!"}],
            },
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=20,
        )
        if resp.status_code >= 400:
            raise HTTPException(status_code=500, detail=f"SendGrid {resp.status_code}: {resp.text}")
    except _httpx.TimeoutException:
        raise HTTPException(status_code=500, detail="SendGrid request timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Email error: {e}")
    return {"detail": f"Test email sent to {user.email}"}


@app.post("/api/users/me/email")
def set_my_email(body: dict, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """Let any authenticated user save their own email address."""
    email = body.get("email", "").strip().lower()
    username = current["sub"]
    user = db.query(models.User).filter(
        models.User.username == username
    ).first()
    if not user:
        # Try case-insensitive match in case username case differs
        user = db.query(models.User).filter(
            func.lower(models.User.username) == username.lower()
        ).first()
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found — please log out and log back in")
    user.email = email or None
    user.notify_email = body.get("notify_email", user.notify_email)
    db.commit()
    db.refresh(user)
    return {"email": user.email, "notify_email": user.notify_email}


@app.get("/api/notifications/status")
def notification_status(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.username == current["sub"]).first()
    inbound_email = os.getenv("CRM_INBOUND_EMAIL", "").strip()
    app_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    if app_domain and not app_domain.startswith("http"):
        app_domain = f"https://{app_domain}"
    return {
        "smtp_configured": _smtp_configured(),
        "smtp_host": os.getenv("SMTP_HOST", ""),
        "smtp_user": (os.getenv("SENDGRID_API_KEY") and "SendGrid API") or (os.getenv("RESEND_API_KEY") and "Resend API") or os.getenv("SMTP_USER", ""),
        "notify_hour_utc": int(os.getenv("NOTIFY_HOUR", "8")),
        "admin_email": user.email if user else None,
        "inbound_configured": bool(inbound_email),
        "inbound_email": inbound_email or None,
        "inbound_webhook_url": f"{app_domain}/api/webhooks/inbound-email" if app_domain else "/api/webhooks/inbound-email",
        "followup_days": int(os.getenv("FOLLOWUP_DAYS", "4")),
    }


# ─── User Management (admin only) ─────────────────────────────────────────────

@app.get("/api/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(models.User).order_by(models.User.created_at).all()


@app.post("/api/users", response_model=schemas.UserOut, status_code=201)
def create_user(data: schemas.UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(models.User).filter(models.User.username == data.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    if data.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
    user = models.User(
        username=data.username,
        password_hash=hash_password(data.password),
        role=data.role,
        is_active=data.is_active,
        email=data.email,
        notify_email=data.notify_email,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.put("/api/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    payload: dict = Depends(require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.username is not None:
        existing = db.query(models.User).filter(
            models.User.username == data.username, models.User.id != user_id
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username already exists")
        user.username = data.username
    if data.password is not None:
        user.password_hash = hash_password(data.password)
    if data.role is not None:
        if data.role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
        # Prevent demoting yourself
        if user.username == payload["sub"] and data.role != "admin":
            raise HTTPException(status_code=400, detail="Cannot remove your own admin role")
        user.role = data.role
    if data.is_active is not None:
        if user.username == payload["sub"] and not data.is_active:
            raise HTTPException(status_code=400, detail="Cannot disable your own account")
        user.is_active = data.is_active
    if data.email is not None:
        user.email = data.email
    if data.notify_email is not None:
        user.notify_email = data.notify_email
    db.commit()
    db.refresh(user)
    return user


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), payload: dict = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == payload["sub"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    db.delete(user)
    db.commit()


@app.get("/api/auth/me")
def me(payload: dict = Depends(require_auth)):
    return {"username": payload["sub"], "role": payload["role"]}


# ─── Ownership helpers ────────────────────────────────────────────────────────

def _is_admin(current: dict) -> bool:
    return current.get("role") == "admin"

def _filter_owned(q, model, current: dict):
    """Filter query to records owned by current user (admin sees all)."""
    if not _is_admin(current):
        q = q.filter(
            (model.created_by == current["sub"]) | (model.created_by == None)
        )
    return q

def _check_owner(record, current: dict):
    """Raise 403 if current user doesn't own the record (admin bypasses)."""
    if not _is_admin(current) and record.created_by and record.created_by != current["sub"]:
        raise HTTPException(status_code=403, detail="Access denied")


# ─── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard", response_model=schemas.DashboardStats)
def get_dashboard(db: Session = Depends(get_db), _ = Depends(require_auth)):
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    week_end = today_start + timedelta(days=7)

    total_accounts = db.query(func.count(models.Account.id)).scalar()
    active_accounts = db.query(func.count(models.Account.id)).filter(models.Account.status == "active").scalar()
    prospect_accounts = db.query(func.count(models.Account.id)).filter(models.Account.status == "prospect").scalar()

    follow_ups_due_today = db.query(func.count(models.FollowUp.id)).filter(
        models.FollowUp.status == "pending",
        models.FollowUp.due_date >= today_start,
        models.FollowUp.due_date < today_end,
    ).scalar()

    follow_ups_overdue = db.query(func.count(models.FollowUp.id)).filter(
        models.FollowUp.status == "pending",
        models.FollowUp.due_date < today_start,
    ).scalar()

    follow_ups_this_week = db.query(func.count(models.FollowUp.id)).filter(
        models.FollowUp.status == "pending",
        models.FollowUp.due_date >= today_start,
        models.FollowUp.due_date < week_end,
    ).scalar()

    open_orders = db.query(func.count(models.Order.id)).filter(
        models.Order.status.in_(["pending", "confirmed", "quote"])
    ).scalar()

    total_order_value = db.query(func.sum(models.Order.total)).filter(
        models.Order.status.in_(["pending", "confirmed", "shipped"])
    ).scalar() or 0

    recent_follow_ups = (
        db.query(models.FollowUp)
        .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
        .filter(models.FollowUp.status == "completed")
        .order_by(models.FollowUp.completed_date.desc())
        .limit(5)
        .all()
    )

    upcoming_follow_ups = (
        db.query(models.FollowUp)
        .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
        .filter(
            models.FollowUp.status == "pending",
            models.FollowUp.due_date >= today_start,
        )
        .order_by(models.FollowUp.due_date.asc())
        .limit(10)
        .all()
    )

    return schemas.DashboardStats(
        total_accounts=total_accounts,
        active_accounts=active_accounts,
        prospect_accounts=prospect_accounts,
        follow_ups_due_today=follow_ups_due_today,
        follow_ups_overdue=follow_ups_overdue,
        follow_ups_this_week=follow_ups_this_week,
        open_orders=open_orders,
        total_order_value=total_order_value,
        recent_follow_ups=recent_follow_ups,
        upcoming_follow_ups=upcoming_follow_ups,
    )


# ─── Accounts ─────────────────────────────────────────────────────────────────

@app.get("/api/accounts", response_model=List[schemas.AccountSummary])
def list_accounts(
    search: Optional[str] = None,
    status: Optional[str] = None,
    account_type: Optional[str] = None,
    territory: Optional[str] = None,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    q = db.query(models.Account)
    q = _filter_owned(q, models.Account, current)
    if search:
        q = q.filter(or_(
            models.Account.name.ilike(f"%{search}%"),
            models.Account.city.ilike(f"%{search}%"),
            models.Account.email.ilike(f"%{search}%"),
        ))
    if status:
        q = q.filter(models.Account.status == status)
    if account_type:
        q = q.filter(models.Account.account_type == account_type)
    if territory:
        q = q.filter(models.Account.territory == territory)
    return q.order_by(models.Account.name).all()


@app.get("/api/accounts/{account_id}", response_model=schemas.AccountOut)
def get_account(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).options(joinedload(models.Account.contacts)).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    return acc


@app.post("/api/accounts", response_model=schemas.AccountOut, status_code=201)
def create_account(data: schemas.AccountCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = models.Account(**data.model_dump(), created_by=current["sub"])
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


@app.put("/api/accounts/{account_id}", response_model=schemas.AccountOut)
def update_account(account_id: int, data: schemas.AccountUpdate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(acc, k, v)
    db.commit()
    db.refresh(acc)
    return acc


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    db.delete(acc)
    db.commit()


def _build_wholesale_email_html(body: str, template_id: str, sender_name: str) -> str:
    """Convert plain-text body (with optional markers) into premium branded HTML."""

    FEATURE_CARDS_HTML = """
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
  <tr>
    <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">🛒</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Online storefront reach</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">Active e-commerce presence with a growing, engaged customer base.</p>
      </div>
    </td>
    <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">📦</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Regular reordering</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">We operate on a consistent inventory cycle with reliable wholesale orders.</p>
      </div>
    </td>
  </tr>
  <tr>
    <td width="50%" style="padding:0 8px 0 0;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">📢</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Brand visibility</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">Featured product pages, social promotion, and email campaigns.</p>
      </div>
    </td>
    <td width="50%" style="padding:0 0 0 8px;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">🤝</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Long-term relationship</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">We value partners and aim to grow together over time.</p>
      </div>
    </td>
  </tr>
</table>"""

    CTA_HTML = """
<div style="text-align:center;margin:36px 0 8px;">
  <a href="#" style="display:inline-block;background:#0f1729;color:#c9a84c;padding:15px 36px;border-radius:3px;text-decoration:none;font-weight:700;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;font-family:-apple-system,sans-serif;">
    Request a Wholesale Catalog
  </a>
  <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;font-family:-apple-system,sans-serif;">Or reply directly to this email to start the conversation.</p>
</div>"""

    # Process each paragraph
    chunks = []
    for para in body.strip().split("\n\n"):
        stripped = para.strip()
        if stripped == "[FEATURE_CARDS]":
            chunks.append(FEATURE_CARDS_HTML)
        elif stripped == "[CTA]":
            chunks.append(CTA_HTML)
        elif stripped.startswith("[CALLOUT]"):
            text = stripped[9:].strip().replace("\n", "<br>")
            chunks.append(
                f'<div style="border-left:3px solid #c9a84c;background:#faf8f2;padding:16px 20px;'
                f'margin:20px 0;border-radius:0 5px 5px 0;font-size:14px;color:#374151;'
                f'line-height:1.7;font-family:-apple-system,sans-serif;">{text}</div>'
            )
        elif stripped.startswith("[H2]"):
            text = stripped[4:].strip()
            chunks.append(
                f'<h2 style="margin:24px 0 8px;font-size:20px;font-weight:700;color:#0f1729;'
                f'font-family:Georgia,serif;line-height:1.3;">{text}</h2>'
            )
        else:
            # Escape HTML entities, preserve line breaks
            safe = para.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            lines = safe.replace("\n", "<br>")
            chunks.append(
                f'<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#374151;'
                f'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">{lines}</p>'
            )

    body_html = "".join(chunks)
    safe_sender = sender_name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f3ee;">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10);">

  <!-- Header -->
  <div style="background:#0f1729;padding:44px 32px 36px;text-align:center;">
    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:400;color:#c9a84c;letter-spacing:3px;">Delight Shoppe</h1>
    <p style="margin:10px 0 0;color:#8a9bb5;font-size:10px;letter-spacing:4px;text-transform:uppercase;font-family:-apple-system,sans-serif;">Curated E&#x2011;Commerce &nbsp;&middot;&nbsp; Est. 2024</p>
    <div style="width:48px;height:1px;background:#c9a84c;margin:18px auto 0;"></div>
  </div>

  <!-- Body -->
  <div style="padding:44px 48px 28px;">
    {body_html}
  </div>

  <!-- Signature -->
  <div style="border-top:1px solid #e5e7eb;padding:24px 48px 32px;">
    <p style="margin:0;font-size:13px;color:#6b7280;font-family:-apple-system,sans-serif;line-height:1.7;">
      Warm regards,<br>
      <strong style="color:#0f1729;font-size:14px;">{safe_sender}</strong><br>
      <span style="color:#9ca3af;">Delight Shoppe &nbsp;&middot;&nbsp; Curated E-Commerce</span>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#f9f8f6;padding:14px 48px;border-top:1px solid #ede9e0;">
    <p style="margin:0;font-size:10px;color:#b5b0a8;text-align:center;letter-spacing:1px;font-family:-apple-system,sans-serif;text-transform:uppercase;">
      Delight Shoppe &nbsp;&middot;&nbsp; You are receiving this as a direct wholesale inquiry.
    </p>
  </div>

</div>
</body></html>"""


def _build_reply_notification_html(owner_name, account_name, from_email, subject, body_preview):
    safe = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    preview_html = safe(body_preview).replace("\n", "<br>")
    app_url = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    if app_url and not app_url.startswith("http"):
        app_url = f"https://{app_url}"
    cta = (f'<div style="text-align:center;margin-top:24px;">'
           f'<a href="{app_url}/accounts" style="display:inline-block;background:#0f1729;color:#c9a84c;'
           f'padding:12px 28px;border-radius:3px;text-decoration:none;font-weight:700;font-size:11px;'
           f'letter-spacing:2px;text-transform:uppercase;">View in CRM →</a></div>') if app_url else ""
    return f"""<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ee;font-family:-apple-system,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
  <div style="background:#0f1729;padding:24px 32px;">
    <h2 style="margin:0;color:#c9a84c;font-family:Georgia,serif;font-size:20px;font-weight:400;">&#128236; New Reply Received</h2>
    <p style="margin:6px 0 0;color:#8a9bb5;font-size:10px;letter-spacing:3px;text-transform:uppercase;">Delight Shoppe CRM</p>
  </div>
  <div style="padding:32px;">
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi <strong>{safe(owner_name)}</strong>, you have a new reply from <strong>{safe(account_name)}</strong>.</p>
    <div style="background:#f9f8f6;border-left:3px solid #c9a84c;padding:16px 20px;border-radius:0 5px 5px 0;">
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">From</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;">{safe(from_email)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Subject</p>
      <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#0f1729;">{safe(subject)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Preview</p>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">{preview_html}</p>
    </div>
    {cta}
  </div>
  <div style="background:#f9f8f6;padding:14px 32px;border-top:1px solid #ede9e0;">
    <p style="margin:0;font-size:10px;color:#b5b0a8;text-align:center;letter-spacing:1px;text-transform:uppercase;">Delight Shoppe CRM · Automated Notification</p>
  </div>
</div></body></html>"""


@app.post("/api/accounts/{account_id}/send-email")
def send_account_email(
    account_id: int,
    data: schemas.AccountEmailSend,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Send a branded wholesale email and log it to the account thread."""
    from notifications import send_email as _send_email, _smtp_configured
    if not _smtp_configured():
        raise HTTPException(status_code=400, detail="Email not configured — add SENDGRID_API_KEY in Railway")
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    if not data.to or "@" not in data.to:
        raise HTTPException(status_code=400, detail="Invalid recipient email address")

    sender = data.sender_name or current.get("sub", "Delight Shoppe")
    html = _build_wholesale_email_html(data.body, data.template_id or "", sender)

    # Set Reply-To to CRM inbound address and embed account id in header
    inbound_email = os.getenv("CRM_INBOUND_EMAIL", "").strip()
    reply_to = inbound_email if inbound_email else None
    custom_headers = {"X-Crm-Account-Id": str(account_id)}

    try:
        _send_email(data.to, data.subject, html,
                    reply_to=reply_to, custom_headers=custom_headers)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Auto-advance pipeline stage based on template
    _stage_map = {
        "intro":       "outreach_sent",
        "followup":    "outreach_sent",   # manual follow-up keeps same bucket
        "catalog":     "catalog_sent",
        "terms":       "catalog_sent",
        "welcome":     "won",
        "new_product": None,              # no stage change for these
        "reorder":     None,
    }
    new_stage = _stage_map.get(data.template_id or "")
    if new_stage and new_stage != acc.pipeline_stage:
        # Only advance forward, never back
        _order = ["new", "outreach_sent", "replied", "catalog_sent", "negotiating", "won"]
        current_idx = _order.index(acc.pipeline_stage) if acc.pipeline_stage in _order else 0
        new_idx = _order.index(new_stage) if new_stage in _order else 0
        if new_idx >= current_idx:
            acc.pipeline_stage = new_stage
            acc.pipeline_updated_at = datetime.utcnow()
            db.commit()

    # Log sent email to thread
    log_entry = models.EmailMessage(
        account_id=account_id,
        direction="sent",
        from_email=current.get("sub", ""),
        to_email=data.to,
        subject=data.subject,
        body_text=data.body,
        is_read=True,
        sent_by=current.get("sub", ""),
    )
    db.add(log_entry)
    db.commit()

    return {"detail": "Email sent"}


@app.get("/api/accounts/{account_id}/emails")
def get_account_emails(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    msgs = (
        db.query(models.EmailMessage)
        .filter(models.EmailMessage.account_id == account_id)
        .order_by(models.EmailMessage.created_at.asc())
        .all()
    )
    # Auto-mark received messages as read
    for m in msgs:
        if m.direction == "received" and not m.is_read:
            m.is_read = True
    db.commit()
    return [
        {
            "id": m.id,
            "direction": m.direction,
            "from_email": m.from_email,
            "to_email": m.to_email,
            "subject": m.subject,
            "body_text": m.body_text,
            "is_read": m.is_read,
            "sent_by": m.sent_by,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in msgs
    ]


@app.get("/api/accounts/{account_id}/emails/unread-count")
def get_unread_count(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    count = db.query(models.EmailMessage).filter(
        models.EmailMessage.account_id == account_id,
        models.EmailMessage.direction == "received",
        models.EmailMessage.is_read == False,
    ).count()
    return {"unread": count}


_STAGE_ORDER = ["new", "outreach_sent", "replied", "catalog_sent", "negotiating", "won", "lost"]


@app.put("/api/accounts/{account_id}/stage")
def update_account_stage(
    account_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Manually set the pipeline stage for an account."""
    stage = (data.get("stage") or "").strip()
    if stage not in _STAGE_ORDER:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {', '.join(_STAGE_ORDER)}")
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    acc.pipeline_stage = stage
    acc.pipeline_updated_at = datetime.utcnow()
    db.commit()
    return {"stage": stage, "pipeline_updated_at": acc.pipeline_updated_at.isoformat()}


@app.post("/api/webhooks/inbound-email")
async def inbound_email_webhook(request: Request, db: Session = Depends(get_db)):
    """
    SendGrid Inbound Parse webhook.
    Configure in SendGrid dashboard → Settings → Inbound Parse.
    Point MX record for your inbound domain to mx.sendgrid.net.
    Set webhook URL to: https://<your-app>/api/webhooks/inbound-email
    Set CRM_INBOUND_EMAIL env var to the address replies should go to.
    """
    import re as _re
    try:
        form = await request.form()
    except Exception:
        return {"status": "error", "detail": "invalid form"}

    from_raw   = form.get("from", "") or ""
    to_raw     = form.get("to", "")   or ""
    subject    = (form.get("subject", "") or "(no subject)").strip()
    body_text  = form.get("text", "") or ""
    body_html  = form.get("html", "") or ""
    headers_raw = form.get("headers", "") or ""

    # Prefer plain text; strip basic HTML if only html provided
    if not body_text and body_html:
        body_text = _re.sub(r'<[^>]+>', '', body_html).strip()
    body_text = body_text[:10000]

    def _extract_addr(s):
        m = _re.search(r'<([^>]+)>', s)
        return (m.group(1) if m else s).strip().lower()

    from_addr = _extract_addr(from_raw)

    # 1. Look for X-Crm-Account-Id header (set by CRM when sending)
    account_id = None
    for line in headers_raw.splitlines():
        if line.lower().startswith("x-crm-account-id:"):
            try:
                account_id = int(line.split(":", 1)[1].strip())
            except (ValueError, IndexError):
                pass
            break

    # 2. Fall back: match from address to account.email or contact.email
    if not account_id and from_addr:
        acc_match = db.query(models.Account).filter(
            func.lower(models.Account.email) == from_addr
        ).first()
        if acc_match:
            account_id = acc_match.id
        else:
            contact_match = db.query(models.Contact).filter(
                func.lower(models.Contact.email) == from_addr
            ).first()
            if contact_match:
                account_id = contact_match.account_id

    # Advance pipeline stage to 'replied' when a reply comes in
    if account_id:
        _acc = db.query(models.Account).filter(models.Account.id == account_id).first()
        if _acc and _acc.pipeline_stage not in ("won", "lost", "negotiating", "replied"):
            _acc.pipeline_stage = "replied"
            _acc.pipeline_updated_at = datetime.utcnow()
            # no commit yet — will commit with the message below

    # Store the inbound message
    msg = models.EmailMessage(
        account_id=account_id,
        direction="received",
        from_email=from_raw,
        to_email=to_raw,
        subject=subject,
        body_text=body_text,
        is_read=False,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # Notify the account owner
    if account_id:
        acc = db.query(models.Account).filter(models.Account.id == account_id).first()
        if acc and acc.created_by:
            owner = db.query(models.User).filter(
                models.User.username == acc.created_by
            ).first()
            if owner and owner.email:
                from notifications import send_email as _send_email, _smtp_configured
                if _smtp_configured():
                    try:
                        notif = _build_reply_notification_html(
                            owner_name=owner.username,
                            account_name=acc.name,
                            from_email=from_raw,
                            subject=subject,
                            body_preview=body_text[:400],
                        )
                        _send_email(
                            owner.email,
                            f"New reply from {acc.name}: {subject}",
                            notif,
                        )
                    except Exception:
                        pass  # never fail the webhook

    return {"status": "ok"}


# ─── Contacts ─────────────────────────────────────────────────────────────────

@app.get("/api/contacts", response_model=List[schemas.ContactOut])
def list_contacts(account_id: Optional[int] = None, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    q = db.query(models.Contact)
    q = _filter_owned(q, models.Contact, current)
    if account_id:
        q = q.filter(models.Contact.account_id == account_id)
    return q.all()


@app.post("/api/contacts", response_model=schemas.ContactOut, status_code=201)
def create_contact(data: schemas.ContactCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == data.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    if data.is_primary:
        db.query(models.Contact).filter(models.Contact.account_id == data.account_id).update({"is_primary": False})
    contact = models.Contact(**data.model_dump(), created_by=current["sub"])
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@app.put("/api/contacts/{contact_id}", response_model=schemas.ContactOut)
def update_contact(contact_id: int, data: schemas.ContactUpdate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    _check_owner(contact, current)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(contact, k, v)
    db.commit()
    db.refresh(contact)
    return contact


@app.delete("/api/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    _check_owner(contact, current)
    db.delete(contact)
    db.commit()


# ─── Follow-Ups ───────────────────────────────────────────────────────────────

@app.get("/api/follow-ups", response_model=List[schemas.FollowUpOut])
def list_follow_ups(
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    follow_up_type: Optional[str] = None,
    overdue_only: bool = False,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    q = db.query(models.FollowUp).options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
    q = _filter_owned(q, models.FollowUp, current)
    if account_id:
        q = q.filter(models.FollowUp.account_id == account_id)
    if status:
        q = q.filter(models.FollowUp.status == status)
    if priority:
        q = q.filter(models.FollowUp.priority == priority)
    if follow_up_type:
        q = q.filter(models.FollowUp.follow_up_type == follow_up_type)
    if overdue_only:
        q = q.filter(models.FollowUp.status == "pending", models.FollowUp.due_date < datetime.utcnow())
    return q.order_by(models.FollowUp.due_date.asc()).all()


@app.get("/api/follow-ups/{follow_up_id}", response_model=schemas.FollowUpOut)
def get_follow_up(follow_up_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    fu = db.query(models.FollowUp).options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact)).filter(models.FollowUp.id == follow_up_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    _check_owner(fu, current)
    return fu


@app.post("/api/follow-ups", response_model=schemas.FollowUpOut, status_code=201)
def create_follow_up(data: schemas.FollowUpCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    fu = models.FollowUp(**data.model_dump(), created_by=current["sub"])
    db.add(fu)
    db.commit()
    db.refresh(fu)
    return db.query(models.FollowUp).options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact)).filter(models.FollowUp.id == fu.id).first()


@app.put("/api/follow-ups/{follow_up_id}", response_model=schemas.FollowUpOut)
def update_follow_up(follow_up_id: int, data: schemas.FollowUpUpdate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    fu = db.query(models.FollowUp).filter(models.FollowUp.id == follow_up_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    _check_owner(fu, current)
    updates = data.model_dump(exclude_unset=True)
    if updates.get("status") == "completed" and not fu.completed_date:
        updates["completed_date"] = datetime.utcnow()
    for k, v in updates.items():
        setattr(fu, k, v)
    db.commit()
    return db.query(models.FollowUp).options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact)).filter(models.FollowUp.id == follow_up_id).first()


@app.delete("/api/follow-ups/{follow_up_id}", status_code=204)
def delete_follow_up(follow_up_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    fu = db.query(models.FollowUp).filter(models.FollowUp.id == follow_up_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    _check_owner(fu, current)
    db.delete(fu)
    db.commit()


# ─── Orders ───────────────────────────────────────────────────────────────────

@app.get("/api/orders", response_model=List[schemas.OrderOut])
def list_orders(
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    q = db.query(models.Order).options(joinedload(models.Order.account), joinedload(models.Order.items))
    q = _filter_owned(q, models.Order, current)
    if account_id:
        q = q.filter(models.Order.account_id == account_id)
    if status:
        q = q.filter(models.Order.status == status)
    return q.order_by(models.Order.order_date.desc()).all()


@app.get("/api/orders/{order_id}", response_model=schemas.OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    order = db.query(models.Order).options(joinedload(models.Order.account), joinedload(models.Order.items)).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _check_owner(order, current)
    return order


@app.post("/api/orders", response_model=schemas.OrderOut, status_code=201)
def create_order(data: schemas.OrderCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    order_data = data.model_dump(exclude={"items"})
    if not order_data.get("order_number"):
        count = db.query(func.count(models.Order.id)).scalar() + 1
        order_data["order_number"] = f"ORD-{datetime.utcnow().year}-{count:04d}"
    order = models.Order(**order_data, created_by=current["sub"])
    db.add(order)
    db.flush()
    subtotal = 0
    for item in data.items:
        item_dict = item.model_dump()
        item_dict["total"] = round(item_dict["quantity"] * item_dict["unit_price"], 2)
        subtotal += item_dict["total"]
        db.add(models.OrderItem(order_id=order.id, **item_dict))
    order.subtotal = round(subtotal, 2)
    order.total = round(subtotal - order.discount, 2)
    db.commit()
    db.refresh(order)
    return db.query(models.Order).options(joinedload(models.Order.account), joinedload(models.Order.items)).filter(models.Order.id == order.id).first()


@app.put("/api/orders/{order_id}", response_model=schemas.OrderOut)
def update_order(order_id: int, data: schemas.OrderUpdate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _check_owner(order, current)
    updates = data.model_dump(exclude_unset=True, exclude={"items"})
    for k, v in updates.items():
        setattr(order, k, v)
    if data.items is not None:
        db.query(models.OrderItem).filter(models.OrderItem.order_id == order_id).delete()
        subtotal = 0
        for item in data.items:
            item_dict = item.model_dump()
            item_dict["total"] = round(item_dict["quantity"] * item_dict["unit_price"], 2)
            subtotal += item_dict["total"]
            db.add(models.OrderItem(order_id=order_id, **item_dict))
        order.subtotal = round(subtotal, 2)
        order.total = round(subtotal - order.discount, 2)
    db.commit()
    return db.query(models.Order).options(joinedload(models.Order.account), joinedload(models.Order.items)).filter(models.Order.id == order_id).first()


@app.delete("/api/orders/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _check_owner(order, current)
    db.delete(order)
    db.commit()


# ─── Aura Repricer ────────────────────────────────────────────────────────────

@app.get("/api/aura/status")
def aura_status(_ = Depends(require_auth)):
    return {"configured": bool(aura_client.AURA_API_KEY)}


@app.get("/api/aura/listings")
def aura_listings(_ = Depends(require_auth)):
    """Fetch all listings from Aura (for preview/debugging)."""
    if not aura_client.AURA_API_KEY:
        raise HTTPException(status_code=400, detail="AURA_API_KEY not set")
    try:
        listings = aura_client.fetch_all_listings()
        return {"count": len(listings), "listings": listings}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/aura/sync")
def aura_sync_all(db: Session = Depends(get_db), _ = Depends(require_auth)):
    """Sync all products that have an ASIN to Aura."""
    if not aura_client.AURA_API_KEY:
        raise HTTPException(status_code=400, detail="AURA_API_KEY not set — add it to Railway environment variables")
    products = db.query(models.Product).filter(
        models.Product.asin != None,
        models.Product.asin != "",
    ).all()
    if not products:
        raise HTTPException(status_code=400, detail="No products with ASINs found")
    try:
        result = aura_client.sync_products_to_aura(products)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/aura/sync/{product_id}")
def aura_sync_one(product_id: int, db: Session = Depends(get_db), _ = Depends(require_auth)):
    """Sync a single product to Aura."""
    if not aura_client.AURA_API_KEY:
        raise HTTPException(status_code=400, detail="AURA_API_KEY not set")
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if not p.asin:
        raise HTTPException(status_code=400, detail="Product has no ASIN — add an ASIN first")
    try:
        result = aura_client.sync_products_to_aura([p])
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ─── Products ─────────────────────────────────────────────────────────────────

@app.get("/api/products", response_model=List[schemas.ProductOut])
def list_products(
    search: Optional[str] = None,
    replenish: Optional[bool] = None,
    ungated: Optional[bool] = None,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    q = db.query(models.Product)
    q = _filter_owned(q, models.Product, current)
    if search:
        q = q.filter(or_(
            models.Product.product_name.ilike(f"%{search}%"),
            models.Product.asin.ilike(f"%{search}%"),
            models.Product.order_number.ilike(f"%{search}%"),
            models.Product.va_finder.ilike(f"%{search}%"),
        ))
    if replenish is not None:
        q = q.filter(models.Product.replenish == replenish)
    if ungated is not None:
        q = q.filter(models.Product.ungated == ungated)
    return q.order_by(models.Product.created_at.desc()).all()


@app.get("/api/products/{product_id}", response_model=schemas.ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _check_owner(p, current)
    return p


@app.post("/api/products", response_model=schemas.ProductOut, status_code=201)
def create_product(data: schemas.ProductCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    p = models.Product(**data.model_dump(), created_by=current["sub"])
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


@app.put("/api/products/{product_id}", response_model=schemas.ProductOut)
def update_product(product_id: int, data: schemas.ProductUpdate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _check_owner(p, current)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    db.refresh(p)
    return p


@app.delete("/api/products/{product_id}", status_code=204)
def delete_product(product_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _check_owner(p, current)
    db.delete(p)
    db.commit()


# ─── Keepa Integration ────────────────────────────────────────────────────────

_KEEPA_DOMAIN = int(os.getenv("KEEPA_DOMAIN", "1"))   # 1 = US marketplace


def _parse_keepa_product(kp: dict, product: models.Product) -> None:
    """Write Keepa API data into a Product ORM instance (no commit)."""
    from datetime import timezone as _tz
    stats = kp.get("stats") or {}
    current = stats.get("current") or []

    def _price(idx: int):
        if idx < len(current):
            v = current[idx]
            if v is not None and v > 0:
                return round(v / 100, 2)
        return None

    def _rank(idx: int):
        if idx < len(current):
            v = current[idx]
            if v is not None and v > 0:
                return int(v)
        return None

    # Buy Box = data type 7 (NEW_FBA), BSR = data type 3 (SALES)
    bb = _price(7)
    if bb is not None:
        product.buy_box = bb

    bsr = _rank(3)
    if bsr is not None:
        product.keepa_bsr = bsr

    # Category — use deepest node in tree
    cat_tree = kp.get("categoryTree") or []
    if cat_tree:
        product.keepa_category = (cat_tree[-1].get("name") or cat_tree[0].get("name") or "").strip() or None

    # Seller count
    new_count = kp.get("newCount")
    if new_count is not None and new_count >= 0:
        product.num_sellers = new_count

    # Estimated monthly sales
    monthly_sold = kp.get("monthlySold")
    if monthly_sold is not None and monthly_sold >= 0:
        product.estimated_sales = float(monthly_sold)

    product.keepa_last_synced = datetime.now(_tz.utc)


@app.get("/api/keepa/status")
def keepa_status_endpoint(current: dict = Depends(require_auth)):
    return {"configured": bool(os.getenv("KEEPA_API_KEY", "").strip())}


@app.post("/api/products/{product_id}/keepa-refresh", response_model=schemas.ProductOut)
async def keepa_refresh_one(
    product_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.asin:
        raise HTTPException(400, "Product has no ASIN — add one in the Products page first")

    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not set — add it in Railway Variables")

    url = (
        f"https://api.keepa.com/product"
        f"?key={api_key}&domain={_KEEPA_DOMAIN}&asin={product.asin.strip()}&stats=90"
    )
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)

    if resp.status_code != 200:
        raise HTTPException(502, f"Keepa returned {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    if data.get("error"):
        raise HTTPException(502, f"Keepa error: {data.get('status', 'unknown')}")

    products_data = data.get("products") or []
    if not products_data:
        raise HTTPException(404, f"ASIN {product.asin} not found in Keepa")

    _parse_keepa_product(products_data[0], product)
    db.commit()
    db.refresh(product)
    return product


@app.post("/api/keepa/bulk-refresh")
async def keepa_bulk_refresh(
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    """Bulk-refresh all products that have an ASIN. Batches 100 per Keepa request."""
    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not set — add it in Railway Variables")

    products = (
        db.query(models.Product)
        .filter(models.Product.asin.isnot(None), models.Product.asin != "")
        .all()
    )
    if not products:
        return {"refreshed": 0, "skipped": 0, "errors": []}

    # ASIN → list of products (handle duplicates)
    asin_map: dict = {}
    for p in products:
        key = p.asin.strip().upper()
        asin_map.setdefault(key, []).append(p)

    all_asins = list(asin_map.keys())
    refreshed = 0
    errors: list = []

    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=60) as client:
        for i in range(0, len(all_asins), 100):
            batch = all_asins[i: i + 100]
            url = (
                f"https://api.keepa.com/product"
                f"?key={api_key}&domain={_KEEPA_DOMAIN}&asin={','.join(batch)}&stats=90"
            )
            resp = await client.get(url)
            if resp.status_code != 200:
                errors.append(f"Keepa {resp.status_code} on batch {i // 100 + 1}")
                continue
            data = resp.json()
            if data.get("error"):
                errors.append(f"Keepa error: {data.get('status')} on batch {i // 100 + 1}")
                continue
            for kp in data.get("products") or []:
                kp_asin = (kp.get("asin") or "").strip().upper()
                for prod in asin_map.get(kp_asin, []):
                    _parse_keepa_product(kp, prod)
                    refreshed += 1

    db.commit()
    return {"refreshed": refreshed, "skipped": len(all_asins) - refreshed, "errors": errors}


# ─── Time Clock ───────────────────────────────────────────────────────────────

@app.post("/api/timeclock/in")
def clock_in(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    username = current["sub"]
    # Prevent double clock-in
    open_entry = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == username, models.TimeEntry.clock_out == None)
        .first()
    )
    if open_entry:
        raise HTTPException(status_code=400, detail="Already clocked in")
    entry = models.TimeEntry(username=username, clock_in=datetime.utcnow())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "clock_in": entry.clock_in.isoformat(), "status": "clocked_in"}


@app.post("/api/timeclock/out")
def clock_out(data: dict = {}, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    username = current["sub"]
    open_entry = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == username, models.TimeEntry.clock_out == None)
        .first()
    )
    if not open_entry:
        raise HTTPException(status_code=400, detail="Not currently clocked in")
    now = datetime.utcnow()
    open_entry.clock_out = now
    open_entry.duration_minutes = (now - open_entry.clock_in.replace(tzinfo=None)).total_seconds() / 60
    if isinstance(data, dict):
        open_entry.notes = data.get("notes") or open_entry.notes
    db.commit()
    db.refresh(open_entry)
    hours = open_entry.duration_minutes / 60
    return {
        "id": open_entry.id,
        "clock_in": open_entry.clock_in.isoformat(),
        "clock_out": open_entry.clock_out.isoformat(),
        "duration_minutes": round(open_entry.duration_minutes, 2),
        "hours": round(hours, 2),
        "status": "clocked_out",
    }


@app.get("/api/timeclock/status")
def timeclock_status(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    username = current["sub"]
    open_entry = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == username, models.TimeEntry.clock_out == None)
        .first()
    )
    if open_entry:
        return {"clocked_in": True, "clock_in": open_entry.clock_in.isoformat(), "entry_id": open_entry.id}
    return {"clocked_in": False}


@app.get("/api/timeclock/my-entries")
def my_entries(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    entries = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == current["sub"])
        .order_by(models.TimeEntry.clock_in.desc())
        .limit(30)
        .all()
    )
    return [
        {
            "id": e.id,
            "clock_in": e.clock_in.isoformat() if e.clock_in else None,
            "clock_out": e.clock_out.isoformat() if e.clock_out else None,
            "duration_minutes": round(e.duration_minutes, 2) if e.duration_minutes else None,
            "notes": e.notes,
        }
        for e in entries
    ]


@app.get("/api/timeclock/report")
def timeclock_report(
    user: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    q = db.query(models.TimeEntry)
    if user:
        q = q.filter(models.TimeEntry.username == user)
    if date_from:
        try:
            q = q.filter(models.TimeEntry.clock_in >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            q = q.filter(models.TimeEntry.clock_in < end)
        except ValueError:
            pass
    entries = q.order_by(models.TimeEntry.clock_in.desc()).all()
    rows = []
    for e in entries:
        rows.append({
            "id": e.id,
            "username": e.username,
            "clock_in": e.clock_in.isoformat() if e.clock_in else None,
            "clock_out": e.clock_out.isoformat() if e.clock_out else None,
            "duration_minutes": round(e.duration_minutes, 2) if e.duration_minutes else None,
            "notes": e.notes,
        })
    return rows


@app.get("/api/timeclock/report/export")
def timeclock_export(
    user: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    from fastapi.responses import StreamingResponse
    import io, csv as csv_mod

    q = db.query(models.TimeEntry)
    if user:
        q = q.filter(models.TimeEntry.username == user)
    if date_from:
        try:
            q = q.filter(models.TimeEntry.clock_in >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            q = q.filter(models.TimeEntry.clock_in < end)
        except ValueError:
            pass
    entries = q.order_by(models.TimeEntry.clock_in.asc()).all()

    output = io.StringIO()
    writer = csv_mod.writer(output)
    writer.writerow(["ID", "Username", "Clock In", "Clock Out", "Hours", "Minutes", "Notes"])
    for e in entries:
        hours = round(e.duration_minutes / 60, 4) if e.duration_minutes else ""
        mins = round(e.duration_minutes, 2) if e.duration_minutes else ""
        writer.writerow([
            e.id,
            e.username,
            e.clock_in.strftime("%Y-%m-%d %H:%M:%S") if e.clock_in else "",
            e.clock_out.strftime("%Y-%m-%d %H:%M:%S") if e.clock_out else "Still clocked in",
            hours,
            mins,
            e.notes or "",
        ])
    output.seek(0)
    filename = f"timeclock_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ─── Serve React SPA (must be last) ───────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

if os.path.isdir(STATIC_DIR):
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
