"""Which coach session each swim of the week is: the coaches' own weekly order and session library, chosen in code.

The athlete's two coaches share the week:
  * the lead coach's weekly order for the athlete's number of swims is the backbone;
  * the second coach takes evenly spaced days: in proportion to the athlete's events only they cover, otherwise one
    day in three (their methods complement the lead coach), using the opening sessions of their own weekly order;
  * each session type rotates through that coach's numbered sessions from week to week;
  * within two weeks of an A or B meet the coach's written taper sessions are used where they exist.
The AI then adapts each chosen session to the athlete (main stroke, pace, pool, time) without changing what it trains.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from app.coach_programs import CoachProgram, render_session, session_label, session_volume, swim_order
from app.coach_sessions import Session
from app.context import resolve_coaches

TAPER_WINDOW_DAYS = 13          # taper sessions for meets in this week or the next
TAPER_PRIORITIES = ("A", "B")


@dataclass(frozen=True)
class SwimAssignment:
    coach: CoachProgram
    session: Session
    taper: bool

    @property
    def label(self) -> str:
        return session_label(self.coach, self.session, self.taper)

    @property
    def volume(self) -> int:
        return session_volume(self.session)

    def render(self) -> str:
        return render_session(self.coach, self.session, self.taper)


def taper_meet(competitions: list[dict[str, Any]], week_start: date) -> dict[str, Any] | None:
    window_end = (week_start + timedelta(days=TAPER_WINDOW_DAYS)).isoformat()
    meets = [meet for meet in competitions if meet.get("priority") in TAPER_PRIORITIES
             and week_start.isoformat() <= str(meet.get("date", "")) <= window_end]
    return min(meets, key=lambda meet: meet["date"]) if meets else None


def second_coach_days(events: list[str], lead: CoachProgram, second: CoachProgram | None, swims: int) -> int:
    if second is None or swims < 3:
        return 0
    only_second = [event for event in events if event in second.main_events and event not in lead.main_events]
    if only_second:
        share = round(swims * len(only_second) / max(1, len(events)))
        return min(max(1, share), swims // 2)
    return swims // 3


def assign_week(coach_names: list[str], events: list[str], week_start: date, swims: int, taper: bool = False) -> list[SwimAssignment]:
    """The coach session for each of the week's swims, in order."""
    programs = resolve_coaches(coach_names)
    if not programs or swims <= 0:
        return []
    lead, second = programs[0], programs[1] if len(programs) > 1 else None
    plan = [(lead, kind) for kind in swim_order(lead, swims)]
    extra = second_coach_days(events, lead, second, swims)
    if extra and second:
        positions = [int((index + 0.5) * swims / extra) for index in range(extra)]
        for position, kind in zip(positions, swim_order(second, extra)):
            plan[position] = (second, kind)
    week_number = week_start.isocalendar()[1]
    seen: dict[tuple[str, str], int] = {}
    assignments = []
    for coach, kind in plan:
        occurrence = seen.get((coach.key, kind), 0)
        seen[(coach.key, kind)] = occurrence + 1
        pool = coach.sessions_of(kind, taper)
        use_taper = taper and any(item.type == kind for item in coach.taper)
        session = pool[(week_number + occurrence) % len(pool)]
        assignments.append(SwimAssignment(coach, session, use_taper))
    return assignments


def main_strokes(events: list[str]) -> list[str]:
    """MS #1, #2, #3: the athlete's strokes in the order of their events (IM swimmers keep all four)."""
    strokes: list[str] = []
    for event in events:
        stroke = event.split(" ", 1)[-1]
        if stroke == "IM":
            candidates = ["Butterfly", "Backstroke", "Breaststroke", "Freestyle"]
        else:
            candidates = [stroke]
        strokes += [item for item in candidates if item not in strokes]
    return strokes or ["Freestyle"]
