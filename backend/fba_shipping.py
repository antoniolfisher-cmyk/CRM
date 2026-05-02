"""
FBA Inbound Shipment workflow — Fulfillment Inbound API v2024-03-20.

Flow:
  1. lookup_asin()       – Catalog API 2022-04-01: title, dims, weight
  2. estimate_fees()     – Product Fees API v0/items/{Asin}: referral + FBA fee
  3. create_plan()       – v2024: create plan → packing options → placement options
  4. create_shipment()   – v2024: confirm placement → return shipmentId
  5. set_transport()     – v2024: generate + confirm transportation option
  6. get_transport()     – v2024: poll for transportation status/cost
  7. confirm_transport() – v2024: no-op (confirmation is in set_transport for v2024)
  8. get_labels()        – v2024: fetch box label PDF URL
"""

import asyncio
import logging
from typing import Optional

import httpx

log = logging.getLogger(__name__)

from amazon_sync import _get_access_token_for_tenant

_V2 = "/inbound/fba/2024-03-20"


# ─────────────────────────────────────────────────────────────────────────────
# Async operation poller (all v2024 mutating calls are async)
# ─────────────────────────────────────────────────────────────────────────────

async def _poll_op(base: str, token: str, operation_id: str, max_polls: int = 25) -> None:
    """Poll GET /operations/{operationId} until SUCCESS or raise on FAILED/timeout."""
    for _ in range(max_polls):
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base}{_V2}/operations/{operation_id}",
                headers={"x-amz-access-token": token},
            )
        if resp.status_code != 200:
            raise RuntimeError(f"Operation poll {resp.status_code}: {resp.text[:200]}")
        data   = resp.json()
        status = data.get("operationStatus", "IN_PROGRESS")
        if status == "SUCCESS":
            return
        if status == "FAILED":
            problems = data.get("operationProblems", [])
            msg = "; ".join(p.get("message", "") for p in problems) or "Unknown failure"
            raise RuntimeError(f"FBA operation failed: {msg}")
        await asyncio.sleep(3)
    raise RuntimeError("FBA operation timed out after polling — try again")


