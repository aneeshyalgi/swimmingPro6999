"""The five coach programs, encoded from the coach PDFs (Coach Brad / Pete / Timothy / Robert / Tony).

This module and coach_sessions.py are the single source of coaching knowledge: every generation, the coach chat and
the coach profiles read them. No PDF, Supabase storage or embedding search is involved at runtime.

What each coach wrote down is kept as written: the session types ("variables"), main events, the weekly order for
every number of sessions, equipment, explanations, coaching rules, effort levels and every plan/taper session.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.coach_sessions import SESSIONS, Session

STROKES = ("Freestyle", "Backstroke", "Breaststroke", "Butterfly")


def _events(distance: int) -> tuple[str, ...]:
    return tuple(f"{distance}m {stroke}" for stroke in STROKES)


@dataclass(frozen=True)
class CoachProgram:
    key: str
    name: str
    heading: str                                   # the coach's own description of the program
    inspired_by: str | None
    variables: tuple[str, ...]                     # session types, as listed by the coach
    main_events: tuple[str, ...]
    weekly_orders: dict[int, tuple[str, ...]]      # sessions per week -> session order
    equipment: tuple[str, ...]
    explanations: tuple[tuple[str, str], ...]      # term -> meaning
    rules: tuple[str, ...]                         # coaching rules and philosophy, as written
    effort_levels: tuple[tuple[str, str], ...] = ()  # level -> definition
    cycle: tuple[str, ...] = ()                    # Timothy: a session cycle instead of weekly orders
    non_swim_types: tuple[str, ...] = ()           # session types that are not swims (Timothy's Gym)

    @property
    def sessions(self) -> tuple[Session, ...]:
        return SESSIONS[self.key]["plan"]

    @property
    def taper(self) -> tuple[Session, ...]:
        return SESSIONS[self.key]["taper"]

    def sessions_of(self, type_: str, taper: bool = False) -> tuple[Session, ...]:
        pool = self.taper if taper and any(item.type == type_ for item in self.taper) else self.sessions
        return tuple(item for item in pool if item.type == type_)


BRAD = CoachProgram(
    key="brad", name="Coach Brad", heading="50 and 100 Stroke Sprint Coach", inspired_by="Brett Hawke",
    variables=("Power", "50 Race Pace", "100 Race Pace", "Aerobic/Recovery", "Resistance"),
    main_events=_events(50) + _events(100),
    weekly_orders={
        4: ("Power", "50 Race Pace", "Resistance", "100 Race Pace"),
        5: ("Power", "50 Race Pace", "Aerobic/Recovery", "Resistance", "100 Race Pace"),
        6: ("Power", "50 Race Pace", "Aerobic/Recovery", "Resistance", "100 Race Pace", "Aerobic/Recovery"),
        7: ("Power", "50 Race Pace", "Aerobic/Recovery", "Resistance", "100 Race Pace", "Aerobic/Recovery", "Power"),
        8: ("Power", "50 Race Pace", "Aerobic/Recovery", "Resistance", "100 Race Pace", "Aerobic/Recovery", "Power", "Resistance"),
        9: ("Power", "50 Race Pace", "Aerobic/Recovery", "Resistance", "100 Race Pace", "Aerobic/Recovery", "Power", "50 Race Pace", "Resistance"),
    },
    equipment=("Kickboard", "Fins", "Buoy", "Paddles", "Big parachute", "Small parachute", "Drag socks"),
    explanations=(("MS", "Main Stroke"), ("Pull", "Freestyle pull with buoy and paddles"), ("Build", "Get faster through each 50"),
                  ("FES", "Front End Speed (the first 50 of a 100)"), ("BES", "Back End Speed (the second 50 of a 100)"),
                  ("Dive", "From the blocks"), ("Uw", "Underwater"), ("Cruise back to wall", "Easy swim back to the wall after the effort")),
    rules=("Power and resistance efforts are maximal over 15-25 m, cruising back to the wall between efforts.",
           "The 100 is trained in parts: Front End Speed (first 50 / first 25 from a dive) and Back End Speed (second 50 from a push).",
           "Race-pace sessions may be swum suited (optional) and from a dive; parachutes and drag socks add resistance.",
           "Resistance sessions include 100 stroke-rate and breathing-pattern work."),
)

PETE = CoachProgram(
    key="pete", name="Coach Pete", heading="USRPT Coach", inspired_by="Ultra Short Race Pace Training (Dr. Brent Rushall)",
    variables=("Overspeed", "50 Pace", "100 Pace", "200 Pace"),
    main_events=_events(50) + _events(100),
    weekly_orders={
        4: ("Overspeed", "50 Pace", "100 Pace", "200 Pace"),
        5: ("Overspeed", "50 Pace", "100 Pace", "Overspeed", "200 Pace"),
        6: ("Overspeed", "50 Pace", "100 Pace", "200 Pace", "Overspeed", "50 Pace"),
        7: ("Overspeed", "50 Pace", "100 Pace", "200 Pace", "Overspeed", "50 Pace", "100 Pace"),
        8: ("Overspeed", "50 Pace", "100 Pace", "200 Pace", "Overspeed", "50 Pace", "100 Pace", "200 Pace"),
    },
    equipment=("Tech suit (Overspeed sessions)", "Fins (warm-down only)"),
    explanations=(("MS #1", "Your first main stroke (best stroke)"), ("MS #2", "Your second main stroke (2nd best stroke)"),
                  ("MS #3", "Your third main stroke (3rd best stroke)")),
    rules=(
        "USRPT prioritises the Principle of Specificity: to swim fast in a race, train at that exact race pace to get the neuromuscular adaptations.",
        "Individualised sets: each set is built from the swimmer's specific goal time for that race.",
        "Short repetitions (typically 25, 50 or 75) with brief rest of 15-20 seconds.",
        "Goal time per repetition: divide the target race time by the repetition distance (100 @ 1:00 -> 25s = 15.0 s, 50s = 30.0 s; 200 @ 2:00 -> 50s = 30.0 s).",
        "Failure rule: miss the target time -> skip the next rep; 2 misses in a row -> stop the set; 3 total misses -> stop the set.",
        "Set volume is usually 3-5x race distance (100 -> 300-500; 200 -> 600-1,000).",
        "Technique is trained at race velocity, not with slow drills or aids like fins and paddles.",
        "Main principle: maintain race pace and race-quality technique; don't continue accumulating slow reps.",
        "Benefits: less glycogen depletion and fewer repetitive-motion injuries (swimmer's shoulder); swimmers stay more rested, energetic and motivated.",
    ),
)

TIMOTHY = CoachProgram(
    key="timothy", name="Coach Timothy", heading="Sprint Coach, pure 50m focus, with gym program", inspired_by=None,
    variables=("Top End Speed", "Gym", "Assisted Speed", "Hybrid Gym and Swim", "Speed Work", "Gym"),
    main_events=_events(50),
    weekly_orders={},
    cycle=("Top End Speed", "Gym", "Assisted Speed", "Hybrid Gym and Swim", "Speed Work", "Gym"),
    non_swim_types=("Gym",),
    equipment=("Kickboard", "Fins", "Light parachute", "Heavy parachute", "Stretch cord", "Drag socks", "Pull rope"),
    explanations=(("Dive", "From the blocks"), ("Push", "Push off the wall")),
    rules=(
        "Take as much rest as needed for the highest-quality reps possible (Cam McEvoy, 50m freestyle world-record holder, needs 2 hours for these sessions).",
        "Every session is suited (race suit) except the Assisted Speed session.",
    ),
    effort_levels=(
        ("MAX EFFORT", "0 breaths; highest stroke rate (e.g. 62-64 SR on freestyle); race specific; suited."),
        ("SUBMAX EFFORT", "0 breaths; high stroke rate (e.g. 56-58 SR); race specific; suited."),
        ("WARM UP PACE", "With fins; general; start of the session; easy swimming."),
    ),
)

ROBERT = CoachProgram(
    key="robert", name="Coach Robert", heading="IM Coach", inspired_by="Bob Bowman",
    variables=("Power", "Active Rest", "Threshold", "Threshold/Aerobic", "VO2MAX", "Kick"),
    main_events=("200m IM", "400m IM", "200m Butterfly", "200m Backstroke", "400m Freestyle", "200m Freestyle", "200m Breaststroke"),
    weekly_orders={
        4: ("Threshold", "Active Rest", "Power", "VO2MAX"),
        5: ("Power", "Threshold", "Active Rest", "Threshold/Aerobic", "VO2MAX"),
        6: ("Power", "Threshold", "Active Rest", "Threshold/Aerobic", "Kick", "VO2MAX"),
        7: ("Power", "Threshold", "Active Rest", "VO2MAX", "Threshold/Aerobic", "Kick", "VO2MAX"),
        8: ("Power", "Threshold", "Active Rest", "Threshold/Aerobic", "VO2MAX", "Threshold/Aerobic", "Kick", "VO2MAX"),
        9: ("Power", "Threshold", "Active Rest", "Threshold/Aerobic", "VO2MAX", "Threshold/Aerobic", "Power", "Kick", "VO2MAX"),
    },
    equipment=("Kickboard", "Fins", "Buoy", "Snorkel", "Paddles", "Chute", "Drag socks"),
    explanations=(("Pull", "Freestyle and always with buoy and paddles"), ("IMO", "IM order (Fly, Back, Breast, Free)"),
                  ("Dive", "Off the blocks"), ("uw", "Underwater dolphin kicking"),
                  ("FRIM", "Replace Fly in the IM with Freestyle (Free, Back, Breast, Free)"), ("MS", "Main Stroke")),
    rules=("Intensity is written as colours (WHITE, PINK, RED, ORANGE, BLUE, GREEN, PURPLE) with pulse checks in threshold sets.",
           "Threshold sets descend through WHITE -> PINK -> RED with a 30-second extra break and a pulse check between blocks.",
           "All four strokes are trained, in IM order, with FRIM used for aerobic volume."),
)

TONY = CoachProgram(
    key="tony", name="Coach Tony", heading="Distance Free Coach", inspired_by="Anthony Nesty",
    variables=("Low Level Aerobic", "Threshold", "Lactate/Race-Pace", "Active Rest", "Recovery", "IM"),
    main_events=("400m Freestyle", "800m Freestyle", "1500m Freestyle", "400m IM"),
    weekly_orders={
        4: ("Threshold", "Active Rest", "IM", "Lactate/Race-Pace"),
        5: ("Threshold", "Active Rest", "Recovery", "IM", "Lactate/Race-Pace"),
        6: ("Low Level Aerobic", "Threshold", "Recovery", "IM", "Active Rest", "Lactate/Race-Pace"),
        7: ("Low Level Aerobic", "Threshold", "IM", "Recovery", "Threshold", "Active Rest", "Lactate/Race-Pace"),
        8: ("Low Level Aerobic", "Threshold", "IM", "Recovery", "Threshold", "Active Rest", "Low Level Aerobic", "Lactate/Race-Pace"),
        9: ("Low Level Aerobic", "Threshold", "IM", "Recovery", "Threshold", "Active Rest", "Low Level Aerobic", "Recovery", "Lactate/Race-Pace"),
    },
    equipment=("Pull buoy", "Paddles", "Kickboard", "Fins", "Tech suit (optional for race pace)"),
    explanations=(("Pull", "Freestyle pull with pull buoy and paddles"), ("IMO", "IM order (Fly, Back, Breast, Free)"),
                  ("Neg. split", "The second half of the effort should be faster than the first half"),
                  ("Suit up (optional)", "Put on a racing tech suit if you want"), ("Kick", "Kicking with a board, on your side or on your back")),
    rules=("Race pace is trained with negative splits and best-average repeats.",
           "Long freestyle and pull volume builds the aerobic base; an IM session is part of every week."),
)

PROGRAMS: dict[str, CoachProgram] = {program.key: program for program in (BRAD, PETE, TIMOTHY, ROBERT, TONY)}
PROGRAM_BY_NAME = {program.name.lower(): program for program in PROGRAMS.values()}

# Robert's and Tony's colours. The programs only pin WHITE/PINK/RED to pulse checks (10-second counts: 22-24, 25-27,
# 28-30); the rest is inferred from where each colour is used. Mapped onto SwimGPT's training zones for pacing.
INTENSITY_COLOURS = (
    ("WHITE", "Aerobic", "Steady aerobic pace; pulse check 22-24."),
    ("PINK", "Threshold", "Threshold pace; pulse check 25-27."),
    ("RED", "VO2 / high aerobic", "Hard; pulse check 28-30."),
    ("ORANGE", "VO2 / high aerobic", "Faster than RED: the hardest repeats of threshold and VO2max ladders."),
    ("BLUE", "Race pace", "Race-pace and fast stroke efforts in VO2max sets."),
    ("GREEN", "Sprint", "Max-speed kick, pull and dive sprints in power sessions."),
    ("PURPLE", "Sprint", "Speed efforts with chute and fins, and easy-speed dives."),
)
EFFORT_WORDS = (("MAX / MAX EFFORT / BLAST / MAX SPEED", "Sprint"), ("SUBMAX", "Race pace"), ("FAST / STRONG", "Race pace"),
                ("x Pace (Pete)", "Race pace"), ("easy / EZ / Loosen / Choice / recovery", "Recovery"))


def program_for(name_or_key: str) -> CoachProgram | None:
    value = re.sub(r"\s+", " ", name_or_key).strip().lower()
    return PROGRAMS.get(value) or PROGRAM_BY_NAME.get(value)


def swim_order(program: CoachProgram, count: int) -> list[str]:
    """The coach's session types for `count` swims in a week (their own order; Timothy's cycle without gym days)."""
    if count <= 0:
        return []
    if program.cycle:
        swims = [item for item in program.cycle if item not in program.non_swim_types]
        return [swims[index % len(swims)] for index in range(count)]
    sizes = sorted(program.weekly_orders)
    if count in program.weekly_orders:
        return list(program.weekly_orders[count])
    if count < sizes[0]:
        return list(program.weekly_orders[sizes[0]][:count])
    base = list(program.weekly_orders[sizes[-1]])
    return [base[index % len(base)] for index in range(count)]


# ---------------------------------------------------------------- volume
_RANGE_NUMBERS = re.compile(r"(?<![\d.:@])(\d+(?:\.\d+)?)(?=\s|$|[,/)])")


def _group_volume(group: str) -> float:
    """Volume of one repetition written as a group, e.g. '100 pull PINK @1:25, 50 pull RED @0:50' or '200,150,100,50'."""
    if re.fullmatch(r"[\d\s,]+", group):
        return sum(float(number) for number in re.findall(r"\d+", group))
    total = 0.0
    for part in re.split(r"[,/]", group):
        match = re.match(r"\s*(\d+(?:\.\d+)?)\s", part + " ")
        if match:
            total += float(match.group(1))
    return total


def line_volume(line: str) -> float:
    """Metres in one prescription line (0 for notes, rests, time-based work and gym lines)."""
    text = line.strip()
    if not text or text.startswith(("(", "Rest ", "Suit")) or re.search(r"\d+\s*seconds? (?:of|FAST)", text):
        return 0.0
    match = re.match(r"^(\d+)x\s*\((.+?)\)", text)                       # 4x(100 pull ..., 50 pull ...)
    if match:
        return int(match.group(1)) * _group_volume(match.group(2))
    match = re.match(r"^(\d+)x\s*(\d+(?:\.\d+)?)m?\b(.*)$", text)        # 6x100 ... (with optional '/25 easy' per rep)
    if match:
        reps, distance, rest = int(match.group(1)), float(match.group(2)), match.group(3)
        outside = re.sub(r"\([^)]*\)", "", rest)
        extra = re.search(r"/\s*(\d+)\s+(?:easy|scull|swim|drill)", outside)
        return reps * (distance + (float(extra.group(1)) if extra else 0))
    if re.match(r"^\d+x\s*(?:@|[A-Za-z])", text):                         # 2x Pull Ups, 6x (alone)
        return 0.0
    match = re.match(r"^(\d+(?:,\d+)+)\s", text)                          # 15,20,25 FAST kick / 400,300,200,100 w/Fins
    if match:
        return sum(float(number) for number in match.group(1).split(","))
    match = re.match(r"^(?:Dive\s+)?(\d+(?:\.\d+)?)m?\b(.*)$", text)      # 300 Loosen / Dive 25 MAX / 25 FAST/25 easy
    if match:
        distance, rest = float(match.group(1)), match.group(2)
        outside = re.sub(r"\([^)]*\)", "", rest)
        extra = re.match(r"^\s*[A-Za-z ]+/\s*(\d+)\s", outside + " ")
        return distance + (float(extra.group(1)) if extra else 0)
    return 0.0


def _rounds(line: str) -> int | None:
    match = re.match(r"^(\d+)\s+rounds?\b", line.strip(), re.I)
    return int(match.group(1)) if match else None


# Sessions whose written "Total volume" doesn't match the sets as prescribed (the sets are summed instead).
TOTAL_ERRATA = {("robert", "plan", "Threshold", 2): 5900, ("tony", "plan", "Lactate/Race-Pace", 3): 6000,
                ("tony", "taper", "Threshold", 2): 5800}


def session_volume(session: Session) -> int:
    """Metres: the coach's stated total when it matches the sets, otherwise the sets summed line by line."""
    estimate = estimated_volume(session)
    if session.stated_volume_m and abs(estimate - session.stated_volume_m) <= 0.1 * session.stated_volume_m:
        return session.stated_volume_m
    return estimate


