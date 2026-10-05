"""Guard against generating the same week twice at once (e.g. the onboarding background job and a button click)."""
from __future__ import annotations

import threading
from contextlib import contextmanager
from datetime import date
from typing import Iterator, Literal

from fastapi import HTTPException

Part = Literal["swim", "gym"]
LABELS = {"swim": "swim week", "gym": "gym week"}

_lock = threading.Lock()
_running: set[tuple[str, str, str]] = set()


@contextmanager
def generating(profile_id: str, part: Part, week_start: date) -> Iterator[None]:
    """Hold the week while it is generated; a second request for the same week gets a 409 instead of a duplicate plan."""
    key = (str(profile_id), part, week_start.isoformat())
    with _lock:
        if key in _running:
            raise HTTPException(status_code=409, detail=f"Your {LABELS[part]} is already being generated. It will appear here in a moment.")
        _running.add(key)
    try:
        yield
    finally:
        with _lock:
            _running.discard(key)
