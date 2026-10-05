"""Pace Calculator: saved athletes with PBs per stroke and course, and training paces for six zones.

How paces are derived (deterministic, no AI):
1. Each PB is brought to the selected course (conversion factors), the athlete's current suit (tech-suit gain)
   and a push start (a dive or backstroke start is worth a fixed amount per rep).
2. A speed curve t = a·d^k is fitted through the adjusted PBs (one PB uses a typical exponent).
3. Threshold = critical swim speed (CSS) from a 200/400 test when given, otherwise from the curve.
4. Recovery, aerobic and threshold paces are set from CSS; high aerobic from 200–400 speed;
   race pace from each PB; sprint from 50 speed. Dive targets subtract the start advantage once per rep.
"""
from __future__ import annotations

from datetime import date as Date, datetime, timedelta, timezone
from math import exp, log
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.auth import get_authenticated_profile
from app.db import get_supabase_client
from app.pace_pdf import render_pace_pdf
from app.paces import references
from app.training import TrainingRoute, load_records, parse_swim_time, record_id, save_record

Stroke = Literal["Freestyle", "Backstroke", "Breaststroke", "Butterfly"]
Course = Literal["LCM", "SCM", "SCY"]
Suit = Literal["TRAINING_SUIT", "TECH"]
Start = Literal["DIVE", "PUSH"]
Display = Literal["BOTH", "PUSH", "DIVE"]
STROKES: list[str] = ["Freestyle", "Backstroke", "Breaststroke", "Butterfly"]
COURSES: list[str] = ["LCM", "SCM", "SCY"]
SELF = "self"
MAX_ATHLETES = 200

# Seconds a dive (backstroke: in-water start) saves over a push start, once per rep.
START_ADVANTAGE = {"Freestyle": 0.8, "Butterfly": 0.8, "Breaststroke": 0.9, "Backstroke": 0.5}
# Time multiplier that converts a swim in a course to its short-course-metre equivalent.
TO_SCM = {"SCM": 1.0, "LCM": 0.975, "SCY": 1 / 0.89}
TO_SCM_BREAST_LCM = 0.97
# Typical speed-curve exponents (t = a·d^k) when only one PB is known.
DEFAULT_EXPONENT = {"Freestyle": 1.06, "Backstroke": 1.07, "Breaststroke": 1.07, "Butterfly": 1.08}


def distances_for(stroke: str, course: str) -> list[int]:
    if stroke == "Freestyle":
        return [50, 100, 200, 500, 1000, 1650] if course == "SCY" else [50, 100, 200, 400, 800, 1500]
    return [50, 100, 200]


def tech_gain(distance: int) -> float:
    """Share of race time a tech suit typically saves over a training suit."""
    return 0.02 if distance <= 100 else 0.017 if distance <= 200 else 0.013 if distance <= 500 else 0.01


def to_scm(course: str, stroke: str) -> float:
    return TO_SCM_BREAST_LCM if course == "LCM" and stroke == "Breaststroke" else TO_SCM[course]


def _seconds(value: str) -> float:
    try:
        seconds = parse_swim_time(value)
    except (ValueError, HTTPException) as exc:
        raise ValueError("Use a time like 28.45 or 1:02.30.") from exc
    if seconds <= 0:
        raise ValueError("Times must be positive.")
    return seconds


class PbEntry(BaseModel):
    distance: int = Field(ge=25, le=1650)
    time: str = Field(min_length=1, max_length=12)
    suit: Suit = "TRAINING_SUIT"
    start: Start = "DIVE"
    swum_on: Date | None = None
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("time")
    @classmethod
    def valid_time(cls, value: str) -> str:
        _seconds(value)
        return value


class CssTest(BaseModel):
    """Push-start 200 and 400 time trial in training (critical swim speed test)."""
    t200: str | None = Field(default=None, max_length=12)
    t400: str | None = Field(default=None, max_length=12)
    tested_on: Date | None = None
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("t200", "t400")
    @classmethod
    def valid_time(cls, value: str | None) -> str | None:
        if value:
            _seconds(value)
        return value or None


class AthleteIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    group: str = Field(default="", max_length=60)
    course: Course = "SCM"
    notes: str = Field(default="", max_length=1000)
    pbs: dict[str, list[PbEntry]] = Field(default_factory=dict)
    tests: dict[str, CssTest] = Field(default_factory=dict)
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @model_validator(mode="after")
    def valid_keys(self):
        for key, entries in self.pbs.items():
            course, _, stroke = key.partition(":")
            if course not in COURSES or stroke not in STROKES:
                raise ValueError(f"Unknown PB group {key}.")
            allowed = distances_for(stroke, course)
            distances = [entry.distance for entry in entries]
            if len(set(distances)) != len(distances) or any(distance not in allowed for distance in distances):
                raise ValueError(f"{stroke} {course} PBs must use distinct distances from {allowed}.")
        for key in self.tests:
            course, _, stroke = key.partition(":")
            if course not in COURSES or stroke not in STROKES:
                raise ValueError(f"Unknown test group {key}.")
        return self


class CalculateRequest(BaseModel):
    athlete: AthleteIn
    stroke: Stroke = "Freestyle"
    course: Course = "SCM"
    suit: Suit = "TRAINING_SUIT"
    display: Display = "BOTH"
    model_config = ConfigDict(extra="forbid")


# ---------------------------------------------------------------- calculation
ZONE_INFO = {
    "Recovery": ("Easy swimming to recover and reset. Long, relaxed strokes; you should be able to talk between repeats.", "Rest as needed"),
    "Aerobic": ("Builds the aerobic engine. Steady repeats you could hold for 30+ minutes with clean technique.", "10–20 s rest"),
    "Threshold": ("Critical swim speed: the fastest pace you can sustain for about 30 minutes.", "10–20 s rest"),
    "VO2 / high aerobic": ("Hard repeats between 200 and 400 race speed to raise top-end aerobic power.", "Work : rest about 1 : 1"),
    "Race pace": ("The exact speed of each of your events. Use broken swims and pace 25s/50s.", "Work : rest 1 : 2 to 1 : 4"),
    "Sprint": ("All-out speed with full recovery. Stop the set when speed or technique drops.", "Work : rest 1 : 4 or more"),
}


def fmt(seconds: float) -> str:
    minutes, rest = divmod(seconds, 60)
    return f"{int(minutes)}:{rest:04.1f}" if minutes else f"{rest:.1f}"


def _range(fast: float, slow: float) -> dict[str, float]:
    return {"fast": round(fast, 2), "slow": round(slow, 2)}


