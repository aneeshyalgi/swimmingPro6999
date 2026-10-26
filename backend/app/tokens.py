"""Tokens: what each AI feature costs, and every athlete's balance (backend/migrations/2026-10-26_add_tokens.sql).

Tokens are only for accounts made under the Terms that brought them in (26 October 2026, uses_tokens): an older
account keeps every AI feature as part of its subscription, exactly as before, and never sees a token. For the others,
a subscription comes with MONTHLY_TOKENS tokens a month, renewed on the 26th of each month for everyone; what's left of
a month's tokens ends with it, never carried over. Tokens bought in the dashboard's token store (PACKS) come on top,
last BOUGHT_MONTHS months from purchase and aren't refundable. Spending takes the tokens that run out first.

Each AI feature costs COSTS[action] tokens, charged as its AI work starts (charge), never for a request refused before
then: a reply from the coach (typed, or said on a voice call), generating or re-planning a week, a week coach message,
race plans, a video analysis. If the work then fails (an error, running out of time, the athlete leaving before their
week is saved), the tokens go back (give_back). Every charge has its own id, made here and never taken from the
browser (one reused there would get AI work for free), so the database client's retry of a dropped call can't charge
twice.

The balance lives in the database, where one call checks and spends it, so two tabs can't spend the same tokens. Until
the migration has run, or with TOKENS_ENABLED off, every feature is free, exactly as before; and a moment when the token
tables can't be reached never blocks anyone either: that request is simply free.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator
from uuid import uuid4

import stripe
from fastapi import APIRouter, Header, HTTPException, status
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.auth import get_authenticated_profile, get_authenticated_user, latest_profile_row
from app.config import get_settings
from app.db import get_supabase_client
from app.withdrawal import start_now_metadata

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/tokens", tags=["Tokens"])

MONTHLY_TOKENS = 50
BOUGHT_MONTHS = 2
# The accounts that use tokens: those made from TOKENS_FROM, when the Terms that brought them in (TOKENS_TERMS) began.
# In the CHANGEOVER after that, an account that signed up under earlier Terms (its sign-up page was opened before the
# new ones were live) is still an older one; the version it signed up under comes from the browser, so it counts only
# then.
TOKENS_FROM = datetime(2026, 10, 26, tzinfo=timezone.utc)
TOKENS_TERMS = "2026-10-26"
CHANGEOVER = timedelta(days=7)
# What each AI feature costs, and what the athlete's token history calls it.
COSTS = {
    "coach_chat": 1, "voice_reply": 1, "swim_week": 10, "swim_replan": 6, "gym_week": 4, "week_coach": 3,
    "race_plan": 4, "video_analysis": 5, "daily_plan": 3,
}
LABELS = {
    "coach_chat": "Message to your coach",
    "voice_reply": "Coach's reply on a call",
    "swim_week": "Swim week generated",
    "swim_replan": "Swim week re-planned",
    "gym_week": "Gym week planned",
    "week_coach": "Week coach message",
    "race_plan": "Race plans",
    "video_analysis": "Video analysis",
    "daily_plan": "Today's plan",
}
# The token store, in cents of CURRENCY.
PACKS = {
    "starter": {"tokens": 100, "amount": 499},
    "plus": {"tokens": 300, "amount": 1299},
    "pro": {"tokens": 800, "amount": 2999},
}
CURRENCY = "usd"

PURCHASES = "user_token_purchases"
# The functions or tables aren't there (the migration hasn't run): tokens are off, and asked again after a minute.
MISSING = {"PGRST202", "PGRST205", "42P01", "42883"}
RECHECK_SECONDS = 60.0
SETTLE_EVERY_SECONDS = 30.0
NOT_SAVED = "Your purchase couldn't be saved to your account just now, so checkout didn't open. Nothing was charged; please try again."

_missing_until = 0.0
_settled_at: dict[str, float] = {}
_settled_lock = threading.Lock()
# Whether each account (by its Supabase id) uses tokens: it never changes, so it's looked up once.
_accounts: dict[str, bool] = {}


class _Unavailable(Exception):
    """The token tables can't be used just now: the migration hasn't run, or the database couldn't be reached."""