def _fmt_403() -> str:
    return (
        "Amazon denied access to FBA Inbound Shipments (403 Unauthorized). "
        "In Seller Central → Apps & Services → Develop Apps, open your SP-API app, "
        "add the 'FBA Inbound Shipment' role, save, then re-authorize to get a new refresh token."
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. ASIN Lookup
# ─────────────────────────────────────────────────────────────────────────────

async def lookup_asin(asin: str, tenant_id: Optional[int] = None) -> dict:
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

    title = ""
    for s in (data.get("summaries") or []):
        if s.get("itemName"):
            title = s["itemName"]
            break
    if not title:
        attrs = data.get("attributes", {})
        title_attr = attrs.get("item_name") or attrs.get("title") or []
        if title_attr:
            title = title_attr[0].get("value", "")

    brand = ""
    brand_attr = (data.get("attributes", {}).get("brand") or [])
    if brand_attr:
        brand = brand_attr[0].get("value", "")

    dims = {}
    for d in (data.get("dimensions") or []):
        pkg = d.get("package") or d.get("item") or {}
        if pkg:
            dims = pkg
            break

    def _dim_in(key):
        v = dims.get(key, {})
        val  = float(v.get("value", 0) or 0)
        unit = (v.get("unit") or "inches").lower()
        if "centimeter" in unit or unit == "cm":
            val = round(val / 2.54, 2)
        return val

    def _weight_lbs():
        w    = dims.get("weight", {})
        val  = float(w.get("value", 0) or 0)
        unit = (w.get("unit") or "pounds").lower()
        if "kilogram" in unit or unit == "kg":
            val = round(val * 2.205, 3)
        elif "gram" in unit:
            val = round(val / 453.592, 3)
        elif "ounce" in unit or unit == "oz":
            val = round(val / 16, 3)
        return val

    image_url = ""
    for img_set in (data.get("images") or []):
        for img in (img_set.get("images") or []):
            if img.get("variant") == "MAIN" and img.get("link"):
                image_url = img["link"]
                break
        if image_url:
            break

    bsr = 0
    category = ""
    for r in (data.get("salesRanks") or []):
        for rank_entry in (r.get("classificationRanks") or []) + (r.get("displayGroupRanks") or []):
            if rank_entry.get("rank"):
                bsr      = rank_entry["rank"]
                category = rank_entry.get("title") or rank_entry.get("displayGroupName") or ""
                break
        if bsr:
            break

    return {
        "asin":       asin,
        "title":      title or asin,
        "brand":      brand,
        "image_url":  image_url,
        "bsr":        bsr,
        "category":   category,
        "length_in":  _dim_in("length"),
        "width_in":   _dim_in("width"),
        "height_in":  _dim_in("height"),
        "weight_lbs": _weight_lbs(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. Fee Estimation (Fees API v0 per-ASIN — still active)
# ─────────────────────────────────────────────────────────────────────────────

async def estimate_fees(asin: str, price: float, tenant_id: Optional[int] = None) -> dict:
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
    if result.get("Status") != "Success":
        err = (result.get("Error") or {}).get("Message", "Unknown error")
        raise RuntimeError(f"Fee estimate failed: {err}")

    estimate   = result.get("FeesEstimate", {})
    fee_detail = estimate.get("FeeDetailList", [])
    referral_fee = 0.0
    fba_fee      = 0.0
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
# Helpers: individual shipment detail + shipping estimate
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_shipment_detail(base: str, token: str, plan_id: str, shipment_id: str) -> dict:
    """GET individual shipment — returns {} on any error (403 is common)."""
    if not shipment_id:
        return {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{base}{_V2}/inboundPlans/{plan_id}/shipments/{shipment_id}",
                headers={"x-amz-access-token": token},
            )
        if r.status_code == 200:
            return r.json().get("shipment", {})
    except Exception:
        pass
    return {}


def _box_item(it: dict, quantity: int) -> dict:
    """Build a box Item for transportationOptions — expiration must be full date-time."""
    entry = {"msku": it["sku"], "quantity": quantity}
    if it.get("expDate"):
        exp = it["expDate"]
        if len(exp) <= 10:  # YYYY-MM-DD → needs time component for transport API
            exp = exp + "T00:00:00Z"
        entry["expiration"] = exp
    return entry


async def _estimate_shipping(
    base: str, token: str, plan_id: str,
    placement_id: str, shipment_ids: list, boxes: list,
    from_address: dict, items: list,
) -> float:
    """
    Generate transportation options for one placement option using supplied box
    dimensions, poll until complete, then return the cheapest partner-carrier cost.
    Returns 0.0 on any error so it never blocks the plan flow.
    """
    if not boxes or not shipment_ids:
        return 0.0
    try:
        total_qty = sum(int(i.get("qty", 1)) for i in items)
        num_boxes = max(1, int(boxes[0].get("count", 1)))
        qty_per_box = max(1, round(total_qty / num_boxes))

        box_def = boxes[0]
        configs = []
        for sid in shipment_ids:
            configs.append({
                "shipmentId": sid,
                "contactInformation": {
                    "name":        from_address.get("name", "Seller"),
                    "phoneNumber": from_address.get("phone") or from_address.get("phoneNumber") or "555-000-0000",
                },
                "boxes": [{
                    "dimensions": {
                        "unitOfMeasurement": "IN",
                        "length": float(box_def.get("length", 12)),
                        "width":  float(box_def.get("width", 10)),
                        "height": float(box_def.get("height", 8)),
                    },
                    "weight": {"unit": "LB", "value": float(box_def.get("weight", 5))},
                    "quantity": num_boxes,
                }],
            })

        # Set packing information for each shipment before generating transport options.
        # Amazon needs box data registered to compute shipping rates.
        for sid in shipment_ids:
            packing_body = {
                "packageGroupings": [{
                    "boxes": [{
                        "contentInformationSource": "BOX_CONTENT_PROVIDED",
                        "dimensions": {
                            "unitOfMeasurement": "IN",
                            "length": float(box_def.get("length", 12)),
                            "width":  float(box_def.get("width", 10)),
                            "height": float(box_def.get("height", 8)),
                        },
                        "weight": {"unit": "LB", "value": float(box_def.get("weight", 5))},
                        "quantity": num_boxes,
                        "items": [_box_item(i, qty_per_box) for i in items],
                    }],
                    "shipmentId": sid,
                }]
            }
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    pr = await client.put(
                        f"{base}{_V2}/inboundPlans/{plan_id}/shipments/{sid}/packingInformation",
                        headers={"x-amz-access-token": token, "Content-Type": "application/json"},
                        json=packing_body,
                    )
                if pr.status_code in (200, 202):
                    op_id = pr.json().get("operationId")
                    if op_id:
                        await _poll_op(base, token, op_id, max_polls=10)
                else:
                    print(f"[FBA packingInfo] {sid} {pr.status_code}: {pr.text[:200]}", flush=True)
            except Exception as pe:
                print(f"[FBA packingInfo error] {pe}", flush=True)

        from datetime import datetime, timezone, timedelta
        ready_start = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ready_end   = (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
        body = {
            "placementOptionId": placement_id,
            "shipmentTransportationConfigurations": configs,
            "readyToShipWindow": {"start": ready_start, "end": ready_end},
        }
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{base}{_V2}/inboundPlans/{plan_id}/transportationOptions",
                headers={"x-amz-access-token": token, "Content-Type": "application/json"},
                json=body,
            )
        if r.status_code in (200, 202):
            op_id = r.json().get("operationId")
            if op_id:
                await _poll_op(base, token, op_id, max_polls=15)
        elif r.status_code == 400:
            # Amazon returns 400 with WARNING/ERROR messages but may still generate
            # SPD (parcel) options even when LTL generation fails. Always fall through
            # to GET so we surface any options Amazon did manage to produce.
            try:
                body_json = r.json()
                print(f"[FBA transport] 400 errors (falling through to GET): {[e.get('message','')[:80] for e in body_json.get('errors',[])]}", flush=True)
                op_id = body_json.get("operationId")
                if op_id:
                    await _poll_op(base, token, op_id, max_polls=15)
            except Exception as e2:
                print(f"[FBA transport] 400 parse error: {e2}", flush=True)
                return 0.0
        else:
            print(f"[FBA transport] POST {r.status_code}: {r.text[:300]}", flush=True)
            return 0.0

        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{base}{_V2}/inboundPlans/{plan_id}/transportationOptions",
                headers={"x-amz-access-token": token},
                params={"placementOptionId": placement_id},
            )
        if r.status_code != 200:
            print(f"[FBA transport GET] {r.status_code}: {r.text[:200]}", flush=True)
            return 0.0
        opts = r.json().get("transportationOptions", [])
        print(f"[FBA transport GET] {len(opts)} options found", flush=True)
        if not opts:
            return 0.0
        # Sum across all shipments in this placement option (cheapest carrier per shipment)
        by_shipment: dict[str, float] = {}
        for o in opts:
            sid  = o.get("shipmentId", "")
            cost = float((o.get("quote") or {}).get("cost", {}).get("amount", 0) or 0)
            if sid not in by_shipment or cost < by_shipment[sid]:
                by_shipment[sid] = cost
        return sum(by_shipment.values())
    except Exception as e:
        print(f"[FBA transport estimate error] {e}", flush=True)
        return 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 3. Create Inbound Plan (v2024-03-20)
# ─────────────────────────────────────────────────────────────────────────────

async def create_plan(
    items: list[dict],
    from_address: dict,
    tenant_id: Optional[int] = None,
    label_prep: str = "SELLER_LABEL",
    boxes: Optional[list[dict]] = None,
) -> list[dict]:
    """
    Full v2024-03-20 plan flow:
      create plan → poll → packing options → poll → confirm → poll
      → placement options → poll → list → return to frontend.
    """
    # Validate: MSKUs cannot be ASINs (10-char B0... codes)
    import re as _re
    _asin_pat = _re.compile(r'^B0[A-Z0-9]{8}$')
    bad = [it["sku"] for it in items if _asin_pat.match(str(it.get("sku", "")).strip().upper())]
    if bad:
        raise RuntimeError(
            f"The following items are missing a Seller SKU and are using their ASIN instead: "
            f"{', '.join(bad)}. "
            f"Go to Products → edit each product and set its Seller SKU before creating an FBA shipment."
        )

    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    label_owner = "AMAZON" if label_prep == "AMAZON_LABEL" else "SELLER"

    # 1. Create inbound plan
    def _item_body(it):
        entry = {
            "labelOwner": it.get("labelOwner") or label_owner,
            "msku":       it["sku"],
            "prepOwner":  it.get("prepOwner") or "SELLER",
            "quantity":   int(it["qty"]),
        }
        if it.get("prepCategory") and it["prepCategory"] != "NONE":
            entry["prepDetails"] = [{"prepCategory": it["prepCategory"]}]
        # NOTE: expiration is intentionally omitted from plan creation.
        # Amazon stores the date-only value internally and then tries to parse it
        # as a full date-time when generateTransportationOptions is called, producing
        # "DateTime value '' is not valid". Expiration is set via setPackingInformation
        # after placement confirmation instead.
        return entry

    plan_body = {
        "items": [_item_body(it) for it in items],
        "marketplaceId":          mkt_id,
        "destinationMarketplaces": [mkt_id],
        "name":                   f"Plan-{int(asyncio.get_event_loop().time())}",
        "sourceAddress": {
            "addressLine1":        from_address.get("address1", ""),
            "city":                from_address.get("city", ""),
            "companyName":         from_address.get("name", "Seller"),
            "countryCode":         from_address.get("country", "US"),
            "name":                from_address.get("name", "Seller"),
            "phoneNumber":         from_address.get("phone", "555-000-0000"),
            "postalCode":          from_address.get("postal_code", ""),
            "stateOrProvinceCode": from_address.get("state", ""),
        },
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json=plan_body,
        )
    if resp.status_code == 403:
        raise RuntimeError(_fmt_403())
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Create Plan API {resp.status_code}: {resp.text[:400]}")

    data    = resp.json()
    plan_id = data["inboundPlanId"]
    await _poll_op(base, token, data["operationId"])

    # 2. Generate packing options
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans/{plan_id}/packingOptions",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Generate packing options {resp.status_code}: {resp.text[:300]}")
    await _poll_op(base, token, resp.json()["operationId"])

    # 3. List packing options → confirm first
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}{_V2}/inboundPlans/{plan_id}/packingOptions",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"List packing options {resp.status_code}: {resp.text[:300]}")
    packing_opts = resp.json().get("packingOptions", [])
    if not packing_opts:
        raise RuntimeError("Amazon returned no packing options — check SKU/ASIN mappings")
    packing_option_id = packing_opts[0]["packingOptionId"]

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans/{plan_id}/packingOptions/{packing_option_id}/confirmation",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Confirm packing option {resp.status_code}: {resp.text[:300]}")
    await _poll_op(base, token, resp.json()["operationId"])

    # 4. Generate placement options
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans/{plan_id}/placementOptions",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Generate placement options {resp.status_code}: {resp.text[:300]}")
    await _poll_op(base, token, resp.json()["operationId"])

    # 5. List placement options
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}{_V2}/inboundPlans/{plan_id}/placementOptions",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"List placement options {resp.status_code}: {resp.text[:300]}")
    placement_opts = resp.json().get("placementOptions", [])
    if not placement_opts:
        raise RuntimeError("Amazon returned no placement options")

    # For each placement option, fetch shipment detail in parallel (FC code + address).
    # Shipping cost estimation via generateTransportationOptions requires the
    # "Amazon Partnered Carrier" SP-API role; without it the call always fails so
    # we skip it here and show "—" in the UI instead.
    async def _enrich(opt):
        placement_id = opt["placementOptionId"]
        shipment_ids = opt.get("shipmentIds") or []
        shipment_id  = shipment_ids[0] if shipment_ids else ""

        # Fees from placement option
        fees_by_target: dict[str, float] = {}
        for f in (opt.get("fees") or []):
            target = (f.get("target") or "").lower()
            amount = float((f.get("value") or {}).get("amount", 0) or 0)
            fees_by_target[target] = fees_by_target.get(target, 0.0) + amount

        detail = await _fetch_shipment_detail(base, token, plan_id, shipment_id)

        dest      = detail.get("destination") or {}
        fc_code   = dest.get("warehouseId", "")
        dest_addr = dest.get("address") or {}

        return {
            "shipment_id":     shipment_id,
            "destination_fc":  fc_code,
            "ship_to_address": {
                "name":        dest_addr.get("name", ""),
                "address1":    dest_addr.get("addressLine1", ""),
                "address2":    dest_addr.get("addressLine2", ""),
                "city":        dest_addr.get("city", ""),
                "state":       dest_addr.get("stateOrProvinceCode", ""),
                "postal_code": dest_addr.get("postalCode", ""),
                "country":     dest_addr.get("countryCode", "US"),
            },
            "items":           [{"sku": i["sku"], "qty": i["qty"]} for i in items],
            "label_prep_type": "SELLER_LABEL",
            "estimated_fees": {
                "placement_fee": fees_by_target.get("placement services", 0.0),
                "labeling_fee":  fees_by_target.get("labeling fee", 0.0),
                "shipping_fee":  None,
            },
            "expires_at":          opt.get("expiration"),
            "inbound_plan_id":     plan_id,
            "placement_option_id": placement_id,
        }

    result = await asyncio.gather(*[_enrich(opt) for opt in placement_opts])
    return list(result)


