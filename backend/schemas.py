from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# Contact schemas
class ContactBase(BaseModel):
    first_name: str
    last_name: str
    title: Optional[str] = None
    phone: Optional[str] = None
    mobile: Optional[str] = None
    email: Optional[str] = None
    is_primary: bool = False
    notes: Optional[str] = None


class ContactCreate(ContactBase):
    account_id: int


class ContactUpdate(ContactBase):
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class ContactOut(ContactBase):
    id: int
    account_id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Account schemas
class AccountBase(BaseModel):
    name: str
    account_type: Optional[str] = "retailer"
    status: Optional[str] = "prospect"
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    territory: Optional[str] = None
    payment_terms: Optional[str] = None
    credit_limit: Optional[float] = 0
    notes: Optional[str] = None


class AccountCreate(AccountBase):
    pass


class AccountUpdate(AccountBase):
    name: Optional[str] = None


class AccountOut(AccountBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    contacts: List[ContactOut] = []

    class Config:
        from_attributes = True


class AccountSummary(BaseModel):
    id: int
    name: str
    account_type: Optional[str]
    status: Optional[str]
    city: Optional[str]
    state: Optional[str]
    territory: Optional[str]
    phone: Optional[str]
    email: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


# FollowUp schemas
class FollowUpBase(BaseModel):
    subject: str
    follow_up_type: Optional[str] = "call"
    status: Optional[str] = "pending"
    priority: Optional[str] = "medium"
    due_date: datetime
    notes: Optional[str] = None
    outcome: Optional[str] = None
    next_follow_up_date: Optional[datetime] = None


class FollowUpCreate(FollowUpBase):
    account_id: int
    contact_id: Optional[int] = None


class FollowUpUpdate(FollowUpBase):
    subject: Optional[str] = None
    due_date: Optional[datetime] = None
    completed_date: Optional[datetime] = None
    account_id: Optional[int] = None
    contact_id: Optional[int] = None


class FollowUpOut(FollowUpBase):
    id: int
    account_id: int
    contact_id: Optional[int] = None
    completed_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    account: Optional[AccountSummary] = None
    contact: Optional[ContactOut] = None

    class Config:
        from_attributes = True


# Order item schemas
class OrderItemBase(BaseModel):
    product_name: str
    sku: Optional[str] = None
    quantity: float = 1
    unit: Optional[str] = "case"
    unit_price: float = 0
    total: float = 0


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemOut(OrderItemBase):
    id: int
    order_id: int

    class Config:
        from_attributes = True


# Order schemas
class OrderBase(BaseModel):
    order_number: Optional[str] = None
    status: Optional[str] = "pending"
    order_date: Optional[datetime] = None
    ship_date: Optional[datetime] = None
    subtotal: float = 0
    discount: float = 0
    total: float = 0
    notes: Optional[str] = None


class OrderCreate(OrderBase):
    account_id: int
    items: List[OrderItemCreate] = []


class OrderUpdate(OrderBase):
    account_id: Optional[int] = None
    items: Optional[List[OrderItemCreate]] = None


class OrderOut(OrderBase):
    id: int
    account_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    account: Optional[AccountSummary] = None
    items: List[OrderItemOut] = []

    class Config:
        from_attributes = True


# Dashboard schema
class DashboardStats(BaseModel):
    total_accounts: int
    active_accounts: int
    prospect_accounts: int
    follow_ups_due_today: int
    follow_ups_overdue: int
    follow_ups_this_week: int
    open_orders: int
    total_order_value: float
    recent_follow_ups: List[FollowUpOut] = []
    upcoming_follow_ups: List[FollowUpOut] = []
