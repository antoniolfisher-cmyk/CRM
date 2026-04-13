"""
Aria AI Repricer
Powered by Claude Haiku for cost-efficient, automated Amazon pricing.

Smart triggering: a product is skipped if its Buy Box price hasn't changed
since Aria last ran, avoiding unnecessary API calls.

Live repricing: after Claude determines the optimal price, Aria immediately
pushes it to Amazon via the Listings Items API and logs every change.
"""

import os
import json
import asyncio
import logging
from datetime import datetime

import anthropic
import httpx

from database import SessionLocal
import models

log = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"   # ~75% cheaper than Sonnet, plenty smart for pricing

# ─── Amazon SP-API base ───────────────────────────────────────────────────────
_SP_BASE      = "https://sellingpartnerapi-na.amazon.com"
_LWA_URL      = "https://api.amazon.com/auth/o2/token"
_DEFAULT_MKT  = "ATVPDKIKX0DER"   # US marketplace


def aria_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


# ─── Amazon token helper (self-contained so scheduler thread can use it) ──────

async def _get_access_token(cred) -> str:
    """Exchange the stored refresh token for a short-lived access token."""
    client_id     = cred.lwa_client_id     or os.getenv("AMAZON_LWA_CLIENT_ID", "")
    client_secret = cred.lwa_client_secret or os.getenv("AMAZON_LWA_CLIENT_SECRET", "")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(_LWA_URL, data={
            "grant_type":    "refresh_token",
            "refresh_token": cred.sp_refresh_token,
            "client_id":     client_id,
            "client_secret": client_secret,
        })
    r.raise_for_status()
    return r.json()["access_token"]


# ─── Push price to Amazon ─────────────────────────────────────────────────────

async def push_price_to_amazon(seller_sku: str, price: float, cred) -> dict:
    """
    PATCH /listings/2021-08-01/items/{sellerId}/{sku} with the new price.
    Returns {"ok": bool, "status": int, "error": str|None}.
    """
    if not seller_sku or not cred or not cred.seller_id:
        return {"ok": False, "status": 0, "error": "Missing seller_sku or seller_id"}

    try:
        token  = await _get_access_token(cred)
        mkt_id = cred.marketplace_id or _DEFAULT_MKT
        body   = {
            "productType": "PRODUCT",
            "patches": [{
                "op":    "replace",
                "path":  "/attributes/purchasable_offer",
                "value": [{
                    "marketplace_id": mkt_id,
                    "currency":       "USD",
                    "our_price": [{"schedule": [{"value_with_tax": price}]}],
                }],
            }],
        }
        sp_base = os.getenv("AMAZON_SP_BASE", _SP_BASE)
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.patch(
                f"{sp_base}/listings/2021-08-01/items/{cred.seller_id}/{seller_sku}",
                headers={
                    "x-amz-access-token": token,
                    "Content-Type":       "application/json",
                },
                params={"marketplaceIds": mkt_id},
                json=body,
            )
        ok = resp.status_code in (200, 202)
        if not ok:
            log.warning("Aria price push failed %s → $%.2f  HTTP %d: %s",
                        seller_sku, price, resp.status_code, resp.text[:300])
        return {"ok": ok, "status": resp.status_code, "error": None if ok else resp.text[:300]}
    except Exception as e:
        log.warning("Aria price push exception for %s: %s", seller_sku, e)
        return {"ok": False, "status": 0, "error": str(e)}


# ─── Strategy helpers ─────────────────────────────────────────────────────────

def _get_strategy(db, tenant_id=None):
    """Return the active Aria strategy for the given tenant, or None."""
    base = db.query(models.RepricerStrategy).filter(
        models.RepricerStrategy.is_active == True,
    )
    if tenant_id is not None:
        base = base.filter(models.RepricerStrategy.tenant_id == tenant_id)
    s = base.filter(models.RepricerStrategy.strategy_type == "aria").first()
    if not s:
        s = base.filter(models.RepricerStrategy.is_default == True).first()
    return s


# ─── Claude pricing call ──────────────────────────────────────────────────────

