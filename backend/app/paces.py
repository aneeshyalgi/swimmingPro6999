"""Current personal bests for pacing (shared by the Pace Calculator and training generation).

The Pace Calculator shows them all (references). Everything the coach writes paces from them too: a race the athlete logs
(on the Performance page, or as a result at one of their meets) that beats their profile's PB for its event and course
is their PB from then on (race_pbs, with_current_pbs). Nothing is saved: deleting or correcting the race puts the PB
back as it was.
"""
from __future__ import annotations

import logging
from typing import Any

from pydantic import ValidationError

from app.performance import personal_bests, race_history
from app.training import load_records, parse_swim_time, realistic_pace

logger = logging.getLogger(__name__)

FIELDS = {"LCM": "pbs_lcm", "SCM": "pbs_scm", "SCY": "pbs_scy"}


def references(profile):
    warnings = []
    rows = load_records(profile["id"], ["performance_race", "race_result", "competition"])
    races = race_history(profile, rows, warnings)
    bests = personal_bests(races)
    return [dict(item["current"], is_current_pb=True) for item in bests], warnings


def _profile_seconds(value: Any, distance: int, yards: bool) -> float | None:
    """A profile PB's seconds, or None when it has none a swimmer could have swum (missing, unreadable or unrealistic)."""
    try:
        seconds = parse_swim_time(value)
    except (ValueError, TypeError, AttributeError):
        return None
    return seconds if realistic_pace(seconds / distance * 100, yards) else None


def race_pbs(profile) -> dict[str, dict[str, dict[str, Any]]]:
    """The PBs the athlete has set in races they logged, by profile field and event ({"pbs_lcm": {"100m Freestyle":
    {"time", "date", "race", "profile_pb"}}}): each event and course's fastest race, when it beats the profile's PB (or the
    profile has none a swimmer could have swum). A race time no swimmer could swim isn't a PB, and a record that can't be
    read is left out (and logged) rather than failing what asked."""
    rows = load_records(profile["id"], ["performance_race", "race_result", "competition"])
    meets = [row for row in rows if row["session_type"] == "competition"]
    fastest: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if row["session_type"] == "competition":
            continue
        try:
            races = race_history({}, [row, *meets], [])
        except (ValueError, ValidationError, KeyError, TypeError):
            logger.warning("Race record %s can't be read, so it isn't counted as a PB", row.get("id"), exc_info=True)
            continue
        for race in races:
            if not realistic_pace(race["seconds"] / race["distance"] * 100, race["course"] == "SCY"):
                continue
            key = (FIELDS[race["course"]], race["event"])
            if key not in fastest or (race["seconds"], race["date"]) < (fastest[key]["seconds"], fastest[key]["date"]):
                fastest[key] = race
    pbs: dict[str, dict[str, dict[str, Any]]] = {}
    for (field, event), race in sorted(fastest.items()):
        listed = (profile.get(field) or {}).get(event)
        seconds = _profile_seconds(listed, race["distance"], field == "pbs_scy")
        if seconds is not None and seconds <= race["seconds"]:
            continue
        pbs.setdefault(field, {})[event] = {"time": race["final_time"], "date": race["date"], "race": race["competition"],
                                            **({"profile_pb": listed} if isinstance(listed, str) and listed.strip() else {})}
    return pbs


def with_current_pbs(profile: dict[str, Any]) -> dict[str, Any]:
    """The profile with its `current_pbs` (race_pbs), which training.athlete_brief (and so every pace target, and the
    checks on them) uses over the profile's own PBs. A profile that has them already is returned as it is; when the races
    can't be read just now, it has none, and its own PBs are used as before."""
    if "current_pbs" in profile:
        return profile
    try:
        pbs = race_pbs(profile)
    except Exception:
        # Whatever went wrong, the coach still writes (with the profile's PBs): a PB from a race is never worth a failure.
        logger.exception("Couldn't read the races of %s for its PBs; the profile's are used", profile.get("id"))
        pbs = {}
    return {**profile, "current_pbs": pbs}
