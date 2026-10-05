"""Coach catalog: selection metadata and the public coach profile, built on the encoded programs (coach_programs.py).

Session counts, taper sessions, weekly orders, training cycle, equipment, glossary, rules and intensity guide all
come straight from the programs, so the profile shown to athletes can never drift from what the generators use.
The fields written here are presentation and selection data only.
"""

from __future__ import annotations

from typing import Any

from app.coach_programs import INTENSITY_COLOURS, PROGRAMS, session_volume

STROKES = ("Freestyle", "Backstroke", "Breaststroke", "Butterfly")


def _events(distance: int) -> list[str]:
    return [f"{distance}m {stroke}" for stroke in STROKES]


# Presentation and selection data per coach. Session descriptions summarise each session type; volumes are computed.
_PROFILE: dict[str, dict[str, Any]] = {
    "brad": {
        "title": "50 & 100 stroke sprint coach",
        "summary": ("Power-and-speed sprint program for 50 and 100 events in all four strokes, built on maximal efforts, "
                    "resistance work and race-pace sets that split the 100 into front-end and back-end speed."),
        "swimmer_types": ["sprinter"], "adjacent_swimmer_types": [], "supporting_events": {}, "requires_gym": False,
        "descriptions": {
            "Power": "Max 15/20/25m kick, pull and swim efforts with fins, paddles and big/small parachutes, plus dive sprints.",
            "50 Race Pace": "Dive 15-25m max-speed efforts (suit optional) and small-parachute pushes.",
            "100 Race Pace": "Front-end-speed 35s and 50s, and broken 25 + 50 back-end-speed swims at 5:00 intervals.",
            "Aerobic/Recovery": "Pull, kick on back, fins-and-paddles and IM drill aerobic volume.",
            "Resistance": "Max underwater and main-stroke efforts with drag socks, parachutes and fins; 100 stroke-rate and breathing-pattern work.",
        },
    },
    "pete": {
        "title": "USRPT sprint coach",
        "summary": ("Race-specific sprint program using USRPT: short repeats at exact goal race pace with short rest, "
                    "stopping a set as soon as the swimmer can no longer hold pace."),
        "swimmer_types": ["sprinter"], "adjacent_swimmer_types": [],
        # The weekly order includes a dedicated 200 Pace session (20x50 at 200 pace).
        "supporting_events": {event: "200 Pace USRPT sessions" for event in _events(200)}, "requires_gym": False,
        "descriptions": {
            "Overspeed": "Suited 15m and 25m dives in the best and second-best strokes.",
            "50 Pace": "12.5m pushes and 25m dives at 50 pace, including overspeed 12.5s.",
            "100 Pace": "20x25 at 100 pace on 20 seconds rest, or 8x25 rounds across three strokes.",
            "200 Pace": "20x50 at 200 pace on 20 seconds rest in each of the two main strokes.",
        },
    },
    "timothy": {
        "title": "Pure 50m sprint coach with gym program",
        "summary": ("Maximal-speed program for 50m events only: very low-volume race-speed reps with as much rest as needed, "
                    "assisted-speed work, and a strength program in the gym."),
        "swimmer_types": ["sprinter"], "adjacent_swimmer_types": [], "supporting_events": {}, "requires_gym": True,
        "descriptions": {
            "Top End Speed": "Suited dive 25s and 20s at max effort plus light-parachute pushes.",
            "Gym": "Pull-up ladder to max extra weight, Keiser pulldowns, reverse cable fly, triceps extensions, hamstring curls.",
            "Assisted Speed": "Stretch-cord assisted 25s, light-parachute pushes and submax dives.",
            "Hybrid Gym and Swim": "Max pull-rope efforts and a dive 25 every 10 minutes, then trap-bar deadlifts, jumps, bench pull and press.",
            "Speed Work": "Dive 25s at max, drag-sock 20s and heavy-parachute pushes.",
        },
    },
    "robert": {
        "title": "IM & 200 specialist coach",
        "summary": ("High-volume IM-based program for 200 and 400 events: threshold and VO2max sets driven by colour "
                    "intensity zones and heart-rate checks, with power, kick and active-rest days."),
        "swimmer_types": ["mid", "specialist"],
        # 400 free overlaps with distance programs.
        "adjacent_swimmer_types": ["distance"], "supporting_events": {}, "requires_gym": False,
        "descriptions": {
            "Power": "Max 15-25m kick, pull and dive sprints in IM order with paddles, chute and fins.",
            "Active Rest": "Pull/kick combinations and descending stroke 50s and 100s.",
            "Threshold": "Descending 400/200/100 freestyle and IM sets across WHITE -> PINK -> RED with pulse checks.",
            "Threshold/Aerobic": "Long freestyle and IM aerobic ladders, Back/Breast/Free 300s.",
            "VO2MAX": "Freestyle 50s with stroke BLUE efforts, broken 200/150/100 sets and 100 BLUE repeats.",
            "Kick": "Kick pyramids and best-average 100 kick sets.",
        },
    },
    "tony": {
        "title": "Distance freestyle coach",
        "summary": ("Aerobic-base distance program for the 400-1500 freestyle and 400 IM: threshold ladders, negative-split "
                    "race-pace work, recovery days and a dedicated IM session every week."),
        "swimmer_types": ["distance"],
        # 400 free and 400 IM overlap with mid-distance and IM programs.
        "adjacent_swimmer_types": ["mid", "specialist"], "supporting_events": {}, "requires_gym": False,
        "descriptions": {
            "Low Level Aerobic": "Long freestyle and pull ladders at WHITE/PINK.",
            "Threshold": "100-400 freestyle ladders descending WHITE -> ORANGE/BLUE.",
            "Lactate/Race-Pace": "Negative-split 400/300/200s, best-average 200s and 100s, FAST 100s.",
            "Active Rest": "Pull/kick combinations and descending stroke 50s and 100s.",
            "Recovery": "Easy pull volume and negative-split 400s.",
            "IM": "IM-order drill and swim sets, stroke 50s/100s, and 200 IM repeats between freestyle.",
        },
    },
}


