"""What the athlete did with their plan: the swims and gym workouts on their weeks, and which ones they ticked off.

It's read from the records the weeks already keep (week plans, the athlete's own swims and workouts, ticks and meets,
each saved with its day), so nothing new is saved and nothing saved changes:
- coach_weeks: the athlete's last week, this week and next week, as the coach chat is given them (main._coach_messages),
  so their coach can answer "how did my week go?" or "what's my swim today?";
- recent_training: how their swims have gone over the last two weeks, for everything the coach writes
  (training.build_grounding) and for planning a swim week (week_load): a week planned after many missed swims eases the
  athlete back in, trimming each of the coach's sessions (training._write_week), until they're swimming regularly again.

A swim ticked off was done. One that isn't may still have been done: most athletes don't tick their swims off at all. So
unticked swims only count as missed for an athlete who has shown they tick theirs off (a week with most of its swims
ticked off, HABIT). For anyone else a week is planned as it always was, and the coach is told not to assume.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from app import training
from app.today import DailyPlan

logger = logging.getLogger(__name__)

# The records a day's training is read from: plans (weekly, and older daily ones), the athlete's own swims, gym workouts,
# ticks (swims, strength and gym workouts, mobility) and meets.
KINDS = ["week_plan", "daily_plan", "workout", "swim", "strength", "mobility", "gym_workout", "competition"]
RECENT_DAYS = 14        # the swims that say how training has gone lately
HABIT_WEEKS = 6         # the weeks (this one included) that can show the athlete ticks their swims off
HABIT = (0.6, 2)        # ...by a week with at least this share of its swims ticked off, and at least this many
FEW_SWIMS = 3           # fewer swims planned lately than this say nothing either way
# Easing a week back in: (the share of recent swims ticked off below which it eases, the share of each of the coach's
# sessions it keeps), most missed first. From half of them ticked off, the week is planned in full.
EASING = ((0.3, 0.75), (0.5, 0.85))


def records_between(profile_id: str, start: date, end: date, kinds: list[str] = KINDS) -> list[dict[str, Any]]:
    """The athlete's records of `kinds` dated from `start` up to (not including) `end`, read as training.load_records
    reads them."""
    rows: list[dict[str, Any]] = []
    while True:
        batch = (training.get_supabase_client().table("user_training_sessions").select("*")
                 .eq("user_id", profile_id).in_("session_type", kinds)
                 .gte("session_date", f"{start}T00:00:00+00:00").lt("session_date", f"{end}T00:00:00+00:00")
                 .order("created_at").order("id").range(len(rows), len(rows) + 499).execute()).data or []
        rows += batch
        if len(batch) < 500:
            return rows


def _day(row: dict[str, Any]) -> str:
    return (row.get("session_date") or "")[:10]


def read_training(profile, start: date, end: date) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Each day from `start` up to `end` (not included) as the athlete's weeks have it, and the swim weeks generated in
    those days by their Monday ({date: training.WeekPlan}). A day has its swims and gym workouts (each with whether it was
    ticked off), the strength session of an older week's plan, its mobility, its meets, and whether it's a rest day."""
    records = records_between(profile["id"], start, end)
    weeks = {_day(row): training.WeekPlan.model_validate(row["details"]["plan"]) for row in records if row["session_type"] == "week_plan"}
    planned = {day.date.isoformat(): day for week in weeks.values() for day in week.days}
    daily = {_day(row): DailyPlan.model_validate(row["details"]["plan"]) for row in records if row["session_type"] == "daily_plan"}
    swims = training.library(profile, records)
    gym = training.gym_items(profile["id"], records, start, end)
    strength_ticked = {_day(row) for row in records if row["session_type"] == "strength" and not row["details"].get("gym_key")
                       and row["details"].get("completion_status") == "completed"}
    mobility_ticked = {row["id"] for row in records if row["session_type"] == "mobility"}
    meets: dict[str, list[dict[str, Any]]] = {}
    for row in records:
        if row["session_type"] == "competition":
            meets.setdefault(_day(row), []).append(row["details"].get("competition") or {})
    days = []
    for offset in range((end - start).days):
        day = (start + timedelta(days=offset)).isoformat()
        plan, older = planned.get(day), daily.get(day)
        strength = plan.strength if plan else older.strength if older else None
        mobility = plan.mobility if plan else older.mobility if older else []
        day_swims = [{"title": item["workout"]["title"], "meters": item["distance_meters"],
                      "minutes": item["workout"]["estimated_duration_minutes"], "done": item["completed"],
                      "own": item["origin"] == "My workout", "workout": item["workout"]}
                     for item in swims if item["date"] == day]
        days.append({
            "date": day, "swims": day_swims,
            "gym": [{"title": item["workout"]["title"], "minutes": item["workout"].get("estimated_duration_minutes"),
                     "done": item["completed"], "mobility": str(item["focus"]).startswith("Mobility"), "workout": item["workout"]}
                    for item in gym if item["date"] == day],
            "strength": {"title": strength.title, "minutes": strength.estimated_duration_minutes, "done": day in strength_ticked} if strength else None,
            "mobility": {"minutes": sum(item.duration_minutes for item in mobility),
                         "done": training.record_id(profile["id"], f"mobility-completed:{day}") in mobility_ticked} if mobility else None,
            "rest": bool(plan and plan.rest and not day_swims),
            "meets": meets.get(day, []),
        })
    return days, weeks