@dataclass(frozen=True)
class Receipt:
    """Tokens spent on a request, to give back if its AI work fails."""

    user_id: str
    ref: str
    action: str
    tokens: int


class OutOfTokens(HTTPException):
    """Not enough tokens for an AI request. Answered with 429: a message for the athlete in `detail`, and `tokens`:
    {"needed", "balance", "renews_at"} (main.py)."""

    def __init__(self, needed: int, balance: int, renews_at: str | None):
        when = _day(renews_at)
        renewal = f", or your monthly tokens renew on {when}" if when else ""
        super().__init__(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                         detail=f"This needs {needed} token{'' if needed == 1 else 's'} and you have {balance} left. "
                                f"Get more in the Token store{renewal}.")
        self.tokens = {"needed": needed, "balance": balance, "renews_at": _iso(renews_at)}


def _parsed(value: str | None) -> datetime | None:
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc) if value else None
    except (TypeError, ValueError):
        return None


def _iso(value: str | None) -> str | None:
    moment = _parsed(value)
    return moment.isoformat() if moment else None


def _day(value: str | None) -> str | None:
    moment = _parsed(value)
    return f"{moment.day} {moment:%B}" if moment else None


def available() -> bool:
    """Whether tokens are on: TOKENS_ENABLED, and the migration has run (as far as the last minute's calls know)."""
    return get_settings().tokens_enabled and time.monotonic() >= _missing_until


def account_uses_tokens(user: Any) -> bool:
    """Whether a Supabase account (get_authenticated_user) uses tokens, from when it was made (by Supabase, so it can't
    be changed from the browser) and, in the CHANGEOVER, the Terms it signed up under."""
    made = getattr(user, "created_at", None)
    made = (made if made.tzinfo else made.replace(tzinfo=timezone.utc)) if isinstance(made, datetime) else _parsed(made)
    if made is None or made < TOKENS_FROM:
        return False
    if made >= TOKENS_FROM + CHANGEOVER:
        return True
    accepted = (getattr(user, "user_metadata", None) or {}).get("accepted_terms")
    return isinstance(accepted, str) and accepted >= TOKENS_TERMS


def uses_tokens(profile: dict[str, Any]) -> bool:
    """Whether the athlete's account uses tokens (account_uses_tokens). While it can't be looked up, it doesn't: that
    request is free."""
    account = str(profile.get("auth_user_id") or "")
    if not account:
        return False
    if account not in _accounts:
        try:
            user = get_supabase_client().auth.admin.get_user_by_id(account).user
        except Exception as exc:
            logger.warning("Tokens: an account couldn't be looked up (%s)", type(exc).__name__, exc_info=True)
            return False
        if len(_accounts) > 20000:
            _accounts.clear()
        _accounts[account] = account_uses_tokens(user)
    return _accounts[account]


def _rpc(name: str, params: dict[str, Any]) -> dict[str, Any]:
    """One of the migration's functions. Raises _Unavailable when it can't be called (logged, without the athlete's data)."""
    global _missing_until
    try:
        result = get_supabase_client().rpc(name, params).execute().data
    except APIError as exc:
        if exc.code in MISSING:
            if time.monotonic() >= _missing_until:
                logger.warning("Tokens are off until backend/migrations/2026-10-26_add_tokens.sql has run (%s)", exc.code)
            _missing_until = time.monotonic() + RECHECK_SECONDS
        else:
            logger.error("Tokens: %s failed (%s: %s)", name, exc.code, exc.message)
        raise _Unavailable from exc
    except Exception as exc:
        logger.warning("Tokens: %s couldn't be called (%s)", name, type(exc).__name__, exc_info=True)
        raise _Unavailable from exc
    if not isinstance(result, dict):
        logger.error("Tokens: %s answered with %s", name, type(result).__name__)
        raise _Unavailable
    return result


