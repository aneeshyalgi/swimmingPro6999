from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from math import isfinite
from typing import Any

from pydantic import BaseModel, Field


class DashboardMetric(BaseModel):
    label: str
    value: str
    detail: str


class TrainingItem(BaseModel):
    category: str
    name: str
    time: str
    duration: str
    objective: str
    status: str
    basis: str


class ZoneVolume(BaseModel):
    zone: str
    meters: float = Field(ge=0)
    percentage: float = Field(ge=0, le=100)


class PersonalBest(BaseModel):
    event: str
    course: str
    time: str
    target: str | None = None


class PerformanceInsight(BaseModel):
    title: str
    body: str
    basis: str


class DashboardOverview(BaseModel):
    date: str
    timezone: str
    today: list[TrainingItem]
    training_status: list[DashboardMetric]
    weekly: list[DashboardMetric]
    zones: list[ZoneVolume]
    personal_bests: list[PersonalBest]
    performance: list[DashboardMetric]
    insight: PerformanceInsight


def _session_date(session: dict[str, Any]) -> datetime | None:
    value = session.get("session_date")
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _category(session: dict[str, Any]) -> str:
    kind = str(session.get("session_type", "")).lower()
    return {"gym": "strength", "swimming": "swim"}.get(kind, kind)


def _completed(session: dict[str, Any]) -> bool:
    return (session.get("details") or {}).get("completion_status") == "completed"


def _recorded_volume(sessions: list[dict[str, Any]], field: str) -> float | None:
    values = [(session.get("details") or {}).get(field) for session in sessions]
    if not values or any(value is None for value in values):
        return None
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0 for value in values):
        raise ValueError(f"Training records contain invalid {field}.")
    return sum(values)


def _consistency(label: str, ticks: list[tuple[bool, str]], today: date, what: str) -> DashboardMetric:
    """Completed / planned items this week, with how many were due by today."""
    if not ticks:
        return DashboardMetric(label=label, value="Not planned", detail=f"No {what} planned this week")
    done = sum(completed for completed, _ in ticks)
    due = sum(day <= today.isoformat() for _, day in ticks)
    return DashboardMetric(label=label, value=f"{done} / {len(ticks)}", detail=f"{done} of {due} due so far · {what} this week")