# ─────────────────────────────────────────────────────────────────────────────
# 4. Create Shipment — confirm selected placement option (v2024-03-20)
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
    Confirms the chosen placement option, then returns the Amazon ShipmentId.
    `plan` must contain inbound_plan_id and placement_option_id from create_plan().
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    plan_id      = plan.get("inbound_plan_id")
    placement_id = plan.get("placement_option_id")

    if not plan_id or not placement_id:
        raise RuntimeError(
            "Plan is missing inbound_plan_id or placement_option_id — "
            "please re-run the plan step before creating a shipment."
        )

    # Confirm placement option
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans/{plan_id}/placementOptions/{placement_id}/confirmation",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code == 403:
        raise RuntimeError(_fmt_403())
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Confirm placement {resp.status_code}: {resp.text[:400]}")
    await _poll_op(base, token, resp.json()["operationId"])

    # The shipment ID was captured from the placement option's shipmentIds list
    # during create_plan — no need to call GET /shipments (that endpoint requires
    # an extra SP-API scope that not all apps have).
    shipment_id = plan.get("shipment_id", "")
    if not shipment_id:
        raise RuntimeError(
            "No shipment ID in plan — please re-run the plan step before creating a shipment."
        )
    return shipment_id


# ─────────────────────────────────────────────────────────────────────────────
# 5. Transport (v2024-03-20)
# ─────────────────────────────────────────────────────────────────────────────

