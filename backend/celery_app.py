"""
Celery application for SellerPulse.

Uses Redis as broker and result backend (REDIS_URL env var).
Falls back gracefully — if REDIS_URL is not set, tasks are no-ops.

Beat schedule mirrors the APScheduler jobs in notifications.py so
both systems are not running simultaneously. The worker service
runs EITHER APScheduler (worker.py) OR Celery beat+worker depending
on USE_CELERY=true env var.
"""
import os
import logging

log = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "")

if not REDIS_URL:
    # Stub so imports don't fail on web service
    class _StubCelery:
        def task(self, *a, **kw):
            def decorator(fn):
                return fn
            return decorator
        def send_task(self, *a, **kw):
            pass
    celery = _StubCelery()
    log.info("Celery: REDIS_URL not set — running in stub mode")
else:
    from celery import Celery
    from celery.schedules import crontab

    celery = Celery(
        "sellerpulse",
        broker=REDIS_URL,
        backend=REDIS_URL,
        include=["tasks"],
    )

    celery.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        enable_utc=True,
        task_acks_late=True,           # re-queue if worker crashes mid-task
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,  # one task at a time per worker
        task_soft_time_limit=300,      # 5 min soft limit
        task_time_limit=600,           # 10 min hard limit
        result_expires=3600,
        beat_schedule={
            "daily-digest": {
                "task": "tasks.run_daily_digests",
                "schedule": crontab(hour=int(os.getenv("NOTIFY_HOUR", "8")), minute=0),
            },
            "auto-followups": {
                "task": "tasks.run_auto_followups",
                "schedule": crontab(hour=10, minute=30),
            },
            "aria-reprice": {
                "task": "tasks.run_aria_reprice",
                "schedule": crontab(minute=0),  # every hour
            },
            "amazon-sync": {
                "task": "tasks.run_amazon_sync",
                "schedule": crontab(minute=15),  # every hour at :15
            },
            "trial-reminders": {
                "task": "tasks.run_trial_reminders",
                "schedule": crontab(hour=9, minute=0),
            },
        },
    )

    log.info("Celery configured with Redis broker")
