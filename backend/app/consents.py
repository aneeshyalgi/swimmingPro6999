"""What athletes who join from now on agreed to, kept as evidence.

A consent record is saved with each new athlete profile (at onboarding): the Terms and Privacy Policy version they
joined under and, for an athlete under 16, the parent or guardian who agreed to them using SwimGPT (GDPR Art. 8,
§ 107 BGB). Their Mind and Nutrition answers are health data (GDPR Art. 9), so those open only once they agree, and
withdrawing that agreement deletes what they entered there.

Athletes who joined before have no consent record and nothing here applies to them: every check is a no-op without
the record, so their features and data stay exactly as they were.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client

router = APIRouter(prefix="/api/consents", tags=["Consents"])

# The Terms and Privacy Policy version (their date, as on the pages); kept with every consent given under it.
LEGAL_VERSION = "2026-10-18"
PARENTAL_CONSENT_AGE = 16
KEY, KIND = "consents", "consent_record"
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


def record_new_athlete(profile_id: str, guardian: Guardian | None) -> None:
    """Called once, when onboarding creates the profile: the version they joined under and any guardian's consent."""
    now = _now()
    _save(profile_id, {
        "version": LEGAL_VERSION, "accepted_at": now, "health": None,
        "parental": {**guardian.model_dump(), "version": LEGAL_VERSION, "given_at": now} if guardian else None,
    })


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
