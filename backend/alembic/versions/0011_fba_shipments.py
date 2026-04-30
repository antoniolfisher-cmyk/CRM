"""Add fba_shipments table

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def _has_table(conn, table):
    try:
        return table in inspect(conn).get_table_names()
    except Exception:
        return False


def upgrade():
    conn = op.get_bind()
    if not _has_table(conn, 'fba_shipments'):
        op.create_table(
            'fba_shipments',
            sa.Column('id',                 sa.Integer(),                   primary_key=True),
            sa.Column('tenant_id',          sa.Integer(),                   sa.ForeignKey('tenants.id'), nullable=False),
            sa.Column('user_id',            sa.Integer(),                   sa.ForeignKey('users.id'),   nullable=True),
            sa.Column('asin',               sa.String(),                    nullable=False),
            sa.Column('seller_sku',         sa.String(),                    nullable=True),
            sa.Column('title',              sa.String(),                    nullable=True),
            sa.Column('quantity',           sa.Integer(),                   nullable=False, server_default='1'),
            sa.Column('shipment_name',      sa.String(),                    nullable=True),
            sa.Column('amazon_shipment_id', sa.String(),                    nullable=True),
            sa.Column('destination_fc',     sa.String(),                    nullable=True),
            sa.Column('ship_to_address',    sa.Text(),                      nullable=True),
            sa.Column('transport_status',   sa.String(),                    nullable=True),
            sa.Column('estimated_cost',     sa.Float(),                     nullable=True),
            sa.Column('transport_currency', sa.String(),                    nullable=True),
            sa.Column('referral_fee',       sa.Float(),                     nullable=True),
            sa.Column('fba_fee',            sa.Float(),                     nullable=True),
            sa.Column('optimized_eligible', sa.Boolean(),                   nullable=True),
            sa.Column('status',             sa.String(),                    nullable=True, server_default='planning'),
            sa.Column('label_url',          sa.Text(),                      nullable=True),
            sa.Column('from_address',       sa.Text(),                      nullable=True),
            sa.Column('packages_json',      sa.Text(),                      nullable=True),
            sa.Column('created_at',         sa.DateTime(timezone=True),     server_default=sa.func.now()),
            sa.Column('updated_at',         sa.DateTime(timezone=True),     nullable=True),
        )
        op.create_index('ix_fba_shipments_tenant_id',          'fba_shipments', ['tenant_id'])
        op.create_index('ix_fba_shipments_amazon_shipment_id', 'fba_shipments', ['amazon_shipment_id'])
        op.create_index('ix_fba_shipments_created_at',         'fba_shipments', ['created_at'])


def downgrade():
    pass