def calculate(request: CalculateRequest, today: Date | None = None) -> dict[str, Any]:
    stroke, course, suit = request.stroke, request.course, request.suit
    athlete = request.athlete
    unit = "yd" if course == "SCY" else "m"
    advantage = START_ADVANTAGE[stroke]
    flags: list[dict[str, str]] = []
    key = f"{course}:{stroke}"
    today = today or datetime.now(timezone.utc).date()

    entries = [(entry, course) for entry in athlete.pbs.get(key, [])]
    converted_from = None
    if not entries:
        for other in COURSES:
            if other != course and athlete.pbs.get(f"{other}:{stroke}"):
                entries = [(entry, other) for entry in athlete.pbs[f"{other}:{stroke}"]]
                converted_from = other
                flags.append({"level": "info", "text": f"No {course} {stroke.lower()} PBs yet, so {other} PBs were converted to {course}. Converted times are estimates; add {course} PBs for exact paces."})
                break

    points: list[tuple[int, float]] = []
    suit_adjusted = False
    for entry, source in entries:
        seconds = _seconds(entry.time)
        per_100 = seconds / entry.distance * 100
        if per_100 < 40 or per_100 > 240:
            flags.append({"level": "warning", "text": f"The {entry.distance} {stroke.lower()} PB ({entry.time}) is not a realistic race time, so it was left out. Update it in the PB list."})
            continue
        time = seconds * to_scm(source, stroke) / to_scm(course, stroke) if source != course else seconds
        if entry.suit != suit:
            suit_adjusted = True
            gain = tech_gain(entry.distance)
            time = time / (1 - gain) if entry.suit == "TECH" else time * (1 - gain)
        if entry.start == "DIVE":
            time += advantage
        if entry.swum_on and entry.swum_on < today - timedelta(days=548):
            flags.append({"level": "warning", "text": f"The {entry.distance} PB is from {entry.swum_on:%b %Y}. Older PBs can make paces too fast or too slow."})
        points.append((entry.distance, time))
    if suit_adjusted:
        target = "a training suit" if suit == "TRAINING_SUIT" else "a tech suit"
        flags.append({"level": "info", "text": f"PBs swum in a different suit were adjusted to {target} (about 1–2% of race time)."})

    result: dict[str, Any] = {
        "athlete": athlete.name, "stroke": stroke, "course": course, "unit": unit, "suit": suit, "display": request.display,
        "start_advantage": advantage, "converted_from": converted_from, "zones": [], "flags": flags,
        "reference": None,
    }
    if not points:
        flags.insert(0, {"level": "warning", "text": f"Add at least one {stroke.lower()} PB to calculate {course} training paces."})
        return result

    # Speed curve through the push-equivalent PBs.
    default_k = DEFAULT_EXPONENT[stroke]
    if len({distance for distance, _ in points}) >= 2:
        xs = [log(distance) for distance, _ in points]
        ys = [log(time) for _, time in points]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        k = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
        if not 1.0 <= k <= 1.16:
            flags.append({"level": "warning", "text": "Your PBs don't line up (a longer event is relatively faster or much slower than expected), so a typical speed curve was used. Check the times."})
            k = default_k
            a = exp(sum(log(time) - k * log(distance) for distance, time in points) / len(points))
        else:
            a = exp(my - k * mx)
        if len(points) >= 3:
            for distance, time in points:
                deviation = time / (a * distance ** k) - 1
                if deviation > 0.03:
                    flags.append({"level": "warning", "text": f"The {distance} PB looks slow next to the others (about {deviation:.0%}). If it's out of date, update it."})
    else:
        k = default_k
        distance, time = points[0]
        a = time / distance ** k
        flags.append({"level": "info", "text": f"Only one {stroke.lower()} PB is known, so other distances follow a typical speed curve. Add a second PB (for example a 200) for sharper paces."})

    def predict(distance: float) -> float:
        return a * distance ** k

    test = athlete.tests.get(key)
    if test and test.t200 and test.t400 and _seconds(test.t400) > _seconds(test.t200):
        css = (_seconds(test.t400) - _seconds(test.t200)) / 2
        if suit == "TECH":
            css *= 1 - tech_gain(400)
        css_basis = f"your 200/400 test{f' ({test.tested_on:%d %b %Y})' if test.tested_on else ''}"
    else:
        css = (predict(400) - predict(200)) / 2
        css_basis = "your PB speed curve (400 time minus 200 time, halved)"

    pace_50, pace_200, pace_400 = predict(50) * 2, predict(200) / 2, predict(400) / 4
    full_rest = {"Recovery", "Aerobic", "Threshold"}

    def rows(fast_100: float, slow_100: float, distances: list[int], dive: bool, label: str | None = None) -> list[dict[str, Any]]:
        out = []
        for distance in distances:
            push = _range(fast_100 * distance / 100, slow_100 * distance / 100)
            note = None
            if course == "LCM" and distance % 50:
                note = f"Finishes mid-pool ({distance} m mark)"
            out.append({
                "label": label or f"{distance} {unit}", "distance": distance, "push": push,
                "dive": _range(push["fast"] - advantage, push["slow"] - advantage) if dive else None, "note": note,
            })
        return out

    long_reps = [100, 200, 400, 800] if stroke == "Freestyle" else [100, 200, 400]
    zones = [
        ("Recovery", css * 1.20, css * 1.35, rows(css * 1.20, css * 1.35, [100, 200, 400], False),
         f"CSS {fmt(css)}/100 from {css_basis}; recovery is 20–35% slower."),
        ("Aerobic", css * 1.06, css * 1.14, rows(css * 1.06, css * 1.14, long_reps, False),
         f"CSS {fmt(css)}/100 from {css_basis}; aerobic is 6–14% slower so it can be held for long sets."),
        ("Threshold", css * 0.99, css * 1.03, rows(css * 0.99, css * 1.03, [50, 100, 200, 400], False),
         f"Critical swim speed {fmt(css)}/100 from {css_basis}, with a small range either side."),
        ("VO2 / high aerobic", (pace_200 + pace_400) / 2, pace_400 * 1.02, rows((pace_200 + pace_400) / 2, pace_400 * 1.02, [50, 100, 200], True),
         f"Between your 200 pace ({fmt(pace_200)}/100) and 400 pace ({fmt(pace_400)}/100) from the speed curve, push-start equivalent."),
    ]
    race_rows = []
    for distance, time in sorted(points):
        per_100 = time / distance * 100
        # Broken-swim reps: halves and quarters of the event (25–200), or the event itself for a 50.
        reps = sorted({rep for rep in (distance // 2, distance // 4) if rep >= 25 and rep % 25 == 0 and rep <= 200}, reverse=True) or [distance]
        race_rows += [dict(row, label=f"{distance} pace · {row['distance']} {unit}") for row in rows(per_100, per_100 * 1.01, reps, True)]
    zones.append(("Race pace", min(time / distance * 100 for distance, time in points), max(time / distance * 100 for distance, time in points) * 1.01,
                  race_rows, "Each row holds the average speed of that PB, converted to a push start; the dive column adds the start back once."))
    zones.append(("Sprint", pace_50 * 0.97, pace_50, rows(pace_50 * 0.97, pace_50, [25, 50], True),
                  f"Your 50 speed ({fmt(pace_50)}/100, push-start equivalent) up to 3% faster for short, fully rested efforts."))

    result["zones"] = [{
        "zone": zone, "purpose": ZONE_INFO[zone][0], "rest": ZONE_INFO[zone][1], "why": why,
        "per_100": _range(fast, slow), "dive_relevant": zone not in full_rest, "rows": zone_rows,
    } for zone, fast, slow, zone_rows, why in zones]
    result["reference"] = {
        "css_per_100": round(css, 2), "css_basis": css_basis, "exponent": round(k, 3),
        "pace_50": round(pace_50, 2), "pace_200": round(pace_200, 2), "pace_400": round(pace_400, 2),
        "pbs_used": len(points),
    }
    return result


# ---------------------------------------------------------------- athletes
router = APIRouter(prefix="/api/pace-calculator", tags=["Pace Calculator"], route_class=TrainingRoute)


def _default_course(profile) -> str:
    return "LCM" if "50m Pool" in (profile.get("facilities") or []) else "SCM"


def _self_imported(profile) -> dict[str, Any]:
    """The signed-in swimmer, pre-filled from their recorded PBs (onboarding and race results)."""
    pbs, _ = references(profile)
    grouped: dict[str, list[dict[str, Any]]] = {}
    for pb in pbs:
        stroke, course, distance = pb.get("stroke"), pb.get("course"), pb.get("distance")
        if stroke not in STROKES or course not in COURSES or distance not in distances_for(stroke, course):
            continue
        group = grouped.setdefault(f"{course}:{stroke}", [])
        if all(item["distance"] != distance for item in group):
            group.append({"distance": distance, "time": pb["final_time"], "suit": "TECH", "start": "DIVE", "swum_on": pb.get("date")})
    return {"name": profile.get("full_name") or "You", "group": "", "course": _default_course(profile), "notes": "", "pbs": grouped, "tests": {}}


def _athlete(row: dict[str, Any] | None, profile, identifier: str) -> dict[str, Any]:
    details = row["details"] if row else _self_imported(profile)
    data = AthleteIn.model_validate({key: details.get(key) for key in ("name", "group", "course", "notes", "pbs", "tests") if details.get(key) is not None})
    return {"id": identifier, **data.model_dump(mode="json"), "is_self": identifier == SELF,
            "imported": row is None, "updated_at": details.get("updated_at") if row else None}


def _rows(profile) -> list[dict[str, Any]]:
    return load_records(profile["id"], ["pace_athlete"])


def _all(profile) -> list[dict[str, Any]]:
    rows = _rows(profile)
    self_id = record_id(profile["id"], "pace-athlete:self")
    athletes = [_athlete(next((row for row in rows if row["id"] == self_id), None), profile, SELF)]
    others = [_athlete(row, profile, row["id"]) for row in rows if row["id"] != self_id]
    return athletes + sorted(others, key=lambda item: item["name"].lower())


def _save(profile, key: str, athlete: AthleteIn, is_self: bool) -> str:
    return save_record(profile["id"], key, "pace_athlete", athlete.name, None, {
        **athlete.model_dump(mode="json"), "is_self": is_self, "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def _listing(profile) -> dict[str, Any]:
    return {
        "athletes": _all(profile), "default_course": _default_course(profile), "strokes": STROKES,
        "distances": {course: {stroke: distances_for(stroke, course) for stroke in STROKES} for course in COURSES},
    }


def _other_id(profile, identifier: str) -> str:
    try:
        UUID(identifier)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Athlete not found.") from exc
    if not any(row["id"] == identifier for row in _rows(profile)) or identifier == record_id(profile["id"], "pace-athlete:self"):
        raise HTTPException(status_code=404, detail="Athlete not found.")
    return identifier


@router.get("/athletes")
def list_athletes(authorization: str | None = Header(default=None)):
    return _listing(get_authenticated_profile(authorization))


@router.post("/athletes")
def create_athlete(request: AthleteIn, authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    if len(_rows(profile)) >= MAX_ATHLETES:
        raise HTTPException(status_code=409, detail=f"You can save up to {MAX_ATHLETES} athletes.")
    identifier = _save(profile, f"pace-athlete:{uuid4()}", request, False)
    return {**_listing(profile), "saved_id": identifier}


@router.put("/athletes/{identifier}")
def update_athlete(identifier: str, request: AthleteIn, authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    if identifier == SELF:
        _save(profile, "pace-athlete:self", request, True)
    else:
        row = next(row for row in _rows(profile) if row["id"] == _other_id(profile, identifier))
        get_supabase_client().table("user_training_sessions").update({
            "session_name": request.name,
            "details": {**row["details"], **request.model_dump(mode="json"), "updated_at": datetime.now(timezone.utc).isoformat()},
        }).eq("user_id", profile["id"]).eq("id", identifier).execute()
    return {**_listing(profile), "saved_id": identifier}


@router.delete("/athletes/{identifier}")
def delete_athlete(identifier: str, authorization: str | None = Header(default=None)):
    """Delete an athlete. For yourself this resets the PBs to the ones recorded in your account."""
    profile = get_authenticated_profile(authorization)
    target = record_id(profile["id"], "pace-athlete:self") if identifier == SELF else _other_id(profile, identifier)
    get_supabase_client().table("user_training_sessions").delete().eq("user_id", profile["id"]).eq("id", target).execute()
    return _listing(profile)


@router.post("/calculate")
def calculate_paces(request: CalculateRequest, authorization: str | None = Header(default=None)):
    get_authenticated_profile(authorization)
    return calculate(request)


@router.post("/pdf")
def export_pace_pdf(request: CalculateRequest, authorization: str | None = Header(default=None)):
    profile = get_authenticated_profile(authorization)
    result = calculate(request)
    if not result["zones"]:
        raise HTTPException(status_code=409, detail=result["flags"][0]["text"])
    name = "-".join(part for part in [request.athlete.name, request.stroke, request.course, "paces"] if part)
    safe = "".join(char if char.isalnum() else "-" for char in name).strip("-")[:60]
    return Response(render_pace_pdf(result, profile.get("full_name")), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.pdf"'})
