"""
Amazon FBA Inventory Sync — multi-tenant, runs hourly via APScheduler.

For each tenant that has Amazon credentials stored in the DB, pulls FBA
inventory from SP-API and upserts into the CRM products table:
  - Existing product (matched by ASIN + tenant_id): quantity updated.
  - New ASIN: new Product created with status='approved'.

Single-tenant fallback: if no DB credentials exist but env vars are set,
uses env vars (backwards compatibility for self-hosted installs).
"""

import os
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from database import SessionLocal
import models

log = logging.getLogger(__name__)

_LWA_URL = "https://api.amazon.com/auth/o2/token"

# ── Per-tenant sync state keyed by tenant_id ───────────────────────────────────
# tenant_id=0 is used for the legacy env-var single-tenant path
_sync_states: dict[int, dict] = {}

def _default_state() -> dict:
    return {
        "last_sync_at": None,
        "created":      0,
        "updated":      0,
        "skipped":      0,
        "error":        None,
        "running":      False,
    }


def get_sync_state(tenant_id: int = 0) -> dict:
    return dict(_sync_states.get(tenant_id, _default_state()))


# ── Credential resolution ──────────────────────────────────────────────────────

def _sp_base(is_sandbox: bool = False) -> str:
    sandbox = is_sandbox or os.getenv("AMAZON_SP_SANDBOX", "").lower() in ("1", "true", "yes")
    return (
        "https://sandbox.sellingpartnerapi-na.amazon.com"
        if sandbox
        else "https://sellingpartnerapi-na.amazon.com"
    )


def configured(tenant_id: Optional[int] = None) -> bool:
    """
    Returns True if Amazon SP-API is configured for the given tenant.
    A tenant is considered configured if they have a refresh token stored
    (from OAuth) AND the LWA client credentials are available either in
    the DB record or as env vars.
    Falls back to env vars when no DB credential record exists (e.g. fresh DB).
    """
    _env_configured = all(os.getenv(k, "").strip() for k in (
        "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET",
        "AMAZON_SP_REFRESH_TOKEN",
    ))
    if tenant_id:
        db = SessionLocal()
        try:
            cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
            if not cred:
                # No DB record — fall back to env vars (e.g. self-hosted / fresh install)
                return _env_configured
            if not cred.sp_refresh_token:
                return False
            # Client ID/secret can be in the DB (manual entry) or env vars (shared app creds)
            lwa_id     = cred.lwa_client_id     or os.getenv("AMAZON_LWA_CLIENT_ID", "")
            lwa_secret = cred.lwa_client_secret or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
            # If refresh token exists and at least client_id is available, consider configured
            # (secret falls back to env var at token-exchange time)
            return bool(lwa_id or lwa_secret)
        finally:
            db.close()
    return _env_configured


async def _get_access_token_for_tenant(tenant_id: Optional[int] = None) -> tuple[str, str, str]:
    """
    Returns (access_token, marketplace_id, sp_base_url) for the given tenant.
    Falls back to env vars for legacy single-tenant installs.
    """
    import httpx

    if tenant_id:
        db = SessionLocal()
        try:
            cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
            if cred and cred.sp_refresh_token:
                client_id     = cred.lwa_client_id     or os.getenv("AMAZON_LWA_CLIENT_ID", "")
                client_secret = cred.lwa_client_secret or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
                refresh_token = cred.sp_refresh_token
                mkt_id        = cred.marketplace_id    or os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")
                base          = _sp_base(cred.is_sandbox)
            else:
                raise RuntimeError(f"No Amazon credentials found for tenant {tenant_id}")
        finally:
            db.close()
    else:
        client_id     = os.getenv("AMAZON_LWA_CLIENT_ID", "")
        client_secret = os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
        refresh_token = os.getenv("AMAZON_SP_REFRESH_TOKEN", "")
        mkt_id        = os.getenv("AMAZON_MARKETPLACE_ID", "ATVPDKIKX0DER")
        base          = _sp_base()

    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(_LWA_URL, data={
            "grant_type":    "refresh_token",
            "refresh_token": refresh_token,
            "client_id":     client_id,
            "client_secret": client_secret,
        })
    if r.status_code != 200:
        raise RuntimeError(f"Amazon LWA token error: {r.text[:200]}")
    return r.json()["access_token"], mkt_id, base


