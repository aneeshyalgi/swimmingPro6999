"""Switching coach from the dashboard: a one-time payment for each switch, on a Stripe Checkout page. A switch costs
$1.99, or $2.99 to the athlete's best match (the coach SwimGPT recommends for them, see context.recommended_coach).

Each checkout is remembered in the athlete's coach_switch record (user_training_sessions) before they are sent to pay,
so a payment is never lost: if its switch never happened (the tab was closed, or the plan couldn't be built), it is
still there the next time the switcher opens and counts towards the next switch, which then only charges what is left.
Spending it deletes the record in the same step that checks it is still there, so one payment can never pay for two
switches. Only one checkout can be paid at a time: starting a new one closes the previous one, or counts it if it was
paid.

The record's details: session_id and coach are the latest checkout and the coach it was for; earlier lists checkouts
that were paid before it and not used yet ({"session_id", "coach"} each), when the latest one pays the rest of a switch.
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

import stripe

from app.config import get_settings
from app.context import recommended_coach
from app.db import get_supabase_client
from app.training import find_record, record_id, save_record

logger = logging.getLogger(__name__)

CURRENCY = "usd"
SWITCH_PRICE = 199  # cents
BEST_MATCH_PRICE = 299
RECORD_KEY = "coach_switch"
PURPOSE = "coach_switch"


def money(cents: int) -> str:
    return f"${cents / 100:.2f}"


def switch_price(profile: dict[str, Any], coach: str) -> int:
    """What a switch to `coach` costs, in cents: more when they are the athlete's best match."""
    return BEST_MATCH_PRICE if coach == recommended_coach(profile) else SWITCH_PRICE


def _belongs(session: Any, profile: dict[str, Any]) -> bool:
    """Whether a Checkout Session is a coach switch bought by this athlete."""
    metadata = session.metadata or {}
    return (metadata.get("purpose") == PURPOSE and metadata.get("user_key") == profile["user_key"]
            and metadata.get("auth_user_id") == str(profile["auth_user_id"]))


def _remember(profile: dict[str, Any], details: dict[str, Any]) -> None:
    save_record(profile["id"], RECORD_KEY, "coach_switch", "Coach switch payment", None, details)


def _paid_checkouts(profile: dict[str, Any], details: dict[str, Any], close_open: bool = False) -> tuple[list[dict[str, Any]], int]:
    """The record's paid checkouts and how much they add up to, in cents. With close_open, a checkout still open is
    closed first, so it can't also be paid later."""
    stripe.api_key = get_settings().stripe_secret_key
    paid, amount = [], 0
    for checkout in [*details.get("earlier", []), {"session_id": details["session_id"], "coach": details.get("coach")}]:
        session = stripe.checkout.Session.retrieve(checkout["session_id"])
        if close_open and session.status == "open":
            try:
                session = stripe.checkout.Session.expire(session.id)
            except stripe.error.InvalidRequestError:
                session = stripe.checkout.Session.retrieve(session.id)  # paid just now, so it can't be closed
        if session.payment_status == "paid" and _belongs(session, profile):
            paid.append(checkout)
            amount += session.amount_total or 0
    return paid, amount


def paid_switch(profile: dict[str, Any]) -> dict[str, Any] | None:
    """What the athlete has paid for a switch that hasn't happened yet, or None: {"amount" in cents, "coaches" (the
    coach each payment was for, latest last), "details" (the record, to spend or restore it)}.
    Raises stripe.error.StripeError when Stripe can't be asked."""
    record = find_record(profile["id"], RECORD_KEY)
    if record is None:
        return None
    paid, amount = _paid_checkouts(profile, record["details"])
    return {"amount": amount, "coaches": [item["coach"] for item in paid], "details": record["details"]} if paid else None


def amount_due(profile: dict[str, Any], coach: str, paid: dict[str, Any] | None) -> int:
    """What is left to pay for a switch to `coach`, in cents, given what is already paid (paid_switch): nothing when
    that payment was for this very coach or covers the price."""
    price = switch_price(profile, coach)
    if paid is None:
        return price
    return 0 if coach in paid["coaches"] else max(price - paid["amount"], 0)


def start_checkout(profile: dict[str, Any], coach: str) -> dict[str, Any]:
    """Opens payment for a switch to `coach`: {"checkout_url"} for Stripe's page, which charges the price less anything
    already paid towards a switch, or {"paid": True} when that already covers it. Raises stripe.error.StripeError."""
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key
    record = find_record(profile["id"], RECORD_KEY)
    earlier, already = _paid_checkouts(profile, record["details"], close_open=True) if record else ([], 0)
    due = amount_due(profile, coach, {"amount": already, "coaches": [item["coach"] for item in earlier]} if earlier else None)
    if not due:
        return {"paid": True}

    price = switch_price(profile, coach)
    if earlier:
        name = f"Coach switch to {coach}: the rest"
        description = f"A switch to {coach} is {money(price)}, and {money(already)} of it is already paid. One-time payment."
    else:
        name = f"Coach switch to {coach}" + (" (your best match)" if price == BEST_MATCH_PRICE else "")
        description = f"{coach} takes over your SwimGPT season plan, chat and voice calls. One-time payment."
    metadata = {"purpose": PURPOSE, "auth_user_id": str(profile["auth_user_id"]), "user_key": profile["user_key"], "coach": coach}
    options: dict[str, Any] = {
        "mode": "payment",
        "managed_payments": {"enabled": False},
        # Cards (and Apple Pay or Google Pay) are confirmed at once, so the switch starts as soon as the athlete is back.
        "payment_method_types": ["card"],
        "line_items": [{
            "price_data": {"currency": CURRENCY, "product_data": {"name": name, "description": description}, "unit_amount": due},
            "quantity": 1,
        }],
        "success_url": f"{settings.frontend_url}/dashboard?coach_switch=paid",
        "cancel_url": f"{settings.frontend_url}/dashboard?coach_switch=cancelled&coach={quote(coach)}",
        "client_reference_id": str(profile["auth_user_id"]),
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata, "description": f"SwimGPT coach switch to {coach}"},
    }
    customer_id = profile.get("stripe_customer_id")
    try:
        # Billed to the athlete's Stripe customer, beside their monthly subscription.
        session = stripe.checkout.Session.create(**options, **({"customer": customer_id} if customer_id else {}))
    except stripe.error.InvalidRequestError as exc:
        if not customer_id or getattr(exc, "param", None) != "customer":
            raise
        session = stripe.checkout.Session.create(**options)  # that customer no longer exists in Stripe
    try:
        _remember(profile, {"session_id": session.id, "coach": coach, **({"earlier": earlier} if earlier else {})})
    except Exception:
        # Never send anyone to a payment that isn't remembered: it couldn't pay for their switch.
        try:
            stripe.checkout.Session.expire(session.id)
        except stripe.error.StripeError:
            logger.warning("Could not close unremembered coach switch checkout %s", session.id, exc_info=True)
        raise
    return {"checkout_url": session.url}


def spend(profile: dict[str, Any], paid: dict[str, Any]) -> bool:
    """Uses up what was paid (paid_switch). False when it was already used: the record no longer holds that checkout."""
    removed = (get_supabase_client().table("user_training_sessions").delete()
               .eq("user_id", profile["id"]).eq("id", record_id(profile["id"], RECORD_KEY))
               .eq("details->>session_id", paid["details"]["session_id"]).execute()).data
    return bool(removed)


def restore(profile: dict[str, Any], paid: dict[str, Any]) -> None:
    """Gives back a payment whose new coach couldn't be saved, so trying again doesn't charge again."""
    _remember(profile, paid["details"])
