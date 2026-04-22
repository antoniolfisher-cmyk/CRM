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
from datetime import datetime, timedelta, timezone

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


# ─── Rule-based pricing engine ───────────────────────────────────────────────

def price_rule_based(product: models.Product, strategy) -> dict:
    """
    Aura-style rule-based repricing. No Claude call — pure math.

    Strategies:
      buy_box           → compete against the current Buy Box winner
      featured_merchants→ compete against the lowest featured merchant (same data: buy_box)
      lowest_price      → compete against the lowest overall price (same data: buy_box)

    compete_action: beat_pct | beat_amt | match
    winning_action: raise_pct | raise_amt | raise_to_max | maintain

    We determine "winning" as: our current live price <= buy_box (we ARE the box holder).
    """
    buy_cost   = product.buy_cost   or 0
    amazon_fee = product.amazon_fee or 0
    buy_box    = product.buy_box    or 0
    breakeven  = buy_cost + amazon_fee

    min_roi      = strategy.min_roi      or 0
    profit_floor = strategy.profit_floor or 0

    if strategy.min_price:
        min_price = strategy.min_price
    elif min_roi > 0:
        min_price = round(buy_cost * (1 + min_roi / 100) + amazon_fee, 2)
    else:
        min_price = round(breakeven * 1.05, 2)

    if profit_floor > 0:
        floor_min = round(breakeven + profit_floor, 2)
        if floor_min > min_price:
            min_price = floor_min

    max_price    = strategy.max_price    or round(buy_box * 1.15, 2)

    compete_action = strategy.compete_action or "beat_pct"
    compete_value  = strategy.compete_value  or 1.0
    winning_action = strategy.winning_action or "raise_pct"
    winning_value  = strategy.winning_value  or 1.0

    live_price = getattr(product, "aria_live_price", None) or 0

    # Are we currently winning the Buy Box?
    winning = live_price > 0 and live_price <= buy_box

    if winning:
        # We have the Buy Box — try to raise price toward max
        if winning_action == "raise_to_max":
            new_price = max_price
        elif winning_action == "raise_amt":
            new_price = live_price + winning_value
        elif winning_action == "raise_pct":
            new_price = live_price * (1 + winning_value / 100)
        else:  # maintain
            new_price = live_price
        reason = f"Winning Buy Box — raising price toward max (${max_price:.2f})"
    else:
        # We're not winning — compete against the target price
        target = buy_box  # for all three strategy types we use buy_box as the reference
        if compete_action == "match":
            new_price = target
            reason = f"Matching Buy Box price of ${target:.2f}"
        elif compete_action == "beat_amt":
            new_price = target - compete_value
            reason = f"Beating Buy Box by ${compete_value:.2f} (target ${target:.2f})"
        else:  # beat_pct
            new_price = target * (1 - compete_value / 100)
            reason = f"Beating Buy Box by {compete_value:.1f}% (target ${target:.2f})"

    # Clamp to min/max
    new_price = max(new_price, min_price)
    if max_price:
        new_price = min(new_price, max_price)

    return {"price": round(new_price, 2), "reasoning": reason}


# ─── Claude pricing call ──────────────────────────────────────────────────────

