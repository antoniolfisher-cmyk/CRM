"""Add missing indexes for scale

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-29
"""
from alembic import op

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        indexes = [
            ("ix_contacts_account_id",    "contacts",    "account_id"),
            ("ix_follow_ups_account_id",  "follow_ups",  "account_id"),
            ("ix_follow_ups_contact_id",  "follow_ups",  "contact_id"),
            ("ix_follow_ups_status",      "follow_ups",  "status"),
            ("ix_follow_ups_priority",    "follow_ups",  "priority"),
            ("ix_orders_account_id",      "orders",      "account_id"),
            ("ix_orders_status",          "orders",      "status"),
            ("ix_order_items_order_id",   "order_items", "order_id"),
            ("ix_accounts_status",        "accounts",    "status"),
            ("ix_accounts_account_type",  "accounts",    "account_type"),
            ("ix_products_status",        "products",    "status"),
        ]
        for idx_name, table, col in indexes:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {idx_name} ON {table} ({col})"
            )


def downgrade():
    indexes = [
        "ix_contacts_account_id",
        "ix_follow_ups_account_id",
        "ix_follow_ups_contact_id",
        "ix_follow_ups_status",
        "ix_follow_ups_priority",
        "ix_orders_account_id",
        "ix_orders_status",
        "ix_order_items_order_id",
        "ix_accounts_status",
        "ix_accounts_account_type",
        "ix_products_status",
    ]
    for idx_name in indexes:
        op.execute(f"DROP INDEX IF EXISTS {idx_name}")
