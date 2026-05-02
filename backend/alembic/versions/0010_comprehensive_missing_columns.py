"""Add all model columns that were never covered by a migration

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-30

These columns exist in models.py but were never added via Alembic.
They were present in DBs created fresh by create_all(), but any DB
created at an older code version is missing them.  All checks are
idempotent (IF NOT EXISTS) so this is always safe to re-run.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = '0010'
down_revision = '0009'
branch_labels = None
depends_on = None


def _has_column(conn, table, col):
    try:
        return col in [c['name'] for c in inspect(conn).get_columns(table)]
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()

    # ── tenants ───────────────────────────────────────────────────────────────
    if not _has_column(conn, 'tenants', 'stripe_price_id'):
        op.add_column('tenants', sa.Column('stripe_price_id', sa.String(), nullable=True))
    if not _has_column(conn, 'tenants', 'stripe_status'):
        op.add_column('tenants', sa.Column('stripe_status', sa.String(), nullable=True))

    # ── amazon_credentials ────────────────────────────────────────────────────
    if not _has_column(conn, 'amazon_credentials', 'store_name'):
        op.add_column('amazon_credentials', sa.Column('store_name', sa.String(), nullable=True))
    if not _has_column(conn, 'amazon_credentials', 'connected_at'):
        op.add_column('amazon_credentials', sa.Column('connected_at', sa.DateTime(timezone=True), nullable=True))
    if not _has_column(conn, 'amazon_credentials', 'connected_by'):
        op.add_column('amazon_credentials', sa.Column('connected_by', sa.String(), nullable=True))
    if not _has_column(conn, 'amazon_credentials', 'ship_from_json'):
        op.add_column('amazon_credentials', sa.Column('ship_from_json', sa.Text(), nullable=True))

    # ── accounts ──────────────────────────────────────────────────────────────
    if not _has_column(conn, 'accounts', 'pipeline_stage'):
        op.add_column('accounts', sa.Column('pipeline_stage', sa.String(), nullable=False, server_default='new'))
    if not _has_column(conn, 'accounts', 'pipeline_updated_at'):
        op.add_column('accounts', sa.Column('pipeline_updated_at', sa.DateTime(timezone=True), nullable=True))

    # ── products: Keepa fields ─────────────────────────────────────────────────
    for col, typ in [
        ('keepa_bsr',          sa.Integer()),
        ('keepa_category',     sa.String()),
        ('keepa_last_synced',  sa.DateTime(timezone=True)),
        ('price_90_high',      sa.Float()),
        ('price_90_low',       sa.Float()),
        ('price_90_median',    sa.Float()),
        ('fba_low',            sa.Float()),
        ('fba_high',           sa.Float()),
        ('fba_median',         sa.Float()),
        ('fbm_low',            sa.Float()),
        ('fbm_high',           sa.Float()),
        ('fbm_median',         sa.Float()),
    ]:
        if not _has_column(conn, 'products', col):
            op.add_column('products', sa.Column(col, typ, nullable=True))

    # ── products: Aria repricer fields ────────────────────────────────────────
    for col, typ in [
        ('seller_sku',          sa.String()),
        ('aria_suggested_price', sa.Float()),
        ('aria_suggested_at',    sa.DateTime(timezone=True)),
        ('aria_reasoning',       sa.Text()),
        ('aria_last_buy_box',    sa.Float()),
        ('aria_strategy_id',     sa.Integer()),
        ('aria_live_price',      sa.Float()),
        ('aria_live_pushed_at',  sa.DateTime(timezone=True)),
        ('buy_box_winner',       sa.Boolean()),
        ('buy_box_checked_at',   sa.DateTime(timezone=True)),
        ('fulfillment_channel',  sa.String()),
    ]:
        if not _has_column(conn, 'products', col):
            op.add_column('products', sa.Column(col, typ, nullable=True))

    # ── repricer_strategies ───────────────────────────────────────────────────
    if not _has_column(conn, 'repricer_strategies', 'min_roi'):
        op.add_column('repricer_strategies', sa.Column('min_roi', sa.Float(), nullable=True))
    if not _has_column(conn, 'repricer_strategies', 'aggressiveness'):
        op.add_column('repricer_strategies', sa.Column('aggressiveness', sa.Integer(), nullable=True))

    # ── repricer_logs ─────────────────────────────────────────────────────────
    if not _has_column(conn, 'repricer_logs', 'seller_sku'):
        op.add_column('repricer_logs', sa.Column('seller_sku', sa.String(), nullable=True))
    if not _has_column(conn, 'repricer_logs', 'amazon_status'):
        op.add_column('repricer_logs', sa.Column('amazon_status', sa.Integer(), nullable=True))


def downgrade():
    pass  # non-destructive — dropping optional columns risks data loss