def build_dashboard_overview(
    profile: dict[str, Any],
    plan: dict[str, Any],
    sessions: list[dict[str, Any]],
    today: date | None = None,
    training_week: dict[str, Any] | None = None,
    competition: dict[str, Any] | None = None,
    workout_week: dict[str, Any] | None = None,
    race_meets: list[dict[str, Any]] | None = None,
) -> DashboardOverview:
    current_date = today or datetime.now(timezone.utc).date()
    week_start = current_date - timedelta(days=current_date.weekday())
    week_end = week_start + timedelta(days=7)
    week_sessions = [
        session for session in sessions
        if (scheduled := _session_date(session)) and week_start <= scheduled.date() < week_end
    ]
    # Today's training: only the day's swims (Training Week) and its Workout Library workouts.
    training_day = next((day for day in training_week["days"] if day["date"] == current_date.isoformat()), None) if training_week else None
    items = []
    for workout in (training_day or {}).get("workouts", []):
        items.append(TrainingItem(
            category="swim", name=workout["workout"]["title"], time="Any time today",
            duration=f"{workout['workout']['estimated_duration_minutes']} min" + (f" · {workout['distance_meters']:,} m" if workout.get("distance_meters") else ""),
            objective=workout["workout"]["objective"],
            status="Completed" if workout["completed"] else "Planned",
            basis="Swim Week",
        ))
    for gym in (training_day or {}).get("gym", []):
        workout = gym["workout"]
        meta = workout.get("meta") or {}
        window = " – ".join(part for part in [meta.get("start_time"), meta.get("end_time")] if part)
        items.append(TrainingItem(
            category="workout", name=workout["title"], time=window or "Any time today",
            duration=f"{workout['estimated_duration_minutes']} min", objective=workout.get("objective") or workout["title"],
            status="Completed" if gym["completed"] else "Planned",
            basis="Gym Week",
        ))

    completed = [session for session in week_sessions if _completed(session)]
    swims = [session for session in completed if _category(session) == "swim"]
    strength = [session for session in completed if _category(session) == "strength"]
    swim_volume = _recorded_volume(swims, "distance_meters")
    race_volume = _recorded_volume(swims, "race_pace_meters")
    zone_totals: dict[str, float] = {}
    for session in swims:
        recorded = (session.get("details") or {}).get("zone_volumes_meters")
        if not recorded:
            zone_totals = {}
            break
        for zone, meters in recorded.items():
            if isinstance(meters, bool) or not isinstance(meters, (int, float)) or not isfinite(meters) or meters < 0:
                raise ValueError("Training records contain invalid zone volumes.")
            zone_totals[zone] = zone_totals.get(zone, 0) + meters
    zone_total = sum(zone_totals.values())
    zones = [
        ZoneVolume(zone=zone, meters=meters, percentage=round(meters / zone_total * 100, 1))
        for zone, meters in zone_totals.items()
    ] if zone_total else []
    recovery_days = {
        _session_date(session).date() for session in completed if _category(session) == "recovery"
    }
    weekly = [
        DashboardMetric(label="Swim sessions completed", value=str(len(swims)), detail=f"{profile.get('swim_sessions_per_week', 0)} sessions/week planned in onboarding"),
        DashboardMetric(label="Swim volume", value=f"{swim_volume:,.0f} m" if swim_volume is not None else "Not recorded", detail="Recorded distance from completed swim sessions only"),
        DashboardMetric(label="Strength sessions completed", value=str(len(strength)), detail=f"{profile.get('gym_sessions_per_week', 0)} sessions/week planned in onboarding"),
        DashboardMetric(label="Race-pace volume", value=f"{race_volume:,.0f} m" if race_volume is not None else "Not recorded", detail="Recorded race-pace distance from completed swims only"),
        DashboardMetric(label="Recovery days", value=str(len(recovery_days)), detail="Days with completed recovery work; not inferred rest days"),
    ]
    cycles = plan.get("swim", {}).get("cycles", [])
    training_status = [
        DashboardMetric(label="Current training phase", value=(training_week or {}).get("phase") or plan.get("phase") or "Not recorded", detail="Recommended phase from your saved coaching plan"),
        DashboardMetric(label="Current training block", value=cycles[0].get("name", "Not recorded") if cycles else "Not recorded", detail=plan.get("phase_duration") or "Duration not recorded"),
        DashboardMetric(label="Week number", value="Not recorded", detail="A block start date has not been recorded"),
        DashboardMetric(label="Next major competition", value=competition["name"] if competition else "Not scheduled", detail=f"{competition['date']} · {competition['location']} · Priority {competition['priority']}" if competition else "Add a confirmed date in Training → Competitions"),
        DashboardMetric(label="Days until competition", value=str((date.fromisoformat(competition["date"]) - current_date).days) if competition else "Not scheduled", detail="Confirmed competition date (UTC)" if competition else "Requires a confirmed competition date"),
    ]
    personal_bests = [
        PersonalBest(event=event, course=course, time=time, target=(profile.get("one_year_goal_times") or {}).get(event) if course == "LCM" else None)
        for field, course in [("pbs_lcm", "LCM"), ("pbs_scm", "SCM")]
        for event, time in (profile.get(field) or {}).items() if time
    ]
    planned_count = len([
        session for session in week_sessions
        if _category(session) in {"swim", "strength"}
        and (session.get("details") or {}).get("completion_status") != "cancelled"
    ])
    completed_count = len(swims) + len(strength)
    if training_week:
        scheduled_keys = {item["key"] for day in training_week["days"] for item in day["workouts"]}
        legacy_count = sum(_category(session) == "swim" and not (session.get("details") or {}).get("workout_key") for session in week_sessions)
        recorded_strength_count = sum(_category(session) == "strength" for session in week_sessions)
        planned_count = len(scheduled_keys) + legacy_count + max(training_week["summary"]["strength_sessions"], recorded_strength_count)
    training_consistency = DashboardMetric(
        label="Swim week consistency", value=f"{completed_count} / {planned_count}" if planned_count else "Not recorded",
        detail="Completed / scheduled swim and strength sessions this week (UTC)",
    )
    if training_week:
        # Swims, strength and mobility in the Training Week, as ticked off by the athlete.
        ticks = [(item["completed"], day["date"]) for day in training_week["days"] for item in day["workouts"]]
        ticks += [(day["strength_completed"], day["date"]) for day in training_week["days"] if day["strength"]]
        ticks += [(day.get("mobility_completed", False), day["date"]) for day in training_week["days"] if day["mobility"]]
        training_consistency = _consistency("Swim week consistency", ticks, current_date, "swims, strength and mobility")
    workout_consistency = _consistency(
        "Gym week consistency",
        [(item["completed"], day["date"]) for day in (workout_week or {}).get("days", []) for item in day["workouts"]],
        current_date, "workouts",
    )
    recorded_races = [
        (meet, result) for meet in race_meets or [] if meet["date"] <= current_date.isoformat()
        for result in meet["results"]
    ]
    latest_race = max(recorded_races, key=lambda pair: pair[0]["date"]) if recorded_races else None
    dated_pbs = [(meet, result) for meet, result in recorded_races if result["analysis"]["pb_status"] == "New PB"]
    latest_pb = max(dated_pbs, key=lambda pair: pair[0]["date"]) if dated_pbs else None
    performance = [
        DashboardMetric(label="Latest PB", value=f"{latest_pb[1]['result']['event']} · {latest_pb[1]['result']['final_time']}" if latest_pb else "Date not recorded" if personal_bests else "Not recorded", detail=f"{latest_pb[0]['name']} · {latest_pb[0]['date']} · Compared with recorded same-course references" if latest_pb else "Onboarding PBs are shown below; their dates and chronology are unknown"),
        DashboardMetric(label="Recent race result", value=f"{latest_race[1]['result']['event']} · {latest_race[1]['result']['final_time']}" if latest_race else "Not recorded", detail=f"{latest_race[0]['name']} · {latest_race[0]['date']} · {latest_race[0]['pool_length']}m pool" if latest_race else "No actual competition result saved"),
        DashboardMetric(label="Performance trend", value="Not recorded", detail="Requires comparable results across multiple dates"),
        training_consistency,
        workout_consistency,
        DashboardMetric(label="Key training progression", value="Not recorded", detail="Requires a historical training log; goals are not measured improvement"),
    ]
    insight_body = (training_week or {}).get("coaching_note") or (plan.get("goals_summary") or {}).get("performance") or plan.get("focus")
    return DashboardOverview(
        date=current_date.isoformat(), timezone="UTC", today=items, training_status=training_status,
        weekly=weekly, zones=zones, personal_bests=personal_bests, performance=performance,
        insight=PerformanceInsight(
            title="Your next training priority",
            body=insight_body or "No coaching insight is recorded.",
            basis="Saved AI coaching recommendation based on onboarding; not a measured performance trend",
        ),
    )
