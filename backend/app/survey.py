"""Platform survey: from the dashboard, athletes rate SwimGPT from 1 to 5, then say how they use it, which features they
use and how good each one is, what they like, what to improve, what to build next and how likely they are to
recommend it.

Each athlete answers once per survey round (SURVEY_VERSION): their answers are one row of the user_platform_surveys
table (migrations/2026-10-18_add_platform_surveys.sql), and sending them again (a retry, a second tab) updates that row
instead of adding another. A new round (a new SURVEY_VERSION) asks every athlete again and keeps the earlier rounds.

The survey stands apart from everything else: nothing else reads or writes its table, and until the table exists the
survey reports itself unavailable, so the dashboard doesn't offer it.
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
NOT_LOADED = "The survey couldn't be loaded just now."
NOT_SAVED = "Your answers couldn't be saved just now. Please try again."
NOT_OPEN = "The survey isn't open just now, so your answers weren't saved. Please try again later."
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
        """The answers as the table's columns, with free text cleaned and blank text left empty (null)."""
        values = self.model_dump()
        for field in NOTES:
            values[field] = _clean(values[field])
        return values


def _state(row: dict[str, Any] | None, available: bool = True) -> dict[str, Any]:
    """What the dashboard needs: whether the survey is open, and the athlete's response to this round if they sent one."""
    return {
        "version": SURVEY_VERSION,
        "available": available,
        "response": {"rating": row["rating"], "submitted_at": row["updated_at"]} if row else None,
    }


def _failed(action: str, exc: APIError) -> None:
    # Only the error's code and message: its details can repeat the row, and so the athlete's own words.
    logger.warning("Could not %s a survey response (%s: %s)", action, exc.code, exc.message)


@router.get("")
def get_survey(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Whether the survey is open and whether the signed-in athlete has answered this round."""
    profile = get_authenticated_profile(authorization)
    try:
        rows = (get_supabase_client().table(TABLE).select("rating, updated_at")
                .eq("user_id", profile["id"]).eq("survey_version", SURVEY_VERSION).limit(1).execute().data)
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            return _state(None, available=False)
        _failed("read", exc)
        raise HTTPException(status_code=502, detail=NOT_LOADED) from exc
    return _state(rows[0] if rows else None)


@router.post("")
def submit_survey(answers: SurveyAnswers, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Saves the athlete's answers to this round: their one response, which sending again replaces."""
    profile = get_authenticated_profile(authorization)
    row = {"user_id": profile["id"], "survey_version": SURVEY_VERSION, **answers.record(),
           "updated_at": datetime.now(timezone.utc).isoformat()}
    try:
        saved = get_supabase_client().table(TABLE).upsert(row, on_conflict="user_id,survey_version").execute().data
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            raise HTTPException(status_code=503, detail=NOT_OPEN) from exc
        _failed("save", exc)
        raise HTTPException(status_code=502, detail=NOT_SAVED) from exc
    if not saved:
        raise HTTPException(status_code=502, detail=NOT_SAVED)
    return _state(saved[0])