def charge(profile: dict[str, Any], action: str) -> Receipt | None:
    """Spends `action`'s tokens for the athlete (`profile`: a paid one) as its AI work starts. Returns a receipt, to
    give_back() if the work then fails, or None when tokens are off or the athlete's account doesn't use them (the
    request is free). Raises OutOfTokens, with nothing spent, when the athlete doesn't have enough."""
    if not available() or not uses_tokens(profile):
        return None
    tokens = COSTS[action]
    ref = f"{action}:{uuid4()}"
    user_id = str(profile["id"])
    try:
        result = _rpc("swimgpt_spend_tokens", {"p_user": user_id, "p_ref": ref, "p_action": action, "p_amount": tokens,
                                               "p_monthly": MONTHLY_TOKENS})
    except _Unavailable:
        return None
    if not result.get("ok"):
        raise OutOfTokens(tokens, int(result.get("balance") or 0), result.get("renews_at"))
    return Receipt(user_id, ref, action, tokens)


def give_back(receipt: Receipt | None) -> None:
    """Gives a failed request's tokens back (once). Never raises: a failure is logged."""
    if receipt is None:
        return
    try:
        _rpc("swimgpt_return_tokens", {"p_user": receipt.user_id, "p_ref": receipt.ref})
    except _Unavailable:
        logger.error("Tokens: a failed %s request's %d tokens couldn't be given back", receipt.action, receipt.tokens)


@contextmanager
def charged(profile: dict[str, Any], action: str) -> Iterator[Receipt | None]:
    """charge() for the AI work in the block, given back if the block fails."""
    receipt = charge(profile, action)
    try:
        yield receipt
    except BaseException:
        give_back(receipt)
        raise


class Meter:
    """A week generation's tokens (app/jobs.py): charged once, as the run reaches its AI work (charge(action), which
    action depends on what the run turns out to be), and given back if the run then fails or is cancelled."""

    def __init__(self, profile: dict[str, Any]):
        self.profile = profile
        self.receipt: Receipt | None = None
        self.started = False

    def charge(self, action: str) -> None:
        if self.started:
            return
        self.started = True
        self.receipt = charge(self.profile, action)

    def give_back(self) -> None:
        receipt, self.receipt = self.receipt, None
        give_back(receipt)


# ---------------------------------------------------------------- the dashboard's token store
def summary(profile: dict[str, Any]) -> dict[str, Any]:
    """The athlete's tokens for the dashboard (this month's are added if they're new). Raises _Unavailable."""
    data = _rpc("swimgpt_tokens", {"p_user": str(profile["id"]), "p_monthly": MONTHLY_TOKENS})
    lots = [lot for lot in data.get("lots") or [] if isinstance(lot, dict)]
    monthly = next((lot for lot in lots if lot.get("kind") == "monthly"), None)
    return {
        "available": True,
        "balance": sum(int(lot.get("remaining") or 0) for lot in lots),
        "monthly": {"tokens": int(monthly["amount"]) if monthly else MONTHLY_TOKENS,
                    "remaining": int(monthly["remaining"]) if monthly else 0, "renews_at": _iso(data.get("period_end"))},
        # Bought (or given) tokens still to spend, the soonest to expire first.
        "bought": [{"tokens": int(lot["amount"]), "remaining": int(lot["remaining"]), "expires_at": _iso(lot["expires_at"]),
                    "gift": lot.get("kind") == "gift"}
                   for lot in lots if lot.get("kind") != "monthly" and int(lot.get("remaining") or 0) > 0],
        "recent": [{"action": item.get("action"), "label": LABELS.get(item.get("action"), "AI feature"), "tokens": int(item.get("amount") or 0),
                    "at": _iso(item.get("at")), "returned": bool(item.get("returned"))}
                   for item in data.get("recent") or [] if isinstance(item, dict)],
        "costs": [{"action": action, "label": LABELS[action], "tokens": tokens} for action, tokens in COSTS.items() if action != "daily_plan"],
        "packs": [{"id": pack_id, "tokens": pack["tokens"], "amount": pack["amount"], "currency": CURRENCY} for pack_id, pack in PACKS.items()],
        "monthly_tokens": MONTHLY_TOKENS,
        "bought_months": BOUGHT_MONTHS,
    }