# ── FBA inventory fetch ────────────────────────────────────────────────────────

async def _fetch_fba_inventory(tenant_id: Optional[int] = None) -> list:
    """Return list of dicts: asin, product_name, seller_sku, quantity."""
    import httpx
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    items = []
    next_token = None

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "granularityType": "Marketplace",
                "granularityId":   mkt_id,
                "marketplaceIds":  mkt_id,
                "details":         "true",
            }
            if next_token:
                params["nextToken"] = next_token

            resp = await client.get(
                f"{base}/fba/inventory/v1/summaries",
                headers={"x-amz-access-token": token},
                params=params,
            )
            if resp.status_code != 200:
                raise RuntimeError(f"FBA inventory API {resp.status_code}: {resp.text[:200]}")

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


# ── FBM listings fetch ─────────────────────────────────────────────────────────

async def _fetch_fbm_listings(tenant_id: Optional[int] = None) -> list:
    """
    Fetch all active FBM (merchant-fulfilled) listings via the Listings Items API.
    Returns list of dicts: asin, product_name, seller_sku, quantity, fulfillment_channel='FBM'.
    Requires seller_id to be stored in AmazonCredential or AMAZON_SELLER_ID env var.
    Silently returns [] if seller_id is unavailable or the API permission is not granted.
    """
    import httpx

    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    # Resolve seller_id
    seller_id = None
    if tenant_id:
        db = SessionLocal()
        try:
            cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
            seller_id = cred.seller_id if cred else None
        finally:
            db.close()
    if not seller_id:
        seller_id = os.getenv("AMAZON_SELLER_ID", "").strip()

    if not seller_id:
        log.info("FBM sync skipped for tenant %s — no seller_id", tenant_id)
        return []

    items = []
    page_token = None

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            params = {
                "marketplaceIds":  mkt_id,
                "includedData":    "summaries,fulfillmentAvailability",
                "pageSize":        20,
            }
            if page_token:
                params["pageToken"] = page_token

            resp = await client.get(
                f"{base}/listings/2021-08-01/items/{seller_id}",
                headers={"x-amz-access-token": token},
                params=params,
            )
            if resp.status_code == 403:
                log.info("FBM listings API 403 for tenant %s — seller may not have listings permission", tenant_id)
                break
            if resp.status_code != 200:
                log.warning("FBM listings API %s for tenant %s: %s", resp.status_code, tenant_id, resp.text[:120])
                break

            data = resp.json()
            for listing in data.get("items", []):
                summaries = listing.get("summaries") or []
                # Only include merchant-fulfilled (FBM) items
                is_fbm = any(
                    s.get("fulfillmentChannel") in ("MERCHANT", "DEFAULT")
                    for s in summaries
                )
                if not is_fbm:
                    continue

                asin = (summaries[0].get("asin") or "") if summaries else ""
                product_name = (summaries[0].get("itemName") or "") if summaries else ""
                seller_sku = listing.get("sku", "")

                # Quantity from fulfillmentAvailability for the MERCHANT channel
                qty = 0
                for fa in (listing.get("fulfillmentAvailability") or []):
                    if fa.get("fulfillmentChannelCode") in ("DEFAULT", "MERCHANT"):
                        qty = fa.get("quantity") or 0
                        break

                if asin:
                    items.append({
                        "asin":               asin,
                        "product_name":       product_name,
                        "seller_sku":         seller_sku,
                        "quantity":           qty,
                        "fulfillment_channel": "FBM",
                    })

            page_token = (data.get("pagination") or {}).get("nextPageToken")
            if not page_token:
                break

    log.info("FBM listings fetched for tenant %s: %d items", tenant_id, len(items))
    return items


# ── Core sync logic ────────────────────────────────────────────────────────────

