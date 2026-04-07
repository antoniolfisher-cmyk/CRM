"""
Email notification system for Delight Shoppe CRM.

Sends a daily follow-up digest to each active user who has an email address
and has notifications enabled.

Required env vars:
  SMTP_HOST      e.g. smtp.gmail.com
  SMTP_PORT      e.g. 587
  SMTP_USER      your sending email address
  SMTP_PASSWORD  your email app password
  SMTP_FROM      display name + address, e.g. "Delight Shoppe <you@gmail.com>"
  NOTIFY_HOUR    UTC hour to send daily digest (default: 8  = 8:00 AM UTC)
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
from database import SessionLocal
import models

log = logging.getLogger(__name__)

SMTP_HOST     = os.getenv("SMTP_HOST", "")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM     = os.getenv("SMTP_FROM", SMTP_USER)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
NOTIFY_HOUR   = int(os.getenv("NOTIFY_HOUR", "8"))
APP_URL       = os.getenv("RAILWAY_PUBLIC_DOMAIN", "")
if APP_URL and not APP_URL.startswith("http"):
    APP_URL = f"https://{APP_URL}"


# ─── email sending ────────────────────────────────────────────────────────────

def _smtp_configured() -> bool:
    return bool(RESEND_API_KEY or (SMTP_HOST and SMTP_USER and SMTP_PASSWORD))


def _send_via_resend(to: str, subject: str, html: str):
    # Build a clean lowercase from address
    from_addr = SMTP_FROM or f"Delight Shoppe <noreply@delightshoppe.org>"
    # Resend requires lowercase email addresses
    if '<' in from_addr and '>' in from_addr:
        name_part = from_addr[:from_addr.index('<')].strip()
        email_part = from_addr[from_addr.index('<')+1:from_addr.index('>')].strip().lower()
        from_addr = f"{name_part} <{email_part}>"
    else:
        from_addr = from_addr.lower().strip()

    payload = json.dumps({
        "from": from_addr,
        "to": [to],
        "subject": subject,
        "html": html,
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=payload,
        headers={
            "Authorization": f"Bearer {RESEND_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            log.info("Email sent via Resend to %s: %s", to, subject)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise Exception(f"Resend {e.code}: {body}")


def send_email(to: str, subject: str, html: str):
    if not _smtp_configured():
        log.warning("No email provider configured — skipping email to %s", to)
        return

    if RESEND_API_KEY:
        _send_via_resend(to, subject, html)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = SMTP_FROM
    msg["To"]      = to
    msg.attach(MIMEText(html, "html"))

    port = SMTP_PORT
    if port == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, port, timeout=15) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, to, msg.as_string())
    else:
        with smtplib.SMTP(SMTP_HOST, port, timeout=15) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, to, msg.as_string())
    log.info("Email sent via SMTP to %s: %s", to, subject)


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
          <p style="margin:0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:.05em;">Delight Shoppe</p>
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
            Delight Shoppe CRM · You're receiving this because notifications are enabled for your account.
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
        subject = f"Delight Shoppe · {total} follow-up{'s' if total != 1 else ''} need attention today"

        for user in users:
            html = build_digest_html(user.username, overdue, due_today, due_soon)
            send_email(user.email, subject, html)

    except Exception as e:
        log.error("Digest job failed: %s", e)
    finally:
        db.close()


# ─── scheduler setup ──────────────────────────────────────────────────────────

_scheduler = None

def start_scheduler():
    global _scheduler
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        send_daily_digests,
        CronTrigger(hour=NOTIFY_HOUR, minute=0),
        id="daily_digest",
        replace_existing=True,
    )
    _scheduler.start()
    log.info("Notification scheduler started — digests at %02d:00 UTC", NOTIFY_HOUR)


def stop_scheduler():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
