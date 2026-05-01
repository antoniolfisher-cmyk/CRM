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
            return bool(lwa_id and lwa_secret)
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
                fulfillable  = details.get("fulfillableQuantity") or 0
                inb_working  = details.get("inboundWorkingQuantity") or 0
                inb_shipped  = details.get("inboundShippedQuantity") or 0
                inb_recv     = details.get("inboundReceivingQuantity") or 0
                reserved     = (details.get("reservedQuantity") or {}).get("totalReservedQuantity") or 0
                total_api    = s.get("totalQuantity") or 0
                qty = fulfillable + inb_working + inb_shipped + inb_recv + reserved
                if qty == 0:
                    qty = total_api
                import logging as _log
                _log.getLogger("amazon_sync").info(
                    "FBA item asin=%s sku=%s fulfillable=%s inb_work=%s inb_ship=%s inb_recv=%s reserved=%s total_api=%s → qty=%s",
                    s.get("asin"), s.get("sellerSku"), fulfillable, inb_working, inb_shipped, inb_recv, reserved, total_api, qty
                )
                asin = s.get("asin", "")
                # Sum quantities across multiple SKUs for the same ASIN
                existing_item = next((i for i in items if i["asin"] == asin), None)
                if existing_item:
                    existing_item["quantity"] += qty
                else:
                    items.append({
                        "asin":         asin,
                        "product_name": s.get("productName", ""),
                        "seller_sku":   s.get("sellerSku", ""),
                        "quantity":     qty,
                    })
            next_token = data.get("payload", {}).get("nextToken")
            if not next_token:
                break

    return items


async def _supplement_fba_via_listings(tenant_id: Optional[int], fba_items: list) -> list:
    """
    Supplement FBA inventory using the Listings Items API for ASINs the FBA
    Inventory API missed (50-row page limit workaround).
    Returns fba_items with any missing FBA ASINs appended.
    """
    import httpx
    try:
        token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
        seller_id = None
        try:
            from database import SessionLocal as _SL
            import models as _m
            _db = _SL()
            try:
                _creds = _db.query(_m.AmazonCredential).filter(_m.AmazonCredential.tenant_id == tenant_id).first() if tenant_id else None
                if _creds:
                    seller_id = _creds.seller_id or _creds.merchant_id
            finally:
                _db.close()
        except Exception:
            pass
        if not seller_id:
            seller_id = os.getenv("AMAZON_SELLER_ID") or os.getenv("AMAZON_MERCHANT_ID")
        if not seller_id:
            return fba_items

        known_asins = {(i.get("asin") or "").strip() for i in fba_items}
        page_token = None
        extra: list = []

        async with httpx.AsyncClient(timeout=30) as client:
            while True:
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
                if resp.status_code != 200:
                    break

                data = resp.json()
                for listing in data.get("items", []):
                    summaries = listing.get("summaries") or []
                    if not any("ACTIVE" in (s.get("status") or []) for s in summaries):
                        continue
                    channel = next(
                        (s.get("fulfillmentChannel") for s in summaries if s.get("fulfillmentChannel")),
                        None,
                    )
                    if channel != "AMAZON":
                        continue
                    asin = next((s.get("asin") for s in summaries if s.get("asin")), "")
                    if not asin or asin in known_asins:
                        continue
                    product_name = next((s.get("itemName") for s in summaries if s.get("itemName")), "")
                    seller_sku = listing.get("sku", "")
                    qty = 0
                    for fa in (listing.get("fulfillmentAvailability") or []):
                        if fa.get("fulfillmentChannelCode") == "AMAZON_NA":
                            qty = fa.get("quantity") or 0
                            break
                    if qty == 0:
                        qty = 1
                    log.info("FBA supplement: asin=%s sku=%s qty=%s (not in FBA Inventory API)", asin, seller_sku, qty)
                    known_asins.add(asin)
                    extra.append({
                        "asin":                asin,
                        "product_name":        product_name,
                        "seller_sku":          seller_sku,
                        "quantity":            qty,
                        "fulfillment_channel": "FBA",
                    })

                page_token = (data.get("pagination") or {}).get("nextPageToken")
                if not page_token:
                    break

        if extra:
            log.info("FBA supplement added %d items for tenant %s", len(extra), tenant_id)
        return fba_items + extra
    except Exception as _e:
        log.warning("FBA supplement skipped for tenant %s: %s", tenant_id, _e)
        return fba_items


# ── FBM listings fetch ─────────────────────────────────────────────────────────

