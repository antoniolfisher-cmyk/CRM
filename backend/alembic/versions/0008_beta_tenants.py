"""Add is_beta flag to tenants

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def _has_column(conn, table, col):
    try:
        return col in [c['name'] for c in inspect(conn).get_columns(table)]
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()
    if not _has_column(conn, 'tenants', 'is_beta'):
        op.add_column('tenants', sa.Column('is_beta', sa.Boolean(), server_default='false', nullable=False))


def downgrade():
    op.drop_column('tenants', 'is_beta')
