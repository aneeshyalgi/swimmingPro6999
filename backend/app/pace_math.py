from __future__ import annotations

from math import isfinite


ZONE_GUIDANCE = {
    "Recovery": "Easy swimming with comfortable breathing and relaxed technique.",
    "Aerobic": "Sustainable repetitions; preserve technique and repeatability.",
    "Threshold": "Controlled sustained work; this PB-derived estimate is not a tested threshold.",
    "VO2 / high aerobic": "Hard aerobic repetitions with sufficient recovery to maintain technique.",
    "Race pace": "Average speed of the selected event PB, not an actual lap split or a push-start correction.",
    "Sprint": "Short fast repetitions with substantial recovery. Stop when technique deteriorates.",
}
DEFAULT_SPEED_BANDS = {
    "Recovery": (0.60, 0.70), "Aerobic": (0.70, 0.80), "Threshold": (0.80, 0.88),
    "VO2 / high aerobic": (0.88, 0.95), "Race pace": (1.0, 1.0), "Sprint": (1.0, 1.05),
}
METHOD_VERSION = "pb-speed-bands-v1"


def equivalent_time(pb_seconds: float, event_distance: int, target_distance: int) -> float:
    if not isfinite(pb_seconds) or pb_seconds <= 0 or event_distance <= 0 or target_distance <= 0:
        raise ValueError("Pace calculations require positive finite time and distances.")
    return pb_seconds * target_distance / event_distance


def css_pace(time_200: float, time_400: float) -> float:
    if time_400 <= time_200:
        raise ValueError("400m time must exceed 200m time.")
    return (time_400 - time_200) / 2


def target_range(pb_seconds: float, event_distance: int, distance: int, slow_speed: float, fast_speed: float):
    baseline = equivalent_time(pb_seconds, event_distance, distance)
    return {
        "fast_seconds": round(baseline / fast_speed, 3),
        "slow_seconds": round(baseline / slow_speed, 3),
    }