async def _resolve_seller_id(tenant_id: Optional[int], token: str, base: str) -> Optional[str]:
    """Return the seller's Merchant ID, looking in DB → env var → SP-API."""
    import httpx

    # 1. DB credential record
    if tenant_id:
        db = SessionLocal()
        try:
            cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
            if cred and cred.seller_id:
                return cred.seller_id
        finally:
            db.close()

    # 2. Env var fallback
    env_id = os.getenv("AMAZON_SELLER_ID", "").strip()
    if env_id:
        return env_id

    # 3. Ask SP-API — GET /sellers/v1/marketplaceParticipations
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(
                f"{base}/sellers/v1/marketplaceParticipations",
                headers={"x-amz-access-token": token},
            )
        if r.status_code == 200:
            participations = r.json().get("payload", {}).get("participations") or []
            for p in participations:
                mid = (p.get("sellerParticipation") or {}).get("sellerId") \
                    or (p.get("marketplace") or {}).get("id")
                if mid:
                    # Persist it so we don't need to fetch again
                    if tenant_id:
                        db = SessionLocal()
                        try:
                            cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()
                            if cred:
                                cred.seller_id = mid
                                db.commit()
                        finally:
                            db.close()
                    log.info("Resolved seller_id %s for tenant %s via SP-API", mid, tenant_id)
                    return mid
        else:
            log.debug("marketplaceParticipations %s for tenant %s", r.status_code, tenant_id)
    except Exception as e:
        log.debug("Could not resolve seller_id via SP-API for tenant %s: %s", tenant_id, e)

    return None


async def _fetch_fbm_listings(tenant_id: Optional[int] = None) -> list:
    """
    Fetch all ACTIVE FBM (merchant-fulfilled) listings via the Listings Items API.
    Strategy:
      1. Listings Items API v2021-08-01 (fast, real-time) — primary path
      2. If 403/404 (permission not granted), fall back to the Reports API
         using GET_FLAT_FILE_OPEN_LISTINGS_DATA (async but widely available)
    Returns list of dicts: asin, product_name, seller_sku, quantity, fulfillment_channel='FBM'.
    """
    import httpx

    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    seller_id = await _resolve_seller_id(tenant_id, token, base)
    if not seller_id:
        raise RuntimeError(
            "FBM sync: seller_id not found. Reconnect your Amazon account — "
            "the Seller ID is captured automatically during OAuth."
        )

    items = await _listings_api_fbm(seller_id, tenant_id, token, mkt_id, base)
    if items is None:
        # Listings Items API permission not granted — try Reports API
        log.info("Listings Items API returned 403/404 for tenant %s — falling back to Reports API", tenant_id)
        items = await _reports_api_fbm(tenant_id, token, mkt_id, base)
        if items is None:
            raise RuntimeError(
                "FBM sync unavailable: Listings Items API returned 403 (permission not granted) "
                "and Reports API also failed. Add 'Listings Items' or 'Reports' role to your "
                "Amazon SP-API app in Developer Central, then reconnect."
            )
        items = items or []

    log.info("FBM sync tenant %s: %d items (seller_id=%s)", tenant_id, len(items), seller_id)
    return items


async def _listings_api_fbm(seller_id: str, tenant_id, token: str, mkt_id: str, base: str):
    """
    Primary FBM path: Listings Items API.
    Returns list on success, None if the API permission is not available (403/404).
    """
    import httpx
    items = []
    page_token = None

    async with httpx.AsyncClient(timeout=30) as client:
        while True:
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
                log.info("Listings Items API %s for tenant %s — will try Reports API", resp.status_code, tenant_id)
                return None
            if resp.status_code != 200:
                log.warning("Listings Items API %s for tenant %s: %s", resp.status_code, tenant_id, resp.text[:150])
                return []

            data = resp.json()
            for listing in data.get("items", []):
                summaries = listing.get("summaries") or []

                # Skip if not active
                if not any("ACTIVE" in (s.get("status") or []) for s in summaries):
                    continue

                # Only merchant-fulfilled items
                channel = next(
                    (s.get("fulfillmentChannel") for s in summaries if s.get("fulfillmentChannel")),
                    None
                )
                if channel not in ("MERCHANT", "DEFAULT", None):
                    # "AMAZON" = FBA — skip here, already covered by FBA sync
                    if channel == "AMAZON":
                        continue

                asin         = next((s.get("asin") for s in summaries if s.get("asin")), "")
                product_name = next((s.get("itemName") for s in summaries if s.get("itemName")), "")
                seller_sku   = listing.get("sku", "")

                # Quantity from fulfillmentAvailability — try DEFAULT/MERCHANT first, then any
                qty = 0
                for fa in (listing.get("fulfillmentAvailability") or []):
                    if fa.get("fulfillmentChannelCode") in ("DEFAULT", "MERCHANT", "MFN"):
                        qty = fa.get("quantity") or 0
                        if qty > 0:
                            break
                if qty == 0:
                    # Fall back to any fulfillmentAvailability entry
                    for fa in (listing.get("fulfillmentAvailability") or []):
                        q = fa.get("quantity") or 0
                        if q > 0:
                            qty = q
                            break
                # If listing is ACTIVE but we still couldn't read qty, treat as 1
                # (Amazon says it's live and buyable)
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

    return items


