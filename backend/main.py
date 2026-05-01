import os
import asyncio
import logging
import logging.config
import json
import urllib.parse
from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse as StarletteJSONResponse

# ── Structured JSON logging ────────────────────────────────────────────────────
class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts":      self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":   record.levelname,
            "logger":  record.name,
            "msg":     record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)

_log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": _JsonFormatter}},
    "handlers": {
        "stdout": {
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
            "formatter": "json",
        }
    },
    "root": {"level": _log_level, "handlers": ["stdout"]},
    # Keep uvicorn's access log in JSON too
    "loggers": {
        "uvicorn":        {"level": _log_level, "propagate": True},
        "uvicorn.access": {"level": _log_level, "propagate": True},
        "uvicorn.error":  {"level": _log_level, "propagate": True},
    },
})

log = logging.getLogger(__name__)

# Sentry — optional, only active when SENTRY_DSN is set
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    _sentry_dsn = os.getenv("SENTRY_DSN", "")
    if _sentry_dsn:
        sentry_sdk.init(
            dsn=_sentry_dsn,
            integrations=[FastApiIntegration(), SqlalchemyIntegration()],
            traces_sample_rate=0.05,
            profiles_sample_rate=0.05,
            environment=os.getenv("RAILWAY_ENVIRONMENT", "production"),
            send_default_pii=False,
        )
        log.info("Sentry initialised")
except Exception as _sentry_err:
    log.warning("Sentry not loaded: %s", _sentry_err)

# Rate limiting — optional, gracefully disabled if slowapi not installed
try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    limiter = Limiter(key_func=get_remote_address)
    _limiter_enabled = True
except Exception as _slowapi_err:
    log.warning("slowapi not loaded — rate limiting disabled: %s", _slowapi_err)
    _limiter_enabled = False
    # Stub so decorators don't crash
    class _NoopLimiter:
        def limit(self, *a, **kw):
            return lambda f: f
    limiter = _NoopLimiter()
    RateLimitExceeded = Exception
    def _rate_limit_exceeded_handler(req, exc): pass
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, text
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
import models
import schemas
from database import engine, get_db, get_read_db
from fastapi.security import HTTPAuthorizationCredentials
from auth import (
    LoginRequest, RegisterRequest, create_token, require_auth, require_admin,
    require_superadmin, hash_password, verify_password, ensure_bootstrap_admin, get_tenant_id,
    revoke_token, TOKEN_EXPIRE_HOURS, bearer,
)
from notifications import start_scheduler, stop_scheduler, send_daily_digests, send_email, build_digest_html, _smtp_configured, get_aria_schedule_info
import aria_repricer
import stripe_billing
from fastapi.encoders import jsonable_encoder
from cache import cache_get, cache_set, cache_bust, make_key

# ── Background email queue ─────────────────────────────────────────────────────
# Wraps send_email in a thread-pool executor so the request thread is never
# blocked by SMTP/SendGrid/Resend latency (~200 ms–2 s per message).
import concurrent.futures as _futures
_email_pool = _futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="email")

def _send_email_bg(to: str, subject: str, html: str, **kwargs):
    """Fire-and-forget email — non-blocking, logs failures without raising."""
    def _run():
        try:
            send_email(to, subject, html, **kwargs)
        except Exception as _e:
            log.warning("Background email failed to=%s subject=%r: %s", to, subject, _e)
    _email_pool.submit(_run)

# Create all tables using SQLAlchemy 2.0-compatible API
try:
    with engine.begin() as _conn:
        models.Base.metadata.create_all(_conn, checkfirst=True)
    print("[startup] all tables created/verified", flush=True)
except Exception as _tbl_err:
    print(f"[startup] create_all failed: {_tbl_err}", flush=True)
    # Fallback: create each table individually to isolate failures
    for _tbl in models.Base.metadata.sorted_tables:
        try:
            with engine.begin() as _conn:
                _tbl.create(_conn, checkfirst=True)
        except Exception as _te:
            print(f"[startup] create table {_tbl.name} failed: {_te}", flush=True)

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
    # Pipeline stage columns on accounts
    try:
        _cols = [c["name"] for c in _inspector.get_columns("accounts")]
        for _col, _ddl in [
            ("pipeline_stage",        "VARCHAR NOT NULL DEFAULT 'new'"),
            ("pipeline_updated_at",   "TIMESTAMP WITH TIME ZONE"),
            ("last_auto_followup_at", "TIMESTAMP WITH TIME ZONE"),
        ]:
            if _col not in _cols:
                try:
                    with engine.connect() as _conn:
                        _conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {_col} {_ddl}"))
                        _conn.commit()
                except Exception:
                    pass
    except Exception:
        pass
    # Products table — add every column the ORM model expects.
    # No inspector check — always attempt ADD COLUMN IF NOT EXISTS (idempotent in PG).
    # Each column runs in its own connection so one DDL error never blocks the rest.
    for _col, _ddl in [
        ("keepa_bsr",            "INTEGER"),
        ("keepa_category",       "VARCHAR"),
        ("keepa_last_synced",    "TIMESTAMP WITH TIME ZONE"),
        ("price_90_high",        "DOUBLE PRECISION"),
        ("price_90_low",         "DOUBLE PRECISION"),
        ("price_90_median",      "DOUBLE PRECISION"),
        ("fba_low",              "DOUBLE PRECISION"),
        ("fba_high",             "DOUBLE PRECISION"),
        ("fba_median",           "DOUBLE PRECISION"),
        ("fbm_low",              "DOUBLE PRECISION"),
        ("fbm_high",             "DOUBLE PRECISION"),
        ("fbm_median",           "DOUBLE PRECISION"),
        ("status",               "TEXT DEFAULT 'sourcing'"),
        ("seller_sku",           "VARCHAR"),
        ("aria_suggested_price", "DOUBLE PRECISION"),
        ("aria_suggested_at",    "TIMESTAMP WITH TIME ZONE"),
        ("aria_reasoning",       "TEXT"),
        ("aria_last_buy_box",    "DOUBLE PRECISION"),
        ("aria_strategy_id",     "INTEGER"),
        ("aria_live_price",      "DOUBLE PRECISION"),
        ("aria_live_pushed_at",  "TIMESTAMP WITH TIME ZONE"),
        ("buy_box_winner",       "BOOLEAN"),
        ("buy_box_checked_at",   "TIMESTAMP WITH TIME ZONE"),
        ("fulfillment_channel",  "VARCHAR"),
    ]:
        try:
            with engine.connect() as _conn:
                _conn.execute(text(f"ALTER TABLE products ADD COLUMN IF NOT EXISTS {_col} {_ddl}"))
                _conn.commit()
        except Exception as _ce:
            print(f"[startup] products.{_col}: {_ce}", flush=True)
    # Fix product statuses — runs every startup, idempotent
    try:
        with engine.connect() as _conn:
            _conn.execute(text("UPDATE products SET status = 'approved' WHERE status IS NULL"))
            _conn.execute(text(
                "UPDATE products SET status = 'approved' "
                "WHERE fulfillment_channel IN ('FBA', 'FBM') AND (status IS NULL OR status != 'approved')"
            ))
            _conn.commit()
    except Exception as _ce:
        print(f"[startup] products status fix: {_ce}", flush=True)
    # One-time migration: approve all pre-workflow sourcing products
    try:
        with engine.connect() as _conn:
            _conn.execute(text(
                "CREATE TABLE IF NOT EXISTS _migration_flags (name TEXT PRIMARY KEY)"
            ))
            already = _conn.execute(text(
                "SELECT 1 FROM _migration_flags WHERE name = 'approve_existing_sourcing'"
            )).fetchone()
            if not already:
                _conn.execute(text(
                    "UPDATE products SET status = 'approved' WHERE status = 'sourcing' OR status IS NULL"
                ))
                _conn.execute(text(
                    "INSERT INTO _migration_flags (name) VALUES ('approve_existing_sourcing')"
                ))
                _conn.commit()
    except Exception:
        pass
    # Repricer strategies schema
    try:
        if "repricer_strategies" in _inspector.get_table_names():
            _cols = [c["name"] for c in _inspector.get_columns("repricer_strategies")]
            with engine.connect() as _conn:
                for _col, _ddl in [
                    ("target",         "VARCHAR"),
                    ("compete_action", "VARCHAR DEFAULT 'beat_pct'"),
                    ("compete_value",  "DOUBLE PRECISION"),
                    ("winning_action", "VARCHAR DEFAULT 'raise_pct'"),
                    ("winning_value",  "DOUBLE PRECISION"),
                    ("profit_floor",    "DOUBLE PRECISION"),
                    ("min_roi",         "DOUBLE PRECISION"),
                    ("aggressiveness",  "INTEGER"),
                ]:
                    if _col not in _cols:
                        try:
                            with engine.connect() as _conn:
                                _conn.execute(text(f"ALTER TABLE repricer_strategies ADD COLUMN {_col} {_ddl}"))
                                _conn.commit()
                        except Exception:
                            pass
    except Exception:
        pass
    # ── Multi-tenant migration: add tenant_id to all tables ─────────────────
    try:
        _TENANT_TABLES = [
            "users", "accounts", "contacts", "follow_ups", "orders",
            "products", "repricer_strategies", "ungate_templates",
            "ungate_requests", "time_entries", "email_messages",
        ]
        for _table in _TENANT_TABLES:
            try:
                if _table not in _inspector.get_table_names():
                    continue
                _cols = [c["name"] for c in _inspector.get_columns(_table)]
                if "tenant_id" not in _cols:
                    with engine.connect() as _conn:
                        _conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN tenant_id INTEGER"))
                        _conn.commit()
            except Exception:
                pass
    except Exception:
        pass
    # Backfill tenant_id=1 on all existing rows (one-time)
    try:
        with engine.connect() as _conn:
            _BF_FLAG = "backfill_tenant_id_v1"
            _conn.execute(text("CREATE TABLE IF NOT EXISTS _migration_flags (name TEXT PRIMARY KEY)"))
            _already = _conn.execute(
                text("SELECT 1 FROM _migration_flags WHERE name = :name"),
                {"name": _BF_FLAG}
            ).fetchone()
            if not _already:
                # Only if a tenant with id=1 will exist (bootstrap creates it)
                for _t in ["users","accounts","contacts","follow_ups","orders",
                           "products","repricer_strategies","ungate_templates",
                           "ungate_requests","time_entries","email_messages"]:
                    try:
                        _conn.execute(text(
                            f"UPDATE {_t} SET tenant_id = 1 WHERE tenant_id IS NULL"
                        ))
                    except Exception:
                        pass
                _conn.execute(
                    text("INSERT INTO _migration_flags (name) VALUES (:name) ON CONFLICT DO NOTHING"),
                    {"name": _BF_FLAG}
                )
                _conn.commit()
    except Exception:
        pass
    # ── Add store_name to amazon_credentials ────────────────────────────────
    try:
        if "amazon_credentials" in _inspector.get_table_names():
            _ac_cols = [c["name"] for c in _inspector.get_columns("amazon_credentials")]
            if "store_name" not in _ac_cols:
                with engine.connect() as _conn:
                    _conn.execute(text("ALTER TABLE amazon_credentials ADD COLUMN store_name VARCHAR"))
                    _conn.commit()
    except Exception:
        pass
    # ── Add 90-day price stat columns + fulfillment_channel to products ─────
    try:
        _p_cols = [c["name"] for c in _inspector.get_columns("products")]
        with engine.connect() as _conn:
            for _col, _ddl in [
                ("price_90_high",       "FLOAT"),
                ("price_90_low",        "FLOAT"),
                ("price_90_median",     "FLOAT"),
                ("fba_low",             "FLOAT"),
                ("fba_high",            "FLOAT"),
                ("fba_median",          "FLOAT"),
                ("fbm_low",             "FLOAT"),
                ("fbm_high",            "FLOAT"),
                ("fbm_median",          "FLOAT"),
                ("fulfillment_channel", "VARCHAR"),
            ]:
                if _col not in _p_cols:
                    _conn.execute(text(f"ALTER TABLE products ADD COLUMN {_col} {_ddl}"))
            _conn.commit()
    except Exception:
        pass
    # billing_invoices is created by models.Base.metadata.create_all above
    # order_number unique constraint relaxed for multi-tenant
    try:
        _cols = [c["name"] for c in _inspector.get_columns("orders")]
        _idx  = [i["name"] for i in _inspector.get_indexes("orders")]
        # SQLite: drop-and-recreate not needed; just leave the unique constraint
    except Exception:
        pass
    # ── Add invoice_filename to ungate_requests ───────────────────────────────
    try:
        if "ungate_requests" in _inspector.get_table_names():
            _ur_cols = [c["name"] for c in _inspector.get_columns("ungate_requests")]
            if "invoice_filename" not in _ur_cols:
                with engine.connect() as _conn:
                    _conn.execute(text("ALTER TABLE ungate_requests ADD COLUMN invoice_filename VARCHAR"))
                    _conn.commit()
    except Exception:
        pass
    # ── Migrate ungate templates: replace {SELLER_ID} with {SELLER_NAME} ─────
    try:
        if "ungate_templates" in _inspector.get_table_names():
            with engine.connect() as _conn:
                _conn.execute(text(
                    "UPDATE ungate_templates SET body = REPLACE(body, 'Seller ID: {SELLER_ID}', 'Store: {SELLER_NAME}')"
                    " WHERE body LIKE '%{SELLER_ID}%'"
                ))
                _conn.execute(text(
                    "UPDATE ungate_templates SET body = REPLACE(body, 'Amazon Seller Account: {SELLER_ID}', 'Amazon Store: {SELLER_NAME}')"
                    " WHERE body LIKE '%{SELLER_ID}%'"
                ))
                _conn.execute(text(
                    "UPDATE ungate_templates SET body = REPLACE(body, '(Seller ID: {SELLER_ID})', '({SELLER_NAME})')"
                    " WHERE body LIKE '%{SELLER_ID}%'"
                ))
                # Catch any remaining {SELLER_ID} references
                _conn.execute(text(
                    "UPDATE ungate_templates SET body = REPLACE(body, '{SELLER_ID}', '{SELLER_NAME}')"
                    " WHERE body LIKE '%{SELLER_ID}%'"
                ))
                _conn.execute(text(
                    "UPDATE ungate_templates SET subject = REPLACE(subject, '{SELLER_ID}', '{SELLER_NAME}')"
                    " WHERE subject LIKE '%{SELLER_ID}%'"
                ))
                _conn.commit()
    except Exception:
        pass
    # ── Add ship_from_json to amazon_credentials ─────────────────────────────
    try:
        if "amazon_credentials" in _inspector.get_table_names():
            _ac2_cols = [c["name"] for c in _inspector.get_columns("amazon_credentials")]
            if "ship_from_json" not in _ac2_cols:
                with engine.connect() as _conn:
                    _conn.execute(text("ALTER TABLE amazon_credentials ADD COLUMN ship_from_json TEXT"))
                    _conn.commit()
    except Exception:
        pass
    # ── Add dashboard_sections, page_permissions, email_verified to users ───────
    try:
        if "users" in _inspector.get_table_names():
            _u_cols = [c["name"] for c in _inspector.get_columns("users")]
            with engine.connect() as _conn:
                if "dashboard_sections" not in _u_cols:
                    _conn.execute(text("ALTER TABLE users ADD COLUMN dashboard_sections TEXT"))
                if "page_permissions" not in _u_cols:
                    _conn.execute(text("ALTER TABLE users ADD COLUMN page_permissions TEXT"))
                if "email_verified" not in _u_cols:
                    _conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE"))
                _conn.commit()
    except Exception:
        pass
    # ── Create password_reset_tokens and email_verification_tokens if absent ──
    try:
        _tnames = _inspector.get_table_names()
        with engine.connect() as _conn:
            if "password_reset_tokens" not in _tnames:
                _conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS password_reset_tokens (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        token VARCHAR NOT NULL UNIQUE,
                        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                        used BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
            if "email_verification_tokens" not in _tnames:
                _conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS email_verification_tokens (
                        id SERIAL PRIMARY KEY,
                        user_id INTEGER NOT NULL REFERENCES users(id),
                        token VARCHAR NOT NULL UNIQUE,
                        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                        used BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                    )
                """))
            _conn.commit()
    except Exception:
        pass
    # ── Apply STORE_NAME env var to "Default" tenant on startup ─────────────
    try:
        _store_env = os.getenv("STORE_NAME", "").strip()
        if _store_env:
            with engine.connect() as _conn:
                _conn.execute(text(
                    "UPDATE tenants SET name = :name WHERE LOWER(name) = 'default'"
                ), {"name": _store_env})
                _conn.commit()
    except Exception:
        pass
    # ── Add seller_sku + aria live-push columns to products ──────────────────
    # Each column in its own connection+commit so one failure doesn't block others.
    # Use TIMESTAMP WITH TIME ZONE (PostgreSQL) not DATETIME (SQLite-only).
    try:
        _p2_cols = [c["name"] for c in _inspector.get_columns("products")]
        for _col, _ddl in [
            ("seller_sku",           "VARCHAR"),
            ("aria_live_price",      "DOUBLE PRECISION"),
            ("aria_live_pushed_at",  "TIMESTAMP WITH TIME ZONE"),
            ("buy_box_winner",       "BOOLEAN"),
            ("buy_box_checked_at",   "TIMESTAMP WITH TIME ZONE"),
        ]:
            if _col not in _p2_cols:
                try:
                    with engine.connect() as _conn:
                        _conn.execute(text(f"ALTER TABLE products ADD COLUMN {_col} {_ddl}"))
                        _conn.commit()
                except Exception as _col_err:
                    print(f"[migration] products.{_col}: {_col_err}", flush=True)
    except Exception:
        pass
    # ── Backfill seller_sku from order_number for legacy products ─────────────
    # order_number previously stored the Amazon seller SKU from inventory sync.
    # Copy it to seller_sku so Aria can push prices immediately.
    try:
        with engine.connect() as _conn:
            _conn.execute(text(
                "UPDATE products SET seller_sku = order_number "
                "WHERE seller_sku IS NULL AND order_number IS NOT NULL "
                "AND order_number != ''"
            ))
            _conn.commit()
    except Exception:
        pass
    # repricer_logs is created by models.Base.metadata.create_all above (dialect-safe)
except Exception:
    pass

# Create default admin + tenant on startup if none exist
try:
    _startup_db = next(get_db())
    try:
        ensure_bootstrap_admin(_startup_db)
    finally:
        _startup_db.close()
except Exception as _e:
    print(f"Warning: bootstrap admin setup failed ({_e}), continuing anyway.")

app = FastAPI(title="SellerPulse API", version="2.0.0")
if _limiter_enabled:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_ALLOWED_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS",
    "https://sellers-pulse.com,https://www.sellers-pulse.com",
).split(",") if o.strip()]
# Always allow localhost in dev so the local Vite dev server works
if os.getenv("RAILWAY_ENVIRONMENT") != "production":
    _ALLOWED_ORIGINS += ["http://localhost:5173", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


class SubscriptionEnforcementMiddleware(BaseHTTPMiddleware):
    """Block API requests for tenants with expired/canceled subscriptions."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Only enforce on /api/ routes, but skip auth/billing/health
        if not path.startswith("/api/"):
            return await call_next(request)
        if (
            path.startswith("/api/auth/")
            or path.startswith("/api/billing/")
            or path.startswith("/api/health")
        ):
            return await call_next(request)

        # Skip if Stripe not configured (self-hosted / unlimited access)
        if not stripe_billing.billing_enabled():
            return await call_next(request)

        # Decode JWT — skip enforcement if no/invalid token (auth layer will reject)
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return await call_next(request)
        token = auth_header[7:]
        try:
            from jose import jwt as _jwt, JWTError as _JWTError
            from auth import SECRET_KEY as _SK, ALGORITHM as _ALG
            payload = _jwt.decode(token, _SK, algorithms=[_ALG])
        except Exception:
            return await call_next(request)

        # Skip superadmin
        _superadmin = os.getenv("SUPERADMIN_USERNAME", os.getenv("CRM_USERNAME", "admin"))
        if payload.get("sub") == _superadmin:
            return await call_next(request)

        # Look up tenant subscription status
        tenant_id = payload.get("tenant_id")
        if not tenant_id:
            return await call_next(request)

        from database import SessionLocal as _SL
        _db = _SL()
        try:
            tenant = _db.query(models.Tenant).filter_by(id=tenant_id).first()
        finally:
            _db.close()

        if tenant is None:
            return await call_next(request)

        # Beta tenants have permanent access — no billing/trial checks ever
        if getattr(tenant, 'is_beta', False):
            return await call_next(request)

        stripe_status = tenant.stripe_status

        # Legacy/self-hosted tenants with no stripe_status — always allow
        if stripe_status is None:
            return await call_next(request)

        # Trialing but trial expired
        if stripe_status == "trialing" and tenant.trial_ends_at:
            if datetime.now(timezone.utc) > tenant.trial_ends_at:
                return StarletteJSONResponse(
                    status_code=402,
                    content={"detail": "Your free trial has ended. Please upgrade to continue."},
                )

        # Canceled / past_due / expired
        if stripe_status in ("canceled", "past_due", "expired"):
            return StarletteJSONResponse(
                status_code=402,
                content={"detail": "Your subscription is inactive. Please update your billing to continue."},
            )

        return await call_next(request)


app.add_middleware(SubscriptionEnforcementMiddleware)


# ─── Global rate limit middleware ─────────────────────────────────────────────

class _RateLimiter:
    """
    Sliding-window rate limiter.
    Uses Redis (fixed-window via INCR+EXPIRE) when REDIS_URL is set;
    falls back to in-memory sliding window for single-replica deployments.
    Limits: 300 req/min per IP by default; tighter for expensive paths.
    """
    RULES: list[tuple[str, int]] = [
        ("/api/repricer/aria/run-all",       5),
        ("/api/repricer/aria/run/",         20),
        ("/api/keepa/bulk-refresh",          5),
        ("/api/keepa/batch",                10),
        ("/api/keepa/amazon-search",        10),
        ("/api/amazon/inventory/sync-now",  10),
        ("/api/",                          300),
    ]

    def __init__(self):
        self._redis = None
        self._redis_checked = False
        # in-memory fallback
        self._windows: dict[str, list[float]] = {}
        self._lock = __import__("threading").Lock()

    def _get_redis(self):
        if self._redis_checked:
            return self._redis
        self._redis_checked = True
        url = os.getenv("REDIS_URL", "").strip()
        if not url:
            return None
        try:
            import redis as _redis
            r = _redis.from_url(url, socket_connect_timeout=2, socket_timeout=1, decode_responses=True)
            r.ping()
            self._redis = r
            log.info("Rate limiter: using Redis at %s", url.split("@")[-1])
        except Exception as e:
            log.warning("Rate limiter: Redis unavailable (%s) — using in-memory fallback", e)
        return self._redis

    def _limit_for(self, path: str) -> int:
        for prefix, lim in self.RULES:
            if path.startswith(prefix):
                return lim
        return 300

    def is_allowed(self, ip: str, path: str) -> bool:
        import time
        limit = self._limit_for(path)
        key = f"rl:{ip}:{path.split('?')[0][:60]}"

        r = self._get_redis()
        if r is not None:
            try:
                pipe = r.pipeline()
                pipe.incr(key)
                pipe.expire(key, 60)
                count, _ = pipe.execute()
                return count <= limit
            except Exception as e:
                log.warning("Redis rate-limit error — falling back to in-memory: %s", e)

        # In-memory fallback
        now = time.monotonic()
        cutoff = now - 60.0
        with self._lock:
            timestamps = [t for t in self._windows.get(key, []) if t > cutoff]
            if len(timestamps) >= limit:
                self._windows[key] = timestamps
                return False
            timestamps.append(now)
            self._windows[key] = timestamps
            if len(self._windows) > 50_000:
                self._windows = {k: v for k, v in self._windows.items() if any(t > cutoff for t in v)}
        return True


_rate_limiter = _RateLimiter()


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        # Skip health check from rate limiting
        if path == "/api/health":
            return await call_next(request)

        # Use the LAST IP in X-Forwarded-For — Railway's load balancer appends the real client IP last.
        # Taking the first value allows header spoofing to bypass rate limits.
        _xff = request.headers.get("X-Forwarded-For", "")
        ip = (_xff.split(",")[-1].strip() if _xff else None) or (request.client.host if request.client else "unknown")
        if not _rate_limiter.is_allowed(ip, path):
            return StarletteJSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please slow down."},
            )
        return await call_next(request)


app.add_middleware(GlobalRateLimitMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)


# ─── Request timing + DB statement timeout middleware ─────────────────────────
# Sets PostgreSQL statement_timeout per-request (safe: doesn't affect migrations
# or background jobs). Also logs slow requests for performance monitoring.

_SLOW_REQUEST_MS = int(os.getenv("SLOW_REQUEST_MS", "3000"))
_DB_TIMEOUT_MS   = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000"))

@app.middleware("http")
async def _request_timing(request: Request, call_next):
    import time
    start = time.monotonic()
    response = await call_next(request)
    ms = int((time.monotonic() - start) * 1000)
    response.headers["X-Response-Time"] = f"{ms}ms"
    if ms > _SLOW_REQUEST_MS and not request.url.path.startswith("/assets/"):
        log.warning("slow_request path=%s method=%s ms=%d status=%d",
                    request.url.path, request.method, ms, response.status_code)
    return response


@app.middleware("http")
async def _db_timeout(request: Request, call_next):
    """Set PostgreSQL statement_timeout for each request so runaway queries
    can't hold a connection indefinitely. Skipped for SQLite (dev)."""
    from database import engine as _engine, is_sqlite as _is_sqlite
    if _is_sqlite or not request.url.path.startswith("/api/"):
        return await call_next(request)
    # Inject timeout into the DB session if one is opened for this request
    request.state.db_timeout_ms = _DB_TIMEOUT_MS
    return await call_next(request)


# ─── Cache-Control headers middleware ─────────────────────────────────────────

@app.middleware("http")
async def _cache_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path

    if path.startswith("/api/"):
        # API responses must never be cached by proxies
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"]        = "no-cache"
    elif path.startswith("/assets/") or path.endswith((".js", ".css", ".woff2", ".woff", ".ttf")):
        # Vite hashes all asset filenames — safe to cache for 1 year
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path in ("/", "/index.html") or not "." in path.split("/")[-1]:
        # HTML entry point must never be cached so new deploys propagate instantly
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    else:
        # Images and other static files — cache for 7 days
        response.headers["Cache-Control"] = "public, max-age=604800"

    return response


# ─── Security headers middleware ──────────────────────────────────────────────

@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"]  = "nosniff"
    response.headers["X-Frame-Options"]          = "DENY"
    response.headers["X-XSS-Protection"]         = "1; mode=block"
    response.headers["Referrer-Policy"]           = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]        = "camera=(), microphone=(), geolocation=()"
    # HSTS — tells browsers to always use HTTPS (1 year)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # CSP — restrict resource loading; unsafe-inline needed for Vite-injected styles
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https://api.stripe.com https://*.sentry.io; "
        "frame-src https://js.stripe.com https://hooks.stripe.com;"
    )
    return response


# ─── Sentry request context middleware ────────────────────────────────────────

@app.middleware("http")
async def _sentry_context(request: Request, call_next):
    """Tag Sentry errors with tenant_id and username from JWT."""
    try:
        import sentry_sdk as _sentry
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            from auth import require_auth as _ra
            import jose.jwt as _jwt
            payload = _jwt.decode(
                auth[7:],
                os.getenv("SECRET_KEY", "changeme"),
                algorithms=["HS256"],
            )
            with _sentry.configure_scope() as scope:
                scope.set_user({"username": payload.get("sub")})
                scope.set_tag("tenant_id", str(payload.get("tenant_id", "")))
    except Exception:
        pass
    return await call_next(request)


# ─── Audit log helper ────────────────────────────────────────────────────────

def _audit(db, action: str, *, request: Request = None, current: dict = None,
           target: str = None, detail: str = None):
    """Write one immutable audit log row. Never raises — errors are logged only."""
    try:
        ip = None
        if request:
            ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (
                request.client.host if request.client else None
            )
        tenant_id = current.get("tenant_id") if current else None
        username  = current.get("sub")       if current else None
        db.add(models.AuditLog(
            tenant_id=tenant_id,
            username=username,
            action=action,
            target=target,
            detail=detail,
            ip=ip,
        ))
        db.commit()
    except Exception as _e:
        log.warning("Audit log write failed: %s", _e)


def _ensure_products_table():
    """Create the products table on both primary and read-replica engines."""
    from database import engine as _engine, is_sqlite as _is_sqlite
    import database as _db_module
    _rengine = getattr(_db_module, '_read_engine', _engine)
    if _is_sqlite:
        return
    _DDL = """
        CREATE TABLE IF NOT EXISTS public.products (
            id SERIAL PRIMARY KEY, tenant_id INTEGER, created_by VARCHAR,
            asin VARCHAR, product_name VARCHAR, amazon_url VARCHAR,
            purchase_link VARCHAR, date_found TIMESTAMPTZ, va_finder VARCHAR,
            date_purchased TIMESTAMPTZ, order_number VARCHAR,
            quantity FLOAT DEFAULT 0, buy_cost FLOAT DEFAULT 0,
            money_spent FLOAT DEFAULT 0, arrived_at_prep TIMESTAMPTZ,
            date_sent_to_amazon TIMESTAMPTZ, amazon_tracking_number VARCHAR,
            ungated BOOLEAN DEFAULT FALSE, ungating_quantity FLOAT DEFAULT 0,
            total_bought FLOAT DEFAULT 0, replenish BOOLEAN DEFAULT FALSE,
            amazon_fee FLOAT DEFAULT 0, total_cost FLOAT DEFAULT 0,
            buy_box FLOAT DEFAULT 0, profit FLOAT DEFAULT 0,
            profit_margin FLOAT DEFAULT 0, roi FLOAT DEFAULT 0,
            estimated_sales FLOAT DEFAULT 0, num_sellers INTEGER DEFAULT 0,
            notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ,
            keepa_bsr INTEGER, keepa_category VARCHAR, keepa_last_synced TIMESTAMPTZ,
            price_90_high FLOAT, price_90_low FLOAT, price_90_median FLOAT,
            fba_low FLOAT, fba_high FLOAT, fba_median FLOAT,
            fbm_low FLOAT, fbm_high FLOAT, fbm_median FLOAT,
            status VARCHAR DEFAULT 'sourcing', seller_sku VARCHAR,
            aria_suggested_price FLOAT, aria_suggested_at TIMESTAMPTZ,
            aria_reasoning TEXT, aria_last_buy_box FLOAT, aria_strategy_id INTEGER,
            aria_live_price FLOAT, aria_live_pushed_at TIMESTAMPTZ,
            buy_box_winner BOOLEAN, buy_box_checked_at TIMESTAMPTZ,
            fulfillment_channel VARCHAR
        )
    """
    seen_ids = set()
    for _label, _eng in [("primary", _engine), ("replica", _rengine)]:
        if id(_eng) in seen_ids:
            continue
        seen_ids.add(id(_eng))
        try:
            with _eng.begin() as _c:
                _c.execute(text("SET search_path = public"))
                _c.execute(text(_DDL))
            log.info("products table ensured on %s", _label)
        except Exception as _e:
            log.warning("products table ensure failed on %s: %s", _label, _e)
        # Diagnostic
        try:
            with _eng.connect() as _dc:
                sp = _dc.execute(text("SHOW search_path")).scalar()
                rows = _dc.execute(text(
                    "SELECT table_schema FROM information_schema.tables WHERE table_name='products'"
                )).fetchall()
                log.info("[%s] search_path=%s  products schema(s)=%s", _label, sp, [r[0] for r in rows])
        except Exception as _de:
            log.warning("[%s] products diagnostic failed: %s", _label, _de)


@app.on_event("startup")
def startup():
    _check_production_config()
    # Migrations run in prestart.py before workers spawn — skip here to avoid races.
    # Fall back to running them if somehow prestart was not executed (local dev).
    if not os.getenv("PRESTART_DONE"):
        _run_alembic_migrations()
    # Always ensure products table exists regardless of migration outcome
    _ensure_products_table()
    if os.getenv("DISABLE_SCHEDULER", "").lower() in ("1", "true", "yes"):
        log.info("Scheduler disabled (DISABLE_SCHEDULER=true) — web-only mode")
    else:
        # IMPORTANT: APScheduler runs inside this process. If Railway scales to
        # multiple replicas, every replica will run the scheduler and trigger
        # duplicate Amazon syncs and Aria repricer runs. Set DISABLE_SCHEDULER=true
        # on all but one replica, or run the scheduler as a separate Railway service.
        num_replicas = int(os.getenv("RAILWAY_NUM_REPLICAS", "1"))
        replica_id   = os.getenv("RAILWAY_REPLICA_ID", "")
        if num_replicas > 1 and replica_id:
            # Only the lexicographically first replica ID runs the scheduler
            all_replica_ids = sorted(os.getenv("RAILWAY_REPLICA_IDS", replica_id).split(","))
            if replica_id != all_replica_ids[0]:
                log.info("Scheduler suppressed on replica %s — only primary replica runs it", replica_id)
                return
        start_scheduler()


def _check_production_config():
    """Warn loudly on startup if critical env vars are still at their insecure defaults."""
    is_prod = os.getenv("RAILWAY_ENVIRONMENT") == "production"
    warnings = []

    sk = os.getenv("SECRET_KEY", "")
    if not sk or sk in ("dev-secret-change-in-production", "changeme", "secret", "sellerpulse-oauth-secret"):
        warnings.append("SECRET_KEY is not set or is using an insecure default — all JWTs are forgeable")

    if os.getenv("CRM_PASSWORD", "changeme") == "changeme":
        warnings.append("CRM_PASSWORD is still 'changeme' — change the admin password immediately")

    if not os.getenv("STRIPE_SECRET_KEY", ""):
        warnings.append("STRIPE_SECRET_KEY not set — billing is disabled")
    elif os.getenv("STRIPE_SECRET_KEY", "").startswith("sk_test_") and is_prod:
        warnings.append("STRIPE_SECRET_KEY is a test key in production — use sk_live_...")

    for w in warnings:
        log.warning("CONFIG WARNING: %s", w)


