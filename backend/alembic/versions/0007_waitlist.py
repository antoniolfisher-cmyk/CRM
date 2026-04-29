"""Add waitlist table

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-29
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
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
    op.create_index('ix_waitlist_email',      'waitlist', ['email'])
    op.create_index('ix_waitlist_created_at', 'waitlist', ['created_at'])


def downgrade():
    op.drop_table('waitlist')
