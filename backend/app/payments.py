"""The monthly coaching subscription that unlocks the dashboard.

A paid Stripe Checkout Session (a recurring monthly subscription) sets user_profiles.is_paid, the one flag dashboard
access checks. The payment success page records it straight away; an athlete who closed that page before it loaded has
their last checkout confirmed with Stripe the next time their access is checked, so a completed payment is never lost.
The subscription itself is re-checked with Stripe at most once a day: once it is cancelled or its renewals stop being
paid, is_paid goes back to false and the athlete is sent to the payment screen.

A subscription outlives the account that bought it (an athlete who deleted their account and signed up again with the
same email, or one whose missed payment was settled after their access closed). Before anyone is sent to checkout, the
live subscription their email already pays for is found and attached to their profile, so nobody pays twice.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import stripe

from app.config import get_settings
from app.db import get_supabase_client

logger = logging.getLogger(__name__)

PAYMENT_PLANS = {
    "performance-build": {
        "name": "Performance Build",
        "description": "Full adaptive coaching for athletes building toward their next breakthrough.",
        "amount": 1400,
        "currency": "usd",
        "interval": "month",
    },
}
# Retired tiers cannot start checkout, but already-paid sessions must still activate.
VERIFIABLE_PAYMENT_PLAN_IDS = {*PAYMENT_PLANS, "swim-foundation", "championship"}
# Subscription states that keep the dashboard open. past_due: a renewal failed and Stripe is still retrying the card.
LIVE_SUBSCRIPTION_STATUSES = {"active", "trialing", "past_due"}
RECHECK_SUBSCRIPTION_AFTER = timedelta(hours=24)
# The plan's name comes from the Stripe product, so the dialog names exactly what Stripe bills.
WITH_PRODUCT = ["items.data.price.product"]


def _ending(subscription: Any) -> bool:
    """Whether a cancellation is scheduled: at the end of the paid month (how SwimGPT cancels) or, from the Stripe
    dashboard, on a chosen date."""
    return bool(subscription.get("cancel_at_period_end") or subscription.get("cancel_at"))


def subscription_summary(profile: dict[str, Any], cancel: bool | None = None) -> dict[str, Any]:
    """The athlete's monthly subscription as Stripe has it right now, optionally scheduling or undoing its cancellation.

    Cancelling never refunds and never ends access early: Stripe stops renewing, the athlete keeps the month they paid
    for, and when it runs out the subscription ends and the daily check in _subscription_live() closes the dashboard.
    In the result, cancel_at_period_end is true for any scheduled cancellation and period_end is when the subscription
    renews, or ends if one is scheduled.
    """
    subscription_id = profile.get("stripe_subscription_id")
    if not subscription_id:
        return {"manageable": False}
    stripe.api_key = get_settings().stripe_secret_key
    subscription = stripe.Subscription.retrieve(subscription_id, expand=WITH_PRODUCT)
    # Only a real change is sent, so a repeated click is harmless.
    if cancel is True and not _ending(subscription):
        subscription = stripe.Subscription.modify(subscription_id, cancel_at_period_end=True, expand=WITH_PRODUCT)
    elif cancel is False and _ending(subscription):
        # A cancellation set for a chosen date in the Stripe dashboard is undone by clearing that date.
        undo = {"cancel_at_period_end": False} if subscription.get("cancel_at_period_end") else {"cancel_at": ""}
        subscription = stripe.Subscription.modify(subscription_id, **undo, expand=WITH_PRODUCT)
    item = subscription["items"]["data"][0]
    price = item["price"]
    product = price.get("product")
    # The billing period lives on the subscription item in current Stripe API versions, on the subscription in older ones.
    period_end = item.get("current_period_end") or subscription.get("current_period_end")
    ends_or_renews = (subscription.get("cancel_at") or period_end) if _ending(subscription) else period_end
    fallback_name = PAYMENT_PLANS.get(profile.get("payment_plan_id") or "", {}).get("name", "Monthly coaching plan")
    return {
        "manageable": subscription.status in LIVE_SUBSCRIPTION_STATUSES,
        "status": subscription.status,
        "cancel_at_period_end": _ending(subscription),
        "period_end": datetime.fromtimestamp(ends_or_renews, timezone.utc).isoformat() if ends_or_renews else None,
        "plan_name": (product.get("name") if isinstance(product, stripe.StripeObject) else None) or fallback_name,
        "amount": price["unit_amount"],
        "currency": price["currency"],
        "interval": (price.get("recurring") or {}).get("interval", "month"),
    }


def billing_account(user: Any) -> tuple[Any, str | None]:
    """The live subscription the account's email already pays for, and its newest Stripe customer (one per athlete).

    Found by email rather than by profile, because a subscription outlives a deleted account; only a confirmed email
    counts, as it decides who gets access. (None, None) when the email isn't confirmed or Stripe has no customer for it.
    Raises stripe.error.StripeError when Stripe can't be asked.
    """
    email = getattr(user, "email", None)
    if not email or not getattr(user, "email_confirmed_at", None):
        return None, None
    stripe.api_key = get_settings().stripe_secret_key
    customers = list(stripe.Customer.list(email=email, limit=100).auto_paging_iter())  # newest first
    live = [
        subscription
        for customer in customers
        for subscription in stripe.Subscription.list(customer=customer.id, limit=100).auto_paging_iter()
        if subscription.status in LIVE_SUBSCRIPTION_STATUSES
    ]
    # One that keeps renewing before one that's ending, then the newest.
    subscription = max(live, key=lambda item: (not _ending(item), item.created), default=None)
    return subscription, customers[0].id if customers else None


def adopt_subscription(row: dict[str, Any], subscription: Any) -> None:
    """Attaches a live subscription found by billing_account() to the athlete's profile, which opens their dashboard."""
    stripe.api_key = get_settings().stripe_secret_key
    try:
        # Labelled with the account that now uses it, so the Stripe dashboard shows whose subscription it is.
        stripe.Subscription.modify(subscription.id, metadata={"auth_user_id": str(row["auth_user_id"]), "user_key": row["user_key"]})
    except stripe.error.StripeError:
        logger.warning("Could not label subscription %s with its account", subscription.id, exc_info=True)
    get_supabase_client().table("user_profiles").update(
        {
            "is_paid": True,
            "payment_status": "paid",
            "payment_plan_id": (subscription.metadata or {}).get("plan_id") or row.get("payment_plan_id"),
            "stripe_customer_id": subscription.customer,
            "stripe_subscription_id": subscription.id,
            "subscription_checked_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", row["id"]).execute()


def record_payment(session: Any) -> bool:
    """Marks the profile named in a Checkout Session's metadata as paid. False, and nothing written, if it isn't paid."""
    metadata = session.metadata or {}
    user_key, auth_user_id, plan_id = metadata.get("user_key"), metadata.get("auth_user_id"), metadata.get("plan_id")
    if session.payment_status != "paid" or not user_key or not auth_user_id or plan_id not in VERIFIABLE_PAYMENT_PLAN_IDS:
        return False
    get_supabase_client().table("user_profiles").update(
        {
            "is_paid": True,
            "payment_status": "paid",
            "payment_plan_id": plan_id,
            "stripe_checkout_session_id": session.id,
            "stripe_customer_id": session.customer,
            "stripe_subscription_id": session.subscription,
            # Unchecked, so the subscription is confirmed live on the next access check (an old, since-cancelled
            # checkout replayed through the success page can't reopen the dashboard for more than that one check).
            "subscription_checked_at": None,
        }
    ).eq("user_key", user_key).eq("auth_user_id", auth_user_id).execute()
    return True


def is_paid(row: dict[str, Any]) -> bool:
    """Whether a user_profiles row's coaching plan is paid for right now."""
    if not row.get("is_paid"):
        session = _unrecorded_checkout(row)
        if session is None or not record_payment(session):
            return False
        row = {**row, "is_paid": True, "stripe_subscription_id": session.subscription, "subscription_checked_at": None}
    return _subscription_live(row)


def _unrecorded_checkout(row: dict[str, Any]) -> Any:
    """The profile's last Checkout Session from Stripe, when it was opened for this very profile."""
    session_id = row.get("stripe_checkout_session_id")
    secret_key = get_settings().stripe_secret_key
    if not session_id or not secret_key:
        return None
    try:
        stripe.api_key = secret_key
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError:
        logger.warning("Could not confirm checkout %s with Stripe", session_id, exc_info=True)
        return None
    metadata = session.metadata or {}
    if metadata.get("user_key") != row.get("user_key") or metadata.get("auth_user_id") != str(row.get("auth_user_id")):
        return None
    return session


def _subscription_live(row: dict[str, Any]) -> bool:
    """Whether a paid profile's monthly subscription is still live, asking Stripe at most once a day."""
    subscription_id = row.get("stripe_subscription_id")
    secret_key = get_settings().stripe_secret_key
    now = datetime.now(timezone.utc)
    checked_at = row.get("subscription_checked_at")
    if not subscription_id or not secret_key or (checked_at and now - datetime.fromisoformat(checked_at) < RECHECK_SUBSCRIPTION_AFTER):
        return True
    try:
        stripe.api_key = secret_key
        subscription = stripe.Subscription.retrieve(subscription_id)
    except stripe.error.StripeError:
        # Never lock a paying athlete out because Stripe couldn't be reached; the next request asks again.
        logger.warning("Could not check subscription %s with Stripe", subscription_id, exc_info=True)
        return True
    live = subscription.status in LIVE_SUBSCRIPTION_STATUSES
    update: dict[str, Any] = {"subscription_checked_at": now.isoformat()}
    if not live:
        # The paid checkout is forgotten too, so it can't re-activate the ended subscription.
        update.update({"is_paid": False, "payment_status": subscription.status, "stripe_checkout_session_id": None})
    get_supabase_client().table("user_profiles").update(update).eq("id", row["id"]).execute()
    return live