async def _reports_api_fbm(tenant_id, token: str, mkt_id: str, base: str):
    """
    Fallback FBM path: Reports API — GET_FLAT_FILE_OPEN_LISTINGS_DATA.
    Widely available, gives all active MFN listings with quantity.
    This is an async operation: create → poll → download → parse.
    Timeout: 3 minutes total.
    """
    import httpx, csv, io, time as _t

    headers = {"x-amz-access-token": token, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60) as client:
        # 1. Create report
        r = await client.post(
            f"{base}/reports/2021-06-30/reports",
            json={
                "reportType":     "GET_FLAT_FILE_OPEN_LISTINGS_DATA",
                "marketplaceIds": [mkt_id],
            },
            headers=headers,
        )
        if r.status_code in (403, 404):
            log.warning("FBM Reports API permission denied %s for tenant %s", r.status_code, tenant_id)
            return None   # signal "API not available" to caller
        if r.status_code not in (200, 202):
            log.warning("FBM Reports API create failed %s for tenant %s: %s", r.status_code, tenant_id, r.text[:150])
            return None
        report_id = r.json().get("reportId")
        if not report_id:
            return None

        # 2. Poll for completion (max 3 min)
        deadline = _t.time() + 180
        doc_id = None
        while _t.time() < deadline:
            await asyncio.sleep(10)
            rr = await client.get(f"{base}/reports/2021-06-30/reports/{report_id}", headers=headers)
            if rr.status_code != 200:
                continue
            status = rr.json().get("processingStatus", "")
            if status == "DONE":
                doc_id = rr.json().get("reportDocumentId")
                break
            if status in ("CANCELLED", "FATAL"):
                log.warning("FBM report %s for tenant %s", status, tenant_id)
                return []

        if not doc_id:
            log.warning("FBM report timed out for tenant %s", tenant_id)
            return []

        # 3. Get download URL
        dr = await client.get(f"{base}/reports/2021-06-30/documents/{doc_id}", headers=headers)
        if dr.status_code != 200:
            return []
        download_url = dr.json().get("url")
        if not download_url:
            return []

        # 4. Download and parse TSV
        raw = await client.get(download_url, timeout=60)
        if raw.status_code != 200:
            return []

    items = []
    try:
        text = raw.text
        reader = csv.DictReader(io.StringIO(text), delimiter="\t")
        for row in reader:
            asin     = (row.get("asin1") or row.get("asin") or "").strip()
            sku      = (row.get("seller-sku") or "").strip()
            name     = (row.get("item-name") or "").strip()
            try:
                qty = int(row.get("quantity", 0) or 0)
            except (ValueError, TypeError):
                qty = 0
            if asin:
                items.append({
                    "asin":                asin,
                    "product_name":        name,
                    "seller_sku":          sku,
                    "quantity":            qty,
                    "fulfillment_channel": "FBM",
                })
    except Exception as e:
        log.warning("FBM report parse error for tenant %s: %s", tenant_id, e)

    return items


# ── Buy Box winner check ───────────────────────────────────────────────────────

