"""What athletes who join from now on agreed to, kept as evidence.

A consent record is saved with each new athlete profile (at onboarding): the Terms and Privacy Policy version they
accepted when they signed up and, for an athlete under 16, the parent or guardian who agreed to them using SwimGPT
(GDPR Art. 8, § 107 BGB). Their Mind and Nutrition answers are health data (GDPR Art. 9), so those open only once they
agree, and withdrawing that agreement deletes what they entered there.

Athletes who joined before have no consent record and nothing here applies to them: every check is a no-op without
the record, so their features and data stay exactly as they were.

An account made before tokens (26 October 2026, tokens.py) is asked once, in the dashboard, to agree to the Terms that
brought them in (GET and POST /api/consents/terms, kept in a record of its own, TERMS_KEY). Agreeing starts its tokens.
Not agreeing ends its subscription at the end of the billing period, nothing refunded and nothing changed until then;
agreeing before that keeps it. Subscribing again asks for the same agreement at checkout (main.py).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Any

import stripe
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/consents", tags=["Consents"])

# The Terms and Privacy Policy version (their date, as on the pages); kept with every consent given under it.
LEGAL_VERSION = "2026-10-26"
PARENTAL_CONSENT_AGE = 16
KEY, KIND = "consents", "consent_record"
TERMS_KEY, TERMS_KIND = "terms", "terms_consent"
VERSION = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TERMS_CHANGED = "The Terms have changed since you opened them. Reload the page to read the latest version."
ANSWER_NOT_SAVED = "Your answer couldn't be saved just now. Nothing has changed; please try again."
# The Mind and Nutrition records (mental.KEY, nutrition.KEY) and daily check-ins: what health consent covers.
HEALTH_RECORDS = ("mental", "nutrition")
FEEDBACK_KIND = "athlete_feedback"
HEALTH_CONSENT_NEEDED = "Agree to how SwimGPT uses your health information to use this."
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


class Guardian(BaseModel):
    """The parent or guardian who agreed for an athlete under 16."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=254)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        if not EMAIL.match(value):
            raise ValueError("Enter the parent or guardian's email address.")
        return value.lower()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def consent_record(profile_id: str) -> dict[str, Any] | None:
    """The athlete's consents, or None for an athlete who joined before they were recorded."""
    from app.training import find_record  # training imports today, which imports this module
    row = find_record(profile_id, KEY)
    return row["details"] if row else None


def _save(profile_id: str, details: dict[str, Any]) -> None:
    from app.training import save_record
    save_record(profile_id, KEY, KIND, "Consents", None, details)


def record_new_athlete(profile_id: str, guardian: Guardian | None, accepted: str | None = LEGAL_VERSION) -> None:
    """Called once, when onboarding creates the profile: the Terms version the athlete accepted when they signed up
    (`accepted`, from their sign-up; None if it isn't one) and any guardian's consent."""
    now = _now()
    version = accepted if accepted and VERSION.match(accepted) else None
    _save(profile_id, {
        "version": version, "accepted_at": now if version else None, "health": None,
        "parental": {**guardian.model_dump(), "version": LEGAL_VERSION, "given_at": now} if guardian else None,
    })


def terms_record(profile_id: str) -> dict[str, Any] | None:
    """An older account's answer to the Terms with tokens: agreed ({version, accepted_at, via}) or not ({declined_at,
    ends_at, cancelled}). None until it answers."""
    from app.training import find_record
    row = find_record(profile_id, TERMS_KEY)
    return row["details"] if row else None


def _save_terms(profile_id: str, details: dict[str, Any]) -> None:
    from app.training import save_record
    save_record(profile_id, TERMS_KEY, TERMS_KIND, "Terms answer", None, details)


def agreed_to_tokens(record: dict[str, Any] | None) -> bool:
    """Whether a terms_record() agrees to the Terms with tokens (that version or a later one)."""
    from app.tokens import TOKENS_TERMS
    version = (record or {}).get("version")
    return isinstance(version, str) and bool(VERSION.match(version)) and version >= TOKENS_TERMS


def agree_to_terms(profile_id: str, record: dict[str, Any] | None, via: str) -> dict[str, Any]:
    """Keeps the athlete's agreement to the current Terms (`via`: where they gave it), with any "don't agree" before it,
    and starts their tokens. Agreeing again changes nothing."""
    from app import tokens
    if not agreed_to_tokens(record):
        earlier = {"declined_at": record["declined_at"]} if record and record.get("declined_at") else {}
        record = {"version": LEGAL_VERSION, "accepted_at": _now(), "via": via, **earlier}
        _save_terms(profile_id, record)
    tokens.note_agreement(profile_id)
    return record


def has_health_consent(record: dict[str, Any] | None) -> bool:
    """Whether health data may be used: always for an athlete without a record (joined before), else once they agreed."""
    return record is None or bool((record.get("health") or {}).get("given_at"))


