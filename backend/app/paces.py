"""Current personal bests for pacing (shared by the Pace Calculator and training generation)."""
from __future__ import annotations

from app.performance import personal_bests, race_history
from app.training import load_records


def references(profile):
    warnings = []
    rows = load_records(profile["id"], ["performance_race", "race_result", "competition"])
    races = race_history(profile, rows, warnings)
    bests = personal_bests(races)
    return [dict(item["current"], is_current_pb=True) for item in bests], warnings
