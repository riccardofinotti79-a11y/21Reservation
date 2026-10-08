"""Stripe payments for booking deposits (Flow A — claimable sandbox)."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlsplit

import stripe

logger = logging.getLogger(__name__)

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")


def _origin(url: str) -> str:
    """'https://Host:443/path' -> 'https://host:443' (solo schema + host + porta)."""
    try:
        p = urlsplit((url or "").strip())
    except ValueError:
        return ""
    if p.scheme not in ("http", "https") or not p.netloc:
        return ""
    return f"{p.scheme}://{p.netloc.lower()}"


def safe_origin(origin_url: Optional[str]) -> str:
    """Accetta origin_url solo se è in whitelist (PUBLIC_BASE_URL o CORS_ORIGINS),
    altrimenti usa la base pubblica: evita redirect di Stripe verso domini arbitrari."""
    public_base = _origin(os.environ.get("PUBLIC_BASE_URL", ""))
    allowed = {public_base} | {
        _origin(o) for o in os.environ.get("CORS_ORIGINS", "").split(",")
    }
    allowed.discard("")
    candidate = _origin(origin_url or "")
    if candidate and candidate in allowed:
        return candidate
    if public_base:
        return public_base
    raise ValueError("origin_url non consentito e PUBLIC_BASE_URL non configurato")


def create_deposit_checkout(
    origin_url: str,
    booking_id: str,
    amount_eur: float,
    currency: str,
    guest_email: Optional[str],
    restaurant_name: str,
) -> dict:
    """Create a Stripe Checkout session for a booking deposit.

    Returns dict with session_id, url, amount, currency.
    """
    if not stripe.api_key:
        raise ValueError("STRIPE_SECRET_KEY not configured")
    unit_amount = int(round(float(amount_eur) * 100))
    if unit_amount <= 0:
        raise ValueError("Deposit amount must be > 0")
    origin_url = safe_origin(origin_url)
    kwargs = dict(
        mode="payment",
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": (currency or "eur").lower(),
                "unit_amount": unit_amount,
                "product_data": {
                    "name": f"Deposito prenotazione — {restaurant_name}",
                    "description": f"Booking #{booking_id[:8]}",
                },
            },
            "quantity": 1,
        }],
        success_url=f"{origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin_url}/payment/cancel?booking_id={booking_id}",
        metadata={"booking_id": booking_id},
    )
    if guest_email:
        kwargs["customer_email"] = guest_email
    session = stripe.checkout.Session.create(**kwargs)
    return {
        "session_id": session.id,
        "url": session.url,
        "amount": amount_eur,
        "currency": (currency or "eur").lower(),
    }


def retrieve_session(session_id: str):
    return stripe.checkout.Session.retrieve(session_id)


def construct_event(payload: bytes, signature: str):
    if not STRIPE_WEBHOOK_SECRET:
        raise ValueError("STRIPE_WEBHOOK_SECRET not configured")
    return stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
