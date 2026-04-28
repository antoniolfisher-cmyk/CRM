"""
Standalone scheduler worker — run this as a separate Railway service.

Start command: python worker.py

This process owns ALL scheduled jobs (Aria repricer, Amazon sync,
daily digests, trial reminders). The web service sets
DISABLE_SCHEDULER=true so it never starts the scheduler itself,
preventing double-execution when web replicas > 1.
"""
import os
import time
import logging
import signal
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

# Ensure models/DB are initialised before scheduler imports them
from database import engine
import models
models.Base.metadata.create_all(bind=engine)
log.info("Database schema verified")

from notifications import start_scheduler, stop_scheduler

def handle_signal(sig, frame):
    log.info("Worker shutting down (signal %s)", sig)
    stop_scheduler()
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT,  handle_signal)

log.info("Starting SellerPulse background worker")
start_scheduler()
log.info("Scheduler running — press Ctrl+C to stop")

# Keep the process alive
while True:
    time.sleep(60)
