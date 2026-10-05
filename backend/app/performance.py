from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import isfinite
from statistics import mean, pstdev
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.routing import APIRoute
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client
from app.dashboard import DashboardMetric, DashboardOverview, PersonalBest
from app.today import DailyPlan, SwimSession
from app.training import EVENTS, WeekPlan, load_records, parse_swim_time, save_record, workout_volumes


Course = Literal["SCY", "SCM", "LCM"]
YARD_EVENTS = {
    f"{distance}y {stroke}"
    for stroke in ["Freestyle", "Backstroke", "Breaststroke", "Butterfly"]
    for distance in ([50, 100, 200, 500, 1000, 1650] if stroke == "Freestyle" else [50, 100, 200])
} | {"100y IM", "200y IM", "400y IM"}


def events_for(course: str) -> set[str]:
    return YARD_EVENTS if course == "SCY" else EVENTS - ({"100m IM"} if course == "LCM" else set())


class PerformanceRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request):
            try:
                return await handler(request)
            except APIError as exc:
                raise HTTPException(status_code=502, detail=f"Performance data could not be loaded or saved in Supabase: {exc}") from exc
            except (ValidationError, ValueError, KeyError, TypeError) as exc:
                raise HTTPException(status_code=502, detail="A saved performance record has invalid measurements or required fields. Correct the record or contact support.") from exc
        return handle


router = APIRouter(prefix="/api/performance", tags=["Performance"], route_class=PerformanceRoute)


class PerformanceRecord(BaseModel):
    date: date
    course: Course
    event: str
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, str_strip_whitespace=True)

    @field_validator("date")
    @classmethod
    def recorded_date(cls, value: date) -> date:
        if value > datetime.now(timezone.utc).date():
            raise ValueError("Actual performance cannot be recorded for a future date.")
        return value

    @model_validator(mode="after")
    def course_event(self):
        if self.event not in events_for(self.course):
            raise ValueError("Select an event supported by this pool format. SCY distances use yards.")
        return self


class Segment(BaseModel):
    distance: int = Field(ge=25, le=1650)
    seconds: float = Field(gt=0, le=7200, allow_inf_nan=False)


class RaceEntry(PerformanceRecord):
    competition: str = Field(min_length=1, max_length=150)
    final_time: str
    splits: list[Segment] = Field(default_factory=list, max_length=66)
    stroke_rate: float | None = Field(default=None, gt=0, le=150)
    notes: str = Field(default="", max_length=2000)

    @field_validator("final_time")
    @classmethod
    def valid_time(cls, value: str) -> str:
        parse_swim_time(value)
        return value.strip()

    @model_validator(mode="after")
    def split_totals(self):
        if self.splits:
            if sum(item.distance for item in self.splits) != int(self.event.split()[0][:-1]):
                raise ValueError("Segment distances must sum to the event distance.")
            if abs(sum(item.seconds for item in self.splits) - parse_swim_time(self.final_time)) > 0.15:
                raise ValueError("Segment times must sum to the final time (within 0.15s). Use segment, not cumulative, splits.")
        return self


class PaceEntry(PerformanceRecord):
    stroke: Literal["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM"]
    repetition_distance: int = Field(ge=25, le=2000)
    times_seconds: list[float] = Field(min_length=1, max_length=100)
    zone: Literal["Recovery", "Aerobic", "Threshold", "VO2 / high aerobic", "Race pace", "Sprint"]
    start_type: Literal["Push", "Dive"]
    equipment: str = Field(default="None", min_length=1, max_length=120)
    rest: str = Field(min_length=1, max_length=120)
    stroke_rate: float | None = Field(default=None, gt=0, le=150)
    notes: str = Field(default="", max_length=2000)

    @field_validator("times_seconds")
    @classmethod
    def valid_times(cls, values: list[float]) -> list[float]:
        if any(not isfinite(value) or value <= 0 or value > 7200 for value in values):
            raise ValueError("Every measured repetition time must be positive, finite, and at most 7200 seconds.")
        return values


def _owned(profile_id: str, identifier: UUID, kind: str) -> dict[str, Any]:
    result = get_supabase_client().table("user_training_sessions").select("*").eq(
        "user_id", profile_id).eq("id", str(identifier)).eq("session_type", kind).limit(1).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="This editable performance record was not found in your account.")
    return result.data[0]


