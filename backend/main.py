from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_
from typing import List, Optional
from datetime import datetime, timedelta
import models
import schemas
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Wholesale CRM API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard", response_model=schemas.DashboardStats)
def get_dashboard(db: Session = Depends(get_db)):
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
):
    q = db.query(models.Account)
    if search:
        q = q.filter(
            or_(
                models.Account.name.ilike(f"%{search}%"),
                models.Account.city.ilike(f"%{search}%"),
                models.Account.email.ilike(f"%{search}%"),
            )
        )
    if status:
        q = q.filter(models.Account.status == status)
    if account_type:
        q = q.filter(models.Account.account_type == account_type)
    if territory:
        q = q.filter(models.Account.territory == territory)
    return q.order_by(models.Account.name).all()


@app.get("/api/accounts/{account_id}", response_model=schemas.AccountOut)
def get_account(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(models.Account).options(joinedload(models.Account.contacts)).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    return acc


@app.post("/api/accounts", response_model=schemas.AccountOut, status_code=201)
def create_account(data: schemas.AccountCreate, db: Session = Depends(get_db)):
    acc = models.Account(**data.model_dump())
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


@app.put("/api/accounts/{account_id}", response_model=schemas.AccountOut)
def update_account(account_id: int, data: schemas.AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(acc, k, v)
    db.commit()
    db.refresh(acc)
    return acc


@app.delete("/api/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(acc)
    db.commit()


# ─── Contacts ─────────────────────────────────────────────────────────────────

@app.get("/api/contacts", response_model=List[schemas.ContactOut])
def list_contacts(account_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(models.Contact)
    if account_id:
        q = q.filter(models.Contact.account_id == account_id)
    return q.all()


@app.post("/api/contacts", response_model=schemas.ContactOut, status_code=201)
def create_contact(data: schemas.ContactCreate, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == data.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    if data.is_primary:
        db.query(models.Contact).filter(
            models.Contact.account_id == data.account_id
        ).update({"is_primary": False})
    contact = models.Contact(**data.model_dump())
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@app.put("/api/contacts/{contact_id}", response_model=schemas.ContactOut)
def update_contact(contact_id: int, data: schemas.ContactUpdate, db: Session = Depends(get_db)):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(contact, k, v)
    db.commit()
    db.refresh(contact)
    return contact


@app.delete("/api/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    contact = db.query(models.Contact).filter(models.Contact.id == contact_id).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
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
):
    q = (
        db.query(models.FollowUp)
        .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
    )
    if account_id:
        q = q.filter(models.FollowUp.account_id == account_id)
    if status:
        q = q.filter(models.FollowUp.status == status)
    if priority:
        q = q.filter(models.FollowUp.priority == priority)
    if follow_up_type:
        q = q.filter(models.FollowUp.follow_up_type == follow_up_type)
    if overdue_only:
        q = q.filter(
            models.FollowUp.status == "pending",
            models.FollowUp.due_date < datetime.utcnow(),
        )
    return q.order_by(models.FollowUp.due_date.asc()).all()


@app.get("/api/follow-ups/{follow_up_id}", response_model=schemas.FollowUpOut)
def get_follow_up(follow_up_id: int, db: Session = Depends(get_db)):
    fu = (
        db.query(models.FollowUp)
        .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
        .filter(models.FollowUp.id == follow_up_id)
        .first()
    )
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    return fu


@app.post("/api/follow-ups", response_model=schemas.FollowUpOut, status_code=201)
def create_follow_up(data: schemas.FollowUpCreate, db: Session = Depends(get_db)):
    fu = models.FollowUp(**data.model_dump())
    db.add(fu)
    db.commit()
    db.refresh(fu)
    return db.query(models.FollowUp).options(
        joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact)
    ).filter(models.FollowUp.id == fu.id).first()


@app.put("/api/follow-ups/{follow_up_id}", response_model=schemas.FollowUpOut)
def update_follow_up(follow_up_id: int, data: schemas.FollowUpUpdate, db: Session = Depends(get_db)):
    fu = db.query(models.FollowUp).filter(models.FollowUp.id == follow_up_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    updates = data.model_dump(exclude_unset=True)
    if updates.get("status") == "completed" and not fu.completed_date:
        updates["completed_date"] = datetime.utcnow()
    for k, v in updates.items():
        setattr(fu, k, v)
    db.commit()
    return db.query(models.FollowUp).options(
        joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact)
    ).filter(models.FollowUp.id == follow_up_id).first()


@app.delete("/api/follow-ups/{follow_up_id}", status_code=204)
def delete_follow_up(follow_up_id: int, db: Session = Depends(get_db)):
    fu = db.query(models.FollowUp).filter(models.FollowUp.id == follow_up_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    db.delete(fu)
    db.commit()


# ─── Orders ───────────────────────────────────────────────────────────────────

@app.get("/api/orders", response_model=List[schemas.OrderOut])
def list_orders(
    account_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(models.Order).options(
        joinedload(models.Order.account),
        joinedload(models.Order.items),
    )
    if account_id:
        q = q.filter(models.Order.account_id == account_id)
    if status:
        q = q.filter(models.Order.status == status)
    return q.order_by(models.Order.order_date.desc()).all()


@app.get("/api/orders/{order_id}", response_model=schemas.OrderOut)
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.Order).options(
        joinedload(models.Order.account),
        joinedload(models.Order.items),
    ).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.post("/api/orders", response_model=schemas.OrderOut, status_code=201)
def create_order(data: schemas.OrderCreate, db: Session = Depends(get_db)):
    order_data = data.model_dump(exclude={"items"})
    if not order_data.get("order_number"):
        count = db.query(func.count(models.Order.id)).scalar() + 1
        order_data["order_number"] = f"ORD-{datetime.utcnow().year}-{count:04d}"
    items_data = data.items
    order = models.Order(**order_data)
    db.add(order)
    db.flush()
    subtotal = 0
    for item in items_data:
        item_dict = item.model_dump()
        item_dict["total"] = round(item_dict["quantity"] * item_dict["unit_price"], 2)
        subtotal += item_dict["total"]
        db.add(models.OrderItem(order_id=order.id, **item_dict))
    order.subtotal = round(subtotal, 2)
    order.total = round(subtotal - order.discount, 2)
    db.commit()
    db.refresh(order)
    return db.query(models.Order).options(
        joinedload(models.Order.account), joinedload(models.Order.items)
    ).filter(models.Order.id == order.id).first()


@app.put("/api/orders/{order_id}", response_model=schemas.OrderOut)
def update_order(order_id: int, data: schemas.OrderUpdate, db: Session = Depends(get_db)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
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
    return db.query(models.Order).options(
        joinedload(models.Order.account), joinedload(models.Order.items)
    ).filter(models.Order.id == order_id).first()


@app.delete("/api/orders/{order_id}", status_code=204)
def delete_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.Order).filter(models.Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    db.delete(order)
    db.commit()


@app.get("/api/health")
def health():
    return {"status": "ok"}
