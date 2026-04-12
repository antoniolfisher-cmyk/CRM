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
import logging

log = logging.getLogger(__name__)

STRIPE_SECRET_KEY      = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.getenv("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET  = os.getenv("STRIPE_WEBHOOK_SECRET", "")
APP_URL                = os.getenv("APP_URL", "http://localhost:5173")

# ── Plans ─────────────────────────────────────────────────────────────────────
PLANS = {
    "starter": {
        "name":        "Starter",
        "price":       0,
        "price_label": "Free",
        "stripe_price_id": os.getenv("STRIPE_PRICE_STARTER", ""),
        "features": [
            "1 user",
            "Up to 100 ASINs",
            "CRM (accounts, contacts, follow-ups)",
            "Basic orders tracking",
        ],
        "limits": {"users": 1, "products": 100},
    },
    "pro": {
        "name":        "Pro",
        "price":       4900,   # cents
        "price_label": "$49/mo",
        "stripe_price_id": os.getenv("STRIPE_PRICE_PRO", ""),
        "features": [
            "5 users",
            "Unlimited ASINs",
            "Full Amazon SP-API integration",
            "Live Sales & Inventory dashboard",
            "AI Repricer (Aria)",
            "Ungate workflow",
            "Keepa data",
        ],
        "limits": {"users": 5, "products": -1},
    },
    "enterprise": {
        "name":        "Enterprise",
        "price":       19900,  # cents
        "price_label": "$199/mo",
        "stripe_price_id": os.getenv("STRIPE_PRICE_ENTERPRISE", ""),
        "features": [
            "Unlimited users",
            "Unlimited ASINs",
            "Everything in Pro",
            "White-label branding",
            "Priority support",
            "Dedicated onboarding",
        ],
        "limits": {"users": -1, "products": -1},
    },
}


def billing_enabled() -> bool:
    return bool(STRIPE_SECRET_KEY)


def get_stripe():
    if not billing_enabled():
        return None
    import stripe
    stripe.api_key = STRIPE_SECRET_KEY
    return stripe


def create_checkout_session(tenant_id: int, plan: str, success_path: str = "/onboarding/amazon",
                             cancel_path: str = "/billing") -> str:
    """Create a Stripe Checkout session and return the URL."""
    stripe = get_stripe()
    if not stripe:
        raise RuntimeError("Stripe is not configured")

    plan_data = PLANS.get(plan)
    if not plan_data or not plan_data.get("stripe_price_id"):
        raise ValueError(f"Invalid plan or missing Stripe price ID for plan: {plan}")

    session = stripe.checkout.Session.create(
        mode="subscription",
        payment_method_types=["card"],
        line_items=[{"price": plan_data["stripe_price_id"], "quantity": 1}],
        success_url=f"{APP_URL}{success_path}?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{APP_URL}{cancel_path}",
        metadata={"tenant_id": str(tenant_id), "plan": plan},
        subscription_data={"trial_period_days": 14},
    )
    return session.url


def create_billing_portal(stripe_customer_id: str, return_path: str = "/billing") -> str:
    """Create a Stripe Customer Portal session and return the URL."""
    stripe = get_stripe()
    if not stripe:
        raise RuntimeError("Stripe is not configured")

    session = stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=f"{APP_URL}{return_path}",
    )
    return session.url


def handle_webhook(payload: bytes, sig_header: str, db) -> dict:
    """Process a Stripe webhook event. Returns {"handled": True/False}."""
    stripe = get_stripe()
    if not stripe:
        return {"handled": False}

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError as e:
        raise ValueError(f"Webhook signature verification failed: {e}")

    import models

    event_type = event["type"]
    data       = event["data"]["object"]

    if event_type == "checkout.session.completed":
        tenant_id = int(data.get("metadata", {}).get("tenant_id", 0))
        plan      = data.get("metadata", {}).get("plan", "pro")
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

    elif event_type in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub    = data
        sub_id = sub.get("id")
        tenant = db.query(models.Tenant).filter_by(stripe_subscription_id=sub_id).first()
        if tenant:
            tenant.stripe_status = sub.get("status", "canceled")
            if event_type == "customer.subscription.deleted":
                tenant.plan          = "starter"
                tenant.stripe_status = "canceled"
            db.commit()
            log.info("Tenant %d subscription updated: %s", tenant.id, tenant.stripe_status)

    elif event_type == "invoice.payment_failed":
        customer = data.get("customer")
        tenant   = db.query(models.Tenant).filter_by(stripe_customer_id=customer).first()
        if tenant:
            tenant.stripe_status = "past_due"
            db.commit()

    return {"handled": True, "event": event_type}