async def set_transport(
    amazon_shipment_id: str,
    packages: list[dict],
    tenant_id: Optional[int] = None,
    is_partnered: bool = True,
    inbound_plan_id: Optional[str] = None,
) -> None:
    """
    Generate + confirm a transportation option for the shipment.
    inbound_plan_id is required for v2024; amazon_shipment_id is the shipmentId.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    if not inbound_plan_id:
        raise RuntimeError(
            "inbound_plan_id is required for transportation — "
            "this shipment was created with the old API. Please create a new shipment."
        )

    # Generate transportation options
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans/{inbound_plan_id}/transportationOptions",
            headers={"x-amz-access-token": token, "Content-Type": "application/json"},
            json={"shipmentIds": [amazon_shipment_id]},
        )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Generate transport options {resp.status_code}: {resp.text[:300]}")
    await _poll_op(base, token, resp.json()["operationId"])

    # List options
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}{_V2}/inboundPlans/{inbound_plan_id}/transportationOptions",
            headers={"x-amz-access-token": token},
            params={"shipmentId": amazon_shipment_id},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"List transport options {resp.status_code}: {resp.text[:300]}")

    transport_opts = resp.json().get("transportationOptions", [])
    if not transport_opts:
        raise RuntimeError("No transportation options returned by Amazon")

    # Pick UPS partnered carrier if available, else first
    chosen = next(
        (t for t in transport_opts if "UPS" in (t.get("carrier", {}).get("name") or "").upper()),
        transport_opts[0],
    )
    transport_option_id = chosen["transportationOptionId"]

    # Confirm transportation option
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{base}{_V2}/inboundPlans/{inbound_plan_id}/transportationOptions/{transport_option_id}/confirmation",
            headers={"x-amz-access-token": token},
        )
    if resp.status_code not in (200, 202):
        raise RuntimeError(f"Confirm transport option {resp.status_code}: {resp.text[:300]}")
    await _poll_op(base, token, resp.json()["operationId"])


async def get_transport(
    amazon_shipment_id: str,
    tenant_id: Optional[int] = None,
    max_polls: int = 8,
    inbound_plan_id: Optional[str] = None,
) -> dict:
    """
    Get confirmed transportation details for a shipment.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    if not inbound_plan_id:
        return {"status": "UNKNOWN", "estimated_cost": None, "currency": "USD"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base}{_V2}/inboundPlans/{inbound_plan_id}/transportationOptions",
            headers={"x-amz-access-token": token},
            params={"shipmentId": amazon_shipment_id},
        )
    if resp.status_code != 200:
        raise RuntimeError(f"Get transport options {resp.status_code}: {resp.text[:300]}")

    opts = resp.json().get("transportationOptions", [])
    if not opts:
        return {"status": "WORKING", "estimated_cost": None, "currency": "USD"}

    # Find confirmed option
    confirmed = next((o for o in opts if o.get("quote", {}).get("cost")), opts[0])
    cost_info = confirmed.get("quote", {}).get("cost") or {}
    return {
        "status":         "ESTIMATED",
        "estimated_cost": float(cost_info.get("amount", 0) or 0),
        "currency":       cost_info.get("currencyCode", "USD"),
    }


