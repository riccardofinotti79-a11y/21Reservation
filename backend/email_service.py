"""Transactional email through Emergent managed proxy (Resend)."""
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]


async def send_email(
    to_email: str,
    subject: str,
    html_content: str,
    reply_to: Optional[str] = None,
) -> bool:
    payload = {
        "to": [to_email],
        "subject": subject,
        "html": html_content,
        "from_name": EMAIL_FROM_NAME,
    }
    if reply_to:
        payload["contact_email"] = reply_to
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        logger.info(f"Email sent to {to_email}: {resp.json().get('id')}")
        return True
    except Exception as e:
        logger.error(f"Email send failed to {to_email}: {e}")
        return False


def booking_confirmation_html(
    restaurant_name: str,
    guest_name: str,
    date: str,
    time: str,
    persons: int,
    status: str,
    address: Optional[str] = None,
) -> str:
    status_label = {
        "accepted": ("Confermata", "#059669"),
        "pending": ("In attesa di conferma", "#D97706"),
    }.get(status, ("Ricevuta", "#52525B"))
    return f"""
    <html><body style="margin:0;padding:0;background:#f6f6f6;font-family:Georgia,serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:32px 0;">
        <tr><td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0"
                 style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;">
            <tr><td style="padding:32px 40px;background:#0a0a0a;color:#fafafa;">
              <div style="font-size:12px;letter-spacing:.25em;text-transform:uppercase;color:#a1a1aa;">{restaurant_name}</div>
              <div style="font-size:28px;margin-top:8px;font-family:Georgia,serif;">Prenotazione {status_label[0]}</div>
            </td></tr>
            <tr><td style="padding:32px 40px;color:#0a0a0a;font-family:Arial,sans-serif;">
              <p style="margin:0 0 16px 0;">Gentile <strong>{guest_name}</strong>,</p>
              <p style="margin:0 0 24px 0;color:#52525B;">Ti scriviamo per confermare la tua prenotazione presso <strong>{restaurant_name}</strong>.</p>
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
                <tr><td style="padding:12px 16px;border-bottom:1px solid #e4e4e7;">
                  <div style="font-size:11px;letter-spacing:.2em;color:#71717a;text-transform:uppercase;">Ospiti</div>
                  <div style="font-size:16px;margin-top:2px;">{persons}</div>
                </td></tr>
                <tr><td style="padding:12px 16px;">
                  <div style="font-size:11px;letter-spacing:.2em;color:#71717a;text-transform:uppercase;">Stato</div>
                  <div style="font-size:16px;margin-top:2px;color:{status_label[1]};font-weight:bold;">{status_label[0]}</div>
                </td></tr>
              </table>
              {"<p style='margin:24px 0 0 0;color:#52525B;'>Indirizzo: " + address + "</p>" if address else ""}
              <p style="margin:32px 0 0 0;color:#52525B;font-size:13px;">In caso di modifiche, contatta direttamente il ristorante.</p>
            </td></tr>
            <tr><td style="padding:24px 40px;background:#f8f9fa;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;font-family:Arial,sans-serif;">
              21Reservation &middot; Sistema di prenotazione ristoranti
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body></html>
    """


def staff_notification_html(
    restaurant_name: str,
    guest_name: str,
    guest_phone: str,
    guest_email: str,
    date: str,
    time: str,
    persons: int,
    message: Optional[str],
) -> str:
    msg_html = f"<p style='margin:16px 0 0 0;'><em>Messaggio ospite:</em> {message}</p>" if message else ""
    return f"""
    <html><body style="font-family:Arial,sans-serif;color:#0a0a0a;">
      <h2 style="font-family:Georgia,serif;">Nuova prenotazione online</h2>
      <p><strong>{restaurant_name}</strong></p>
      <table cellpadding="6" style="border-collapse:collapse;">
        <tr><td><strong>Ospite</strong></td><td>{guest_name}</td></tr>
        <tr><td><strong>Telefono</strong></td><td>{guest_phone}</td></tr>
        <tr><td><strong>Email</strong></td><td>{guest_email}</td></tr>
        <tr><td><strong>Data</strong></td><td>{date}</td></tr>
        <tr><td><strong>Ora</strong></td><td>{time}</td></tr>
        <tr><td><strong>Persone</strong></td><td>{persons}</td></tr>
      </table>
      {msg_html}
    </body></html>
    """