async def price_product(product: models.Product, strategy) -> dict:
    """Call Claude Haiku and return {price, reasoning}. Enforces min/max constraints."""
    buy_cost   = product.buy_cost   or 0
    amazon_fee = product.amazon_fee or 0
    buy_box    = product.buy_box    or 0
    breakeven  = buy_cost + amazon_fee

    min_price    = (strategy.min_price    if strategy else None) or round(breakeven * 1.05, 2)
    max_price    = (strategy.max_price    if strategy else None) or round(buy_box * 1.15, 2)
    profit_floor = (strategy.profit_floor if strategy else None) or 0

    prompt = f"""You are Aria, an expert Amazon FBA repricing AI. Recommend the optimal listing price for this product to balance winning the Buy Box with healthy profit margins.

PRODUCT: {product.product_name}
ASIN: {product.asin or 'N/A'}

MARKET DATA:
- Current Buy Box Price: ${buy_box:.2f}
- Competing Sellers: {product.num_sellers or 'Unknown'}
- Best Seller Rank: {'#' + f'{product.keepa_bsr:,}' if product.keepa_bsr else 'Unknown'}{f' in {product.keepa_category}' if product.keepa_category else ''}
- Est. Monthly Sales: {int(product.estimated_sales) if product.estimated_sales else 'Unknown'} units/mo

COST STRUCTURE:
- Buy Cost: ${buy_cost:.2f}
- Amazon Fees: ${amazon_fee:.2f}
- Break-even: ${breakeven:.2f}

CONSTRAINTS:
- Min Price: ${min_price:.2f}
- Max Price: ${max_price:.2f}
- Min Profit/unit: ${profit_floor:.2f}

Respond with ONLY valid JSON (no markdown):
{{"price": 29.99, "reasoning": "One concise sentence."}}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=100,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()
    data = json.loads(raw)
    price = max(float(data["price"]), min_price)
    if max_price:
        price = min(price, max_price)
    return {"price": round(price, 2), "reasoning": data.get("reasoning", "")}


# ─── Main reprice loop ────────────────────────────────────────────────────────

async def run_all_async(force: bool = False, tenant_id=None) -> dict:
    """
    Reprice all eligible products for a specific tenant.
    Smart trigger: skips products whose Buy Box price hasn't changed since
    the last Aria run (unless force=True).
    Pushes the new price to Amazon via the Listings Items API.
    Logs every change to RepricerLog.
    Returns summary dict.
    """
    db = SessionLocal()
    try:
        strategy = _get_strategy(db, tenant_id=tenant_id)

        # Get Amazon credentials for this tenant (needed to push prices)
        cred = None
        if tenant_id is not None:
            cred = db.query(models.AmazonCredential).filter_by(tenant_id=tenant_id).first()

        q = db.query(models.Product).filter(
            models.Product.buy_box > 0,
            models.Product.buy_cost > 0,
        )
        if tenant_id is not None:
            q = q.filter(models.Product.tenant_id == tenant_id)
        candidates = q.all()

        # Diagnostic: log credential status once before the loop
        if cred:
            log.info(
                "Aria cred check — seller_id=%s has_refresh=%s has_lwa_id=%s",
                bool(cred.seller_id), bool(cred.sp_refresh_token),
                bool(cred.lwa_client_id or os.getenv("AMAZON_LWA_CLIENT_ID", "")),
            )
        else:
            log.warning("Aria: no Amazon credentials found for tenant_id=%s — prices will NOT be pushed", tenant_id)

        repriced = skipped = errors = pushed = no_sku = 0
        now = datetime.utcnow()

        for p in candidates:
            # Smart trigger: skip if buy box unchanged since last run
            if not force and p.aria_last_buy_box is not None and p.aria_last_buy_box == p.buy_box:
                skipped += 1
                continue

            try:
                r      = await price_product(p, strategy)
                new_px = r["price"]

                # Determine seller SKU — prefer dedicated field, fall back to order_number (legacy)
                sku = p.seller_sku or p.order_number or None

                # Push to Amazon if we have a SKU and credentials
                amazon_result = {"ok": False, "status": 0, "error": "No SKU or credentials"}
                if not sku:
                    no_sku += 1
                    log.warning(
                        "Aria: no seller_sku for %s (id=%d asin=%s) — price NOT pushed to Amazon",
                        p.product_name, p.id, p.asin or "none",
                    )
                elif not cred or not cred.sp_refresh_token:
                    log.warning("Aria: no Amazon credentials for tenant %s — price NOT pushed", tenant_id)
                elif not cred.seller_id:
                    log.warning("Aria: cred.seller_id is empty for tenant %s — price NOT pushed", tenant_id)
                else:
                    amazon_result = await push_price_to_amazon(sku, new_px, cred)

                # Update product record (core fields — always safe)
                p.aria_suggested_price = new_px
                p.aria_suggested_at    = now
                p.aria_last_buy_box    = p.buy_box

                # New columns — set only if attribute exists on the mapped object
                if hasattr(p, "aria_reasoning"):
                    p.aria_reasoning = r["reasoning"]
                if amazon_result["ok"]:
                    if hasattr(p, "aria_live_price"):
                        p.aria_live_price     = new_px
                    if hasattr(p, "aria_live_pushed_at"):
                        p.aria_live_pushed_at = now
                    pushed += 1

                # Try to log to repricer_logs — skip gracefully if table not ready
                try:
                    entry = models.RepricerLog(
                        tenant_id     = tenant_id,
                        product_id    = p.id,
                        asin          = p.asin or "",
                        seller_sku    = sku,
                        product_name  = p.product_name,
                        old_price     = getattr(p, "aria_live_price", None),
                        new_price     = new_px,
                        buy_box       = p.buy_box,
                        reasoning     = r["reasoning"],
                        pushed        = amazon_result["ok"],
                        amazon_status = amazon_result["status"] or None,
                    )
                    db.add(entry)
                except Exception as log_err:
                    log.warning("Aria: could not create RepricerLog entry: %s", log_err)

                repriced += 1
                log.info(
                    "Aria repriced %s → $%.2f  push=%s  sku=%s  (%s)",
                    p.product_name, new_px, amazon_result["ok"], sku or "NONE", r["reasoning"]
                )
            except Exception as e:
                errors += 1
                log.warning("Aria failed for product %d (%s): %s", p.id, p.product_name, e)

        try:
            db.commit()
        except Exception as commit_err:
            log.error("Aria: db.commit() failed — %s", commit_err)
            db.rollback()

        log.info(
            "Aria run complete — repriced=%d pushed=%d no_sku=%d skipped=%d errors=%d",
            repriced, pushed, no_sku, skipped, errors
        )
        return {
            "repriced": repriced,
            "pushed":   pushed,
            "no_sku":   no_sku,
            "skipped":  skipped,
            "errors":   errors,
        }
    finally:
        db.close()


def scheduled_reprice():
    """
    Sync entry point for APScheduler (runs in a background thread).
    Creates a fresh event loop so asyncio.run() works cleanly.
    """
    if not aria_configured():
        return
    log.info("Aria scheduled reprice starting…")
    try:
        asyncio.run(run_all_async())
    except Exception as e:
        log.error("Aria scheduled reprice failed: %s", e)
