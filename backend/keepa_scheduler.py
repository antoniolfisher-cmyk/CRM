"""
Keepa bulk-refresh scheduled job.

Runs every 6 hours via APScheduler (called from notifications.py).
For each tenant that has products with ASINs, refreshes BSR, buy box,
and fee data from Keepa. Respects Keepa token limits — stops on 429.
"""

import asyncio
import logging
import os

import httpx

from database import SessionLocal
import models

log = logging.getLogger(__name__)

_KEEPA_DOMAIN = int(os.getenv("KEEPA_DOMAIN", "1"))


def _parse_and_update(kp: dict, product) -> None:
    """Parse one Keepa product dict and write fields onto the SQLAlchemy model."""
    try:
        stats = kp.get("stats") or {}
        csv   = kp.get("csv") or []

        # BSR — Keepa stores it in csv[3] as alternating [time, rank, ...] pairs
        try:
            bsr_csv = csv[3] if len(csv) > 3 else []
            if bsr_csv and len(bsr_csv) >= 2:
                product.keepa_bsr = int(bsr_csv[-1])
        except Exception:
            pass

        product.keepa_category = kp.get("categoryTree", [{}])[0].get("name") if kp.get("categoryTree") else None

        # 90-day price stats (NEW, FBA, FBM)
        for field, idx in [
            ("price_90_high",  "max"),
            ("price_90_low",   "min"),
            ("price_90_median","avg"),
        ]:
            try:
                # stats["avg"] is a list: [new, used, sales_rank, fba, ...]
                arr = stats.get(idx, []) or []
                new_price = arr[0] if len(arr) > 0 else -1
                if new_price and new_price > 0:
                    setattr(product, field, round(new_price / 100, 2))
            except Exception:
                pass

        # Buy-box winner
        buy_box_csv = csv[18] if len(csv) > 18 else []
        if buy_box_csv and len(buy_box_csv) >= 2:
            try:
                product.buy_box_winner = bool(buy_box_csv[-1])
            except Exception:
                pass

        from datetime import datetime, timezone
        product.keepa_last_synced = datetime.now(timezone.utc)

    except Exception as exc:
        log.warning("keepa_scheduler: parse error for ASIN %s: %s", kp.get("asin"), exc)


async def _refresh_all():
    api_key = os.getenv("KEEPA_API_KEY", "").strip()
    if not api_key:
        log.info("keepa_scheduler: KEEPA_API_KEY not set — skipping")
        return

    db = SessionLocal()
    try:
        products = (
            db.query(models.Product)
            .filter(models.Product.asin.isnot(None), models.Product.asin != "")
            .all()
        )
        if not products:
            log.info("keepa_scheduler: no products with ASINs — nothing to refresh")
            return

        asin_map: dict = {}
        for p in products:
            key = p.asin.strip().upper()
            asin_map.setdefault(key, []).append(p)

        all_asins = list(asin_map.keys())
        refreshed = 0
        log.info("keepa_scheduler: refreshing %d unique ASINs across %d products", len(all_asins), len(products))

        async with httpx.AsyncClient(timeout=60) as client:
            for i in range(0, len(all_asins), 100):
                batch = all_asins[i: i + 100]
                url = (
                    f"https://api.keepa.com/product"
                    f"?key={api_key}&domain={_KEEPA_DOMAIN}&asin={','.join(batch)}&stats=90"
                )
                resp = await client.get(url)

                if resp.status_code == 429:
                    try:
                        refill_hrs = round(resp.json().get("refillIn", 0) / 3600, 1)
                    except Exception:
                        refill_hrs = "?"
                    log.warning("keepa_scheduler: rate limited — pausing, refills in ~%sh", refill_hrs)
                    break

                if resp.status_code != 200:
                    log.error("keepa_scheduler: HTTP %s on batch %d", resp.status_code, i // 100 + 1)
                    continue

                data = resp.json()
                if data.get("error"):
                    log.error("keepa_scheduler: API error on batch %d: %s", i // 100 + 1, data.get("status"))
                    continue

                for kp in data.get("products") or []:
                    kp_asin = (kp.get("asin") or "").strip().upper()
                    for prod in asin_map.get(kp_asin, []):
                        _parse_and_update(kp, prod)
                        refreshed += 1

        db.commit()
        log.info("keepa_scheduler: done — %d products refreshed", refreshed)

    except Exception as exc:
        log.error("keepa_scheduler: unexpected error: %s", exc)
        db.rollback()
    finally:
        db.close()


def scheduled_keepa_refresh():
    """Sync entry point called by APScheduler (must be synchronous)."""
    try:
        asyncio.run(_refresh_all())
    except Exception as exc:
        log.error("keepa_scheduler: scheduled run failed: %s", exc)
