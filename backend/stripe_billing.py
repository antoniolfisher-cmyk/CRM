"""
Stripe billing integration for multi-tenant SaaS.

Set these env vars to enable billing:
  STRIPE_SECRET_KEY       sk_live_... or sk_test_...
  STRIPE_PUBLISHABLE_KEY  pk_live_... or pk_test_...
  STRIPE_WEBHOOK_SECRET   whsec_...
  APP_URL                 https://yourapp.com  (no trailing slash)

If STRIPE_SECRET_KEY is not set, billing is disabled and all features
are available (suitable for self-hosted / development installs).
"""

import os
import time
import logging
from datetime import datetime

log = logging.getLogger(__name__)

# ── Read env vars fresh on every call (Railway may hot-reload them) ───────────
def _sk():       return os.getenv("STRIPE_SECRET_KEY", "")
def _pk():       return os.getenv("STRIPE_PUBLISHABLE_KEY", "")
def _wh():       return os.getenv("STRIPE_WEBHOOK_SECRET", "")
def _app_url():  return os.getenv("APP_URL", "http://localhost:5173").rstrip("/")

# Keep module-level aliases for backwards compatibility
STRIPE_SECRET_KEY      = property(_sk)
STRIPE_PUBLISHABLE_KEY = property(_pk)
STRIPE_WEBHOOK_SECRET  = property(_wh)

# ── Plans ─────────────────────────────────────────────────────────────────────
PLANS = {
    "starter": {
        "name":        "Starter",
        "price":       0,
        "price_label": "Free",
        "stripe_price_id": "",
        "features": ["Up to 3 users", "Up to 50 products", "Up to 100 accounts", "Basic CRM"],
        "limits": {"users": 3, "products": 50, "accounts": 100},
    },
    "pro": {
        "name":        "Pro",
        "price":       9900,    # $99/mo
        "price_label": "$99/mo",
        "stripe_price_id": os.getenv("STRIPE_PRO_PRICE_ID", "") or os.getenv("STRIPE_PRICE_PRO", ""),
        "features": ["Up to 10 users", "Up to 500 products", "Up to 1,000 accounts", "AI Repricer", "Keepa"],
        "limits": {"users": 10, "products": 500, "accounts": 1000},
    },
    "enterprise": {
        "name":        "Enterprise",
        "price":       17500,   # $175/mo
        "price_label": "$175/mo",
        "stripe_price_id": os.getenv("STRIPE_ENTERPRISE_PRICE_ID", "") or os.getenv("STRIPE_PRICE_ENTERPRISE", ""),
        "features": [
            "Unlimited users", "Unlimited ASINs", "Full Amazon SP-API integration",
            "Live Sales & Inventory dashboard", "AI Repricer (Aria)",
            "Ungate workflow", "Keepa data", "Priority support",
        ],
        "limits": {"users": -1, "products": -1, "accounts": -1},
    },
}


def check_plan_limit(db, tenant_id: int, resource: str) -> tuple[bool, str]:
    """
    Check if a tenant can create another resource given their plan limits.
    Returns (allowed: bool, message: str).
    -1 means unlimited.
    """
    import models as _models
    tenant = db.query(_models.Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        return True, ""

    plan = PLANS.get(tenant.plan or "starter", PLANS["starter"])
    limit = plan["limits"].get(resource, -1)
    if limit == -1:
        return True, ""

    if resource == "users":
        count = db.query(_models.User).filter_by(tenant_id=tenant_id, is_active=True).count()
    elif resource == "products":
        count = db.query(_models.Product).filter_by(tenant_id=tenant_id).count()
    elif resource == "accounts":
        count = db.query(_models.Account).filter_by(tenant_id=tenant_id).count()
    else:
        return True, ""

    if count >= limit:
        return False, (
            f"Your {tenant.plan or 'starter'} plan allows up to {limit} {resource}. "
            f"Upgrade your plan to add more."
        )
    return True, ""

PLAN_PRICES_CENTS = {"enterprise": 17500}


def billing_enabled() -> bool:
    return bool(_sk())


def get_stripe():
    if not billing_enabled():
        return None
    import stripe as _stripe
    _stripe.api_key = _sk()
    return _stripe


def create_checkout_session(tenant_id: int, plan: str, success_path: str = "/onboarding/amazon",
                             cancel_path: str = "/billing") -> str:
    """Create a Stripe Checkout session and return the URL."""
    stripe = get_stripe()
    if not stripe:
        raise RuntimeError("Stripe is not configured")

    plan_data = PLANS.get(plan)
    if not plan_data or not plan_data.get("stripe_price_id"):
        raise ValueError(f"Invalid plan or missing Stripe price ID for plan: {plan}")

    app_url = _app_url()
    # 5-minute idempotency window: retries within the same window reuse the session
    idempotency_key = f"checkout:{tenant_id}:{plan}:{int(time.time()) // 300}"
    session = stripe.checkout.Session.create(
        mode="subscription",
        payment_method_types=["card"],
        line_items=[{"price": plan_data["stripe_price_id"], "quantity": 1}],
        success_url=f"{app_url}{success_path}?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{app_url}{cancel_path}",
        metadata={"tenant_id": str(tenant_id), "plan": plan},
        subscription_data={"trial_period_days": 14},
        idempotency_key=idempotency_key,
    )
    return session.url


def create_billing_portal(stripe_customer_id: str, return_path: str = "/billing") -> str:
    """Create a Stripe Customer Portal session and return the URL."""
    stripe = get_stripe()
    if not stripe:
        raise RuntimeError("Stripe is not configured")

    session = stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=f"{_app_url()}{return_path}",
    )
    return session.url


