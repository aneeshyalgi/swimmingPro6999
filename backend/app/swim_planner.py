"""Which coach session each swim of the week is: the coach's own weekly order and session library, chosen in code.

  * the athlete's coach's weekly order for their number of swims sets the week;
  * each session type rotates through that coach's numbered sessions from week to week;
  * within two weeks of an A or B meet the coach's written taper sessions are used where they exist.
The AI then adapts each chosen session to the athlete (main stroke, pace, pool, time) without changing what it trains.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from app.coach_programs import (
    CoachProgram, SessionLine, program_for, render_session, session_label, session_lines, session_volume, swim_order,
)
from app.coach_sessions import Session

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


def assign_week(coach_name: str, week_start: date, swims: int, taper: bool = False) -> list[SwimAssignment]:
    """The coach session for each of the week's swims, in the coach's weekly order."""
    coach = program_for(coach_name)
    if coach is None or swims <= 0:
        return []
    week_number = week_start.isocalendar()[1]
    seen: dict[str, int] = {}
    assignments = []
    for kind in swim_order(coach, swims):
        occurrence = seen.get(kind, 0)
        seen[kind] = occurrence + 1
        pool = coach.sessions_of(kind, taper)
        use_taper = taper and any(item.type == kind for item in coach.taper)
        session = pool[(week_number + occurrence) % len(pool)]
        assignments.append(SwimAssignment(coach, session, use_taper))
    return assignments


def session_parts(session: Session, size: int = 5) -> list[tuple[SessionLine, ...]]:
    """The session's lines in balanced, consecutive parts of about `size` swims each, so a long session can be written
    in parts at the same time. A note or rest after a swim stays with it; block headers ("3 rounds:") and a section's
    opening note go with the swim that follows. A session of up to `size + 1` swims is one part."""
    units: list[list[SessionLine]] = []
    leading: list[SessionLine] = []
    for line in session_lines(session):
        if line.meters > 0:
            units.append(leading + [line])
            leading = []
        elif line.header or not units or units[-1][-1].section != line.section:
            leading.append(line)
        else:
            units[-1].append(line)
    if leading and units:
        units[-1] += leading
    if len(units) <= size + 1:
        return [tuple(line for unit in units for line in unit)] if units else []
    count = -(-len(units) // size)
    sizes = [len(units) // count + (1 if index < len(units) % count else 0) for index in range(count)]
    parts, start = [], 0
    for length in sizes:
        parts.append(tuple(line for unit in units[start:start + length] for line in unit))
        start += length
    return parts


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
