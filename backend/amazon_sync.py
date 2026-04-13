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
        "fba_synced":   0,
        "fbm_synced":   0,
        "fbm_error":    None,
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

def _parse_listings_tsv(text: str) -> list:
    """Parse an Active Listings Report TSV into a list of FBM product dicts."""
    import io, csv
    delimiter = "\t" if text.count("\t") > text.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    items = []
    for row in reader:
        row = {k.strip().lower() if k else k: v for k, v in row.items()}
        asin = (row.get("asin1") or row.get("asin") or "").strip()
        if not asin or len(asin) < 10:
            continue
        # Skip FBA rows — Amazon uses "AMAZON_NA", "AMAZON_EU", "AFN" etc.
        channel = (row.get("fulfillment-channel") or row.get("fulfillment_channel") or "").strip().upper()
        if channel.startswith("AMAZON") or channel in ("AFN", "FBA"):
            continue
        # Skip inactive
        status_val = (row.get("status") or "").strip().lower()
        if status_val and status_val not in ("active", ""):
            continue
        name = (row.get("item-name") or row.get("item_name") or "").strip()
        sku  = (row.get("seller-sku") or row.get("seller_sku") or "").strip()
        try:
            qty = int(float(row.get("quantity") or 0))
        except (ValueError, TypeError):
            qty = 0
        if qty == 0:
            qty = 1  # active listing = buyable
        items.append({
            "asin":                asin,
            "product_name":        name,
            "seller_sku":          sku,
            "quantity":            qty,
            "fulfillment_channel": "FBM",
        })
    return items


async def _reports_api_fbm(token: str, mkt_id: str, base: str) -> Optional[list]:
    """
    Try to get FBM listings via the Reports API (GET_MERCHANT_LISTINGS_ALL_DATA).
    Returns list of items if successful, None if the Reports API isn't available (403/404).
    Polls up to 30 seconds for the report to be ready.
    """
    import httpx
    async with httpx.AsyncClient(timeout=30) as client:
        # Request the report
        r = await client.post(
            f"{base}/reports/2021-06-30/reports",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json={"reportType": "GET_MERCHANT_LISTINGS_ALL_DATA", "marketplaceIds": [mkt_id]},
        )
        if r.status_code in (403, 404):
            return None  # Reports API not available for this app
        if r.status_code not in (200, 202):
            log.debug("Reports API create returned %s: %s", r.status_code, r.text[:120])
            return None

        report_id = r.json().get("reportId")
        if not report_id:
            return None

        # Poll up to 30 s (6 polls × 5 s)
        doc_id = None
        for _ in range(6):
            await asyncio.sleep(5)
            r = await client.get(
                f"{base}/reports/2021-06-30/reports/{report_id}",
                headers={"x-amz-access-token": token},
            )
            if r.status_code != 200:
                return None
            body = r.json()
            ps = body.get("processingStatus", "")
            if ps == "DONE":
                doc_id = body.get("reportDocumentId")
                break
            if ps in ("FATAL", "CANCELLED"):
                return None

        if not doc_id:
            log.debug("Reports API: report %s not ready in time", report_id)
            return None

        # Get document URL
        r = await client.get(
            f"{base}/reports/2021-06-30/documents/{doc_id}",
            headers={"x-amz-access-token": token},
        )
        if r.status_code != 200:
            return None
        url = r.json().get("url")
        if not url:
            return None

        # Download the report content
        async with httpx.AsyncClient(timeout=60) as dl:
            r = await dl.get(url)
        if r.status_code != 200:
            return None

        try:
            text = r.content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = r.content.decode("latin-1")

        items = _parse_listings_tsv(text)
        log.info("Reports API FBM: fetched %d FBM items", len(items))
        return items


