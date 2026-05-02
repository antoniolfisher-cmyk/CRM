"""
Email notification system for SellerPulse.

Supported email providers (set ONE of the following in Railway):

  Option A — SendGrid (recommended)
    SENDGRID_API_KEY   your SendGrid API key

  Option B — Resend
    RESEND_API_KEY     your Resend API key

  Option C — Raw SMTP (Gmail, Outlook, etc.)
    SMTP_HOST          e.g. smtp.gmail.com
    SMTP_PORT          e.g. 587
    SMTP_USER          your sending email address
    SMTP_PASS          your email app password  (also accepts SMTP_PASSWORD)

  All options also respect:
    SMTP_FROM          display name + address, e.g. "SellerPulse <noreply@sellers-pulse.com>"
    NOTIFY_HOUR        UTC hour to send daily digest (default: 8)
"""

import os
import smtplib
import logging
import urllib.request
import urllib.error
import json
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from database import SessionLocal
import models

log = logging.getLogger(__name__)

SMTP_HOST        = os.getenv("SMTP_HOST", "")
SMTP_PORT        = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER        = os.getenv("SMTP_USER", "")
SMTP_PASSWORD    = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM        = os.getenv("SMTP_FROM", SMTP_USER)
RESEND_API_KEY   = os.getenv("RESEND_API_KEY", "")
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY", "")
NOTIFY_HOUR   = int(os.getenv("NOTIFY_HOUR", "8"))
FOLLOWUP_DAYS = int(os.getenv("FOLLOWUP_DAYS", "4"))
APP_URL       = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
if APP_URL and not APP_URL.startswith("http"):
    APP_URL = f"https://{APP_URL}"

# ─── Auto follow-up bodies ────────────────────────────────────────────────────

def _auto_followup_body(stage: str, account_name: str, contact_name: str, sender_name: str) -> tuple:
    """Return (subject, body_text) for an auto follow-up at the given stage."""
    acct = account_name
    contact = contact_name or "there"
    sender = sender_name

    if stage == "outreach_sent":
        subject = f"Still Interested — SellerPulse × {acct}"
        body = f"""Dear {contact},

I wanted to follow up on my earlier note about a potential wholesale partnership between SellerPulse and {acct}. I understand how busy things get, and I didn't want my message to get buried.

[CALLOUT]We're a curated e-commerce retailer actively looking to carry quality products for a loyal and growing customer base. We believe {acct} could be a great fit, and we'd love the chance to show you why SellerPulse is a different kind of retail partner.

If the timing isn't right at the moment, no pressure at all — just let me know and I'll circle back when it suits you better.

But if there's any interest, even just a quick reply or a catalog to review, that would mean a great deal to us.

Warm regards,
{sender}
SellerPulse Wholesale"""

    elif stage == "catalog_sent":
        subject = f"Any Questions About Our Inquiry? — SellerPulse × {acct}"
        body = f"""Dear {contact},

Just a quick follow-up to see if you had a chance to review our earlier message about a wholesale partnership with SellerPulse.

We know your inbox is busy, so we'll keep this short: we're genuinely interested in carrying {acct}'s products, and we're flexible on how we get started — whether that's a small initial order, a call to talk through terms, or simply receiving your catalog so we can review what you offer.

[CALLOUT]We're a reliable, consistent buyer with an active e-commerce presence and a customer base that responds well to quality brands. When we commit to a supplier, we order regularly and promote actively.

Would this week work for a quick email exchange or call? We'll follow your lead.

Warm regards,
{sender}
SellerPulse Wholesale"""

    else:
        subject = f"Checking In — SellerPulse × {acct}"
        body = f"""Dear {contact},

Just checking in on our ongoing conversation about a possible partnership between SellerPulse and {acct}. We remain genuinely interested and would love to move things forward at whatever pace works best for you.

Please don't hesitate to reply with any questions, and thank you again for your time.

Warm regards,
{sender}
SellerPulse Wholesale"""

    return subject, body


# ─── Auto follow-up job ───────────────────────────────────────────────────────

