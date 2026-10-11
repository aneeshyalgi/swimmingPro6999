"""Week generation jobs: one at a time per week, and cancelled the moment the athlete leaves.

A swim or gym week is generated while the athlete waits on the page. If they reload, close the tab or navigate away,
the browser drops the request (and sends a cancel beacon): the job is cancelled, nothing it made is saved, and the
week is free to generate again straight away. A second request for a week that is still being generated (another tab,
a second device) waits for that run and gets the same week; the run is cancelled only once every page waiting has left.

Weeks run on their own threads, never the server's shared request threads, so a busy moment can't stall the rest of
the app; a limited number run at once (LIMITS) and the rest wait their turn. Every run has GENERATION_SECONDS to finish, so
an athlete always gets an answer.
"""
from __future__ import annotations

import asyncio
import heapq
import itertools
import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Iterator, Literal, TypeVar

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

Part = Literal["swim", "gym"]
LABELS = {"swim": "swim week", "gym": "gym week"}
T = TypeVar("T")

# How often a waiting request checks whether the athlete is still there.
POLL_SECONDS = 0.5
# Time a generation has to finish once it starts (a swim week normally takes 10-15 s).
GENERATION_SECONDS = 150
# Weeks generated at the same time in this process ({part: (running, waiting)}). A swim week makes dozens of AI calls
# at once; a gym week a few short ones. More wait their turn, first come first served; when the line is already full,
# or no turn comes within QUEUE_SECONDS, the athlete is asked to try again in a minute (straight away, rather than after
# waiting for nothing).
LIMITS: dict[str, tuple[int, int]] = {"swim": (8, 16), "gym": (16, 32)}
QUEUE_SECONDS = 90
BUSY = "Lots of athletes are generating their weeks right now. Nothing was saved, so please try again in a minute."

_executor = ThreadPoolExecutor(max_workers=sum(sum(limit) for limit in LIMITS.values()) + 8, thread_name_prefix="generation")


class GenerationCancelled(Exception):
    """The athlete left before the week was saved."""


class Busy(Exception):
    """The line for a turn is full, or no turn came up within QUEUE_SECONDS."""


class Turnstile:
    """A limited number of turns, handed out in order of priority (lowest first; ties first come, first served).

    Waiting stays responsive: `check` runs a few times a second while waiting (it raises to stop waiting, e.g. when the
    athlete leaves), and a waiter keeps its place in line throughout. With a `minimum`, the number of turns adapts:
    `shrink` when the service behind them says it's overloaded, `grow` back on each success.
    """

    def __init__(self, turns: int, minimum: int | None = None):
        self.most, self.least = turns, minimum or turns
        self.limit = float(turns)
        self.in_use = 0
        self._shrunk = 0.0
        self._waiting: list[tuple[float, int]] = []
        self._order = itertools.count()
        self._changed = threading.Condition()

    @property
    def free(self) -> int:
        return max(0, int(self.limit) - self.in_use)

    def waiting(self) -> int:
        with self._changed:
            return len(self._waiting)

    def acquire(self, priority: float, check: Callable[[], None]) -> None:
        with self._changed:
            ticket = (priority, next(self._order))
            heapq.heappush(self._waiting, ticket)
            try:
                while not (self.in_use < int(self.limit) and self._waiting[0] == ticket):
                    self._changed.wait(0.25)
                    check()
                heapq.heappop(self._waiting)
                self.in_use += 1
                if self.in_use < int(self.limit) and self._waiting:
                    self._changed.notify_all()      # the next in line may go too
            except BaseException:
                if ticket in self._waiting:
                    self._waiting.remove(ticket)
                    heapq.heapify(self._waiting)
                self._changed.notify_all()
                raise

    def release(self) -> None:
        with self._changed:
            self.in_use -= 1
            self._changed.notify_all()

    def shrink(self) -> None:
        """Overloaded: fewer turns at once (once a second at most, so one burst of refusals counts once)."""
        with self._changed:
            now = time.monotonic()
            if now - self._shrunk >= 1.0 and self.limit > self.least:
                self.limit = max(float(self.least), self.limit * 0.7)
                self._shrunk = now
                logger.info("Fewer AI calls at once: %d", int(self.limit))

    def grow(self) -> None:
        """A success: a little more room again, back up to the full number of turns."""
        with self._changed:
            if self.limit < self.most:
                self.limit = min(float(self.most), self.limit + 0.25)
                self._changed.notify_all()


