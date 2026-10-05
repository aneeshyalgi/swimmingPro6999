from __future__ import annotations

import re
from typing import Any

# Profile columns that hold per-event swim times as {"minutes", "seconds", "hundredths"} objects.
TIME_FIELDS = ("pbs_lcm", "pbs_scm", "pbs_scy", "one_year_goal_times")

_TEXT_TIME = re.compile(r"\d+(?::[0-5]\d)?(?:\.\d{1,3})?")


def swim_time_parts(text: str) -> dict[str, int]:
    """Split a legacy "M:SS.hh" or "SS.hh" string into minutes, seconds and hundredths."""
    value = text.strip()
    if not _TEXT_TIME.fullmatch(value):
        raise ValueError("Use seconds or MM:SS.xx for swim times.")
    whole, _, fraction = value.partition(".")
    minutes, _, seconds = whole.rpartition(":")
    total_seconds = int(seconds) + int(minutes or 0) * 60
    return {
        "minutes": total_seconds // 60,
        "seconds": total_seconds % 60,
        "hundredths": int((fraction + "00")[:2]),
    }


def format_swim_time(value: Any) -> str | None:
    """Render a stored swim time as "M:SS.hh" (or "SS.hh" under a minute)."""
    if isinstance(value, dict):
        minutes = int(value.get("minutes") or 0)
        seconds = int(value.get("seconds") or 0)
        hundredths = int(value.get("hundredths") or 0)
        if minutes == seconds == hundredths == 0:
            return None
        return f"{minutes}:{seconds:02d}.{hundredths:02d}" if minutes else f"{seconds}.{hundredths:02d}"
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def with_display_times(profile: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a profile row with structured swim times rendered as text for downstream use."""
    display = dict(profile)
    for field in TIME_FIELDS:
        times = profile.get(field)
        if isinstance(times, dict):
            display[field] = {
                event: text for event, value in times.items() if (text := format_swim_time(value)) is not None
            }
    return display
