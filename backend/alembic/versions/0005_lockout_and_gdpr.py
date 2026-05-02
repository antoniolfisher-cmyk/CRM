"""Critical: account lockout columns and tenant GDPR deletion

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def _has_column(conn, table, col):
    try:
        return col in [c['name'] for c in inspect(conn).get_columns(table)]
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()

    # users: account lockout
    if not _has_column(conn, 'users', 'failed_login_count'):
        op.add_column('users', sa.Column('failed_login_count', sa.Integer(), server_default='0'))
    if not _has_column(conn, 'users', 'locked_until'):
        op.add_column('users', sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))
    if not _has_column(conn, 'users', 'last_login_at'):
        op.add_column('users', sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True))

    # tenants: soft delete for GDPR erasure
    if not _has_column(conn, 'tenants', 'deleted_at'):
        op.add_column('tenants', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('users', 'failed_login_count')
    op.drop_column('users', 'locked_until')
    op.drop_column('users', 'last_login_at')
    op.drop_column('tenants', 'deleted_at')