def _write(profile_id: str, kind: str, payload: RaceEntry | PaceEntry, identifier: UUID | None = None):
    if identifier is None:
        key = save_record(profile_id, str(uuid4()), kind, payload.event, payload.date,
                          {"record": payload.model_dump(mode="json")})
    else:
        _owned(profile_id, identifier, kind)
        result = get_supabase_client().table("user_training_sessions").update({
            "session_name": payload.event, "session_date": f"{payload.date}T00:00:00+00:00",
            "details": {"record": payload.model_dump(mode="json")},
        }).eq("user_id", profile_id).eq("id", str(identifier)).eq("session_type", kind).execute()
        if not result.data:
            raise HTTPException(status_code=500, detail="The corrected performance record was not persisted.")
        key = str(identifier)
    return {"id": key, "saved": True}


@router.post("/races")
def add_race(request: RaceEntry, authorization: str | None = Header(default=None)):
    return _write(get_authenticated_profile(authorization)["id"], "performance_race", request)


@router.put("/races/{identifier}")
def edit_race(identifier: UUID, request: RaceEntry, authorization: str | None = Header(default=None)):
    return _write(get_authenticated_profile(authorization)["id"], "performance_race", request, identifier)


@router.post("/measurements")
def add_pace(request: PaceEntry, authorization: str | None = Header(default=None)):
    return _write(get_authenticated_profile(authorization)["id"], "performance_pace", request)


@router.put("/measurements/{identifier}")
def edit_pace(identifier: UUID, request: PaceEntry, authorization: str | None = Header(default=None)):
    return _write(get_authenticated_profile(authorization)["id"], "performance_pace", request, identifier)


@router.delete("/{kind}/{identifier}")
def delete_record(kind: Literal["races", "measurements"], identifier: UUID, authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    record_kind = "performance_race" if kind == "races" else "performance_pace"
    _owned(profile["id"], identifier, record_kind)
    result = get_supabase_client().table("user_training_sessions").delete().eq(
        "user_id", profile["id"]).eq("id", str(identifier)).eq("session_type", record_kind).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="The performance record was not deleted.")
    return {"saved": True}


def race_history(profile: dict[str, Any], rows: list[dict[str, Any]], warnings: list[str]):
    races = []
    meets = {row["id"]: row["details"]["competition"] for row in rows if row["session_type"] == "competition"}
    for row in rows:
        if row["session_type"] == "performance_race":
            record = RaceEntry.model_validate(row["details"]["record"])
            races.append({"id": row["id"], **record.model_dump(mode="json"), "source": "Performance entry", "editable": True})
        elif row["session_type"] == "race_result":
            meet = meets.get(row["details"]["competition_id"])
            if meet is None:
                raise ValueError("A saved race result has no account-owned competition.")
            result = row["details"]["result"]
            record = RaceEntry(
                date=meet["date"], course="LCM" if meet["pool_length"] == 50 else "SCM",
                event=result["event"], competition=meet["name"], final_time=result["final_time"],
                splits=[Segment(distance=item["distance_meters"], seconds=item["seconds"]) for item in result.get("splits", [])],
                stroke_rate=result.get("stroke_rate"), notes=result.get("feedback", ""),
            )
            races.append({"id": row["id"], **record.model_dump(mode="json"), "source": "Training competition", "editable": False})
    for field, course in [("pbs_lcm", "LCM"), ("pbs_scm", "SCM"), ("pbs_scy", "SCY")]:
        for event, value in (profile.get(field) or {}).items():
            if not value:
                continue
            try:
                seconds = parse_swim_time(value)
                if event not in events_for(course):
                    raise ValueError("Event is not supported by this course.")
            except (ValueError, TypeError, AttributeError) as exc:
                warnings.append(f"Onboarding {event} ({course}) was excluded: {exc} Update that PB in your profile.")
                continue
            races.append({
                "id": f"onboarding:{course}:{event}", "date": None, "course": course, "event": event,
                "competition": None, "final_time": value, "splits": [], "stroke_rate": None,
                "notes": "Onboarding PB; date and competition were not collected.",
                "source": "Onboarding PB", "editable": False, "seconds": seconds,
            })
    for race in races:
        race["seconds"] = parse_swim_time(race["final_time"])
        race["distance"] = int(race["event"].split()[0][:-1])
        race["stroke"] = race["event"].split(" ", 1)[1]
    return sorted(races, key=lambda item: (item["date"] or "", item["id"]))


