import os
from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./crm.db")

# Railway provides postgres:// URLs but SQLAlchemy needs postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

is_sqlite = DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {"options": "-csearch_path=public"}

# Pool sized for 10k+ users: 20 base + 40 overflow = 60 max connections per worker.
# With 4 uvicorn workers this is 240 total — stay within Railway PG limits by
# setting POOL_SIZE / POOL_OVERFLOW env vars or deploying PgBouncer in front.
_PG_POOL = dict(
    pool_size=int(os.getenv("POOL_SIZE", "20")),
    max_overflow=int(os.getenv("POOL_OVERFLOW", "40")),
    pool_recycle=1800,
    pool_timeout=10,
    pool_pre_ping=True,
)

if is_sqlite:
    engine = create_engine(DATABASE_URL, connect_args=connect_args)
else:
    engine = create_engine(DATABASE_URL, connect_args=connect_args, **_PG_POOL)

# ── Read replica (optional) ────────────────────────────────────────────────────
# Set READ_REPLICA_URL to route SELECT-heavy list endpoints off the primary.
# Falls back to primary when not configured — zero code changes needed on upgrade.
_READ_URL = os.getenv("READ_REPLICA_URL", "").replace("postgres://", "postgresql://", 1)
if _READ_URL and not is_sqlite:
    _read_engine = create_engine(_READ_URL, connect_args=connect_args, **_PG_POOL)
else:
    _read_engine = engine

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
_ReadSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_read_engine)
Base = declarative_base()

_DB_TIMEOUT_MS = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000"))


def get_db():
    db = SessionLocal()
    try:
        if not is_sqlite:
            db.execute(text("SET search_path = public"))
            db.execute(text(f"SET LOCAL statement_timeout = {_DB_TIMEOUT_MS}"))
        yield db
    finally:
        db.close()


def get_read_db():
    """Read-only session — routed to replica when READ_REPLICA_URL is set."""
    db = _ReadSessionLocal()
    try:
        if not is_sqlite:
            db.execute(text("SET search_path = public"))
            db.execute(text(f"SET LOCAL statement_timeout = {_DB_TIMEOUT_MS}"))
        yield db
    finally:
        db.close()
