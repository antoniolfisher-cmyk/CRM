"""safe new tables — password_reset_tokens, email_verification_tokens, email_verified column

Revision ID: 0001_safe_new_tables
Revises:
Create Date: 2026-04-28

This migration is safe to run on an existing production database.
It uses CREATE TABLE IF NOT EXISTS and column-existence checks so it
never fails if the objects already exist.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision: str = '0001_safe_new_tables'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(conn, name):
    return inspect(conn).has_table(name)

def _has_column(conn, table, column):
    try:
        cols = [c['name'] for c in inspect(conn).get_columns(table)]
        return column in cols
    except Exception:
        return False


def upgrade() -> None:
    conn = op.get_bind()

    # password_reset_tokens
    if not _has_table(conn, 'password_reset_tokens'):
        op.create_table(
            'password_reset_tokens',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
            sa.Column('token', sa.String(), nullable=False, unique=True, index=True),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('used', sa.Boolean(), default=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # email_verification_tokens
    if not _has_table(conn, 'email_verification_tokens'):
        op.create_table(
            'email_verification_tokens',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, index=True),
            sa.Column('token', sa.String(), nullable=False, unique=True, index=True),
            sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
            sa.Column('used', sa.Boolean(), default=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # email_verified column on users
    if not _has_column(conn, 'users', 'email_verified'):
        op.add_column('users', sa.Column('email_verified', sa.Boolean(), nullable=True))


def downgrade() -> None:
    conn = op.get_bind()
    if _has_table(conn, 'email_verification_tokens'):
        op.drop_table('email_verification_tokens')
    if _has_table(conn, 'password_reset_tokens'):
        op.drop_table('password_reset_tokens')
