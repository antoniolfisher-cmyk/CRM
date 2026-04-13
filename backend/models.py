from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


# ─── Multi-Tenant Core ────────────────────────────────────────────────────────

class Tenant(Base):
    __tablename__ = "tenants"

    id                      = Column(Integer, primary_key=True, index=True)
    name                    = Column(String, nullable=False)
    slug                    = Column(String, unique=True, nullable=False, index=True)
    plan                    = Column(String, default="starter")   # starter|pro|enterprise
    is_active               = Column(Boolean, default=True)

    # Stripe billing
    stripe_customer_id      = Column(String, nullable=True)
    stripe_subscription_id  = Column(String, nullable=True)
    stripe_price_id         = Column(String, nullable=True)
    stripe_status           = Column(String, nullable=True)  # active|trialing|canceled|past_due
    trial_ends_at           = Column(DateTime(timezone=True), nullable=True)

    created_at              = Column(DateTime(timezone=True), server_default=func.now())

    users             = relationship("User", back_populates="tenant")
    amazon_credential = relationship("AmazonCredential", back_populates="tenant", uselist=False)


class AmazonCredential(Base):
    """Per-tenant Amazon SP-API credentials (encrypted at rest via ENCRYPTION_KEY)."""
    __tablename__ = "amazon_credentials"

    id               = Column(Integer, primary_key=True, index=True)
    tenant_id        = Column(Integer, ForeignKey("tenants.id"), unique=True, nullable=False)

    # These can come from OAuth flow or manual entry
    lwa_client_id     = Column(String, nullable=True)   # app-level (shared) or per-seller
    lwa_client_secret = Column(String, nullable=True)   # app-level (shared) or per-seller
    sp_refresh_token  = Column(String, nullable=True)   # per-seller, from OAuth
    seller_id         = Column(String, nullable=True)
    store_name        = Column(String, nullable=True)   # Amazon storefront/business name
    marketplace_id    = Column(String, default="ATVPDKIKX0DER")
    is_sandbox        = Column(Boolean, default=False)

    connected_at     = Column(DateTime(timezone=True), nullable=True)
    connected_by     = Column(String, nullable=True)   # username who connected

    tenant = relationship("Tenant", back_populates="amazon_credential")


# ─── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    tenant_id     = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    username      = Column(String, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role               = Column(String, default="user")   # "admin" or "user"
    is_active          = Column(Boolean, default=True)
    email              = Column(String, nullable=True)
    notify_email       = Column(Boolean, default=True)
    dashboard_sections = Column(Text, nullable=True)   # comma-separated dashboard widget keys; NULL = all
    page_permissions   = Column(Text, nullable=True)   # comma-separated page keys; NULL = all pages
    created_at         = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", back_populates="users")


# ─── Enums ────────────────────────────────────────────────────────────────────

class AccountStatus(str, enum.Enum):
    active   = "active"
    inactive = "inactive"
    prospect = "prospect"
    on_hold  = "on_hold"


class AccountType(str, enum.Enum):
    retailer    = "retailer"
    distributor = "distributor"
    restaurant  = "restaurant"
    grocery     = "grocery"
    online      = "online"
    other       = "other"


class FollowUpType(str, enum.Enum):
    call    = "call"
    email   = "email"
    meeting = "meeting"
    visit   = "visit"
    other   = "other"


class FollowUpStatus(str, enum.Enum):
    pending   = "pending"
    completed = "completed"
    cancelled = "cancelled"


class FollowUpPriority(str, enum.Enum):
    low    = "low"
    medium = "medium"
    high   = "high"


class OrderStatus(str, enum.Enum):
    quote     = "quote"
    pending   = "pending"
    confirmed = "confirmed"
    shipped   = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


# ─── CRM Models (all scoped by tenant_id) ────────────────────────────────────

class Account(Base):
    __tablename__ = "accounts"

    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_by   = Column(String, nullable=True, index=True)
    name         = Column(String, nullable=False, index=True)
    account_type = Column(String, default="retailer")
    status       = Column(String, default="prospect")
    phone        = Column(String)
    email        = Column(String)
    website      = Column(String)
    address      = Column(String)
    city         = Column(String)
    state        = Column(String)
    zip_code     = Column(String)
    territory    = Column(String)
    payment_terms = Column(String)
    credit_limit = Column(Float, default=0)
    notes        = Column(Text)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), onupdate=func.now())

    pipeline_stage           = Column(String, default="new", nullable=False)
    pipeline_updated_at      = Column(DateTime(timezone=True), nullable=True)
    last_auto_followup_at    = Column(DateTime(timezone=True), nullable=True)

    contacts  = relationship("Contact",  back_populates="account", cascade="all, delete-orphan")
    follow_ups = relationship("FollowUp", back_populates="account", cascade="all, delete-orphan")
    orders    = relationship("Order",    back_populates="account", cascade="all, delete-orphan")


