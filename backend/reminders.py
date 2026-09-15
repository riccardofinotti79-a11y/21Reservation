"""Reminder logic: find bookings due for the 24h reminder and send them."""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone

from db import execute, fetch_all
from email_service import send_email
from psycopg.types.json import Jsonb
from whatsapp_service import send_whatsapp, build_reminder_wa

logger = logging.getLogger(__name__)


def _cancel_url(base_url: str, token: str) -> str:
    return f"{base_url.rstrip('/')}/cancel/{token}"


def reminder_email_html(
    restaurant_name: str, guest_name: str, date: str, time: str, persons: int,
    cancel_url: str, address: str | None = None,
) -> str:
    addr_line = f"<p style='margin:12px 0 0 0;color:#52525B;'>{address}</p>" if address else ""
    return f"""
    <html><body style="margin:0;padding:0;background:#f6f6f6;font-family:Georgia,serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:32px 0;">
        <tr><td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;">
            <tr><td style="padding:32px 40px;background:#0a0a0a;color:#fafafa;">
              <div style="font-size:12px;letter-spacing:.25em;text-transform:uppercase;color:#a1a1aa;">{restaurant_name}</div>
              <div style="font-size:28px;margin-top:8px;font-family:Georgia,serif;">Promemoria prenotazione</div>
            </td></tr>
            <tr><td style="padding:32px 40px;color:#0a0a0a;font-family:Arial,sans-serif;">
              <p style="margin:0 0 16px 0;">Ciao <strong>{guest_name}</strong>,</p>
              <p style="margin:0 0 20px 0;color:#52525B;">
                Ti aspettiamo <strong>domani</strong> per la tua prenotazione presso <strong>{restaurant_name}</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
                     style="border:1px solid #e4e4e7;border-radius:6px;">
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e4e4e7;">
                  <div style="font-size:11px;letter-spacing:.2em;color:#71717a;text-transform:uppercase;">Data</div>
                  <div style="font-size:16px;margin-top:2px;">{date}</div>
                </td></tr>
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e4e4e7;">
                  <div style="font-size:11px;letter-spacing:.2em;color:#71717a;text-transform:uppercase;">Ora</div>
                  <div style="font-size:16px;margin-top:2px;">{time}</div>
                </td></tr>
                <tr><td style="padding:12px 16px;">
                  <div style="font-size:11px;letter-spacing:.2em;color:#71717a;text-transform:uppercase;">Ospiti</div>
                  <div style="font-size:16px;margin-top:2px;">{persons}</div>
                </td></tr>
              </table>
              {addr_line}
              <p style="margin:32px 0 12px 0;color:#52525B;font-size:13px;">
                Se non puoi venire, aiutaci liberando il tavolo per altri ospiti:
              </p>
              <p style="margin:0;">
                <a href="{cancel_url}" style="display:inline-block;padding:10px 18px;border:1px solid #0a0a0a;border-radius:999px;color:#0a0a0a;text-decoration:none;font-family:Arial,sans-serif;font-size:13px;">
                  Disdici la prenotazione
                </a>
              </p>
            </td></tr>
            <tr><td style="padding:24px 40px;background:#f8f9fa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;font-family:Arial,sans-serif;">
              21Reservation · Il ristorante ti ringrazia della puntualità.
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """


async def send_reminders_for_restaurant(
    restaurant: dict, base_url: str,
) -> dict:
    """Send reminders for bookings ~lead_hours ahead. Idempotent per booking."""
    if not restaurant.get("reminder_enabled", True):
        return {"restaurant_id": restaurant["id"], "sent": 0, "skipped": "disabled"}

    lead_hours = int(restaurant.get("reminder_lead_hours", 24))
    # Target date = today + floor(lead_hours/24). For 24 that's tomorrow.
    target = (datetime.now(timezone.utc).date() + timedelta(hours=lead_hours)).isoformat()

    # Find candidate bookings (single JOIN kills the N+1 customer lookups):
    # active + on target date + not yet reminded
    docs = await fetch_all(
        "SELECT b.id, b.date, b.time, b.persons, b.cancel_token, r.name AS restaurant_name, "
        "       r.address, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone "
        "FROM bookings b "
        "JOIN customers c ON c.id = b.customer_id "
        "JOIN restaurants r ON r.id = b.restaurant_id "
        "WHERE b.restaurant_id = %s AND b.date = %s AND b.status IN ('accepted','seated','pending') "
        "  AND b.reminder_sent_at IS NULL",
        (restaurant["id"], target),
    )

    sent = 0
    for b in docs:
        customer = {
            "name": b["customer_name"],
            "email": b["customer_email"],
            "phone": b["customer_phone"],
        }

        # Ensure cancel_token
        token = b.get("cancel_token") or secrets.token_urlsafe(24)
        cancel_url = _cancel_url(base_url, token)

        did_email = False
        did_wa = False
        if customer["email"]:
            html = reminder_email_html(
                restaurant["name"], customer["name"], b["date"], b["time"], b["persons"],
                cancel_url, b.get("address"),
            )
            did_email = await send_email(
                customer["email"], f"Promemoria — {restaurant['name']}", html,
            )
        if customer["phone"] and restaurant.get("whatsapp_enabled"):
            wa_msg = build_reminder_wa(
                restaurant["name"], customer["name"], b["date"], b["time"], b["persons"], cancel_url,
            )
            did_wa = await send_whatsapp(restaurant, customer["phone"], wa_msg)

        # Mark as sent regardless (best effort). Idempotency: we only pick rows with reminder_sent_at=None.
        await execute(
            "UPDATE bookings SET cancel_token = %s, reminder_sent_at = %s, reminder_channels = %s WHERE id = %s",
            (token, datetime.now(timezone.utc).isoformat(),
             Jsonb([c for c, ok in [("email", did_email), ("whatsapp", did_wa)] if ok]), b["id"]),
        )
        sent += 1

    return {"restaurant_id": restaurant["id"], "target_date": target, "sent": sent}