def _credit(user_id: str, session: Any) -> bool:
    """Adds a paid token checkout's tokens to the athlete (once, however often it's confirmed) and marks the purchase
    paid. False when that couldn't be done just now: it's done the next time the athlete's tokens are read."""
    metadata = session.metadata or {}
    tokens = int(metadata.get("tokens") or PACKS.get(metadata.get("pack", ""), {}).get("tokens") or 0)
    if tokens <= 0:
        logger.error("Token checkout %s names no tokens", session.id)
        return False
    database = get_supabase_client()
    try:
        # The row written as checkout opened; recreated if it's missing, so a paid purchase is always on record.
        database.table(PURCHASES).upsert({
            "user_id": user_id, "stripe_checkout_session_id": session.id, "pack": metadata.get("pack") or "tokens",
            "tokens": tokens, "amount": session.amount_total or 0, "currency": session.currency or CURRENCY, "status": "pending",
        }, on_conflict="stripe_checkout_session_id", ignore_duplicates=True).execute()
        _rpc("swimgpt_credit_tokens", {"p_user": user_id, "p_kind": "bought", "p_ref": f"bought:{session.id}", "p_amount": tokens,
                                       "p_months": BOUGHT_MONTHS})
        database.table(PURCHASES).update({"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(), "amount": session.amount_total or 0}) \
            .eq("stripe_checkout_session_id", session.id).eq("status", "pending").execute()
    except (_Unavailable, APIError):
        logger.exception("Token purchase %s couldn't be credited yet", session.id)
        return False
    return True


def _settle(user_id: str) -> None:
    """The athlete's token checkouts still pending, brought up to date with Stripe: a paid one is credited (its buyer
    never got back to the dashboard), an abandoned one removed. At most every SETTLE_EVERY_SECONDS, and never raises."""
    now = time.monotonic()
    with _settled_lock:
        if now - _settled_at.get(user_id, -SETTLE_EVERY_SECONDS) < SETTLE_EVERY_SECONDS:
            return
        if len(_settled_at) > 5000:
            _settled_at.clear()
        _settled_at[user_id] = now
    try:
        pending = (get_supabase_client().table(PURCHASES).select("stripe_checkout_session_id")
                   .eq("user_id", user_id).eq("status", "pending").execute().data) or []
        if not pending:
            return
        stripe.api_key = get_settings().stripe_secret_key
        for row in pending:
            session = stripe.checkout.Session.retrieve(row["stripe_checkout_session_id"])
            if session.payment_status == "paid":
                _credit(user_id, session)
            elif session.status == "expired":
                get_supabase_client().table(PURCHASES).delete().eq("stripe_checkout_session_id", session.id).eq("status", "pending").execute()
    except Exception:
        logger.warning("Pending token purchases couldn't be settled just now", exc_info=True)


class TokenCheckout(BaseModel):
    pack: str = Field(min_length=1, max_length=40)
    # The buyer ticked the box to have the tokens added straight away, ending their right of withdrawal (app/withdrawal.py).
    start_now: bool = False


@router.get("")
def get_tokens(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """The signed-in athlete's tokens: their balance (this month's and bought ones), what each AI feature costs, the
    packs on sale and their latest spends. {"available": false} while tokens are off, and for an account that doesn't use
    them: every AI feature is then free."""
    profile = get_authenticated_profile(authorization)
    if not available() or not uses_tokens(profile):
        return {"available": False}
    if get_settings().stripe_secret_key:
        _settle(str(profile["id"]))
    try:
        return summary(profile)
    except _Unavailable:
        return {"available": False}


@router.post("/checkout")
def token_checkout(request: TokenCheckout, authorization: str | None = Header(default=None)) -> dict[str, str]:
    """One-off Stripe Checkout for a token pack, billed to the athlete's Stripe customer. The purchase is recorded
    against their profile before they're sent to pay; the tokens are added once Stripe confirms the payment."""
    settings = get_settings()
    profile = get_authenticated_profile(authorization)
    pack = PACKS.get(request.pack)
    if pack is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That token pack isn't on sale.")
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payments aren't configured yet.")
    if not available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The token store isn't open yet.")
    if not uses_tokens(profile):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Your subscription includes the AI features without tokens, so there are none to buy.")
    stripe.api_key = settings.stripe_secret_key
    metadata = {"kind": "tokens", "pack": request.pack, "tokens": str(pack["tokens"]), "user_id": str(profile["id"]),
                "auth_user_id": str(profile["auth_user_id"]), "user_key": profile["user_key"], **start_now_metadata(request.start_now)}
    options: dict[str, Any] = {
        "mode": "payment",
        "managed_payments": {"enabled": False},
        # Cards (and Apple Pay or Google Pay) are confirmed at once, so the tokens are there as soon as the athlete is back.
        "payment_method_types": ["card"],
        "line_items": [{
            "price_data": {
                "currency": CURRENCY, "unit_amount": pack["amount"],
                "product_data": {"name": f"{pack['tokens']} SwimGPT tokens",
                                 "description": f"For your coach's replies, voice calls, week planning and every AI feature in SwimGPT. "
                                                f"They last {BOUGHT_MONTHS} months from purchase and aren't refundable."},
            },
            "quantity": 1,
        }],
        "success_url": f"{settings.frontend_url}/dashboard?tokens=paid&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.frontend_url}/dashboard?tokens=cancelled",
        "client_reference_id": str(profile["auth_user_id"]),
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata, "description": f"SwimGPT tokens ({pack['tokens']})"},
    }
    customer_id = profile.get("stripe_customer_id")
    try:
        try:
            # Billed to the athlete's Stripe customer, beside their subscription.
            session = stripe.checkout.Session.create(**options, **({"customer": customer_id} if customer_id else {}))
        except stripe.error.InvalidRequestError as exc:
            if not customer_id or getattr(exc, "param", None) != "customer":
                raise
            session = stripe.checkout.Session.create(**options)  # that customer no longer exists in Stripe
    except stripe.error.StripeError as exc:
        logger.warning("Token checkout failed", exc_info=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Secure checkout couldn't be opened just now. Nothing was charged; please try again.") from exc
    if not session.url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe did not return a checkout URL.")
    try:
        get_supabase_client().table(PURCHASES).insert({
            "user_id": str(profile["id"]), "stripe_checkout_session_id": session.id, "pack": request.pack, "tokens": pack["tokens"],
            "amount": pack["amount"], "currency": CURRENCY, "status": "pending",
        }).execute()
    except Exception as exc:
        # Never send anyone to pay for tokens their account won't show.
        logger.exception("Could not record token checkout %s", session.id)
        try:
            stripe.checkout.Session.expire(session.id)
        except stripe.error.StripeError:
            logger.warning("Could not close unrecorded token checkout %s", session.id, exc_info=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_SAVED) from exc
    return {"checkout_url": session.url}


@router.get("/verify/{session_id}")
def verify_token_checkout(session_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Confirms a token purchase with Stripe as the athlete is back from paying, and adds its tokens (once). Only for the
    account that bought them."""
    user = get_authenticated_user(authorization)
    row = latest_profile_row(user.id)
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payments aren't configured yet.")
    try:
        stripe.api_key = settings.stripe_secret_key
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.InvalidRequestError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That token purchase wasn't found.") from exc
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="Your purchase couldn't be checked with Stripe just now. Your tokens are added as soon as it can be.") from exc
    metadata = session.metadata or {}
    if row is None or metadata.get("kind") != "tokens" or metadata.get("user_id") != str(row["id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That token purchase wasn't found.")
    paid = session.payment_status == "paid"
    added = _credit(str(row["id"]), session) if paid else False
    return {"paid": paid, "added": added, "tokens": int(metadata.get("tokens") or 0)}