async def run_sync(tenant_id: Optional[int] = None) -> dict:
    """
    Fetch FBA + FBM inventory and upsert into products table for the given tenant.
    tenant_id=None uses env-var credentials (legacy single-tenant).
    Each product is tagged with fulfillment_channel='FBA' or 'FBM'.
    """
    key = tenant_id or 0
    if _sync_states.get(key, {}).get("running"):
        raise RuntimeError("Sync already in progress")

    state = _default_state()
    state["running"] = True
    _sync_states[key] = state

    db = SessionLocal()
    created = updated = skipped = 0

    try:
        # Pull FBA inventory (tag each item)
        fba_items = await _fetch_fba_inventory(tenant_id)
        for item in fba_items:
            item["fulfillment_channel"] = "FBA"

        # Pull FBM listings (silently skips if seller_id missing or no permission)
        try:
            fbm_items = await _fetch_fbm_listings(tenant_id)
        except Exception as _e:
            log.warning("FBM fetch failed for tenant %s (non-fatal): %s", tenant_id, _e)
            fbm_items = []

        # FBM items that are ALSO in FBA should not be double-counted — FBA wins
        fba_asins = {(item.get("asin") or "").strip() for item in fba_items}
        fbm_items = [i for i in fbm_items if (i.get("asin") or "").strip() not in fba_asins]

        all_items = fba_items + fbm_items

        for item in all_items:
            asin = (item.get("asin") or "").strip()
            if not asin:
                skipped += 1
                continue

            channel = item.get("fulfillment_channel", "FBA")

            q = db.query(models.Product).filter(models.Product.asin == asin)
            if tenant_id:
                q = q.filter(models.Product.tenant_id == tenant_id)
            existing = q.first()

            if existing:
                existing.quantity = item["quantity"]
                existing.fulfillment_channel = channel
                updated += 1
            else:
                now = datetime.now(timezone.utc)
                p = models.Product(
                    tenant_id=tenant_id,
                    asin=asin,
                    product_name=item["product_name"] or asin,
                    quantity=item["quantity"],
                    order_number=item["seller_sku"] or None,
                    status="approved",
                    date_sent_to_amazon=now if channel == "FBA" else None,
                    created_by="system",
                    fulfillment_channel=channel,
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
        _sync_states[key] = result
        log.info("Amazon sync tenant=%s — created=%d updated=%d skipped=%d", tenant_id, created, updated, skipped)
        return result

    except Exception as e:
        _sync_states[key] = {
            **_default_state(),
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "error":        str(e),
            "running":      False,
        }
        log.error("Amazon sync failed tenant=%s: %s", tenant_id, e)
        raise
    finally:
        db.close()


# ── Keepa enrichment after initial sync ───────────────────────────────────────

async def run_keepa_enrichment(tenant_id: Optional[int] = None, batch_size: int = 20) -> dict:
    """
    After FBA inventory is imported, look up every product with a missing
    keepa_last_synced and enrich it with Keepa data (BSR, buy box, fees).
    Runs in batches of batch_size to respect Keepa token limits.
    """
    import httpx

    keepa_key = os.getenv("KEEPA_API_KEY", "")
    if not keepa_key:
        log.info("Keepa enrichment skipped — KEEPA_API_KEY not set")
        return {"enriched": 0, "skipped": 0, "error": "KEEPA_API_KEY not set"}

    db = SessionLocal()
    enriched = skipped = 0
    try:
        q = db.query(models.Product).filter(
            models.Product.asin.isnot(None),
            models.Product.keepa_last_synced.is_(None),
        )
        if tenant_id:
            q = q.filter(models.Product.tenant_id == tenant_id)
        products = q.all()

        if not products:
            return {"enriched": 0, "skipped": 0, "error": None}

        # Process in batches
        for i in range(0, len(products), batch_size):
            batch = products[i:i + batch_size]
            asins = [p.asin for p in batch if p.asin]
            if not asins:
                continue

            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    r = await client.get(
                        "https://api.keepa.com/product",
                        params={
                            "key":        keepa_key,
                            "domain":     1,
                            "asin":       ",".join(asins),
                            "stats":      1,
                            "buybox":     1,
                            "rental":     0,
                        },
                    )
                if r.status_code == 200:
                    body = r.json()
                    # Keepa returns 200 but tokensLeft < 0 when exhausted
                    if (body.get("tokensLeft", 1) or 1) < 0:
                        log.info("Keepa enrichment paused — tokens exhausted, will resume next scheduled sync")
                        skipped += len(products) - i  # count remaining as skipped
                        break
                    keepa_products = body.get("products", [])
                    kp_by_asin = {kp.get("asin", ""): kp for kp in keepa_products}

                    for product in batch:
                        kp = kp_by_asin.get(product.asin)
                        if kp:
                            _apply_keepa_data(product, kp)
                            enriched += 1
                        else:
                            skipped += 1
                elif r.status_code in (429, 403):
                    # Hard token limit — stop immediately, scheduler will retry
                    log.info("Keepa enrichment paused (HTTP %s) — will resume next scheduled sync", r.status_code)
                    skipped += len(products) - i
                    break
                else:
                    log.debug("Keepa batch error %s — skipping", r.status_code)
                    skipped += len(batch)
            except Exception as e:
                log.debug("Keepa batch skipped: %s", e)
                skipped += len(batch)

            # Small delay between batches to be kind to Keepa's rate limits
            await asyncio.sleep(1)

        db.commit()
        log.info("Keepa enrichment tenant=%s — enriched=%d skipped=%d", tenant_id, enriched, skipped)
        return {"enriched": enriched, "skipped": skipped, "error": None}

    except Exception as e:
        log.error("Keepa enrichment failed tenant=%s: %s", tenant_id, e)
        return {"enriched": enriched, "skipped": skipped, "error": str(e)}
    finally:
        db.close()


def _apply_keepa_data(product, kp: dict) -> None:
    """Write Keepa fields onto a Product ORM object (does not commit)."""
    from datetime import timezone as _tz
    stats = kp.get("stats") or {}

    # Buy box price (in Keepa cents = actual cents / 100)
    bb_raw = stats.get("buyBoxPrice", -1)
    if bb_raw and bb_raw > 0:
        product.buy_box_price = bb_raw / 100.0

    # BSR
    rank_list = kp.get("salesRanks") or {}
    # salesRanks is a dict of category_id -> [rank1, time1, rank2, time2 ...]
    # Pick whichever category has data
    for cat_id, ranks in rank_list.items():
        if ranks and len(ranks) >= 2:
            product.keepa_bsr = ranks[-1]  # last rank value
            break

    # Category
    categories = kp.get("categories") or []
    if categories:
        product.keepa_category = str(categories[0])

    product.keepa_last_synced = datetime.now(_tz.utc)


# ── Initial onboarding pull ────────────────────────────────────────────────────

async def initial_data_pull(tenant_id: int) -> dict:
    """
    Called automatically after a tenant connects Amazon for the first time.
    1. Syncs FBA inventory → products table
    2. Enriches all new products with Keepa data (BSR, buy box, fees)
    """
    log.info("Starting initial data pull for tenant %s", tenant_id)
    results = {"inventory": None, "keepa": None}

    try:
        results["inventory"] = await run_sync(tenant_id)
        log.info("Initial inventory sync done: %s", results["inventory"])
    except Exception as e:
        log.error("Initial inventory sync failed for tenant %s: %s", tenant_id, e)
        results["inventory"] = {"error": str(e)}

    try:
        results["keepa"] = await run_keepa_enrichment(tenant_id)
        log.info("Initial Keepa enrichment done: %s", results["keepa"])
    except Exception as e:
        log.error("Initial Keepa enrichment failed for tenant %s: %s", tenant_id, e)
        results["keepa"] = {"error": str(e)}

    return results


# ── APScheduler entry points ───────────────────────────────────────────────────

def scheduled_sync_all():
    """
    Called by APScheduler hourly.
    Syncs every tenant that has Amazon credentials configured.
    """
    db = SessionLocal()
    try:
        tenant_ids = [
            row.tenant_id
            for row in db.query(models.AmazonCredential).filter(
                models.AmazonCredential.sp_refresh_token.isnot(None)
            ).all()
        ]
    finally:
        db.close()

    if not tenant_ids:
        # Legacy env-var mode
        if configured():
            log.info("Amazon scheduled sync (env-var mode) starting…")
            try:
                asyncio.run(run_sync(None))
            except Exception as e:
                log.error("Amazon scheduled sync error: %s", e)
        return

    for tid in tenant_ids:
        log.info("Amazon scheduled sync starting for tenant %s", tid)
        try:
            asyncio.run(run_sync(tid))
        except Exception as e:
            log.error("Amazon scheduled sync error tenant=%s: %s", tid, e)


# Keep old name for backward compatibility with notifications.py / main.py scheduler setup
def scheduled_sync():
    scheduled_sync_all()
