"""Platform survey: from the dashboard, athletes rate SwimGPT from 1 to 5, then say how they use it, which features they
use and how good each one is, what they like, what to improve, what to build next and how likely they are to
recommend it.

Each athlete answers once per survey round (SURVEY_VERSION): their answers are one row of the user_platform_surveys
table (migrations/2026-10-18_add_platform_surveys.sql), and sending them again (a retry, a second tab) updates that row
instead of adding another. A new round (a new SURVEY_VERSION) asks every athlete again and keeps the earlier rounds.

The survey stands apart from everything else: nothing else reads or writes its table, and until the table exists the
survey reports itself unavailable, so the dashboard doesn't offer it.

Its last question also asks whether we may email the athlete now and then to ask for their feedback, such as when
there's a new survey (consent, GDPR Art. 6(1)(a) and § 7(2) UWG), kept with their answers along with when they last
chose (migrations/2026-10-19_add_survey_email_permission.sql). Once they've answered they can change it at /survey.
Until those columns exist the survey works as before and doesn't ask.
"""
from __future__ import annotations

import logging
import unicodedata
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, get_args

from fastapi import APIRouter, Header, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/survey", tags=["Survey"])

TABLE = "user_platform_surveys"
SURVEY_VERSION = "2026-10"
# How PostgREST answers while the table doesn't exist: PGRST205 from its schema cache, 42P01 from Postgres itself.
MISSING_TABLE = {"PGRST205", "42P01"}
# And while the table doesn't have the email permission's columns yet: PGRST204 writing one, 42703 reading one.
MISSING_COLUMN = {"PGRST204", "42703"}
READ = "rating, updated_at"
EMAILS = "survey_emails_ok"
NOT_LOADED = "The survey couldn't be loaded just now."
NOT_SAVED = "Your answers couldn't be saved just now. Please try again."
NOT_OPEN = "The survey isn't open just now, so your answers weren't saved. Please try again later."
NOT_CHANGED = "Your choice couldn't be saved just now. Please try again."
NOT_ANSWERED = "Send your answers to this survey first."
NOTE_LENGTH = 1000
COMMENT_LENGTH = 2000
MOST_PICKS = 3  # likes and wishes: up to three each

Feature = Literal["swim_week", "gym_week", "workout_builder", "competitions", "coach_chat", "voice_calls", "nutrition",
                  "mental", "video_analysis", "pace_calculator", "training_plans"]
Like = Literal["personalised", "coach", "workouts", "variety", "ease", "design", "progress", "all_in_one", "value"]
Improvement = Literal["workout_fit", "coach_answers", "ease", "speed", "bugs", "phone", "features", "price", "nothing"]
Wish = Literal["watch_sync", "progress_charts", "drill_videos", "teams", "offline", "reminders", "calendar_sync",
               "community", "languages"]
Stars = Annotated[int, Field(strict=True, ge=1, le=5)]
NOTES = ("liked_note", "improve_note", "wishlist_note", "comments")


def _clean(text: str) -> str | None:
    """Free text as it's stored: line breaks kept, other control characters dropped (Postgres can't store some), and
    nothing left as None."""
    kept = "".join(character for character in text.replace("\r\n", "\n")
                   if character in "\n\t" or unicodedata.category(character) not in ("Cc", "Cs"))
    return kept.strip() or None


