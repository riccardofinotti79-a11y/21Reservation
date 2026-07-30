"""WhatsApp messaging — Twilio and Meta Cloud API support.

Per-restaurant credentials are stored in the Restaurant document (Settings UI).
The send call is executed only when the restaurant has WhatsApp enabled AND
the credentials for the selected provider are fully populated. This keeps
the code paths exercised end-to-end while avoiding any external cost until
the user opts in with real credentials.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def _twilio_ready(r: dict) -> bool:
    return bool(r.get("whatsapp_twilio_sid") and r.get("whatsapp_twilio_auth_token") and r.get("whatsapp_from"))


def _meta_ready(r: dict) -> bool:
    return bool(r.get("whatsapp_meta_phone_id") and r.get("whatsapp_meta_access_token"))


def whatsapp_is_configured(r: dict) -> bool:
    if not r.get("whatsapp_enabled"):
        return False
    provider = r.get("whatsapp_provider")
    if provider == "twilio":
        return _twilio_ready(r)
    if provider == "meta":
        return _meta_ready(r)
    return False


def _normalize_phone(p: str) -> str:
    p = (p or "").strip().replace(" ", "").replace("-", "")
    return p


async def _send_twilio(r: dict, to_phone: str, message: str) -> bool:
    sid = r["whatsapp_twilio_sid"]
    token = r["whatsapp_twilio_auth_token"]
    from_ = r["whatsapp_from"]
    if not from_.startswith("whatsapp:"):
        from_ = f"whatsapp:{_normalize_phone(from_)}"
    to = _normalize_phone(to_phone)
    if not to.startswith("whatsapp:"):
        to = f"whatsapp:{to}"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    data = {"To": to, "From": from_, "Body": message}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, data=data, auth=(sid, token))
    if resp.status_code >= 300:
        logger.error(f"Twilio WA send failed [{resp.status_code}]: {resp.text[:400]}")
        return False
    logger.info(f"Twilio WA sent sid={resp.json().get('sid')}")
    return True


async def _send_meta(r: dict, to_phone: str, message: str) -> bool:
    phone_id = r["whatsapp_meta_phone_id"]
    token = r["whatsapp_meta_access_token"]
    to = _normalize_phone(to_phone).lstrip("+")
    url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"preview_url": True, "body": message},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload, headers={"Authorization": f"Bearer {token}"})
    if resp.status_code >= 300:
        logger.error(f"Meta WA send failed [{resp.status_code}]: {resp.text[:400]}")
        return False
    logger.info(f"Meta WA sent id={(resp.json().get('messages') or [{}])[0].get('id')}")
    return True


async def send_whatsapp(
    restaurant: dict,
    to_phone: str,
    message: str,
) -> bool:
    if not whatsapp_is_configured(restaurant):
        logger.info(f"WA skipped (unconfigured) to {to_phone}")
        return False
    provider = restaurant.get("whatsapp_provider")
    try:
        if provider == "twilio":
            return await _send_twilio(restaurant, to_phone, message)
        if provider == "meta":
            return await _send_meta(restaurant, to_phone, message)
    except Exception as e:
        logger.error(f"WA {provider} send exception: {e}")
    return False


def build_reminder_wa(
    restaurant_name: str, guest_name: str, date: str, time: str, persons: int, cancel_url: str
) -> str:
    return (
        f"Ciao {guest_name}, ti ricordiamo la tua prenotazione da {restaurant_name} "
        f"il {date} alle {time} per {persons} persone. "
        f"Per disdire: {cancel_url}"
    )


def build_confirmation_wa(
    restaurant_name: str, guest_name: str, date: str, time: str, persons: int,
) -> str:
    return (
        f"Ciao {guest_name}, la tua prenotazione da {restaurant_name} "
        f"per il {date} alle {time} ({persons} persone) è confermata. Ti aspettiamo!"
    )