def ensure_health_consent(profile_id: str) -> None:
    """Stops Mind and Nutrition for an athlete who joined under these terms and hasn't agreed (403)."""
    if not has_health_consent(consent_record(profile_id)):
        raise HTTPException(status_code=403, detail=HEALTH_CONSENT_NEEDED)


def _state(record: dict[str, Any] | None) -> dict[str, Any]:
    health = (record or {}).get("health") or None
    return {
        # False for athletes who joined before: the app shows them nothing new.
        "health_required": not has_health_consent(record),
        "health": health if health and health.get("given_at") else None,
        "parental": bool((record or {}).get("parental")),
        "version": LEGAL_VERSION,
    }


@router.get("")
def get_consents(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    profile = get_authenticated_profile(authorization)
    return _state(consent_record(profile["id"]))


class TermsAnswer(BaseModel):
    # The version the athlete was shown: an answer about an older one (a page opened before the Terms changed) is refused.
    version: str = Field(min_length=10, max_length=10)
    agree: bool


def _terms_state(profile: dict[str, Any], record: dict[str, Any] | None) -> dict[str, Any]:
    """What the dashboard shows: the question (`required`: an account made before tokens that hasn't answered), or, after
    a "don't agree", when the subscription ends."""
    from app import tokens
    older = tokens.available() and not tokens.account_is_new(profile)
    open_question = older and not agreed_to_tokens(record)
    declined = open_question and bool((record or {}).get("declined_at"))
    return {
        "required": open_question and not declined,
        "declined": declined,
        "ends_at": (record or {}).get("ends_at") if declined else None,
        "version": LEGAL_VERSION,
    }


@router.get("/terms")
def get_terms(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    profile = get_authenticated_profile(authorization)
    return _terms_state(profile, terms_record(profile["id"]))


@router.post("/terms")
def answer_terms(answer: TermsAnswer, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """An account made before tokens answers the Terms that brought them in. Agreeing starts its tokens, and undoes the
    end a "don't agree" set. Not agreeing has Stripe end the subscription at the end of its billing period (as cancelling
    does: nothing refunded, nothing changed until then). Answering the same way again changes nothing."""
    from app.payments import subscription_summary
    profile = get_authenticated_profile(authorization)
    if answer.version != LEGAL_VERSION:
        raise HTTPException(status_code=409, detail=TERMS_CHANGED)
    record = terms_record(profile["id"])
    try:
        if answer.agree:
            if not agreed_to_tokens(record) and (record or {}).get("cancelled"):
                subscription_summary(profile, cancel=False)
            record = agree_to_terms(profile["id"], record, "dashboard")
        elif not agreed_to_tokens(record) and not (record or {}).get("declined_at"):
            before = subscription_summary(profile)
            # A subscription already ending (cancelled before) is left as it is, and isn't renewed by agreeing later.
            cancel = bool(before.get("manageable")) and not before.get("cancel_at_period_end")
            after = subscription_summary(profile, cancel=True) if cancel else before
            record = {"declined_at": _now(), "ends_at": after.get("period_end"), "cancelled": cancel}
            _save_terms(profile["id"], record)
    except stripe.error.StripeError as exc:
        logger.warning("An answer to the Terms couldn't be carried out with Stripe", exc_info=True)
        raise HTTPException(status_code=502, detail=ANSWER_NOT_SAVED) from exc
    return _terms_state(profile, record)


@router.post("/health")
def give_health_consent(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    profile = get_authenticated_profile(authorization)
    record = consent_record(profile["id"])
    if record is None:
        return _state(None)  # joined before consents were recorded: nothing to agree to
    # For an athlete under 16 the parent or guardian agreed to the health features at onboarding; the athlete confirms.
    record = {**record, "health": {"version": LEGAL_VERSION, "given_at": _now(), "by": "guardian" if record.get("parental") else "athlete"}}
    _save(profile["id"], record)
    return _state(record)


@router.delete("/health")
def withdraw_health_consent(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Withdrawal (GDPR Art. 7(3)): health data is no longer used, and what was entered under the consent is deleted."""
    from app.training import record_id
    profile = get_authenticated_profile(authorization)
    record = consent_record(profile["id"])
    if record is None or not has_health_consent(record):
        return _state(record)
    supabase = get_supabase_client()
    supabase.table("user_training_sessions").delete().eq("user_id", profile["id"]).in_(
        "id", [record_id(profile["id"], key) for key in HEALTH_RECORDS]).execute()
    supabase.table("user_training_sessions").delete().eq("user_id", profile["id"]).eq("session_type", FEEDBACK_KIND).execute()
    record = {**record, "health": {**(record.get("health") or {}), "given_at": None, "withdrawn_at": _now()}}
    _save(profile["id"], record)
    return _state(record)
