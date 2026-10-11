"""Week generation jobs: one per week, cancelled (and never saved) once the athlete leaves the page."""
import asyncio
import threading
import time
import unittest
from datetime import date
from uuid import uuid4

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import jobs
from app.main import app

MONDAY = date(2030, 1, 7)


class FakeRequest:
    """Stands in for the HTTP request: `leave()` is the browser going away."""

    def __init__(self):
        self.gone = threading.Event()

    def leave(self):
        self.gone.set()

    async def receive(self):
        while not self.gone.is_set():
            await asyncio.sleep(0.02)
        return {"type": "http.disconnect"}


def run(coroutine):
    return asyncio.run(coroutine)


class GenerationJobTests(unittest.TestCase):
    def setUp(self):
        jobs._running.clear()
        jobs._by_id.clear()
        self.profile = f"profile-{uuid4()}"

    def generation(self, request, work, job_id=None, part="swim"):
        return jobs.run_generation(request, self.profile, part, MONDAY, job_id, work)

    def test_a_finished_week_is_returned_and_the_week_freed(self):
        def work():
            jobs.checkpoint()
            with jobs.committing():
                return {"saved": True}

        self.assertEqual(run(self.generation(FakeRequest(), work)), {"saved": True})
        self.assertEqual(jobs._running, {})
        self.assertEqual(run(self.generation(FakeRequest(), work)), {"saved": True})  # and can run again

    def test_a_second_page_asking_for_the_same_week_gets_the_week_being_generated(self):
        started, release = threading.Event(), threading.Event()
        runs = []

        def slow():
            runs.append("first")
            started.set()
            release.wait(5)
            return "week"

        async def both():
            first = asyncio.ensure_future(self.generation(FakeRequest(), slow, str(uuid4())))
            await asyncio.get_running_loop().run_in_executor(None, started.wait, 5)
            second = asyncio.ensure_future(self.generation(FakeRequest(), lambda: runs.append("second"), str(uuid4())))
            # The gym week is a different job.
            self.assertEqual(await self.generation(FakeRequest(), lambda: "gym", part="gym"), "gym")
            release.set()
            return await first, await second

        self.assertEqual(run(both()), ("week", "week"))
        self.assertEqual(runs, ["first"])                       # generated once
        self.assertEqual(jobs._running, {})

    def test_the_week_keeps_generating_while_another_page_still_waits_for_it(self):
        owner, other, started, release = FakeRequest(), FakeRequest(), threading.Event(), threading.Event()
        saved = []

        def work():
            started.set()
            release.wait(5)
            jobs.checkpoint()
            with jobs.committing():
                saved.append("week")
            return "week"

        async def scenario():
            first = asyncio.ensure_future(self.generation(owner, work, str(uuid4())))
            await asyncio.get_running_loop().run_in_executor(None, started.wait, 5)
            second = asyncio.ensure_future(self.generation(other, lambda: "never", str(uuid4())))
            await asyncio.sleep(0.1)
            owner.leave()                                       # the tab that started it closes
            with self.assertRaises(HTTPException):
                await first
            release.set()
            return await second

        self.assertEqual(run(scenario()), "week")
        self.assertEqual(saved, ["week"])

    def test_the_run_is_cancelled_once_every_page_waiting_for_it_has_left(self):
        owner, other, started = FakeRequest(), FakeRequest(), threading.Event()
        owner_id, saved = str(uuid4()), []

        def work():
            started.set()
            for _ in range(40):
                time.sleep(0.05)
                jobs.checkpoint()
            with jobs.committing():
                saved.append("week")
            return "week"

        async def scenario():
            first = asyncio.ensure_future(self.generation(owner, work, owner_id))
            await asyncio.get_running_loop().run_in_executor(None, started.wait, 5)
            second = asyncio.ensure_future(self.generation(other, lambda: "never", str(uuid4())))
            await asyncio.sleep(0.1)
            self.assertFalse(jobs.cancel(owner_id))             # the first page's beacon: the other page still waits
            other.leave()
            for task in (first, second):
                with self.assertRaises(HTTPException) as stopped:
                    await task
                self.assertEqual(stopped.exception.status_code, 409)
            await asyncio.sleep(0.3)

        run(scenario())
        self.assertEqual(saved, [])
        self.assertEqual(jobs._running, {})

    def leave_midway(self, cancel):
        """Generation that the athlete leaves during its AI work. Returns (what got saved, the 409, worker finished)."""
        request, job_id = FakeRequest(), str(uuid4())
        in_ai, worker_done, saved = threading.Event(), threading.Event(), []

        def work():
            try:
                jobs.checkpoint()
                in_ai.set()
                time.sleep(1.2)  # the model writing sessions while the athlete leaves
                jobs.checkpoint()
                with jobs.committing():
                    saved.append("week")
                return "week"
            finally:
                worker_done.set()

        async def scenario():
            task = asyncio.ensure_future(self.generation(request, work, job_id))
            await asyncio.get_running_loop().run_in_executor(None, in_ai.wait, 5)
            cancel(request, job_id)
            with self.assertRaises(HTTPException) as cancelled:
                await task
            # The week is free at once (a fresh start after a reload isn't told it's "already being generated")...
            self.assertEqual(jobs._running, {})
            self.assertFalse(worker_done.is_set())
            # ...and the abandoned run stops at its next checkpoint without saving anything.
            await asyncio.get_running_loop().run_in_executor(None, worker_done.wait, 5)
            return cancelled.exception

        error = run(scenario())
        return saved, error

    def test_leaving_the_page_cancels_the_week_and_nothing_is_saved(self):
        saved, error = self.leave_midway(lambda request, _: request.leave())
        self.assertEqual(saved, [])
        self.assertEqual(error.status_code, 409)
        self.assertIn("cancelled", error.detail)

    def test_the_unload_beacon_cancels_the_week_and_nothing_is_saved(self):
        saved, error = self.leave_midway(lambda _, job_id: self.assertTrue(jobs.cancel(job_id)))
        self.assertEqual(saved, [])
        self.assertIn("nothing was saved", error.detail)
        self.assertEqual(jobs._by_id, {})

    def test_a_week_already_being_written_is_finished_not_left_half_saved(self):
        request, writing = FakeRequest(), threading.Event()
        saved = []

        def work():
            with jobs.committing():
                writing.set()
                time.sleep(0.8)
                saved.append("week")
            return "week"

        async def scenario():
            task = asyncio.ensure_future(self.generation(request, work, str(uuid4())))
            await asyncio.get_running_loop().run_in_executor(None, writing.wait, 5)
            request.leave()
            return await task

        self.assertEqual(run(scenario()), "week")
        self.assertEqual(saved, ["week"])
        self.assertEqual(jobs._running, {})

    def test_workers_stop_at_their_checkpoint_once_cancelled(self):
        job, _, _ = jobs._claim(self.profile, "gym", MONDAY, None)
        jobs.checkpoint(job)
        jobs._cancel(job)
        with self.assertRaises(jobs.GenerationCancelled):
            jobs.checkpoint(job)

    def test_a_full_line_is_told_to_try_again_at_once_and_gym_weeks_have_their_own(self):
        for index in range(sum(jobs.LIMITS["swim"])):
            jobs._claim(f"athlete-{index}", "swim", MONDAY, None)
        with self.assertLogs("app.jobs", "WARNING"), self.assertRaises(HTTPException) as busy:
            jobs._claim(self.profile, "swim", MONDAY, None)
        self.assertEqual(busy.exception.status_code, 503)
        self.assertIn("try again in a minute", busy.exception.detail)
        jobs._claim(self.profile, "gym", MONDAY, None)          # a light gym week isn't stuck behind swim weeks

    def test_a_run_gets_its_deadline_when_its_turn_comes(self):
        def work():
            return jobs.current().deadline - time.monotonic()

        left = run(self.generation(FakeRequest(), work))
        self.assertAlmostEqual(left, jobs.GENERATION_SECONDS, delta=2)