weeks = {part: Turnstile(running) for part, (running, _) in LIMITS.items()}


@dataclass(eq=False)
class Job:
    key: tuple[str, str, str]
    id: str | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)
    # Set once the job starts writing: from then on it finishes, so a week is never left half saved.
    committing: bool = False
    claimed: float = field(default_factory=time.monotonic)
    # When the generation's time runs out (set when its turn comes; see GENERATION_SECONDS).
    deadline: float | None = None
    # The run itself, and the pages waiting for it (their run ids): the page that started it and any other tab or device
    # that asked for the same week meanwhile. It's cancelled when the last of them leaves.
    task: asyncio.Future | None = None
    watchers: set[str] = field(default_factory=set)


_lock = threading.Lock()
_running: dict[tuple[str, str, str], Job] = {}
_by_id: dict[str, Job] = {}
_current: ContextVar[Job | None] = ContextVar("generation_job", default=None)


def _claim(profile_id: str, part: Part, week_start: date, job_id: str | None) -> tuple[Job, str, bool]:
    """The job for the athlete's week, the caller's watcher id, and whether it joined a run already going (another tab
    or device asked for the same week first: it gets the same week when that run finishes)."""
    key = (str(profile_id), part, week_start.isoformat())
    watcher = job_id or f"page-{uuid.uuid4()}"
    with _lock:
        existing = _running.get(key)
        if existing is not None:
            if existing.task is None or existing.cancelled.is_set():
                raise HTTPException(status_code=409, detail=f"Your {LABELS[part]} is already being generated. Reload the page in a moment to see it.")
            existing.watchers.add(watcher)
            if job_id:
                _by_id[job_id] = existing
            return existing, watcher, True
        if sum(other[1] == part for other in _running) >= sum(LIMITS[part]):
            logger.warning("Generation refused: %d %s weeks running or waiting", sum(LIMITS[part]), part)
            raise HTTPException(status_code=503, detail=BUSY)
        job = Job(key, job_id, watchers={watcher})
        _running[key] = job
        if job_id:
            _by_id[job_id] = job
        return job, watcher, False


def _release(job: Job) -> None:
    """Free the week (called with _lock held). A newer job for the same week is left alone."""
    if _running.get(job.key) is job:
        del _running[job.key]
    for job_id in list(job.watchers) + ([job.id] if job.id else []):
        if _by_id.get(job_id) is job:
            del _by_id[job_id]


def _cancel_locked(job: Job) -> bool:
    if job.committing:
        return False
    job.cancelled.set()
    _release(job)
    return True


def _cancel(job: Job) -> bool:
    """Cancel a job that hasn't started saving, and free its week at once. Returns whether it was cancelled."""
    with _lock:
        return _cancel_locked(job)


def _leave(job: Job, watcher: str) -> bool:
    """A page waiting for the job went away: the job is cancelled once no page is left waiting for it."""
    with _lock:
        job.watchers.discard(watcher)
        return False if job.watchers else _cancel_locked(job)


def cancel(job_id: str) -> bool:
    """The athlete's page that started or joined a run under `job_id` is unloading (its beacon): it stops waiting, and
    the run is cancelled if no other page is waiting for it."""
    with _lock:
        job = _by_id.get(job_id)
    return _leave(job, job_id) if job else False


def current() -> Job | None:
    """The job this thread is generating for, to hand to worker threads (context doesn't follow them)."""
    return _current.get()