class SurveyAnswers(BaseModel):
    """One athlete's answers to this round of the survey."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rating: Stars
    usage_frequency: Literal["daily", "few_weekly", "weekly", "rarely"]
    training_impact: Literal["much_better", "better", "same", "worse"]
    features_used: list[Feature] = Field(min_length=1, max_length=len(get_args(Feature)))
    # Each feature they use, rated 1-5.
    feature_ratings: dict[Feature, Stars]
    liked: list[Like] = Field(min_length=1, max_length=MOST_PICKS)
    liked_note: str = Field(default="", max_length=NOTE_LENGTH)
    improve: list[Improvement] = Field(min_length=1, max_length=len(get_args(Improvement)))
    improve_note: str = Field(default="", max_length=NOTE_LENGTH)
    wishlist: list[Wish] = Field(default_factory=list, max_length=MOST_PICKS)
    wishlist_note: str = Field(default="", max_length=NOTE_LENGTH)
    recommend: int = Field(strict=True, ge=0, le=10)
    comments: str = Field(default="", max_length=COMMENT_LENGTH)
    # They agreed to be emailed about these answers.
    contact_ok: bool = Field(default=False, strict=True)
    # They agreed to be emailed now and then to ask for their feedback, such as when there's a new survey. Left out by
    # pages from before it was asked (and while the table can't keep it), which leaves what's stored as it was.
    survey_emails_ok: bool = Field(default=False, strict=True)

    @field_validator("features_used", "liked", "improve", "wishlist")
    @classmethod
    def distinct(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))

    @model_validator(mode="after")
    def consistent(self) -> SurveyAnswers:
        if set(self.feature_ratings) != set(self.features_used):
            raise ValueError("Rate each feature you use, and only those.")
        if "nothing" in self.improve and len(self.improve) > 1:
            raise ValueError("Choose things to improve, or that nothing needs improving, not both.")
        return self

    def record(self) -> dict[str, Any]:
        """The answers as the table's columns, with free text cleaned and blank text left empty (null), and the email
        permission only when it was answered."""
        values = self.model_dump()
        for field in NOTES:
            values[field] = _clean(values[field])
        if EMAILS not in self.model_fields_set:
            del values[EMAILS]
        return values


class SurveyEmails(BaseModel):
    """After answering: whether we may email the athlete now and then to ask for their feedback."""

    model_config = ConfigDict(extra="forbid")

    survey_emails_ok: bool = Field(strict=True)


def _state(row: dict[str, Any] | None, available: bool = True, asks: bool = True) -> dict[str, Any]:
    """What the dashboard and /survey need: whether the survey is open, the athlete's response to this round if they sent
    one, and whether they let us email them (false until they say so; None while the table can't keep it, `asks` false,
    so the survey doesn't ask)."""
    return {
        "version": SURVEY_VERSION,
        "available": available,
        "response": {"rating": row["rating"], "submitted_at": row["updated_at"]} if row else None,
        "survey_emails": bool(row and row.get(EMAILS)) if available and asks else None,
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read(profile_id: str, columns: str) -> list[dict[str, Any]]:
    return (get_supabase_client().table(TABLE).select(columns)
            .eq("user_id", profile_id).eq("survey_version", SURVEY_VERSION).limit(1).execute().data)


def _upsert(row: dict[str, Any]) -> list[dict[str, Any]]:
    return get_supabase_client().table(TABLE).upsert(row, on_conflict="user_id,survey_version").execute().data


def _failed(action: str, exc: APIError) -> None:
    # Only the error's code and message: its details can repeat the row, and so the athlete's own words.
    logger.warning("Could not %s a survey response (%s: %s)", action, exc.code, exc.message)


@router.get("")
def get_survey(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Whether the survey is open, whether the signed-in athlete has answered this round, and whether we may email them."""
    profile = get_authenticated_profile(authorization)
    asks = True
    try:
        try:
            rows = _read(profile["id"], f"{READ}, {EMAILS}")
        except APIError as exc:
            if exc.code not in MISSING_COLUMN:
                raise
            # The email permission's columns aren't there yet: the survey works as before, without asking.
            asks = False
            rows = _read(profile["id"], READ)
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            return _state(None, available=False)
        _failed("read", exc)
        raise HTTPException(status_code=502, detail=NOT_LOADED) from exc
    return _state(rows[0] if rows else None, asks=asks)


@router.post("")
def submit_survey(answers: SurveyAnswers, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Saves the athlete's answers to this round: their one response, which sending again replaces."""
    profile = get_authenticated_profile(authorization)
    now = _now()
    row = {"user_id": profile["id"], "survey_version": SURVEY_VERSION, **answers.record(), "updated_at": now}
    if EMAILS in row:
        row["survey_emails_at"] = now  # when they last chose, kept as proof of what they agreed to
    try:
        try:
            saved = _upsert(row)
        except APIError as exc:
            if exc.code not in MISSING_COLUMN or EMAILS not in row:
                raise
            # The table can't keep the permission yet: the answers still save, without it (so no emails).
            _failed("save the email permission of", exc)
            saved = _upsert({key: value for key, value in row.items() if key not in (EMAILS, "survey_emails_at")})
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            raise HTTPException(status_code=503, detail=NOT_OPEN) from exc
        _failed("save", exc)
        raise HTTPException(status_code=502, detail=NOT_SAVED) from exc
    if not saved:
        raise HTTPException(status_code=502, detail=NOT_SAVED)
    # The saved row has every column the table has: without the permission's, the survey isn't asking yet.
    return _state(saved[0], asks=EMAILS in saved[0])


@router.put("/emails")
def set_survey_emails(choice: SurveyEmails, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Gives or withdraws the athlete's permission to email them, once they've answered this round: as easy to withdraw
    as to give (GDPR Art. 7(3)). Their answers, and when they sent them, stay as they were."""
    profile = get_authenticated_profile(authorization)
    change = {EMAILS: choice.survey_emails_ok, "survey_emails_at": _now()}
    try:
        saved = (get_supabase_client().table(TABLE).update(change)
                 .eq("user_id", profile["id"]).eq("survey_version", SURVEY_VERSION).execute().data)
    except APIError as exc:
        if exc.code in MISSING_TABLE | MISSING_COLUMN:
            raise HTTPException(status_code=503, detail=NOT_CHANGED) from exc
        _failed("change", exc)
        raise HTTPException(status_code=502, detail=NOT_CHANGED) from exc
    if not saved:
        raise HTTPException(status_code=404, detail=NOT_ANSWERED)
    return _state(saved[0])
