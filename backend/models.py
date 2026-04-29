from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from crypto import EncryptedString
import enum


# ─── Multi-Tenant Core ────────────────────────────────────────────────────────

class Tenant(Base):
    __tablename__ = "tenants"

    id                      = Column(Integer, primary_key=True, index=True)
    name                    = Column(String, nullable=False)
    slug                    = Column(String, unique=True, nullable=False, index=True)
    plan                    = Column(String, default="starter")   # starter|pro|enterprise
    is_active               = Column(Boolean, default=True)
    is_beta                 = Column(Boolean, default=False)  # permanent bypass: immune to billing/trial enforcement

    # Stripe billing
    stripe_customer_id      = Column(String, nullable=True)
    stripe_subscription_id  = Column(String, nullable=True)
    stripe_price_id         = Column(String, nullable=True)
    stripe_status           = Column(String, nullable=True)  # active|trialing|canceled|past_due
    trial_ends_at           = Column(DateTime(timezone=True), nullable=True)

    created_at              = Column(DateTime(timezone=True), server_default=func.now())
    deleted_at              = Column(DateTime(timezone=True), nullable=True)

    users             = relationship("User", back_populates="tenant")
    amazon_credential = relationship("AmazonCredential", back_populates="tenant", uselist=False)


class AmazonCredential(Base):
    """Per-tenant Amazon SP-API credentials (encrypted at rest via ENCRYPTION_KEY)."""
    __tablename__ = "amazon_credentials"

    id               = Column(Integer, primary_key=True, index=True)
    tenant_id        = Column(Integer, ForeignKey("tenants.id"), unique=True, nullable=False)

    # These can come from OAuth flow or manual entry
    lwa_client_id     = Column(String, nullable=True)
    lwa_client_secret = Column(EncryptedString(1024), nullable=True)
    sp_refresh_token  = Column(EncryptedString(1024), nullable=True)
    seller_id         = Column(String, nullable=True)
    store_name        = Column(String, nullable=True)   # Amazon storefront/business name
    marketplace_id    = Column(String, default="ATVPDKIKX0DER")
    is_sandbox        = Column(Boolean, default=False)

    connected_at     = Column(DateTime(timezone=True), nullable=True)
    connected_by     = Column(String, nullable=True)   # username who connected
    ship_from_json   = Column(Text, nullable=True)     # JSON: seller ship-from address for MFN labels

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
    email_verified     = Column(Boolean, default=False)
    dashboard_sections = Column(Text, nullable=True)
    page_permissions   = Column(Text, nullable=True)
    failed_login_count = Column(Integer, default=0)
    locked_until       = Column(DateTime(timezone=True), nullable=True)
    last_login_at      = Column(DateTime(timezone=True), nullable=True)
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
    account_type = Column(String, default="retailer", index=True)
    status       = Column(String, default="prospect", index=True)
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
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
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
    account_id       = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    contact_id       = Column(Integer, ForeignKey("contacts.id"), nullable=True, index=True)
    follow_up_type   = Column(String, default="call")
    status           = Column(String, default="pending", index=True)
    priority         = Column(String, default="medium", index=True)
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
    account_id   = Column(Integer, ForeignKey("accounts.id"), nullable=False, index=True)
    order_number = Column(String, index=True)
    status       = Column(String, default="pending", index=True)
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
    order_id     = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
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
    min_roi        = Column(Float, nullable=True)     # minimum ROI % (e.g. 5 = 5%)
    aggressiveness = Column(Integer, nullable=True)   # 1=max profit … 10=win Buy Box
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

    status = Column(String, default='sourcing', index=True)

    seller_sku           = Column(String, nullable=True, index=True)   # Amazon seller-assigned SKU
    aria_suggested_price = Column(Float, nullable=True)
    aria_suggested_at    = Column(DateTime(timezone=True), nullable=True)
    aria_reasoning       = Column(Text, nullable=True)
    aria_last_buy_box    = Column(Float, nullable=True)
    aria_strategy_id     = Column(Integer, nullable=True)
    aria_live_price      = Column(Float, nullable=True)      # last price actually pushed to Amazon
    aria_live_pushed_at  = Column(DateTime(timezone=True), nullable=True)
    buy_box_winner       = Column(Boolean, nullable=True)    # True=we have Buy Box, False=we don't, None=unknown
    buy_box_checked_at   = Column(DateTime(timezone=True), nullable=True)
    fulfillment_channel  = Column(String, nullable=True)   # 'FBA' | 'FBM' | None (legacy)

    ungate_requests = relationship("UngateRequest", back_populates="product", cascade="all, delete-orphan")


class RepricerLog(Base):
    """One row per price change Aria pushes to Amazon."""
    __tablename__ = "repricer_logs"

    id           = Column(Integer, primary_key=True, index=True)
    tenant_id    = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    product_id   = Column(Integer, nullable=True)   # soft ref — product may be deleted
    asin         = Column(String, nullable=False, index=True)
    seller_sku   = Column(String, nullable=True)
    product_name = Column(String, nullable=True)
    old_price    = Column(Float, nullable=True)
    new_price    = Column(Float, nullable=False)
    buy_box      = Column(Float, nullable=True)
    reasoning    = Column(Text, nullable=True)
    pushed       = Column(Boolean, default=False)    # True = sent to Amazon successfully
    amazon_status = Column(Integer, nullable=True)   # HTTP status from Listings API
    created_at   = Column(DateTime(timezone=True), server_default=func.now())


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


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token      = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used       = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token      = Column(String, unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used       = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


# ─── Audit Log ───────────────────────────────────────────────────────────────

class AuditLog(Base):
    """Immutable record of security-relevant actions, scoped per tenant."""
    __tablename__ = "audit_logs"

    id         = Column(Integer, primary_key=True, index=True)
    tenant_id  = Column(Integer, ForeignKey("tenants.id"), nullable=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    username   = Column(String, nullable=True)
    action     = Column(String, nullable=False, index=True)  # e.g. "login", "credentials.save"
    target     = Column(String, nullable=True)               # e.g. "user:42", "tenant:7"
    detail     = Column(Text, nullable=True)                 # JSON or plain description
    ip         = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)


# ─── Waitlist ─────────────────────────────────────────────────────────────────

class WaitlistEntry(Base):
    __tablename__ = "waitlist"

    id           = Column(Integer, primary_key=True, index=True)
    email        = Column(String, unique=True, nullable=False, index=True)
    name         = Column(String, nullable=True)
    company      = Column(String, nullable=True)
    monthly_gmv  = Column(String, nullable=True)   # revenue range they select
    source       = Column(String, nullable=True)   # utm_source or referral
    notes        = Column(Text, nullable=True)
    created_at   = Column(DateTime(timezone=True), server_default=func.now(), index=True)
