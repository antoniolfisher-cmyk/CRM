"""Phase 2 security — widen encrypted credential columns, add missing tenant columns

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-29

Safe to run on existing production DB — uses IF NOT EXISTS / column checks.
Widens lwa_client_secret and sp_refresh_token to TEXT so Fernet-encrypted
values (which are ~180+ chars) always fit regardless of original VARCHAR length.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def _has_column(conn, table, column):
    try:
        return column in [c['name'] for c in inspect(conn).get_columns(table)]
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()

    # ── Widen encrypted credential columns to TEXT ────────────────────────────
    # Fernet tokens are ~180 chars; VARCHAR(255) is fine but TEXT is safer.
    for col in ("lwa_client_secret", "sp_refresh_token"):
        conn.execute(text(
            f"ALTER TABLE amazon_credentials ALTER COLUMN {col} TYPE TEXT"
        ))

    # ── tenants: add trial_ends_at if missing ────────────────────────────────
    if not _has_column(conn, "tenants", "trial_ends_at"):
        op.add_column("tenants", sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True))

    # ── tenants: add stripe_customer_id if missing ───────────────────────────
    if not _has_column(conn, "tenants", "stripe_customer_id"):
        op.add_column("tenants", sa.Column("stripe_customer_id", sa.String(), nullable=True))

    # ── tenants: add stripe_subscription_id if missing ───────────────────────
    if not _has_column(conn, "tenants", "stripe_subscription_id"):
        op.add_column("tenants", sa.Column("stripe_subscription_id", sa.String(), nullable=True))

    # ── users: add notify_email if missing ───────────────────────────────────
    if not _has_column(conn, "users", "notify_email"):
        op.add_column("users", sa.Column("notify_email", sa.Boolean(), server_default="true"))

    # ── users: add last_login_at if missing ──────────────────────────────────
    if not _has_column(conn, "users", "last_login_at"):
        op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))

    # ── accounts: add last_auto_followup_at if missing ───────────────────────
    if not _has_column(conn, "accounts", "last_auto_followup_at"):
        op.add_column("accounts", sa.Column("last_auto_followup_at", sa.DateTime(timezone=True), nullable=True))

    # ── Index: tenant lookups on stripe fields ────────────────────────────────
    with op.get_context().autocommit_block():
        conn.execute(text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tenants_stripe_status "
            "ON tenants (stripe_status)"
        ))
        conn.execute(text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_tenant_id "
            "ON users (tenant_id)"
        ))
        conn.execute(text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_email "
            "ON users (email)"
        ))
        conn.execute(text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_amazon_credentials_tenant_id "
            "ON amazon_credentials (tenant_id)"
        ))


def downgrade():
    pass  # column type changes are not reversed — data safety