def personal_bests(races):
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for race in races:
        groups[(race["event"], race["course"])].append(race)
    result = []
    for (event, course), entries in groups.items():
        dated = [race for race in entries if race["date"]]
        progression = []
        running_best = None
        by_date: dict[str, list] = defaultdict(list)
        for race in dated:
            by_date[race["date"]].append(race)
        for day in sorted(by_date):
            race = min(by_date[day], key=lambda item: item["seconds"])
            if running_best is None or race["seconds"] < running_best["seconds"]:
                running_best = race
                progression.append(race)
        current = min(entries, key=lambda race: (race["seconds"], race["date"] is None, race["date"] or ""))
        previous = None
        if current["date"]:
            earlier = [race for race in dated if race["date"] < current["date"]]
            if earlier:
                previous = min(earlier, key=lambda race: race["seconds"])
        improvement = round(previous["seconds"] - current["seconds"], 3) if previous else None
        result.append({
            "event": event, "course": course, "stroke": current["stroke"], "distance": current["distance"],
            "current": current, "previous": previous, "improvement_seconds": improvement,
            "improvement_percent": round(improvement / previous["seconds"] * 100, 2) if previous and improvement is not None else None,
            "progression": progression, "races": dated,
            "has_undated_baseline": any(not race["date"] for race in entries),
        })
    return sorted(result, key=lambda item: (item["course"], item["stroke"], item["distance"]))


def _day(row) -> date | None:
    value = row.get("session_date")
    if not value:
        return None
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc).date()


def _number(details, name) -> float | None:
    value = details.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value) or value < 0:
        raise ValueError(f"Invalid recorded {name}.")
    return float(value)


def training_history(rows, count: int, today: date):
    monday = today - timedelta(days=today.weekday())
    start = monday - timedelta(weeks=count - 1)
    completed = []
    plans: dict[str, dict] = {}
    phase_days: dict[str, set[str]] = defaultdict(set)
    daily_dates = {_day(row) for row in rows if row["session_type"] == "daily_plan"}
    for row in rows:
        kind, details, day = row["session_type"], row["details"], _day(row)
        if kind == "week_plan":
            week = WeekPlan.model_validate(details["plan"])
            for planned in week.days:
                phase_days[planned.date.isoformat()].add(week.phase)
                if planned.date in daily_dates:
                    continue
                for index, _ in enumerate(planned.swims):
                    key = f"{row['id']}:{planned.date}:{index}"
                    plans[key] = {"date": planned.date, "kind": "swim"}
                if planned.strength:
                    plans[f"strength:{planned.date}"] = {"date": planned.date, "kind": "strength"}
        elif kind == "daily_plan" and day:
            daily = DailyPlan.model_validate(details["plan"])
            phase_days[day.isoformat()].add(daily.training_phase)
            for index, swim in enumerate([daily.swim, daily.second_swim]):
                if swim:
                    key = f"{details.get('origin_week_id', row['id'])}:{day}:{index}"
                    plans[key] = {"date": day, "kind": "swim"}
            if daily.strength:
                plans[f"strength:{day}"] = {"date": day, "kind": "strength"}
        elif kind == "gym_workout" and day:
            plans[f"strength:{day}"] = {"date": day, "kind": "strength"}
        elif kind == "workout" and details.get("date"):
            plans[row["id"]] = {"date": date.fromisoformat(details["date"]), "kind": "swim"}
            phase_days[details["date"]].add(details["phase"])
        elif kind in {"swim", "swimming", "strength", "gym"}:
            if details.get("completion_status") in {"scheduled", "in_progress"} and day:
                plans[details.get("workout_key") or row["id"]] = {"date": day, "kind": "swim" if kind in {"swim", "swimming"} else "strength"}
            if details.get("completion_status") != "completed" or not day or day > today:
                continue
            if kind in {"strength", "gym"}:
                completed.append({"date": day, "kind": "strength", "key": f"strength:{day}", "distance": None,
                                  "record_key": row["id"], "zones": {}, "race": None, "sprint": None, "phase": details.get("phase")})
                continue
            distance = _number(details, "distance_meters")
            zones = details.get("zone_volumes_meters") or {}
            zones = {name: _number({"meters": value}, "meters") for name, value in zones.items()}
            if any(value is None for value in zones.values()):
                raise ValueError("Recorded zone volumes cannot be null.")
            race, sprint = _number(details, "race_pace_meters"), _number(details, "sprint_meters")
            if details.get("workout"):
                workout = SwimSession.model_validate(details["workout"])
                derived_zones, composition = workout_volumes(workout)
                if distance is None:
                    distance = float(workout.total_distance_meters)
                if not zones:
                    zones = derived_zones
                if race is None:
                    race = float(composition["Race pace"])
                if sprint is None:
                    sprint = float(composition["Sprint"])
            if distance is not None and (sum(zones.values()) > distance + 0.01 or (race or 0) + (sprint or 0) > distance + 0.01):
                raise ValueError("Recorded zones/race/sprint volume exceed completed distance.")
            completed.append({"date": day, "kind": "swim", "key": details.get("workout_key") or row["id"],
                              "record_key": row["id"],
                              "distance": distance, "zones": zones, "race": race, "sprint": sprint,
                              "phase": details.get("phase")})
    weeks = []
    for index in range(count):
        beginning = start + timedelta(weeks=index)
        end = beginning + timedelta(days=7)
        sessions = [item for item in completed if beginning <= item["date"] < end]
        swims = [item for item in sessions if item["kind"] == "swim"]
        due = {key for key, item in plans.items() if beginning <= item["date"] < end and item["date"] <= today}
        matched_keys = set()
        for session in sessions:
            for key in [session["key"], session["record_key"]]:
                if key in due and key not in matched_keys:
                    matched_keys.add(key)
                    break
        matched = len(matched_keys)
        zone_totals: dict[str, float] = defaultdict(float)
        for swim in swims:
            if swim["distance"] is None:
                continue
            for zone, meters in swim["zones"].items():
                zone_totals[zone] += meters
            if swim["distance"] is not None:
                missing = swim["distance"] - sum(swim["zones"].values())
                if missing > 0.01:
                    zone_totals["Unclassified"] += missing
        known = sum(item["distance"] for item in swims if item["distance"] is not None)
        phases = sorted({phase for day, labels in phase_days.items() if beginning.isoformat() <= day < end.isoformat() for phase in labels}
                        | {item["phase"] for item in sessions if item["phase"]})
        weeks.append({
            "week_start": beginning.isoformat(), "distance_meters": known if all(item["distance"] is not None for item in swims) else None,
            "known_distance_meters": known, "distance_coverage": sum(item["distance"] is not None for item in swims),
            "swim_sessions": len(swims), "strength_sessions": len(sessions) - len(swims),
            "race_pace_meters": sum(item["race"] for item in swims) if all(item["race"] is not None for item in swims) else None,
            "sprint_meters": sum(item["sprint"] for item in swims) if all(item["sprint"] is not None for item in swims) else None,
            "zones": [{"zone": zone, "meters": meters, "percentage": round(meters / known * 100, 1) if known else 0} for zone, meters in sorted(zone_totals.items())],
            "scheduled_due": len(due), "matched_completed": matched,
            "consistency_percent": round(matched / len(due) * 100, 1) if due else None,
            "phases": phases, "partial_week": end > today,
        })
    return weeks, completed


