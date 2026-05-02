"""Add waitlist table

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def _has_table(conn, table):
    try:
        return inspect(conn).has_table(table)
    except Exception:
        return False


def _has_index(conn, table, index):
    try:
        return any(i['name'] == index for i in inspect(conn).get_indexes(table))
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()
    if not _has_table(conn, 'waitlist'):
        op.create_table(
            'waitlist',
            sa.Column('id',          sa.Integer(),                  primary_key=True),
            sa.Column('email',       sa.String(),                   nullable=False, unique=True),
            sa.Column('name',        sa.String(),                   nullable=True),
            sa.Column('company',     sa.String(),                   nullable=True),
            sa.Column('monthly_gmv', sa.String(),                   nullable=True),
            sa.Column('source',      sa.String(),                   nullable=True),
            sa.Column('notes',       sa.Text(),                     nullable=True),
            sa.Column('created_at',  sa.DateTime(timezone=True),    server_default=sa.func.now()),
        )
    if not _has_index(conn, 'waitlist', 'ix_waitlist_email'):
        op.create_index('ix_waitlist_email',      'waitlist', ['email'])
    if not _has_index(conn, 'waitlist', 'ix_waitlist_created_at'):
        op.create_index('ix_waitlist_created_at', 'waitlist', ['created_at'])


def downgrade():
    op.drop_table('waitlist')