async def price_product(product: models.Product, strategy) -> dict:
    """Call Claude Haiku and return {price, reasoning}. Enforces min/max constraints."""
    buy_cost   = product.buy_cost   or 0
    amazon_fee = product.amazon_fee or 0
    buy_box    = product.buy_box    or 0
    breakeven  = buy_cost + amazon_fee

    min_roi      = (strategy.min_roi      if strategy else None)
    profit_floor = (strategy.profit_floor if strategy else None) or 0

    # --- Minimum price calculation (matches Aura / Maven logic) ---
    # Priority: explicit min_price > ROI-based > 5% markup fallback
    if strategy and strategy.min_price:
        min_price = strategy.min_price
    elif min_roi and min_roi > 0:
        # ROI = (price - cost - fees) / cost  →  price = cost*(1 + roi/100) + fees
        min_price = round(buy_cost * (1 + min_roi / 100) + amazon_fee, 2)
    else:
        min_price = round(breakeven * 1.05, 2)   # 5% above breakeven as safe default

    # Profit floor is a hard override on top of ROI floor (whichever is higher)
    if profit_floor > 0:
        floor_min = round(breakeven + profit_floor, 2)
        if floor_min > min_price:
            min_price = floor_min

    # --- Maximum price ---
    max_price = (strategy.max_price if strategy else None) or round(buy_box * 1.15, 2)

    # ── Competitive context ───────────────────────────────────────────────
    num_sellers   = product.num_sellers or 0
    live_price    = getattr(product, "aria_live_price", None) or 0
    winning_box   = live_price > 0 and live_price <= buy_box

    # 90-day price history from Keepa
    price_90_high = getattr(product, "price_90_high", None) or buy_box
    price_90_low  = getattr(product, "price_90_low",  None) or buy_box
    bsr           = product.keepa_bsr
    monthly_sales = product.estimated_sales

    # Aggressiveness (1=max profit, 10=win Buy Box at any cost)
    aggressiveness = (strategy.aggressiveness if strategy and hasattr(strategy, "aggressiveness") and strategy.aggressiveness else 5)

    if aggressiveness <= 3:
        goal = "Maximize profit margin. Only lower from max if competition forces it. Winning the Buy Box is secondary."
    elif aggressiveness <= 6:
        goal = "Balance Buy Box competitiveness with healthy profit. Prefer winning the Buy Box when the cost in margin is small."
    else:
        goal = "Win the Buy Box aggressively. Price as low as needed (down to Min Price) to beat competitors and capture sales volume."

    # Competition signal
    if num_sellers == 0 or num_sellers == 1:
        competition = "No or single competitor — strong pricing power, push toward max."
    elif num_sellers <= 3:
        competition = f"Only {num_sellers} sellers — limited competition, you have room to price high."
    elif num_sellers <= 8:
        competition = f"{num_sellers} sellers — moderate competition, balance price and wins."
    else:
        competition = f"{num_sellers} sellers — crowded market, be more aggressive to stand out."

    # Buy Box status
    if winning_box:
        box_status = f"YOU ARE CURRENTLY WINNING the Buy Box at ${live_price:.2f}. Protect it, but try to raise price toward the max."
    elif live_price > 0:
        box_status = f"You are NOT winning the Buy Box (your price ${live_price:.2f} vs. Buy Box ${buy_box:.2f}). Price to compete."
    else:
        box_status = "No prior price set — this is the first reprice."

    prompt = f"""You are Aria, an expert Amazon FBA AI repricer. Your job is to choose the single best listing price for maximum business outcome.

PRODUCT: {product.product_name}
ASIN: {product.asin or 'N/A'}

STRATEGY GOAL (aggressiveness {aggressiveness}/10):
{goal}

BUY BOX STATUS:
{box_status}

MARKET DATA:
- Current Buy Box Price:  ${buy_box:.2f}
- 90-Day Price Range:     ${price_90_low:.2f} – ${price_90_high:.2f}
- Competition:            {competition}
- Best Seller Rank:       {'#' + f'{bsr:,}' if bsr else 'Unknown'}{f' ({product.keepa_category})' if product.keepa_category else ''}
- Est. Monthly Sales:     {int(monthly_sales) if monthly_sales else 'Unknown'} units/mo

COST STRUCTURE:
- Buy Cost:    ${buy_cost:.2f}
- Amazon Fees: ${amazon_fee:.2f}
- Break-even:  ${breakeven:.2f}
- Profit @ min: ${round(min_price - breakeven, 2):.2f}/unit
- Profit @ max: ${round(max_price - breakeven, 2):.2f}/unit

HARD CONSTRAINTS (you MUST stay within these):
- Min Price: ${min_price:.2f}  ← never go below this
- Max Price: ${max_price:.2f}  ← never go above this

PRICING INTELLIGENCE:
- If the 90-day high is well above the current Buy Box, the market can support higher prices — consider pricing above the Buy Box when aggressiveness is low.
- If BSR is strong (low number) and sales are high, demand is healthy — you have pricing power.
- If many sellers compete, staying at or just below the Buy Box is critical.
- Never sacrifice below the min price — it protects your ROI floor.

Respond with ONLY valid JSON (no markdown, no explanation outside the JSON):
{{"price": 29.99, "reasoning": "One concise sentence explaining the decision."}}"""

    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    msg = client.messages.create(
        model=_MODEL,
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].lstrip("json").strip()
    # Strip any trailing text after the JSON object
    brace = raw.rfind("}")
    if brace != -1:
        raw = raw[: brace + 1]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("Aria JSON parse failed for %s — raw=%r  err=%s", product.product_name, raw[:200], e)
        raise
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
        default_strategy = _get_strategy(db, tenant_id=tenant_id)

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
        error_details = []
        now = datetime.utcnow()

        # Re-evaluate every 24h at minimum even if the Buy Box hasn't changed.
        # Without this, Aria prices a product once and never touches it again until
        # the Buy Box moves — defeating the purpose of hourly scheduling.
        REPRICE_EVERY_H = 24
        stale_cutoff = datetime.now(timezone.utc) - timedelta(hours=REPRICE_EVERY_H)

        for p in candidates:
            buy_box_unchanged = (p.aria_last_buy_box is not None and p.aria_last_buy_box == p.buy_box)

            # Normalise aria_suggested_at to UTC-aware for comparison
            suggested_at = p.aria_suggested_at
            if suggested_at and suggested_at.tzinfo is None:
                suggested_at = suggested_at.replace(tzinfo=timezone.utc)
            repriced_recently = suggested_at is not None and suggested_at > stale_cutoff

            # Skip only if nothing has changed AND we repriced within the window
            if not force and buy_box_unchanged and repriced_recently:
                skipped += 1
                continue

            try:
                # Per-product strategy → fall back to tenant default
                strategy = (
                    db.query(models.RepricerStrategy).get(p.aria_strategy_id)
                    if p.aria_strategy_id else None
                ) or default_strategy

                # Route to Claude (Aria) or rule-based engine depending on strategy type
                s_type = strategy.strategy_type if strategy else "aria"
                if s_type == "aria":
                    r = await price_product(p, strategy)
                else:
                    r = price_rule_based(p, strategy)
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
                msg = f"{p.product_name}: {e}"
                error_details.append(msg)
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
            "repriced":      repriced,
            "pushed":        pushed,
            "no_sku":        no_sku,
            "skipped":       skipped,
            "errors":        errors,
            "error_details": error_details,
        }
    finally:
        db.close()


