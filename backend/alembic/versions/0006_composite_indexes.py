"""Composite indexes for tenant-scoped hot queries

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-29
"""
from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        indexes = [
            # accounts: tenant_id + sort/filter columns
            ("ix_accounts_tenant_name",       "accounts",    "tenant_id, name"),
            ("ix_accounts_tenant_status",     "accounts",    "tenant_id, status"),
            # follow_ups: tenant_id + sort/filter columns + partial overdue
            ("ix_follow_ups_tenant_due",      "follow_ups",  "tenant_id, due_date"),
            ("ix_follow_ups_tenant_status",   "follow_ups",  "tenant_id, status"),
            ("ix_follow_ups_tenant_acct",     "follow_ups",  "tenant_id, account_id"),
            # orders: tenant_id + sort/filter columns
            ("ix_orders_tenant_date",         "orders",      "tenant_id, order_date"),
            ("ix_orders_tenant_status",       "orders",      "tenant_id, status"),
            ("ix_orders_tenant_acct",         "orders",      "tenant_id, account_id"),
            # products: tenant_id + sort/filter columns
            ("ix_products_tenant_created",    "products",    "tenant_id, created_at"),
            ("ix_products_tenant_status",     "products",    "tenant_id, status"),
            # user + tenant lookups
            ("ix_users_tenant_id",            "users",       "tenant_id"),
            # audit log queries (tenant + recency)
            ("ix_audit_logs_tenant_created",  "audit_logs",  "tenant_id, created_at"),
        ]
        for idx_name, table, cols in indexes:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {idx_name} ON {table} ({cols})"
            )

        # Partial index for the very common "overdue follow-ups" dashboard query
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_follow_ups_overdue "
            "ON follow_ups (tenant_id, due_date) WHERE status = 'pending'"
        )


def downgrade():
    indexes = [
        "ix_accounts_tenant_name",
        "ix_accounts_tenant_status",
        "ix_follow_ups_tenant_due",
        "ix_follow_ups_tenant_status",
        "ix_follow_ups_tenant_acct",
        "ix_orders_tenant_date",
        "ix_orders_tenant_status",
        "ix_orders_tenant_acct",
        "ix_products_tenant_created",
        "ix_products_tenant_status",
        "ix_users_tenant_id",
        "ix_audit_logs_tenant_created",
        "ix_follow_ups_overdue",
    ]
    for idx_name in indexes:
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {idx_name}")
