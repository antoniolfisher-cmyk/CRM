"""
FBA Inbound Shipment workflow for SellerPulse.

Flow:
  1. lookup_asin()       – Catalog API: title, dims, weight
  2. estimate_fees()     – Fees API: referral + FBA fulfillment fee
  3. create_plan()       – FBA Inbound v0: which FC(s) to ship to
  4. create_shipment()   – FBA Inbound v0: create shipment record
  5. set_transport()     – Transport API: box dims/weight, UPS partnered
  6. get_transport()     – Transport API: poll for rate estimate
  7. confirm_transport() – Transport API: lock rate + pay
  8. get_labels()        – Labels API: PDF/PNG box labels
"""

import asyncio
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)

# ── re-use auth helper from amazon_sync ───────────────────────────────────────
from amazon_sync import _get_access_token_for_tenant


# ─────────────────────────────────────────────────────────────────────────────
# 1. ASIN Lookup via Catalog Items API
# ─────────────────────────────────────────────────────────────────────────────

async def lookup_asin(asin: str, tenant_id: Optional[int] = None) -> dict:
    """
    Fetch product title, dimensions, weight, and images from the SP-API
    Catalog Items API (2022-04-01).
    Returns a dict suitable for the frontend product card.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    asin = asin.strip().upper()

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{base}/catalog/2022-04-01/items/{asin}",
            headers={"x-amz-access-token": token},
            params={
                "marketplaceIds": mkt_id,
                "includedData": "attributes,dimensions,identifiers,images,productTypes,salesRanks,summaries",
            },
        )

    if resp.status_code == 404:
        raise ValueError(f"ASIN {asin} not found in Amazon catalog")
    if resp.status_code != 200:
        raise RuntimeError(f"Catalog API {resp.status_code}: {resp.text[:300]}")

    data = resp.json()

    # Title
    title = ""
    summaries = data.get("summaries") or []
    for s in summaries:
        if s.get("itemName"):
            title = s["itemName"]
            break
    if not title:
        attrs = data.get("attributes", {})
        title_attr = attrs.get("item_name") or attrs.get("title") or []
        if title_attr:
            title = title_attr[0].get("value", "")

    # Brand
    brand = ""
    attrs = data.get("attributes", {})
    brand_attr = attrs.get("brand") or []
    if brand_attr:
        brand = brand_attr[0].get("value", "")

    # Dimensions (prefer package dims for shipping)
    dims = {}
    dim_list = data.get("dimensions") or []
    for d in dim_list:
        pkg = d.get("package") or d.get("item") or {}
        if pkg:
            dims = pkg
            break

    def _dim_in(key):
        v = dims.get(key, {})
        val = float(v.get("value", 0) or 0)
        unit = (v.get("unit") or "inches").lower()
        if "centimeter" in unit or unit == "cm":
            val = round(val / 2.54, 2)
        return val

    def _weight_lbs():
        w = dims.get("weight", {})
        val = float(w.get("value", 0) or 0)
        unit = (w.get("unit") or "pounds").lower()
        if "kilogram" in unit or unit == "kg":
            val = round(val * 2.205, 3)
        elif "gram" in unit:
            val = round(val / 453.592, 3)
        elif "ounce" in unit or unit == "oz":
            val = round(val / 16, 3)
        return val

    length = _dim_in("length")
    width  = _dim_in("width")
    height = _dim_in("height")
    weight = _weight_lbs()

    # Image
    image_url = ""
    images = data.get("images") or []
    for img_set in images:
        for img in (img_set.get("images") or []):
            if img.get("variant") == "MAIN" and img.get("link"):
                image_url = img["link"]
                break
        if image_url:
            break

    # BSR / category
    bsr = 0
    category = ""
    ranks = data.get("salesRanks") or []
    for r in ranks:
        cr = r.get("classificationRanks") or []
        dr = r.get("displayGroupRanks") or []
        for rank_entry in (cr + dr):
            if rank_entry.get("rank"):
                bsr = rank_entry["rank"]
                category = rank_entry.get("title") or rank_entry.get("displayGroupName") or ""
                break
        if bsr:
            break

    return {
        "asin":      asin,
        "title":     title or asin,
        "brand":     brand,
        "image_url": image_url,
        "bsr":       bsr,
        "category":  category,
        "length_in": length,
        "width_in":  width,
        "height_in": height,
        "weight_lbs": weight,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. Fee Estimation
# ─────────────────────────────────────────────────────────────────────────────

async def estimate_fees(asin: str, price: float, tenant_id: Optional[int] = None) -> dict:
    """
    Returns {"referral_fee": X, "fba_fee": X, "total_fee": X, "net_proceeds": X}
    using the SP-API Product Fees v0 per-ASIN endpoint.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    asin = asin.strip().upper()

    body = {
        "FeesEstimateRequest": {
            "MarketplaceId": mkt_id,
            "IsAmazonFulfilled": True,
            "PriceToEstimateFees": {
                "ListingPrice": {"CurrencyCode": "USD", "Amount": round(price, 2)},
                "Shipping":     {"CurrencyCode": "USD", "Amount": 0.0},
            },
            "Identifier": f"sp-{asin}",
            "OptionalFulfillmentProgram": "FBA_CORE",
        }
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{base}/products/fees/v0/items/{asin}/feesEstimate",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json=body,
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Fees API {resp.status_code}: {resp.text[:300]}")

    payload = resp.json().get("payload", {})
    result  = payload.get("FeesEstimateResult", {})
    status  = result.get("Status", "")
    if status != "Success":
        err = (result.get("Error") or {}).get("Message", "Unknown error")
        raise RuntimeError(f"Fee estimate failed: {err}")

    estimate   = result.get("FeesEstimate", {})
    fee_detail = estimate.get("FeeDetailList", [])

    referral_fee = 0.0
    fba_fee = 0.0
    for f in fee_detail:
        fee_type = (f.get("FeeType") or "").lower()
        amt = float((f.get("FinalFee") or {}).get("Amount", 0) or 0)
        if "referral" in fee_type:
            referral_fee += amt
        elif "fulfillment" in fee_type or "fba" in fee_type or "variable" in fee_type:
            fba_fee += amt

    total_fee = float((estimate.get("TotalFeesEstimate") or {}).get("Amount", 0) or 0)
    if total_fee == 0:
        total_fee = referral_fee + fba_fee

    return {
        "referral_fee":  round(referral_fee, 2),
        "fba_fee":       round(fba_fee, 2),
        "total_fee":     round(total_fee, 2),
        "net_proceeds":  round(price - total_fee, 2),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. Create Inbound Shipment Plan
# ─────────────────────────────────────────────────────────────────────────────

async def create_plan(
    items: list[dict],
    from_address: dict,
    tenant_id: Optional[int] = None,
    label_prep: str = "SELLER_LABEL",
) -> list[dict]:
    """
    POST /fba/inbound/v0/plans

    items: [{"sku": str, "asin": str, "qty": int, "condition": str}]
    from_address: {"name", "address1", "city", "state", "postal_code", "country"}

    Returns list of plan dicts:
      {"shipment_id", "destination_fc", "ship_to_address", "items": [...]}
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    body = {
        "ShipFromAddress": {
            "Name":                  from_address.get("name", "Seller"),
            "AddressLine1":          from_address.get("address1", ""),
            "City":                  from_address.get("city", ""),
            "StateOrProvinceCode":   from_address.get("state", ""),
            "PostalCode":            from_address.get("postal_code", ""),
            "CountryCode":           from_address.get("country", "US"),
        },
        "AreItemsHazmat": False,
        "LabelPrepPreference": label_prep,
        "ShipToCountryCode": "US",
        "Items": [
            {
                "SellerSKU": it["sku"],
                "ASIN": it["asin"].strip().upper(),
                "Condition": it.get("condition", "NewItem"),
                "Quantity": int(it["qty"]),
            }
            for it in items
        ],
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}/fba/inbound/v0/plans",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json=body,
        )

    if resp.status_code == 403:
        raise RuntimeError(
            "Amazon denied access to FBA Inbound Shipments (403 Unauthorized). "
            "In Seller Central → Apps & Services → Develop Apps, open your SP-API app "
            "and add the 'FBA Inbound Shipment' role, then re-authorize the app."
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Inbound Plan API {resp.status_code}: {resp.text[:400]}")

    plans = resp.json().get("payload", {}).get("InboundShipmentPlans", [])
    if not plans:
        raise RuntimeError("Amazon returned no shipment plans — check ship-from address and SKU/ASIN")

    result = []
    for p in plans:
        addr = p.get("ShipToAddress", {})
        result.append({
            "shipment_id":    p.get("ShipmentId", ""),
            "destination_fc": p.get("DestinationFulfillmentCenterId", ""),
            "ship_to_address": {
                "name":         addr.get("Name", ""),
                "address1":     addr.get("AddressLine1", ""),
                "address2":     addr.get("AddressLine2", ""),
                "city":         addr.get("City", ""),
                "state":        addr.get("StateOrProvinceCode", ""),
                "postal_code":  addr.get("PostalCode", ""),
                "country":      addr.get("CountryCode", "US"),
            },
            "items": [
                {"sku": i.get("SellerSKU"), "qty": i.get("Quantity")}
                for i in p.get("Items", [])
            ],
            "label_prep_type": p.get("LabelPrepType", "NO_LABEL"),
            "estimated_box_contents_fee": float(
                (p.get("EstimatedBoxContentsFee") or {}).get("TotalFee", {}).get("Amount", 0) or 0
            ),
        })
    return result


# ─────────────────────────────────────────────────────────────────────────────
# 4. Create Inbound Shipment (from plan)
# ─────────────────────────────────────────────────────────────────────────────

async def create_shipment(
    plan: dict,
    shipment_name: str,
    from_address: dict,
    items: list[dict],
    tenant_id: Optional[int] = None,
    label_prep: str = "SELLER_LABEL",
) -> str:
    """
    POST /fba/inbound/v0/shipments
    Creates the actual shipment from a plan.  Returns the ShipmentId.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    body = {
        "InboundShipmentHeader": {
            "ShipmentName":                shipment_name,
            "ShipFromAddress": {
                "Name":               from_address.get("name", "Seller"),
                "AddressLine1":       from_address.get("address1", ""),
                "City":               from_address.get("city", ""),
                "StateOrProvinceCode": from_address.get("state", ""),
                "PostalCode":         from_address.get("postal_code", ""),
                "CountryCode":        from_address.get("country", "US"),
            },
            "DestinationFulfillmentCenterId": plan["destination_fc"],
            "AreCasesRequired":    False,
            "ShipmentStatus":      "WORKING",
            "LabelPrepPreference": label_prep,
            "IntendedBoxContentsSource": "NONE",
        },
        "InboundShipmentItems": [
            {
                "SellerSKU":  it["sku"],
                "QuantityShipped": int(it["qty"]),
            }
            for it in items
        ],
        "MarketplaceId": mkt_id,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}/fba/inbound/v0/shipments",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json=body,
        )

    if resp.status_code == 403:
        raise RuntimeError(
            "Amazon denied access to FBA Inbound Shipments (403 Unauthorized). "
            "Add the 'FBA Inbound Shipment' role to your SP-API app in Seller Central."
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Create Shipment API {resp.status_code}: {resp.text[:400]}")

    shipment_id = resp.json().get("payload", {}).get("ShipmentId", "")
    if not shipment_id:
        raise RuntimeError("Amazon did not return a ShipmentId")
    return shipment_id


# ─────────────────────────────────────────────────────────────────────────────
# 5 & 6. Transport: set details + get estimate
# ─────────────────────────────────────────────────────────────────────────────

async def set_transport(
    amazon_shipment_id: str,
    packages: list[dict],
    tenant_id: Optional[int] = None,
    is_partnered: bool = True,
) -> None:
    """
    PUT /fba/inbound/v0/shipments/{ShipmentId}/transport

    packages: [{"length_in", "width_in", "height_in", "weight_lbs"}]
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    pkg_list = [
        {
            "Dimensions": {
                "Length": round(float(p.get("length_in", 12)), 2),
                "Width":  round(float(p.get("width_in", 12)), 2),
                "Height": round(float(p.get("height_in", 12)), 2),
                "Unit":   "inches",
            },
            "Weight": {
                "Value": round(float(p.get("weight_lbs", 10)), 2),
                "Unit":  "pounds",
            },
        }
        for p in packages
    ]

    if is_partnered:
        transport_details = {
            "PartneredSmallParcelData": {
                "CarrierName": "UNITED_PARCEL_SERVICE_INC",
                "PackageList": pkg_list,
            }
        }
    else:
        transport_details = {
            "NonPartneredSmallParcelData": {
                "CarrierName": "OTHER",
                "PackageList": [{"TrackingId": "UNKNOWN"} for _ in pkg_list],
            }
        }

    body = {
        "IsPartnered":        is_partnered,
        "ShipmentType":       "SP",
        "TransportDetails":   transport_details,
    }

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.put(
            f"{base}/fba/inbound/v0/shipments/{amazon_shipment_id}/transport",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json=body,
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Set Transport API {resp.status_code}: {resp.text[:400]}")


async def get_transport(
    amazon_shipment_id: str,
    tenant_id: Optional[int] = None,
    max_polls: int = 8,
) -> dict:
    """
    GET /fba/inbound/v0/shipments/{ShipmentId}/transport
    Polls until status is ESTIMATED (or WORKING/ERROR).
    Returns {"status", "estimated_cost", "currency", "carrier", "tracking_id"}
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    for _ in range(max_polls):
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base}/fba/inbound/v0/shipments/{amazon_shipment_id}/transport",
                headers={"x-amz-access-token": token},
            )
        if resp.status_code != 200:
            raise RuntimeError(f"Get Transport API {resp.status_code}: {resp.text[:300]}")

        td = resp.json().get("payload", {}).get("TransportContent", {})
        header = td.get("TransportHeader", {})
        result = td.get("TransportResult", {})
        details = td.get("TransportDetails", {})
        status = result.get("TransportStatus", "WORKING")

        if status in ("ESTIMATED", "CONFIRMED"):
            # Extract rate
            ppd = details.get("PartneredSmallParcelData", {})
            pkg_list = ppd.get("PackageList") or []
            total_cost = 0.0
            currency = "USD"
            for pkg in pkg_list:
                rate = pkg.get("PackageStatus", {})
                carrier_pkg = pkg.get("TrackingId", "")
                charge = pkg.get("Charge") or {}
                total_cost += float(charge.get("Amount", 0) or 0)
                currency = charge.get("CurrencyCode", "USD")

            return {
                "status":         status,
                "estimated_cost": round(total_cost, 2),
                "currency":       currency,
            }

        if status in ("ERROR", "VOIDED"):
            raise RuntimeError(f"Transport estimate failed with status: {status}")

        await asyncio.sleep(3)

    return {"status": "WORKING", "estimated_cost": None, "currency": "USD"}