def scheduled_reprice():
    """
    Sync entry point for APScheduler (runs in a background thread).
    Iterates every active tenant so credentials are loaded per-tenant
    and prices are pushed to Amazon correctly.
    """
    if not aria_configured():
        return
    log.info("Aria scheduled reprice starting…")
    try:
        asyncio.run(_reprice_all_tenants())
    except Exception as e:
        log.error("Aria scheduled reprice failed: %s", e)


async def _reprice_all_tenants():
    """Run Aria for every tenant that has products + Amazon credentials."""
    db = SessionLocal()
    try:
        tenants = db.query(models.Tenant).all()
        tenant_ids = [t.id for t in tenants]
    finally:
        db.close()

    if not tenant_ids:
        # Single-tenant / no tenant table — run without filter
        await run_all_async(tenant_id=None)
        return

    total = {"repriced": 0, "pushed": 0, "skipped": 0, "errors": 0}
    for tid in tenant_ids:
        try:
            r = await run_all_async(tenant_id=tid)
            for k in total:
                total[k] += r.get(k, 0)
        except Exception as e:
            log.error("Aria: tenant %d failed: %s", tid, e)

    log.info(
        "Aria scheduled run complete (all tenants) — repriced=%d pushed=%d skipped=%d errors=%d",
        total["repriced"], total["pushed"], total["skipped"], total["errors"],
    )