async def _fetch_fbm_listings(tenant_id: Optional[int] = None) -> list:
    """
    Fetch all active FBM listings. Tries two methods in order:
      1. Listings Items API  (needs listingsItems:read_write role)
      2. Reports API         (needs reports:read_write — standard for most SP-API apps)
    Raises RuntimeError with a user-friendly message if both fail.
    """
    import httpx

    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    # ── Method 1: Listings Items API ──────────────────────────────────────────
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

    if seller_id:
        items = []
        page_token = None
        listings_ok = True
        async with httpx.AsyncClient(timeout=30) as client:
            while listings_ok:
                params = {
                    "marketplaceIds": mkt_id,
                    "includedData":   "summaries,fulfillmentAvailability",
                    "pageSize":       20,
                }
                if page_token:
                    params["pageToken"] = page_token
                resp = await client.get(
                    f"{base}/listings/2021-08-01/items/{seller_id}",
                    headers={"x-amz-access-token": token},
                    params=params,
                )
                if resp.status_code in (403, 404):
                    listings_ok = False
                    break
                if resp.status_code != 200:
                    listings_ok = False
                    break

                data = resp.json()
                for listing in data.get("items", []):
                    summaries = listing.get("summaries") or []
                    is_fbm = any(
                        s.get("fulfillmentChannel") in ("MERCHANT", "DEFAULT", "MFN")
                        for s in summaries
                    )
                    if not is_fbm:
                        continue
                    asin         = (summaries[0].get("asin") or "") if summaries else ""
                    product_name = (summaries[0].get("itemName") or "") if summaries else ""
                    seller_sku   = listing.get("sku", "")
                    qty = 0
                    for fa in (listing.get("fulfillmentAvailability") or []):
                        if fa.get("fulfillmentChannelCode") in ("DEFAULT", "MERCHANT", "MFN"):
                            q = fa.get("quantity") or 0
                            if q > 0:
                                qty = q
                                break
                    if qty == 0:
                        qty = 1
                    if asin:
                        items.append({
                            "asin":                asin,
                            "product_name":        product_name,
                            "seller_sku":          seller_sku,
                            "quantity":            qty,
                            "fulfillment_channel": "FBM",
                        })
                page_token = (data.get("pagination") or {}).get("nextPageToken")
                if not page_token:
                    break

        if listings_ok:
            log.info("FBM via Listings API tenant=%s: %d items", tenant_id, len(items))
            return items
        log.info("FBM Listings API unavailable for tenant %s, trying Reports API…", tenant_id)

    # ── Method 2: Reports API (GET_MERCHANT_LISTINGS_ALL_DATA) ────────────────
    report_items = await _reports_api_fbm(token, mkt_id, base)
    if report_items is not None:
        log.info("FBM via Reports API tenant=%s: %d items", tenant_id, len(report_items))
        return report_items

    # Both methods failed
    raise RuntimeError(
        "FBM auto-sync unavailable. Your SP-API app needs either the "
        "'listingsItems:read_write' or 'Reports' role. "
        "Use ↑ Import FBM to upload an Active Listings Report from Seller Central."
    )
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
    fbm_error = None

    try:
        # Pull FBA inventory (tag each item)
        fba_items = await _fetch_fba_inventory(tenant_id)
        for item in fba_items:
            item["fulfillment_channel"] = "FBA"

        # Pull FBM listings — capture error for UI display but don't fail the whole sync
        try:
            fbm_items = await _fetch_fbm_listings(tenant_id)
        except Exception as _e:
            fbm_error = str(_e)
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
            "fba_synced":   len(fba_items),
            "fbm_synced":   len(fbm_items),
            "fbm_error":    fbm_error,
            "error":        None,
            "running":      False,
        }
        _sync_states[key] = result
        log.info("Amazon sync tenant=%s — created=%d updated=%d fba=%d fbm=%d fbm_error=%s",
                 tenant_id, created, updated, len(fba_items), len(fbm_items), fbm_error)
        return result

    except Exception as e:
        _sync_states[key] = {
            **_default_state(),
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "fbm_error":    fbm_error,
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