def _counted(days: list[dict[str, Any]], today: date, part: str = "swims") -> list[dict[str, Any]]:
    """The days' swims (or gym workouts) that count toward what was done: those of days that are over, and today's once
    they're ticked off (a swim still ahead today isn't missed)."""
    return [item for day in days for item in day[part] if day["date"] < today.isoformat() or item["done"]]


def _ticked(day: dict[str, Any]) -> bool:
    """Whether the athlete ticked anything off on the day: a swim, a gym workout, a strength session or mobility."""
    return (any(item["done"] for item in [*day["swims"], *day["gym"]])
            or any(part and part["done"] for part in (day["strength"], day["mobility"])))


def from_first_tick(days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`days` from the first one the athlete ticked anything off on: before they started ticking sessions off, one that
    isn't ticked off says nothing about whether it was done. All of them when they never ticked anything off."""
    first = next((index for index, day in enumerate(days) if _ticked(day)), 0)
    return days[first:]


def ticks_swims(days: list[dict[str, Any]], today: date) -> bool:
    """Whether the athlete ticks their swims off: a week of `days` with most of its swims ticked off (HABIT)."""
    weeks: dict[str, list[dict[str, Any]]] = {}
    for day in days:
        monday = date.fromisoformat(day["date"]) - timedelta(days=date.fromisoformat(day["date"]).weekday())
        weeks.setdefault(monday.isoformat(), []).append(day)
    for week in weeks.values():
        swims = _counted(week, today)
        done = sum(item["done"] for item in swims)
        if done >= HABIT[1] and done >= HABIT[0] * len(swims):
            return True
    return False


def _totals(swims: list[dict[str, Any]]) -> str:
    done = [item for item in swims if item["done"]]
    return (f"{len(done)} of {len(swims)} swim{'s' if len(swims) != 1 else ''} ticked off "
            f"({sum(item['meters'] for item in done):,} of {sum(item['meters'] for item in swims):,} m)")


NOT_TICKED = {True: "They tick their swims off (most of a week's swims ticked off), so a past swim that isn't ticked off was most likely missed.",
              False: "They don't tick every swim off, so a past swim that isn't ticked off may still have been done: never assume it was missed."}


def recent_training(profile, today: date) -> dict[str, Any]:
    """How the athlete's swims have gone over the last RECENT_DAYS days (or since they started ticking sessions off, when
    that's more recent: see from_first_tick): `planned` and `done` (swims), `ticks` (whether they tick their swims off, see
    ticks_swims), `ease` (the share of each of the coach's sessions a swim week planned now keeps, see EASING: 1 is all
    of it), `period` (the days counted, in words) and `text`, what the coach is given about it (empty when no swim was
    planned lately). Never fails: when the records can't be read, it says nothing and eases nothing."""
    try:
        return _recent_training(profile, today)
    except Exception:
        logger.exception("Couldn't read the recent training of %s; it's planned as usual", profile.get("id"))
        return {"planned": 0, "done": 0, "ticks": False, "ease": 1.0, "period": f"over the last {RECENT_DAYS} days", "text": ""}


def _recent_training(profile, today: date) -> dict[str, Any]:
    monday = today - timedelta(days=today.weekday())
    start = monday - timedelta(weeks=HABIT_WEEKS - 1)
    days, _ = read_training(profile, start, today + timedelta(days=1))
    days = from_first_tick(days)
    since = (today - timedelta(days=RECENT_DAYS)).isoformat()
    recent = [day for day in days if day["date"] >= since]
    swims, gym = _counted(recent, today), _counted(recent, today, "gym")
    ticks = ticks_swims(days, today)
    done = sum(item["done"] for item in swims)
    ease = 1.0
    if ticks and len(swims) >= FEW_SWIMS:
        ease = next((kept for below, kept in EASING if done < below * len(swims)), 1.0)
    # Counted over the last RECENT_DAYS days, or since the athlete started ticking sessions off when that's more recent.
    period = (f"over the last {RECENT_DAYS} days" if not recent or recent[0]["date"] <= since else
              f"since {_when(recent[0]['date'])}, when they started ticking sessions off")
    text = ""
    if swims:
        gym_done = sum(item["done"] for item in gym)
        text = (f"RECENT TRAINING (what the athlete ticked off of their swim and gym weeks in SwimGPT {period}): {_totals(swims)}"
                + (f"; {gym_done} of {len(gym)} gym workout{'s' if len(gym) != 1 else ''} ticked off" if gym else "")
                + f". {NOT_TICKED[ticks]}")
    return {"planned": len(swims), "done": done, "ticks": ticks, "ease": ease, "period": period, "text": text}


def week_load(recent: dict[str, Any], week_start: date, today: date, taper: bool) -> tuple[float, str]:
    """The share of each of the coach's sessions a swim week starting `week_start` keeps (the athlete's recent `ease`, see
    recent_training) and the line its writing is given about their recent swims. Only this week and next ease back in
    (a week further ahead is planned in full: they may well be swimming regularly by then), and never a taper week (the
    coach's taper sessions are kept as written)."""
    planned, done = recent.get("planned", 0), recent.get("done", 0)
    period = recent.get("period") or f"over the last {RECENT_DAYS} days"
    this_week = today - timedelta(days=today.weekday())
    if recent.get("ease", 1.0) < 1 and not taper and week_start <= this_week + timedelta(weeks=1):
        ease = recent["ease"]
        return ease, (f"EASING BACK IN: the athlete ticked off only {done} of the {planned} swims planned {period}, and they tick "
                      f"their swims off, so most of the others were missed. Each of the coach's sessions this week is trimmed to about "
                      f"{round(ease * 100)}% of what it would be, mostly from the main set's repetitions and rounds (each swim's lines "
                      "already show the cut). The coaching note says so in one short, encouraging sentence (the full sessions come "
                      "back once they're swimming regularly again). Never make up the missed swims.")
    if recent.get("ticks") and planned >= FEW_SWIMS and recent.get("ease", 1.0) >= 1:
        return 1.0, (f"Recent training: the athlete ticked off {done} of the {planned} swims planned {period}: they're swimming "
                     "consistently, so the week has the coach's full sessions.")
    return 1.0, ""


# ---------------------------------------------------------------- the coach chat's view of the athlete's weeks
def _when(day: str) -> str:
    value = date.fromisoformat(day)
    return f"{value:%a} {value.day} {value:%b}"


def _status(done: bool, day: str, today: date) -> str:
    """How a session stands: done, or not ticked off (yet, on today); nothing for one still ahead."""
    if day > today.isoformat():
        return ""
    return ", done" if done else ", not ticked off yet" if day == today.isoformat() else ", not ticked off"


def _day_line(day: dict[str, Any], today: date) -> str:
    parts = [f"meet: {meet.get('name') or 'a meet'}" + (f" ({meet['priority']} priority)" if meet.get("priority") else "")
             for meet in day["meets"]]
    parts += [f"swim{' (their own)' if item['own'] else ''} \"{item['title']}\", {item['meters']:,} m, {item['minutes']} min"
              f"{_status(item['done'], day['date'], today)}" for item in day["swims"]]
    if day["strength"]:
        parts.append(f"strength session \"{day['strength']['title']}\", {day['strength']['minutes']} min"
                     f"{_status(day['strength']['done'], day['date'], today)}")
    parts += [f"gym {'mobility ' if item['mobility'] else ''}workout \"{item['title']}\""
              + (f", {item['minutes']} min" if item["minutes"] else "") + _status(item["done"], day["date"], today)
              for item in day["gym"]]
    if day["mobility"]:
        parts.append(f"mobility, {day['mobility']['minutes']} min{_status(day['mobility']['done'], day['date'], today)}")
    if day["rest"] and not day["gym"]:
        parts.insert(0, "rest day")     # the swim week's rest days keep their mobility (the gym week is its own)
    return f"- {_when(day['date'])}{' (today)' if day['date'] == today.isoformat() else ''}: {'; '.join(parts) or 'nothing planned'}"


def _set_line(number: int, item: dict[str, Any]) -> str:
    rounds = f"{item['rounds']} rounds of " if item["rounds"] > 1 else ""
    repetitions = f"{item['repetitions']} x " if item["repetitions"] > 1 else ""
    target = f", target {item['target_time']}" if item.get("target_time") else ""
    gear = f", with {', '.join(item['equipment'])}" if item.get("equipment") else ""
    return (f"  {number}. {item['name']}: {rounds}{repetitions}{item['distance_meters']} m {item['stroke']}, {item['interval']}, "
            f"{item['training_zone']}{target}{gear}")


def _exercise_line(number: int, item: dict[str, Any]) -> str:
    load = f", {item['load']}" if item.get("load") and item["load"] != "—" else ""
    rest = f", rest {item['rest_seconds']} s" if item.get("rest_seconds") else ""
    return f"  {number}. {item.get('exercise')} {item.get('sets')} x {item.get('repetitions')}{load}{rest}"


def _today_in_full(day: dict[str, Any], today: date) -> list[str]:
    lines = []
    for item in day["swims"]:
        lines.append(f"Swim \"{item['title']}\" ({item['meters']:,} m, {item['minutes']} min{_status(item['done'], day['date'], today)}):")
        lines += [_set_line(number, set_) for number, set_ in enumerate(item["workout"]["sets"], start=1)]
    for item in day["gym"]:
        lines.append(f"Gym {'mobility ' if item['mobility'] else ''}workout \"{item['title']}\"{_status(item['done'], day['date'], today)}:")
        lines += [_exercise_line(number, exercise) for number, exercise in enumerate(item["workout"].get("exercises") or [], start=1)]
    return lines


def coach_weeks(profile, today: date) -> str:
    """The athlete's last week, this week and next week for the coach chat: each day's sessions and whether they were
    ticked off, what each week came to, and today's sessions in full. Empty when they can't be read just now (the coach
    then answers without them, as before)."""
    try:
        return _coach_weeks(profile, today)
    except Exception:
        logger.exception("Couldn't read the training weeks of %s for the coach", profile.get("id"))
        return ""


def _coach_weeks(profile, today: date) -> str:
    monday = today - timedelta(days=today.weekday())
    days, weeks = read_training(profile, monday - timedelta(weeks=1), monday + timedelta(weeks=2))
    lines = [f"THE ATHLETE'S TRAINING IN SWIMGPT (today is {today:%A} {today.day} {today:%B %Y}): their swim and gym weeks, "
             "and what they ticked off. \"done\" means they ticked it off. " + NOT_TICKED[ticks_swims(from_first_tick(days), today)]]
    for number, name in enumerate(("LAST WEEK", "THIS WEEK", "NEXT WEEK")):
        week = days[number * 7:number * 7 + 7]
        start = week[0]["date"]
        plan = weeks.get(start)
        about = [f"{_when(start)} to {_when(week[-1]['date'])}"]
        if plan:
            about.append(f"phase: {plan.phase}")
            if name == "THIS WEEK":
                about.append(f"the coach's note for it: \"{plan.coaching_note}\"")
        swims, gym = _counted(week, today), _counted(week, today, "gym")
        so_far = "so far " if name == "THIS WEEK" else ""
        summary = []
        if swims:
            summary.append(so_far + _totals(swims))
        if gym:
            summary.append(f"{so_far}{sum(item['done'] for item in gym)} of {len(gym)} gym workout{'s' if len(gym) != 1 else ''} ticked off")
        if not plan and not any(day["swims"] for day in week):
            summary.append("no swim week was generated for it" if name == "LAST WEEK" else "its swim week isn't generated yet")
        empty = not any(day["swims"] or day["gym"] or day["strength"] or day["mobility"] or day["meets"] for day in week)
        if empty:
            summary.append("nothing was planned on it" if name == "LAST WEEK" else "nothing is planned on it yet")
        lines.append(f"{name} ({'; '.join(about)})" + (f": {'; '.join(summary)}." if summary else ":"))
        lines += [] if empty else [_day_line(day, today) for day in week]
    today_full = _today_in_full(next(day for day in days if day["date"] == today.isoformat()), today)
    if today_full:
        lines += ["TODAY'S SESSIONS IN FULL:", *today_full]
    return "\n".join(lines)