async def confirm_transport(amazon_shipment_id: str, tenant_id: Optional[int] = None,
                             inbound_plan_id: Optional[str] = None) -> None:
    """No-op for v2024 — transport confirmation happens in set_transport."""
    pass


async def void_transport(amazon_shipment_id: str, tenant_id: Optional[int] = None,
                          inbound_plan_id: Optional[str] = None) -> None:
    """Cancel transportation for this shipment (v2024 — cancel the inbound plan)."""
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
    if not inbound_plan_id:
        return  # nothing to void if no plan ID
    async with httpx.AsyncClient(timeout=15) as client:
        await client.delete(
            f"{base}{_V2}/inboundPlans/{inbound_plan_id}",
            headers={"x-amz-access-token": token},
        )


# ─────────────────────────────────────────────────────────────────────────────
# 6. Labels (v2024-03-20)
# ─────────────────────────────────────────────────────────────────────────────

async def get_labels(
    amazon_shipment_id: str,
    tenant_id: Optional[int] = None,
    label_type: str = "UNIQUE",
    page_type: str = "PackageLabel_Letter_2",
    inbound_plan_id: Optional[str] = None,
) -> str:
    """
    GET /inbound/fba/2024-03-20/inboundPlans/{planId}/shipments/{shipmentId}/labels
    Returns the URL to the label PDF.
    """
    token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)

    if not inbound_plan_id:
        raise RuntimeError(
            "inbound_plan_id is required to fetch labels. "
            "This shipment was created with the old API — please create a new shipment."
        )

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(
            f"{base}{_V2}/inboundPlans/{inbound_plan_id}/shipments/{amazon_shipment_id}/labels",
            headers={"x-amz-access-token": token},
            params={"PageType": page_type, "LabelType": label_type},
        )

    if resp.status_code != 200:
        raise RuntimeError(f"Labels API {resp.status_code}: {resp.text[:300]}")

    download_url = resp.json().get("downloadURL", "")
    if not download_url:
        raise RuntimeError("Amazon returned no label download URL")
    return download_url


# ─────────────────────────────────────────────────────────────────────────────
# Optimized shipment eligibility probe
# ─────────────────────────────────────────────────────────────────────────────

async def check_optimized_eligible(
    amazon_shipment_id: str,
    tenant_id: Optional[int] = None,
) -> bool:
    try:
        token, mkt_id, base = await _get_access_token_for_tenant(tenant_id)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{base}{_V2}/inboundPlans",
                headers={"x-amz-access-token": token},
                params={"status": "ACTIVE", "pageSize": 1},
            )
        return resp.status_code == 200
    except Exception:
        return False