class TurnstileTests(unittest.TestCase):
    def test_turns_go_in_order_of_priority_and_none_are_lost(self):
        turnstile, order, lock = jobs.Turnstile(2), [], threading.Lock()
        turnstile.acquire(0, lambda: None)
        turnstile.acquire(0, lambda: None)                   # both turns taken: everyone else waits in line

        def wait(priority):
            turnstile.acquire(priority, lambda: None)
            with lock:
                order.append(priority)
            time.sleep(0.02)
            turnstile.release()

        threads = [threading.Thread(target=wait, args=(priority,)) for priority in (5, 3, 9, 1, 7)]
        for thread in threads:
            thread.start()
            time.sleep(0.02)
        turnstile.release()
        turnstile.release()
        for thread in threads:
            thread.join(5)
        self.assertEqual(order, [1, 3, 5, 7, 9])
        self.assertEqual(turnstile.free, 2)

    def test_a_waiter_that_stops_leaves_the_line(self):
        turnstile = jobs.Turnstile(1)
        turnstile.acquire(0, lambda: None)

        def leave():
            raise jobs.GenerationCancelled

        with self.assertRaises(jobs.GenerationCancelled):
            turnstile.acquire(1, leave)
        self.assertEqual(turnstile.waiting(), 0)
        turnstile.release()
        turnstile.acquire(2, lambda: None)                   # the turn wasn't lost

    def test_many_free_turns_are_taken_at_once(self):
        turnstile = jobs.Turnstile(30)
        started = time.monotonic()
        threads = [threading.Thread(target=lambda: (turnstile.acquire(1.0, lambda: None), time.sleep(0.1), turnstile.release()))
                   for _ in range(30)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
        self.assertLess(time.monotonic() - started, 1.0)

    def test_an_overloaded_service_gets_fewer_calls_until_it_recovers(self):
        turnstile = jobs.Turnstile(40, minimum=8)
        turnstile.shrink()
        turnstile.shrink()                                   # one burst of refusals counts once
        self.assertEqual(turnstile.free, 28)
        for _ in range(48):
            turnstile.grow()
        self.assertEqual(turnstile.free, 40)


class ClientReuseTests(unittest.TestCase):
    def test_a_database_client_outlives_its_thread_but_is_never_shared(self):
        from unittest.mock import patch
        from app import db

        made = []

        def create(*_args):
            made.append(object())
            return made[-1]

        def use(into, hold=None):
            into.append(db.get_supabase_client())
            if hold:
                hold.wait(5)

        with patch.object(db._ResilientClient, "create", side_effect=create), patch.object(db, "_idle", []):
            first: list = []
            thread = threading.Thread(target=use, args=(first,))
            thread.start()
            thread.join()
            second: list = []
            thread = threading.Thread(target=use, args=(second,))
            thread.start()
            thread.join()
            self.assertIs(first[0], second[0])                  # the next new thread reuses it
            hold, both = threading.Event(), []
            threads = [threading.Thread(target=use, args=(both, hold)) for _ in range(2)]
            for thread in threads:
                thread.start()
            time.sleep(0.2)
            hold.set()
            for thread in threads:
                thread.join()
            self.assertIsNot(both[0], both[1])                 # two live threads never share one


class BuilderCancellationTests(unittest.TestCase):
    """The real week builders stop before writing anything once their job is cancelled."""

    def test_a_cancelled_gym_week_deletes_and_saves_nothing(self):
        from unittest.mock import MagicMock, patch
        from app import gym
        from tests.test_strength_system import MONDAY as GYM_MONDAY, WEEK, athlete

        job = jobs.Job(("profile-a", "gym", GYM_MONDAY.isoformat()))
        week = {"days": [{"date": day.isoformat(), "workouts": []} for day in WEEK]}

        def narrate(_profile, session, _notes, _job=None):
            jobs._cancel(job)  # the athlete leaves while the coach's notes are written
            return dict(session.workout)

        database = MagicMock()
        with patch.object(gym, "gym_week", return_value=week), patch.object(gym, "strength_athlete", return_value=athlete()), \
                patch.object(gym, "get_supabase_client", return_value=database), patch.object(gym, "save_record") as save_record, \
                patch.object(gym, "_narrate", side_effect=narrate), patch("app.gym.datetime") as clock:
            clock.now.return_value.date.return_value = GYM_MONDAY
            token = jobs._current.set(job)
            try:
                with self.assertRaises(jobs.GenerationCancelled):
                    gym.plan_gym_week({"id": "profile-a"}, GYM_MONDAY)
            finally:
                jobs._current.reset(token)
        save_record.assert_not_called()
        database.table.assert_not_called()


class CancelEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_beacon_cancels_a_running_job(self):
        job_id = str(uuid4())
        job, _, _ = jobs._claim("profile-beacon", "swim", MONDAY, job_id)
        response = self.client.post("/api/training/generation/cancel", content=f'{{"id": "{job_id}"}}', headers={"Content-Type": "text/plain"})
        self.assertEqual(response.status_code, 204)
        self.assertTrue(job.cancelled.is_set())
        self.assertNotIn(job.key, jobs._running)

    def test_unknown_or_malformed_ids_are_ignored(self):
        self.assertEqual(self.client.post("/api/training/generation/cancel", content=f'{{"id": "{uuid4()}"}}').status_code, 204)
        self.assertEqual(self.client.post("/api/training/generation/cancel", content='{"id": "../../etc"}').status_code, 204)
        self.assertEqual(self.client.post("/api/training/generation/cancel", content="nope").status_code, 422)

    def test_generate_requests_only_take_a_well_formed_job_id(self):
        from app.gym import GymGenerateRequest
        from app.training import WeekRequest
        from pydantic import ValidationError

        job_id = str(uuid4())
        self.assertEqual(WeekRequest(week_start=MONDAY, job_id=job_id).job_id, job_id)
        self.assertIsNone(WeekRequest(week_start=MONDAY).job_id)
        with self.assertRaises(ValidationError):
            GymGenerateRequest(week_start=MONDAY, job_id="x" * 36)


if __name__ == "__main__":
    unittest.main()
