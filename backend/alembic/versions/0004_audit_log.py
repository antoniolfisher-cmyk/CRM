"""Phase 3 — audit_logs table

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def _has_table(conn, name):
    return inspect(conn).has_table(name)


def upgrade():
    conn = op.get_bind()

    if not _has_table(conn, "audit_logs"):
        op.create_table(
            "audit_logs",
            sa.Column("id",        sa.Integer(), primary_key=True, index=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True, index=True),
            sa.Column("user_id",   sa.Integer(), sa.ForeignKey("users.id"),   nullable=True),
            sa.Column("username",  sa.String(),  nullable=True),
            sa.Column("action",    sa.String(),  nullable=False, index=True),
            sa.Column("target",    sa.String(),  nullable=True),
            sa.Column("detail",    sa.Text(),    nullable=True),
            sa.Column("ip",        sa.String(),  nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now(), index=True),
        )

    with op.get_context().autocommit_block():
        conn.execute(text(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_audit_logs_created_at "
            "ON audit_logs (created_at DESC)"
        ))


def downgrade():
    op.drop_table("audit_logs")
