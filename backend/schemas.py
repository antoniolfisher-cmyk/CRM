from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# User schemas
class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"
    is_active: bool = True
    email: Optional[str] = None
    notify_email: bool = True
    dashboard_sections: Optional[str] = None   # comma-separated; None = all visible
    page_permissions:   Optional[str] = None   # comma-separated page keys; None = all pages


class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    email: Optional[str] = None
    notify_email: Optional[bool] = None
    dashboard_sections: Optional[str] = None
    page_permissions:   Optional[str] = None


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    email: Optional[str] = None
    notify_email: bool = True
    dashboard_sections: Optional[str] = None
    page_permissions:   Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


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


# Product schemas
class ProductBase(BaseModel):
    asin: Optional[str] = None
    product_name: Optional[str] = None
    amazon_url: Optional[str] = None
    purchase_link: Optional[str] = None
    date_found: Optional[datetime] = None
    va_finder: Optional[str] = None
    date_purchased: Optional[datetime] = None
    order_number: Optional[str] = None
    quantity: Optional[float] = 0
    buy_cost: Optional[float] = 0
    money_spent: Optional[float] = 0
    arrived_at_prep: Optional[datetime] = None
    date_sent_to_amazon: Optional[datetime] = None
    amazon_tracking_number: Optional[str] = None
    ungated: Optional[bool] = False
    ungating_quantity: Optional[float] = 0
    total_bought: Optional[float] = 0
    replenish: Optional[bool] = False
    amazon_fee: Optional[float] = 0
    total_cost: Optional[float] = 0
    buy_box: Optional[float] = 0
    profit: Optional[float] = 0
    profit_margin: Optional[float] = 0
    roi: Optional[float] = 0
    estimated_sales: Optional[float] = 0
    num_sellers: Optional[int] = 0
    notes: Optional[str] = None
    keepa_bsr: Optional[int] = None
    keepa_category: Optional[str] = None
    keepa_last_synced: Optional[datetime] = None
    aria_suggested_price: Optional[float] = None
    aria_suggested_at: Optional[datetime] = None
    aria_reasoning: Optional[str] = None
    aria_last_buy_box: Optional[float] = None
    aria_strategy_id: Optional[int] = None
    aria_live_price: Optional[float] = None
    aria_live_pushed_at: Optional[datetime] = None
    buy_box_winner: Optional[bool] = None        # True=winning Buy Box, False=not winning, None=unknown
    buy_box_checked_at: Optional[datetime] = None
    status: Optional[str] = 'sourcing'   # sourcing | pending | approved
    fulfillment_channel: Optional[str] = None  # 'FBA' | 'FBM' | None


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    product_name: Optional[str] = None


class ProductOut(ProductBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Repricer strategy schemas
class RepricerStrategyBase(BaseModel):
    name: str
    description: Optional[str] = None
    strategy_type: str = "buy_box"          # maven|buy_box|featured_merchants|lowest_price|custom
    target: Optional[str] = None            # buy_box_winner|featured_merchants|lowest_price
    compete_action: Optional[str] = "beat_pct"   # match|beat_pct|beat_amt
    compete_value: Optional[float] = None   # fraction (0.01=1%) or dollar amt
    winning_action: Optional[str] = "raise_pct"  # maintain|raise_pct|raise_amt|raise_to_max
    winning_value: Optional[float] = None   # fraction or dollar amt
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    profit_floor: Optional[float] = None
    min_roi: Optional[float] = None          # minimum ROI % e.g. 5.0 = 5%
    aggressiveness: Optional[int] = None     # 1=max profit … 10=win Buy Box
    is_active: bool = True
    is_default: bool = False
    notes: Optional[str] = None


class RepricerStrategyCreate(RepricerStrategyBase):
    pass


class RepricerStrategyUpdate(RepricerStrategyBase):
    name: Optional[str] = None
    strategy_type: Optional[str] = None
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None


class RepricerStrategyOut(RepricerStrategyBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Account email
class AccountEmailSend(BaseModel):
    to: str
    subject: str
    body: str           # plain text with optional [CALLOUT] / [FEATURE_CARDS] markers
    template_id: Optional[str] = None
    sender_name: Optional[str] = None


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