class Contact(Base):
    __tablename__ = "contacts"

    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_by = Column(String, nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    first_name = Column(String, nullable=False)
    last_name  = Column(String, nullable=False)
    title      = Column(String)
    phone      = Column(String)
    mobile     = Column(String)
    email      = Column(String)
    is_primary = Column(Boolean, default=False)
    notes      = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account    = relationship("Account", back_populates="contacts")
    follow_ups = relationship("FollowUp", back_populates="contact")


class FollowUp(Base):
    __tablename__ = "follow_ups"

    id               = Column(Integer, primary_key=True, index=True)
    tenant_id        = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_by       = Column(String, nullable=True, index=True)
    account_id       = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    contact_id       = Column(Integer, ForeignKey("contacts.id"), nullable=True)
    follow_up_type   = Column(String, default="call")
    status           = Column(String, default="pending")
    priority         = Column(String, default="medium")
    subject          = Column(String, nullable=False)
    due_date         = Column(DateTime(timezone=True), nullable=False)
    completed_date   = Column(DateTime(timezone=True), nullable=True)
    notes            = Column(Text)
    outcome          = Column(Text)
    next_follow_up_date = Column(DateTime(timezone=True), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
    updated_at       = Column(DateTime(timezone=True), onupdate=func.now())

    account = relationship("Account", back_populates="follow_ups")
    contact = relationship("Contact", back_populates="follow_ups")


class Order(Base):
    __tablename__ = "orders"

    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_by   = Column(String, nullable=True, index=True)
    account_id   = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    order_number = Column(String, index=True)
    status       = Column(String, default="pending")
    order_date   = Column(DateTime(timezone=True), server_default=func.now())
    ship_date    = Column(DateTime(timezone=True), nullable=True)
    subtotal     = Column(Float, default=0)
    discount     = Column(Float, default=0)
    total        = Column(Float, default=0)
    notes        = Column(Text)
    created_at   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at   = Column(DateTime(timezone=True), onupdate=func.now())

    account = relationship("Account", back_populates="orders")
    items   = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id           = Column(Integer, primary_key=True, index=True)
    order_id     = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_name = Column(String, nullable=False)
    sku          = Column(String)
    quantity     = Column(Float, default=1)
    unit         = Column(String, default="case")
    unit_price   = Column(Float, default=0)
    total        = Column(Float, default=0)

    order = relationship("Order", back_populates="items")


class EmailMessage(Base):
    __tablename__ = "email_messages"

    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    direction  = Column(String, nullable=False)   # "sent" | "received"
    from_email = Column(String)
    to_email   = Column(String)
    subject    = Column(String)
    body_text  = Column(Text)
    is_read    = Column(Boolean, default=False)
    sent_by    = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account", backref="email_messages")


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id               = Column(Integer, primary_key=True, index=True)
    tenant_id        = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    username         = Column(String, nullable=False, index=True)
    clock_in         = Column(DateTime(timezone=True), nullable=False)
    clock_out        = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Float, nullable=True)
    notes            = Column(Text, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())


class RepricerStrategy(Base):
    __tablename__ = "repricer_strategies"

    id             = Column(Integer, primary_key=True, index=True)
    tenant_id      = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    name           = Column(String, nullable=False)
    description    = Column(Text, nullable=True)
    strategy_type  = Column(String, nullable=False, default="buy_box")
    target         = Column(String, nullable=True)
    compete_action = Column(String, nullable=True, default="beat_pct")
    compete_value  = Column(Float, nullable=True)
    winning_action = Column(String, nullable=True, default="raise_pct")
    winning_value  = Column(Float, nullable=True)
    min_price      = Column(Float, nullable=True)
    max_price      = Column(Float, nullable=True)
    profit_floor   = Column(Float, nullable=True)
    is_active      = Column(Boolean, default=True)
    is_default     = Column(Boolean, default=False)
    notes          = Column(Text, nullable=True)
    created_at     = Column(DateTime(timezone=True), server_default=func.now())
    updated_at     = Column(DateTime(timezone=True), onupdate=func.now())


class Product(Base):
    __tablename__ = "products"

    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    created_by = Column(String, nullable=True, index=True)

    asin          = Column(String, index=True)
    product_name  = Column(String, nullable=False)
    amazon_url    = Column(String)
    purchase_link = Column(String)

    date_found   = Column(DateTime(timezone=True))
    va_finder    = Column(String)

    date_purchased  = Column(DateTime(timezone=True))
    order_number    = Column(String)
    quantity        = Column(Float, default=0)
    buy_cost        = Column(Float, default=0)
    money_spent     = Column(Float, default=0)

    arrived_at_prep         = Column(DateTime(timezone=True))
    date_sent_to_amazon     = Column(DateTime(timezone=True))
    amazon_tracking_number  = Column(String)

    ungated          = Column(Boolean, default=False)
    ungating_quantity = Column(Float, default=0)
    total_bought     = Column(Float, default=0)
    replenish        = Column(Boolean, default=False)

    amazon_fee    = Column(Float, default=0)
    total_cost    = Column(Float, default=0)
    buy_box       = Column(Float, default=0)
    profit        = Column(Float, default=0)
    profit_margin = Column(Float, default=0)
    roi           = Column(Float, default=0)
    estimated_sales = Column(Float, default=0)
    num_sellers   = Column(Integer, default=0)

    notes      = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    keepa_bsr         = Column(Integer, nullable=True)
    keepa_category    = Column(String, nullable=True)
    keepa_last_synced = Column(DateTime(timezone=True), nullable=True)

    # 90-day price stats from Keepa (stored so they survive token exhaustion)
    price_90_high  = Column(Float, nullable=True)
    price_90_low   = Column(Float, nullable=True)
    price_90_median = Column(Float, nullable=True)
    fba_low        = Column(Float, nullable=True)
    fba_high       = Column(Float, nullable=True)
    fba_median     = Column(Float, nullable=True)
    fbm_low        = Column(Float, nullable=True)
    fbm_high       = Column(Float, nullable=True)
    fbm_median     = Column(Float, nullable=True)

    status = Column(String, default='sourcing')

    aria_suggested_price = Column(Float, nullable=True)
    aria_suggested_at    = Column(DateTime(timezone=True), nullable=True)
    aria_reasoning       = Column(Text, nullable=True)
    aria_last_buy_box    = Column(Float, nullable=True)
    aria_strategy_id     = Column(Integer, nullable=True)
    fulfillment_channel  = Column(String, nullable=True)   # 'FBA' | 'FBM' | None (legacy)

    ungate_requests = relationship("UngateRequest", back_populates="product", cascade="all, delete-orphan")


class UngateTemplate(Base):
    __tablename__ = "ungate_templates"

    id          = Column(Integer, primary_key=True, index=True)
    tenant_id   = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    number      = Column(Integer, nullable=False)
    name        = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    subject     = Column(String, nullable=True)
    body        = Column(Text, nullable=False)
    category    = Column(String, default="general")
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())