def send_auto_followups():
    """
    Daily job: find accounts stuck in an opening-pipeline stage for FOLLOWUP_DAYS
    with no reply received, and send an auto follow-up on behalf of the account owner.
    """
    if not _smtp_configured():
        return

    # Import here to avoid circular dependency at module load time
    from database import SessionLocal
    import models as _models

    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(days=FOLLOWUP_DAYS)

        # Accounts in an actionable stage, updated more than FOLLOWUP_DAYS ago,
        # and haven't had an auto-follow-up in the last 7 days
        stale = db.query(_models.Account).filter(
            _models.Account.pipeline_stage.in_(["outreach_sent", "catalog_sent"]),
            _models.Account.pipeline_updated_at <= cutoff,
            _models.Account.email != None,
            _models.Account.email != "",
        ).filter(
            (_models.Account.last_auto_followup_at == None) |
            (_models.Account.last_auto_followup_at <= datetime.utcnow() - timedelta(days=7))
        ).all()

        log.info("Auto follow-up check: %d account(s) due", len(stale))

        for acc in stale:
            # Get the account owner
            owner = db.query(_models.User).filter(
                _models.User.username == acc.created_by
            ).first() if acc.created_by else None
            sender_name = owner.username if owner else "SellerPulse"

            # Get primary contact name
            primary = next((c for c in acc.contacts if c.is_primary), None)
            if not primary and acc.contacts:
                primary = acc.contacts[0]
            contact_name = primary.first_name if primary else ""

            subject, body_text = _auto_followup_body(
                acc.pipeline_stage, acc.name, contact_name, sender_name
            )

            # Build branded HTML
            from main import _build_wholesale_email_html
            html = _build_wholesale_email_html(body_text, "followup", sender_name)

            inbound_email = os.getenv("CRM_INBOUND_EMAIL", "").strip()
            try:
                send_email(
                    acc.email,
                    subject,
                    html,
                    reply_to=inbound_email or None,
                    custom_headers={"X-Crm-Account-Id": str(acc.id)},
                )

                # Log to email thread
                db.add(_models.EmailMessage(
                    account_id=acc.id,
                    direction="sent",
                    from_email=sender_name,
                    to_email=acc.email,
                    subject=subject,
                    body_text=body_text,
                    is_read=True,
                    sent_by=sender_name + " (auto)",
                ))
                acc.last_auto_followup_at = datetime.utcnow()
                log.info("Auto follow-up sent to %s (account %d, stage=%s)", acc.email, acc.id, acc.pipeline_stage)

            except Exception as e:
                log.error("Auto follow-up failed for account %d: %s", acc.id, e)

        db.commit()
    except Exception as e:
        log.error("Auto follow-up job error: %s", e)
    finally:
        db.close()



if APP_URL and not APP_URL.startswith("http"):
    APP_URL = f"https://{APP_URL}"


# ─── email sending ────────────────────────────────────────────────────────────

