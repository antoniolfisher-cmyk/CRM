"""
Aura Repricer API client.

Docs: https://docs.goaura.com/api-reference
Auth: HTTP Basic Auth — API key as username, empty password.
All prices are in cents (integer).

Required env var:
  AURA_API_KEY   e.g. key_2ubjfjUcF0z6lcFio24TC1D9xUa
"""

import os
import httpx
import logging
from typing import Optional

log = logging.getLogger(__name__)

AURA_API_KEY  = os.getenv("AURA_API_KEY", "")
AURA_BASE_URL = "https://api.goaura.com"


def _is_configured() -> bool:
    return bool(AURA_API_KEY)


def _auth() -> tuple:
    return (AURA_API_KEY, "")


# ─── listing fetch ────────────────────────────────────────────────────────────

def fetch_all_listings(platform: str = "amazon") -> list:
    """Fetch every listing from Aura (handles pagination)."""
    if not _is_configured():
        raise ValueError("AURA_API_KEY is not set")

    listings = []
    params = {"platform": platform, "limit": 100}

    with httpx.Client(base_url=AURA_BASE_URL, auth=_auth(), timeout=30) as client:
        while True:
            resp = client.get("/listings", params=params)
            resp.raise_for_status()
            data = resp.json()
            page = data.get("data", [])
            listings.extend(page)

            # Aura uses cursor-based pagination
            if not data.get("has_more") or not page:
                break
            params["starting_after"] = page[-1]["id"]

    log.info("Fetched %d Aura listings", len(listings))
    return listings


# ─── listing update ───────────────────────────────────────────────────────────

def update_listing(
    listing_id: str,
    cost: Optional[float] = None,
    minimum_price: Optional[float] = None,
    maximum_price: Optional[float] = None,
    currency: str = "usd",
) -> dict:
    """
    Update an Aura listing. Prices/cost are in dollars — we convert to cents.
    Only sends fields that are provided and > 0.
    """
    if not _is_configured():
        raise ValueError("AURA_API_KEY is not set")

    payload = {"currency": currency}
    if cost is not None and cost > 0:
        payload["cost"] = int(round(cost * 100))
    if minimum_price is not None and minimum_price > 0:
        payload["minimum_price"] = int(round(minimum_price * 100))
    if maximum_price is not None and maximum_price > 0:
        payload["maximum_price"] = int(round(maximum_price * 100))

    with httpx.Client(base_url=AURA_BASE_URL, auth=_auth(), timeout=30) as client:
        resp = client.patch(f"/listings/{listing_id}", data=payload)
        resp.raise_for_status()
        return resp.json()


# ─── sync helper ─────────────────────────────────────────────────────────────

def sync_products_to_aura(products: list) -> dict:
    """
    Match CRM products to Aura listings by ASIN and push cost/pricing.
    Returns a summary dict with synced, skipped, and errors lists.
    """
    if not _is_configured():
        raise ValueError("AURA_API_KEY is not set — add it to Railway environment variables")

    # Build ASIN → listing map from Aura
    aura_listings = fetch_all_listings()
    asin_map = {}
    for listing in aura_listings:
        asin = (
            listing.get("asin")
            or listing.get("product", {}).get("asin")
            or listing.get("catalog_item", {}).get("asin")
            or listing.get("external_id")   # fallback
        )
        if asin:
            asin_map[asin.strip().upper()] = listing

    synced, skipped, errors = [], [], []

    for p in products:
        asin = (p.asin or "").strip().upper()

        if not asin:
            skipped.append({"product": p.product_name, "reason": "No ASIN on product"})
            continue

        listing = asin_map.get(asin)
        if not listing:
            skipped.append({"product": p.product_name, "asin": asin, "reason": "ASIN not found in Aura"})
            continue

        try:
            update_listing(
                listing_id=listing["id"],
                cost=p.buy_cost or None,
                minimum_price=p.total_cost or None,
                maximum_price=p.buy_box or None,
            )
            synced.append({"product": p.product_name, "asin": asin, "listing_id": listing["id"]})
        except Exception as e:
            errors.append({"product": p.product_name, "asin": asin, "error": str(e)})

    return {"synced": synced, "skipped": skipped, "errors": errors}