def _volume_range(sessions) -> str:
    volumes = sorted(session_volume(session) for session in sessions)
    if not volumes or not volumes[-1]:
        return ""
    low, high = volumes[0], volumes[-1]
    return f" ({low:,}m)" if low == high else f" ({low:,}-{high:,}m)"


def _coach(key: str) -> dict[str, Any]:
    program, profile = PROGRAMS[key], _PROFILE[key]
    types = list(dict.fromkeys(program.variables))
    return {
        "name": program.name,
        "title": profile["title"],
        "inspired_by": program.inspired_by,
        "summary": profile["summary"],
        "swimmer_types": profile["swimmer_types"],
        "adjacent_swimmer_types": profile["adjacent_swimmer_types"],
        "main_events": list(program.main_events),
        "supporting_events": profile["supporting_events"],
        "requires_gym": profile["requires_gym"],
        "principles": list(program.rules),
        "weekly_structure": {count: list(order) for count, order in program.weekly_orders.items()},
        **({"training_cycle": list(program.cycle)} if program.cycle else {}),
        "sessions": [
            {"type": item, "count": len(program.sessions_of(item)),
             "description": profile["descriptions"][item] + ("" if item in program.non_swim_types else _volume_range(program.sessions_of(item)))}
            for item in types
        ],
        "taper_sessions": [{"type": item, "count": sum(1 for session in program.taper if session.type == item)}
                           for item in types if any(session.type == item for session in program.taper)],
        "intensity_guide": (
            [{"level": level, "detail": detail} for level, detail in program.effort_levels]
            or ([{"level": colour, "detail": f"{zone} zone. {meaning}"} for colour, zone, meaning in INTENSITY_COLOURS]
                if key in ("robert", "tony") else [])
        ),
        "equipment": list(program.equipment),
        "glossary": [{"term": term, "meaning": meaning} for term, meaning in program.explanations],
        # Provenance labels for the encoded programs (nothing is read from these documents at runtime).
        "source_files": [f"{program.name} Plan"] + ([f"{program.name} Taper Sessions"] if program.taper else []),
    }


COACHES: dict[str, dict[str, Any]] = {key: _coach(key) for key in ("brad", "pete", "timothy", "robert", "tony")}


def public_profile(key: str) -> dict[str, Any]:
    """Coach data safe to send to the frontend (weekly structure keys as strings for JSON)."""
    coach = COACHES[key]
    return {
        "key": key,
        **{field: value for field, value in coach.items() if field not in {"weekly_structure", "supporting_events"}},
        "weekly_structure": [
            {"sessions_per_week": sessions, "order": order} for sessions, order in sorted(coach["weekly_structure"].items())
        ],
        "supporting_events": sorted(coach["supporting_events"]),
    }