def estimated_volume(session: Session) -> int:
    total = 0.0
    for section in session.sections:
        if section.name in ("Gym", "Working Sets"):
            continue
        multiplier, inner = 1, 1
        for line in section.lines:
            rounds = _rounds(line)
            if rounds:
                multiplier, inner = rounds, 1
                continue
            alone = re.fullmatch(r"(\d+)x", line.strip())
            if alone:
                inner = int(alone.group(1))
                continue
            if multiplier > 1 and re.match(r"^\d{3,}\s+(?:easy|EZ)", line.strip()) and line_volume(line) >= 500:
                multiplier, inner = 1, 1          # a long easy swim closes the rounds block (e.g. Robert VO2MAX #3)
            total += line_volume(line) * multiplier * inner
    return int(round(total))


# ---------------------------------------------------------------- rendering for the AI
def session_label(program: CoachProgram, session: Session, taper: bool = False) -> str:
    return f"{program.name} - {'Taper ' if taper else ''}{session.type} Session #{session.number}"


def render_session(program: CoachProgram, session: Session, taper: bool = False) -> str:
    lines = [f"{session_label(program, session, taper)} (~{session_volume(session)} m{'' if session.stated_volume_m else ' estimated'})"]
    for section in session.sections:
        lines.append(f"  {section.name}:")
        lines.extend(f"    {line}" for line in section.lines)
    return "\n".join(lines)


