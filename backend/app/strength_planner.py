"""SwimGPT Strength & Mobility generator: athlete data + the system (strength_system / strength_library) → gym week.

Pure and deterministic: no database or AI calls here, so every prescription can be tested. It follows the system's
session-generator logic:

  STEP 1  Read the athlete: events, coach, training age, assessments, KPIs, phase, competition date, readiness.
  STEP 2  Identify buckets: which need build / maintain / minimal exposure.
  STEP 3  Select the six movement slots (the coach's session for this block, dosed for the athlete).
  STEP 4  Personalize the warm-up: hypomobile → mobility, hypermobile → activation/control.
  STEP 5  Stimulus-to-fatigue check: the lowest-fatigue dose that still trains the target.
  STEP 6  Quality monitoring: regress whenever quality, mobility or fatigue says so (written into every session).

Mobility, movement and KPI assessments are optional (`profile["strength_assessment"]`); without them the generator
uses the coach's standard session, the mobility demands of the athlete's strokes, and conservative progressions.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.strength_library import DRILLS, EQUIPMENT_BY_FACILITY, FAMILIES, Family, Variant
from app.strength_system import (
    BROAD_JUMP_ELITE_CM, BUCKETS, BUILD, CENTRAL_MOBILITY_RULE, COACH_SYSTEMS, COMPETITION_PRIORITIES, MAINTAIN, MINIMAL,
    KPIS, MOBILITY_AREAS, MOVEMENT_ALPHABET, NO_GYM_DAYS_BEFORE_MEET, PHASES, PROGRAMMING_RULE, QUALITY_CHECKS, QUALITY_RULES,
    RELATIVE_PULL_UP_ELITE, STIMULUS_TO_FATIGUE, STROKE_MOBILITY, SYSTEM_BY_COACH_NAME, TAPER_SETS, CoachSystem, Dose,
    SessionTemplate, Slot, relative_pull_up,
)

GYM_FACILITIES = ("Full Gym Access", "Basic Gym", "Home Equipment")
SOURCE_LABEL = "SwimGPT Strength & Mobility System"
SKILL_FAMILIES = {"front_lever", "handstand", "pistol", "ab_wheel"}
YOUTH_AGE = 14


# ---------------------------------------------------------------- STEP 1: read the athlete
@dataclass
class Athlete:
    age: int | None = None
    gender: str | None = None
    weight_kg: float | None = None
    events: list[str] = field(default_factory=list)
    swimmer_type: str | None = None
    coach: str | None = None                         # the athlete's coach ("Coach Tony")
    facility: str | None = None                      # best gym level available, None = no gym access
    gym_sessions: int = 0
    swim_sessions: int = 0
    years_swimming: int | None = None
    completed_sessions: int = 0                      # strength sessions completed in SwimGPT so far
    readiness: list[dict[str, Any]] = field(default_factory=list)   # recent check-ins (energy, soreness, sleep 1–5)
    competitions: list[dict[str, Any]] = field(default_factory=list)  # {"date", "priority", "name"}
    started: date | None = None                      # first day with SwimGPT (anchors the block rotation)
    assessment: dict[str, Any] = field(default_factory=dict)


def athlete_from_profile(profile: dict[str, Any], *, completed_sessions: int = 0, readiness: list[dict[str, Any]] | None = None,
                         competitions: list[dict[str, Any]] | None = None) -> Athlete:
    facilities = profile.get("facilities") or []
    created = str(profile.get("created_at") or "")[:10]
    return Athlete(
        age=_number(profile.get("age")), gender=profile.get("gender"), weight_kg=_number(profile.get("weight"), float),
        events=list(profile.get("main_events") or []), swimmer_type=profile.get("swimmer_type"),
        coach=(profile.get("recommended_coaches") or [None])[0],
        facility=next((name for name in GYM_FACILITIES if name in facilities), None),
        gym_sessions=_number(profile.get("gym_sessions_per_week")) or 0,
        swim_sessions=_number(profile.get("swim_sessions_per_week")) or 0,
        years_swimming=_number(profile.get("swim_experience")),
        completed_sessions=completed_sessions, readiness=readiness or [], competitions=competitions or [],
        started=date.fromisoformat(created) if re.match(r"^\d{4}-\d{2}-\d{2}$", created) else None,
        assessment=profile.get("strength_assessment") or {},
    )


def _number(value: Any, kind: type = int):
    try:
        return kind(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def coach_system(athlete: Athlete) -> CoachSystem:
    """The athlete's strength identity: their coach's Strength & Mobility system, or (for a coach without one, such
    as Coach Brad) the system for their swimmer type."""
    if athlete.coach in SYSTEM_BY_COACH_NAME:
        return COACH_SYSTEMS[SYSTEM_BY_COACH_NAME[athlete.coach]]
    by_type = {"sprinter": "timothy" if athlete.facility in ("Full Gym Access", "Basic Gym") else "pete",
               "distance": "tony", "mid": "robert", "specialist": "robert"}
    return COACH_SYSTEMS[by_type.get(str(athlete.swimmer_type or "").lower(), "robert")]


def strokes(events: list[str]) -> list[str]:
    found = []
    for event in events:
        stroke = "IM" if event.endswith("IM") else event.split(" ", 1)[-1]
        if stroke in STROKE_MOBILITY and stroke not in found:
            found.append(stroke)
    return found


def event_mobility_areas(events: list[str]) -> list[str]:
    """Mobility areas the athlete's strokes depend on, most shared first."""
    counts: dict[str, int] = {}
    for stroke in strokes(events):
        for index, area in enumerate(STROKE_MOBILITY[stroke]):
            counts[area] = counts.get(area, 0) + 10 - index
    return sorted(counts, key=lambda area: -counts[area])