def _smtp_configured() -> bool:
    """True if any email provider is configured."""
    return bool(
        os.getenv("SENDGRID_API_KEY") or
        os.getenv("RESEND_API_KEY") or
        (os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and
         (os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD")))
    )


def _send_via_sendgrid(to: str, subject: str, html: str, api_key: str,
                       reply_to: str = None, custom_headers: dict = None,
                       from_name: str = None):
    import httpx
    from_raw = os.getenv("SMTP_FROM", "SellerPulse <noreply@sellerpulse.io>")
    if '<' in from_raw:
        default_name  = from_raw[:from_raw.index('<')].strip().strip('"')
        email_part    = from_raw[from_raw.index('<')+1:from_raw.index('>')].strip().lower()
    else:
        default_name  = "SellerPulse"
        email_part    = from_raw.strip().lower()
    # Use the tenant's store name as the display name when provided
    display_name = from_name.strip() if from_name and from_name.strip() else default_name

    payload = {
        "personalizations": [{"to": [{"email": to}]}],
        "from": {"email": email_part, "name": display_name},
        "subject": subject,
        "content": [{"type": "text/html", "value": html}],
    }
    if reply_to:
        payload["reply_to"] = {"email": reply_to}
    if custom_headers:
        payload["headers"] = custom_headers
    resp = httpx.post(
        "https://api.sendgrid.com/v3/mail/send",
        json=payload,
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=30,
    )
    if resp.status_code >= 400:
        try:
            err_body = resp.json()
            msgs = [e.get("message", "") for e in err_body.get("errors", [])]
            combined = " ".join(msgs)
        except Exception:
            raise Exception(f"SendGrid {resp.status_code}: {resp.text}")
        if "does not match a verified Sender Identity" in combined:
            raise Exception(
                "SendGrid rejected the email: the From address isn't verified. "
                "Go to SendGrid → Settings → Sender Authentication and verify the "
                "address set in your SMTP_FROM Railway variable."
            )
        raise Exception(f"SendGrid {resp.status_code}: {msgs[0] if msgs else resp.text}")
    log.info("Email sent via SendGrid to %s: %s", to, subject)


def _send_via_resend(to: str, subject: str, html: str, api_key: str,
                     reply_to: str = None):
    # Read SMTP_FROM at call time so Railway env changes apply without restart
    from_raw = os.getenv("SMTP_FROM", "SellerPulse <noreply@sellers-pulse.com>")
    if '<' in from_raw and '>' in from_raw:
        name_part  = from_raw[:from_raw.index('<')].strip()
        email_part = from_raw[from_raw.index('<')+1:from_raw.index('>')].strip().lower()
        from_addr  = f"{name_part} <{email_part}>"
    else:
        from_addr = from_raw.strip().lower()

    payload = json.dumps({
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html,
        **({"reply_to": reply_to} if reply_to else {}),
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as _r:
            log.info("Email sent via Resend to %s: %s", to, subject)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise Exception(f"Resend {e.code}: {body}")


def _send_via_smtp(to: str, subject: str, html: str,
                   reply_to: str = None):
    host     = os.getenv("SMTP_HOST", "").strip()
    port     = int(os.getenv("SMTP_PORT", "587"))
    user     = os.getenv("SMTP_USER", "").strip()
    password = (os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD") or "").strip()
    from_raw = os.getenv("SMTP_FROM", user)

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = from_raw
    msg["To"]      = to
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(host, port, timeout=30) as server:
        server.ehlo()
        server.starttls()
        server.login(user, password)
        server.sendmail(from_raw, [to], msg.as_string())
    log.info("Email sent via SMTP to %s: %s", to, subject)


def send_email(to: str, subject: str, html: str,
               reply_to: str = None, custom_headers: dict = None,
               from_name: str = None):
    # Read env vars at call time so Railway env changes apply without restart
    sendgrid_key = os.getenv("SENDGRID_API_KEY", "").strip()
    resend_key   = os.getenv("RESEND_API_KEY", "").strip()
    smtp_host    = os.getenv("SMTP_HOST", "").strip()
    smtp_user    = os.getenv("SMTP_USER", "").strip()
    smtp_pass    = (os.getenv("SMTP_PASS") or os.getenv("SMTP_PASSWORD") or "").strip()

    if sendgrid_key:
        _send_via_sendgrid(to, subject, html, sendgrid_key,
                           reply_to=reply_to, custom_headers=custom_headers,
                           from_name=from_name)
    elif resend_key:
        _send_via_resend(to, subject, html, resend_key, reply_to=reply_to)
    elif smtp_host and smtp_user and smtp_pass:
        _send_via_smtp(to, subject, html, reply_to=reply_to)
    else:
        raise Exception(
            "No email provider configured. Set one of: "
            "SENDGRID_API_KEY, RESEND_API_KEY, or SMTP_HOST+SMTP_USER+SMTP_PASS in Railway."
        )


# ─── digest builder ───────────────────────────────────────────────────────────

def _priority_color(priority: str) -> str:
    return {"high": "#dc2626", "medium": "#d97706", "low": "#6b7280"}.get(priority, "#6b7280")

def _type_emoji(ftype: str) -> str:
    return {"call": "📞", "email": "✉️", "meeting": "🤝", "visit": "📍"}.get(ftype, "📋")

def _fmt(dt) -> str:
    if not dt:
        return "—"
    try:
        return dt.strftime("%b %-d, %Y")
    except Exception:
        return str(dt)[:10]


def build_digest_html(username: str, overdue: list, due_today: list, due_soon: list) -> str:
    crm_link = f'<a href="{APP_URL}/follow-ups" style="color:#2563eb;">Open CRM</a>' if APP_URL else "Open CRM"

    def row(fu):
        overdue_flag = fu.due_date and fu.due_date < datetime.utcnow().replace(hour=0, minute=0, second=0)
        date_color = "#dc2626" if overdue_flag else "#374151"
        return f"""
        <tr style="border-bottom:1px solid #f3f4f6;">
          <td style="padding:10px 12px;">
            {_type_emoji(fu.follow_up_type)}
            <strong style="margin-left:6px;">{fu.subject}</strong><br>
            <span style="color:#6b7280;font-size:13px;">{fu.account.name if fu.account else '—'}</span>
          </td>
          <td style="padding:10px 12px;color:{_priority_color(fu.priority)};font-weight:600;font-size:13px;text-transform:uppercase;">
            {fu.priority}
          </td>
          <td style="padding:10px 12px;color:{date_color};font-size:13px;">
            {_fmt(fu.due_date)}
          </td>
        </tr>"""

    def section(title, color, items):
        if not items:
            return ""
        rows = "".join(row(f) for f in items)
        return f"""
        <h3 style="margin:24px 0 8px;color:{color};font-size:15px;">{title}</h3>
        <table width="100%" cellpadding="0" cellspacing="0"
               style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-family:sans-serif;font-size:14px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;">Follow-Up</th>
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;">Priority</th>
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;">Due</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>"""

    total = len(overdue) + len(due_today) + len(due_soon)
    date_str = datetime.utcnow().strftime("%A, %B %-d %Y")

    return f"""
    <!DOCTYPE html>
    <html>
    <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">

        <!-- Header -->
        <div style="background:#1e293b;padding:24px 32px;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">SellerPulse</p>
          <h1 style="margin:4px 0 0;color:#fff;font-size:22px;">Daily Follow-Up Digest</h1>
          <p style="margin:4px 0 0;color:#64748b;font-size:13px;">{date_str}</p>
        </div>

        <!-- Body -->
        <div style="padding:24px 32px;">
          <p style="color:#374151;margin-top:0;">
            Hi <strong>{username}</strong>, you have
            <strong style="color:#1e293b;">{total} follow-up{'' if total == 1 else 's'}</strong>
            that need your attention today.
          </p>

          {section(f"🚨 Overdue ({len(overdue)})", "#dc2626", overdue)}
          {section(f"📅 Due Today ({len(due_today)})", "#d97706", due_today)}
          {section(f"🔜 Due This Week ({len(due_soon)})", "#2563eb", due_soon)}

          {'<p style="color:#6b7280;font-style:italic;text-align:center;padding:24px 0;">🎉 No pending follow-ups right now!</p>' if total == 0 else ''}

          <div style="margin-top:28px;text-align:center;">
            <a href="{APP_URL}/follow-ups" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
              Open Follow-Ups →
            </a>
          </div>
        </div>

        <!-- Footer -->
        <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            SellerPulse · You're receiving this because notifications are enabled for your account.
          </p>
        </div>
      </div>
    </body>
    </html>"""


# ─── scheduler job ────────────────────────────────────────────────────────────

def send_daily_digests():
    if not _smtp_configured():
        log.info("SMTP not configured — skipping daily digest")
        return

    db = SessionLocal()
    try:
        now = datetime.utcnow()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end   = today_start + timedelta(days=1)
        week_end    = today_start + timedelta(days=7)

        users = db.query(models.User).filter(
            models.User.is_active == True,
            models.User.notify_email == True,
            models.User.email != None,
            models.User.email != "",
        ).all()

        log.info("Sending digests to %d users", len(users))

        # Fetch all pending follow-ups once (small DB)
        from sqlalchemy.orm import joinedload
        pending = (
            db.query(models.FollowUp)
            .options(joinedload(models.FollowUp.account), joinedload(models.FollowUp.contact))
            .filter(models.FollowUp.status == "pending")
            .all()
        )

        overdue   = [f for f in pending if f.due_date and f.due_date < today_start]
        due_today = [f for f in pending if f.due_date and today_start <= f.due_date < today_end]
        due_soon  = [f for f in pending if f.due_date and today_end <= f.due_date < week_end]

        # Only send if there is something to report
        if not (overdue or due_today or due_soon):
            log.info("No pending follow-ups — skipping digest")
            return

        total = len(overdue) + len(due_today)
        subject = f"SellerPulse · {total} follow-up{'s' if total != 1 else ''} need attention today"

        for user in users:
            html = build_digest_html(user.username, overdue, due_today, due_soon)
            send_email(user.email, subject, html)

    except Exception as e:
        log.error("Digest job failed: %s", e)
    finally:
        db.close()


# ─── scheduler setup ──────────────────────────────────────────────────────────

_scheduler = None

def send_trial_reminders():
    """Email tenants whose trial ends in exactly 3 days or tomorrow."""
    from datetime import timezone as _tz
    db = SessionLocal()
    try:
        now = datetime.now(_tz.utc)
        for days_left in (3, 1):
            window_start = now + timedelta(days=days_left) - timedelta(hours=12)
            window_end   = now + timedelta(days=days_left) + timedelta(hours=12)
            tenants = db.query(models.Tenant).filter(
                models.Tenant.stripe_status == "trialing",
                models.Tenant.trial_ends_at >= window_start,
                models.Tenant.trial_ends_at <= window_end,
            ).all()
            for t in tenants:
                admin = db.query(models.User).filter(
                    models.User.tenant_id == t.id,
                    models.User.role == "admin",
                    models.User.email.isnot(None),
                ).first()
                if not admin or not admin.email:
                    continue
                label = f"{days_left} day{'s' if days_left != 1 else ''}"
                app_url = os.getenv("APP_URL", "https://app.sellerpulse.io").rstrip("/")
                html = f"""
                <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
                  <h2 style="color:#ea580c">Your SellerPulse trial ends in {label}</h2>
                  <p>Hey {admin.username},</p>
                  <p>Your free trial of SellerPulse expires in <strong>{label}</strong>.
                  After that, access will be paused until you subscribe.</p>
                  <a href="{app_url}/billing"
                     style="display:inline-block;background:#ea580c;color:white;
                            padding:12px 28px;border-radius:8px;text-decoration:none;
                            font-weight:600;margin:16px 0">
                    Upgrade to Enterprise — $175/mo
                  </a>
                  <p style="color:#666;font-size:13px">
                    Questions? Just reply to this email.
                  </p>
                  <p style="color:#999;font-size:11px">SellerPulse · Amazon Seller CRM</p>
                </div>"""
                try:
                    send_email(admin.email, f"Your SellerPulse trial ends in {label}", html)
                    log.info("Trial reminder sent to %s (%s left)", admin.email, label)
                except Exception as e:
                    log.warning("Trial reminder email failed for %s: %s", admin.email, e)
    finally:
        db.close()


def _is_scheduler_leader() -> bool:
    """
    With multiple uvicorn workers (and multiple Railway replicas) each process
    starts APScheduler. Use Redis SET NX to elect a single leader globally so
    jobs fire exactly once. Falls back to True when Redis is unavailable.
    """
    import socket
    redis_url = os.getenv("REDIS_URL", "")
    if not redis_url:
        return True   # no Redis — single worker assumed, always run
    # Unique ID: hostname (unique per Railway replica) + PID (unique per worker)
    _my_id = f"{socket.gethostname()}:{os.getpid()}"
    try:
        import redis as _redis
        r = _redis.from_url(redis_url, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        # 55-second TTL: leader must renew before next job check or a new leader is elected
        result = r.set("scheduler:leader", _my_id, nx=True, ex=55)
        if result:
            log.info("Scheduler leader elected: %s", _my_id)
            return True
        # Another process won — check if it is still us (restart scenario)
        return r.get("scheduler:leader") == _my_id
    except Exception as _e:
        log.warning("Scheduler leader election failed (%s) — running scheduler anyway", _e)
        return True   # Redis error — allow this worker to avoid silent job loss


def start_scheduler():
    global _scheduler
    if os.getenv("USE_CELERY", "").lower() in ("1", "true", "yes"):
        log.info("Scheduler: USE_CELERY=true — APScheduler disabled, Celery beat handles scheduling")
        return
    if not _is_scheduler_leader():
        log.info("Scheduler: another worker is leader — skipping job registration")
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        send_daily_digests,
        CronTrigger(hour=NOTIFY_HOUR, minute=0),
        id="daily_digest",
        replace_existing=True,
    )
    _scheduler.add_job(
        send_auto_followups,
        CronTrigger(hour=10, minute=30),   # 10:30 AM UTC daily
        id="auto_followups",
        replace_existing=True,
    )

    # Aria AI Repricer — every 1 hour, smart-triggered (skips unchanged buy boxes)
    try:
        from aria_repricer import scheduled_reprice as aria_reprice
        _scheduler.add_job(
            aria_reprice,
            IntervalTrigger(hours=1),
            id="aria_reprice",
            replace_existing=True,
        )
        log.info("Aria repricer scheduled every 1 hour")
    except Exception as _e:
        log.warning("Aria repricer scheduler not loaded: %s", _e)

    # Amazon FBA Inventory Sync — every 1 hour
    try:
        from amazon_sync import scheduled_sync as amazon_sync_job
        _scheduler.add_job(
            amazon_sync_job,
            IntervalTrigger(hours=1),
            id="amazon_inventory_sync",
            replace_existing=True,
        )
        log.info("Amazon inventory sync scheduled every 1 hour")
    except Exception as _e:
        log.warning("Amazon inventory sync scheduler not loaded: %s", _e)

    # Trial expiry reminder — daily at 9 AM UTC
    _scheduler.add_job(
        send_trial_reminders,
        CronTrigger(hour=9, minute=0),
        id="trial_reminders",
        replace_existing=True,
    )

    # Audit log retention — delete rows older than AUDIT_LOG_RETENTION_DAYS (default 90)
    _scheduler.add_job(
        _purge_old_audit_logs,
        CronTrigger(hour=2, minute=0),   # 2 AM UTC daily, low-traffic window
        id="audit_log_purge",
        replace_existing=True,
    )

    # Keepa bulk refresh — every 6 hours, enriches all products with BSR/buy box data
    try:
        from keepa_scheduler import scheduled_keepa_refresh
        _scheduler.add_job(
            scheduled_keepa_refresh,
            IntervalTrigger(hours=6),
            id="keepa_bulk_refresh",
            replace_existing=True,
        )
        log.info("Keepa bulk refresh scheduled every 6 hours")
    except Exception as _e:
        log.warning("Keepa scheduler not loaded: %s", _e)

    _scheduler.start()
    log.info("Notification scheduler started — digests at %02d:00 UTC", NOTIFY_HOUR)


def _purge_old_audit_logs():
    """Delete audit log rows older than AUDIT_LOG_RETENTION_DAYS (default: 90)."""
    retention_days = int(os.getenv("AUDIT_LOG_RETENTION_DAYS", "90"))
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    try:
        db = SessionLocal()
        deleted = db.query(models.AuditLog).filter(models.AuditLog.created_at < cutoff).delete()
        db.commit()
        if deleted:
            log.info("Audit log purge: deleted %d rows older than %d days", deleted, retention_days)
    except Exception as e:
        log.warning("Audit log purge failed: %s", e)
    finally:
        try:
            db.close()
        except Exception:
            pass


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)


def get_aria_schedule_info() -> dict:
    """Return next-run time and interval for the Aria repricer job."""
    if not _scheduler:
        return {"interval_hours": 1, "next_run": None}
    job = _scheduler.get_job("aria_reprice")
    if not job:
        return {"interval_hours": 1, "next_run": None}
    next_run = job.next_run_time
    return {
        "interval_hours": 1,
        "next_run": next_run.isoformat() if next_run else None,
    }
