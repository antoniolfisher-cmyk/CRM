"""
Celery task definitions for SellerPulse.

Each task wraps the existing job functions so the logic stays
in one place (notifications.py, aria_repricer.py, amazon_sync.py).
Tasks have automatic retry with exponential backoff.
"""
import logging
from celery_app import celery

log = logging.getLogger(__name__)

_RETRY_KWARGS = dict(
    autoretry_for=(Exception,),
    retry_backoff=True,        # 2s, 4s, 8s, 16s…
    retry_backoff_max=300,     # cap at 5 minutes
    max_retries=3,
    retry_jitter=True,
)


@celery.task(name="tasks.run_daily_digests", bind=True, **_RETRY_KWARGS)
def run_daily_digests(self):
    from notifications import send_daily_digests
    log.info("[celery] running daily digests")
    send_daily_digests()


@celery.task(name="tasks.run_auto_followups", bind=True, **_RETRY_KWARGS)
def run_auto_followups(self):
    from notifications import send_auto_followups
    log.info("[celery] running auto follow-ups")
    send_auto_followups()


@celery.task(name="tasks.run_aria_reprice", bind=True, **_RETRY_KWARGS)
def run_aria_reprice(self):
    try:
        from aria_repricer import scheduled_reprice
        log.info("[celery] running Aria repricer")
        import asyncio
        asyncio.run(scheduled_reprice())
    except Exception as e:
        log.error("[celery] Aria reprice failed: %s", e)
        raise


@celery.task(name="tasks.run_amazon_sync", bind=True, **_RETRY_KWARGS)
def run_amazon_sync(self):
    try:
        from amazon_sync import scheduled_sync
        log.info("[celery] running Amazon inventory sync")
        import asyncio
        asyncio.run(scheduled_sync())
    except Exception as e:
        log.error("[celery] Amazon sync failed: %s", e)
        raise


@celery.task(name="tasks.run_trial_reminders", bind=True, **_RETRY_KWARGS)
def run_trial_reminders(self):
    from notifications import send_trial_reminders
    log.info("[celery] running trial reminders")
    send_trial_reminders()


# ── On-demand tasks (triggered by user actions) ────────────────────────────────

@celery.task(name="tasks.reprice_one_product", bind=True, **_RETRY_KWARGS)
def reprice_one_product(self, product_id: int):
    """Reprice a single product — triggered when admin clicks 'Run' in UI."""
    try:
        from aria_repricer import reprice_one
        import asyncio
        log.info("[celery] repricing product %d", product_id)
        asyncio.run(reprice_one(product_id))
    except Exception as e:
        log.error("[celery] reprice_one failed for product %d: %s", product_id, e)
        raise


@celery.task(name="tasks.sync_tenant_amazon", bind=True, **_RETRY_KWARGS)
def sync_tenant_amazon(self, tenant_id: int):
    """Sync Amazon inventory for one tenant — triggered by manual sync button."""
    try:
        from amazon_sync import sync_tenant
        import asyncio
        log.info("[celery] syncing Amazon for tenant %d", tenant_id)
        asyncio.run(sync_tenant(tenant_id))
    except Exception as e:
        log.error("[celery] amazon sync failed for tenant %d: %s", tenant_id, e)
        raise