def apply_performance_snapshot(profile: dict[str, Any], overview: DashboardOverview) -> DashboardOverview:
    rows = load_records(profile["id"], ["performance_race", "race_result", "competition"])
    races = race_history(profile, rows, [])
    bests = personal_bests(races)
    dated = [race for race in races if race["date"]]
    latest = max(dated, key=lambda race: (race["date"], race["id"])) if dated else None
    dated_bests = [item["current"] for item in bests if item["current"]["date"]]
    latest_pb = max(dated_bests, key=lambda race: race["date"]) if dated_bests else None
    replacements = {
        "Latest PB": DashboardMetric(
            label="Latest PB", value=f"{latest_pb['event']} · {latest_pb['final_time']}" if latest_pb else "Date not recorded" if bests else "Not recorded",
            detail=f"{latest_pb['date']} · {latest_pb['competition']} · {latest_pb['course']} · Fastest recorded same-course result" if latest_pb else "Onboarding bests are undated; view Performance for dated history.",
        ),
        "Recent race result": DashboardMetric(
            label="Recent race result", value=f"{latest['event']} · {latest['final_time']}" if latest else "Not recorded",
            detail=f"{latest['date']} · {latest['competition']} · {latest['course']}" if latest else "No actual dated race result saved.",
        ),
    }
    if latest:
        previous_dates = [race["date"] for race in dated
                          if race["course"] == latest["course"] and race["event"] == latest["event"] and race["date"] < latest["date"]]
        if previous_dates:
            last_day = max(previous_dates)
            previous = min((race for race in dated if race["date"] == last_day and race["course"] == latest["course"] and race["event"] == latest["event"]), key=lambda race: race["seconds"])
            latest_on_day = min((race for race in dated if race["date"] == latest["date"] and race["course"] == latest["course"] and race["event"] == latest["event"]), key=lambda race: race["seconds"])
            delta = latest_on_day["seconds"] - previous["seconds"]
            replacements["Performance trend"] = DashboardMetric(
                label="Performance trend", value=f"{abs(delta):.3f}s {'faster' if delta < 0 else 'slower' if delta > 0 else 'unchanged'}",
                detail=f"{latest['event']} · {latest['course']} · Fastest same-day results, {last_day} vs {latest['date']}; not a causal trend.",
            )
    return overview.model_copy(update={
        "personal_bests": [PersonalBest(
            event=item["event"], course=item["course"], time=item["current"]["final_time"],
            target=(profile.get("one_year_goal_times") or {}).get(item["event"]) if item["course"] == "LCM" else None,
        ) for item in bests],
        "performance": [replacements.get(item.label, item) for item in overview.performance],
    })


