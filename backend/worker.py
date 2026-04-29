"""
Standalone background worker for SellerPulse.

Mode selection (set in Railway worker service variables):
  USE_CELERY=true   → runs Celery beat + worker (requires REDIS_URL)
  USE_CELERY unset  → runs APScheduler (default, works without Redis)

Start command: python worker.py
"""
import os
import logging
import signal
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# Ensure models/DB are initialised before anything imports them
from database import engine
import models
models.Base.metadata.create_all(bind=engine)
log.info("Database schema verified")

USE_CELERY = os.getenv("USE_CELERY", "").lower() in ("1", "true", "yes")
REDIS_URL   = os.getenv("REDIS_URL", "").strip()

if USE_CELERY and not REDIS_URL:
    log.warning("USE_CELERY=true but REDIS_URL is not set — falling back to APScheduler")
    USE_CELERY = False

if USE_CELERY:
    log.info("Starting Celery beat + worker (Redis: %s)", REDIS_URL.split("@")[-1])
    from celery_app import celery
    import tasks  # register all task definitions

    celery.worker_main([
        "worker",
        "--loglevel=info",
        "--beat",           # embed beat scheduler in this process
        "--concurrency=2",
        "--queues=celery",
    ])

else:
    import time
    from notifications import start_scheduler, stop_scheduler

    def handle_signal(sig, frame):
        log.info("Worker shutting down (signal %s)", sig)
        stop_scheduler()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT,  handle_signal)

    log.info("Starting APScheduler worker")
    start_scheduler()
    log.info("Scheduler running — press Ctrl+C to stop")

    while True:
        time.sleep(60)
