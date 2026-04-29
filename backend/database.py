import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./crm.db")

# Railway provides postgres:// URLs but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}

if is_sqlite:
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        pool_timeout=30,
        pool_pre_ping=True,
        connect_args=connect_args,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

_DB_TIMEOUT_MS = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000"))


def get_db():
    db = SessionLocal()
    try:
        # Per-session timeout: kills runaway queries without affecting migrations
        # or background jobs (SET LOCAL only applies to this transaction).
        if not is_sqlite:
            db.execute(text(f"SET LOCAL statement_timeout = {_DB_TIMEOUT_MS}"))
        yield db
    finally:
        db.close()
