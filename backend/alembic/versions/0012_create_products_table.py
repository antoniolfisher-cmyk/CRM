"""Create products table if it doesn't exist

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-30

The products table was defined in models.py but never covered by a migration.
On databases provisioned before the table existed, create_all() silently fails
(SQLAlchemy 2.0 API mismatch with the bind= kwarg). This migration creates it
directly with full schema, safe to run multiple times.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def _has_table(conn, name):
    try:
        return inspect(conn).has_table(name)
    except Exception:
        return False


def _has_column(conn, table, col):
    try:
        return col in [c['name'] for c in inspect(conn).get_columns(table)]
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()

    if not _has_table(conn, 'products'):
        op.execute(text("""
            CREATE TABLE products (
                id                      SERIAL PRIMARY KEY,
                tenant_id               INTEGER REFERENCES tenants(id),
                created_by              VARCHAR,
                asin                    VARCHAR,
                product_name            VARCHAR,
                amazon_url              VARCHAR,
                purchase_link           VARCHAR,
                date_found              TIMESTAMPTZ,
                va_finder               VARCHAR,
                date_purchased          TIMESTAMPTZ,
                order_number            VARCHAR,
                quantity                FLOAT DEFAULT 0,
                buy_cost                FLOAT DEFAULT 0,
                money_spent             FLOAT DEFAULT 0,
                arrived_at_prep         TIMESTAMPTZ,
                date_sent_to_amazon     TIMESTAMPTZ,
                amazon_tracking_number  VARCHAR,
                ungated                 BOOLEAN DEFAULT FALSE,
                ungating_quantity       FLOAT DEFAULT 0,
                total_bought            FLOAT DEFAULT 0,
                replenish               BOOLEAN DEFAULT FALSE,
                amazon_fee              FLOAT DEFAULT 0,
                total_cost              FLOAT DEFAULT 0,
                buy_box                 FLOAT DEFAULT 0,
                profit                  FLOAT DEFAULT 0,
                profit_margin           FLOAT DEFAULT 0,
                roi                     FLOAT DEFAULT 0,
                estimated_sales         FLOAT DEFAULT 0,
                num_sellers             INTEGER DEFAULT 0,
                notes                   TEXT,
                created_at              TIMESTAMPTZ DEFAULT NOW(),
                updated_at              TIMESTAMPTZ,
                keepa_bsr               INTEGER,
                keepa_category          VARCHAR,
                keepa_last_synced       TIMESTAMPTZ,
                price_90_high           FLOAT,
                price_90_low            FLOAT,
                price_90_median         FLOAT,
                fba_low                 FLOAT,
                fba_high                FLOAT,
                fba_median              FLOAT,
                fbm_low                 FLOAT,
                fbm_high                FLOAT,
                fbm_median              FLOAT,
                status                  VARCHAR DEFAULT 'sourcing',
                seller_sku              VARCHAR,
                aria_suggested_price    FLOAT,
                aria_suggested_at       TIMESTAMPTZ,
                aria_reasoning          TEXT,
                aria_last_buy_box       FLOAT,
                aria_strategy_id        INTEGER,
                aria_live_price         FLOAT,
                aria_live_pushed_at     TIMESTAMPTZ,
                buy_box_winner          BOOLEAN,
                buy_box_checked_at      TIMESTAMPTZ,
                fulfillment_channel     VARCHAR
            )
        """))

        op.create_index('ix_products_id',       'products', ['id'])
        op.create_index('ix_products_asin',     'products', ['asin'])
        op.create_index('ix_products_tenant_id','products', ['tenant_id'])
        op.create_index('ix_products_created_by','products', ['created_by'])
        op.create_index('ix_products_status',   'products', ['status'])
        op.create_index('ix_products_seller_sku','products', ['seller_sku'])
    else:
        # Table exists — ensure all columns are present
        cols = [c['name'] for c in inspect(conn).get_columns('products')]
        new_cols = [
            ('keepa_bsr',           'INTEGER'),
            ('keepa_category',      'VARCHAR'),
            ('keepa_last_synced',   'TIMESTAMPTZ'),
            ('price_90_high',       'FLOAT'),
            ('price_90_low',        'FLOAT'),
            ('price_90_median',     'FLOAT'),
            ('fba_low',             'FLOAT'),
            ('fba_high',            'FLOAT'),
            ('fba_median',          'FLOAT'),
            ('fbm_low',             'FLOAT'),
            ('fbm_high',            'FLOAT'),
            ('fbm_median',          'FLOAT'),
            ('status',              "VARCHAR DEFAULT 'sourcing'"),
            ('seller_sku',          'VARCHAR'),
            ('aria_suggested_price','FLOAT'),
            ('aria_suggested_at',   'TIMESTAMPTZ'),
            ('aria_reasoning',      'TEXT'),
            ('aria_last_buy_box',   'FLOAT'),
            ('aria_strategy_id',    'INTEGER'),
            ('aria_live_price',     'FLOAT'),
            ('aria_live_pushed_at', 'TIMESTAMPTZ'),
            ('buy_box_winner',      'BOOLEAN'),
            ('buy_box_checked_at',  'TIMESTAMPTZ'),
            ('fulfillment_channel', 'VARCHAR'),
            ('created_by',          'VARCHAR'),
            ('tenant_id',           'INTEGER'),
        ]
        for col_name, col_type in new_cols:
            if col_name not in cols:
                op.execute(text(f"ALTER TABLE products ADD COLUMN {col_name} {col_type}"))


def downgrade():
    pass
