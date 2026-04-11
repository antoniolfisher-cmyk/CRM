"""
Amazon FBA Inventory Sync — runs hourly via APScheduler.

Pulls FBA inventory from Amazon SP-API and upserts into the CRM products table:
  - Existing product (matched by ASIN): quantity updated.
  - New ASIN: new Product created with status='approved' and date_sent_to_amazon set.

Required env vars (same as the rest of Amazon integration):
  AMAZON_LWA_CLIENT_ID
  AMAZON_LWA_CLIENT_SECRET
  AMAZON_SP_REFRESH_TOKEN
  AMAZON_SELLER_ID
  AMAZON_MARKETPLACE_ID   (default: ATVPDKIKX0DER = US)
"""

import os
import asyncio
import logging
from datetime import datetime, timezone

from database import SessionLocal
import models

log = logging.getLogger(__name__)

# ── Module-level state ──────────────────────────────────────────────────────────
_sync_state: dict = {
    "last_sync_at":  None,   # ISO string UTC
    "created":       0,
    "updated":       0,
    "skipped":       0,
    "error":         None,
    "running":       False,
}

# ── Amazon SP-API helpers (self-contained, no main.py imports) ──────────────────

_LWA_URL = "https://api.amazon.com/auth/o2/token"
_SP_BASE  = (
    "https://sandbox.sellingpartnerapi-na.amazon.com"
    if os.getenv("AMAZON_SP_SANDBOX", "").lower() in ("1", "true", "yes")
    else "https://sellingpartnerapi-na.amazon.com"
)
_MKT_ID  = os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")


def configured() -> bool:
    return all(os.getenv(k, "").strip() for k in (
        "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET",
        "AMAZON_SP_REFRESH_TOKEN", "AMAZON_SELLER_ID",
    ))


async def _get_access_token() -> str:
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(_LWA_URL, data={
            "grant_type":    "refresh_token",
            "refresh_token": os.getenv("AMAZON_SP_REFRESH_TOKEN", ""),
            "client_id":     os.getenv("AMAZON_LWA_CLIENT_ID", ""),
            "client_secret": os.getenv("AMAZON_LWA_CLIENT_SECRET", ""),
        })
    if r.status_code != 200:
        raise RuntimeError(f"Amazon LWA token error: {r.text[:200]}")
    return r.json()["access_token"]


async def _fetch_fba_inventory() -> list:
    """Return list of dicts with asin, product_name, seller_sku, quantity."""
    import httpx
    token = await _get_access_token()
    items = []
    next_token = None

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "granularityType": "Marketplace",
                "granularityId":   _MKT_ID,
                "marketplaceIds":  _MKT_ID,
                "details":         "true",
            }
            if next_token:
                params["nextToken"] = next_token

            resp = await client.get(
                f"{_SP_BASE}/fba/inventory/v1/summaries",
                headers={"x-amz-access-token": token},
                params=params,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"Amazon FBA inventory error {resp.status_code}: {resp.text[:200]}")

            data = resp.json()
            for s in data.get("payload", {}).get("inventorySummaries", []):
                details = s.get("inventoryDetails") or {}
                qty = (
                    (details.get("fulfillableQuantity") or 0)
                    + (details.get("inboundShippedQuantity") or 0)
                    + (details.get("inboundReceivingQuantity") or 0)
                )
                items.append({
                    "asin":         s.get("asin", ""),
                    "product_name": s.get("productName", ""),
                    "seller_sku":   s.get("sellerSku", ""),
                    "quantity":     qty,
                })
            next_token = data.get("payload", {}).get("nextToken")
            if not next_token:
                break

    return items


# ── Core sync logic ─────────────────────────────────────────────────────────────

async def run_sync() -> dict:
    """Fetch FBA inventory and upsert into the products table. Returns result dict."""
    global _sync_state

    if not configured():
        raise RuntimeError("Amazon SP-API credentials are not configured")

    _sync_state["running"] = True
    db = SessionLocal()
    created = updated = skipped = 0

    try:
        items = await _fetch_fba_inventory()

        for item in items:
            asin = (item.get("asin") or "").strip()
            if not asin:
                skipped += 1
                continue

            existing = db.query(models.Product).filter(models.Product.asin == asin).first()
            if existing:
                existing.quantity = item["quantity"]
                updated += 1
            else:
                now = datetime.now(timezone.utc)
                p = models.Product(
                    asin=asin,
                    product_name=item["product_name"] or asin,
                    quantity=item["quantity"],
                    order_number=item["seller_sku"] or None,
                    status="approved",
                    date_sent_to_amazon=now,
                    created_by="system",
                )
                db.add(p)
                created += 1

        db.commit()

        result = {
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "created":      created,
            "updated":      updated,
            "skipped":      skipped,
            "error":        None,
            "running":      False,
        }
        _sync_state.update(result)
        log.info("Amazon inventory sync complete — created=%d updated=%d skipped=%d", created, updated, skipped)
        return result

    except Exception as e:
        _sync_state.update({
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "error":        str(e),
            "running":      False,
        })
        log.error("Amazon inventory sync failed: %s", e)
        raise
    finally:
        db.close()


def get_sync_state() -> dict:
    return dict(_sync_state)


# ── APScheduler entry point ─────────────────────────────────────────────────────

def scheduled_sync():
    """Sync wrapper for APScheduler background thread."""
    if not configured():
        log.debug("Amazon sync skipped — SP-API not configured")
        return
    log.info("Amazon inventory scheduled sync starting…")
    try:
        asyncio.run(run_sync())
    except Exception as e:
        log.error("Amazon scheduled sync error: %s", e)