@dataclass(frozen=True)
class Block:
    key: str                   # W1-2 | W3-4 | W5 | W6
    weeks_out: int | None      # weeks until the target meet, if one is being planned toward
    meet: dict[str, Any] | None


def training_block(athlete: Athlete, week_start: date) -> Block:
    """Plan backward from the next A/B meet (6-week mesocycle); without one, rotate general and specific preparation."""
    meets = sorted((meet for meet in athlete.competitions
                    if meet.get("priority") in COMPETITION_PRIORITIES and str(meet.get("date", "")) >= week_start.isoformat()),
                   key=lambda meet: meet["date"])
    if meets:
        meet_day = date.fromisoformat(meets[0]["date"])
        weeks_out = ((meet_day - timedelta(days=meet_day.weekday())) - week_start).days // 7
        if weeks_out <= 5:
            key = "W6" if weeks_out == 0 else "W5" if weeks_out == 1 else "W3-4" if weeks_out <= 3 else "W1-2"
            return Block(key, weeks_out, meets[0])
    weeks_in = max(0, (week_start - athlete.started).days // 7) if athlete.started else 0
    return Block("W1-2" if weeks_in % 4 < 2 else "W3-4", None, None)


def progression_level(athlete: Athlete) -> int:
    """Fundamentals → strength development → advanced targets, earned through completed sessions (or proven quality)."""
    youth = athlete.age is not None and athlete.age < YOUTH_AGE
    experienced = (athlete.age or 0) >= 17 and (athlete.years_swimming or 0) >= 6 and athlete.facility in ("Full Gym Access", "Basic Gym")
    level = 1
    if athlete.completed_sessions >= 9 or experienced:
        level = 2
    if athlete.completed_sessions >= 30 and (athlete.age or 0) >= 16:
        level = 3
    return min(level, 2) if youth else level


def readiness_low(athlete: Athlete) -> bool:
    """Recent check-ins say fatigue is incompatible with hard work (low energy or sleep, high soreness)."""
    recent = athlete.readiness[:3]
    if not recent:
        return False
    average = lambda key: sum(item.get(key, 3) for item in recent) / len(recent)
    return average("energy") <= 2 or average("sleep_quality") <= 2 or average("muscle_soreness") >= 4


# ---------------------------------------------------------------- STEP 2: buckets
def bucket_plan(athlete: Athlete) -> dict[str, str]:
    """Build the limiting bucket(s); hold strong ones with a minimal dose. Needs KPI data; otherwise all maintain."""
    plan = {bucket: MAINTAIN for bucket in BUCKETS}
    kpis = athlete.assessment.get("kpis") or {}
    ratings: dict[str, str] = dict(athlete.assessment.get("kpi_ratings") or {})   # e.g. {"broad_jump": "excellent"}
    sex = athlete.gender if athlete.gender in ("male", "female") else "female"     # 'other': the lower reference
    if athlete.weight_kg and kpis.get("weighted_pull_up_added_kg") is not None:
        low, high = RELATIVE_PULL_UP_ELITE[sex]
        relative = relative_pull_up(float(kpis["weighted_pull_up_added_kg"]), athlete.weight_kg)
        ratings.setdefault("weighted_pull_up", "poor" if relative < low * 0.85 else "excellent" if relative >= low else "good")
    if kpis.get("broad_jump_cm") is not None:
        reference = BROAD_JUMP_ELITE_CM[sex]
        jump = float(kpis["broad_jump_cm"])
        ratings.setdefault("broad_jump", "poor" if jump < reference * 0.85 else "excellent" if jump >= reference else "good")
    by_bucket: dict[str, list[str]] = {}
    kpi_buckets = {kpi: bucket for kpi, (_, bucket) in KPIS.items()}
    for kpi, rating in ratings.items():
        if kpi in kpi_buckets:
            by_bucket.setdefault(kpi_buckets[kpi], []).append(rating)
    for bucket, values in by_bucket.items():
        if "poor" in values:
            plan[bucket] = BUILD
        elif all(value == "excellent" for value in values):
            plan[bucket] = MINIMAL
    restricted = [area for area, value in (athlete.assessment.get("mobility") or {}).items() if value == "restricted"]
    if restricted:
        plan["mobility"] = BUILD
        plan["end_range_control"] = BUILD
    return plan


def mobility_profile(athlete: Athlete) -> tuple[str, list[str]]:
    """hypomobile / hypermobile / standard, plus the restricted areas (from the mobility assessment)."""
    screen = athlete.assessment.get("mobility") or {}
    restricted = [area for area, value in screen.items() if value == "restricted" and area in MOBILITY_AREAS]
    loose = [area for area, value in screen.items() if value == "hypermobile"]
    if restricted and len(restricted) >= len(loose):
        return "hypomobile", restricted
    if len(loose) >= 3 and not restricted:
        return "hypermobile", []
    return "standard", restricted


def movement_caps(athlete: Athlete) -> dict[str, int]:
    """A poor fundamental keeps every movement built on it at level 1, however strong the athlete is."""
    caps: dict[str, int] = {}
    for movement, rating in (athlete.assessment.get("movement") or {}).items():
        if rating == "poor":
            for family in MOVEMENT_ALPHABET.get(movement, ()):
                caps[family] = 1
    if (athlete.assessment.get("mobility") or {}).get("shoulder_flexion") == "restricted":
        caps["handstand"] = 1   # only after adequate shoulder flexion and torso control
    return caps


# ---------------------------------------------------------------- STEP 3: slots
@dataclass
class Context:
    athlete: Athlete
    coach: CoachSystem
    block: Block
    level: int
    equipment: frozenset[str]
    youth: bool
    tired: bool
    heavy_swim_load: bool
    buckets: dict[str, str]
    mobility: str
    restricted: list[str]
    caps: dict[str, int]
    areas: list[str]                   # stroke mobility demands
    borrowed: bool = False             # the athlete's coach has no strength system, so SwimGPT's is used


def speaker(ctx: Context) -> str:
    """Who the athlete's gym sessions speak as: their own coach, never another coach whose system is borrowed."""
    return ctx.athlete.coach if ctx.borrowed and ctx.athlete.coach else ctx.coach.coach


def context_for(athlete: Athlete, week_start: date) -> Context:
    profile, restricted = mobility_profile(athlete)
    coach = coach_system(athlete)
    areas = event_mobility_areas(athlete.events)
    if coach.t_spine_rotation == "moderate" and "t_spine_rotation" not in restricted:
        # Moderate T-spine priority (Tony): no rotation volume unless the assessment finds a restriction.
        areas = [area for area in areas if area != "t_spine_rotation"]
    return Context(
        athlete=athlete, coach=coach, block=training_block(athlete, week_start),
        level=progression_level(athlete), equipment=EQUIPMENT_BY_FACILITY[athlete.facility],
        youth=athlete.age is not None and athlete.age < YOUTH_AGE, tired=readiness_low(athlete),
        heavy_swim_load=athlete.swim_sessions >= 9, buckets=bucket_plan(athlete), mobility=profile,
        restricted=restricted, caps=movement_caps(athlete), areas=areas,
        borrowed=bool(athlete.coach) and athlete.coach != coach.coach,
    )


def pick_variant(family: Family, cap: int, equipment: frozenset[str], youth: bool) -> tuple[Variant | None, Variant | None]:
    """Hardest variant within the level cap the athlete can do with their equipment, plus the next step up."""
    usable = [variant for variant in family.variants if variant.needs <= equipment and not (youth and variant.heavy)]
    if not usable:
        return None, None
    within = [variant for variant in usable if variant.level <= cap]
    chosen = within[-1] if within else usable[0]
    later = usable[usable.index(chosen) + 1:]
    return chosen, (later[0] if later else None)


def low_end(reps: str) -> str:
    """'4–6' → '4', '20–30 sec' → '20 sec', '5–6/side' → '5/side'."""
    return re.sub(r"^(\d+)\s*[–-]\s*\d+", r"\1", reps)


def dose(slot: Slot, family: Family, ctx: Context, extra: bool, taper_dose: bool = False) -> tuple[int, str | None]:
    """Sets and reps for one slot: coach block, phase (vertical integration), buckets, readiness and swim load."""
    phase = PHASES[ctx.block.key]
    category = family.category
    sets = slot.sets + phase.dose.get(category, 0) + ctx.coach.block_dose.get(ctx.block.key, {}).get(category, 0)
    priority = ctx.buckets.get(family.bucket, MAINTAIN)
    if priority == BUILD and phase.key in ("general", "specific"):
        sets += 1
    elif priority == MINIMAL:
        sets -= 1
    if ctx.tired and category != "power":
        sets -= 1
    if ctx.heavy_swim_load and category in ("strength", "robustness", "core") and priority != BUILD:
        sets -= 1
    if extra:
        sets -= 1                         # sessions beyond the system's three are maintenance doses
    if phase.key == "taper" and not taper_dose:
        sets = min(sets, TAPER_SETS[category])
    sets = max(min(2, slot.sets), min(sets, 5))
    reps = slot.reps
    if reps and (phase.low_reps or ctx.tired):
        reps = low_end(reps)
    if reps and phase.key == "taper" and category == "power" and reps.isdigit():
        reps = str(min(int(reps), 2))
    return sets, reps


def build_exercise(slot: Slot, ctx: Context, extra: bool, taper_dose: bool = False) -> dict[str, Any] | None:
    family = FAMILIES[slot.family]
    cap = min(slot.target, ctx.level, ctx.caps.get(family.key, 3))
    if family.key in SKILL_FAMILIES and (ctx.tired or PHASES[ctx.block.key].regress_skills):
        cap = max(1, cap - 1)             # no novel or soreness-inducing progressions when fatigued or tapering
    variant, next_step = pick_variant(family, cap, ctx.equipment, ctx.youth)
    if variant is None:
        return None
    sets, reps = dose(slot, family, ctx, extra, taper_dose)
    if variant.reps and (reps is None or "sec" not in reps):
        reps = variant.reps
    steps = list(variant.steps)
    rule = slot.note or family.gate
    if rule:
        steps.append(f"Coach's rule: {rule}")
    if family.key in QUALITY_CHECKS:
        steps.append(f"Quality check: watch {QUALITY_CHECKS[family.key]}; regress the moment it breaks down.")
    if next_step and next_step.level > variant.level:
        steps.append(f"Next step: {next_step.name}, once every set is clean.")
    load = variant.load
    if ctx.youth and variant.needs & {"weights", "barbell", "trap_bar", "plate"}:
        load = "Light load only; technique before load at your age"
    return {
        "exercise": variant.name, "sets": sets, "repetitions": reps or "Quality reps", "load": load[:150],
        "rest_seconds": slot.rest, "tempo": variant.tempo, "demonstration": steps[:8], "swim_benefit": family.benefit[:300],
        "_family": family.key, "_bucket": family.bucket, "_category": family.category,
    }


# ---------------------------------------------------------------- STEP 4: warm-up personalization
def _dose_text(item: Dose) -> str:
    return f"{DRILLS[item.drill].name} {item.amount}"


def _covers(doses: list[Dose], area: str) -> bool:
    return any(DRILLS[item.drill].area == area for item in doses)


def _side(drill: str) -> str:
    """The system's usual dose for a drill added by personalization."""
    if drill in {"lat_mob", "pec_mob", "quad_mob"}:
        return "30 sec/side"
    if drill in {"ankle_df_mob", "ankle_mob", "plantar_active", "glute_bridge"}:
        return "10"
    return "8/side" if drill in {"t_spine_rotation", "hip_flexor_mob", "hip_ir_er", "hip_ir", "hip_er", "hamstring_mob",
                                 "t_spine_rotation_control", "hip_rotation_control", "hip_flexor_liftoff"} else "8"


def warm_up(template: SessionTemplate, ctx: Context) -> list[str]:
    plan = template.warm_up
    temperature = plan.temperature
    if "Assault Bike" in temperature and "bike" not in ctx.equipment:
        temperature = "5 min easy cardio (skipping, jog, rower or bike)"
    lines = [f"Temperature: {temperature}"]
    mobility = [item for item in plan.mobility
                if not (ctx.coach.t_spine_rotation == "moderate" and item.drill == "t_spine_rotation" and "t_spine_rotation" not in ctx.restricted)]
    rounds = plan.mobility_rounds
    if ctx.mobility == "hypermobile":
        # Temperature → activation → stability/control: less unnecessary passive mobility.
        lines.append(f"Activation ({plan.activation_rounds} round{'s' if plan.activation_rounds > 1 else ''}): " + " · ".join(_dose_text(item) for item in plan.activation))
        control: list[Dose] = []
        for area in [*(DRILLS[item.drill].area for item in mobility), *ctx.areas]:
            for drill in (MOBILITY_AREAS[area].control if area in MOBILITY_AREAS else ()):
                if drill not in {item.drill for item in control} and len(control) < 5:
                    control.append(Dose(drill, _side(drill)))
        lines.append("Stability/control (2 rounds): " + " · ".join(_dose_text(item) for item in control))
        return lines
    if plan.soft_tissue:
        tool = "foam roller or ball" if "roller" in ctx.equipment else "ball or hands"
        lines.append(f"Soft tissue ({tool}, 30–45 sec each): {', '.join(plan.soft_tissue)}")
    for area in [*ctx.restricted, *ctx.areas]:
        mobilize = MOBILITY_AREAS[area].mobilize if area in MOBILITY_AREAS else ()
        if mobilize and not _covers(mobility, area) and len(mobility) < 6:
            mobility.append(Dose(mobilize[-1], _side(mobilize[-1])))
    if ctx.restricted:
        rounds += 1                       # hypomobile: more time on the restricted ranges
    label = f"Mobility ({rounds} round{'s' if rounds > 1 else ''})"
    if ctx.restricted:
        label += f", extra time on {', '.join(MOBILITY_AREAS[area].label.lower() for area in ctx.restricted)}"
    lines.append(f"{label}: " + " · ".join(_dose_text(item) for item in mobility))
    lines.append(f"Activation ({plan.activation_rounds} round{'s' if plan.activation_rounds > 1 else ''}): " + " · ".join(_dose_text(item) for item in plan.activation))
    return lines


def finish(template: SessionTemplate, ctx: Context) -> list[str]:
    """Mobilize → control: end by actively owning the ranges the athlete's strokes (and restrictions) need."""
    items = list(template.finish)
    if not items and ctx.coach.key == "pete":
        return ["Nothing extra: finish while every rep still looks athletic. Everything unnecessary gets removed."]
    for area in [*ctx.restricted, *ctx.areas]:
        control = MOBILITY_AREAS[area].control if area in MOBILITY_AREAS else ()
        if control and not any(DRILLS[item.drill].area == area and DRILLS[item.drill].kind == "control" for item in items) and len(items) < 5:
            items.append(Dose(control[0], _side(control[0])))
    suffix = f" ({template.finish_rounds} rounds)" if template.finish_rounds > 1 else ""
    return [_dose_text(item) + suffix for item in items[:5]] or [CENTRAL_MOBILITY_RULE]


# ---------------------------------------------------------------- sessions
WORK_SECONDS = {"power": 12, "strength": 40, "robustness": 40, "core": 35}   # time under work per set


def _minutes(template: SessionTemplate, exercises: list[dict[str, Any]], cool: list[str]) -> int:
    plan = template.warm_up
    warm = 5 + (3 if plan.soft_tissue else 0) + 0.5 * (plan.mobility_rounds * len(plan.mobility) + plan.activation_rounds * len(plan.activation))
    work = sum(item["sets"] * (WORK_SECONDS[item["_category"]] + item["rest_seconds"]) for item in exercises) / 60
    return int(max(20, min(90, round(warm + work + len(cool) * template.finish_rounds))))


def intensity(ctx: Context, template: SessionTemplate) -> str:
    phase = PHASES[ctx.block.key].key
    if phase == "taper" or (ctx.coach.key == "pete" and template.number == 3):
        return "Minimal"
    if phase == "competition" or ctx.tired or ctx.coach.key in ("pete", "tony"):
        return "Moderate"
    return "Full"


def reasons(ctx: Context, template: SessionTemplate) -> list[str]:
    """Plain-language decisions behind the session (shown as the rationale and given to the AI writer)."""
    coach, block, phase = ctx.coach, ctx.block, PHASES[ctx.block.key]
    out = [f"{ctx.athlete.coach} has no written gym program, so your strength work follows SwimGPT's {coach.system}: {coach.character}"
           if ctx.borrowed else f"{coach.coach}'s {coach.system}: {coach.character}"]
    if block.meet:
        meet = block.meet.get("name") or "your next meet"
        when = f"race week for {meet}" if block.weeks_out == 0 else f"{block.weeks_out} week{'s' if block.weeks_out != 1 else ''} out from {meet}"
        out.append(f"{coach.mesocycle[block.key]} block: {phase.label.lower()}, {when}.")
    else:
        out.append(f"{coach.mesocycle[block.key]} block ({phase.label.lower()}): all qualities stay in, only their proportions change.")
    emphasis = f"more {', '.join(phase.more)}" if phase.more else ""
    if phase.reduce:
        emphasis += f"{'; ' if emphasis else ''}less {', '.join(phase.reduce)}"
    if emphasis:
        out.append(f"This phase: {emphasis}.")
    out.append({1: "Level 1 fundamentals: regressions until movement quality is proven.",
                2: "Level 2 strength development: more load while movement quality holds.",
                3: "Level 3: working toward the advanced athletic targets with the regression that keeps perfect position."}[ctx.level])
    built = [BUCKETS[bucket].lower() for bucket, value in ctx.buckets.items() if value == BUILD]
    if built:
        out.append(f"Priority bucket: {', '.join(built)}; strong buckets are maintained with a minimal dose.")
    if ctx.areas:
        out.append(f"Mobility for your strokes: {', '.join(MOBILITY_AREAS[area].label.lower() for area in ctx.areas[:3])}.")
    if ctx.tired:
        out.append("Recent check-ins show low readiness, so volume is reduced and skills are regressed.")
    if ctx.heavy_swim_load:
        out.append("High swim volume: accessory volume trimmed for a better stimulus-to-fatigue ratio.")
    return out


def coaching_notes(ctx: Context, template: SessionTemplate) -> str:
    notes = [ctx.coach.feel, *ctx.coach.rules, *template.notes, QUALITY_RULES]
    if any(value != MAINTAIN for bucket, value in ctx.buckets.items() if bucket not in ("mobility", "end_range_control")):
        notes.append(PROGRAMMING_RULE)
    notes += [MOBILITY_AREAS[area].rule for area in ctx.restricted]
    if ctx.tired or ctx.heavy_swim_load or PHASES[ctx.block.key].key in ("competition", "taper"):
        notes.append(STIMULUS_TO_FATIGUE)
    if ctx.youth:
        notes.append("Technique before load: no maximal lifting at your age, and jumps stay low in volume.")
    return " ".join(dict.fromkeys(notes))[:2000]


@dataclass
class PlannedSession:
    day: date
    kind: str                          # "strength" | "mobility"
    workout: dict[str, Any]            # GymWorkout-shaped
    focus: str
    meta: dict[str, Any]
    brief: dict[str, Any]              # what the AI writer may phrase (never changes the prescription)


def strength_session(day: date, template: SessionTemplate, ctx: Context, extra: bool = False) -> PlannedSession:
    phase = PHASES[ctx.block.key]
    exercises = [item for item in (build_exercise(slot, ctx, extra, template.taper_dose) for slot in template.main) if item]
    if template.optional and phase.optional_finisher and not ctx.tired:
        bonus = build_exercise(template.optional, ctx, extra)
        if bonus:
            bonus["sets"] = min(bonus["sets"], template.optional.sets)   # optional work is never dosed up
            exercises.append(bonus)
    if "shoulder_external_rotation" in ctx.restricted and not any(item["_family"] == "scap_cuff" for item in exercises):
        # Restricted external rotation: mobilize carefully → control the range → add rotator-cuff work.
        cuff = build_exercise(Slot("scap_cuff", 2, "10–12", 45, note="Added for restricted external rotation: strengthen and control the available range."), ctx, extra)
        if cuff:
            exercises.append(cuff)
    warm, cool = warm_up(template, ctx), finish(template, ctx)
    why = reasons(ctx, template)
    workout = {
        "title": f"{template.title}"[:150],
        "objective": f"{template.focus}. {ctx.coach.mesocycle[ctx.block.key]} block, {phase.label.lower()}."[:1000],
        "rationale": " ".join(why)[:1000],
        "intensity": intensity(ctx, template),
        "estimated_duration_minutes": _minutes(template, exercises, cool),
        "warm_up": warm[:6], "exercises": [{k: v for k, v in item.items() if not k.startswith("_")} for item in exercises][:10],
        "cool_down": cool[:5], "coaching_notes": coaching_notes(ctx, template),
    }
    meta = {"system": SOURCE_LABEL, "coach": ctx.coach.coach, "session": f"{ctx.coach.key}-{template.number}", "block": ctx.block.key,
            "block_label": ctx.coach.mesocycle[ctx.block.key], "phase": phase.label, "level": ctx.level,
            "buckets": {bucket: value for bucket, value in ctx.buckets.items() if value != MAINTAIN},
            "mobility_profile": ctx.mobility, "readiness": "low" if ctx.tired else "normal",
            "families": [item["_family"] for item in exercises]}
    brief = {"coach": speaker(ctx), "identity": ctx.coach.character, "feel": ctx.coach.feel, "philosophy": ctx.coach.philosophy,
             "objective": ctx.coach.objective, "programming_rule": PROGRAMMING_RULE,
             "session": template.title, "focus": template.focus, "block": ctx.coach.mesocycle[ctx.block.key], "phase": phase.label,
             "decisions": why, "exercises": [f"{item['exercise']} {item['sets']}×{item['repetitions']}" for item in exercises]}
    return PlannedSession(day, "strength", workout, template.focus, meta, brief)


def mobility_session(day: date, ctx: Context) -> PlannedSession:
    routine = ctx.coach.mobility
    drills = list(routine.drills)
    for area in [*ctx.restricted, *ctx.areas]:
        mobilize = MOBILITY_AREAS[area].mobilize if area in MOBILITY_AREAS else ()
        if mobilize and not _covers(drills, area):
            drills.append(Dose(mobilize[-1], _side(mobilize[-1])))
    then = list(routine.then)
    if ctx.coach.t_spine_rotation == "very high" and not any(item.drill == "t_spine_rotation_control" for item in [*drills, *then]):
        then.append(Dose("t_spine_rotation_control", "8/side"))   # T-spine mobilization → active rotational control
    if ctx.mobility == "hypermobile":
        # Less passive range for an already mobile swimmer: own the range instead of chasing more of it.
        swapped: list[Dose] = []
        for item in drills:
            area = DRILLS[item.drill].area
            control = MOBILITY_AREAS[area].control[0] if area in MOBILITY_AREAS and MOBILITY_AREAS[area].control else item.drill
            if control not in {entry.drill for entry in swapped}:
                swapped.append(Dose(control, item.amount if control == item.drill else _side(control)))
        drills = swapped
    then = [item for item in then if item.drill not in {entry.drill for entry in drills}]
    exercises = []
    for item, rounds in [*((item, routine.rounds) for item in drills), *((item, 1) for item in then)][:10]:
        drill = DRILLS[item.drill]
        area = MOBILITY_AREAS.get(drill.area or "")
        exercises.append({
            "exercise": drill.name, "sets": rounds, "repetitions": item.amount, "load": "Bodyweight",
            "rest_seconds": 15, "tempo": "Slow and controlled", "demonstration": list(drill.steps),
            "swim_benefit": f"{area.label}: {area.why}." if area else "Prepares the body to move well in the water.",
        })
    focus = ", ".join(MOBILITY_AREAS[area].label for area in ctx.areas[:2]) or "full-body ranges"
    workout = {
        "title": f"{routine.title}", "objective": f"{routine.minutes} of mobility focused on {focus.lower()}.",
        "rationale": (f"Mobility on a non-gym day from SwimGPT's {ctx.coach.system}. {routine.note}" if ctx.borrowed
                      else f"{ctx.coach.coach}'s mobility on a non-gym day. {routine.note}"),
        "intensity": "Minimal", "estimated_duration_minutes": 15,
        "warm_up": ["Temperature: 3 min easy movement (skipping, jog or bike)"],
        "exercises": exercises, "cool_down": [CENTRAL_MOBILITY_RULE],
        "coaching_notes": "Move slowly and never force a range. " + (
            "You are already mobile, so this session is about owning your end range, not stretching further." if ctx.mobility == "hypermobile"
            else "Finish by actively controlling each newly available range."),
    }
    meta = {"system": SOURCE_LABEL, "coach": ctx.coach.coach, "session": f"{ctx.coach.key}-mobility", "block": ctx.block.key,
            "mobility_profile": ctx.mobility}
    return PlannedSession(day, "mobility", workout, f"Mobility: {focus}", meta, {})


# ---------------------------------------------------------------- the week
def plan_week(athlete: Athlete, week_start: date, open_days: list[date], today: date, kept_strength: int = 0) -> list[PlannedSession]:
    """Strength & Mobility sessions on spread-out days, the coach's mobility routine on the other open days.

    A part-week (e.g. the week the athlete signs up) gets a pro-rated number of sessions; nothing hard lands on race
    day or the two days before it; the competition and taper blocks cap the number of sessions.
    """
    ctx = context_for(athlete, week_start)
    phase = PHASES[ctx.block.key]
    remaining = sum(1 for index in range(7) if week_start + timedelta(days=index) >= today)
    wanted = athlete.gym_sessions if remaining >= 7 else round(athlete.gym_sessions * remaining / 7)
    if athlete.gym_sessions and remaining and not wanted:
        wanted = 1
    wanted = max(0, wanted - kept_strength)
    if phase.max_sessions is not None:
        wanted = min(wanted, phase.max_sessions)
    meet_days = {date.fromisoformat(meet["date"]) for meet in athlete.competitions if meet.get("priority") in COMPETITION_PRIORITIES}
    race_days = {meet - timedelta(days=offset) for meet in meet_days for offset in range(NO_GYM_DAYS_BEFORE_MEET + 1)}
    eligible = [day for day in open_days if day not in race_days]
    wanted = min(wanted, len(eligible))
    strength_days = [eligible[int(index * len(eligible) / wanted)] for index in range(wanted)] if wanted else []
    order = ctx.coach.preference[ctx.block.key]
    numbers = sorted(order[index % len(order)] for index in range(wanted))
    sessions = []
    for index, (day, number) in enumerate(zip(strength_days, numbers)):
        sessions.append(strength_session(day, ctx.coach.sessions[number], ctx, extra=index >= 3))
    for day in open_days:
        if day not in strength_days and day not in meet_days:
            sessions.append(mobility_session(day, ctx))
    return sorted(sessions, key=lambda session: session.day)