def _run_alembic_migrations():
    db_url = os.getenv("DATABASE_URL", "sqlite:///./crm.db").replace("postgres://", "postgresql://", 1)
    try:
        from alembic.config import Config
        from alembic import command
        from alembic.runtime.migration import MigrationContext
        from sqlalchemy import create_engine as _ce

        cfg = Config()
        cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "alembic"))
        cfg.set_main_option("sqlalchemy.url", db_url)

        # Detect broken chain: if alembic_version has a stale revision that
        # doesn't match any migration file, stamp it to the closest valid head
        # so that subsequent migrations can run.
        try:
            _eng = _ce(db_url)
            with _eng.connect() as _conn:
                ctx = MigrationContext.configure(_conn)
                current = ctx.get_current_heads()
                if current and '0001_safe_new_tables' not in current and '0001' in current:
                    log.warning("Fixing broken Alembic chain: stamping 0001_safe_new_tables")
                    command.stamp(cfg, "0001_safe_new_tables")
            _eng.dispose()
        except Exception as _stamp_err:
            log.warning("Alembic chain check skipped: %s", _stamp_err)

        command.upgrade(cfg, "head")
        log.info("Alembic migrations applied")
    except Exception as e:
        log.warning("Alembic migration skipped: %s", e)

    # Emergency safety net: apply critical columns directly if migrations
    # failed for any reason, so the app stays functional.
    try:
        from sqlalchemy import create_engine as _ce, text as _text
        _eng = _ce(db_url)
        with _eng.begin() as _conn:
            # users — auth-critical columns
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0"))
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ"))
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ"))
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT true"))
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false"))
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS dashboard_sections TEXT"))
            _conn.execute(_text("ALTER TABLE users ADD COLUMN IF NOT EXISTS page_permissions TEXT"))
            # tenants — auth + subscription-critical columns
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_beta BOOLEAN DEFAULT false"))
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_price_id TEXT"))
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_status TEXT"))
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ"))
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT"))
            _conn.execute(_text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT"))
            # accounts — pipeline columns used on every list view
            _conn.execute(_text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pipeline_stage VARCHAR DEFAULT 'new'"))
            _conn.execute(_text("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMPTZ"))
        _eng.dispose()
        log.info("Emergency column safety-net applied")
    except Exception as _e:
        log.warning("Emergency column safety-net skipped: %s", _e)


@app.on_event("shutdown")
def shutdown():
    stop_scheduler()


# ─── Auth ─────────────────────────────────────────────────────────────────────

_MAX_FAILED_LOGINS = 10       # lock after this many consecutive failures
_LOCKOUT_MINUTES   = 30       # locked for this long

@app.post("/api/auth/login")
@limiter.limit("10/minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    from datetime import timezone as _tz
    user = db.query(models.User).filter(models.User.username == data.username).first()
    if not user:
        user = db.query(models.User).filter(models.User.email == data.username).first()

    # Check lockout before verifying password to avoid timing oracle
    if user and user.locked_until:
        if datetime.now(_tz.utc) < user.locked_until:
            remaining = int((user.locked_until - datetime.now(_tz.utc)).total_seconds() // 60) + 1
            raise HTTPException(status_code=429, detail=f"Account locked due to too many failed attempts. Try again in {remaining} minute(s).")
        else:
            # Lock expired — reset counter
            user.failed_login_count = 0
            user.locked_until = None

    if not user or not verify_password(data.password, user.password_hash):
        if user:
            try:
                user.failed_login_count = (user.failed_login_count or 0) + 1
                if user.failed_login_count >= _MAX_FAILED_LOGINS:
                    user.locked_until = datetime.now(_tz.utc) + timedelta(minutes=_LOCKOUT_MINUTES)
                    _audit(db, "auth.lockout", request=request,
                           current={"sub": user.username, "tenant_id": user.tenant_id},
                           detail=f"locked for {_LOCKOUT_MINUTES}min after {user.failed_login_count} failures")
                db.commit()
            except Exception:
                db.rollback()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")

    # Block unverified emails — only if the user has an email set and verification
    # is enabled (REQUIRE_EMAIL_VERIFICATION=true). Admin-created users with no email
    # are always allowed through.
    if (
        os.getenv("REQUIRE_EMAIL_VERIFICATION", "").lower() in ("1", "true", "yes")
        and user.email
        and not getattr(user, "email_verified", True)
    ):
        raise HTTPException(
            status_code=403,
            detail="Please verify your email address before logging in. Check your inbox for the verification link.",
        )

    # Successful login — reset failure counter (guarded in case migration is pending)
    try:
        user.failed_login_count = 0
        user.locked_until       = None
        user.last_login_at      = datetime.now(_tz.utc)
        db.commit()
    except Exception:
        db.rollback()

    tenant_id = user.tenant_id or 1
    _audit(db, "auth.login", request=request,
           current={"sub": user.username, "tenant_id": tenant_id},
           detail=f"role={user.role}")
    return {"access_token": create_token(user.username, user.role, tenant_id), "token_type": "bearer"}


@app.post("/api/auth/logout", status_code=200)
def logout(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    current: dict = Depends(require_auth),
):
    """Revoke the current JWT so it cannot be reused even before it expires."""
    import time as _time
    token = credentials.credentials
    exp   = current.get("exp", int(_time.time()) + TOKEN_EXPIRE_HOURS * 3600)
    revoke_token(token, exp)
    return {"ok": True}


@app.post("/api/auth/refresh")
def refresh_token(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    current: dict = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Issue a new JWT with fresh 7-day expiry. Client should call when token < 24 h from expiry."""
    user = db.query(models.User).filter_by(
        username=current["sub"],
        tenant_id=current.get("tenant_id"),
    ).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return {"access_token": create_token(user.username, user.role, user.tenant_id), "token_type": "bearer"}


@app.post("/api/auth/register")
@limiter.limit("5/minute")
def register(request: Request, data: RegisterRequest, db: Session = Depends(get_db)):
    """Create a new tenant workspace + admin user. Returns a JWT."""
    # Validate slug uniqueness
    slug = data.slug.lower().strip().replace(" ", "-")
    if db.query(models.Tenant).filter_by(slug=slug).first():
        raise HTTPException(400, "Workspace URL is already taken")
    if db.query(models.User).filter_by(username=data.username).first():
        raise HTTPException(400, "Username already exists")

    # Create tenant
    tenant = models.Tenant(
        name=data.company_name,
        slug=slug,
        plan="enterprise",
        stripe_status="trialing",
        trial_ends_at=datetime.now(timezone.utc) + timedelta(days=14),
        is_active=True,
    )
    db.add(tenant)
    db.flush()

    # Create admin user
    import secrets as _secrets
    user = models.User(
        tenant_id=tenant.id,
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        role="admin",
        is_active=True,
        email_verified=not bool(data.email),  # no email → skip verification
    )
    db.add(user)
    db.flush()

    # Send verification email if email provided
    if data.email and _smtp_configured():
        _ver_token = _secrets.token_urlsafe(32)
        _ver_expires = datetime.now(timezone.utc) + timedelta(hours=48)
        db.add(models.EmailVerificationToken(
            user_id=user.id, token=_ver_token, expires_at=_ver_expires
        ))
        _app_url = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")
        _ver_url = f"{_app_url}/verify-email?token={_ver_token}"
        _html = f"""
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
          <h2 style="color:#ea580c">Welcome to SellerPulse!</h2>
          <p>Hi {user.username}, please verify your email to activate your account.</p>
          <a href="{_ver_url}" style="display:inline-block;background:#ea580c;color:white;
             padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Verify Email
          </a>
          <p style="color:#999;font-size:11px">Link expires in 48 hours.</p>
        </div>"""
        _send_email_bg(data.email, "Verify your SellerPulse email", _html)

    db.commit()

    token = create_token(user.username, user.role, tenant.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        "tenant_id": tenant.id,
        "slug": slug,
        "needs_amazon_connect": True,
        "email_verification_sent": bool(data.email and _smtp_configured()),
    }


@app.get("/api/auth/me")
def me(payload: dict = Depends(require_auth), db: Session = Depends(get_db)):
    tenant_id = payload.get("tenant_id", 1)
    tenant    = db.query(models.Tenant).filter_by(id=tenant_id).first()
    # Priority: Amazon store_name → tenant.name (if not the generic "Default") → STORE_NAME env var → app name
    cred      = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first() if tenant_id else None
    _tenant_name = (tenant.name if tenant and tenant.name.strip().lower() not in ("default", "") else None)
    display_name = (cred.store_name if cred and cred.store_name else None) \
                or _tenant_name \
                or os.getenv("STORE_NAME", "").strip() \
                or "SellerPulse"
    db_user   = db.query(models.User).filter(models.User.username == payload["sub"]).first()
    # Read SUPERADMIN_USERNAME fresh every request — never use cached JWT value
    import os as _os
    _superadmin = _os.getenv("SUPERADMIN_USERNAME", _os.getenv("CRM_USERNAME", "admin"))
    return {
        "username":      payload["sub"],
        "role":          payload["role"],
        "is_superadmin": payload["sub"] == _superadmin,
        "tenant_id":     tenant_id,
        "tenant_name":   display_name,
        "store_name":    cred.store_name if cred and cred.store_name else None,
        "tenant_slug":   tenant.slug if tenant else "default",
        "plan":          tenant.plan if tenant else "starter",
        "stripe_status": tenant.stripe_status if tenant else None,
        "trial_ends_at": tenant.trial_ends_at.isoformat() if tenant and tenant.trial_ends_at else None,
        "email":               db_user.email if db_user else None,
        "notify_email":        db_user.notify_email if db_user else True,
        "dashboard_sections":  db_user.dashboard_sections if db_user else None,
        "page_permissions":    db_user.page_permissions if db_user else None,
    }


class ProfileUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    notify_email: Optional[bool] = None
    current_password: Optional[str] = None
    new_password: Optional[str] = None


# ── Password reset ─────────────────────────────────────────────────────────────

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

@app.post("/api/auth/forgot-password", status_code=200)
@limiter.limit("5/minute")
def forgot_password(request: Request, data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    import secrets
    from datetime import timezone as _tz
    from notifications import send_email, _smtp_configured

    user = db.query(models.User).filter(
        func.lower(models.User.email) == data.email.lower().strip()
    ).first()
    # Always return 200 to avoid email enumeration
    if not user or not user.email:
        return {"ok": True}

    # Expire old tokens for this user
    db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.user_id == user.id,
        models.PasswordResetToken.used == False,
    ).update({"used": True})
    db.commit()

    token = secrets.token_urlsafe(32)
    expires = datetime.now(_tz.utc) + timedelta(hours=2)
    db.add(models.PasswordResetToken(user_id=user.id, token=token, expires_at=expires))
    db.commit()

    app_url = os.getenv("APP_URL", "http://localhost:5173").rstrip("/")
    reset_url = f"{app_url}/reset-password?token={token}"

    if _smtp_configured():
        html = f"""
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#ea580c">SellerPulse — Reset Your Password</h2>
          <p>Click the button below to reset your password. This link expires in 2 hours.</p>
          <a href="{reset_url}" style="display:inline-block;background:#ea580c;color:white;
             padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
            Reset Password
          </a>
          <p style="color:#666;font-size:12px">If you didn't request this, ignore this email.</p>
          <p style="color:#999;font-size:11px">Link: {reset_url}</p>
        </div>"""
        _send_email_bg(user.email, "Reset your SellerPulse password", html)

    return {"ok": True}


@app.post("/api/auth/reset-password", status_code=200)
@limiter.limit("10/minute")
def reset_password(request: Request, data: ResetPasswordRequest, db: Session = Depends(get_db)):
    from datetime import timezone as _tz
    from auth import hash_password

    row = db.query(models.PasswordResetToken).filter(
        models.PasswordResetToken.token == data.token,
        models.PasswordResetToken.used == False,
    ).first()

    if not row:
        raise HTTPException(400, "Invalid or expired reset link")
    if datetime.now(_tz.utc) > row.expires_at:
        raise HTTPException(400, "Reset link has expired — please request a new one")
    if len(data.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    user = db.query(models.User).filter_by(id=row.user_id).first()
    if not user:
        raise HTTPException(400, "User not found")

    user.password_hash = hash_password(data.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    row.used = True
    db.commit()
    return {"ok": True}


@app.get("/api/auth/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    from datetime import timezone as _tz
    row = db.query(models.EmailVerificationToken).filter(
        models.EmailVerificationToken.token == token,
        models.EmailVerificationToken.used == False,
    ).first()
    if not row or datetime.now(_tz.utc) > row.expires_at:
        raise HTTPException(400, "Invalid or expired verification link")
    user = db.query(models.User).filter_by(id=row.user_id).first()
    if user:
        user.email_verified = True
    row.used = True
    db.commit()
    return {"ok": True, "message": "Email verified — you're all set!"}


@app.put("/api/auth/profile")
def update_profile(
    request: Request,
    data: ProfileUpdate,
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Let the currently logged-in user update their own username, email, or password."""
    user = db.query(models.User).filter(models.User.username == current["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    password_changed = False
    if data.new_password:
        if not data.current_password:
            raise HTTPException(status_code=400, detail="current_password is required to change password")
        if not verify_password(data.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        if len(data.new_password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
        user.password_hash = hash_password(data.new_password)
        password_changed = True

    new_username = None
    if data.username and data.username.strip() and data.username.strip() != user.username:
        new_username = data.username.strip()
        conflict = db.query(models.User).filter(
            models.User.username == new_username,
            models.User.id != user.id,
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Username already taken")
        user.username = new_username

    if data.email is not None:
        user.email = data.email.strip() or None
    if data.notify_email is not None:
        user.notify_email = data.notify_email

    db.commit()

    import time as _time
    new_token = None
    if new_username or password_changed:
        # Revoke old token and issue a fresh one
        revoke_token(credentials.credentials, current.get("exp", int(_time.time()) + TOKEN_EXPIRE_HOURS * 3600))
        new_token = create_token(user.username, user.role, user.tenant_id or 1)

    return {
        "message": "Profile updated",
        "username": user.username,
        "new_token": new_token,
    }


# ─── Debug (admin only) ───────────────────────────────────────────────────────

@app.get("/api/debug/net")
def debug_net(current: dict = Depends(require_superadmin)):
    import socket, httpx
    results = {}
    try:
        socket.create_connection(("api.sendgrid.com", 443), timeout=5)
        results["tcp_443"] = "ok"
    except Exception as e:
        results["tcp_443"] = str(e)
    key = os.getenv("SENDGRID_API_KEY", "").strip()
    key_preview = (key[:8] + "…") if len(key) > 8 else "(not set)"
    try:
        r = httpx.post(
            "https://api.sendgrid.com/v3/mail/send",
            json={"personalizations": [{"to": [{"email": "test@example.com"}]}],
                  "from": {"email": "noreply@sellerpulse.io"},
                  "subject": "test", "content": [{"type": "text/plain", "value": "test"}]},
            headers={"Authorization": f"Bearer {key}"},
            timeout=15,
        )
        results["api_post"] = r.status_code
        results["api_body"] = r.text[:300]
    except Exception as e:
        results["api_post"] = str(e)
    results["key_preview"] = key_preview
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
    from_raw = os.getenv("SMTP_FROM", "SellerPulse <noreply@sellerpulse.io>")
    if '<' in from_raw:
        name_part = from_raw[:from_raw.index('<')].strip()
        email_from = from_raw[from_raw.index('<')+1:from_raw.index('>')].strip().lower()
    else:
        name_part, email_from = "SellerPulse", from_raw.strip().lower()
    try:
        resp = _httpx.post(
            "https://api.sendgrid.com/v3/mail/send",
            json={
                "personalizations": [{"to": [{"email": user.email}]}],
                "from": {"email": email_from, "name": name_part},
                "subject": "SellerPulse - Test Email",
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


# ─── Aria AI Repricer ─────────────────────────────────────────────────────────

@app.get("/api/repricer/aria/status")
def aria_status(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    tid = current.get("tenant_id")

    base_q = db.query(models.Product)
    if tid:
        base_q = base_q.filter(models.Product.tenant_id == tid)

    # Products eligible for Aria (have both buy_box and buy_cost)
    eligible = base_q.filter(
        models.Product.status == "approved",
        models.Product.buy_box > 0,
        models.Product.buy_cost > 0,
    ).count()

    # Products with buy_cost but no buy_box yet (need Keepa sync)
    need_buy_box = base_q.filter(
        models.Product.status == "approved",
        models.Product.buy_cost > 0,
        models.Product.buy_box == None,
    ).count()
    need_buy_box += base_q.filter(
        models.Product.status == "approved",
        models.Product.buy_cost > 0,
        models.Product.buy_box == 0,
    ).count()

    # Products with buy_box but missing buy_cost (need cost data to run)
    need_cost = base_q.filter(
        models.Product.status == "approved",
        models.Product.buy_box > 0,
        models.Product.buy_cost == None,
    ).count()

    # Eligible products missing seller_sku (will reprice but NOT push to Amazon)
    no_sku = base_q.filter(
        models.Product.status == "approved",
        models.Product.buy_box > 0,
        models.Product.buy_cost > 0,
        models.Product.seller_sku == None,
    ).count()

    schedule = get_aria_schedule_info()

    return {
        "configured":     aria_repricer.aria_configured(),
        "eligible":       eligible,
        "need_buy_box":   need_buy_box,
        "need_cost":      need_cost,
        "no_sku":         no_sku,
        "interval_hours": schedule["interval_hours"],
        "next_run":       schedule["next_run"],
    }


@app.post("/api/repricer/aria/run/{product_id}", response_model=schemas.ProductOut)
async def aria_run_one(product_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    if not aria_repricer.aria_configured():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")
    tid = current.get("tenant_id")
    product = db.query(models.Product).filter(
        models.Product.id == product_id,
        models.Product.tenant_id == tid,
    ).first()
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.buy_box:
        raise HTTPException(400, "Product needs a Buy Box price to reprice")
    strategy = aria_repricer._get_strategy(db, tenant_id=tid)
    result = await aria_repricer.price_product(product, strategy)
    product.aria_suggested_price = result["price"]
    product.aria_suggested_at    = datetime.utcnow()
    product.aria_reasoning       = result["reasoning"]
    product.aria_last_buy_box    = product.buy_box
    db.commit()
    db.refresh(product)
    return product


@app.post("/api/repricer/aria/run-all")
async def aria_run_all(force: bool = False, db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    if not aria_repricer.aria_configured():
        raise HTTPException(503, "ANTHROPIC_API_KEY is not configured")
    try:
        result = await aria_repricer.run_all_async(force=force, tenant_id=current.get("tenant_id"))
        return result
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[aria/run-all] UNHANDLED EXCEPTION: {e}\n{tb}", flush=True)
        raise HTTPException(500, detail=f"Aria run failed: {str(e)}")


# ─── Waitlist ─────────────────────────────────────────────────────────────────

class _WaitlistIn(BaseModel):
    email:       str
    name:        Optional[str] = None
    company:     Optional[str] = None
    monthly_gmv: Optional[str] = None
    source:      Optional[str] = None
    notes:       Optional[str] = None

@app.post("/api/waitlist", status_code=201)
@limiter.limit("5/minute")
def join_waitlist(request: Request, data: _WaitlistIn, db: Session = Depends(get_db)):
    """Public endpoint — no auth required. Captures waitlist signups."""
    email = (data.email or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "Valid email required")
    existing = db.query(models.WaitlistEntry).filter_by(email=email).first()
    if existing:
        return {"ok": True, "message": "You're already on the list!"}
    entry = models.WaitlistEntry(
        email=email,
        name=(data.name or "").strip() or None,
        company=(data.company or "").strip() or None,
        monthly_gmv=data.monthly_gmv,
        source=data.source,
        notes=(data.notes or "").strip() or None,
    )
    db.add(entry)
    db.commit()
    log.info("Waitlist signup: %s", email)
    return {"ok": True, "message": "You're on the list! We'll be in touch soon."}


@app.get("/api/admin/waitlist")
def get_waitlist(
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Superadmin only — returns all waitlist entries newest-first."""
    entries = db.query(models.WaitlistEntry).order_by(models.WaitlistEntry.created_at.desc()).all()
    return [
        {
            "id":          e.id,
            "email":       e.email,
            "name":        e.name,
            "company":     e.company,
            "monthly_gmv": e.monthly_gmv,
            "source":      e.source,
            "notes":       e.notes,
            "created_at":  e.created_at.isoformat() if e.created_at else None,
        }
        for e in entries
    ]


@app.get("/api/admin/waitlist/export.csv")
def export_waitlist_csv(
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Download all waitlist entries as CSV."""
    import csv, io as _io
    from fastapi.responses import StreamingResponse
    entries = db.query(models.WaitlistEntry).order_by(models.WaitlistEntry.created_at.asc()).all()
    buf = _io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "email", "name", "company", "monthly_gmv", "source", "notes", "created_at"])
    for e in entries:
        writer.writerow([e.id, e.email, e.name or "", e.company or "", e.monthly_gmv or "",
                         e.source or "", e.notes or "", e.created_at])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=waitlist.csv"},
    )


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    """Health check — tests DB and Redis. Returns 503 if either is down."""
    issues = []

    # DB check
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        issues.append(f"db: {e}")

    # Redis check (optional — only fail if REDIS_URL is set)
    redis_status = "not_configured"
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            import redis as _redis
            r = _redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2)
            r.ping()
            redis_status = "ok"
        except Exception as e:
            issues.append(f"redis: {e}")
            redis_status = "error"

    if issues:
        raise HTTPException(status_code=503, detail={"status": "degraded", "issues": issues})

    return {"status": "ok", "db": "ok", "redis": redis_status}


@app.get("/api/repricer/logs")
def list_repricer_logs(
    product_id: int = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Return Aria price-change history for the current tenant."""
    tid = current.get("tenant_id")
    try:
        q = db.query(models.RepricerLog)
        if tid:
            q = q.filter(models.RepricerLog.tenant_id == tid)
        if product_id is not None:
            q = q.filter(models.RepricerLog.product_id == product_id)
        rows = q.order_by(models.RepricerLog.created_at.desc()).limit(min(limit, 500)).all()
    except Exception:
        return []  # table may not exist yet on first deploy
    return [
        {
            "id":            r.id,
            "product_id":    r.product_id,
            "asin":          r.asin,
            "seller_sku":    r.seller_sku,
            "product_name":  r.product_name,
            "old_price":     r.old_price,
            "new_price":     r.new_price,
            "buy_box":       r.buy_box,
            "reasoning":     r.reasoning,
            "pushed":        r.pushed,
            "amazon_status": r.amazon_status,
            "created_at":    r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@app.get("/api/repricer/aria/diagnose")
async def aria_diagnose(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    """
    Diagnose why Aria isn't pushing prices to Amazon.
    Returns SKU coverage, credential status, and a real token-exchange test.
    """
    import httpx as _hx
    tid = current.get("tenant_id")

    # 1. SKU coverage
    total_q = db.query(models.Product).filter(
        models.Product.buy_box > 0,
        models.Product.buy_cost > 0,
    )
    if tid:
        total_q = total_q.filter(models.Product.tenant_id == tid)
    all_products = total_q.all()

    with_sku    = [p for p in all_products if p.seller_sku or p.order_number]
    without_sku = [p for p in all_products if not (p.seller_sku or p.order_number)]

    sample_skus = [
        {"id": p.id, "name": p.product_name, "seller_sku": p.seller_sku, "order_number": p.order_number}
        for p in with_sku[:5]
    ]

    # 2. Credential status
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tid).first() if tid else None
    lwa_id = (cred.lwa_client_id if cred else None) or os.getenv("AMAZON_LWA_CLIENT_ID", "")
    cred_status = {
        "cred_found":          cred is not None,
        "has_refresh_token":   bool(cred and cred.sp_refresh_token),
        "has_seller_id":       bool(cred and cred.seller_id),
        "seller_id":           cred.seller_id if cred else None,
        "has_lwa_client_id":   bool(lwa_id),
        "marketplace_id":      (cred.marketplace_id if cred else None) or "ATVPDKIKX0DER",
    }

    # 3. Token exchange test
    token_test = {"ok": False, "error": None}
    if cred and cred.sp_refresh_token and lwa_id:
        try:
            lwa_secret = (cred.lwa_client_secret if cred else None) or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
            async with _hx.AsyncClient(timeout=15) as client:
                r = await client.post("https://api.amazon.com/auth/o2/token", data={
                    "grant_type":    "refresh_token",
                    "refresh_token": cred.sp_refresh_token,
                    "client_id":     lwa_id,
                    "client_secret": lwa_secret,
                })
            if r.status_code == 200:
                token_test = {"ok": True, "error": None}
            else:
                token_test = {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:300]}"}
        except Exception as e:
            token_test = {"ok": False, "error": str(e)}
    else:
        token_test["error"] = "Missing credentials — can't test token"

    # 4. Test PATCH on first product with a SKU (dry run — use current buy_box price so nothing changes)
    patch_test = None
    if token_test["ok"] and with_sku and cred and cred.seller_id:
        sample = with_sku[0]
        sku = sample.seller_sku or sample.order_number
        try:
            async with _hx.AsyncClient(timeout=15) as client:
                tr = await client.post("https://api.amazon.com/auth/o2/token", data={
                    "grant_type":    "refresh_token",
                    "refresh_token": cred.sp_refresh_token,
                    "client_id":     lwa_id,
                    "client_secret": (cred.lwa_client_secret or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")),
                })
            token = tr.json()["access_token"]
            mkt = cred.marketplace_id or "ATVPDKIKX0DER"
            sp_base = os.getenv("AMAZON_SP_BASE", "https://sellingpartnerapi-na.amazon.com")
            body = {
                "productType": "PRODUCT",
                "patches": [{"op": "replace", "path": "/attributes/purchasable_offer",
                    "value": [{"marketplace_id": mkt, "currency": "USD",
                        "our_price": [{"schedule": [{"value_with_tax": sample.buy_box or 1.0}]}]}]}],
            }
            async with _hx.AsyncClient(timeout=15) as client:
                pr = await client.patch(
                    f"{sp_base}/listings/2021-08-01/items/{cred.seller_id}/{sku}",
                    headers={"x-amz-access-token": token, "Content-Type": "application/json"},
                    params={"marketplaceIds": mkt},
                    json=body,
                )
            patch_test = {
                "sku":    sku,
                "status": pr.status_code,
                "ok":     pr.status_code in (200, 202),
                "body":   pr.text[:500],
            }
        except Exception as e:
            patch_test = {"error": str(e)}

    return {
        "products_total":      len(all_products),
        "products_with_sku":   len(with_sku),
        "products_without_sku": len(without_sku),
        "sample_skus":         sample_skus,
        "credentials":         cred_status,
        "token_exchange_test": token_test,
        "patch_test":          patch_test,
    }


# ─── Repricer Strategies ──────────────────────────────────────────────────────

@app.get("/api/repricer/strategies", response_model=List[schemas.RepricerStrategyOut])
def list_repricer_strategies(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    tid = current.get("tenant_id")
    q = db.query(models.RepricerStrategy)
    if tid:
        q = q.filter(models.RepricerStrategy.tenant_id == tid)
    return q.order_by(models.RepricerStrategy.created_at).all()


@app.post("/api/repricer/strategies", response_model=schemas.RepricerStrategyOut, status_code=201)
def create_repricer_strategy(data: schemas.RepricerStrategyCreate, db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    tid = current.get("tenant_id")
    if data.is_default:
        # clear any existing default for this tenant only
        q = db.query(models.RepricerStrategy).filter(models.RepricerStrategy.is_default == True)
        if tid:
            q = q.filter(models.RepricerStrategy.tenant_id == tid)
        q.update({"is_default": False})
    s = models.RepricerStrategy(**data.model_dump(), tenant_id=tid)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@app.put("/api/repricer/strategies/{strategy_id}", response_model=schemas.RepricerStrategyOut)
def update_repricer_strategy(strategy_id: int, data: schemas.RepricerStrategyUpdate, db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    tid = current.get("tenant_id")
    q = db.query(models.RepricerStrategy).filter(models.RepricerStrategy.id == strategy_id)
    if tid:
        q = q.filter(models.RepricerStrategy.tenant_id == tid)
    s = q.first()
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    update = data.model_dump(exclude_unset=True)
    if update.get("is_default"):
        dq = db.query(models.RepricerStrategy).filter(
            models.RepricerStrategy.is_default == True,
            models.RepricerStrategy.id != strategy_id
        )
        if tid:
            dq = dq.filter(models.RepricerStrategy.tenant_id == tid)
        dq.update({"is_default": False})
    for k, v in update.items():
        setattr(s, k, v)
    db.commit()
    db.refresh(s)
    return s


@app.delete("/api/repricer/strategies/{strategy_id}", status_code=204)
def delete_repricer_strategy(strategy_id: int, db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    tid = current.get("tenant_id")
    q = db.query(models.RepricerStrategy).filter(models.RepricerStrategy.id == strategy_id)
    if tid:
        q = q.filter(models.RepricerStrategy.tenant_id == tid)
    s = q.first()
    if not s:
        raise HTTPException(status_code=404, detail="Strategy not found")
    db.delete(s)
    db.commit()


def _tenant_inbound_email(tenant_id: int) -> str | None:
    """Return a tenant-specific reply-to address using subaddressing.
    e.g. CRM_INBOUND_EMAIL=crm@inbound.delightshoppe.org, tenant 2
         → crm+t2@inbound.delightshoppe.org
    """
    base = os.getenv("CRM_INBOUND_EMAIL", "").strip()
    if not base or "@" not in base:
        return None
    local, domain = base.split("@", 1)
    local = local.split("+")[0]   # strip any existing subaddress
    return f"{local}+t{tenant_id}@{domain}"


@app.get("/api/notifications/status")
def notification_status(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.username == current["sub"]).first()
    inbound_email = os.getenv("CRM_INBOUND_EMAIL", "").strip()
    tid = current.get("tenant_id")
    app_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    if app_domain and not app_domain.startswith("http"):
        app_domain = f"https://{app_domain}"
    tenant_inbound = _tenant_inbound_email(tid) if tid else inbound_email or None
    return {
        "smtp_configured": _smtp_configured(),
        "smtp_host": os.getenv("SMTP_HOST", ""),
        "smtp_user": (
            (os.getenv("SENDGRID_API_KEY") and "SendGrid API") or
            (os.getenv("RESEND_API_KEY") and "Resend API") or
            os.getenv("SMTP_USER", "")
        ),
        "email_provider": (
            "sendgrid" if os.getenv("SENDGRID_API_KEY") else
            "resend"   if os.getenv("RESEND_API_KEY")   else
            "smtp"     if (os.getenv("SMTP_HOST") and os.getenv("SMTP_USER")) else
            "none"
        ),
        "notify_hour_utc": int(os.getenv("NOTIFY_HOUR", "8")),
        "admin_email": user.email if user else None,
        "inbound_configured": bool(inbound_email),
        "inbound_email": tenant_inbound,
        "inbound_webhook_url": f"{app_domain}/api/webhooks/inbound-email" if app_domain else "/api/webhooks/inbound-email",
        "followup_days": int(os.getenv("FOLLOWUP_DAYS", "4")),
    }


# ─── User Management (admin only) ─────────────────────────────────────────────

@app.get("/api/users", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    tid = current.get("tenant_id")
    q = db.query(models.User)
    # Always scope to the current tenant — superadmins manage other tenants
    # via the Platform / Seller Management section, not this page.
    if tid:
        q = q.filter(models.User.tenant_id == tid)
    return q.order_by(models.User.created_at).all()


@app.post("/api/users", response_model=schemas.UserOut, status_code=201)
def create_user(data: schemas.UserCreate, db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    tid = current.get("tenant_id")
    if tid:
        allowed, msg = stripe_billing.check_plan_limit(db, tid, "users")
        if not allowed:
            raise HTTPException(status_code=403, detail=msg)
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
        tenant_id=current.get("tenant_id"),  # inherit tenant from the creating admin
        page_permissions=data.page_permissions,
        dashboard_sections=data.dashboard_sections,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    _audit(db, "user.create", current=current,
           target=f"user:{user.id}", detail=f"username={user.username} role={user.role}")
    return user


@app.put("/api/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    data: schemas.UserUpdate,
    db: Session = Depends(get_db),
    payload: dict = Depends(require_admin),
):
    tid = payload.get("tenant_id")
    q = db.query(models.User).filter(models.User.id == user_id)
    if tid:
        q = q.filter(models.User.tenant_id == tid)
    user = q.first()
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
    # page_permissions: explicit value saves as-is; omitted (None via exclude_unset)
    # means no change. An empty string clears permissions (gives all access).
    if "page_permissions" in data.model_fields_set:
        user.page_permissions = data.page_permissions
    if "dashboard_sections" in data.model_fields_set:
        user.dashboard_sections = data.dashboard_sections
    db.commit()
    db.refresh(user)
    return user


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db), payload: dict = Depends(require_admin)):
    tid = payload.get("tenant_id")
    q = db.query(models.User).filter(models.User.id == user_id)
    if tid:
        q = q.filter(models.User.tenant_id == tid)
    user = q.first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == payload["sub"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    _audit(db, "user.delete", current=payload,
           target=f"user:{user_id}", detail=f"username={user.username}")
    db.delete(user)
    db.commit()


# ─── Tenant info ─────────────────────────────────────────────────────────────

@app.get("/api/tenant/me")
def tenant_me(current: dict = Depends(require_auth), db: Session = Depends(get_db)):
    tenant_id = current.get("tenant_id", 1)
    tenant    = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
    users_count = db.query(func.count(models.User.id)).filter_by(tenant_id=tenant_id).scalar() or 0
    return {
        "id":                   tenant.id,
        "name":                 tenant.name,
        "slug":                 tenant.slug,
        "plan":                 tenant.plan,
        "is_active":            tenant.is_active,
        "stripe_status":        tenant.stripe_status,
        "stripe_customer_id":   tenant.stripe_customer_id,
        "trial_ends_at":        tenant.trial_ends_at.isoformat() if tenant.trial_ends_at else None,
        "amazon_connected":     bool(cred and cred.sp_refresh_token),
        "users_count":          users_count,
        "billing_enabled":      stripe_billing.billing_enabled(),
        "plans":                stripe_billing.PLANS,
    }


@app.patch("/api/tenant/settings")
def update_tenant_settings(
    data: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    """Let an admin update their workspace display name (store name)."""
    tenant_id = current.get("tenant_id", 1)
    tenant    = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    store_name = (data.get("store_name") or "").strip()
    if store_name:
        tenant.name = store_name
        # Also persist to AmazonCredential so email templates use the right name
        cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
        if cred:
            cred.store_name = store_name
    db.commit()
    return {"ok": True, "store_name": tenant.name}


@app.get("/api/tenant/users")
def tenant_users(current: dict = Depends(require_admin), db: Session = Depends(get_db)):
    tenant_id = current.get("tenant_id", 1)
    users = db.query(models.User).filter_by(tenant_id=tenant_id).all()
    return [{"id": u.id, "username": u.username, "email": u.email, "role": u.role,
             "is_active": u.is_active, "created_at": u.created_at} for u in users]


# ─── Billing (Stripe) ─────────────────────────────────────────────────────────

@app.get("/api/billing/plans")
def billing_plans():
    return {
        "enabled": stripe_billing.billing_enabled(),
        "plans": stripe_billing.PLANS,
    }


@app.post("/api/billing/checkout")
def billing_checkout(body: dict, current: dict = Depends(require_admin), db: Session = Depends(get_db)):
    if not stripe_billing.billing_enabled():
        raise HTTPException(503, "Billing is not configured")
    plan = body.get("plan", "pro")
    tenant_id = current.get("tenant_id", 1)
    try:
        url = stripe_billing.create_checkout_session(tenant_id, plan)
        return {"url": url}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.get("/api/billing/portal")
def billing_portal(current: dict = Depends(require_admin), db: Session = Depends(get_db)):
    if not stripe_billing.billing_enabled():
        raise HTTPException(503, "Billing is not configured")
    tenant_id = current.get("tenant_id", 1)
    tenant    = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant or not tenant.stripe_customer_id:
        raise HTTPException(400, "No Stripe customer found. Complete checkout first.")
    try:
        url = stripe_billing.create_billing_portal(tenant.stripe_customer_id)
        return {"url": url}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/billing/webhook")
async def billing_webhook(request: Request, db: Session = Depends(get_db)):
    payload    = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        result = stripe_billing.handle_webhook(payload, sig_header, db)
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))


# ─── Audit Log ────────────────────────────────────────────────────────────────

@app.get("/api/admin/audit-log")
def get_audit_log(
    tenant_id: int = None,
    action: str = None,
    limit: int = 200,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Platform-wide audit log (superadmin only). Filter by tenant or action."""
    q = db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc())
    if tenant_id:
        q = q.filter(models.AuditLog.tenant_id == tenant_id)
    if action:
        q = q.filter(models.AuditLog.action.ilike(f"%{action}%"))
    rows = q.offset(offset).limit(min(limit, 500)).all()
    return [
        {
            "id":        r.id,
            "tenant_id": r.tenant_id,
            "username":  r.username,
            "action":    r.action,
            "target":    r.target,
            "detail":    r.detail,
            "ip":        r.ip,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


# ─── GDPR / Data Export ───────────────────────────────────────────────────────

@app.get("/api/tenant/export")
def export_tenant_data(
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    """
    Export all data belonging to the current tenant as a single JSON document.
    Tenants can use this to satisfy GDPR/CCPA data portability requests.
    """
    from sqlalchemy.orm import joinedload
    tid = current.get("tenant_id")
    if not tid:
        raise HTTPException(400, "No tenant context")

    tenant = db.query(models.Tenant).filter_by(id=tid).first()
    users  = db.query(models.User).filter_by(tenant_id=tid).all()
    accounts = db.query(models.Account).filter_by(tenant_id=tid).all()
    contacts = db.query(models.Contact).filter(
        models.Contact.account_id.in_([a.id for a in accounts])
    ).all()
    follow_ups = db.query(models.FollowUp).filter_by(tenant_id=tid).all()
    products = db.query(models.Product).filter_by(tenant_id=tid).all()
    orders   = db.query(models.Order).filter_by(tenant_id=tid).all()

    def _dt(v):
        return v.isoformat() if v else None

    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "tenant": {
            "id": tenant.id, "name": tenant.name, "slug": tenant.slug,
            "plan": tenant.plan, "created_at": _dt(tenant.created_at),
        },
        "users": [
            {"id": u.id, "username": u.username, "email": u.email,
             "role": u.role, "created_at": _dt(u.created_at)}
            for u in users
        ],
        "accounts": [
            {"id": a.id, "name": a.name, "email": a.email, "phone": a.phone,
             "status": a.status, "account_type": a.account_type,
             "pipeline_stage": a.pipeline_stage, "created_at": _dt(a.created_at)}
            for a in accounts
        ],
        "contacts": [
            {"id": c.id, "account_id": c.account_id,
             "first_name": c.first_name, "last_name": c.last_name,
             "email": c.email, "phone": c.phone}
            for c in contacts
        ],
        "follow_ups": [
            {"id": f.id, "account_id": f.account_id, "subject": f.subject,
             "status": f.status, "priority": f.priority,
             "due_date": _dt(f.due_date), "created_at": _dt(f.created_at)}
            for f in follow_ups
        ],
        "products": [
            {"id": p.id, "name": p.product_name, "asin": p.asin, "sku": p.seller_sku,
             "status": p.status, "cost": p.buy_cost, "created_at": _dt(p.created_at)}
            for p in products
        ],
        "orders": [
            {"id": o.id, "status": o.status,
             "total_amount": o.total, "created_at": _dt(o.created_at)}
            for o in orders
        ],
    }

    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="sellerpulse-export-{tid}.json"'},
    )


@app.delete("/api/tenant/me", status_code=200)
def delete_tenant_account(
    body: dict = {},
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    """
    GDPR right to erasure — permanently anonymise all tenant data.
    Requires confirmation: {"confirm": "DELETE MY ACCOUNT"}.
    Soft-deletes the tenant and scrubs PII from all related records.
    Superadmins cannot delete their own platform account this way.
    """
    if current.get("role") == "superadmin":
        raise HTTPException(403, "Platform admin account cannot be self-deleted.")
    if body.get("confirm") != "DELETE MY ACCOUNT":
        raise HTTPException(400, 'Send {"confirm": "DELETE MY ACCOUNT"} to confirm erasure.')

    tid = current.get("tenant_id")
    if not tid:
        raise HTTPException(400, "No tenant context")

    from datetime import timezone as _tz

    tenant = db.query(models.Tenant).filter_by(id=tid).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")

    # Scrub PII from all users
    for u in db.query(models.User).filter_by(tenant_id=tid).all():
        u.email         = None
        u.password_hash = "DELETED"
        u.is_active     = False

    # Scrub PII from accounts and contacts
    for a in db.query(models.Account).filter_by(tenant_id=tid).all():
        a.email   = None
        a.phone   = None
        a.website = None

    for c in db.query(models.Contact).filter(
        models.Contact.account_id.in_(
            db.query(models.Account.id).filter_by(tenant_id=tid)
        )
    ).all():
        c.email = None
        c.phone = None

    # Remove Amazon credentials
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tid).first()
    if cred:
        cred.sp_refresh_token  = None
        cred.lwa_client_secret = None

    # Soft-delete tenant
    tenant.is_active  = False
    tenant.deleted_at = datetime.now(_tz.utc)
    tenant.name       = f"[Deleted Tenant {tid}]"

    _audit(db, "tenant.gdpr_erasure", current=current,
           target=f"tenant:{tid}", detail="Self-requested GDPR erasure")
    db.commit()

    return {"ok": True, "message": "Your account and associated data have been scheduled for deletion."}


# ─── Super-Admin Billing Dashboard (platform owner only) ─────────────────────

@app.get("/api/admin/billing/overview")
def admin_billing_overview(
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Platform MRR, subscriber counts, and revenue summary."""
    tenants  = db.query(models.Tenant).all()
    invoices = db.query(models.BillingInvoice).all()

    plan_prices = stripe_billing.PLAN_PRICES_CENTS

    active_tenants  = [t for t in tenants if t.stripe_status == "active"]
    trial_tenants   = [t for t in tenants if t.stripe_status == "trialing"]
    past_due_tenants = [t for t in tenants if t.stripe_status == "past_due"]
    free_tenants    = [t for t in tenants if not t.stripe_customer_id or t.plan == "starter"]

    mrr_cents = sum(plan_prices.get(t.plan, 0) for t in active_tenants)

    paid_invs  = [i for i in invoices if i.status == "paid"]
    total_rev  = sum(i.amount_cents for i in paid_invs)
    failed_inv = [i for i in invoices if i.status == "failed"]

    return {
        "total_tenants":          len(tenants),
        "active_subscribers":     len(active_tenants),
        "trial_subscribers":      len(trial_tenants),
        "past_due_subscribers":   len(past_due_tenants),
        "free_subscribers":       len(free_tenants),
        "mrr":                    mrr_cents / 100,
        "total_revenue":          total_rev / 100,
        "total_invoices":         len(invoices),
        "paid_invoices":          len(paid_invs),
        "failed_invoices":        len(failed_inv),
        "billing_enabled":        stripe_billing.billing_enabled(),
    }


@app.get("/api/admin/billing/tenants")
def admin_billing_tenants(
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """All tenants with billing and connection details."""
    tenants = db.query(models.Tenant).order_by(models.Tenant.created_at.desc()).all()
    result  = []
    for t in tenants:
        cred  = db.query(models.AmazonCredential).filter_by(tenant_id=t.id).first()
        users = db.query(func.count(models.User.id)).filter(models.User.tenant_id == t.id).scalar() or 0
        last_inv = (
            db.query(models.BillingInvoice)
            .filter_by(tenant_id=t.id)
            .order_by(models.BillingInvoice.created_at.desc())
            .first()
        )
        admin_user = (
            db.query(models.User)
            .filter_by(tenant_id=t.id, role="admin")
            .first()
        )
        result.append({
            "id":                t.id,
            "name":              t.name,
            "slug":              t.slug,
            "plan":              t.plan,
            "is_active":         t.is_active,
            "is_beta":           getattr(t, 'is_beta', False),
            "stripe_status":     t.stripe_status,
            "stripe_customer_id": t.stripe_customer_id,
            "trial_ends_at":     t.trial_ends_at.isoformat() if t.trial_ends_at else None,
            "created_at":        t.created_at.isoformat() if t.created_at else None,
            "amazon_connected":  bool(cred and cred.sp_refresh_token),
            "store_name":        cred.store_name if cred else None,
            "users_count":       users,
            "admin_email":       admin_user.email if admin_user else None,
            "mrr":               stripe_billing.PLAN_PRICES_CENTS.get(t.plan, 0) / 100
                                 if t.stripe_status in ("active", "trialing") else 0,
            "last_payment": {
                "amount":     last_inv.amount_cents / 100,
                "status":     last_inv.status,
                "created_at": last_inv.created_at.isoformat() if last_inv.created_at else None,
            } if last_inv else None,
        })
    return result


@app.get("/api/admin/billing/invoices")
def admin_billing_invoices(
    limit: int = 100,
    offset: int = 0,
    tenant_id: int = None,
    status: str = None,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Payment history across all tenants (or filtered by tenant_id / status)."""
    q = db.query(models.BillingInvoice).order_by(models.BillingInvoice.created_at.desc())
    if tenant_id:
        q = q.filter(models.BillingInvoice.tenant_id == tenant_id)
    if status:
        q = q.filter(models.BillingInvoice.status == status)

    invoices = q.offset(offset).limit(limit).all()

    # Bulk-fetch tenant names to avoid N+1
    tid_set  = {i.tenant_id for i in invoices}
    t_map    = {t.id: t.name for t in db.query(models.Tenant).filter(models.Tenant.id.in_(tid_set)).all()}

    return [
        {
            "id":                 inv.id,
            "tenant_id":          inv.tenant_id,
            "tenant_name":        t_map.get(inv.tenant_id, "Unknown"),
            "stripe_invoice_id":  inv.stripe_invoice_id,
            "amount":             inv.amount_cents / 100,
            "currency":           inv.currency,
            "status":             inv.status,
            "plan":               inv.plan,
            "description":        inv.description,
            "invoice_url":        inv.invoice_url,
            "period_start":       inv.period_start.isoformat() if inv.period_start else None,
            "period_end":         inv.period_end.isoformat() if inv.period_end else None,
            "created_at":         inv.created_at.isoformat() if inv.created_at else None,
        }
        for inv in invoices
    ]


@app.post("/api/admin/billing/tenants/{tenant_id}/suspend")
def admin_suspend_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Disable a tenant (locks them out without deleting data)."""
    tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    tenant.is_active = False
    db.commit()
    _audit(db, "tenant.suspend", current=current,
           target=f"tenant:{tenant_id}", detail=f"name={tenant.name}")
    return {"ok": True, "tenant_id": tenant_id, "is_active": False}


@app.post("/api/admin/billing/tenants/{tenant_id}/activate")
def admin_activate_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Re-enable a suspended tenant."""
    tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    tenant.is_active = True
    db.commit()
    _audit(db, "tenant.activate", current=current,
           target=f"tenant:{tenant_id}", detail=f"name={tenant.name}")
    return {"ok": True, "tenant_id": tenant_id, "is_active": True}


@app.post("/api/admin/billing/tenants/{tenant_id}/grant-access")
def admin_grant_access(
    tenant_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Clear stripe_status so the tenant bypasses the paywall (permanent free access)."""
    tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    tenant.is_active = True
    tenant.stripe_status = None
    tenant.trial_ends_at = None
    db.commit()
    _audit(db, "tenant.grant_access", current=current,
           target=f"tenant:{tenant_id}", detail=f"name={tenant.name}")
    return {"ok": True, "tenant_id": tenant_id}


@app.post("/api/admin/billing/tenants/{tenant_id}/beta")
def admin_set_beta(
    tenant_id: int,
    body: dict = {},
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Toggle beta status. Beta tenants get permanent full access regardless of billing."""
    tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    is_beta = body.get("is_beta", True)
    tenant.is_beta   = is_beta
    tenant.is_active = True
    if is_beta:
        tenant.plan          = "enterprise"
        tenant.stripe_status = None
        tenant.trial_ends_at = None
    db.commit()
    _audit(db, "tenant.beta_set", current=current,
           target=f"tenant:{tenant_id}",
           detail=f"name={tenant.name} is_beta={is_beta}")
    return {"ok": True, "tenant_id": tenant_id, "is_beta": is_beta}


@app.get("/api/admin/billing/tenants/{tenant_id}/users")
def admin_tenant_users(
    tenant_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """List all users for a tenant with their login status."""
    users = db.query(models.User).filter_by(tenant_id=tenant_id).order_by(models.User.created_at).all()
    return [
        {
            "id":             u.id,
            "username":       u.username,
            "email":          u.email,
            "role":           u.role,
            "is_active":      u.is_active,
            "email_verified": u.email_verified,
            "created_at":     u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@app.post("/api/admin/billing/tenants/{tenant_id}/users/{user_id}/unlock")
def admin_unlock_user(
    tenant_id: int,
    user_id: int,
    body: dict = {},
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Enable a disabled user and optionally reset their password."""
    user = db.query(models.User).filter_by(id=user_id, tenant_id=tenant_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = True
    user.email_verified = True
    user.failed_login_count = 0
    user.locked_until = None
    new_password = body.get("new_password", "").strip()
    if new_password:
        user.password_hash = hash_password(new_password)
    db.commit()
    _audit(db, "user.unlock", current=current,
           target=f"user:{user_id}",
           detail=f"username={user.username} tenant={tenant_id} password_reset={bool(new_password)}")
    return {"ok": True, "user_id": user_id, "username": user.username, "password_reset": bool(new_password)}


@app.put("/api/admin/billing/tenants/{tenant_id}/plan")
def admin_change_plan(
    tenant_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_superadmin),
):
    """Manually override a tenant's plan (e.g. comp an account or correct a billing error)."""
    tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        raise HTTPException(404, "Tenant not found")
    new_plan = body.get("plan", "starter")
    if new_plan not in stripe_billing.PLANS:
        raise HTTPException(400, f"Unknown plan: {new_plan}")
    old_plan = tenant.plan
    tenant.plan = new_plan
    db.commit()
    _audit(db, "tenant.plan_change", current=current,
           target=f"tenant:{tenant_id}", detail=f"name={tenant.name} {old_plan}->{new_plan}")
    return {"ok": True, "tenant_id": tenant_id, "plan": new_plan}


# ─── Ownership helpers ────────────────────────────────────────────────────────

def _is_admin(current: dict) -> bool:
    return current.get("role") == "admin"

def _filter_owned(q, model, current: dict):
    """Filter query to records scoped to the current user's tenant.

    Isolation tiers:
      - Superadmin: scoped to THEIR OWN tenant (same as tenant admin).
        Cross-tenant access is handled explicitly in admin-only endpoints,
        not here. This prevents a superadmin's normal product/account views
        from accidentally showing every tenant's data on the platform.
      - Tenant admin: sees all records within their tenant only.
      - Regular user: sees only their own records within their tenant.
    """
    # Always scope to tenant — superadmins use their own tenant like any admin
    tid = current.get("tenant_id")
    if tid:
        q = q.filter(model.tenant_id == tid)

    # Non-admin users are further restricted to their own records
    if not _is_admin(current) and not current.get("is_superadmin"):
        q = q.filter(
            (model.created_by == current["sub"]) | (model.created_by == None)
        )
    return q

def _check_owner(record, current: dict):
    """Raise 403 if current user doesn't own the record.

    Superadmin bypasses. Tenant admins can access any record within their tenant.
    Regular users can only access their own records.
    """
    if current.get("is_superadmin"):
        return
    tid = current.get("tenant_id")
    if tid and hasattr(record, "tenant_id") and record.tenant_id and record.tenant_id != tid:
        raise HTTPException(status_code=403, detail="Access denied")
    if not _is_admin(current) and record.created_by and record.created_by != current["sub"]:
        raise HTTPException(status_code=403, detail="Access denied")


# ─── Dashboard ────────────────────────────────────────────────────────────────

@app.get("/api/dashboard", response_model=schemas.DashboardStats)
def get_dashboard(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    tid = current.get("tenant_id", 1)
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end   = today_start + timedelta(days=1)
    week_end    = today_start + timedelta(days=7)

    def tq(model): return db.query(model).filter(model.tenant_id == tid)

    total_accounts    = tq(models.Account).count()
    active_accounts   = tq(models.Account).filter(models.Account.status == "active").count()
    prospect_accounts = tq(models.Account).filter(models.Account.status == "prospect").count()

    follow_ups_due_today = tq(models.FollowUp).filter(
        models.FollowUp.status == "pending",
        models.FollowUp.due_date >= today_start,
        models.FollowUp.due_date < today_end,
    ).count()

    follow_ups_overdue = tq(models.FollowUp).filter(
        models.FollowUp.status == "pending",
        models.FollowUp.due_date < today_start,
    ).count()

    follow_ups_this_week = tq(models.FollowUp).filter(
        models.FollowUp.status == "pending",
        models.FollowUp.due_date >= today_start,
        models.FollowUp.due_date < week_end,
    ).count()

    open_orders = tq(models.Order).filter(
        models.Order.status.in_(["pending", "confirmed", "quote"])
    ).count()

    total_order_value = db.query(func.sum(models.Order.total)).filter(
        models.Order.tenant_id == tid,
        models.Order.status.in_(["pending", "confirmed", "shipped"])
    ).scalar() or 0

    recent_follow_ups = (
        tq(models.FollowUp)
        .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
        .filter(models.FollowUp.status == "completed")
        .order_by(models.FollowUp.completed_date.desc())
        .limit(5).all()
    )

    upcoming_follow_ups = (
        tq(models.FollowUp)
        .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
        .filter(models.FollowUp.status == "pending", models.FollowUp.due_date >= today_start)
        .order_by(models.FollowUp.due_date.asc())
        .limit(10).all()
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


async def _amazon_fetch_orders(access_token: str, params_first: list, sp_base: str = None) -> list:
    """Paginate through Amazon Orders API. params_first is a list of (key, value) tuples."""
    import httpx as _httpx
    base = sp_base or _AMAZON_SP_BASE
    orders = []
    next_token = None
    try:
        async with _httpx.AsyncClient(timeout=30) as client:
            while True:
                if next_token:
                    p = [("NextToken", next_token)]
                else:
                    p = params_first
                resp = await client.get(
                    f"{base}/orders/v0/orders",
                    params=p,
                    headers={"x-amz-access-token": access_token},
                )
                if resp.status_code == 403:
                    raise HTTPException(403, "Amazon Orders API: insufficient permissions. Enable 'Orders' role in Seller Central → SP-API app.")
                if resp.status_code == 429:
                    print(f"[orders] 429 QuotaExceeded — returning {len(orders)} orders fetched so far", flush=True)
                    break
                if resp.status_code != 200:
                    raise HTTPException(502, f"Amazon Orders API {resp.status_code}: {resp.text[:400]}")
                body = resp.json().get("payload", {})
                orders.extend(body.get("Orders", []))
                next_token = body.get("NextToken")
                if not next_token:
                    break
    except _httpx.TimeoutException:
        raise HTTPException(502, "Amazon Orders API request timed out — try again in a moment")
    except _httpx.RequestError as exc:
        raise HTTPException(502, f"Amazon Orders API network error: {exc}")
    return orders


@app.get("/api/debug/amazon-orders-raw")
async def debug_amazon_orders_raw(_ = Depends(require_auth)):
    """
    Diagnostic: returns the raw first-page Amazon Orders API response
    so you can see exactly what Amazon is sending back.
    """
    if not _amazon_sp_configured():
        raise HTTPException(503, "Amazon SP-API not configured")
    import httpx as _httpx
    from datetime import timezone
    access_token = await _get_amazon_access_token()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    thirty_days_ago = (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ")

    results = {}

    async with _httpx.AsyncClient(timeout=30) as client:
        # Test 1: today's orders, no status filter
        r1 = await client.get(
            f"{_AMAZON_SP_BASE}/orders/v0/orders",
            params=[("MarketplaceIds", _AMAZON_MKT_ID), ("CreatedAfter", today_start)],
            headers={"x-amz-access-token": access_token},
        )
        results["today_no_status_filter"] = {
            "status_code": r1.status_code,
            "body": r1.json() if r1.status_code == 200 else r1.text[:500],
        }

        # Test 2: last 30 days, open statuses only (repeated params)
        r2 = await client.get(
            f"{_AMAZON_SP_BASE}/orders/v0/orders",
            params=[
                ("MarketplaceIds", _AMAZON_MKT_ID),
                ("LastUpdatedAfter", thirty_days_ago),
                ("OrderStatuses", "Pending"),
                ("OrderStatuses", "Unshipped"),
                ("OrderStatuses", "PartiallyShipped"),
            ],
            headers={"x-amz-access-token": access_token},
        )
        results["last30_open_statuses"] = {
            "status_code": r2.status_code,
            "body": r2.json() if r2.status_code == 200 else r2.text[:500],
        }

    results["marketplace_id"] = _AMAZON_MKT_ID
    results["sp_base"] = _AMAZON_SP_BASE
    results["today_start_utc"] = today_start
    return results


@app.get("/api/dashboard/amazon-sales")
async def get_dashboard_amazon_sales(
    period: str = "today",
    tz_offset: int = 0,
    current: dict = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Real-time Amazon sales + payments from SP-API.
    period: "today" | "week" | "month"
    tz_offset: browser UTC offset in minutes (e.g. -240 for EDT, -300 for EST)

    Two separate API calls:
    1. Sales: orders CreatedAfter=period_start (any status except Canceled)
    2. Open Orders: orders with open status, LastUpdatedAfter=30 days ago
       (separate call, no date restriction on creation)
    """
    tenant_id = current.get("tenant_id", 1)
    cred = _get_tenant_amazon_creds(tenant_id, db)
    if not cred or not cred.sp_refresh_token:
        raise HTTPException(503, "Amazon SP-API credentials are not configured")

    from datetime import timezone
    import httpx as _httpx

    now = datetime.now(timezone.utc)
    # Shift 'now' to the user's local time so day/week/month boundaries are correct
    # tz_offset is in minutes (matching JS Date.getTimezoneOffset() but negated)
    tz_delta   = timedelta(minutes=tz_offset)   # e.g. -240 min for EDT → -4 h
    local_now  = now + tz_delta                 # user's local "now"
    if period == "month":
        local_start = local_now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        local_start = (local_now - timedelta(days=local_now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    else:  # today
        local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Convert back to UTC for the Amazon API call
    period_start = local_start - tz_delta

    created_after     = period_start.strftime("%Y-%m-%dT%H:%M:%SZ")
    open_orders_since = (now - timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%SZ")
    mkt_id            = cred.marketplace_id or _AMAZON_MKT_ID

    access_token = await _get_tenant_access_token(cred)

    sales_params = [
        ("MarketplaceIds", mkt_id),
        ("CreatedAfter", created_after),
    ]
    _sp = _sp_base(cred.is_sandbox)
    sales_orders = await _amazon_fetch_orders(access_token, sales_params, sp_base=_sp)

    # ── 1b. FBM shipped in period: catches FBM orders fulfilled today that were created before period ──
    fbm_shipped_params = [
        ("MarketplaceIds", mkt_id),
        ("LastUpdatedAfter", created_after),
        ("OrderStatuses", "Shipped"),
        ("FulfillmentChannels", "MFN"),
    ]
    fbm_shipped_orders = await _amazon_fetch_orders(access_token, fbm_shipped_params, sp_base=_sp)
    existing_ids = {o.get("AmazonOrderId") for o in sales_orders}
    for o in fbm_shipped_orders:
        oid = o.get("AmazonOrderId")
        # Only include FBM shipped orders placed within the current period
        # (prevents yesterday's orders from appearing under "Today")
        purchase_date = o.get("PurchaseDate", "")
        if oid and oid not in existing_ids and purchase_date >= created_after:
            sales_orders.append(o)
            existing_ids.add(oid)

    # ── 2. Open Orders: separate call, no creation-date restriction ─────────
    open_params = [
        ("MarketplaceIds", mkt_id),
        ("LastUpdatedAfter", open_orders_since),
        ("OrderStatuses", "Pending"),
        ("OrderStatuses", "Unshipped"),
        ("OrderStatuses", "PartiallyShipped"),
    ]
    open_orders = await _amazon_fetch_orders(access_token, open_params, sp_base=_sp)

    # ── 3. Aggregate sales metrics ──────────────────────────────────────────
    sales_revenue = 0.0
    units_sold    = 0
    currency      = "USD"

    for o in sales_orders:
        status    = o.get("OrderStatus", "")
        if status in {"Canceled", "Unfulfillable"}:
            continue
        total_obj = o.get("OrderTotal") or {}
        amt = total_obj.get("Amount")
        cur = total_obj.get("CurrencyCode", "USD")
        if cur:
            currency = cur
        if amt is not None:
            sales_revenue += float(amt)
        units_sold += (
            int(o.get("NumberOfItemsShipped") or 0)
            + int(o.get("NumberOfItemsUnshipped") or 0)
        )

    # ── 4. Fetch payment balance from Finances API (cached + retried) ─────────
    payment_balance  = None
    payment_currency = currency
    finances_error   = None

    # Return cached value if fresh enough (avoids Amazon throttle on rapid refresh)
    _fin_cached = _finances_cache.get(tenant_id)
    if _fin_cached and (now - _fin_cached["fetched_at"]).total_seconds() < _FINANCES_CACHE_TTL_SECONDS:
        payment_balance  = _fin_cached["balance"]
        payment_currency = _fin_cached["currency"]
        print(f"[finances] serving cached balance={payment_balance} age={(now - _fin_cached['fetched_at']).total_seconds():.0f}s", flush=True)
    else:
        import asyncio as _asyncio
        _fin_base      = _sp_base(cred.is_sandbox)
        finances_after = (now - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
        print(f"[finances] calling {_fin_base}/finances/v0/financialEventGroups is_sandbox={cred.is_sandbox}", flush=True)
        fin_resp = None
        for _attempt in range(3):
            try:
                async with _httpx.AsyncClient(timeout=20) as client:
                    fin_resp = await client.get(
                        f"{_fin_base}/finances/v0/financialEventGroups",
                        params={"FinancialEventGroupStartedAfter": finances_after},
                        headers={"x-amz-access-token": access_token},
                    )
                if fin_resp.status_code != 403:
                    break
                print(f"[finances] 403 on attempt {_attempt+1}/3 — {'retrying' if _attempt < 2 else 'giving up'}", flush=True)
                if _attempt < 2:
                    await _asyncio.sleep(1.5)
            except Exception as _e:
                finances_error = str(_e)
                fin_resp = None
                break

        if fin_resp is not None and fin_resp.status_code == 200:
            groups = fin_resp.json().get("payload", {}).get("FinancialEventGroupList", [])

            def _amt(obj: dict) -> float:
                """Amazon uses CurrencyAmount (not Amount) in financialEventGroups."""
                if not obj:
                    return 0.0
                return float(obj.get("CurrencyAmount") or obj.get("Amount") or 0)

            # Primary: sum Open USD groups (current settlement period, not yet disbursed)
            total_balance = 0.0
            for g in groups:
                if g.get("ProcessingStatus") == "Open":
                    orig = g.get("OriginalTotal") or g.get("ConvertedTotal") or {}
                    cur2 = orig.get("CurrencyCode", "")
                    if cur2 and cur2 != "USD":
                        continue  # skip non-USD open groups
                    amt = _amt(orig)
                    if cur2:
                        payment_currency = cur2
                    total_balance += amt

            # Secondary: also add any Closed groups NOT yet successfully disbursed
            for g in groups:
                if g.get("ProcessingStatus") == "Closed":
                    fund_status = g.get("FundTransferStatus", "")
                    if fund_status not in ("Succeeded", "Successful"):
                        orig = g.get("OriginalTotal") or g.get("ConvertedTotal") or {}
                        cur2 = orig.get("CurrencyCode", "")
                        if cur2 and cur2 != "USD":
                            continue
                        total_balance += _amt(orig)

            payment_balance = round(total_balance, 2)
            print(f"[finances] balance={payment_balance} (from {len(groups)} groups, Open USD groups)", flush=True)
            # Store in cache
            _finances_cache[tenant_id] = {
                "balance":    payment_balance,
                "currency":   payment_currency,
                "fetched_at": now,
            }
        elif fin_resp is not None and not finances_error:
            try:
                err_body = fin_resp.json()
            except Exception:
                err_body = fin_resp.text[:300]
            print(f"[finances] final error {fin_resp.status_code}: {err_body}", flush=True)
            finances_error = f"Finances API {fin_resp.status_code}: {err_body}"

    def _fmt_order(o: dict) -> dict:
        total = o.get("OrderTotal") or {}
        return {
            "id":        o.get("AmazonOrderId", ""),
            "status":    o.get("OrderStatus", ""),
            "channel":   o.get("FulfillmentChannel", ""),
            "amount":    float(total.get("Amount") or 0),
            "currency":  total.get("CurrencyCode", "USD"),
            "units":     int(o.get("NumberOfItemsShipped") or 0) + int(o.get("NumberOfItemsUnshipped") or 0),
            "created":   o.get("PurchaseDate", ""),
            "ship_city": (o.get("ShippingAddress") or {}).get("City", ""),
        }

    # ── 5. Build per-marketplace balance breakdown ──────────────────────────
    _MKT_MAP = {
        "ATVPDKIKX0DER": ("United States",  "North America"),
        "A2EUQ1WTGCTBG2": ("Canada",        "North America"),
        "A1AM78C64UM0Y8": ("Mexico",        "North America"),
        "A2Q3Y263D00KWC": ("Brazil",        "South America"),
        "A1PA6795UKMFR9": ("Germany",       "Europe"),
        "A1RKKUPIHCS9HS": ("Spain",         "Europe"),
        "A13V1IB3VIYZZH": ("France",        "Europe"),
        "A1F83G8C2ARO7P": ("United Kingdom","Europe"),
        "APJ6JRA9NG5V4":  ("Italy",         "Europe"),
        "A1805IZSGTT6HS": ("Netherlands",   "Europe"),
    }
    _REGION_ORDER = ["North America", "South America", "Europe"]
    region_data: dict = {}
    for _mid, (_sname, _region) in _MKT_MAP.items():
        _bal = round(payment_balance, 2) if (payment_balance is not None and _mid == mkt_id) else 0.0
        if _region not in region_data:
            region_data[_region] = {"region": _region, "total": 0.0, "stores": []}
        region_data[_region]["stores"].append({"store": _sname, "balance": _bal})
        region_data[_region]["total"] = round(region_data[_region]["total"] + _bal, 2)
    balance_breakdown = [region_data[r] for r in _REGION_ORDER if r in region_data]

    return {
        "period":            period,
        "period_start":      period_start.isoformat(),
        "fetched_at":        now.isoformat(),
        "currency":          currency,
        "revenue":           round(sales_revenue, 2),
        "order_count":       len(sales_orders),
        "units_sold":        units_sold,
        "open_order_count":  len(open_orders),
        "payment_balance":   payment_balance,
        "payment_currency":  payment_currency,
        "finances_error":    finances_error,
        "total_orders":      len(sales_orders),
        "balance_breakdown": balance_breakdown,
        "orders":            [_fmt_order(o) for o in sorted(sales_orders, key=lambda x: x.get("PurchaseDate",""), reverse=True)[:50]],
        "open_orders":       [_fmt_order(o) for o in open_orders[:50]],
    }


# Per-tenant cache for FBA live inventory — keyed by tenant_id
# {tenant_id: {"payload": dict, "fetched_at": datetime}}
_fba_live_cache: dict = {}
_FBA_LIVE_CACHE_TTL = 90  # seconds


@app.get("/api/dashboard/amazon-live")
async def get_dashboard_amazon_live(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """
    Real-time Amazon FBA inventory snapshot for the Dashboard.
    Serves a 90-second per-tenant cache to avoid hammering Amazon at scale.
    On any Amazon error, returns the last cached payload (or zeros) — never 502s the client.
    """
    from datetime import timezone as _tz_live
    import httpx as _httpx

    tenant_id = current.get("tenant_id", 1)
    now = datetime.now(_tz_live.utc)

    # ── Buy-box stats come from DB — always fresh, no Amazon call needed ──────
    approved_products = db.query(models.Product).filter(
        models.Product.status == "approved",
        models.Product.tenant_id == tenant_id,
    ).all()
    approved_with_bb = [p for p in approved_products if p.buy_box and p.buy_box > 0]
    competitive = sum(
        1 for p in approved_with_bb
        if p.aria_suggested_price and p.aria_suggested_price <= p.buy_box
    )
    buy_box_pct = round(competitive / len(approved_with_bb) * 100, 1) if approved_with_bb else 0.0

    # ── Serve cache if still fresh ────────────────────────────────────────────
    _cached = _fba_live_cache.get(tenant_id)
    if _cached and (now - _cached["fetched_at"]).total_seconds() < _FBA_LIVE_CACHE_TTL:
        payload = dict(_cached["payload"])
        payload["buy_box_pct"] = buy_box_pct
        payload["approved_skus"] = len(approved_products)
        payload["from_cache"] = True
        return payload

    # ── Credentials check ─────────────────────────────────────────────────────
    cred = _get_tenant_amazon_creds(tenant_id, db)
    if not cred or not cred.sp_refresh_token:
        # Return zeros — don't crash the dashboard
        return {
            "fetched_at":        now.isoformat(),
            "total_skus":        0,
            "total_units":       0,
            "total_fulfillable": 0,
            "total_inbound":     0,
            "total_reserved":    0,
            "buy_box_pct":       buy_box_pct,
            "approved_skus":     len(approved_products),
            "top_items":         [],
            "error":             "Amazon SP-API credentials are not configured",
        }

    # ── Fetch from Amazon ─────────────────────────────────────────────────────
    amazon_error = None
    items = []
    try:
        access_token = await _get_tenant_access_token(cred)
        mkt_id = cred.marketplace_id or _AMAZON_MKT_ID
        next_token = None
        async with _httpx.AsyncClient(timeout=25) as client:
            while True:
                params = {
                    "granularityType": "Marketplace",
                    "granularityId":   mkt_id,
                    "marketplaceIds":  mkt_id,
                    "details":         "true",
                }
                if next_token:
                    params["nextToken"] = next_token

                resp = await client.get(
                    f"{_sp_base(cred.is_sandbox)}/fba/inventory/v1/summaries",
                    params=params,
                    headers={"x-amz-access-token": access_token},
                )
                if resp.status_code == 429:
                    print(f"[amazon-live] tenant={tenant_id} rate-limited (429) — serving cache/partial", flush=True)
                    amazon_error = "Amazon rate-limited — showing latest available data"
                    break
                if resp.status_code == 403:
                    amazon_error = "Amazon SP-API access denied — check FBA Inventory permission in Seller Central"
                    break
                if resp.status_code != 200:
                    amazon_error = f"Amazon SP-API returned {resp.status_code}"
                    print(f"[amazon-live] tenant={tenant_id} SP-API {resp.status_code}: {resp.text[:200]}", flush=True)
                    break

                body = resp.json().get("payload", {})
                for s in body.get("inventorySummaries", []):
                    details = s.get("inventoryDetails") or {}
                    fulfillable      = details.get("fulfillableQuantity") or 0
                    inbound_shipped  = details.get("inboundShippedQuantity") or 0
                    inbound_receiving = details.get("inboundReceivingQuantity") or 0
                    inbound_working  = details.get("inboundWorkingQuantity") or 0
                    reserved_obj     = details.get("reservedQuantity") or {}
                    reserved_qty = (
                        (reserved_obj.get("pendingCustomerOrderQuantity") or 0)
                        + (reserved_obj.get("pendingTransshipmentQuantity") or 0)
                        + (reserved_obj.get("fcProcessingQuantity") or 0)
                    )
                    total = fulfillable + inbound_shipped + inbound_receiving + inbound_working
                    asin = (s.get("asin") or "").upper()
                    items.append({
                        "asin":         asin,
                        "product_name": s.get("productName") or s.get("sellerSku") or asin,
                        "seller_sku":   s.get("sellerSku", ""),
                        "fulfillable":  fulfillable,
                        "inbound":      inbound_shipped + inbound_receiving + inbound_working,
                        "reserved":     reserved_qty,
                        "total":        total,
                    })

                next_token = body.get("nextToken")
                if not next_token:
                    break

    except _httpx.TimeoutException:
        amazon_error = "Amazon API timed out — showing latest available data"
        print(f"[amazon-live] tenant={tenant_id} timeout", flush=True)
    except _httpx.RequestError as exc:
        amazon_error = f"Amazon API network error — showing latest available data"
        print(f"[amazon-live] tenant={tenant_id} network error: {exc}", flush=True)
    except HTTPException as exc:
        amazon_error = exc.detail
        print(f"[amazon-live] tenant={tenant_id} token error: {exc.detail}", flush=True)
    except Exception as exc:
        amazon_error = "Unexpected error fetching FBA inventory"
        print(f"[amazon-live] tenant={tenant_id} unexpected: {exc}", flush=True)

    # ── If Amazon call failed, serve stale cache rather than erroring ─────────
    if amazon_error and not items:
        if _cached:
            payload = dict(_cached["payload"])
            payload["buy_box_pct"]   = buy_box_pct
            payload["approved_skus"] = len(approved_products)
            payload["from_cache"]    = True
            payload["error"]         = amazon_error
            return payload
        # No cache at all — return zeros with error message (never 502)
        return {
            "fetched_at":        now.isoformat(),
            "total_skus":        0,
            "total_units":       0,
            "total_fulfillable": 0,
            "total_inbound":     0,
            "total_reserved":    0,
            "buy_box_pct":       buy_box_pct,
            "approved_skus":     len(approved_products),
            "top_items":         [],
            "error":             amazon_error,
        }

    # ── Build response and update cache ──────────────────────────────────────
    top_items = sorted(items, key=lambda x: x["total"], reverse=True)[:10]
    result = {
        "fetched_at":        now.isoformat(),
        "total_skus":        len(items),
        "total_units":       sum(i["total"] for i in items),
        "total_fulfillable": sum(i["fulfillable"] for i in items),
        "total_inbound":     sum(i["inbound"] for i in items),
        "total_reserved":    sum(i["reserved"] for i in items),
        "buy_box_pct":       buy_box_pct,
        "approved_skus":     len(approved_products),
        "top_items":         top_items,
    }
    if amazon_error:
        result["error"] = amazon_error
    else:
        _fba_live_cache[tenant_id] = {"payload": result, "fetched_at": now}

    return {
        "fetched_at":        now.isoformat(),
        "total_skus":        len(items),
        "total_units":       sum(i["total"] for i in items),
        "total_fulfillable": sum(i["fulfillable"] for i in items),
        "total_inbound":     sum(i["inbound"] for i in items),
        "total_reserved":    sum(i["reserved"] for i in items),
        "buy_box_pct":       buy_box_pct,
        "approved_skus":     len(approved_products),
        "top_items":         top_items,
    }


@app.get("/api/dashboard/amazon-orders")
async def get_dashboard_amazon_orders(
    current: dict = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """
    Live open FBA + FBM orders from Amazon SP-API (last 60 days, open statuses).
    Returns separate lists so the dashboard can show FBA vs FBM boxes.
    """
    tenant_id = current.get("tenant_id", 1)
    cred = _get_tenant_amazon_creds(tenant_id, db)
    if not cred or not cred.sp_refresh_token:
        raise HTTPException(503, "Amazon SP-API credentials are not configured")

    from datetime import timezone as _tz2
    now       = datetime.now(_tz2.utc)
    since     = (now - timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%SZ")
    mkt_id    = cred.marketplace_id or _AMAZON_MKT_ID

    access_token = await _get_tenant_access_token(cred)

    # Broad query: no OrderStatuses filter — fetches all orders updated in last 14 days.
    # We classify FBA vs FBM and open vs shipped entirely on the Python side.
    open_since = (now - timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ")
    open_params = [
        ("MarketplaceIds",   mkt_id),
        ("LastUpdatedAfter", open_since),
    ]
    open_raw = await _amazon_fetch_orders(access_token, open_params, sp_base=_sp_base(cred.is_sandbox))

    def _fmt(o):
        total_obj = o.get("OrderTotal") or {}
        return {
            "order_id":    o.get("AmazonOrderId", ""),
            "status":      o.get("OrderStatus", ""),
            "date":        (o.get("PurchaseDate") or "")[:10],
            "ship_by":     (o.get("LatestShipDate") or "")[:10],
            "items":       (o.get("NumberOfItemsShipped") or 0) + (o.get("NumberOfItemsUnshipped") or 0),
            "total":       float(total_obj.get("Amount") or 0),
            "currency":    total_obj.get("CurrencyCode") or "USD",
        }

    _OPEN   = {"Pending", "Unshipped", "PartiallyShipped"}
    _CLOSED = {"Shipped", "Canceled", "Unfulfillable", "InvoiceUnconfirmed"}

    fba = sorted(
        [_fmt(o) for o in open_raw
         if o.get("FulfillmentChannel") == "AFN" and o.get("OrderStatus") in _OPEN],
        key=lambda x: x["date"], reverse=True,
    )
    fbm = sorted(
        [_fmt(o) for o in open_raw
         if o.get("FulfillmentChannel") != "AFN" and o.get("OrderStatus") in _OPEN],
        key=lambda x: x["date"], reverse=True,
    )
    # FBM shipped in last 7 days — extracted from the same open_raw batch (no extra API call)
    # so there's no timing gap when a shipping label is just purchased.
    seven_days_ago = (now - timedelta(days=7)).strftime("%Y-%m-%dT")
    fbm_shipped = sorted(
        [_fmt(o) for o in open_raw
         if o.get("FulfillmentChannel") != "AFN"
         and o.get("OrderStatus") == "Shipped"
         and (o.get("LastUpdateDate") or o.get("PurchaseDate") or "") >= seven_days_ago],
        key=lambda x: x["date"], reverse=True,
    )

    return {
        "fba_orders":        fba,
        "fbm_orders":        fbm,
        "fba_count":         len(fba),
        "fbm_count":         len(fbm),
        "fbm_shipped":       fbm_shipped,
        "fbm_shipped_count": len(fbm_shipped),
        "fetched_at":        now.isoformat(),
    }


@app.get("/api/debug/amazon-orders-tenant")
async def debug_amazon_orders_tenant(
    current: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Multi-strategy diagnostic: tries several query combinations to identify
    why an FBM Unshipped order may not be appearing.
    """
    tenant_id = current.get("tenant_id", 1)
    cred = _get_tenant_amazon_creds(tenant_id, db)
    if not cred or not cred.sp_refresh_token:
        raise HTTPException(503, "Amazon SP-API credentials not configured for this tenant")

    import httpx as _hx2
    from datetime import timezone as _tz3
    now    = datetime.now(_tz3.utc)
    since60 = (now - timedelta(days=60)).strftime("%Y-%m-%dT%H:%M:%SZ")
    since7  = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    mkt_id  = cred.marketplace_id or _AMAZON_MKT_ID
    access_token = await _get_tenant_access_token(cred)

    def _summarise(orders):
        return [{"id": o.get("AmazonOrderId"), "status": o.get("OrderStatus"),
                 "channel": o.get("FulfillmentChannel"), "created": (o.get("PurchaseDate") or "")[:16]}
                for o in orders]

    # Strategy A: all open statuses, no channel filter (catches everything open)
    a_params = [
        ("MarketplaceIds", mkt_id), ("CreatedAfter", since60),
        ("OrderStatuses", "Pending"), ("OrderStatuses", "Unshipped"), ("OrderStatuses", "PartiallyShipped"),
    ]
    # Strategy B: MFN + open statuses (current approach)
    b_params = [
        ("MarketplaceIds", mkt_id), ("CreatedAfter", since60),
        ("OrderStatuses", "Pending"), ("OrderStatuses", "Unshipped"), ("OrderStatuses", "PartiallyShipped"),
        ("FulfillmentChannels", "MFN"),
    ]
    # Strategy C: MFN only, no status filter, last 7 days
    c_params = [
        ("MarketplaceIds", mkt_id), ("LastUpdatedAfter", since7),
        ("FulfillmentChannels", "MFN"),
    ]
    # Strategy D: no filters at all, just last 7 days (broadest possible)
    d_params = [
        ("MarketplaceIds", mkt_id), ("LastUpdatedAfter", since7),
    ]

    _sp = _sp_base(cred.is_sandbox)
    a_raw, b_raw, c_raw, d_raw = await asyncio.gather(
        _amazon_fetch_orders(access_token, a_params, sp_base=_sp),
        _amazon_fetch_orders(access_token, b_params, sp_base=_sp),
        _amazon_fetch_orders(access_token, c_params, sp_base=_sp),
        _amazon_fetch_orders(access_token, d_params, sp_base=_sp),
    )

    return {
        "tenant_id": tenant_id,
        "marketplace": mkt_id,
        "A_open_no_channel_filter":   {"count": len(a_raw), "orders": _summarise(a_raw)},
        "B_open_MFN_only":            {"count": len(b_raw), "orders": _summarise(b_raw)},
        "C_MFN_no_status_7days":      {"count": len(c_raw), "orders": _summarise(c_raw)},
        "D_no_filter_7days":          {"count": len(d_raw), "orders": _summarise(d_raw)},
    }


@app.get("/api/dashboard/repricer-stats")
def get_repricer_stats(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    tid = current.get("tenant_id")
    now = datetime.utcnow()

    # Last 4 weeks of price update counts from repricer_logs
    weekly_updates = []
    for i in range(3, -1, -1):
        week_start = now - timedelta(weeks=i + 1)
        week_end   = now - timedelta(weeks=i)
        _wq = db.query(func.count(models.RepricerLog.id)).filter(
            models.RepricerLog.created_at >= week_start,
            models.RepricerLog.created_at <  week_end,
        )
        if tid:
            _wq = _wq.filter(models.RepricerLog.tenant_id == tid)
        count = _wq.scalar() or 0
        weekly_updates.append({"week_start": week_start.strftime("%b %-d"), "count": count})

    # All-time total price updates from repricer_logs
    _tpu_q = db.query(func.count(models.RepricerLog.id))
    if tid:
        _tpu_q = _tpu_q.filter(models.RepricerLog.tenant_id == tid)
    total_price_updates = _tpu_q.scalar() or 0

    # Buy box % — approved products where aria price <= buy_box (we're competitive)
    _priced_q = db.query(models.Product).filter(
        models.Product.status == "approved",
        models.Product.aria_suggested_price.isnot(None),
        models.Product.buy_box.isnot(None),
        models.Product.buy_box > 0,
    )
    if tid:
        _priced_q = _priced_q.filter(models.Product.tenant_id == tid)
    priced = _priced_q.all()
    competitive = sum(1 for p in priced if p.aria_suggested_price <= p.buy_box)
    buy_box_pct = round(competitive / len(priced) * 100, 1) if priced else 0.0

    # Weekly buy box % (4 weeks — uses current snapshot for all weeks since we don't store history)
    buy_box_by_week = [{"week_start": w["week_start"], "pct": buy_box_pct} for w in weekly_updates]

    # Total price updates pushed (used as a proxy metric in the stats response)
    units_sold = total_price_updates

    return {
        "weekly_updates": weekly_updates,
        "total_price_updates": total_price_updates,
        "buy_box_pct": buy_box_pct,
        "buy_box_by_week": buy_box_by_week,
        "units_sold": units_sold,
    }


# ─── Accounts ─────────────────────────────────────────────────────────────────

@app.get("/api/accounts", response_model=List[schemas.AccountSummary])
def list_accounts(
    search: Optional[str] = None,
    status: Optional[str] = None,
    account_type: Optional[str] = None,
    territory: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    tid = current.get("tenant_id")
    ck = make_key(tid, "accounts", search=search, status=status,
                  account_type=account_type, territory=territory, limit=limit, offset=offset)
    cached = cache_get(ck)
    if cached is not None:
        return cached
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
    result = q.order_by(models.Account.name).offset(offset).limit(min(limit, 1000)).all()
    cache_set(ck, jsonable_encoder(result), ttl=30)
    return result


@app.get("/api/accounts/{account_id}", response_model=schemas.AccountOut)
def get_account(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).options(joinedload(models.Account.contacts)).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    return acc


@app.post("/api/accounts", response_model=schemas.AccountOut, status_code=201)
def create_account(data: schemas.AccountCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    tid = current.get("tenant_id")
    if tid:
        allowed, msg = stripe_billing.check_plan_limit(db, tid, "accounts")
        if not allowed:
            raise HTTPException(status_code=403, detail=msg)
    acc = models.Account(**data.model_dump(), created_by=current["sub"], tenant_id=tid)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    cache_bust(tid, "accounts")
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


def _build_wholesale_email_html(body: str, template_id: str, sender_name: str) -> str:
    """Convert plain-text body (with optional markers) into premium branded HTML."""

    FEATURE_CARDS_HTML = """
<table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
  <tr>
    <td width="50%" style="padding:0 8px 12px 0;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">🛒</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Online storefront reach</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">Active e-commerce presence with a growing, engaged customer base.</p>
      </div>
    </td>
    <td width="50%" style="padding:0 0 12px 8px;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">📦</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Regular reordering</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">We operate on a consistent inventory cycle with reliable wholesale orders.</p>
      </div>
    </td>
  </tr>
  <tr>
    <td width="50%" style="padding:0 8px 0 0;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">📢</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Brand visibility</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">Featured product pages, social promotion, and email campaigns.</p>
      </div>
    </td>
    <td width="50%" style="padding:0 0 0 8px;vertical-align:top;">
      <div style="background:#f9f8f6;border-radius:6px;padding:20px 18px;">
        <p style="margin:0 0 8px;font-size:22px;">🤝</p>
        <p style="margin:0 0 5px;font-weight:700;font-size:13px;color:#0f1729;font-family:-apple-system,sans-serif;">Long-term relationship</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.55;font-family:-apple-system,sans-serif;">We value partners and aim to grow together over time.</p>
      </div>
    </td>
  </tr>
</table>"""

    CTA_HTML = """
<div style="text-align:center;margin:36px 0 8px;">
  <a href="#" style="display:inline-block;background:#0f1729;color:#c9a84c;padding:15px 36px;border-radius:3px;text-decoration:none;font-weight:700;font-size:11px;letter-spacing:2.5px;text-transform:uppercase;font-family:-apple-system,sans-serif;">
    Request a Wholesale Catalog
  </a>
  <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;font-family:-apple-system,sans-serif;">Or reply directly to this email to start the conversation.</p>
</div>"""

    # Process each paragraph
    chunks = []
    for para in body.strip().split("\n\n"):
        stripped = para.strip()
        if stripped == "[FEATURE_CARDS]":
            chunks.append(FEATURE_CARDS_HTML)
        elif stripped == "[CTA]":
            chunks.append(CTA_HTML)
        elif stripped.startswith("[CALLOUT]"):
            text = stripped[9:].strip().replace("\n", "<br>")
            chunks.append(
                f'<div style="border-left:3px solid #c9a84c;background:#faf8f2;padding:16px 20px;'
                f'margin:20px 0;border-radius:0 5px 5px 0;font-size:14px;color:#374151;'
                f'line-height:1.7;font-family:-apple-system,sans-serif;">{text}</div>'
            )
        elif stripped.startswith("[H2]"):
            text = stripped[4:].strip()
            chunks.append(
                f'<h2 style="margin:24px 0 8px;font-size:20px;font-weight:700;color:#0f1729;'
                f'font-family:Georgia,serif;line-height:1.3;">{text}</h2>'
            )
        else:
            # Escape HTML entities, preserve line breaks
            safe = para.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            lines = safe.replace("\n", "<br>")
            chunks.append(
                f'<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#374151;'
                f'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">{lines}</p>'
            )

    body_html = "".join(chunks)
    safe_sender = sender_name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    return f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f3ee;">
<div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10);">

  <!-- Header -->
  <div style="background:#0f1729;padding:44px 32px 36px;text-align:center;">
    <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:400;color:#c9a84c;letter-spacing:3px;">{safe_sender}</h1>
    <p style="margin:10px 0 0;color:#8a9bb5;font-size:10px;letter-spacing:4px;text-transform:uppercase;font-family:-apple-system,sans-serif;">Curated E&#x2011;Commerce &nbsp;&middot;&nbsp; Est. 2024</p>
    <div style="width:48px;height:1px;background:#c9a84c;margin:18px auto 0;"></div>
  </div>

  <!-- Body -->
  <div style="padding:44px 48px 28px;">
    {body_html}
  </div>

  <!-- Signature -->
  <div style="border-top:1px solid #e5e7eb;padding:24px 48px 32px;">
    <p style="margin:0;font-size:13px;color:#6b7280;font-family:-apple-system,sans-serif;line-height:1.7;">
      Warm regards,<br>
      <strong style="color:#0f1729;font-size:14px;">{safe_sender}</strong><br>
      <span style="color:#9ca3af;">{safe_sender} &nbsp;&middot;&nbsp; Curated E-Commerce</span>
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#f9f8f6;padding:14px 48px;border-top:1px solid #ede9e0;">
    <p style="margin:0;font-size:10px;color:#b5b0a8;text-align:center;letter-spacing:1px;font-family:-apple-system,sans-serif;text-transform:uppercase;">
      {safe_sender} &nbsp;&middot;&nbsp; You are receiving this as a direct wholesale inquiry.
    </p>
  </div>

</div>
</body></html>"""


def _build_reply_notification_html(owner_name, account_name, from_email, subject, body_preview,
                                    store_name: str = None):
    safe = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    preview_html = safe(body_preview).replace("\n", "<br>")
    brand = safe(store_name or "SellerPulse")
    app_url = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
    if app_url and not app_url.startswith("http"):
        app_url = f"https://{app_url}"
    cta = (f'<div style="text-align:center;margin-top:24px;">'
           f'<a href="{app_url}/accounts" style="display:inline-block;background:#0f1729;color:#c9a84c;'
           f'padding:12px 28px;border-radius:3px;text-decoration:none;font-weight:700;font-size:11px;'
           f'letter-spacing:2px;text-transform:uppercase;">View in CRM →</a></div>') if app_url else ""
    return f"""<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f3ee;font-family:-apple-system,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
  <div style="background:#0f1729;padding:24px 32px;">
    <h2 style="margin:0;color:#c9a84c;font-family:Georgia,serif;font-size:20px;font-weight:400;">&#128236; New Reply Received</h2>
    <p style="margin:6px 0 0;color:#8a9bb5;font-size:10px;letter-spacing:3px;text-transform:uppercase;">{brand}</p>
  </div>
  <div style="padding:32px;">
    <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi <strong>{safe(owner_name)}</strong>, you have a new reply from <strong>{safe(account_name)}</strong>.</p>
    <div style="background:#f9f8f6;border-left:3px solid #c9a84c;padding:16px 20px;border-radius:0 5px 5px 0;">
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">From</p>
      <p style="margin:0 0 12px;font-size:14px;color:#374151;">{safe(from_email)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Subject</p>
      <p style="margin:0 0 12px;font-size:14px;font-weight:600;color:#0f1729;">{safe(subject)}</p>
      <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Preview</p>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6;">{preview_html}</p>
    </div>
    {cta}
  </div>
  <div style="background:#f9f8f6;padding:14px 32px;border-top:1px solid #ede9e0;">
    <p style="margin:0;font-size:10px;color:#b5b0a8;text-align:center;letter-spacing:1px;text-transform:uppercase;">{brand} · Automated Notification</p>
  </div>
</div></body></html>"""


@app.post("/api/accounts/{account_id}/send-email")
def send_account_email(
    account_id: int,
    data: schemas.AccountEmailSend,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Send a branded wholesale email and log it to the account thread."""
    from notifications import send_email as _send_email, _smtp_configured
    if not _smtp_configured():
        raise HTTPException(status_code=400, detail="Email not configured — add SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST+SMTP_USER+SMTP_PASS in Railway")
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    if not data.to or "@" not in data.to:
        raise HTTPException(status_code=400, detail="Invalid recipient email address")

    sender = data.sender_name or current.get("sub", "SellerPulse")
    html = _build_wholesale_email_html(data.body, data.template_id or "", sender)

    # Set Reply-To to tenant-scoped subaddress so inbound replies route correctly
    _tid = current.get("tenant_id")
    reply_to = _tenant_inbound_email(_tid) if _tid else os.getenv("CRM_INBOUND_EMAIL", "").strip() or None
    custom_headers = {
        "X-Crm-Account-Id": str(account_id),
        "X-Crm-Tenant-Id":  str(_tid or ""),
    }

    # Resolve tenant store name so the From display name shows the seller's brand
    _from_name = None
    if _tid:
        _t_cred = db.query(models.AmazonCredential).filter(
            models.AmazonCredential.tenant_id == _tid
        ).first()
        _t_obj  = db.query(models.Tenant).filter(models.Tenant.id == _tid).first()
        _from_name = (
            (_t_cred.store_name if _t_cred and _t_cred.store_name else None)
            or (_t_obj.name if _t_obj and _t_obj.name.strip().lower() not in ("default", "") else None)
            or os.getenv("STORE_NAME", "").strip()
            or None
        )

    try:
        _send_email(data.to, data.subject, html,
                    reply_to=reply_to, custom_headers=custom_headers,
                    from_name=_from_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Auto-advance pipeline stage based on template
    _stage_map = {
        "intro":       "outreach_sent",
        "followup":    "outreach_sent",   # manual follow-up keeps same bucket
        "catalog":     "catalog_sent",
        "terms":       "catalog_sent",
        "welcome":     "won",
        "new_product": None,              # no stage change for these
        "reorder":     None,
    }
    new_stage = _stage_map.get(data.template_id or "")
    if new_stage and new_stage != acc.pipeline_stage:
        # Only advance forward, never back
        _order = ["new", "outreach_sent", "replied", "catalog_sent", "negotiating", "won"]
        current_idx = _order.index(acc.pipeline_stage) if acc.pipeline_stage in _order else 0
        new_idx = _order.index(new_stage) if new_stage in _order else 0
        if new_idx >= current_idx:
            acc.pipeline_stage = new_stage
            acc.pipeline_updated_at = datetime.utcnow()
            db.commit()

    # Log sent email to thread
    log_entry = models.EmailMessage(
        tenant_id=current.get("tenant_id"),
        account_id=account_id,
        direction="sent",
        from_email=current.get("sub", ""),
        to_email=data.to,
        subject=data.subject,
        body_text=data.body,
        is_read=True,
        sent_by=current.get("sub", ""),
    )
    db.add(log_entry)
    db.commit()

    return {"detail": "Email sent"}


@app.get("/api/accounts/{account_id}/emails")
def get_account_emails(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    msgs = (
        db.query(models.EmailMessage)
        .filter(
            models.EmailMessage.account_id == account_id,
            models.EmailMessage.tenant_id == current.get("tenant_id"),
        )
        .order_by(models.EmailMessage.created_at.asc())
        .all()
    )
    # Auto-mark received messages as read
    for m in msgs:
        if m.direction == "received" and not m.is_read:
            m.is_read = True
    db.commit()
    return [
        {
            "id": m.id,
            "direction": m.direction,
            "from_email": m.from_email,
            "to_email": m.to_email,
            "subject": m.subject,
            "body_text": m.body_text,
            "is_read": m.is_read,
            "sent_by": m.sent_by,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in msgs
    ]


@app.get("/api/accounts/{account_id}/emails/unread-count")
def get_unread_count(account_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    count = db.query(models.EmailMessage).filter(
        models.EmailMessage.account_id == account_id,
        models.EmailMessage.direction == "received",
        models.EmailMessage.is_read == False,
    ).count()
    return {"unread": count}


_STAGE_ORDER = ["new", "outreach_sent", "replied", "catalog_sent", "negotiating", "won", "lost"]


@app.put("/api/accounts/{account_id}/stage")
def update_account_stage(
    account_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Manually set the pipeline stage for an account."""
    stage = (data.get("stage") or "").strip()
    if stage not in _STAGE_ORDER:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {', '.join(_STAGE_ORDER)}")
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    acc.pipeline_stage = stage
    acc.pipeline_updated_at = datetime.utcnow()
    db.commit()
    return {"stage": stage, "pipeline_updated_at": acc.pipeline_updated_at.isoformat()}


@app.post("/api/webhooks/inbound-email")
async def inbound_email_webhook(request: Request, db: Session = Depends(get_db)):
    """
    SendGrid Inbound Parse webhook.
    Configure in SendGrid dashboard → Settings → Inbound Parse.
    Point MX record for your inbound domain to mx.sendgrid.net.
    Set webhook URL to: https://<your-app>/api/webhooks/inbound-email
    Set CRM_INBOUND_EMAIL env var to the address replies should go to.
    """
    import re as _re
    try:
        form = await request.form()
    except Exception:
        return {"status": "error", "detail": "invalid form"}

    from_raw   = form.get("from", "") or ""
    to_raw     = form.get("to", "")   or ""
    subject    = (form.get("subject", "") or "(no subject)").strip()
    body_text  = form.get("text", "") or ""
    body_html  = form.get("html", "") or ""
    headers_raw = form.get("headers", "") or ""

    # Prefer plain text; strip basic HTML if only html provided
    if not body_text and body_html:
        body_text = _re.sub(r'<[^>]+>', '', body_html).strip()
    body_text = body_text[:10000]

    def _extract_addr(s):
        m = _re.search(r'<([^>]+)>', s)
        return (m.group(1) if m else s).strip().lower()

    from_addr = _extract_addr(from_raw)
    to_addr   = _extract_addr(to_raw)

    # ── Resolve tenant from To address subaddressing (crm+t{N}@domain) ──────
    inbound_tenant_id = None
    _sub_match = _re.search(r'\+t(\d+)@', to_addr)
    if _sub_match:
        inbound_tenant_id = int(_sub_match.group(1))

    # Also check X-Crm-Tenant-Id header as fallback
    if not inbound_tenant_id:
        for _hline in headers_raw.splitlines():
            if _hline.lower().startswith("x-crm-tenant-id:"):
                try:
                    inbound_tenant_id = int(_hline.split(":", 1)[1].strip())
                except (ValueError, IndexError):
                    pass
                break

    # ── 1. Look for X-Crm-Account-Id header (set by CRM when sending) ───────
    account_id = None
    for line in headers_raw.splitlines():
        if line.lower().startswith("x-crm-account-id:"):
            try:
                account_id = int(line.split(":", 1)[1].strip())
            except (ValueError, IndexError):
                pass
            break

    # If we have an account_id from header, verify it belongs to the resolved tenant
    if account_id and inbound_tenant_id:
        _verify = db.query(models.Account).filter(
            models.Account.id == account_id,
            models.Account.tenant_id == inbound_tenant_id,
        ).first()
        if not _verify:
            account_id = None   # header mismatch — don't trust it

    # ── 2. Fall back: match from address scoped to the resolved tenant ───────
    if not account_id and from_addr:
        _acc_q = db.query(models.Account).filter(func.lower(models.Account.email) == from_addr)
        if inbound_tenant_id:
            _acc_q = _acc_q.filter(models.Account.tenant_id == inbound_tenant_id)
        acc_match = _acc_q.first()
        if acc_match:
            account_id = acc_match.id
        else:
            _con_q = db.query(models.Contact).filter(func.lower(models.Contact.email) == from_addr)
            if inbound_tenant_id:
                _con_q = _con_q.filter(models.Contact.tenant_id == inbound_tenant_id)
            contact_match = _con_q.first()
            if contact_match:
                account_id = contact_match.account_id

    # Advance pipeline stage to 'replied' when a reply comes in
    if account_id:
        _acc = db.query(models.Account).filter(models.Account.id == account_id).first()
        if _acc and _acc.pipeline_stage not in ("won", "lost", "negotiating", "replied"):
            _acc.pipeline_stage = "replied"
            _acc.pipeline_updated_at = datetime.utcnow()
            # no commit yet — will commit with the message below

    # Store the inbound message (tenant-scoped)
    msg = models.EmailMessage(
        tenant_id=inbound_tenant_id,
        account_id=account_id,
        direction="received",
        from_email=from_raw,
        to_email=to_raw,
        subject=subject,
        body_text=body_text,
        is_read=False,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # Notify the account owner
    if account_id:
        acc = db.query(models.Account).filter(models.Account.id == account_id).first()
        if acc and acc.created_by:
            owner = db.query(models.User).filter(
                models.User.username == acc.created_by
            ).first()
            if owner and owner.email:
                if _smtp_configured():
                    try:
                        # Resolve tenant store name for branded notification email
                        _notif_tid = inbound_tenant_id
                        _notif_store = None
                        if _notif_tid:
                            _nc = db.query(models.AmazonCredential).filter(
                                models.AmazonCredential.tenant_id == _notif_tid
                            ).first()
                            _nt = db.query(models.Tenant).filter(
                                models.Tenant.id == _notif_tid
                            ).first()
                            _notif_store = (
                                (_nc.store_name if _nc and _nc.store_name else None)
                                or (_nt.name if _nt and _nt.name.strip().lower() not in ("default", "") else None)
                                or os.getenv("STORE_NAME", "").strip()
                                or None
                            )
                        notif = _build_reply_notification_html(
                            owner_name=owner.username,
                            account_name=acc.name,
                            from_email=from_raw,
                            subject=subject,
                            body_preview=body_text[:400],
                            store_name=_notif_store,
                        )
                        _send_email_bg(
                            owner.email,
                            f"New reply from {acc.name}: {subject}",
                            notif,
                            from_name=_notif_store,
                        )
                    except Exception:
                        pass  # never fail the webhook

    return {"status": "ok"}


# ─── Contacts ─────────────────────────────────────────────────────────────────

@app.get("/api/contacts", response_model=List[schemas.ContactOut])
def list_contacts(
    account_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    q = db.query(models.Contact)
    q = _filter_owned(q, models.Contact, current)
    if account_id:
        q = q.filter(models.Contact.account_id == account_id)
    return q.order_by(models.Contact.id).offset(offset).limit(min(limit, 1000)).all()


@app.post("/api/contacts", response_model=schemas.ContactOut, status_code=201)
def create_contact(data: schemas.ContactCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    acc = db.query(models.Account).filter(models.Account.id == data.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    _check_owner(acc, current)
    if data.is_primary:
        db.query(models.Contact).filter(models.Contact.account_id == data.account_id).update({"is_primary": False})
    contact = models.Contact(**data.model_dump(), created_by=current["sub"], tenant_id=current.get("tenant_id"))
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
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    tid = current.get("tenant_id")
    ck = make_key(tid, "follow_ups", account_id=account_id, status=status, priority=priority,
                  follow_up_type=follow_up_type, overdue_only=overdue_only, limit=limit, offset=offset)
    cached = cache_get(ck)
    if cached is not None:
        return cached
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
    result = q.order_by(models.FollowUp.due_date.asc()).offset(offset).limit(min(limit, 1000)).all()
    cache_set(ck, jsonable_encoder(result), ttl=30)
    return result


@app.get("/api/follow-ups/{follow_up_id}", response_model=schemas.FollowUpOut)
def get_follow_up(follow_up_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    fu = db.query(models.FollowUp).options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact)).filter(models.FollowUp.id == follow_up_id).first()
    if not fu:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    _check_owner(fu, current)
    return fu


@app.post("/api/follow-ups", response_model=schemas.FollowUpOut, status_code=201)
def create_follow_up(data: schemas.FollowUpCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    fu = models.FollowUp(**data.model_dump(), created_by=current["sub"], tenant_id=current.get("tenant_id"))
    db.add(fu)
    db.commit()
    db.refresh(fu)
    cache_bust(current.get("tenant_id"), "follow_ups")
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
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    tid = current.get("tenant_id")
    ck = make_key(tid, "orders", account_id=account_id, status=status, limit=limit, offset=offset)
    cached = cache_get(ck)
    if cached is not None:
        return cached
    q = db.query(models.Order).options(joinedload(models.Order.account), joinedload(models.Order.items))
    q = _filter_owned(q, models.Order, current)
    if account_id:
        q = q.filter(models.Order.account_id == account_id)
    if status:
        q = q.filter(models.Order.status == status)
    result = q.order_by(models.Order.order_date.desc()).offset(offset).limit(min(limit, 1000)).all()
    cache_set(ck, jsonable_encoder(result), ttl=30)
    return result


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
        import uuid as _uuid
        order_data["order_number"] = f"ORD-{datetime.utcnow().year}-{_uuid.uuid4().hex[:8].upper()}"
    order = models.Order(**order_data, created_by=current["sub"], tenant_id=current.get("tenant_id"))
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
    cache_bust(current.get("tenant_id"), "orders")
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


# ─── Products ─────────────────────────────────────────────────────────────────

@app.get("/api/products", response_model=List[schemas.ProductOut])
def list_products(
    search: Optional[str] = None,
    replenish: Optional[bool] = None,
    ungated: Optional[bool] = None,
    status: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    tid = current.get("tenant_id")
    ck = make_key(tid, "products", search=search, replenish=replenish, ungated=ungated,
                  status=status, limit=limit, offset=offset)
    try:
        cached = cache_get(ck)
        if cached is not None:
            return cached
    except Exception:
        pass
    try:
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
        if status is not None:
            q = q.filter(models.Product.status == status)
        result = q.order_by(models.Product.created_at.desc()).offset(offset).limit(min(limit, 1000)).all()
        log.info("[products] tenant=%s status=%s returned=%d", tid, status, len(result))
        try:
            cache_set(ck, jsonable_encoder(result), ttl=30)
        except Exception:
            pass
        return result
    except Exception as _e:
        import traceback
        print(f"[products] list failed: {_e}\n{traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=500, detail=f"Products query failed: {_e}")


@app.get("/api/products/{product_id}", response_model=schemas.ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    _check_owner(p, current)
    return p


@app.post("/api/products", response_model=schemas.ProductOut, status_code=201)
def create_product(data: schemas.ProductCreate, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    tid = current.get("tenant_id")
    if tid:
        allowed, msg = stripe_billing.check_plan_limit(db, tid, "products")
        if not allowed:
            raise HTTPException(status_code=403, detail=msg)
    p = models.Product(**data.model_dump(), created_by=current["sub"], tenant_id=tid)
    db.add(p)
    db.commit()
    db.refresh(p)
    cache_bust(tid, "products")
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


# ─── Product Approval Workflow ────────────────────────────────────────────────

@app.post("/api/products/{product_id}/submit")
def submit_product_for_approval(
    product_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    _check_owner(p, current)
    p.status = "pending"
    db.commit()
    return {"status": "pending"}


@app.post("/api/products/{product_id}/approve")
def approve_product(
    product_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    _check_owner(p, current)
    p.status = "approved"
    db.commit()
    return {"status": "approved"}


@app.post("/api/products/{product_id}/reject")
def reject_product(
    product_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    _check_owner(p, current)
    p.status = "sourcing"
    db.commit()
    return {"status": "sourcing"}


@app.put("/api/products/{product_id}/strategy")
def set_product_strategy(
    product_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Assign (or clear) a repricer strategy for a single product."""
    p = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not p:
        raise HTTPException(404, "Product not found")
    _check_owner(p, current)
    tid = current.get("tenant_id")
    strategy_id = body.get("strategy_id")  # None to clear
    if strategy_id is not None:
        sq = db.query(models.RepricerStrategy).filter(models.RepricerStrategy.id == strategy_id)
        if tid and not current.get("is_superadmin"):
            sq = sq.filter(models.RepricerStrategy.tenant_id == tid)
        if not sq.first():
            raise HTTPException(404, "Strategy not found")
    p.aria_strategy_id = strategy_id
    db.commit()
    return {"aria_strategy_id": strategy_id}


@app.post("/api/admin/approve-all-sourcing")
def approve_all_sourcing(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    """Move all sourcing products to approved inventory, scoped to the current tenant."""
    tid = current.get("tenant_id")
    q = db.query(models.Product).filter(models.Product.status.in_(["sourcing", None]))
    if tid and not current.get("is_superadmin"):
        q = q.filter(models.Product.tenant_id == tid)
    updated = q.update({"status": "approved"}, synchronize_session=False)
    db.commit()
    return {"approved": updated}


@app.post("/api/admin/fix-products-table")
def fix_products_table(current: dict = Depends(require_superadmin)):
    """Manually create products table if missing — superadmin only."""
    import database as _db_module
    _rengine = getattr(_db_module, '_read_engine', engine)
    _ensure_products_table()
    result = {}
    for _label, _eng in [("primary", engine), ("replica", _rengine)]:
        try:
            with _eng.connect() as _c:
                sp = _c.execute(text("SHOW search_path")).scalar()
                rows = _c.execute(text(
                    "SELECT table_schema FROM information_schema.tables WHERE table_name='products'"
                )).fetchall()
                schemas = [r[0] for r in rows]
                count = _c.execute(text("SELECT COUNT(*) FROM public.products")).scalar() if schemas else None
            result[_label] = {"search_path": sp, "schemas": schemas, "count": count}
        except Exception as _e:
            result[_label] = {"error": str(_e)}
    result["same_engine"] = id(engine) == id(_rengine)
    return result


@app.get("/api/admin/products-debug")
def products_debug(current: dict = Depends(require_superadmin)):
    """Raw SQL diagnostic: what's actually in public.products — superadmin only."""
    try:
        with engine.connect() as _c:
            total = _c.execute(text("SELECT COUNT(*) FROM public.products")).scalar()
            by_tenant = _c.execute(text(
                "SELECT tenant_id, status, COUNT(*) as n, SUM(quantity) as qty "
                "FROM public.products GROUP BY tenant_id, status ORDER BY tenant_id, status"
            )).fetchall()
            sample = _c.execute(text(
                "SELECT id, tenant_id, asin, status, quantity, fulfillment_channel, created_by "
                "FROM public.products ORDER BY id DESC LIMIT 5"
            )).fetchall()
        return {
            "total_rows": total,
            "by_tenant_status": [{"tenant_id": r[0], "status": r[1], "count": r[2], "total_qty": r[3]} for r in by_tenant],
            "sample_rows": [{"id": r[0], "tenant_id": r[1], "asin": r[2], "status": r[3], "quantity": r[4], "channel": r[5], "created_by": r[6]} for r in sample],
            "current_user_tenant_id": current.get("tenant_id"),
        }
    except Exception as e:
        raise HTTPException(500, detail=str(e))


@app.post("/api/admin/purge-system-products")
async def purge_system_products(db: Session = Depends(get_db), current: dict = Depends(require_admin)):
    """
    Delete ALL Amazon-synced products for the current tenant so the next FBA
    sync re-imports them cleanly from the tenant's own credentials.

    Catches three cases from the Josh credential-hijack incident:
      1. Products created fresh by the wrong sync (created_by='system', tenant_id=tid)
      2. Same as above but synced in legacy mode (tenant_id=NULL, created_by='system')
      3. Products that already existed and had their quantity overwritten by the wrong sync
         — identified by: has an ASIN, status='approved', and no purchase date or buy cost
           (i.e. looks like a raw FBA import, not a product Antonio sourced and approved manually)
    """
    from sqlalchemy import or_, and_
    tid = current.get("tenant_id")
    if not tid:
        raise HTTPException(400, "No tenant_id in token — cannot purge")

    # Case 1 & 2: explicitly created by sync scheduler
    deleted_system = db.query(models.Product).filter(
        or_(models.Product.tenant_id == tid, models.Product.tenant_id.is_(None)),
        models.Product.created_by == "system",
    ).delete(synchronize_session=False)

    # Case 3: products with an ASIN and no sourcing data — pure FBA/FBM imports
    # Safe guard: only delete if they have no buy_cost, no date_purchased, no supplier link
    # (manually sourced products always have at least one of these)
    deleted_fba = db.query(models.Product).filter(
        models.Product.tenant_id == tid,
        models.Product.created_by != "system",   # already handled above
        models.Product.asin.isnot(None),
        models.Product.asin != "",
        models.Product.status == "approved",
        models.Product.buy_cost.is_(None),
        models.Product.date_purchased.is_(None),
        models.Product.purchase_link.is_(None),
    ).delete(synchronize_session=False)
    # Also clean up any null-tenant FBM products that slipped through
    db.query(models.Product).filter(
        models.Product.tenant_id.is_(None),
        models.Product.created_by == "system",
        models.Product.fulfillment_channel == "FBM",
    ).delete(synchronize_session=False)

    db.commit()
    deleted = deleted_system + deleted_fba

    # Trigger a fresh sync for this tenant
    import amazon_sync
    sync_result = None
    if amazon_sync.configured(tid):
        try:
            sync_result = await amazon_sync.run_sync(tid)
        except Exception as e:
            sync_result = {"error": str(e)}
    return {
        "purged": deleted,
        "purged_system": deleted_system,
        "purged_fba": deleted_fba,
        "sync_triggered": sync_result is not None,
        "sync_result": sync_result,
    }


# ─── Keepa Integration ────────────────────────────────────────────────────────

_KEEPA_DOMAIN = int(os.getenv("KEEPA_DOMAIN", "1"))   # 1 = US marketplace


def _keepa_buy_box(kp: dict):
    """
    Extract the current buy box price from a Keepa product object.

    Keepa data types used (all prices stored as integer cents, divide by 100):
      0 = AMAZON (Amazon's own listing)
      1 = MARKETPLACE_NEW (lowest new — any fulfillment)
      7 = NEW_FBA (FBA buy box winner)

    Strategy:
    1. Try stats.current[7] → stats.current[1] → stats.current[0]
    2. Fall back to csv history arrays (last valid price) for the same order
    """
    stats  = kp.get("stats") or {}
    cur    = stats.get("current") or []
    csv    = kp.get("csv") or []

    def _from_cur(idx):
        if idx < len(cur) and cur[idx] is not None and cur[idx] > 0:
            return round(cur[idx] / 100, 2)
        return None

    def _from_csv(idx):
        if idx < len(csv) and csv[idx]:
            hist = csv[idx]  # [time, price, time, price, …]
            # walk backwards to find last valid (positive) price
            i = len(hist) - 1
            while i >= 1:
                price = hist[i]
                if price is not None and price > 0:
                    return round(price / 100, 2)
                i -= 2
        return None

    # Try stats.current first, then csv fallback — both with the same priority order
    for idx in (7, 1, 0):
        v = _from_cur(idx)
        if v is not None:
            return v
    for idx in (7, 1, 0):
        v = _from_csv(idx)
        if v is not None:
            return v
    return None


def _keepa_fba_fees(kp: dict, buy_box_price: float | None):
    """
    Extract FBA fulfillment fee from Keepa fbaFees object and compute
    referral fee (15% of buy box — standard rate for most categories).
    Returns (fba_fulfillment, referral, combined) or (None, None, None).
    """
    fba_data = kp.get("fbaFees") or {}
    raw = fba_data.get("pickAndPackFee")
    fulfillment = round(raw / 100, 2) if raw and raw > 0 else None

    if buy_box_price and buy_box_price > 0:
        referral = round(buy_box_price * 0.15, 2)
    else:
        referral = None

    if fulfillment is not None and referral is not None:
        combined = round(fulfillment + referral, 2)
    else:
        combined = None

    return fulfillment, referral, combined


def _parse_keepa_product(kp: dict, product) -> None:
    """Write Keepa API data into a Product ORM instance (no commit)."""
    from datetime import timezone as _tz
    stats = kp.get("stats") or {}
    current = stats.get("current") or []

    def _rank(idx: int):
        if idx < len(current):
            v = current[idx]
            if v is not None and v > 0:
                return int(v)
        return None

    # Buy Box — use robust multi-fallback helper
    bb = _keepa_buy_box(kp)
    if bb is not None:
        product.buy_box = bb

    # FBA fee (fulfillment + 15% referral)
    _, _, combined_fee = _keepa_fba_fees(kp, bb)
    if combined_fee is not None:
        product.amazon_fee = combined_fee

    bsr = _rank(3)
    if bsr is not None:
        product.keepa_bsr = bsr

    # Category — use deepest node in tree
    cat_tree = kp.get("categoryTree") or []
    if cat_tree:
        product.keepa_category = (cat_tree[-1].get("name") or cat_tree[0].get("name") or "").strip() or None

    # Seller count
    new_count = kp.get("newCount")
    if new_count is not None and new_count >= 0:
        product.num_sellers = new_count

    # Estimated monthly sales
    monthly_sold = kp.get("monthlySold")
    if monthly_sold is not None and monthly_sold >= 0:
        product.estimated_sales = float(monthly_sold)

    # 90-day price stats — stored so they survive Keepa token exhaustion
    def _pc(idx, arr):
        if arr and idx < len(arr) and arr[idx] is not None and arr[idx] > 0:
            return round(arr[idx] / 100.0, 2)
        return None

    min90 = stats.get("min90") or []
    max90 = stats.get("max90") or []
    avg90 = stats.get("avg90") or []
    csv   = kp.get("csv") or []

    # Overall 90-day range from FBA price history
    fba_csv = (csv[7] if len(csv) > 7 else None) or []  # csv[7] can be null in Keepa response
    _prices = []
    i = 0
    while i + 1 < len(fba_csv):
        p = fba_csv[i + 1]
        if p is not None and 0 < p < 1_000_000:
            _prices.append(round(p / 100.0, 2))
        i += 2
    if _prices:
        product.price_90_high = round(max(_prices), 2)
        product.price_90_low  = round(min(_prices), 2)
    else:
        product.price_90_high = _pc(7, max90) or _pc(1, max90)
        product.price_90_low  = _pc(7, min90) or _pc(1, min90)
    product.price_90_median = _pc(7, avg90) or _pc(1, avg90)

    product.fba_low    = _pc(7, min90) or _pc(11, min90)
    product.fba_high   = _pc(7, max90) or _pc(11, max90)
    product.fba_median = _pc(7, avg90) or _pc(11, avg90)
    product.fbm_low    = _pc(12, min90)
    product.fbm_high   = _pc(12, max90)
    product.fbm_median = _pc(12, avg90)

    product.keepa_last_synced = datetime.now(_tz.utc)


def _keepa_configured() -> bool:
    return bool(os.getenv("KEEPA_API_KEY", "").strip())


async def _keepa_fetch_single(asin: str):
    """Fetch Keepa data for one ASIN. Returns the product dict or None."""
    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        return None
    url = f"https://api.keepa.com/product?key={api_key}&domain={_KEEPA_DOMAIN}&asin={asin}&stats=90"
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)
    if resp.status_code != 200:
        return None
    data = resp.json()
    if data.get("error"):
        return None
    products_data = data.get("products") or []
    return products_data[0] if products_data else None


@app.get("/api/keepa/status")
def keepa_status_endpoint(current: dict = Depends(require_auth)):
    return {"configured": _keepa_configured()}


@app.get("/api/keepa/lookup/{asin}")
async def keepa_lookup(asin: str, current: dict = Depends(require_auth), db: Session = Depends(get_db)):
    """Fetch rich Keepa data for a single ASIN — FBA/FBM prices, seller counts, price history."""
    asin = asin.strip().upper()
    if len(asin) != 10:
        raise HTTPException(400, "ASIN must be 10 characters")

    # ── Always pull live offer data from Amazon SP-API (no Keepa tokens needed) ─
    import asyncio as _asyncio
    from datetime import timezone as _tz
    _chart_url = f"https://graph.keepa.com/pricehistory.png?asin={asin}&domain=1&salesrank=1&bb=1&new=1&fbafba=1&range=90"
    _tenant_id = current.get("tenant_id", 1)

    async def _sp_data():
        """
        Fetch from Amazon SP-API:
          1. Offer counts + buy box (competitive pricing)
          2. Product title + category (catalog items)
        Returns a dict to merge into the response. Never raises.
        """
        try:
            import httpx as _hx
            _cred = _get_tenant_amazon_creds(_tenant_id, db)
            if not _cred or not _cred.sp_refresh_token:
                _missing = [k for k in ("AMAZON_LWA_CLIENT_ID","AMAZON_LWA_CLIENT_SECRET","AMAZON_SP_REFRESH_TOKEN","AMAZON_SELLER_ID") if not os.getenv(k,"").strip()]
                print(f"[sp_data] no creds tenant={_tenant_id} db_record={_cred is not None} refresh_token={bool(_cred and _cred.sp_refresh_token)} missing_env={_missing}", flush=True)
                return {}
            _tok  = await _get_tenant_access_token(_cred)
            _mkt  = _cred.marketplace_id or _AMAZON_MKT_ID
            _base = _sp_base(_cred.is_sandbox)
            result = {}

            async with _hx.AsyncClient(timeout=12) as _c:
                # Offer counts + buy box
                _or = await _c.get(
                    f"{_base}/products/pricing/v0/items/{asin}/offers",
                    headers={"x-amz-access-token": _tok},
                    params={"MarketplaceId": _mkt, "ItemCondition": "New", "CustomerType": "Consumer"},
                )
                print(f"[sp_data] offers status={_or.status_code} asin={asin}", flush=True)
                if _or.status_code == 200:
                    _payload_data = _or.json().get("payload", {})
                    _summary      = _payload_data.get("Summary", {})
                    _offers_list  = _payload_data.get("Offers", [])
                    _num_fba = _num_fbm = 0
                    for _o in (_summary.get("NumberOfOffers") or []):
                        if (_o.get("condition") or "").lower() == "new":
                            if _o.get("fulfillmentChannel") == "Amazon":
                                _num_fba = _o.get("OfferCount", 0)
                            elif _o.get("fulfillmentChannel") == "Merchant":
                                _num_fbm = _o.get("OfferCount", 0)
                    result.update({
                        "num_fba_sellers": _num_fba,
                        "num_fbm_sellers": _num_fbm,
                        "offers_available": True,
                    })

                    # Buy box: primary source = individual offer with IsBuyBoxWinner
                    for _off in _offers_list:
                        if _off.get("IsBuyBoxWinner"):
                            _lp  = (_off.get("ListingPrice") or {}).get("Amount") or 0
                            _shp = (_off.get("Shipping") or {}).get("Amount") or 0
                            _bb  = float(_lp) + float(_shp)
                            if _bb > 0:
                                result["buy_box"] = round(_bb, 2)
                            break

                    # Buy box: fallback = BuyBoxPrices in Summary
                    if "buy_box" not in result:
                        for _bb_entry in (_summary.get("BuyBoxPrices") or []):
                            if (_bb_entry.get("condition") or "").lower() == "new":
                                _landed = (_bb_entry.get("LandedPrice") or _bb_entry.get("ListingPrice") or {})
                                _amt    = float(_landed.get("Amount") or 0)
                                if _amt > 0:
                                    result["buy_box"] = round(_amt, 2)
                                    break

                    # Buy box: last fallback = LowestPrices in Summary
                    if "buy_box" not in result:
                        for _lp_entry in (_summary.get("LowestPrices") or []):
                            if ((_lp_entry.get("condition") or "").lower() == "new"
                                    and (_lp_entry.get("fulfillmentChannel") or "") == "Amazon"):
                                _landed = (_lp_entry.get("LandedPrice") or _lp_entry.get("ListingPrice") or {})
                                _amt    = float(_landed.get("Amount") or 0)
                                if _amt > 0:
                                    result["buy_box"] = round(_amt, 2)
                                    break

                # Amazon FBA fee via Fees API (uses buy box price as listing price)
                if result.get("buy_box"):
                    try:
                        _fr = await _c.post(
                            f"{_base}/products/fees/v0/items/{asin}/feesEstimate",
                            headers={"x-amz-access-token": _tok, "Content-Type": "application/json"},
                            json={
                                "FeesEstimateRequest": {
                                    "MarketplaceId":        _mkt,
                                    "IsAmazonFulfilled":    True,
                                    "PriceToEstimateFees": {
                                        "ListingPrice": {"CurrencyCode": "USD", "Amount": result["buy_box"]},
                                        "Shipping":     {"CurrencyCode": "USD", "Amount": 0},
                                    },
                                    "Identifier": asin,
                                    "OptionalFulfillmentProgram": "FBA_CORE",
                                }
                            },
                        )
                        if _fr.status_code == 200:
                            _fee_result = (_fr.json()
                                           .get("payload", {})
                                           .get("FeesEstimateResult", {}))
                            _fee_est    = _fee_result.get("FeesEstimate", {})
                            _total_fee  = float((_fee_est.get("TotalFeesEstimate") or {}).get("Amount") or 0)
                            if _total_fee > 0:
                                result["amazon_fee"] = round(_total_fee, 2)
                                # Break out individual components if available
                                for _comp in (_fee_est.get("FeeDetailList") or []):
                                    _fname = (_comp.get("FeeType") or "").lower()
                                    _famt  = float((_comp.get("FinalFee") or {}).get("Amount") or 0)
                                    if "fulfillment" in _fname and _famt > 0:
                                        result["fba_fulfillment_fee"] = round(_famt, 2)
                                    elif "referral" in _fname and _famt > 0:
                                        result["referral_fee"] = round(_famt, 2)
                    except Exception:
                        pass  # fee lookup is best-effort

                # Product title + category from Catalog API
                _cr = await _c.get(
                    f"{_base}/catalog/2022-04-01/items/{asin}",
                    headers={"x-amz-access-token": _tok},
                    params={"marketplaceIds": _mkt, "includedData": "summaries,salesRanks"},
                )
                if _cr.status_code == 200:
                    _item = _cr.json()
                    _summaries = (_item.get("summaries") or [{}])[0]
                    _title = _summaries.get("itemName") or _summaries.get("productTitle") or ""
                    if _title:
                        result["title"] = _title
                    _ranks = _item.get("salesRanks") or []
                    if _ranks:
                        _rank_entry = _ranks[0]
                        result["bsr"] = (_rank_entry.get("ranks") or [{}])[0].get("value")
                        result["category"] = _rank_entry.get("displayGroupName") or ""

            print(f"[sp_data] success keys={list(result.keys())} asin={asin}", flush=True)
            return result
        except Exception as _e:
            print(f"[sp_data] FAILED asin={asin} error={_e}", flush=True)
            return {}

    # ── Run SP-API + Keepa concurrently (saves ~2-3s vs sequential) ─────────────
    _keepa_api_key = os.getenv("KEEPA_API_KEY", "").strip()

    async def _keepa_raw():
        """Fetch raw Keepa product JSON. Returns {} on any error or rate-limit."""
        if not _keepa_api_key:
            return {}
        try:
            import httpx as _hk
            async with _hk.AsyncClient(timeout=6) as _kc:
                _kr = await _kc.get(
                    "https://api.keepa.com/product",
                    params={"key": _keepa_api_key, "domain": _KEEPA_DOMAIN,
                            "asin": asin, "stats": "90", "offers": "20"},
                )
            if _kr.status_code != 200:
                return {}
            _kd = _kr.json()
            if ((_kd.get("tokensLeft") or 1) < 0) or _kd.get("error"):
                return {}
            return _kd
        except Exception:
            return {}

    _live, _keepa_concurrent = await _asyncio.gather(_sp_data(), _keepa_raw())

    def _base_resp(title="", buy_box=None, amazon_fee=None, bsr=None, category="",
                   estimated_sales=None, num_sellers=None,
                   price_90_high=None, price_90_low=None, price_90_median=None,
                   fba_low=None, fba_high=None, fba_median=None,
                   fbm_low=None, fbm_high=None, fbm_median=None):
        r = {
            "asin":                asin,
            "title":               title,
            "amazon_url":          f"https://www.amazon.com/dp/{asin}",
            "buy_box":             buy_box,
            "amazon_fee":          amazon_fee,
            "fba_fulfillment_fee": None,
            "referral_fee":        None,
            "num_sellers":         num_sellers,
            "num_fba_sellers":     None,
            "num_fbm_sellers":     None,
            "offers_available":    False,
            "bsr":                 bsr,
            "category":            category,
            "estimated_sales":     estimated_sales,
            "fba_low": fba_low, "fba_high": fba_high, "fba_median": fba_median,
            "fbm_low": fbm_low, "fbm_high": fbm_high, "fbm_median": fbm_median,
            "price_90_high":  price_90_high,
            "price_90_low":   price_90_low,
            "median_price":   price_90_median,
            "fba_history": [], "fbm_history": [], "bsr_history": [],
            "keepa_chart_url": _chart_url,
        }
        r.update(_live)   # always overlay live SP-API data
        return r

    # ── DB cache tier 1: fresh Keepa sync (< 24h) — skip live Keepa call ────────
    _cache_cutoff = datetime.now(_tz.utc) - timedelta(hours=24)
    _fresh = (
        db.query(models.Product)
        .filter(models.Product.asin == asin,
                models.Product.keepa_last_synced >= _cache_cutoff)
        .order_by(models.Product.keepa_last_synced.desc())
        .first()
    )
    if _fresh:
        return _base_resp(
            title=_fresh.product_name or "", buy_box=_fresh.buy_box or None,
            amazon_fee=_fresh.amazon_fee or None, bsr=_fresh.keepa_bsr or None,
            category=_fresh.keepa_category or "", estimated_sales=_fresh.estimated_sales or None,
            num_sellers=_fresh.num_sellers or None,
            price_90_high=_fresh.price_90_high, price_90_low=_fresh.price_90_low,
            price_90_median=_fresh.price_90_median,
            fba_low=_fresh.fba_low, fba_high=_fresh.fba_high, fba_median=_fresh.fba_median,
            fbm_low=_fresh.fbm_low, fbm_high=_fresh.fbm_high, fbm_median=_fresh.fbm_median,
        )

    # ── Live Keepa: parse concurrently-fetched data (priority over stale DB) ──
    # DB tier-2 (ASIN in DB but unenriched) is intentionally BELOW this so that
    # a fresh live Keepa response is never discarded in favour of null DB fields.
    products_data = (_keepa_concurrent.get("products") or []) if _keepa_concurrent else []

    # ── DB cache tier 2: fallback when Keepa unavailable ─────────────────────
    if not products_data:
        _any = (
            db.query(models.Product)
            .filter(models.Product.asin == asin)
            .order_by(models.Product.updated_at.desc().nullslast())
            .first()
        )
        if _any:
            return _base_resp(
                title=_any.product_name or "", buy_box=_any.buy_box or None,
                amazon_fee=_any.amazon_fee or None, bsr=_any.keepa_bsr or None,
                category=_any.keepa_category or "", estimated_sales=_any.estimated_sales or None,
                num_sellers=_any.num_sellers or None,
                price_90_high=_any.price_90_high, price_90_low=_any.price_90_low,
                price_90_median=_any.price_90_median,
                fba_low=_any.fba_low, fba_high=_any.fba_high, fba_median=_any.fba_median,
                fbm_low=_any.fbm_low, fbm_high=_any.fbm_high, fbm_median=_any.fbm_median,
            )
        # No DB record + no Keepa → return SP-API data only (sellers, buy box, fee)
        return _base_resp()

    kp = products_data[0]
    stats = kp.get("stats") or {}
    cur    = stats.get("current") or []
    min90  = stats.get("min90")   or []
    max90  = stats.get("max90")   or []
    avg90  = stats.get("avg90")   or []

    def _p(idx, arr):
        """Price cents → dollars, or None."""
        if idx < len(arr) and arr[idx] is not None and arr[idx] > 0:
            return round(arr[idx] / 100, 2)
        return None

    # Category
    cat_tree = kp.get("categoryTree") or []
    category = (cat_tree[-1].get("name") or cat_tree[0].get("name") or "").strip() if cat_tree else ""

    buy_box_price = _keepa_buy_box(kp)
    fba_fulfillment, referral_fee, amazon_fee = _keepa_fba_fees(kp, buy_box_price)

    # ── FBA / FBM offer breakdown ──────────────────────────────────────────────
    # Keepa condition codes: 0=New, 1=Used-LikeNew, 2=Used-VeryGood, ...
    offers = kp.get("offers") or []
    fba_prices = []
    fbm_prices = []
    num_fba = 0
    num_fbm = 0
    for o in offers:
        is_fba = bool(o.get("isFBA"))
        cond = o.get("condition")
        # Count all offers for FBA/FBM totals (some Keepa accounts omit condition)
        if is_fba:
            num_fba += 1
        else:
            num_fbm += 1
        # Only collect prices for new condition (0=New)
        if cond != 0:
            continue
        price_cents = o.get("price") or 0
        if price_cents > 0:
            price_dollars = round(price_cents / 100, 2)
            if is_fba:
                fba_prices.append(price_dollars)
            else:
                fbm_prices.append(price_dollars)

    def _range(prices):
        if not prices:
            return None, None, None
        s = sorted(prices)
        mid = len(s) // 2
        median = (s[mid - 1] + s[mid]) / 2 if len(s) % 2 == 0 else s[mid]
        return round(min(s), 2), round(max(s), 2), round(median, 2)

    fba_low, fba_high, fba_median = _range(fba_prices)
    fbm_low, fbm_high, fbm_median = _range(fbm_prices)

    # Fall back to stats arrays when no offer data
    if fba_low is None:
        fba_low  = _p(7, min90) or _p(11, min90)
        fba_high = _p(7, max90) or _p(11, max90)
        fba_median = _p(7, avg90) or _p(11, avg90)
    if fbm_low is None:
        fbm_low  = _p(12, min90)
        fbm_high = _p(12, max90)
        fbm_median = _p(12, avg90)

    # ── Price history chart (csv[7] = FBA buy box, csv[12] = FBM) ────────────
    _KEEPA_EPOCH = datetime(2011, 1, 1)

    def _csv_to_points(csv_arr, max_pts=50):
        points = []
        if not csv_arr:
            return points
        i = 0
        while i + 1 < len(csv_arr):
            t, p = csv_arr[i], csv_arr[i + 1]
            if t is not None and p is not None and 0 < p < 1_000_000:  # 0–$9,999 sanity cap
                dt = _KEEPA_EPOCH + timedelta(minutes=int(t))
                points.append({"date": dt.strftime("%b %-d"), "price": round(p / 100, 2)})
            i += 2
        return points[-max_pts:]

    csv = kp.get("csv") or []
    fba_history = _csv_to_points(csv[7]  if len(csv) > 7  else [])
    fbm_history = _csv_to_points(csv[12] if len(csv) > 12 else [])
    # BSR history
    bsr_history_raw = csv[3] if len(csv) > 3 else []
    bsr_points = []
    i = 0
    while i + 1 < len(bsr_history_raw):
        t, r = bsr_history_raw[i], bsr_history_raw[i + 1]
        if t is not None and r is not None and r > 0:
            dt = _KEEPA_EPOCH + timedelta(minutes=int(t))
            bsr_points.append({"date": dt.strftime("%b %-d"), "rank": int(r)})
        i += 2
    bsr_history = bsr_points[-50:]

    # Overall 90-day stats — derive high/low from fba_history (same data as chart)
    overall_median  = _p(7, avg90) or _p(1, avg90)
    if fba_history:
        _hist_prices    = [p["price"] for p in fba_history]
        overall_90_high = round(max(_hist_prices), 2)
        overall_90_low  = round(min(_hist_prices), 2)
    else:
        overall_90_high = _p(7, max90) or _p(1, max90)
        overall_90_low  = _p(7, min90) or _p(1, min90)

    # ── Amazon SP-API offer counts (FBA vs FBM) ────────────────────────────────
    # Overrides Keepa offer counts which are limited to 20 and require a paid plan
    sp_fba = num_fba if offers else None
    sp_fbm = num_fbm if offers else None
    sp_total = None
    if _amazon_sp_configured():
        try:
            sp_token = await _get_amazon_access_token()
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=15) as _c:
                _r = await _c.get(
                    f"{_AMAZON_SP_BASE}/products/pricing/v0/items/{asin}/offers",
                    headers={"x-amz-access-token": sp_token},
                    params={
                        "MarketplaceId": _AMAZON_MKT_ID,
                        "ItemCondition": "New",
                        "CustomerType":  "Consumer",
                    },
                )
            if _r.status_code == 200:
                _summary = (_r.json().get("payload") or {}).get("Summary") or {}
                _num_offers = _summary.get("NumberOfOffers") or []
                sp_fba = next(
                    (o["OfferCount"] for o in _num_offers
                     if o.get("fulfillmentChannel") == "Amazon" and o.get("condition") == "new"),
                    0,
                )
                sp_fbm = next(
                    (o["OfferCount"] for o in _num_offers
                     if o.get("fulfillmentChannel") == "Merchant" and o.get("condition") == "new"),
                    0,
                )
                sp_total = _summary.get("TotalOfferCount")
        except Exception:
            pass  # Fall back to Keepa offer counts

    _keepa_resp = {
        "asin":              asin,
        "title":             (kp.get("title") or "").strip(),
        "buy_box":           buy_box_price,
        "bsr":               _p(3, cur) and int(_p(3, cur)) if _p(3, cur) else None,
        "category":          category,
        "amazon_url":        f"https://www.amazon.com/dp/{asin}",
        "num_sellers":       sp_total or kp.get("newCount"),
        "num_fba_sellers":   sp_fba,
        "num_fbm_sellers":   sp_fbm,
        "offers_available":  sp_fba is not None or len(offers) > 0,
        "estimated_sales":   kp.get("monthlySold"),
        "fba_fulfillment_fee": fba_fulfillment,
        "referral_fee":      referral_fee,
        "amazon_fee":        amazon_fee,
        "tokens_left":       (_keepa_concurrent or {}).get("tokensLeft"),
        "fba_low":           fba_low,
        "fba_high":          fba_high,
        "fba_median":        fba_median,
        "fbm_low":           fbm_low,
        "fbm_high":          fbm_high,
        "fbm_median":        fbm_median,
        "median_price":      overall_median,
        "price_90_high":     overall_90_high,
        "price_90_low":      overall_90_low,
        "fba_history":       fba_history,
        "fbm_history":       fbm_history,
        "bsr_history":       bsr_history,
        "keepa_chart_url":   _chart_url,
    }
    # _live SP-API data already fetched — only fill in gaps Keepa didn't cover
    for _k, _v in _live.items():
        if _keepa_resp.get(_k) is None:
            _keepa_resp[_k] = _v
    return _keepa_resp


@app.get("/api/keepa/upc/{code}")
async def keepa_upc_lookup(code: str, current: dict = Depends(require_auth)):
    """Look up product(s) by UPC / EAN / ISBN via Keepa."""
    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not configured")

    code = code.strip()
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://api.keepa.com/product",
            params={"key": api_key, "domain": _KEEPA_DOMAIN, "code": code, "stats": 90, "offers": 20},
        )

    if resp.status_code != 200:
        raise HTTPException(503, "Keepa data temporarily unavailable")

    data = resp.json()
    if (data.get("tokensLeft") or 1) < 0 or data.get("error"):
        raise HTTPException(503, "Keepa data temporarily unavailable")

    products_data = data.get("products") or []
    if not products_data:
        raise HTTPException(404, f"No products found for code {code}")

    _KEEPA_EPOCH_UPC = datetime(2011, 1, 1)

    def _process(kp):
        stats  = kp.get("stats") or {}
        cur    = stats.get("current") or []
        min90  = stats.get("min90")   or []
        max90  = stats.get("max90")   or []
        avg90  = stats.get("avg90")   or []

        def _p(idx, arr):
            if idx < len(arr) and arr[idx] is not None and arr[idx] > 0:
                return round(arr[idx] / 100, 2)
            return None

        asin = kp.get("asin", "")
        cat_tree = kp.get("categoryTree") or []
        category = (cat_tree[-1].get("name") or cat_tree[0].get("name") or "").strip() if cat_tree else ""

        buy_box_price = _keepa_buy_box(kp)

        # FBA / FBM offer breakdown
        offers = kp.get("offers") or []
        num_fba, num_fbm = 0, 0
        fba_prices, fbm_prices = [], []
        for o in offers:
            is_fba = bool(o.get("isFBA"))
            cond   = o.get("condition")
            if is_fba: num_fba += 1
            else:      num_fbm += 1
            if cond != 0:
                continue
            price_cents = o.get("price") or 0
            if price_cents > 0:
                p_d = round(price_cents / 100, 2)
                (fba_prices if is_fba else fbm_prices).append(p_d)

        def _range(prices):
            if not prices: return None, None, None
            s = sorted(prices)
            mid = len(s) // 2
            med = (s[mid-1]+s[mid])/2 if len(s)%2==0 else s[mid]
            return round(min(s),2), round(max(s),2), round(med,2)

        fba_low, fba_high, fba_median = _range(fba_prices)
        fbm_low, fbm_high, fbm_median = _range(fbm_prices)
        if fba_low is None:
            fba_low, fba_high, fba_median = _p(7,min90) or _p(11,min90), _p(7,max90) or _p(11,max90), _p(7,avg90) or _p(11,avg90)
        if fbm_low is None:
            fbm_low, fbm_high, fbm_median = _p(12,min90), _p(12,max90), _p(12,avg90)

        # Price history
        def _csv_to_pts(csv_arr, max_pts=50):
            pts, i = [], 0
            while i + 1 < len(csv_arr):
                t, p = csv_arr[i], csv_arr[i+1]
                if t is not None and p is not None and 0 < p < 1_000_000:
                    dt = _KEEPA_EPOCH_UPC + timedelta(minutes=int(t))
                    pts.append({"date": dt.strftime("%b %-d"), "price": round(p/100, 2)})
                i += 2
            return pts[-max_pts:]

        csv = kp.get("csv") or []
        fba_history = _csv_to_pts(csv[7] if len(csv) > 7 else [])

        overall_median  = _p(7, avg90) or _p(1, avg90)
        if fba_history:
            _hp = [p["price"] for p in fba_history]
            overall_90_high = round(max(_hp), 2)
            overall_90_low  = round(min(_hp), 2)
        else:
            overall_90_high = _p(7, max90) or _p(1, max90)
            overall_90_low  = _p(7, min90) or _p(1, min90)

        bsr_val = None
        if len(cur) > 3 and cur[3] is not None and cur[3] > 0:
            bsr_val = int(cur[3])

        return {
            "asin":            asin,
            "title":           (kp.get("title") or "").strip(),
            "buy_box":         buy_box_price,
            "bsr":             bsr_val,
            "category":        category,
            "amazon_url":      f"https://www.amazon.com/dp/{asin}",
            "keepa_chart_url": f"https://graph.keepa.com/pricehistory.png?asin={asin}&domain=1&salesrank=1&bb=1&fbafba=1&range=90",
            "num_fba_sellers": num_fba if offers else None,
            "num_fbm_sellers": num_fbm if offers else None,
            "median_price":    overall_median,
            "price_90_high":   overall_90_high,
            "price_90_low":    overall_90_low,
            "fba_low":         fba_low,
            "fba_high":        fba_high,
            "fba_median":      fba_median,
            "fbm_low":         fbm_low,
            "fbm_high":        fbm_high,
            "fbm_median":      fbm_median,
        }

    return {
        "products":    [_process(kp) for kp in products_data],
        "tokens_left": data.get("tokensLeft"),
    }


@app.post("/api/keepa/batch")
async def keepa_batch_lookup(body: dict, current: dict = Depends(require_auth)):
    """Batch lookup of ASINs or UPC/EAN/GTIN codes — up to 100 per Keepa API call."""
    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not configured")

    mode = body.get("mode", "asin")   # "asin" | "upc"
    raw  = body.get("codes") or []
    if mode == "asin":
        codes = list(dict.fromkeys(str(c).strip().upper() for c in raw if str(c).strip()))
    else:
        codes = list(dict.fromkeys(str(c).strip() for c in raw if str(c).strip()))

    if not codes:
        raise HTTPException(400, "No codes provided")
    if len(codes) > 500:
        raise HTTPException(400, "Maximum 500 codes per request")

    _EPOCH_B = datetime(2011, 1, 1)

    def _proc_b(kp):
        stats = kp.get("stats") or {}
        cur   = stats.get("current") or []
        min90 = stats.get("min90")   or []
        max90 = stats.get("max90")   or []
        avg90 = stats.get("avg90")   or []

        def _p(idx, arr):
            if idx < len(arr) and arr[idx] is not None and arr[idx] > 0:
                return round(arr[idx] / 100, 2)
            return None

        asin     = kp.get("asin", "")
        cat_tree = kp.get("categoryTree") or []
        category = (cat_tree[-1].get("name") if cat_tree else "") or ""
        buy_box  = _keepa_buy_box(kp)

        offers   = kp.get("offers") or []
        num_fba  = num_fbm = 0
        for o in offers:
            if o.get("isFBA"): num_fba += 1
            else:              num_fbm += 1

        def _csv_pts(arr):
            pts, i = [], 0
            while i + 1 < len(arr):
                t, p = arr[i], arr[i + 1]
                if t is not None and p is not None and 0 < p < 1_000_000:
                    pts.append(round(p / 100, 2))
                i += 2
            return pts[-50:]

        csv      = kp.get("csv") or []
        fba_hist = _csv_pts(csv[7] if len(csv) > 7 else [])

        overall_median  = _p(7, avg90) or _p(1, avg90)
        if fba_hist:
            overall_90_high = round(max(fba_hist), 2)
            overall_90_low  = round(min(fba_hist), 2)
        else:
            overall_90_high = _p(7, max90) or _p(1, max90)
            overall_90_low  = _p(7, min90) or _p(1, min90)

        bsr_val = int(cur[3]) if len(cur) > 3 and cur[3] and cur[3] > 0 else None

        # EAN/UPC from product
        ean_list = kp.get("eanList") or []
        upc_val  = str(ean_list[0]) if ean_list else ""

        return {
            "asin":            asin,
            "upc":             upc_val,
            "title":           (kp.get("title") or "").strip(),
            "buy_box":         buy_box,
            "bsr":             bsr_val,
            "category":        category,
            "amazon_url":      f"https://www.amazon.com/dp/{asin}" if asin else "",
            "keepa_chart_url": f"https://graph.keepa.com/pricehistory.png?asin={asin}&domain=1&salesrank=1&bb=1&fbafba=1&range=90" if asin else "",
            "num_fba_sellers": num_fba if offers else None,
            "num_fbm_sellers": num_fbm if offers else None,
            "median_price":    overall_median,
            "price_90_high":   overall_90_high,
            "price_90_low":    overall_90_low,
        }

    all_products = []
    tokens_left  = None
    errors       = []
    param_key    = "asin" if mode == "asin" else "code"

    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=90) as client:
        for i in range(0, len(codes), 100):
            batch = codes[i: i + 100]
            try:
                resp = await client.get(
                    "https://api.keepa.com/product",
                    params={
                        "key":    api_key,
                        "domain": _KEEPA_DOMAIN,
                        param_key: ",".join(batch),
                        "stats":  90,
                        "offers": 20,
                    },
                )
                if resp.status_code == 429:
                    try:
                        refill = resp.json().get("refillIn", 0)
                        errors.append(f"Keepa data limit reached — will refill in ~{round(refill/3600,1)}h. Remaining products skipped.")
                    except Exception:
                        errors.append("Keepa token limit reached.")
                    break
                if resp.status_code != 200:
                    errors.append(f"Keepa error {resp.status_code} on batch {i//100+1}")
                    continue
                data        = resp.json()
                tokens_left = data.get("tokensLeft")
                for kp in (data.get("products") or []):
                    all_products.append(_proc_b(kp))
            except Exception as e:
                errors.append(f"Batch {i//100+1}: {str(e)}")

    return {"products": all_products, "tokens_left": tokens_left, "errors": errors}


@app.post("/api/keepa/amazon-search")
async def keepa_amazon_search(body: dict, current: dict = Depends(require_auth)):
    """Search Amazon catalog by keyword, then enrich matching ASINs via Keepa."""
    if not _amazon_sp_configured():
        raise HTTPException(503, "Amazon SP-API is not configured")

    query = (body.get("query") or "").strip()
    if not query:
        raise HTTPException(400, "query required")

    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not configured")

    token = await _get_amazon_access_token()
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{_AMAZON_SP_BASE}/catalog/2022-04-01/items",
            headers={"x-amz-access-token": token},
            params={
                "keywords":      query,
                "marketplaceIds": _AMAZON_MKT_ID,
                "includedData":  "summaries",
                "pageSize":      20,
            },
        )

    if resp.status_code != 200:
        raise HTTPException(502, f"Amazon catalog search failed ({resp.status_code})")

    items = resp.json().get("items") or []
    asins = [item.get("asin") for item in items if item.get("asin")]
    if not asins:
        return {"products": [], "tokens_left": None, "errors": []}

    # Reuse batch logic directly
    return await keepa_batch_lookup({"mode": "asin", "codes": asins}, current)


@app.post("/api/products/{product_id}/keepa-refresh", response_model=schemas.ProductOut)
async def keepa_refresh_one(
    product_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.asin:
        raise HTTPException(400, "Product has no ASIN — add one in the Products page first")

    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not set — add it in Railway Variables")

    url = (
        f"https://api.keepa.com/product"
        f"?key={api_key}&domain={_KEEPA_DOMAIN}&asin={product.asin.strip()}&stats=90"
    )
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url)

    if resp.status_code == 429:
        try:
            kd = resp.json()
            refill_secs = kd.get("refillIn", 0)
            refill_hrs = round(refill_secs / 3600, 1)
            tokens_left = kd.get("tokensLeft", "?")
            raise HTTPException(429, f"Keepa data limit reached — will refill in ~{refill_hrs}h. Try again later.")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(429, "Keepa token limit reached. Please wait before syncing again.")
    if resp.status_code != 200:
        raise HTTPException(502, f"Keepa returned {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    if data.get("error"):
        raise HTTPException(502, f"Keepa error: {data.get('status', 'unknown')}")

    products_data = data.get("products") or []
    if not products_data:
        raise HTTPException(404, f"ASIN {product.asin} not found in Keepa")

    try:
        _parse_keepa_product(products_data[0], product)
    except Exception as _pe:
        import traceback
        print(f"[keepa-refresh] _parse_keepa_product failed for {product.asin}: {_pe}\n{traceback.format_exc()}", flush=True)
        raise HTTPException(500, f"Failed to parse Keepa data: {_pe}")
    try:
        db.commit()
        db.refresh(product)
    except Exception as _ce:
        import traceback
        print(f"[keepa-refresh] db.commit() failed for {product.asin}: {_ce}\n{traceback.format_exc()}", flush=True)
        db.rollback()
        raise HTTPException(500, f"Database error after Keepa sync: {_ce}")
    return product


@app.post("/api/keepa/bulk-refresh")
async def keepa_bulk_refresh(
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    """Bulk-refresh all products that have an ASIN. Batches 100 per Keepa request."""
    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "KEEPA_API_KEY is not set — add it in Railway Variables")

    products = (
        db.query(models.Product)
        .filter(models.Product.asin.isnot(None), models.Product.asin != "")
        .all()
    )
    if not products:
        return {"refreshed": 0, "skipped": 0, "errors": []}

    # ASIN → list of products (handle duplicates)
    asin_map: dict = {}
    for p in products:
        key = p.asin.strip().upper()
        asin_map.setdefault(key, []).append(p)

    all_asins = list(asin_map.keys())
    refreshed = 0
    errors: list = []

    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=60) as client:
        for i in range(0, len(all_asins), 100):
            batch = all_asins[i: i + 100]
            url = (
                f"https://api.keepa.com/product"
                f"?key={api_key}&domain={_KEEPA_DOMAIN}&asin={','.join(batch)}&stats=90"
            )
            resp = await client.get(url)
            if resp.status_code == 429:
                try:
                    kd = resp.json()
                    refill_secs = kd.get("refillIn", 0)
                    refill_hrs = round(refill_secs / 3600, 1)
                    tokens_left = kd.get("tokensLeft", "?")
                except Exception:
                    refill_hrs, tokens_left = "?", "?"
                errors.append(f"Keepa data limit reached — sync paused and will resume automatically in ~{refill_hrs}h.")
                break  # no point hammering more batches
            if resp.status_code != 200:
                errors.append(f"Keepa {resp.status_code} on batch {i // 100 + 1}")
                continue
            data = resp.json()
            if data.get("error"):
                errors.append(f"Keepa error: {data.get('status')} on batch {i // 100 + 1}")
                continue
            for kp in data.get("products") or []:
                kp_asin = (kp.get("asin") or "").strip().upper()
                for prod in asin_map.get(kp_asin, []):
                    _parse_keepa_product(kp, prod)
                    refreshed += 1

    db.commit()
    return {"refreshed": refreshed, "skipped": len(all_asins) - refreshed, "errors": errors}


# ─── Amazon SP-API ─────────────────────────────────────────────────────────────
#
# Required Railway Variables:
#   AMAZON_LWA_CLIENT_ID      – Login with Amazon app Client ID
#   AMAZON_LWA_CLIENT_SECRET  – Login with Amazon app Client Secret
#   AMAZON_SP_REFRESH_TOKEN   – SP-API refresh token (from Seller Central)
#   AMAZON_SELLER_ID          – Your Seller Central Seller ID
#   AMAZON_MARKETPLACE_ID     – defaults to ATVPDKIKX0DER (US)

_AMAZON_LWA_URL = "https://api.amazon.com/auth/o2/token"


def _sp_base(is_sandbox: bool = False) -> str:
    return (
        "https://sandbox.sellingpartnerapi-na.amazon.com"
        if is_sandbox
        else "https://sellingpartnerapi-na.amazon.com"
    )

# ── Legacy single-tenant helpers (kept for backwards compat) ─────────────────
_AMAZON_SP_BASE = _sp_base(os.getenv("AMAZON_SP_SANDBOX", "").lower() in ("1", "true", "yes"))
_AMAZON_MKT_ID  = os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")

# ── Finances API cache — avoid hammering Amazon on every dashboard refresh ───
# {tenant_id: {"balance": float, "currency": str, "fetched_at": datetime}}
_finances_cache: dict = {}
_FINANCES_CACHE_TTL_SECONDS = 300  # 5 minutes


def _amazon_sp_configured() -> bool:
    return all(os.getenv(k, "").strip() for k in (
        "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET",
        "AMAZON_SP_REFRESH_TOKEN", "AMAZON_SELLER_ID",
    ))


async def _get_amazon_access_token() -> str:
    """Get access token using env-var credentials (legacy / single-tenant)."""
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=15) as client:
        resp_data = await client.post(
            _AMAZON_LWA_URL,
            data={
                "grant_type":    "refresh_token",
                "refresh_token": os.getenv("AMAZON_SP_REFRESH_TOKEN", ""),
                "client_id":     os.getenv("AMAZON_LWA_CLIENT_ID", ""),
                "client_secret": os.getenv("AMAZON_LWA_CLIENT_SECRET", ""),
            },
        )
    if resp_data.status_code != 200:
        raise HTTPException(502, f"Amazon LWA token error: {resp_data.text[:200]}")
    return resp_data.json()["access_token"]


# ── Multi-tenant Amazon helpers ───────────────────────────────────────────────

def _get_tenant_amazon_creds(tenant_id: int, db: Session) -> models.AmazonCredential:
    """
    Return AmazonCredential for tenant. Falls back to env vars for any tenant
    when no DB record exists (single-tenant / env-var mode).
    Only requires the 3 token-exchange vars (LWA client id/secret + refresh token);
    AMAZON_SELLER_ID is optional (only needed for inventory sync, not ASIN lookups).
    """
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
    if not cred:
        _lwa_id     = os.getenv("AMAZON_LWA_CLIENT_ID", "").strip()
        _lwa_secret = os.getenv("AMAZON_LWA_CLIENT_SECRET", "").strip()
        _refresh    = os.getenv("AMAZON_SP_REFRESH_TOKEN", "").strip()
        if _lwa_id and _lwa_secret and _refresh:
            # Return a transient (non-persisted) credential built from env vars.
            # We intentionally skip db.add/commit to avoid FK violations when the
            # tenants row doesn't yet exist in a fresh PostgreSQL database.
            return models.AmazonCredential(
                tenant_id=tenant_id,
                lwa_client_id=_lwa_id,
                lwa_client_secret=_lwa_secret,
                sp_refresh_token=_refresh,
                seller_id=os.getenv("AMAZON_SELLER_ID") or None,
                marketplace_id=os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER"),
                is_sandbox=os.getenv("AMAZON_SP_SANDBOX", "").lower() in ("1", "true", "yes"),
            )
    return cred


def _tenant_amazon_configured(tenant_id: int, db: Session) -> bool:
    cred = _get_tenant_amazon_creds(tenant_id, db)
    if not cred or not cred.sp_refresh_token:
        return False
    # lwa_client_id can live in DB (manual entry) or env vars (OAuth flow)
    return bool(cred.lwa_client_id or os.getenv("AMAZON_LWA_CLIENT_ID", ""))


async def _get_tenant_access_token(cred: models.AmazonCredential) -> str:
    """Exchange refresh token → access token using per-tenant credentials."""
    import httpx as _httpx
    # App-level credentials: prefer per-tenant override, else fall back to env vars
    client_id     = cred.lwa_client_id     or os.getenv("AMAZON_LWA_CLIENT_ID", "")
    client_secret = cred.lwa_client_secret or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                _AMAZON_LWA_URL,
                data={
                    "grant_type":    "refresh_token",
                    "refresh_token": cred.sp_refresh_token,
                    "client_id":     client_id,
                    "client_secret": client_secret,
                },
            )
    except _httpx.TimeoutException:
        raise HTTPException(502, "Amazon LWA token request timed out — check network connectivity")
    except _httpx.RequestError as exc:
        raise HTTPException(502, f"Amazon LWA token request failed: {exc}")
    if r.status_code != 200:
        raise HTTPException(502, f"Amazon LWA token error {r.status_code}: {r.text[:200]}")
    token = r.json().get("access_token")
    if not token:
        raise HTTPException(502, f"Amazon LWA response missing access_token: {r.text[:200]}")
    return token


async def _fetch_amazon_store_name(cred) -> str:
    """Fetch the seller's storefront/business name from SP-API after OAuth."""
    import httpx as _httpx
    try:
        token = await _get_tenant_access_token(cred)
        is_sandbox = getattr(cred, "is_sandbox", False)
        sp_base = (
            "https://sandbox.sellingpartnerapi-na.amazon.com"
            if is_sandbox
            else "https://sellingpartnerapi-na.amazon.com"
        )
        async with _httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{sp_base}/sellers/v1/marketplaceParticipations",
                headers={"x-amz-access-token": token},
            )
        if r.status_code == 200:
            for entry in r.json().get("payload", []):
                name = (entry.get("marketplace") or {}).get("storeName", "")
                if name:
                    return name
    except Exception:
        pass
    return ""


# ── Amazon OAuth endpoints ────────────────────────────────────────────────────

# App-level OAuth credentials (registered in Amazon Developer Central)
_AMAZON_APP_ID        = os.getenv("AMAZON_SP_APP_ID", "")    # amzn1.sp.solution.xxx
def _get_oauth_callback_url() -> str:
    """Read APP_URL fresh from env each time — never cached at startup."""
    return os.getenv("APP_URL", "http://localhost:8000").rstrip("/") + "/api/amazon/oauth/callback"


@app.get("/api/debug/db-status")
def debug_db_status(current: dict = Depends(require_superadmin), db: Session = Depends(get_db)):
    """Superadmin only — shows tenant and user counts."""
    tenants = db.query(models.Tenant).all()
    users   = db.query(models.User).all()
    return {
        "tenant_count": len(tenants),
        "tenants": [{"id": t.id, "name": t.name, "slug": t.slug} for t in tenants],
        "user_count": len(users),
        "users": [{"id": u.id, "username": u.username, "tenant_id": u.tenant_id} for u in users],
    }


@app.get("/api/debug/oauth-config")
def debug_oauth_config(current: dict = Depends(require_superadmin)):
    """Superadmin only — shows OAuth redirect URI and app ID."""
    return {
        "app_url_env":    os.getenv("APP_URL", "(not set)"),
        "callback_url":   _get_oauth_callback_url(),
        "app_id":         _AMAZON_APP_ID or "(not set)",
        "lwa_client_id":  os.getenv("AMAZON_LWA_CLIENT_ID", "(not set)"),
    }



# ── OAuth state signing — prevents any user from hijacking another tenant's connect flow ──
import hmac as _hmac_mod
import hashlib as _hashlib_mod
import time as _time_mod

def _sign_oauth_state(tenant_id: int) -> str:
    """Return a tamper-proof state string: '{tenant_id}:{timestamp}:{hmac}'."""
    secret = os.getenv("SECRET_KEY", "sellerpulse-oauth-secret").encode()
    ts = str(int(_time_mod.time()))
    sig = _hmac_mod.new(secret, f"{tenant_id}:{ts}".encode(), _hashlib_mod.sha256).hexdigest()[:20]
    return f"{tenant_id}:{ts}:{sig}"

def _verify_oauth_state(state: str) -> int | None:
    """Verify the state signature and return tenant_id, or None if invalid/expired."""
    parts = state.split(":")
    if len(parts) != 3:
        return None
    tid_str, ts_str, sig = parts
    if not tid_str.isdigit() or not ts_str.isdigit():
        return None
    if abs(int(_time_mod.time()) - int(ts_str)) > 1800:  # 30-minute window
        return None
    secret = os.getenv("SECRET_KEY", "sellerpulse-oauth-secret").encode()
    expected = _hmac_mod.new(secret, f"{tid_str}:{ts_str}".encode(), _hashlib_mod.sha256).hexdigest()[:20]
    if not _hmac_mod.compare_digest(sig, expected):
        return None
    return int(tid_str)


@app.get("/api/amazon/oauth/url")
def amazon_oauth_url(current: dict = Depends(require_admin)):
    """
    Returns the Amazon Seller Central OAuth consent URL.
    Admin-only — prevents non-admin users from overwriting the tenant's Amazon credentials.
    The state parameter is HMAC-signed so the callback can verify it came from a legitimate admin.
    """
    tenant_id = current.get("tenant_id", 1)
    if not _AMAZON_APP_ID:
        raise HTTPException(503, "AMAZON_SP_APP_ID env var is not set. Register your app in Amazon Developer Central.")
    import urllib.parse
    callback_url = _get_oauth_callback_url()
    params = {
        "application_id": _AMAZON_APP_ID,
        "state":          _sign_oauth_state(tenant_id),
        "version":        "beta",
        "redirect_uri":   callback_url,
    }
    base_url = "https://sellercentral.amazon.com/apps/authorize/consent"
    url = base_url + "?" + urllib.parse.urlencode(params)
    return {"url": url, "redirect_uri": callback_url}


@app.get("/api/amazon/oauth/callback")
async def amazon_oauth_callback(
    spapi_oauth_code: str = "",
    state: str = "",
    selling_partner_id: str = "",
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
):
    """
    Amazon redirects here after the seller authorizes the app.
    Exchanges the OAuth code for a refresh token and stores it.
    Then redirects to the frontend onboarding page.
    """
    import httpx as _httpx

    if background_tasks is None:
        background_tasks = BackgroundTasks()

    try:
        print(f"[oauth_callback] HIT — code={'yes' if spapi_oauth_code else 'MISSING'} state={state!r:.60} seller={selling_partner_id!r}", flush=True)

        if not spapi_oauth_code:
            print("[oauth_callback] ERROR: no spapi_oauth_code", flush=True)
            return RedirectResponse("/onboarding/amazon?error=no_code")

        # ── Resolve tenant — verify signed state to prevent credential hijacking ─
        verified_tid = _verify_oauth_state(state) if state else None
        print(f"[oauth_callback] state_verify → tenant_id={verified_tid}", flush=True)
        if verified_tid:
            # Normal path: signed state from admin-initiated OAuth
            tenant_id = verified_tid
        elif state.isdigit():
            # Legacy fallback: unsigned numeric state (old installations)
            # Only allow for existing tenants, not arbitrary IDs
            tenant_id = int(state)
            print(f"[oauth_callback] WARNING: unsigned state, tenant={tenant_id}", flush=True)
            log.warning("Amazon OAuth callback with unsigned state — tenant %s. Upgrade to signed OAuth URL.", tenant_id)
        else:
            print(f"[oauth_callback] ERROR: invalid_state — raw state was {state!r:.80}", flush=True)
            log.error("Amazon OAuth callback with invalid state: %r", state)
            return RedirectResponse("/onboarding/amazon?error=invalid_state")

        tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
        if not tenant:
            return RedirectResponse("/onboarding/amazon?error=invalid_tenant")
        tenant_id = tenant.id

        # ── Exchange auth code for refresh token ──────────────────────────────
        lwa_client_id     = os.getenv("AMAZON_LWA_CLIENT_ID", "")
        lwa_client_secret = os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
        if not lwa_client_id or not lwa_client_secret:
            log.error("Amazon OAuth: AMAZON_LWA_CLIENT_ID or AMAZON_LWA_CLIENT_SECRET not set")
            return RedirectResponse("/onboarding/amazon?error=missing_credentials")

        async with _httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                _AMAZON_LWA_URL,
                data={
                    "grant_type":    "authorization_code",
                    "code":           spapi_oauth_code,
                    "redirect_uri":   _get_oauth_callback_url(),
                    "client_id":      lwa_client_id,
                    "client_secret":  lwa_client_secret,
                },
            )
        print(f"[oauth_callback] LWA token exchange → HTTP {r.status_code}", flush=True)
        if r.status_code != 200:
            log.error("Amazon token exchange failed: %s %s", r.status_code, r.text[:300])
            print(f"[oauth_callback] LWA error body: {r.text[:300]}", flush=True)
            err = urllib.parse.quote(r.text[:120])
            return RedirectResponse(f"/onboarding/amazon?error=token_exchange_failed&detail={err}")

        tokens        = r.json()
        refresh_token = tokens.get("refresh_token", "")
        log.info("[oauth_callback] refresh_token present=%s", bool(refresh_token))
        if not refresh_token:
            return RedirectResponse("/onboarding/amazon?error=no_refresh_token")

        # ── Upsert credential record ──────────────────────────────────────────
        cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
        if cred:
            cred.sp_refresh_token = refresh_token
            cred.seller_id        = selling_partner_id or cred.seller_id
            cred.connected_at     = datetime.utcnow()
            print(f"[oauth_callback] UPDATED existing cred for tenant {tenant_id}, connected_at=now", flush=True)
        else:
            cred = models.AmazonCredential(
                tenant_id=tenant_id,
                sp_refresh_token=refresh_token,
                seller_id=selling_partner_id,
                marketplace_id=_AMAZON_MKT_ID,
                connected_at=datetime.utcnow(),
            )
            db.add(cred)
            print(f"[oauth_callback] CREATED new cred for tenant {tenant_id}", flush=True)
        db.commit()
        db.refresh(cred)
        print(f"[oauth_callback] DB commit OK — tenant {tenant_id} connected_at={cred.connected_at}", flush=True)

        # ── Fetch store name + update tenant branding ────────────────────────
        try:
            store_name = await _fetch_amazon_store_name(cred)
            if not store_name:
                store_name = tenant.name or ""
            if store_name:
                cred.store_name = store_name
                # Also update the tenant display name so the sidebar shows the store name
                if tenant and store_name:
                    tenant.name = store_name
                db.commit()
        except Exception as _se:
            print(f"[oauth] Could not fetch store name for tenant {tenant_id}: {_se}", flush=True)
            try:
                if not cred.store_name:
                    cred.store_name = tenant.name or ""
                    db.commit()
            except Exception:
                pass

        # ── Queue initial data pull ───────────────────────────────────────────
        import amazon_sync as _amazon_sync
        import asyncio as _asyncio

        def _run_initial_pull(tid: int):
            try:
                _asyncio.run(_amazon_sync.initial_data_pull(tid))
            except Exception as _pe:
                log.error("Initial data pull failed for tenant %s: %s", tid, _pe)

        background_tasks.add_task(_run_initial_pull, tenant_id)

        seller_id_param  = cred.seller_id or ''
        store_name_param = urllib.parse.quote(cred.store_name or '')
        return RedirectResponse(
            f"/onboarding/amazon?confirm=true&seller_id={seller_id_param}&store_name={store_name_param}"
        )

    except Exception as _top:
        # Catch-all: never return a 500, always redirect with the error message
        log.exception("Unhandled error in amazon_oauth_callback: %s", _top)
        err = urllib.parse.quote(str(_top)[:150])
        return RedirectResponse(f"/onboarding/amazon?error=internal&detail={err}")


@app.get("/api/amazon/credentials")
def get_amazon_credentials(
    current: dict = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Return current Amazon connection status for the tenant."""
    tenant_id = current.get("tenant_id", 1)
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
    import json as _json
    ship_from = None
    if cred and cred.ship_from_json:
        try:
            ship_from = _json.loads(cred.ship_from_json)
        except Exception:
            pass
    return {
        "connected":      bool(cred and cred.sp_refresh_token),
        "seller_id":      cred.seller_id if cred else None,
        "store_name":     cred.store_name if cred else None,
        "marketplace_id": cred.marketplace_id if cred else "ATVPDKIKX0DER",
        "connected_at":   cred.connected_at.isoformat() if cred and cred.connected_at else None,
        "is_sandbox":     cred.is_sandbox if cred else False,
        "ship_from":      ship_from,
    }


@app.get("/api/amazon/test-finances")
async def test_finances_connection(
    current: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin debug: test whether the stored refresh token has Finances scope.
    Returns connected_at, token prefix, token exchange result, and raw Finances API response.
    """
    import httpx as _httpx
    from datetime import timezone as _tz

    tenant_id = current.get("tenant_id", 1)
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
    if not cred or not cred.sp_refresh_token:
        return {"error": "No refresh token stored. Reconnect Amazon account."}

    tok_raw = cred.sp_refresh_token
    tok_preview = f"{tok_raw[:6]}…{tok_raw[-4:]}" if len(tok_raw) > 10 else "***"
    connected_at = cred.connected_at.isoformat() if cred.connected_at else None

    # Step 1: exchange refresh → access token
    client_id     = cred.lwa_client_id     or os.getenv("AMAZON_LWA_CLIENT_ID", "")
    client_secret = cred.lwa_client_secret or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            lwa_r = await client.post(
                _AMAZON_LWA_URL,
                data={
                    "grant_type":    "refresh_token",
                    "refresh_token": tok_raw,
                    "client_id":     client_id,
                    "client_secret": client_secret,
                },
            )
        if lwa_r.status_code != 200:
            return {
                "connected_at": connected_at,
                "token_preview": tok_preview,
                "step": "token_exchange",
                "lwa_status": lwa_r.status_code,
                "lwa_error": lwa_r.text[:300],
            }
        access_token = lwa_r.json()["access_token"]
    except Exception as e:
        return {"connected_at": connected_at, "token_preview": tok_preview, "step": "token_exchange", "error": str(e)}

    # Step 2: call Finances API
    now = datetime.now(_tz.utc)
    finances_after = (now - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
    sp_base = _sp_base(cred.is_sandbox)
    sandbox_env = os.getenv("AMAZON_SP_SANDBOX", "(not set)")
    module_base = _AMAZON_SP_BASE
    try:
        async with _httpx.AsyncClient(timeout=20) as client:
            fin_r = await client.get(
                f"{sp_base}/finances/v0/financialEventGroups",
                params={"FinancialEventGroupStartedAfter": finances_after},
                headers={"x-amz-access-token": access_token},
            )
        try:
            fin_body = fin_r.json()
        except Exception:
            fin_body = fin_r.text[:300]
        return {
            "connected_at":    connected_at,
            "token_preview":   tok_preview,
            "step":            "finances_api",
            "is_sandbox":      cred.is_sandbox,
            "sp_base_used":    sp_base,
            "module_sp_base":  module_base,
            "sandbox_env_var": sandbox_env,
            "finances_status": fin_r.status_code,
            "finances_body":   fin_body,
            "success":         fin_r.status_code == 200,
        }
    except Exception as e:
        return {"connected_at": connected_at, "token_preview": tok_preview, "step": "finances_api", "error": str(e)}


@app.put("/api/amazon/credentials")
def save_amazon_credentials(
    body: dict,
    current: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Manually save Amazon SP-API credentials (for users who prefer
    to paste their credentials rather than going through OAuth).
    """
    tenant_id = current.get("tenant_id", 1)
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
    if not cred:
        cred = models.AmazonCredential(tenant_id=tenant_id)
        db.add(cred)

    if body.get("lwa_client_id"):     cred.lwa_client_id     = body["lwa_client_id"]
    if body.get("lwa_client_secret"): cred.lwa_client_secret = body["lwa_client_secret"]
    if body.get("sp_refresh_token"):  cred.sp_refresh_token  = body["sp_refresh_token"]
    if body.get("seller_id"):         cred.seller_id         = body["seller_id"]
    if body.get("marketplace_id"):    cred.marketplace_id    = body["marketplace_id"]
    if body.get("store_name"):        cred.store_name        = body["store_name"]
    if "is_sandbox" in body:          cred.is_sandbox        = bool(body["is_sandbox"])
    cred.connected_at  = datetime.utcnow()
    cred.connected_by  = current["sub"]
    if not cred.store_name:
        _t = db.query(models.Tenant).filter_by(id=tenant_id).first()
        if _t:
            cred.store_name = _t.name
    db.commit()
    _audit(db, "amazon.credentials.save", current=current,
           detail=f"seller_id={body.get('seller_id')} store={cred.store_name}")
    return {"ok": True}


@app.get("/api/amazon/ship-from")
def get_ship_from(current: dict = Depends(require_auth), db: Session = Depends(get_db)):
    """Return the saved ship-from address for this tenant."""
    import json as _json
    cred = db.query(models.AmazonCredential).filter_by(
        tenant_id=current.get("tenant_id", 1)
    ).first()
    if cred and cred.ship_from_json:
        try:
            return _json.loads(cred.ship_from_json)
        except Exception:
            pass
    # Return the store name as a hint even if no address saved yet
    return {"store_name": cred.store_name if cred else None}


@app.put("/api/amazon/ship-from")
def save_ship_from(body: dict, current: dict = Depends(require_auth),
                   db: Session = Depends(get_db)):
    """Save the ship-from address for this tenant's FBA shipments."""
    import json as _json
    tid = current.get("tenant_id", 1)
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tid).first()
    if not cred:
        raise HTTPException(404, "Amazon account not connected")
    cred.ship_from_json = _json.dumps(body)
    db.commit()
    return {"ok": True}


@app.delete("/api/amazon/credentials")
def disconnect_amazon(
    current: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Admin-only: disconnect Amazon by clearing the refresh token.
    Does NOT delete product records. After disconnecting, the admin
    can reconnect using their own Amazon account via OAuth.
    """
    tenant_id = current.get("tenant_id", 1)
    cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
    if cred:
        cred.sp_refresh_token = None
        cred.seller_id        = None
        cred.connected_at     = None
        cred.connected_by     = None
        db.commit()
    return {"ok": True, "message": "Amazon account disconnected. You can now reconnect with the correct account."}


@app.post("/api/amazon/trigger-initial-sync")
async def trigger_initial_sync(
    background_tasks: BackgroundTasks,
    current: dict = Depends(require_admin),
):
    """
    Manually kick off the initial data pull (FBA inventory + Keepa enrichment).
    Called by the Onboarding page after credentials are saved manually.
    """
    import amazon_sync as _amazon_sync
    import asyncio as _asyncio
    tid = current.get("tenant_id")
    if not tid:
        raise HTTPException(400, "No tenant ID in token")
    if not _amazon_sync.configured(tid):
        raise HTTPException(503, "Amazon credentials not configured for this tenant")

    def _run(t_id: int):
        try:
            _asyncio.run(_amazon_sync.initial_data_pull(t_id))
        except Exception as e:
            log.error("Manual initial pull failed for tenant %s: %s", t_id, e)

    background_tasks.add_task(_run, tid)
    return {"ok": True, "message": "Initial data pull started in background"}


@app.get("/api/onboarding/sync-status")
def onboarding_sync_status(current: dict = Depends(require_auth)):
    """
    Poll this endpoint from the Onboarding page to show real-time
    progress of the initial Amazon + Keepa data pull.
    """
    import amazon_sync as _amazon_sync
    tid = current.get("tenant_id") or 0
    state = _amazon_sync.get_sync_state(tid)
    return {
        "running":      state.get("running", False),
        "last_sync_at": state.get("last_sync_at"),
        "created":      state.get("created", 0),
        "updated":      state.get("updated", 0),
        "error":        state.get("error"),
    }


@app.get("/api/amazon/test")
async def amazon_test(current: dict = Depends(require_auth), db: Session = Depends(get_db)):
    """Diagnostic: tests Amazon SP-API auth for the current tenant."""
    tenant_id = current.get("tenant_id", 1)
    cred = _get_tenant_amazon_creds(tenant_id, db)
    configured = bool(cred and cred.sp_refresh_token)
    result = {
        "configured": configured,
        "seller_id":  cred.seller_id if cred else None,
        "sandbox":    cred.is_sandbox if cred else False,
        "token_test": None,
        "token_error": None,
    }
    if configured:
        try:
            token = await _get_tenant_access_token(cred)
            result["token_test"] = f"OK — token starts with {token[:20]}..."
        except Exception as e:
            result["token_error"] = str(e)
    return result


@app.get("/api/amazon/status")
def amazon_status(current: dict = Depends(require_auth), db: Session = Depends(get_db)):
    tenant_id = current.get("tenant_id", 1)
    return {"configured": _tenant_amazon_configured(tenant_id, db)}


async def _fetch_fba_inventory() -> list:
    """
    Fetch all FBA inventory summaries from SP-API, handling pagination.
    Returns list of dicts with asin, product_name, seller_sku, quantity.
    """
    import httpx as _httpx
    access_token = await _get_amazon_access_token()
    items = []
    next_token = None

    async with _httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "granularityType": "Marketplace",
                "granularityId":   _AMAZON_MKT_ID,
                "marketplaceIds":  _AMAZON_MKT_ID,
                "details":         "true",
            }
            if next_token:
                params["nextToken"] = next_token

            resp = await client.get(
                f"{_AMAZON_SP_BASE}/fba/inventory/v1/summaries",
                params=params,
                headers={"x-amz-access-token": access_token},
            )
            if resp.status_code == 403:
                raise HTTPException(403, "Amazon SP-API access denied — check Seller Central permissions include FBA Inventory")
            if resp.status_code != 200:
                raise HTTPException(502, f"Amazon SP-API error {resp.status_code}: {resp.text[:300]}")

            body = resp.json().get("payload", {})
            for s in body.get("inventorySummaries", []):
                qty = s.get("totalQuantity") or 0
                if qty == 0:
                    # also try nested fulfillableQuantity
                    qty = (s.get("inventoryDetails") or {}).get("fulfillableQuantity", 0)
                items.append({
                    "asin":         s.get("asin", "").upper(),
                    "product_name": s.get("productName") or s.get("sellerSku") or s.get("asin", ""),
                    "seller_sku":   s.get("sellerSku", ""),
                    "quantity":     qty,
                    "condition":    s.get("condition", ""),
                })
            next_token = body.get("nextToken")
            if not next_token:
                break

    return items


@app.get("/api/amazon/inventory")
async def get_amazon_inventory(current: dict = Depends(require_auth)):
    """Preview what's in FBA inventory before importing."""
    tid = current.get("tenant_id")
    import amazon_sync
    if not amazon_sync.configured(tid):
        raise HTTPException(503, "Amazon SP-API credentials are not configured")
    items = await amazon_sync._fetch_fba_inventory(tid)
    return {"count": len(items), "items": items}


@app.post("/api/amazon/inventory/import")
async def import_amazon_inventory(current: dict = Depends(require_auth)):
    """Import FBA inventory — delegates to amazon_sync module."""
    tid = current.get("tenant_id")
    import amazon_sync
    if not amazon_sync.configured(tid):
        raise HTTPException(503, "Amazon SP-API credentials are not configured")
    try:
        result = await amazon_sync.run_sync(tid)
        cache_bust(tid, "products")
        return {
            "imported": result["created"] + result["updated"],
            "created":  result["created"],
            "updated":  result["updated"],
            "skipped":  result["skipped"],
        }
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/amazon/inventory/sync-status")
def amazon_inventory_sync_status(current: dict = Depends(require_auth)):
    """Return last sync timestamp and result for display on the Inventory page."""
    tid = current.get("tenant_id")
    import amazon_sync
    return {
        "configured": amazon_sync.configured(tid),
        **amazon_sync.get_sync_state(tid or 0),
    }


@app.post("/api/amazon/inventory/sync-now")
async def amazon_inventory_sync_now(current: dict = Depends(require_auth)):
    """Manually trigger an immediate Amazon inventory sync."""
    tid = current.get("tenant_id")
    import amazon_sync
    if not amazon_sync.configured(tid):
        raise HTTPException(503, "Amazon SP-API credentials are not configured")
    if amazon_sync.get_sync_state(tid or 0).get("running"):
        raise HTTPException(409, "Sync already in progress")
    try:
        result = await amazon_sync.run_sync(tid)
        cache_bust(tid, "products")   # invalidate stale product cache immediately
        return result
    except Exception as e:
        raise HTTPException(502, str(e))


@app.post("/api/amazon/fbm-upload")
async def upload_fbm_listings(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    """
    Import FBM listings from an Amazon Seller Central Active Listings Report (TSV).
    Download from: Seller Central → Reports → Inventory Reports → Active Listings Report.
    Parses tab-delimited or comma-delimited files. Columns used:
      asin1 (or asin), item-name, quantity, seller-sku, fulfillment-channel, status.
    """
    import csv, io as _io
    tid = current.get("tenant_id")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large — maximum size is 50 MB")
    text = data.decode("utf-8-sig", errors="replace")   # strip BOM if present

    # Detect delimiter — Amazon reports are tab-delimited
    sample = text[:4000]
    delimiter = "\t" if text.count("\t") > text.count(",") else ","

    reader = csv.DictReader(_io.StringIO(text), delimiter=delimiter)
    created = updated = skipped = 0
    errors = []

    for row in reader:
        asin = (row.get("asin1") or row.get("asin") or row.get("ASIN") or "").strip()
        if not asin or len(asin) != 10:
            skipped += 1
            continue

        # Skip FBA rows (FBA sync handles those)
        fc_raw = (row.get("fulfillment-channel") or row.get("fulfillment_channel") or "").strip().upper()
        if fc_raw in ("AMAZON", "AFN", "FBA"):
            skipped += 1
            continue

        # Skip inactive rows
        status_raw = (row.get("status") or row.get("Status") or "Active").strip().lower()
        if status_raw and status_raw not in ("active", ""):
            skipped += 1
            continue

        name = (row.get("item-name") or row.get("product-name") or row.get("title") or "").strip()
        sku  = (row.get("seller-sku") or row.get("seller_sku") or "").strip()
        try:
            qty = int(float(row.get("quantity") or 0))
        except (ValueError, TypeError):
            qty = 0

        try:
            q = db.query(models.Product).filter(models.Product.asin == asin)
            if tid:
                q = q.filter(models.Product.tenant_id == tid)
            existing = q.first()
            if existing:
                existing.quantity            = qty
                existing.fulfillment_channel = "FBM"
                if name and not existing.product_name:
                    existing.product_name = name
                updated += 1
            else:
                p = models.Product(
                    tenant_id=tid,
                    asin=asin,
                    product_name=name or asin,
                    quantity=qty,
                    order_number=sku or None,
                    status="approved",
                    fulfillment_channel="FBM",
                    created_by="system",
                )
                db.add(p)
                created += 1
        except Exception as e:
            errors.append(f"ASIN {asin}: {e}")

    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors[:10]}


# ═══════════════════════════════════════════════════════════════════════════════
# UNGATING SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════

_DEFAULT_TEMPLATES = [
    {
        "number": 1, "name": "Initial Application", "category": "general",
        "subject": "Request to Sell {PRODUCT_NAME} (ASIN: {ASIN})",
        "description": "First submission with supplier invoice and business credentials.",
        "body": """Dear Amazon Seller Performance Team,

I am writing to request approval to sell {PRODUCT_NAME} (ASIN: {ASIN}) on the Amazon marketplace.

I am an authorized reseller operating under the store name {SELLER_NAME}. I have attached the following documentation to support my application:

• Invoice from an authorized distributor/supplier dated within the last 180 days
• Invoice quantity: {QUANTITY}+ units (meeting Amazon's requirements)
• My business is a legitimate retail operation purchasing from verified wholesale distributors

All products I source are 100% authentic, purchased directly from licensed distributors or brand-authorized wholesalers. I comply fully with Amazon's Condition Guidelines and seller policies.

I look forward to your approval and appreciate your consideration.

Best regards,
{SELLER_NAME}
Amazon Store: {SELLER_NAME}""",
    },
    {
        "number": 2, "name": "Invoice Resubmission", "category": "resubmission",
        "subject": "Resubmission – {PRODUCT_NAME} (ASIN: {ASIN}) Approval Request",
        "description": "Follow-up with updated or additional invoice documentation.",
        "body": """Dear Amazon Seller Performance Team,

Thank you for reviewing my previous application. I am resubmitting my request to sell {PRODUCT_NAME} (ASIN: {ASIN}) with updated documentation.

In response to your review, I have obtained an updated invoice from my supplier that more clearly meets Amazon's requirements:

• Supplier: Licensed wholesale distributor
• Invoice date: Within the past 180 days
• Units purchased: {QUANTITY}+
• Invoice shows business name, address, and contact information matching my seller account

I want to emphasize that all my inventory is sourced exclusively through legitimate supply chains. I am committed to providing customers with authentic products that meet all of Amazon's quality standards.

Please let me know if you require any additional documentation.

Respectfully,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 3, "name": "Quantity Clarification", "category": "resubmission",
        "subject": "Documentation Clarification – {PRODUCT_NAME} Approval (ASIN: {ASIN})",
        "description": "Address quantity-related rejections with clearer proof.",
        "body": """Dear Amazon Seller Performance Team,

I am following up on my application to sell {PRODUCT_NAME} (ASIN: {ASIN}).

I understand there may have been a concern regarding the quantity on my invoice. To clarify:

• My invoice clearly shows a purchase of {QUANTITY}+ units
• The invoice is from {SUPPLIER_NAME}, a licensed wholesale distributor
• The purchase was made within the required timeframe

I have reattached the invoice with the relevant quantity information highlighted for clarity. Additionally, I can provide:
- A letter of authorization from the distributor confirming my account status
- Additional purchase orders showing my consistent buying history
- Business license and resale certificate if required

I am fully committed to meeting all requirements for approval and am happy to provide any further documentation needed.

Thank you for your time,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 4, "name": "Supplier Legitimacy", "category": "resubmission",
        "subject": "Supplier Verification – {PRODUCT_NAME} (ASIN: {ASIN})",
        "description": "Prove supplier legitimacy with additional documentation.",
        "body": """Dear Amazon Seller Performance Team,

I am resubmitting my request to sell {PRODUCT_NAME} (ASIN: {ASIN}) with additional supplier verification.

To address any concerns about my supply chain, I am providing the following:

1. SUPPLIER INFORMATION
   - Company: {SUPPLIER_NAME}
   - This is an authorized distributor with a verifiable business presence
   - Contact information is available on the invoice for verification

2. PURCHASE DOCUMENTATION
   - Invoice dated within the last 180 days
   - Quantity: {QUANTITY}+ units purchased
   - Products are new, unopened, and in original manufacturer packaging

3. MY BUSINESS CREDENTIALS
   - I operate a legitimate retail business
   - My seller account is in good standing with no policy violations
   - I have successfully sold in other categories on Amazon

I assure you that all products are authentic and sourced through legitimate channels. I am willing to provide any additional verification Amazon requires.

Sincerely,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 5, "name": "Brand Authorization", "category": "brand_auth",
        "subject": "Brand Authorization Letter – {PRODUCT_NAME} (ASIN: {ASIN})",
        "description": "Include brand authorization or distributor letter of authorization.",
        "body": """Dear Amazon Seller Performance Team,

I am submitting a revised application to sell {PRODUCT_NAME} (ASIN: {ASIN}), this time including a Letter of Authorization from my distributor confirming that I am an authorized reseller.

Documentation included:
1. Letter of Authorization from {SUPPLIER_NAME} confirming I am an authorized reseller
2. Original supplier invoice for {QUANTITY}+ units (within the last 180 days)
3. Proof that {SUPPLIER_NAME} is an authorized distributor for this product

The Letter of Authorization confirms:
• My business is recognized as an authorized buyer by this distributor
• The products I purchase are genuine and sourced through the proper supply chain
• The distributor can vouch for the authenticity of all products I have purchased

Please find all documents attached. I am confident this fulfills Amazon's requirements for ungating this product.

Thank you for your consideration,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 6, "name": "Business Documentation", "category": "resubmission",
        "subject": "Additional Business Documentation – {ASIN} Approval Request",
        "description": "Provide business registration and compliance documents.",
        "body": """Dear Amazon Seller Performance Team,

I am providing additional business documentation to support my application to sell {PRODUCT_NAME} (ASIN: {ASIN}).

Business Verification Documents Enclosed:
• Business License / Registration
• Resale Certificate / Sales Tax Permit
• EIN confirmation letter
• Bank statements showing business account (confirming financial capacity to purchase inventory)

Supplier Documentation:
• Invoice from {SUPPLIER_NAME}: {QUANTITY}+ units within 180 days
• Supplier's business license and contact details

I want to make clear that I run a legitimate, compliant business that takes Amazon's policies seriously. I have invested in building proper supplier relationships and maintaining accurate business records.

My sole objective is to provide customers with authentic, quality products while adhering to all of Amazon's marketplace standards.

I appreciate your time in reviewing this application.

Best regards,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 7, "name": "Distributor Chain Documentation", "category": "resubmission",
        "subject": "Complete Supply Chain Documentation – {PRODUCT_NAME} (ASIN: {ASIN})",
        "description": "Show the full distribution chain from manufacturer to seller.",
        "body": """Dear Amazon Seller Performance Team,

To strengthen my application for {PRODUCT_NAME} (ASIN: {ASIN}), I am providing complete supply chain documentation showing the path from manufacturer to my business.

Supply Chain Documentation:
1. MANUFACTURER → DISTRIBUTOR: Evidence that {SUPPLIER_NAME} sources directly from the manufacturer or authorized importer
2. DISTRIBUTOR → MY BUSINESS: Invoice showing my purchase of {QUANTITY}+ units
3. MY BUSINESS → AMAZON: My commitment to fulfill orders from this verified inventory

This documentation demonstrates an unbroken, verifiable chain of custody for all products. Every unit I sell on Amazon can be traced back to an authorized source, eliminating any possibility of counterfeit product.

Additional assurances:
• I maintain detailed purchasing records for all inventory
• Products are stored in proper conditions to maintain quality
• I strictly follow Amazon's product condition guidelines

I am confident that this comprehensive documentation package fulfills all requirements.

Thank you,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 8, "name": "Management Escalation", "category": "escalation",
        "subject": "Escalation Request – Persistent Approval Issue for ASIN {ASIN}",
        "description": "Escalate to manager after multiple rejections.",
        "body": """Dear Amazon Seller Performance Leadership,

I am respectfully requesting escalation of my application to sell {PRODUCT_NAME} (ASIN: {ASIN}), which has been under review through multiple submissions.

Summary of My Submissions:
• I have submitted multiple well-documented applications
• Each submission has included valid supplier invoices meeting quantity requirements ({QUANTITY}+ units)
• I have provided business licenses, supplier authorization letters, and additional documentation as requested

My Position:
I am a compliant, long-standing Amazon seller with no policy violations. I have taken every step requested to demonstrate that my supply chain is legitimate and that I am qualified to sell this product.

I believe there may be a review process issue causing my application to be denied despite meeting all published requirements. I respectfully request that a senior review team member evaluate my full documentation package.

I am available for any verification calls or additional review processes Amazon may require to resolve this matter.

Thank you for your attention to this escalation.

Respectfully,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 9, "name": "Final Appeal", "category": "escalation",
        "subject": "Final Appeal – {PRODUCT_NAME} (ASIN: {ASIN}) Approval",
        "description": "Last comprehensive appeal with all documentation.",
        "body": """Dear Amazon Seller Performance Executive Team,

I am submitting this final appeal regarding my application to sell {PRODUCT_NAME} (ASIN: {ASIN}).

I have compiled a complete documentation package that addresses every possible concern:

COMPLETE DOCUMENTATION PACKAGE:
✓ Supplier invoice: {SUPPLIER_NAME}, {QUANTITY}+ units, within 180 days
✓ Letter of Authorization from distributor
✓ Business license and registration
✓ Resale certificate
✓ Seller account history showing compliance
✓ Supply chain documentation from manufacturer to my business

MY TRACK RECORD:
• Amazon seller account in good standing
• No product authenticity complaints
• No policy violations
• Consistent positive customer feedback

I am deeply committed to operating within Amazon's guidelines and providing customers with authentic products. I believe I have thoroughly demonstrated my eligibility to sell this product.

If there is a specific document or piece of information that would satisfy Amazon's requirements that I have not yet provided, please advise and I will obtain it immediately.

I sincerely appreciate your consideration of this final appeal.

{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
    {
        "number": 10, "name": "Custom Response", "category": "general",
        "subject": "Re: {PRODUCT_NAME} (ASIN: {ASIN}) Application",
        "description": "Blank template for custom responses tailored to specific situations.",
        "body": """Dear Amazon Seller Performance Team,

{CUSTOM_CONTENT}

Thank you for your consideration.

Best regards,
{SELLER_NAME}
Store: {SELLER_NAME}""",
    },
]


def _seed_ungate_templates(db: Session):
    """Seed default templates if the table is empty."""
    if db.query(models.UngateTemplate).count() == 0:
        for t in _DEFAULT_TEMPLATES:
            db.add(models.UngateTemplate(**t))
        db.commit()


def _fill_template(body: str, subject: str, variables: dict) -> tuple[str, str]:
    """Replace {VARIABLE} placeholders in template body and subject."""
    for k, v in variables.items():
        body    = body.replace(f"{{{k}}}", str(v) if v else f"[{k}]")
        subject = (subject or "").replace(f"{{{k}}}", str(v) if v else f"[{k}]")
    return body, subject


# ── Ungate templates ──────────────────────────────────────────────────────────

@app.get("/api/ungate/templates")
def get_ungate_templates(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    _seed_ungate_templates(db)
    tid = current.get("tenant_id")
    # Return global templates (tenant_id IS NULL) plus tenant-specific overrides
    from sqlalchemy import or_ as _or2
    q = db.query(models.UngateTemplate)
    if tid and not current.get("is_superadmin"):
        q = q.filter(_or2(models.UngateTemplate.tenant_id == tid, models.UngateTemplate.tenant_id == None))
    return q.order_by(models.UngateTemplate.number).all()


@app.put("/api/ungate/templates/{template_id}")
def update_ungate_template(
    template_id: int,
    body: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    tid = current.get("tenant_id")
    q = db.query(models.UngateTemplate).filter(models.UngateTemplate.id == template_id)
    if tid and not current.get("is_superadmin"):
        from sqlalchemy import or_ as _or2
        q = q.filter(_or2(models.UngateTemplate.tenant_id == tid, models.UngateTemplate.tenant_id == None))
    t = q.first()
    if not t:
        raise HTTPException(404, "Template not found")
    for field in ("name", "description", "subject", "body", "category", "is_active"):
        if field in body:
            setattr(t, field, body[field])
    # Claim template for tenant if it was global
    if t.tenant_id is None and tid:
        t.tenant_id = tid
    db.commit()
    db.refresh(t)
    return t


@app.post("/api/ungate/templates/ai-generate")
async def ai_generate_template(body: dict, current: dict = Depends(require_admin)):
    """Use AI to generate template body for a given category/scenario."""
    from groq import AsyncGroq
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "GROQ_API_KEY not configured")

    scenario      = body.get("scenario", "initial application")
    category      = body.get("category", "general")
    template_num  = body.get("template_num", 1)
    extra_context = body.get("context", "")

    prompt = f"""You are an expert Amazon seller consultant specializing in ungating restricted products.

Write a professional Amazon ungating application email template for:
- Scenario: {scenario}
- Template #{template_num} (escalation level increases with number)
- Category: {category}
- Extra context: {extra_context}

The template must use these placeholders where appropriate:
{{SELLER_NAME}}, {{SELLER_ID}}, {{PRODUCT_NAME}}, {{ASIN}}, {{QUANTITY}}, {{SUPPLIER_NAME}}, {{CATEGORY}}

Requirements:
- Professional, respectful tone
- Clear and specific
- Address Amazon's typical concerns for this scenario
- Include a subject line on the first line starting with "SUBJECT: "
- Then the email body

Output ONLY the subject line and email body, no other text."""

    try:
        client = AsyncGroq(api_key=api_key)
        result = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        text = result.choices[0].message.content.strip()
        # Parse subject from first line
        lines = text.split("\n")
        subject = ""
        body_start = 0
        if lines[0].startswith("SUBJECT:"):
            subject = lines[0].replace("SUBJECT:", "").strip()
            body_start = 1
            # skip blank line after subject
            if len(lines) > 1 and not lines[1].strip():
                body_start = 2
        email_body = "\n".join(lines[body_start:]).strip()
        return {"subject": subject, "body": email_body}
    except Exception as e:
        raise HTTPException(502, f"AI error: {str(e)}")


# ── Ungate requirements ───────────────────────────────────────────────────────

@app.get("/api/ungate/requirements/{asin}")
async def get_ungate_requirements(asin: str, current: dict = Depends(require_auth)):
    """Fetch Amazon listing restrictions + AI-inferred ungating requirements."""
    asin = asin.strip().upper()

    restrictions_data = {}
    product_details   = {}
    sp_error = None

    if _amazon_sp_configured():
        try:
            token     = await _get_amazon_access_token()
            seller_id = os.getenv("AMAZON_SELLER_ID", "").strip()
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=20) as c:
                # ① Gating check
                r = await c.get(
                    f"{_AMAZON_SP_BASE}/listings/2021-08-01/restrictions",
                    headers={"x-amz-access-token": token},
                    params={
                        "asin":           asin,
                        "conditionType":  "new_new",
                        "sellerId":       seller_id,
                        "marketplaceIds": _AMAZON_MKT_ID,
                    },
                )
                if r.status_code == 200:
                    restrictions_data = r.json()
                else:
                    sp_error = f"SP-API returned {r.status_code}"

                # ② Product details from catalog (name, brand, category)
                cat_r = await c.get(
                    f"{_AMAZON_SP_BASE}/catalog/2022-04-01/items/{asin}",
                    headers={"x-amz-access-token": token},
                    params={
                        "marketplaceIds": _AMAZON_MKT_ID,
                        "includedData":   "summaries,classifications",
                    },
                )
                if cat_r.status_code == 200:
                    cat_data = cat_r.json()
                    summaries = cat_data.get("summaries") or []
                    if summaries:
                        product_details["name"]  = summaries[0].get("itemName", "")
                        product_details["brand"] = summaries[0].get("brandName", "")
                    cls_groups = cat_data.get("classifications") or []
                    if cls_groups:
                        cls_list = cls_groups[0].get("classifications") or []
                        if cls_list:
                            # Walk to the deepest classification for the most specific category
                            leaf = cls_list[-1] if cls_list else {}
                            product_details["category"] = leaf.get("displayName", "")
        except Exception as e:
            sp_error = str(e)
    else:
        sp_error = "Amazon SP-API not configured"

    # Summarize restrictions
    restrictions = restrictions_data.get("restrictions") or []
    reasons = []
    apply_links = []
    for restriction in restrictions:
        for reason in (restriction.get("reasons") or []):
            msg = reason.get("message", "")
            if msg:
                reasons.append(msg)
            for link in (reason.get("links") or []):
                apply_links.append(link)

    # Use AI to infer requirements based on ASIN/category context
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    ai_requirements = {}
    if groq_key and reasons:
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=groq_key)
            result = await client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                max_tokens=256,
                messages=[{
                    "role": "user",
                    "content": f"""Based on these Amazon listing restriction messages for ASIN {asin}, extract the ungating requirements as JSON.
Messages: {'; '.join(reasons)}

Return ONLY valid JSON with these fields (use null if not mentioned):
{{"quantity": <integer or null>, "invoice_age_days": <integer or null>, "needs_brand_auth": <boolean>, "needs_business_docs": <boolean>, "notes": "<brief summary>"}}"""
                }],
            )
            import json as _json
            raw = result.choices[0].message.content.strip()
            # Extract JSON from response
            start = raw.find("{")
            end   = raw.rfind("}") + 1
            if start != -1 and end > start:
                ai_requirements = _json.loads(raw[start:end])
        except Exception:
            pass

    return {
        "asin":            asin,
        "is_gated":        len(restrictions) > 0,
        "check_ran":       sp_error is None,
        "sp_error":        sp_error,
        "reasons":         reasons,
        "apply_links":     apply_links,
        "requirements":    ai_requirements,
        "product_details": product_details,
        "raw":             restrictions_data,
    }


# ── Ungate requests ───────────────────────────────────────────────────────────

def _ungate_req_query(db, current):
    """Base query for ungate requests scoped to the current tenant."""
    tid = current.get("tenant_id")
    q = db.query(models.UngateRequest)
    if tid and not current.get("is_superadmin"):
        q = q.filter(models.UngateRequest.tenant_id == tid)
    return q


@app.get("/api/ungate/requests")
def list_ungate_requests(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    return _ungate_req_query(db, current).order_by(models.UngateRequest.created_at.desc()).offset(offset).limit(min(limit, 1000)).all()


@app.post("/api/ungate/requests")
def create_ungate_request(body: dict, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    import json as _json
    req = models.UngateRequest(
        tenant_id=current.get("tenant_id"),
        product_id=body.get("product_id"),
        asin=body.get("asin", "").strip().upper(),
        product_name=body.get("product_name", "").strip(),
        category=body.get("category", "").strip(),
        requirements=_json.dumps(body.get("requirements") or {}),
        history="[]",
        notes=body.get("notes", ""),
        status="pending",
        current_template_num=1,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return req


@app.get("/api/ungate/requests/{req_id}")
def get_ungate_request(req_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    req = _ungate_req_query(db, current).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    return req


@app.post("/api/ungate/requests/{req_id}/submit")
def submit_ungate_request(req_id: int, body: dict, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """Record that the current template was submitted to Amazon."""
    import json as _json
    req = _ungate_req_query(db, current).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")

    history = _json.loads(req.history or "[]")
    history.append({
        "template_num":  req.current_template_num,
        "submitted_at":  datetime.utcnow().isoformat(),
        "status":        "submitted",
        "submitted_by":  current["username"],
        "notes":         body.get("notes", ""),
    })
    req.history = _json.dumps(history)
    req.status  = "in_progress"
    db.commit()
    db.refresh(req)
    return req


@app.post("/api/ungate/requests/{req_id}/rejection")
async def record_rejection(req_id: int, body: dict, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """Record Amazon's rejection and AI-generate the next response."""
    import json as _json
    req = _ungate_req_query(db, current).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")

    rejection_reason = body.get("rejection_reason", "").strip()
    next_template_num = min(req.current_template_num + 1, 10)

    # Update history — mark last step as rejected
    history = _json.loads(req.history or "[]")
    if history:
        history[-1]["status"] = "rejected"
        history[-1]["rejection_reason"] = rejection_reason

    # Fetch the next template
    _seed_ungate_templates(db)
    next_template = db.query(models.UngateTemplate).filter(
        models.UngateTemplate.number == next_template_num,
        models.UngateTemplate.is_active == True,
    ).first()

    ai_response = None
    ai_subject  = None

    # AI-customize the next template based on the rejection
    groq_key = os.getenv("GROQ_API_KEY", "").strip()
    requirements = _json.loads(req.requirements or "{}")
    # Resolve store name from tenant Amazon credentials
    _tid = current.get("tenant_id")
    _store_name = body.get("seller_name") or ""
    _seller_id  = body.get("seller_id") or os.getenv("AMAZON_SELLER_ID", "[Seller ID]")
    if _tid and not _store_name:
        _cred = db.query(models.AmazonCredential).filter_by(tenant_id=_tid).first()
        if _cred:
            _store_name = _cred.store_name or ""
            _seller_id  = _cred.seller_id or _seller_id
    if not _store_name:
        _ten = db.query(models.Tenant).filter_by(id=_tid).first() if _tid else None
        _store_name = (_ten.name if _ten else None) or "[Your Business Name]"
    variables = {
        "PRODUCT_NAME":  req.product_name,
        "ASIN":          req.asin,
        "CATEGORY":      req.category or "",
        "QUANTITY":      requirements.get("quantity") or "150",
        "SUPPLIER_NAME": body.get("supplier_name") or "our authorized distributor",
        "SELLER_NAME":   _store_name,
        "SELLER_ID":     _seller_id,
    }

    base_body    = next_template.body    if next_template else ""
    base_subject = next_template.subject if next_template else ""
    base_body, base_subject = _fill_template(base_body, base_subject, variables)

    if groq_key and rejection_reason:
        try:
            from groq import AsyncGroq
            client = AsyncGroq(api_key=groq_key)
            result = await client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                max_tokens=1024,
                messages=[{
                    "role": "user",
                    "content": f"""You are an Amazon ungating expert. Amazon rejected a seller's application with this reason:

REJECTION: {rejection_reason}

PRODUCT: {req.product_name} (ASIN: {req.asin})
TEMPLATE BASE (customize this): {base_body}

Rewrite the template to specifically address the rejection reason while keeping the professional tone.
Keep the same structure but adapt the content to directly counter Amazon's stated concerns.
Return ONLY the email body text, no subject line, no explanation.""",
                }],
            )
            ai_response = result.choices[0].message.content.strip()
        except Exception:
            ai_response = base_body  # fall back to base template

    # Add next step to history
    history.append({
        "template_num":  next_template_num,
        "generated_at":  datetime.utcnow().isoformat(),
        "status":        "draft",
        "ai_response":   ai_response or base_body,
        "subject":       ai_subject or base_subject,
    })

    req.history = _json.dumps(history)
    req.current_template_num = next_template_num
    req.status = "rejected_final" if next_template_num >= 10 and not next_template else "in_progress"
    db.commit()
    db.refresh(req)
    return {**req.__dict__, "_ai_response": ai_response or base_body, "_subject": ai_subject or base_subject}


@app.post("/api/ungate/requests/{req_id}/approve")
def approve_ungate_request(req_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    import json as _json
    req = _ungate_req_query(db, current).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    history = _json.loads(req.history or "[]")
    if history:
        history[-1]["status"] = "approved"
        history[-1]["approved_at"] = datetime.utcnow().isoformat()
    req.history = _json.dumps(history)
    req.status  = "approved"
    # Also mark the product as ungated — scoped to tenant
    if req.product_id:
        product = db.query(models.Product).filter(models.Product.id == req.product_id).first()
        if product:
            _check_owner(product, current)
            product.ungated = True
    db.commit()
    db.refresh(req)
    return req


@app.delete("/api/ungate/requests/{req_id}")
def delete_ungate_request(req_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    req = _ungate_req_query(db, current).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    db.delete(req)
    db.commit()
    return {"ok": True}


@app.put("/api/ungate/requests/{req_id}/case-id")
def set_ungate_case_id(req_id: int, body: dict = Body(...), db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """Save the Amazon case log number for an ungate request."""
    req = _ungate_req_query(db, current).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")
    req.amazon_case_id = body.get("case_id") or None
    db.commit()
    db.refresh(req)
    return req


@app.get("/api/ungate/render-template/{template_num}")
def render_template(
    template_num: int,
    product_name: str = "",
    asin: str = "",
    quantity: str = "150",
    supplier_name: str = "your authorized distributor",
    seller_name: str = "",
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Render a template with provided variables."""
    _seed_ungate_templates(db)
    t = db.query(models.UngateTemplate).filter(models.UngateTemplate.number == template_num).first()
    if not t:
        raise HTTPException(404, "Template not found")
    # Resolve seller name: query param > tenant Amazon store_name > tenant name > fallback
    tid = current.get("tenant_id")
    resolved_seller_name = seller_name
    resolved_seller_id   = os.getenv("AMAZON_SELLER_ID", "[Seller ID]")
    if tid and not resolved_seller_name:
        cred = db.query(models.AmazonCredential).filter_by(tenant_id=tid).first()
        if cred:
            resolved_seller_name = cred.store_name or ""
            resolved_seller_id   = cred.seller_id or resolved_seller_id
    if not resolved_seller_name:
        tenant = db.query(models.Tenant).filter_by(id=tid).first() if tid else None
        resolved_seller_name = (tenant.name if tenant else None) or "[Your Business Name]"

    variables = {
        "PRODUCT_NAME":  product_name,
        "ASIN":          asin,
        "QUANTITY":      quantity,
        "SUPPLIER_NAME": supplier_name,
        "SELLER_NAME":   resolved_seller_name,
        "SELLER_ID":     resolved_seller_id,
        "CATEGORY":      "",
    }
    body, subject = _fill_template(t.body, t.subject or "", variables)
    return {"subject": subject, "body": body, "template": t}


@app.post("/api/ungate/requests/{req_id}/send-email")
async def send_ungate_email(req_id: int, body: dict, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """Send the current ungating template via email to Amazon seller performance."""
    import json as _json, smtplib, base64 as _b64
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.base import MIMEBase
    from email import encoders as _enc

    req = db.query(models.UngateRequest).filter(models.UngateRequest.id == req_id).first()
    if not req:
        raise HTTPException(404, "Request not found")

    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_pass = (os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD") or "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    if not all([smtp_host, smtp_user, smtp_pass]):
        raise HTTPException(503, "SMTP not configured — add SMTP_HOST, SMTP_USER, and SMTP_PASS to Railway environment variables")

    to_email        = body.get("to_email", "seller-performance@amazon.com")
    subject         = body.get("subject", "")
    email_body      = body.get("body", "")
    include_invoice = body.get("include_invoice", True)

    if not subject or not email_body:
        raise HTTPException(400, "subject and body required")

    # Check for attached invoice
    inv = db.query(models.UngateInvoice).filter_by(req_id=req_id).first() if include_invoice else None
    has_invoice = bool(inv and inv.data_b64)

    smtp_from = os.getenv("SMTP_FROM", smtp_user)
    msg = MIMEMultipart("mixed" if has_invoice else "alternative")
    msg["Subject"] = subject
    msg["From"]    = smtp_from
    msg["To"]      = to_email
    msg.attach(MIMEText(email_body, "plain"))

    if has_invoice:
        att = MIMEBase("application", "octet-stream")
        att.set_payload(_b64.b64decode(inv.data_b64))
        _enc.encode_base64(att)
        att.add_header("Content-Disposition", f'attachment; filename="{inv.filename}"')
        msg.attach(att)

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [to_email], msg.as_string())
    except Exception as e:
        raise HTTPException(502, f"Failed to send email: {str(e)}")

    # Record the send in history
    history = _json.loads(req.history or "[]")
    entry_extra = {"invoice_attached": inv.filename} if has_invoice else {}
    if history:
        history[-1].update({"emailed_at": datetime.utcnow().isoformat(), "emailed_to": to_email, "status": "submitted", **entry_extra})
    else:
        history.append({"template_num": req.current_template_num, "submitted_at": datetime.utcnow().isoformat(),
                         "emailed_to": to_email, "status": "submitted", **entry_extra})
    req.history = _json.dumps(history)
    req.status  = "in_progress"
    db.commit()
    db.refresh(req)
    return {"ok": True, "sent_to": to_email, "invoice_attached": bool(has_invoice)}


@app.post("/api/ungate/requests/{req_id}/invoice")
async def upload_ungate_invoice(
    req_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Attach an invoice PDF/image to an ungating request (stored as base64)."""
    import base64 as _b64
    req = db.query(models.UngateRequest).filter(
        models.UngateRequest.id == req_id,
        models.UngateRequest.tenant_id == current.get("tenant_id"),
    ).first()
    if not req:
        raise HTTPException(404, "Request not found")

    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "Invoice file too large — max 10 MB")

    inv = db.query(models.UngateInvoice).filter_by(req_id=req_id).first()
    if inv:
        inv.filename   = file.filename
        inv.data_b64   = _b64.b64encode(data).decode()
        inv.size_bytes = len(data)
    else:
        inv = models.UngateInvoice(
            req_id=req_id,
            filename=file.filename,
            data_b64=_b64.b64encode(data).decode(),
            size_bytes=len(data),
        )
        db.add(inv)

    req.invoice_filename = file.filename
    db.commit()
    return {"ok": True, "filename": file.filename, "size_bytes": len(data)}


@app.delete("/api/ungate/requests/{req_id}/invoice")
def delete_ungate_invoice(req_id: int, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    """Remove the invoice attached to an ungating request."""
    req = db.query(models.UngateRequest).filter(
        models.UngateRequest.id == req_id,
        models.UngateRequest.tenant_id == current.get("tenant_id"),
    ).first()
    if not req:
        raise HTTPException(404, "Request not found")
    db.query(models.UngateInvoice).filter_by(req_id=req_id).delete()
    req.invoice_filename = None
    db.commit()
    return {"ok": True}


@app.post("/api/support/chat")
async def support_chat(body: dict, current: dict = Depends(require_auth)):
    """AI support assistant powered by Groq (Llama 3.3 70B)."""
    from groq import AsyncGroq
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(503, "GROQ_API_KEY is not configured")

    messages = body.get("messages") or []
    if not messages:
        raise HTTPException(400, "messages required")

    system_prompt = """You are the built-in support assistant for SellerPulse — a wholesale CRM platform for Amazon FBA sellers.

You help users with the platform's features:
- **Dashboard**: repricer performance stats (price updates, buy box %, units sold)
- **Accounts**: wholesale supplier/buyer accounts, contacts, email threads, pipeline stages
- **Follow-Ups**: task scheduling and pipeline management
- **Orders**: purchase order tracking
- **Sourcing**: adding new products to research — ASIN lookup pulls Keepa data (BSR, buy box price, FBA/FBM sellers, price history chart), auto-checks Amazon ungating, auto-fills product name and fees
- **Current Inventory**: live FBA inventory synced from Amazon hourly, tabs by stage (In Stock, In Transit, At Prep, At Amazon, Out of Stock), click any row to open detail drawer
- **Repricer**: Aria AI repricer sets prices per strategy
- **Time Clock**: clock in/out with notes, admin can view reports
- **Support**: this page

Integrations: Keepa API, Amazon SP-API (inventory sync, ungating), SMTP email.

Be concise, friendly, and specific. If you don't know something about their specific setup, say so."""

    try:
        client = AsyncGroq(api_key=api_key)
        result = await client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            max_tokens=1024,
            messages=[{"role": "system", "content": system_prompt}, *messages],
        )
        return {"response": result.choices[0].message.content}
    except Exception as e:
        raise HTTPException(502, f"AI error: {str(e)}")


@app.get("/api/amazon/check-asin/{asin}")
async def check_asin_ungated(asin: str, current: dict = Depends(require_auth)):
    """Check gating status for any ASIN directly — no saved product required."""
    if not _amazon_sp_configured():
        raise HTTPException(503, "Amazon SP-API credentials are not configured")

    seller_id = os.getenv("AMAZON_SELLER_ID", "").strip()
    access_token = await _get_amazon_access_token()

    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{_AMAZON_SP_BASE}/listings/2021-08-01/restrictions",
            params={
                "asin":           asin.strip().upper(),
                "sellerId":       seller_id,
                "marketplaceIds": _AMAZON_MKT_ID,
                "conditionType":  "new_new",
            },
            headers={"x-amz-access-token": access_token},
        )

    if resp.status_code == 403:
        raise HTTPException(403, "Amazon SP-API access denied — check credentials and app permissions")
    if resp.status_code != 200:
        raise HTTPException(502, f"Amazon SP-API error {resp.status_code}: {resp.text[:300]}")

    restrictions = resp.json().get("restrictions", [])
    return {"asin": asin.upper(), "ungated": len(restrictions) == 0, "restrictions": restrictions}


@app.post("/api/products/{product_id}/check-ungated")
async def check_amazon_ungated(
    product_id: int,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Call Amazon SP-API Listings Restrictions to check if this account
    is approved to sell the given ASIN new condition."""
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    if not product.asin:
        raise HTTPException(400, "Product has no ASIN")
    if not _amazon_sp_configured():
        raise HTTPException(503, "Amazon SP-API credentials are not configured — see Admin → Amazon SP-API setup")

    seller_id = os.getenv("AMAZON_SELLER_ID", "").strip()
    access_token = await _get_amazon_access_token()

    # Reuse the ASIN-level check
    result = await check_asin_ungated(product.asin, current)
    product.ungated = result["ungated"]
    db.commit()
    return result


# ─── Time Clock ───────────────────────────────────────────────────────────────

@app.post("/api/timeclock/in")
def clock_in(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    username = current["sub"]
    # Prevent double clock-in
    open_entry = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == username, models.TimeEntry.clock_out == None)
        .first()
    )
    if open_entry:
        raise HTTPException(status_code=400, detail="Already clocked in")
    entry = models.TimeEntry(username=username, clock_in=datetime.utcnow(), tenant_id=current.get("tenant_id"))
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "clock_in": entry.clock_in.isoformat(), "status": "clocked_in"}


@app.post("/api/timeclock/out")
def clock_out(data: dict = {}, db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    username = current["sub"]
    open_entry = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == username, models.TimeEntry.clock_out == None)
        .first()
    )
    if not open_entry:
        raise HTTPException(status_code=400, detail="Not currently clocked in")
    now = datetime.utcnow()
    open_entry.clock_out = now
    open_entry.duration_minutes = (now - open_entry.clock_in.replace(tzinfo=None)).total_seconds() / 60
    if isinstance(data, dict):
        open_entry.notes = data.get("notes") or open_entry.notes
    db.commit()
    db.refresh(open_entry)
    hours = open_entry.duration_minutes / 60
    return {
        "id": open_entry.id,
        "clock_in": open_entry.clock_in.isoformat(),
        "clock_out": open_entry.clock_out.isoformat(),
        "duration_minutes": round(open_entry.duration_minutes, 2),
        "hours": round(hours, 2),
        "status": "clocked_out",
    }


@app.get("/api/timeclock/status")
def timeclock_status(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    username = current["sub"]
    open_entry = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == username, models.TimeEntry.clock_out == None)
        .first()
    )
    if open_entry:
        return {"clocked_in": True, "clock_in": open_entry.clock_in.isoformat(), "entry_id": open_entry.id}
    return {"clocked_in": False}


@app.get("/api/timeclock/my-entries")
def my_entries(db: Session = Depends(get_db), current: dict = Depends(require_auth)):
    entries = (
        db.query(models.TimeEntry)
        .filter(models.TimeEntry.username == current["sub"])
        .order_by(models.TimeEntry.clock_in.desc())
        .limit(30)
        .all()
    )
    return [
        {
            "id": e.id,
            "clock_in": e.clock_in.isoformat() if e.clock_in else None,
            "clock_out": e.clock_out.isoformat() if e.clock_out else None,
            "duration_minutes": round(e.duration_minutes, 2) if e.duration_minutes else None,
            "notes": e.notes,
        }
        for e in entries
    ]


@app.get("/api/timeclock/report")
def timeclock_report(
    user: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    tid = current.get("tenant_id")
    q = db.query(models.TimeEntry)
    if tid and not current.get("is_superadmin"):
        q = q.filter(models.TimeEntry.tenant_id == tid)
    if user:
        q = q.filter(models.TimeEntry.username == user)
    if date_from:
        try:
            q = q.filter(models.TimeEntry.clock_in >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            q = q.filter(models.TimeEntry.clock_in < end)
        except ValueError:
            pass
    entries = q.order_by(models.TimeEntry.clock_in.desc()).all()
    rows = []
    for e in entries:
        rows.append({
            "id": e.id,
            "username": e.username,
            "clock_in": e.clock_in.isoformat() if e.clock_in else None,
            "clock_out": e.clock_out.isoformat() if e.clock_out else None,
            "duration_minutes": round(e.duration_minutes, 2) if e.duration_minutes else None,
            "notes": e.notes,
        })
    return rows


@app.get("/api/timeclock/report/export")
def timeclock_export(
    user: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current: dict = Depends(require_admin),
):
    from fastapi.responses import StreamingResponse
    import io, csv as csv_mod

    tid = current.get("tenant_id")
    q = db.query(models.TimeEntry)
    if tid and not current.get("is_superadmin"):
        q = q.filter(models.TimeEntry.tenant_id == tid)
    if user:
        q = q.filter(models.TimeEntry.username == user)
    if date_from:
        try:
            q = q.filter(models.TimeEntry.clock_in >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            end = datetime.fromisoformat(date_to) + timedelta(days=1)
            q = q.filter(models.TimeEntry.clock_in < end)
        except ValueError:
            pass
    entries = q.order_by(models.TimeEntry.clock_in.asc()).all()

    output = io.StringIO()
    writer = csv_mod.writer(output)
    writer.writerow(["ID", "Username", "Clock In", "Clock Out", "Hours", "Minutes", "Notes"])
    for e in entries:
        hours = round(e.duration_minutes / 60, 4) if e.duration_minutes else ""
        mins = round(e.duration_minutes, 2) if e.duration_minutes else ""
        writer.writerow([
            e.id,
            e.username,
            e.clock_in.strftime("%Y-%m-%d %H:%M:%S") if e.clock_in else "",
            e.clock_out.strftime("%Y-%m-%d %H:%M:%S") if e.clock_out else "Still clocked in",
            hours,
            mins,
            e.notes or "",
        ])
    output.seek(0)
    filename = f"timeclock_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── FBA Inbound Shipments ────────────────────────────────────────────────────

@app.post("/api/fba/lookup")
async def fba_lookup(body: dict = Body(...), current: dict = Depends(require_auth)):
    """Catalog Items API: title, dims, weight, BSR for an ASIN."""
    asin = (body.get("asin") or "").strip().upper()
    if not asin:
        raise HTTPException(400, "asin required")
    try:
        import fba_shipping
        return await fba_shipping.lookup_asin(asin, tenant_id=current["tenant_id"])
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_lookup] tenant={current.get('tenant_id')} asin={asin} error: {e}", flush=True)
        raise HTTPException(502, f"ASIN lookup error: {e}")


@app.post("/api/fba/fees")
async def fba_fees(body: dict = Body(...), current: dict = Depends(require_auth)):
    """Product Fees API: referral + FBA fulfillment fee estimate."""
    asin  = (body.get("asin") or "").strip().upper()
    price = float(body.get("price") or 0)
    if not asin or price <= 0:
        raise HTTPException(400, "asin and price required")
    try:
        import fba_shipping
        return await fba_shipping.estimate_fees(asin, price, tenant_id=current["tenant_id"])
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_fees] tenant={current.get('tenant_id')} asin={asin} error: {e}", flush=True)
        raise HTTPException(502, f"Fee estimate error: {e}")


@app.post("/api/fba/plan")
async def fba_plan(body: dict = Body(...), current: dict = Depends(require_auth)):
    """FBA Inbound v0: create shipment plan — returns FC assignment."""
    items        = body.get("items") or []
    from_address = body.get("from_address") or {}
    label_prep   = body.get("label_prep", "SELLER_LABEL")
    if not items or not from_address:
        raise HTTPException(400, "items and from_address required")
    try:
        import fba_shipping
        return await fba_shipping.create_plan(items, from_address,
                                              tenant_id=current["tenant_id"],
                                              label_prep=label_prep)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_plan] tenant={current.get('tenant_id')} error: {e}", flush=True)
        raise HTTPException(502, f"FBA plan error: {e}")


@app.post("/api/fba/shipments")
async def fba_create_shipment(body: dict = Body(...), current: dict = Depends(require_auth),
                               db: Session = Depends(get_db)):
    """Create FBA shipment record in Amazon + persist to DB."""
    import json as _json
    plan          = body.get("plan") or {}
    shipment_name = body.get("shipment_name", "")
    from_address  = body.get("from_address") or {}
    items         = body.get("items") or []
    asin          = (body.get("asin") or "").strip().upper()
    seller_sku    = body.get("seller_sku", "")
    title         = body.get("title", "")
    quantity      = int(body.get("quantity") or 1)
    referral_fee  = body.get("referral_fee")
    fba_fee       = body.get("fba_fee")

    if not plan or not from_address or not items:
        raise HTTPException(400, "plan, from_address and items required")

    try:
        import fba_shipping
        amazon_id = await fba_shipping.create_shipment(
            plan, shipment_name, from_address, items,
            tenant_id=current["tenant_id"]
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_create_shipment] tenant={current.get('tenant_id')} error: {e}", flush=True)
        raise HTTPException(502, f"FBA create shipment error: {e}")

    try:
        optimized = await fba_shipping.check_optimized_eligible(
            amazon_id, tenant_id=current["tenant_id"]
        )
    except Exception:
        optimized = None

    shipment = models.FBAShipment(
        tenant_id          = current["tenant_id"],
        user_id            = current.get("user_id"),
        asin               = asin,
        seller_sku         = seller_sku,
        title              = title,
        quantity           = quantity,
        shipment_name      = shipment_name,
        amazon_shipment_id = amazon_id,
        destination_fc     = plan.get("destination_fc"),
        ship_to_address    = _json.dumps(plan.get("ship_to_address") or {}),
        referral_fee       = referral_fee,
        fba_fee            = fba_fee,
        optimized_eligible = optimized,
        from_address       = _json.dumps(from_address),
        status             = "submitted",
    )
    db.add(shipment)
    db.commit()
    db.refresh(shipment)

    return {
        "id":                  shipment.id,
        "amazon_shipment_id":  amazon_id,
        "destination_fc":      plan.get("destination_fc"),
        "optimized_eligible":  optimized,
        "status":              shipment.status,
    }


@app.get("/api/fba/shipments")
async def fba_list_shipments(current: dict = Depends(require_auth),
                              db: Session = Depends(get_db)):
    """List all FBA shipments for this tenant."""
    rows = (db.query(models.FBAShipment)
            .filter(models.FBAShipment.tenant_id == current["tenant_id"])
            .order_by(models.FBAShipment.created_at.desc())
            .limit(200)
            .all())
    return [
        {
            "id":                  r.id,
            "asin":                r.asin,
            "seller_sku":          r.seller_sku,
            "title":               r.title,
            "quantity":            r.quantity,
            "shipment_name":       r.shipment_name,
            "amazon_shipment_id":  r.amazon_shipment_id,
            "destination_fc":      r.destination_fc,
            "transport_status":    r.transport_status,
            "estimated_cost":      r.estimated_cost,
            "status":              r.status,
            "optimized_eligible":  r.optimized_eligible,
            "created_at":          r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@app.get("/api/fba/shipments/{shipment_id}")
async def fba_get_shipment(shipment_id: int, current: dict = Depends(require_auth),
                            db: Session = Depends(get_db)):
    row = (db.query(models.FBAShipment)
           .filter(models.FBAShipment.id == shipment_id,
                   models.FBAShipment.tenant_id == current["tenant_id"])
           .first())
    if not row:
        raise HTTPException(404, "Shipment not found")
    import json as _json
    return {
        "id":                  row.id,
        "asin":                row.asin,
        "seller_sku":          row.seller_sku,
        "title":               row.title,
        "quantity":            row.quantity,
        "shipment_name":       row.shipment_name,
        "amazon_shipment_id":  row.amazon_shipment_id,
        "destination_fc":      row.destination_fc,
        "ship_to_address":     _json.loads(row.ship_to_address or "{}"),
        "from_address":        _json.loads(row.from_address or "{}"),
        "packages_json":       _json.loads(row.packages_json or "[]"),
        "transport_status":    row.transport_status,
        "estimated_cost":      row.estimated_cost,
        "transport_currency":  row.transport_currency,
        "referral_fee":        row.referral_fee,
        "fba_fee":             row.fba_fee,
        "optimized_eligible":  row.optimized_eligible,
        "status":              row.status,
        "label_url":           row.label_url,
        "created_at":          row.created_at.isoformat() if row.created_at else None,
    }


@app.post("/api/fba/shipments/{shipment_id}/transport")
async def fba_set_transport(shipment_id: int, body: dict = Body(...),
                             current: dict = Depends(require_auth),
                             db: Session = Depends(get_db)):
    """Submit box dims/weight to Amazon and poll for rate estimate."""
    import json as _json
    row = (db.query(models.FBAShipment)
           .filter(models.FBAShipment.id == shipment_id,
                   models.FBAShipment.tenant_id == current["tenant_id"])
           .first())
    if not row:
        raise HTTPException(404, "Shipment not found")
    if not row.amazon_shipment_id:
        raise HTTPException(400, "No Amazon shipment ID on record")

    packages     = body.get("packages") or []
    is_partnered = body.get("is_partnered", True)
    if not packages:
        raise HTTPException(400, "packages required")

    try:
        import fba_shipping
        await fba_shipping.set_transport(row.amazon_shipment_id, packages,
                                         tenant_id=current["tenant_id"],
                                         is_partnered=is_partnered)
        rate = await fba_shipping.get_transport(row.amazon_shipment_id,
                                                tenant_id=current["tenant_id"])
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_set_transport] shipment={shipment_id} error: {e}", flush=True)
        raise HTTPException(502, f"Transport error: {e}")

    row.packages_json      = _json.dumps(packages)
    row.transport_status   = rate.get("status")
    row.estimated_cost     = rate.get("estimated_cost")
    row.transport_currency = rate.get("currency")
    row.status             = "transport_pending"
    db.commit()

    return rate


@app.get("/api/fba/shipments/{shipment_id}/transport")
async def fba_get_transport(shipment_id: int, current: dict = Depends(require_auth),
                             db: Session = Depends(get_db)):
    """Poll Amazon for current transport rate status."""
    row = (db.query(models.FBAShipment)
           .filter(models.FBAShipment.id == shipment_id,
                   models.FBAShipment.tenant_id == current["tenant_id"])
           .first())
    if not row:
        raise HTTPException(404, "Shipment not found")
    try:
        import fba_shipping
        rate = await fba_shipping.get_transport(row.amazon_shipment_id,
                                                tenant_id=current["tenant_id"],
                                                max_polls=1)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Transport poll error: {e}")
    row.transport_status   = rate.get("status")
    row.estimated_cost     = rate.get("estimated_cost")
    row.transport_currency = rate.get("currency")
    db.commit()
    return rate


@app.post("/api/fba/shipments/{shipment_id}/transport/confirm")
async def fba_confirm_transport(shipment_id: int, current: dict = Depends(require_auth),
                                 db: Session = Depends(get_db)):
    """Confirm (pay for) the partnered carrier rate."""
    row = (db.query(models.FBAShipment)
           .filter(models.FBAShipment.id == shipment_id,
                   models.FBAShipment.tenant_id == current["tenant_id"])
           .first())
    if not row:
        raise HTTPException(404, "Shipment not found")
    try:
        import fba_shipping
        await fba_shipping.confirm_transport(row.amazon_shipment_id,
                                             tenant_id=current["tenant_id"])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Transport confirm error: {e}")
    row.transport_status = "CONFIRMED"
    row.status           = "transport_confirmed"
    db.commit()
    return {"ok": True, "status": "CONFIRMED"}


@app.post("/api/fba/shipments/{shipment_id}/transport/void")
async def fba_void_transport(shipment_id: int, current: dict = Depends(require_auth),
                              db: Session = Depends(get_db)):
    """Void the partnered carrier rate (before it ships)."""
    row = (db.query(models.FBAShipment)
           .filter(models.FBAShipment.id == shipment_id,
                   models.FBAShipment.tenant_id == current["tenant_id"])
           .first())
    if not row:
        raise HTTPException(404, "Shipment not found")
    try:
        import fba_shipping
        await fba_shipping.void_transport(row.amazon_shipment_id,
                                          tenant_id=current["tenant_id"])
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_void_transport] tenant={current.get('tenant_id')} error: {e}", flush=True)
        raise HTTPException(502, f"Transport void error: {e}")
    row.transport_status = "VOIDED"
    row.status           = "voided"
    db.commit()
    return {"ok": True, "status": "VOIDED"}


@app.get("/api/fba/shipments/{shipment_id}/labels")
async def fba_get_labels(shipment_id: int, current: dict = Depends(require_auth),
                          db: Session = Depends(get_db),
                          label_type: str = "UNIQUE",
                          page_type: str = "PackageLabel_Letter_2"):
    """Fetch box label download URL from Amazon."""
    row = (db.query(models.FBAShipment)
           .filter(models.FBAShipment.id == shipment_id,
                   models.FBAShipment.tenant_id == current["tenant_id"])
           .first())
    if not row:
        raise HTTPException(404, "Shipment not found")
    try:
        import fba_shipping
        url = await fba_shipping.get_labels(row.amazon_shipment_id,
                                            tenant_id=current["tenant_id"],
                                            label_type=label_type,
                                            page_type=page_type)
    except HTTPException:
        raise
    except Exception as e:
        print(f"[fba_get_labels] tenant={current.get('tenant_id')} error: {e}", flush=True)
        raise HTTPException(502, f"Labels fetch error: {e}")
    row.label_url = url
    row.status    = "labeled"
    db.commit()
    return {"label_url": url}


@app.post("/api/amazon/fba-listings")
async def create_fba_listings(
    body: dict,
    db: Session = Depends(get_db),
    current: dict = Depends(require_auth),
):
    """Create FBA offer-only listings on Amazon via Listings Items API."""
    import httpx as _httpx

    tenant_id = current.get("tenant_id")
    cred = _get_tenant_amazon_creds(tenant_id, db)
    if not cred or not cred.sp_refresh_token:
        raise HTTPException(400, "Amazon account not connected")

    seller_id = cred.seller_id or os.getenv("AMAZON_SELLER_ID", "")
    if not seller_id:
        raise HTTPException(400, "AMAZON_SELLER_ID not configured — add it in Amazon Settings")

    marketplace_id = cred.marketplace_id or os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")
    access_token = await _get_tenant_access_token(cred)
    sp_base = _sp_base(cred.is_sandbox)

    condition_map = {
        "NewItem":       "new_new",
        "UsedLikeNew":   "used_like_new",
        "UsedVeryGood":  "used_very_good",
        "UsedGood":      "used_good",
        "UsedAcceptable": "used_acceptable",
    }

    listings = body.get("listings", [])
    if not listings:
        raise HTTPException(400, "No listings provided")

    results = []
    async with _httpx.AsyncClient(timeout=30) as client:
        for item in listings:
            asin      = (item.get("asin") or "").strip().upper()
            sku       = (item.get("sku") or "").strip()
            price     = float(item.get("price") or 0)
            condition = item.get("condition", "NewItem")

            if not asin or not sku or not price:
                results.append({"asin": asin, "sku": sku, "success": False,
                                 "error": "Missing asin, sku, or price"})
                continue

            payload = {
                "productType": "PRODUCT",
                "requirements": "LISTING_OFFER_ONLY",
                "attributes": {
                    "condition_type": [{"value": condition_map.get(condition, "new_new"),
                                        "marketplace_id": marketplace_id}],
                    "merchant_suggested_asin": [{"value": asin, "marketplace_id": marketplace_id}],
                    "fulfillment_availability": [{
                        "fulfillment_channel_code": "AMAZON_NA",
                        "marketplace_id": marketplace_id,
                    }],
                    "purchasable_offer": [{
                        "currency": "USD",
                        "marketplace_id": marketplace_id,
                        "our_price": [{"schedule": [{"value_with_tax": price}]}],
                    }],
                },
            }

            try:
                resp = await client.put(
                    f"{sp_base}/listings/2021-08-01/items/{seller_id}/{sku}",
                    params={"marketplaceIds": marketplace_id},
                    json=payload,
                    headers={"x-amz-access-token": access_token,
                             "Content-Type": "application/json"},
                )
                if resp.status_code in (200, 201, 202):
                    rd = resp.json()
                    results.append({
                        "asin": asin, "sku": sku, "success": True,
                        "status": rd.get("status", "ACCEPTED"),
                        "submission_id": rd.get("submissionId"),
                    })
                else:
                    try:
                        rd = resp.json()
                        msg = (rd.get("errors") or [{}])[0].get("message", f"HTTP {resp.status_code}")
                    except Exception:
                        msg = resp.text[:200]
                    results.append({"asin": asin, "sku": sku, "success": False, "error": msg})
            except Exception as _e:
                results.append({"asin": asin, "sku": sku, "success": False, "error": str(_e)})

    return {"results": results, "submitted": len(listings), "succeeded": sum(1 for r in results if r["success"])}


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    """Healthcheck — verifies process is alive and DB is reachable."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"DB unavailable: {e}")


@app.get("/api/debug/schema", include_in_schema=False)
def debug_schema(current: dict = Depends(require_auth)):
    """Returns actual DB columns for products table — superadmin only."""
    if not current.get("is_superadmin"):
        raise HTTPException(403, "superadmin only")
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name = 'products' ORDER BY ordinal_position"
            )).fetchall()
        return {"columns": [{"name": r[0], "type": r[1]} for r in rows]}
    except Exception as e:
        return {"error": str(e)}


# ─── Serve React SPA (must be last) ───────────────────────────────────────────

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

if os.path.isdir(STATIC_DIR):
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