async def check_buy_box_winners(products: list, tenant_id, db) -> None:
    """
    For each product with an ASIN, call Amazon Competitive Pricing API to
    determine if we currently hold the Buy Box (belongsToRequester=true on
    CompetitivePriceId "1"). Updates buy_box_winner and buy_box_checked_at.
    Silently skips on any API error so the main sync never fails because of this.
    """
    import httpx

    prods_with_asin = [p for p in products if p.asin]
    if not prods_with_asin:
        return

    try:
        token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    except Exception as e:
        log.warning("Buy Box check: could not get access token for tenant %s: %s", tenant_id, e)
        return

    now = datetime.now(timezone.utc)
    BATCH = 20

    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(0, len(prods_with_asin), BATCH):
            batch = prods_with_asin[i:i + BATCH]
            asins = [p.asin for p in batch]

            try:
                resp = await client.get(
                    f"{base}/products/pricing/v0/competitivePrice",
                    headers={"x-amz-access-token": token},
                    params={
                        "MarketplaceId": mkt_id,
                        "Asins": ",".join(asins),
                        "ItemType": "Asin",
                    },
                )

                if resp.status_code != 200:
                    log.warning(
                        "Competitive pricing API %s for tenant %s: %s",
                        resp.status_code, tenant_id, resp.text[:200],
                    )
                    continue

                payload = resp.json().get("payload", [])
                results_by_asin: dict[str, bool] = {}

                for item in payload:
                    asin = item.get("ASIN") or item.get("asin", "")
                    if not asin or item.get("status") != "Success":
                        continue
                    competitive_prices = (
                        (item.get("Product") or {})
                        .get("CompetitivePricing", {})
                        .get("CompetitivePrices", [])
                    )
                    # CompetitivePriceId "1" = Featured Merchant offer (Buy Box)
                    winner = any(
                        str(cp.get("CompetitivePriceId", "")) == "1"
                        and cp.get("belongsToRequester")
                        for cp in competitive_prices
                    )
                    results_by_asin[asin] = winner

                for p in batch:
                    if p.asin in results_by_asin:
                        p.buy_box_winner = results_by_asin[p.asin]
                    else:
                        # ASIN not in response (new listing / suppressed / no offers)
                        p.buy_box_winner = False
                    p.buy_box_checked_at = now

            except Exception as e:
                log.warning("Buy Box batch check failed for tenant %s: %s", tenant_id, e)

            await asyncio.sleep(2.0)  # Amazon Competitive Pricing API: 10 TPS restore rate, 20-item batches = safe at 0.5 req/s


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
    fba_synced = fbm_synced = 0
    fbm_error = None

    try:
        # Pull FBA inventory (tag each item)
        fba_items = await _fetch_fba_inventory(tenant_id)
        for item in fba_items:
            item["fulfillment_channel"] = "FBA"

        # Supplement FBA with Listings Items API to catch items the 50-row FBA API missed
        try:
            fba_items = await _supplement_fba_via_listings(tenant_id, fba_items)
        except Exception as _sup_e:
            log.warning("FBA supplement failed for tenant %s (non-fatal): %s", tenant_id, _sup_e)

        # Pull FBM listings — capture error separately so FBA sync still completes
        try:
            fbm_items = await _fetch_fbm_listings(tenant_id)
        except Exception as _e:
            fbm_error = str(_e)
            log.warning("FBM fetch failed for tenant %s (non-fatal): %s", tenant_id, _e)
            fbm_error = str(_e)
            fbm_items = []

        # FBM items that are ALSO in FBA — FBA wins (already counted there)
        fba_asins = {(item.get("asin") or "").strip() for item in fba_items}
        deduped = [i for i in fbm_items if (i.get("asin") or "").strip() in fba_asins]
        fbm_items = [i for i in fbm_items if (i.get("asin") or "").strip() not in fba_asins]
        if deduped:
            log.info("FBM deduped %d items already in FBA for tenant %s", len(deduped), tenant_id)

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
                existing.status = "approved"   # live Amazon inventory is always approved
                if item.get("seller_sku"):
                    existing.seller_sku = item["seller_sku"]
                updated += 1
            else:
                now = datetime.now(timezone.utc)
                p = models.Product(
                    tenant_id=tenant_id,
                    asin=asin,
                    product_name=item["product_name"] or asin,
                    quantity=item["quantity"],
                    seller_sku=item.get("seller_sku") or None,
                    status="approved",
                    date_sent_to_amazon=now if channel == "FBA" else None,
                    created_by="system",
                    fulfillment_channel=channel,
                )
                db.add(p)
                created += 1

            if channel == "FBA":
                fba_synced += 1
            else:
                fbm_synced += 1

        db.commit()

        # Pull real Buy Box winner status from Amazon Competitive Pricing API
        # Load all products for this tenant so we can check ASINs we own
        all_products_q = db.query(models.Product).filter(models.Product.asin.isnot(None))
        if tenant_id:
            all_products_q = all_products_q.filter(models.Product.tenant_id == tenant_id)
        all_products = all_products_q.all()
        try:
            await check_buy_box_winners(all_products, tenant_id, db)
            db.commit()
        except Exception as _bb_err:
            log.warning("Buy Box winner check failed (non-fatal) for tenant %s: %s", tenant_id, _bb_err)

        result = {
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
            "created":      created,
            "updated":      updated,
            "skipped":      skipped,
            "fba_synced":   fba_synced,
            "fbm_synced":   fbm_synced,
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
    Syncs every tenant that has Amazon credentials — runs up to 5 tenants
    concurrently with a semaphore to stay within Amazon rate limits.
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
        if configured():
            log.info("Amazon scheduled sync (env-var mode) starting…")
            try:
                asyncio.run(run_sync(None))
            except Exception as e:
                log.error("Amazon scheduled sync error: %s", e)
        return

    log.info("Amazon scheduled sync starting for %d tenant(s)", len(tenant_ids))

    async def _sync_all():
        sem = asyncio.Semaphore(20)  # max 20 concurrent tenant syncs

        async def _sync_one(tid):
            async with sem:
                try:
                    await run_sync(tid)
                    log.info("Amazon sync complete tenant=%s", tid)
                except Exception as e:
                    log.error("Amazon sync error tenant=%s: %s", tid, e)

        await asyncio.gather(*[_sync_one(tid) for tid in tenant_ids])

    asyncio.run(_sync_all())


# Keep old name for backward compatibility
def scheduled_sync():
    scheduled_sync_all()
