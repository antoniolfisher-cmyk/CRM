"""Add dashboard_sections and page_permissions to users

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def _has_column(conn, table, col):
    try:
        return col in [c['name'] for c in inspect(conn).get_columns(table)]
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()
    if not _has_column(conn, 'users', 'dashboard_sections'):
        op.add_column('users', sa.Column('dashboard_sections', sa.Text(), nullable=True))
    if not _has_column(conn, 'users', 'page_permissions'):
        op.add_column('users', sa.Column('page_permissions', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('users', 'page_permissions')
    op.drop_column('users', 'dashboard_sections')