def record_invoice(db, event_data: dict, tenant_id: int, status: str, plan: str = None):
    """
    Upsert a BillingInvoice row for a Stripe invoice event.
    If the invoice already exists (by stripe_invoice_id) we update its status.
    """
    import models

    stripe_invoice_id = event_data.get("id")

    # Upsert by stripe_invoice_id
    if stripe_invoice_id:
        existing = db.query(models.BillingInvoice).filter_by(
            stripe_invoice_id=stripe_invoice_id
        ).first()
        if existing:
            existing.status = status
            db.commit()
            return existing

    # Resolve period timestamps
    period_start = None
    period_end   = None
    lines = event_data.get("lines", {}).get("data", [])
    if lines:
        p = lines[0].get("period", {})
        if p.get("start"): period_start = datetime.utcfromtimestamp(p["start"])
        if p.get("end"):   period_end   = datetime.utcfromtimestamp(p["end"])
    elif event_data.get("period_start"):
        period_start = datetime.utcfromtimestamp(event_data["period_start"])
    if event_data.get("period_end"):
        period_end = datetime.utcfromtimestamp(event_data["period_end"])

    inv = models.BillingInvoice(
        tenant_id         = tenant_id,
        stripe_invoice_id = stripe_invoice_id,
        stripe_charge_id  = event_data.get("charge"),
        amount_cents      = event_data.get("amount_paid") or event_data.get("amount_due") or 0,
        currency          = event_data.get("currency", "usd"),
        status            = status,
        plan              = plan,
        description       = event_data.get("description") or "Subscription invoice",
        invoice_url       = event_data.get("hosted_invoice_url"),
        period_start      = period_start,
        period_end        = period_end,
    )
    db.add(inv)
    db.commit()
    return inv


def handle_webhook(payload: bytes, sig_header: str, db) -> dict:
    """Process a Stripe webhook event. Returns {"handled": True/False}."""
    stripe = get_stripe()
    if not stripe:
        return {"handled": False}

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, _wh())
    except stripe.error.SignatureVerificationError as e:
        raise ValueError(f"Webhook signature verification failed: {e}")

    import models

    event_type = event["type"]
    data       = event["data"]["object"]

    if event_type == "checkout.session.completed":
        tenant_id = int(data.get("metadata", {}).get("tenant_id", 0))
        plan      = data.get("metadata", {}).get("plan", "enterprise")
        customer  = data.get("customer")
        sub_id    = data.get("subscription")
        if tenant_id:
            tenant = db.query(models.Tenant).filter_by(id=tenant_id).first()
            if tenant:
                tenant.plan                   = plan
                tenant.stripe_customer_id     = customer
                tenant.stripe_subscription_id = sub_id
                tenant.stripe_status          = "active"
                tenant.stripe_price_id        = PLANS.get(plan, {}).get("stripe_price_id")
                db.commit()
                log.info("Tenant %d activated plan=%s", tenant_id, plan)

    elif event_type in ("invoice.payment_succeeded", "invoice.paid"):
        customer = data.get("customer")
        tenant   = db.query(models.Tenant).filter_by(stripe_customer_id=customer).first()
        if tenant:
            # Mark active whenever a payment succeeds (recovers past_due accounts)
            if tenant.stripe_status in ("past_due", "trialing", None):
                tenant.stripe_status = "active"
            record_invoice(db, data, tenant.id, "paid", tenant.plan)
            db.commit()
            log.info("Invoice paid for tenant %d — status=%s", tenant.id, tenant.stripe_status)

    elif event_type == "invoice.payment_failed":
        customer = data.get("customer")
        tenant   = db.query(models.Tenant).filter_by(stripe_customer_id=customer).first()
        if tenant:
            tenant.stripe_status = "past_due"
            record_invoice(db, data, tenant.id, "failed", tenant.plan)
            db.commit()
            log.warning("Invoice payment failed for tenant %d", tenant.id)

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub    = data
        sub_id = sub.get("id")
        tenant = db.query(models.Tenant).filter_by(stripe_subscription_id=sub_id).first()
        if tenant:
            new_status = sub.get("status", "canceled")
            tenant.stripe_status = new_status
            # Sync trial end date from Stripe (authoritative source)
            trial_end = sub.get("trial_end")
            if trial_end:
                tenant.trial_ends_at = datetime.utcfromtimestamp(trial_end)
            if event_type == "customer.subscription.deleted":
                tenant.plan          = "starter"
                tenant.stripe_status = "canceled"
            db.commit()
            log.info("Tenant %d subscription updated: %s", tenant.id, tenant.stripe_status)

    elif event_type == "customer.subscription.trial_will_end":
        # Stripe fires this 3 days before trial ends
        sub_id = data.get("id")
        tenant = db.query(models.Tenant).filter_by(stripe_subscription_id=sub_id).first()
        if tenant:
            trial_end = data.get("trial_end")
            if trial_end:
                tenant.trial_ends_at = datetime.utcfromtimestamp(trial_end)
            db.commit()
            log.info("Trial ending soon for tenant %d", tenant.id)

    elif event_type == "charge.refunded":
        charge_id = data.get("id")
        inv = db.query(models.BillingInvoice).filter_by(stripe_charge_id=charge_id).first()
        if inv:
            inv.status = "refunded"
            db.commit()

    return {"handled": True, "event": event_type}
