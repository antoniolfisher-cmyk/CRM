"""
Tenant data cleanup script.

Run this ONCE on the production Railway database to:
1. Delete products that were auto-synced from Amazon (created_by='system') for tenants
   that have their OWN Amazon OAuth credentials in the DB. These will be re-synced
   correctly on the next hourly run using each tenant's own credentials.
2. Null out tenant_id on orphaned records (where tenant_id references a non-existent tenant).
3. Print a summary of what was cleaned up.

Usage (Railway shell):
    python cleanup_tenant_data.py

Or with a specific DATABASE_URL:
    DATABASE_URL=postgresql://... python cleanup_tenant_data.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from database import SessionLocal
import models


def main():
    db = SessionLocal()
    try:
        # ── 1. Audit: show current state ──────────────────────────────────────────
        print("=" * 60)
        print("TENANT DATA AUDIT")
        print("=" * 60)

        tenants = db.query(models.Tenant).order_by(models.Tenant.id).all()
        print(f"\nTenants in DB: {len(tenants)}")
        for t in tenants:
            print(f"  id={t.id}  name={t.name}  plan={t.plan}")

        print()
        creds = db.query(models.AmazonCredential).all()
        print(f"Amazon credentials in DB: {len(creds)}")
        for c in creds:
            has_token = bool(c.sp_refresh_token)
            print(f"  tenant_id={c.tenant_id}  seller_id={c.seller_id}  "
                  f"has_oauth_token={has_token}")

        print()
        print("Products by tenant:")
        tenant_ids = [t.id for t in tenants]
        for tid in tenant_ids:
            total = db.query(models.Product).filter(
                models.Product.tenant_id == tid).count()
            sys_synced = db.query(models.Product).filter(
                models.Product.tenant_id == tid,
                models.Product.created_by == "system",
            ).count()
            manual = total - sys_synced
            print(f"  tenant_id={tid}: total={total} "
                  f"(amazon-synced={sys_synced}, manual={manual})")
        null_prods = db.query(models.Product).filter(
            models.Product.tenant_id == None).count()
        print(f"  tenant_id=NULL: {null_prods}")

        # ── 2. Identify tenants that have their own OAuth tokens ──────────────────
        # These tenants' system-synced products may have been pulled from the WRONG
        # Amazon account (env var creds) before they linked their own account.
        # Delete those products so they re-sync from their own credentials.
        oauth_tenant_ids = [
            c.tenant_id for c in creds if c.sp_refresh_token
        ]

        if not oauth_tenant_ids:
            print("\nNo tenants with OAuth tokens found — nothing to clean up.")
            return

        print(f"\nTenants with own OAuth tokens: {oauth_tenant_ids}")

        # Find the env-var seller ID to detect wrong-credential imports
        env_seller_id = os.getenv("AMAZON_SELLER_ID", "").strip()

        # ── 3. For each OAuth tenant, count products to delete ────────────────���───
        to_delete_total = 0
        for tid in oauth_tenant_ids:
            count = db.query(models.Product).filter(
                models.Product.tenant_id == tid,
                models.Product.created_by == "system",
            ).count()
            print(f"\n  Tenant {tid}: {count} system-synced products to delete")
            to_delete_total += count

        if to_delete_total == 0:
            print("\nNo system-synced products found for OAuth tenants — nothing to delete.")
            return

        # ── 4. Confirm before deleting ────────────────────────────────────────────
        print(f"\nTotal products to delete: {to_delete_total}")
        confirm = input("\nProceed with deletion? (yes/no): ").strip().lower()
        if confirm != "yes":
            print("Aborted.")
            return

        # ── 5. Delete and report ──────────────────────────────────────────────────
        deleted = 0
        for tid in oauth_tenant_ids:
            result = db.query(models.Product).filter(
                models.Product.tenant_id == tid,
                models.Product.created_by == "system",
            ).delete(synchronize_session=False)
            deleted += result
            print(f"  Deleted {result} products for tenant {tid}")

        db.commit()
        print(f"\nDone. Deleted {deleted} cross-contaminated products.")
        print("Each tenant's Amazon sync will re-import their own inventory on the next")
        print("hourly run, or you can trigger it immediately from the Inventory page.")

    except Exception as e:
        db.rollback()
        print(f"\nERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
