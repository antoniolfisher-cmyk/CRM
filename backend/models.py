from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")   # "admin" or "user"
    is_active = Column(Boolean, default=True)
    email = Column(String, nullable=True)
    notify_email = Column(Boolean, default=True)   # receive follow-up digests
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AccountStatus(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    prospect = "prospect"
    on_hold = "on_hold"


class AccountType(str, enum.Enum):
    retailer = "retailer"
    distributor = "distributor"
    restaurant = "restaurant"
    grocery = "grocery"
    online = "online"
    other = "other"


class FollowUpType(str, enum.Enum):
    call = "call"
    email = "email"
    meeting = "meeting"
    visit = "visit"
    other = "other"


class FollowUpStatus(str, enum.Enum):
    pending = "pending"
    completed = "completed"
    cancelled = "cancelled"


class FollowUpPriority(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"


class OrderStatus(str, enum.Enum):
    quote = "quote"
    pending = "pending"
    confirmed = "confirmed"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False, index=True)
    account_type = Column(String, default="retailer")
    status = Column(String, default="prospect")
    phone = Column(String)
    email = Column(String)
    website = Column(String)
    address = Column(String)
    city = Column(String)
    state = Column(String)
    zip_code = Column(String)
    territory = Column(String)
    payment_terms = Column(String)
    credit_limit = Column(Float, default=0)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Opening pipeline tracking
    pipeline_stage = Column(String, default="new", nullable=False)
    pipeline_updated_at = Column(DateTime(timezone=True), nullable=True)
    last_auto_followup_at = Column(DateTime(timezone=True), nullable=True)

    contacts = relationship("Contact", back_populates="account", cascade="all, delete-orphan")
    follow_ups = relationship("FollowUp", back_populates="account", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="account", cascade="all, delete-orphan")


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(String, nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    title = Column(String)
    phone = Column(String)
    mobile = Column(String)
    email = Column(String)
    is_primary = Column(Boolean, default=False)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account", back_populates="contacts")
    follow_ups = relationship("FollowUp", back_populates="contact")


class FollowUp(Base):
    __tablename__ = "follow_ups"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(String, nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    contact_id = Column(Integer, ForeignKey("contacts.id"), nullable=True)
    follow_up_type = Column(String, default="call")
    status = Column(String, default="pending")
    priority = Column(String, default="medium")
    subject = Column(String, nullable=False)
    due_date = Column(DateTime(timezone=True), nullable=False)
    completed_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text)
    outcome = Column(Text)
    next_follow_up_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    account = relationship("Account", back_populates="follow_ups")
    contact = relationship("Contact", back_populates="follow_ups")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(String, nullable=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"), nullable=False)
    order_number = Column(String, unique=True, index=True)
    status = Column(String, default="pending")
    order_date = Column(DateTime(timezone=True), server_default=func.now())
    ship_date = Column(DateTime(timezone=True), nullable=True)
    subtotal = Column(Float, default=0)
    discount = Column(Float, default=0)
    total = Column(Float, default=0)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    account = relationship("Account", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_name = Column(String, nullable=False)
    sku = Column(String)
    quantity = Column(Float, default=1)
    unit = Column(String, default="case")
    unit_price = Column(Float, default=0)
    total = Column(Float, default=0)

    order = relationship("Order", back_populates="items")


class EmailMessage(Base):
    __tablename__ = "email_messages"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    direction = Column(String, nullable=False)   # "sent" | "received"
    from_email = Column(String)
    to_email = Column(String)
    subject = Column(String)
    body_text = Column(Text)
    is_read = Column(Boolean, default=False)
    sent_by = Column(String, nullable=True)      # username for outbound emails
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    account = relationship("Account", backref="email_messages")


class TimeEntry(Base):
    __tablename__ = "time_entries"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=False, index=True)
    clock_in = Column(DateTime(timezone=True), nullable=False)
    clock_out = Column(DateTime(timezone=True), nullable=True)
    duration_minutes = Column(Float, nullable=True)  # computed on clock-out
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    created_by = Column(String, nullable=True, index=True)

    # Identity
    asin = Column(String, index=True)
    product_name = Column(String, nullable=False)
    amazon_url = Column(String)
    purchase_link = Column(String)

    # Discovery & logistics
    date_found = Column(DateTime(timezone=True))
    va_finder = Column(String)           # Virtual Assistant who sourced it

    # Purchase info
    date_purchased = Column(DateTime(timezone=True))
    order_number = Column(String)
    quantity = Column(Float, default=0)
    buy_cost = Column(Float, default=0)   # cost per unit
    money_spent = Column(Float, default=0)  # total cash out

    # Amazon pipeline
    arrived_at_prep = Column(DateTime(timezone=True))
    date_sent_to_amazon = Column(DateTime(timezone=True))
    amazon_tracking_number = Column(String)

    # Gating
    ungated = Column(Boolean, default=False)
    ungating_quantity = Column(Float, default=0)

    # Inventory management
    total_bought = Column(Float, default=0)
    replenish = Column(Boolean, default=False)

    # Financials
    amazon_fee = Column(Float, default=0)
    total_cost = Column(Float, default=0)   # buy_cost + amazon_fee per unit
    buy_box = Column(Float, default=0)      # current Amazon buy box price
    profit = Column(Float, default=0)       # per unit
    profit_margin = Column(Float, default=0)  # 0.xx decimal
    roi = Column(Float, default=0)          # 0.xx decimal
    estimated_sales = Column(Float, default=0)
    num_sellers = Column(Integer, default=0)

    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
