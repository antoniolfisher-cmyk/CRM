from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, Boolean, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum


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

    contacts = relationship("Contact", back_populates="account", cascade="all, delete-orphan")
    follow_ups = relationship("FollowUp", back_populates="account", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="account", cascade="all, delete-orphan")


class Contact(Base):
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
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
