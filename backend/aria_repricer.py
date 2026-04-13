"""
Aria AI Repricer
Powered by Claude Haiku for cost-efficient, automated Amazon pricing.

Smart triggering: a product is skipped if its Buy Box price hasn't changed
since Aria last ran, avoiding unnecessary API calls.
"""

import os
import json
import asyncio
import logging
from datetime import datetime

import anthropic

from database import SessionLocal
import models

log = logging.getLogger(__name__)

_MODEL = "claude-haiku-4-5-20251001"   # ~75% cheaper than Sonnet, plenty smart for pricing


def aria_configured() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY", "").strip())


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


async def price_product(product: models.Product, strategy) -> dict:
    """Call Claude Haiku and return {price, reasoning}.  Enforces min/max constraints."""
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


async def run_all_async(force: bool = False, tenant_id=None) -> dict:
    """
    Reprice all eligible products for a specific tenant.
    Smart trigger: skips products whose Buy Box price hasn't changed since
    the last Aria run (unless force=True).
    Returns summary dict.
    """
    db = SessionLocal()
    try:
        strategy = _get_strategy(db, tenant_id=tenant_id)

        q = db.query(models.Product).filter(
            models.Product.buy_box > 0,
            models.Product.buy_cost > 0,
        )
        if tenant_id is not None:
            q = q.filter(models.Product.tenant_id == tenant_id)
        candidates = q.all()

        repriced = skipped = errors = 0

        for p in candidates:
            # Smart trigger: skip if buy box unchanged since last run
            if not force and p.aria_last_buy_box is not None and p.aria_last_buy_box == p.buy_box:
                skipped += 1
                continue

            try:
                r = await price_product(p, strategy)
                p.aria_suggested_price = r["price"]
                p.aria_suggested_at    = datetime.utcnow()
                p.aria_reasoning       = r["reasoning"]
                p.aria_last_buy_box    = p.buy_box   # record buy box at time of run
                repriced += 1
                log.info("Aria repriced %s → $%.2f (%s)", p.product_name, r["price"], r["reasoning"])
            except Exception as e:
                errors += 1
                log.warning("Aria failed for product %d (%s): %s", p.id, p.product_name, e)

        db.commit()
        log.info("Aria run complete — repriced=%d skipped=%d errors=%d", repriced, skipped, errors)
        return {"repriced": repriced, "skipped": skipped, "errors": errors}
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