@router.get("")
def get_performance(weeks: int = Query(default=12, ge=1, le=52), authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    rows = load_records(profile["id"], [
        "performance_race", "performance_pace", "competition", "race_result",
        "week_plan", "daily_plan", "workout", "swim", "swimming", "strength", "gym", "gym_workout",
    ])
    warnings: list[str] = []
    races = race_history(profile, rows, warnings)
    measurements = []
    for row in rows:
        if row["session_type"] != "performance_pace":
            continue
        entry = PaceEntry.model_validate(row["details"]["record"])
        average = mean(entry.times_seconds)
        measurements.append({
            "id": row["id"], **entry.model_dump(mode="json"),
            "mean_seconds": round(average, 3),
            "pace_per_100": round(average / entry.repetition_distance * 100, 3),
            "consistency_cv": round(pstdev(entry.times_seconds) / average * 100, 2) if len(entry.times_seconds) >= 2 else None,
            "repetitions": len(entry.times_seconds),
        })
    today = datetime.now(timezone.utc).date()
    analytics, completed = training_history(rows, weeks, today)
    relationships = []
    for race in races:
        if not race["date"] or race["date"] < analytics[0]["week_start"]:
            continue
        day = date.fromisoformat(race["date"])
        preceding = [item for item in completed if day - timedelta(days=28) <= item["date"] < day and item["kind"] == "swim"]
        relationships.append({
            "race_id": race["id"], "date": race["date"], "event": race["event"], "course": race["course"],
            "seconds": race["seconds"], "swim_sessions": len(preceding),
            "distance_meters": sum(item["distance"] for item in preceding) if preceding and all(item["distance"] is not None for item in preceding) else None,
            "race_pace_meters": sum(item["race"] for item in preceding) if preceding and all(item["race"] is not None for item in preceding) else None,
        })
    if any(item["distance_coverage"] < item["swim_sessions"] for item in analytics):
        warnings.append("Some completed swims have no recorded distance. Weekly totals with incomplete coverage remain unavailable; known volume is shown separately.")
    return {
        "timezone": "UTC", "as_of": today.isoformat(), "main_events": profile.get("main_events") or [],
        "events_by_course": {course: sorted(events_for(course)) for course in ["SCY", "SCM", "LCM"]},
        "personal_bests": personal_bests(races), "races": races,
        "measurements": sorted(measurements, key=lambda item: (item["date"], item["id"])),
        "weeks": analytics, "relationships": relationships, "warnings": warnings,
        "methodology": [
            "PBs and trends are compared only within the same event and pool format; SCY uses yards. No course conversions or performance scores.",
            "Current PB is the fastest recorded valid time. Previous PB is the fastest dated result strictly before the current PB date. Undated onboarding PBs are not placed on a timeline or assigned a previous PB.",
            "PB progression shows improvements among dated races only, using the fastest race per date. Races on the same date have no known start order; previous-day comparisons never infer that order.",
            "Measured training pace is mean repeat time / repeat distance × 100, in seconds per 100m or 100yd. Compare the same event, actual repetition stroke, course, repeat distance, start type, equipment, rest and zone.",
            "Race-pace consistency is population standard deviation / mean repeat time × 100 (CV%). Lower values mean less variability, not faster or better swimming. At least two measured repetitions are required.",
            "Training analytics use only athlete-confirmed completed sessions. Prescribed-workout completions reflect the athlete's confirmation, not sensor measurements. Pace samples alone do not add completed distance.",
            "Consistency = completed matching saved sessions / saved sessions due on or before today. Each completion matches at most one saved session. Onboarding availability is not a dated schedule. Unscheduled completions contribute volume/frequency but not this ratio.",
            "Historical phases come from saved dated plans or recorded session phases; they are coaching labels, not measured adaptation. Current week is partial. Training/race comparisons use the preceding 28 days and do not establish causation.",
        ],
    }