def checkpoint(job: Job | None = None) -> None:
    """Stop here if the athlete has left. Called between the expensive AI steps."""
    job = job or _current.get()
    if job and job.cancelled.is_set():
        raise GenerationCancelled


@contextmanager
def committing() -> Iterator[None]:
    """Wrap the writes that save a generated week: a cancelled job stops before them; once they start, they finish."""
    job = _current.get()
    if job:
        with _lock:
            if job.cancelled.is_set():
                raise GenerationCancelled
            job.committing = True
    yield


async def run_generation(request: Request, profile_id: str, part: Part, week_start: date, job_id: str | None,
                         work: Callable[[], T]) -> T:
    """Run `work` (blocking) for the athlete's week, cancelling it as soon as their browser goes away. A request for a
    week already being generated (another tab, a second device) waits for that run and returns the same week."""
    job, watcher, joined = _claim(profile_id, part, week_start, job_id)
    if joined:
        return await _follow(request, job, watcher, part)

    def wait_turn() -> None:
        checkpoint(job)
        if time.monotonic() - job.claimed > QUEUE_SECONDS:
            logger.warning("Generation gave up waiting for a turn after %d s", QUEUE_SECONDS)
            raise Busy

    def run() -> T:
        token = _current.set(job)
        try:
            weeks[part].acquire(job.claimed, wait_turn)
            try:
                checkpoint(job)
                job.deadline = time.monotonic() + GENERATION_SECONDS
                return work()
            finally:
                weeks[part].release()
        finally:
            _current.reset(token)

    def finished(future: asyncio.Future) -> None:
        with _lock:
            _release(job)
        # A run the athlete left stops with GenerationCancelled after its request has answered; nobody awaits it.
        if not future.cancelled():
            future.exception()

    task = asyncio.get_running_loop().run_in_executor(_executor, run)
    job.task = task
    task.add_done_callback(finished)
    left = asyncio.ensure_future(_disconnect(request))
    watching = {task, left}
    try:
        while True:
            done, _ = await asyncio.wait(watching, timeout=POLL_SECONDS, return_when=asyncio.FIRST_COMPLETED)
            if task in done:
                return task.result()
            if left in done:
                watching = {task}
                # Cancelled unless another page waits for it, or the week is already being written (then it finishes).
                _leave(job, watcher)
                if job.watchers and not job.committing:
                    raise GenerationCancelled           # it goes on for the other page; this one has gone
            if job.cancelled.is_set():
                raise GenerationCancelled
    except GenerationCancelled:
        raise HTTPException(status_code=409, detail=cancelled(part)) from None
    except Busy:
        raise HTTPException(status_code=503, detail=BUSY) from None
    finally:
        left.cancel()
        # The request itself was cancelled (server shutting down, connection torn down): don't save behind its back.
        if not task.done():
            _leave(job, watcher)


def cancelled(part: Part) -> str:
    return f"Generating your {LABELS[part]} was cancelled, so nothing was saved. Start it again whenever you're ready."


async def _follow(request: Request, job: Job, watcher: str, part: Part):
    """Wait for a run another page started for the same week and return its week (or its error)."""
    assert job.task is not None
    left = asyncio.ensure_future(_disconnect(request))
    try:
        done, _ = await asyncio.wait({job.task, left}, return_when=asyncio.FIRST_COMPLETED)
        if job.task in done:
            return job.task.result()
        _leave(job, watcher)
        raise GenerationCancelled
    except GenerationCancelled:
        raise HTTPException(status_code=409, detail=cancelled(part)) from None
    except Busy:
        raise HTTPException(status_code=503, detail=BUSY) from None
    finally:
        left.cancel()
        if not job.task.done():
            _leave(job, watcher)


async def _disconnect(request: Request) -> None:
    """Returns once the browser has gone. The body is already read, so the next message is the disconnect.

    (Request.is_disconnected() can't see it through the app's function middleware; waiting on receive() can.)
    """
    while (await request.receive()).get("type") != "http.disconnect":
        await asyncio.sleep(POLL_SECONDS)
