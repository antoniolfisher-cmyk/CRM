import os
from fastapi import FastAPI, Depends, HTTPException
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
    return {
        "smtp_configured": _smtp_configured(),
        "smtp_host": os.getenv("SMTP_HOST", ""),
        "smtp_user": (os.getenv("SENDGRID_API_KEY") and "SendGrid API") or (os.getenv("RESEND_API_KEY") and "Resend API") or os.getenv("SMTP_USER", ""),
        "notify_hour_utc": int(os.getenv("NOTIFY_HOUR", "8")),
        "admin_email": user.email if user else None,
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