def render_overview(program: CoachProgram) -> str:
    counts = {item: sum(1 for session in program.sessions if session.type == item) for item in dict.fromkeys(program.variables)}
    taper_counts = {item: sum(1 for session in program.taper if session.type == item) for item in dict.fromkeys(program.variables)}
    lines = [f"{program.name} ({program.heading}{f', like {program.inspired_by}' if program.inspired_by and 'USRPT' not in program.heading else ''})",
             f"Main events: {', '.join(program.main_events)}",
             "Session types: " + ", ".join(f"{name} ({count} session{'s' if count != 1 else ''})" for name, count in counts.items())]
    if any(taper_counts.values()):
        lines.append("Taper sessions: " + ", ".join(f"{name} ({count})" for name, count in taper_counts.items() if count))
    else:
        lines.append("Taper sessions: none written; taper by reducing volume while keeping the race-pace work.")
    if program.cycle:
        lines.append("Training cycle (in order): " + " -> ".join(program.cycle))
    for count, order in sorted(program.weekly_orders.items()):
        lines.append(f"{count}x a week: {', '.join(order)}")
    lines.append(f"Equipment: {', '.join(program.equipment)}")
    lines += [f"{term}: {meaning}" for term, meaning in program.explanations]
    lines += [f"Effort {level}: {meaning}" for level, meaning in program.effort_levels]
    lines += [f"Rule: {rule}" for rule in program.rules]
    if program.key in ("robert", "tony"):
        lines += [f"Colour {colour} -> {zone} zone: {meaning}" for colour, zone, meaning in INTENSITY_COLOURS]
    return "\n".join(lines)


def render_library(program: CoachProgram, taper: bool = True) -> str:
    blocks = [render_session(program, session) for session in program.sessions]
    if taper:
        blocks += [render_session(program, session, True) for session in program.taper]
    return "\n\n".join(blocks)
