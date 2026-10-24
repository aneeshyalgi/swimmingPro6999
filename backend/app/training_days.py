"""The days an athlete trains, chosen on the dashboard: how many swims each day of the week (none, one, or two on a double
day), which days have a strength session, and whether the coach's mobility routine goes on the other days.

They're kept in one training_days record per athlete (deterministic key, no session_date, so it never counts as training),
the way Nutrition keeps its answers: no new table or column. Saving them also sets the profile's swims and strength
sessions a week to what the days add up to, the numbers the rest of the app (nutrition, the coach, the dashboard) works
with. Days that no longer add up to those numbers (changed in onboarding since) aren't used: that part of the week is
spread evenly again, as it is for an athlete who never chose days.

Generating or re-planning a week puts its swims and strength sessions on these days (training.build_week,
training.replan_week, strength_planner.plan_week). Weeks already planned keep their sessions until they're re-planned.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator

from app import training
from app.auth import get_authenticated_profile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/training/days", tags=["Training"], route_class=training.TrainingRoute)

KIND = "training_days"
KEY = "training-days"
DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class TrainingDays(BaseModel):
    # Swims on each day of the week, Monday first: none, one, or two (at most two a day, as every day of a swim week).
    swim: list[int] = Field(min_length=7, max_length=7)
    # The days with a strength session, Monday first.
    gym: list[bool] = Field(min_length=7, max_length=7)
    # The coach's mobility routine on the days without a strength session.
    mobility: bool = True

    @field_validator("swim")
    @classmethod
    def swims(cls, value: list[int]) -> list[int]:
        if any(count not in (0, 1, 2) for count in value):
            raise ValueError("A day has no swim, one swim or two.")
        if not sum(value):
            raise ValueError("Keep at least one swim a week.")
        return value


def weekly(profile: dict[str, Any]) -> tuple[int, int]:
    """The profile's swims and strength sessions a week (0 for a number that can't be read)."""
    def number(field: str, most: int) -> int:
        try:
            value = int(profile.get(field) or 0)
        except (TypeError, ValueError):
            return 0
        return value if 0 <= value <= most else 0
    return number("swim_sessions_per_week", 14), number("gym_sessions_per_week", 7)


def even_swims(count: int) -> list[int]:
    """The swims of each day as generating a week spreads `count` over a free week (training.build_week): one a day,
    evenly spread, and a second only once every day has one."""
    plan = [0] * 7
    remaining = count
    for level in (1, 2):
        candidates = [day for day in range(7) if plan[day] < level]
        take = min(remaining, len(candidates))
        for day in training._spread(candidates, take):
            plan[day] += 1
        remaining -= take
    return plan


def even_strength(count: int) -> list[bool]:
    """The strength days as the gym planner spreads `count` sessions over a free week (strength_planner.plan_week)."""
    count = min(max(count, 0), 7)
    days = {int(index * 7 / count) for index in range(count)}
    return [day in days for day in range(7)]


def chosen(profile: dict[str, Any]) -> dict[str, Any] | None:
    """The athlete's own days as planning uses them, or None when they haven't chosen any: {"swim": swims a day or None,
    "gym": strength days or None, "mobility": bool}. A part that no longer adds up to the profile's number is None."""
    row = training.find_record(profile["id"], KEY)
    if row is None:
        return None
    try:
        days = TrainingDays.model_validate({key: row["details"].get(key) for key in ("swim", "gym", "mobility")})
    except ValidationError:
        logger.warning("A training_days record couldn't be read; the week is spread evenly")
        return None
    swims, strength = weekly(profile)
    return {"swim": days.swim if sum(days.swim) == swims else None,
            "gym": days.gym if sum(days.gym) == strength else None,
            "mobility": days.mobility}


def describe(days: dict[str, Any] | None) -> str:
    """The athlete's days in a line for the coach ("" when they haven't chosen any)."""
    if days is None:
        return ""
    parts = []
    if days["swim"] is not None:
        parts.append("swims on " + ", ".join(f"{name}{' (two)' if count == 2 else ''}" for name, count in zip(DAY_NAMES, days["swim"]) if count))
    if days["gym"] is not None:
        strength = [name for name, on in zip(DAY_NAMES, days["gym"]) if on]
        parts.append(f"strength sessions on {', '.join(strength)}" if strength else "no strength sessions")
    parts.append("the mobility routine on the other days" if days["mobility"] else "no mobility routine on the other days")
    return "The athlete's chosen training days: " + "; ".join(parts) + "."


def coach_line(profile: dict[str, Any]) -> str:
    """The athlete's chosen days for a coach's prompt: "" when they have none, or they can't be read just now (the coach
    then answers without them, as it did before there were any)."""
    try:
        return describe(chosen(profile))
    except Exception:
        logger.warning("The athlete's training days couldn't be read for the coach", exc_info=True)
        return ""


def _payload(profile: dict[str, Any], days: dict[str, Any] | None, saved_at: str | None) -> dict[str, Any]:
    swims, strength = weekly(profile)
    own = {"swim": bool(days and days["swim"] is not None), "gym": bool(days and days["gym"] is not None)}
    return {
        "swim": days["swim"] if own["swim"] else even_swims(swims),
        "gym": days["gym"] if own["gym"] else even_strength(strength),
        "mobility": days["mobility"] if days else True,
        # Whether each part is the athlete's own choice (otherwise it's the even spread of their weekly number).
        "chosen": own,
        "saved_at": saved_at,
    }


@router.get("")
def get_days(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    profile = get_authenticated_profile(authorization)
    row = training.find_record(profile["id"], KEY)
    return _payload(profile, chosen(profile), row["details"].get("saved_at") if row else None)


@router.put("")
def save_days(days: TrainingDays, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Keep the athlete's days and set their swims and strength sessions a week to match. Weeks already planned keep
    their sessions; the days apply to the weeks generated or re-planned from now on."""
    profile = get_authenticated_profile(authorization)
    swims, strength = sum(days.swim), sum(days.gym)
    now = datetime.now(timezone.utc).isoformat()

    def set_numbers(values: dict[str, Any]) -> list[dict[str, Any]]:
        return training.get_supabase_client().table("user_profiles").update(values).eq("id", profile["id"]).execute().data

    before = {"swim_sessions_per_week": profile.get("swim_sessions_per_week"), "gym_sessions_per_week": profile.get("gym_sessions_per_week")}
    # The numbers first: when the days can't be kept after them, the numbers are put back, so the two never disagree.
    if not set_numbers({"swim_sessions_per_week": swims, "gym_sessions_per_week": strength, "updated_at": now}):
        raise HTTPException(status_code=500, detail="Your training days weren't saved. Please try again.")
    try:
        training.save_record(profile["id"], KEY, KIND, "Training days", None, {**days.model_dump(), "saved_at": now})
    except Exception:
        set_numbers(before)
        raise
    profile = {**profile, "swim_sessions_per_week": swims, "gym_sessions_per_week": strength}
    return _payload(profile, {"swim": days.swim, "gym": days.gym, "mobility": days.mobility}, now)
