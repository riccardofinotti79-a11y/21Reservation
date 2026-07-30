"""WhatsApp messaging (infrastructure-only stub).

When a real provider (Twilio/Meta) is configured on the restaurant, the
`send_whatsapp` function would dispatch the message. For now we simply
log the payload so the reminder/notification code path is exercised
without an external dependency.
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)


async def send_whatsapp(
    restaurant: dict,
    to_phone: str,
    message: str,
) -> bool:
    """Attempt to send a WhatsApp message. Returns True if 'sent'.

    Currently returns False if provider not configured, otherwise logs
    a stub. Wire real providers here in the future.
    """
    if not restaurant.get("whatsapp_enabled"):
        logger.info(f"WA skipped (disabled) to {to_phone}")
        return False
    provider = restaurant.get("whatsapp_provider")
    from_ = restaurant.get("whatsapp_from")
    if not provider or not from_:
        logger.info(f"WA skipped (unconfigured) to {to_phone}")
        return False
    # STUB: log and return True as if sent. A real integration would go here.
    logger.info(
        f"[WA STUB] provider={provider} from={from_} to={to_phone} msg={message!r}"
    )
    return True


def build_reminder_wa(
    restaurant_name: str, guest_name: str, date: str, time: str, persons: int, cancel_url: str
) -> str:
    return (
        f"Ciao {guest_name}, ti ricordiamo la tua prenotazione da {restaurant_name} "
        f"il {date} alle {time} per {persons} persone. "
        f"Per disdire: {cancel_url}"
    )