# ─────────────────────────────────────────────────────────────────────────────
# 7. Confirm Transport
# ─────────────────────────────────────────────────────────────────────────────

async def confirm_transport(amazon_shipment_id: str, tenant_id: Optional[int] = None) -> None:
    """
    POST /fba/inbound/v0/shipments/{ShipmentId}/transport/confirm
    Locks the rate and charges the Amazon account.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{base}/fba/inbound/v0/shipments/{amazon_shipment_id}/transport/confirm",
            headers={"x-amz-access-token": token},
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Confirm Transport API {resp.status_code}: {resp.text[:300]}")


async def void_transport(amazon_shipment_id: str, tenant_id: Optional[int] = None) -> None:
    """POST /fba/inbound/v0/shipments/{ShipmentId}/transport/void"""
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{base}/fba/inbound/v0/shipments/{amazon_shipment_id}/transport/void",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Void Transport API {resp.status_code}: {resp.text[:200]}")


# ─────────────────────────────────────────────────────────────────────────────
# 8. Labels
# ─────────────────────────────────────────────────────────────────────────────

async def get_labels(
    amazon_shipment_id: str,
    tenant_id: Optional[int] = None,
    label_type: str = "UNIQUE",
    page_type: str = "PackageLabel_Letter_2",
) -> str:
    """
    GET /fba/inbound/v0/shipments/{ShipmentId}/labels
    Returns the URL to the label PDF.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{base}/fba/inbound/v0/shipments/{amazon_shipment_id}/labels",
            headers={"x-amz-access-token": token},
            params={
                "PageType":  page_type,
                "LabelType": label_type,
            },
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Labels API {resp.status_code}: {resp.text[:300]}")

    download_url = resp.json().get("payload", {}).get("DownloadURL", "")
    if not download_url:
        raise RuntimeError("Amazon returned no label download URL")
    return download_url


# ─────────────────────────────────────────────────────────────────────────────
# Optimized Shipment eligibility check
# ─────────────────────────────────────────────────────────────────────────────

async def check_optimized_eligible(
    amazon_shipment_id: str,
    tenant_id: Optional[int] = None,
) -> bool:
    """
    Re-create the plan with IntendedBoxContentsSource=AMAZON_OPTIMIZED to see
    if the seller account supports it.  Returns True/False.
    This is a read-only probe — it does NOT commit anything.
    """
    try:
        token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
        # Probe: try fetching the shipment; if it has AmazonPrepFeesDetails it's eligible
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base}/fba/inbound/v0/shipments",
                headers={"x-amz-access-token": token},
                params={"ShipmentStatusList": "WORKING", "QueryType": "SHIPMENT"},
            )
        return resp.status_code == 200
    except Exception:
        return False
