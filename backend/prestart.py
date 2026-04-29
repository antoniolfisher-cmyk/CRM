"""
Pre-start script: runs once before uvicorn spawns workers.
Handles DB migrations so workers don't race each other on startup.
"""
import os
import sys
import logging

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
log = logging.getLogger("prestart")

db_url = os.getenv("DATABASE_URL", "sqlite:///./crm.db").replace("postgres://", "postgresql://", 1)
is_sqlite = db_url.startswith("sqlite")


def run_migrations():
    try:
        from alembic.config import Config
        from alembic import command
        from alembic.runtime.migration import MigrationContext
        from sqlalchemy import create_engine as _ce

        cfg = Config()
        cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "alembic"))
        cfg.set_main_option("sqlalchemy.url", db_url)

        # Fix broken chain: if version table has stale '0001' instead of '0001_safe_new_tables'
        try:
            _eng = _ce(db_url)
            with _eng.connect() as _conn:
                ctx = MigrationContext.configure(_conn)
                current = ctx.get_current_heads()
                if current and "0001_safe_new_tables" not in current and "0001" in current:
                    log.warning("Fixing broken Alembic chain — stamping 0001_safe_new_tables")
                    command.stamp(cfg, "0001_safe_new_tables")
            _eng.dispose()
        except Exception as e:
            log.warning("Alembic chain check skipped: %s", e)

        command.upgrade(cfg, "head")
        log.info("Alembic migrations applied")
    except Exception as e:
        log.warning("Alembic migration skipped: %s", e)

    # Safety net: ensure critical columns exist even if Alembic failed
    if not is_sqlite:
        try:
            from sqlalchemy import create_engine as _ce, text
            _eng = _ce(db_url)
            with _eng.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER DEFAULT 0"))
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ"))
                conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ"))
                conn.execute(text("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
            _eng.dispose()
            log.info("Column safety-net applied")
        except Exception as e:
            log.warning("Column safety-net skipped: %s", e)


def seed():
    try:
        import seed_if_empty  # noqa: F401 — side-effectful import
        log.info("Seed check complete")
    except Exception as e:
        log.warning("Seed skipped: %s", e)


if __name__ == "__main__":
    log.info("=== Pre-start ===")
    run_migrations()
    seed()
    log.info("=== Pre-start complete — handing off to uvicorn ===")