class UngateRequest(Base):
    __tablename__ = "ungate_requests"

    id                   = Column(Integer, primary_key=True, index=True)
    tenant_id            = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    product_id           = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    asin                 = Column(String, nullable=False, index=True)
    product_name         = Column(String, nullable=False)
    category             = Column(String, nullable=True)
    status               = Column(String, default="pending")
    current_template_num = Column(Integer, default=1)
    requirements         = Column(Text, nullable=True)
    history              = Column(Text, default="[]")
    amazon_case_id       = Column(String, nullable=True)
    notes                = Column(Text, nullable=True)
    invoice_filename     = Column(String, nullable=True)   # attached invoice filename (no data)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    updated_at           = Column(DateTime(timezone=True), onupdate=func.now())

    product = relationship("Product", back_populates="ungate_requests")


class UngateInvoice(Base):
    """Invoice PDF/image stored as base64, linked to an ungating request."""
    __tablename__ = "ungate_invoices"

    id         = Column(Integer, primary_key=True)
    req_id     = Column(Integer, ForeignKey("ungate_requests.id", ondelete="CASCADE"),
                        nullable=False, unique=True, index=True)
    filename   = Column(String, nullable=False)
    data_b64   = Column(Text, nullable=False)    # base64-encoded file
    size_bytes = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    request = relationship("UngateRequest")


# ─── Billing / Subscription Tracking ────────────────────────────────────────

class BillingInvoice(Base):
    """Immutable record of every Stripe payment event, keyed per tenant."""
    __tablename__ = "billing_invoices"

    id                = Column(Integer, primary_key=True, index=True)
    tenant_id         = Column(Integer, ForeignKey("tenants.id"), nullable=False, index=True)
    stripe_invoice_id = Column(String, unique=True, nullable=True, index=True)
    stripe_charge_id  = Column(String, nullable=True)
    amount_cents      = Column(Integer, default=0)           # in cents (USD)
    currency          = Column(String, default="usd")
    status            = Column(String, nullable=False)       # paid | failed | refunded | open
    plan              = Column(String, nullable=True)        # starter | pro | enterprise
    period_start      = Column(DateTime(timezone=True), nullable=True)
    period_end        = Column(DateTime(timezone=True), nullable=True)
    description       = Column(String, nullable=True)
    invoice_url       = Column(String, nullable=True)        # Stripe hosted invoice URL
    created_at        = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", backref="invoices")
