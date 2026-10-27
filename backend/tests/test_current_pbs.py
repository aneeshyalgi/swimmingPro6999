"""A PB the athlete sets in a race they log is their PB from then on for everything the coach writes (app/paces.py): their
paces, the checks on them and their race plans' targets. Nothing is saved, and a race that can't be read never fails it."""
from contextlib import nullcontext
from datetime import date
import unittest
from unittest.mock import patch
from uuid import UUID

from app import paces, tokens, training
from tests.test_week_coach import FakeDatabase

PROFILE = {"id": "row-1", "pbs_lcm": {"100m Freestyle": "1:00.00", "50m Freestyle": "27.00"}, "pbs_scm": {},
           "pbs_scy": {"100y Freestyle": "52.00"}, "one_year_goal_times": {"100m Freestyle": "57.00"}, "main_events": ["100m Freestyle"]}
RACED = date(2026, 10, 3)


class RacesCase(unittest.TestCase):
    """The athlete's races, in a database of their own."""

    def setUp(self):
        self.db = FakeDatabase()
        patcher = patch.object(training, "get_supabase_client", return_value=self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def race(self, event, time, course="LCM", day=RACED, name="Club champs"):
        """A race logged on the Performance page."""
        self.db.add(f"race:{event}:{time}:{course}:{day}", "performance_race", day, {"record": {
            "date": day.isoformat(), "course": course, "event": event, "competition": name, "final_time": time, "splits": [],
            "stroke_rate": None, "notes": ""}})

    def result(self, event, time, pool=50, day=RACED, name="County meet"):
        """A result logged at one of the athlete's meets: the meet's id."""
        meet = self.db.add(f"meet:{name}:{day}", "competition", day, {"competition": {
            "name": name, "date": day.isoformat(), "location": "Pool", "pool_length": pool, "events": [event], "priority": "B"}})
        self.db.add(f"result:{meet}:{event}", "race_result", day, {"competition_id": meet, "result": {
            "event": event, "final_time": time, "splits": [], "ranking": None, "stroke_rate": None, "underwaters": "", "feedback": ""}})
        return meet


class RacePbTests(RacesCase):
    def test_a_faster_race_is_the_pb_from_then_on_and_a_slower_one_isnt(self):
        self.race("100m Freestyle", "58.50")
        self.race("50m Freestyle", "27.40")
        self.assertEqual(paces.race_pbs(PROFILE), {"pbs_lcm": {"100m Freestyle": {
            "time": "58.50", "date": "2026-10-03", "race": "Club champs", "profile_pb": "1:00.00"}}})

    def test_the_fastest_race_counts_and_an_event_without_a_profile_pb_gets_one(self):
        self.race("100m Freestyle", "59.10")
        self.race("100m Freestyle", "58.70", day=date(2026, 10, 10), name="Time trial")
        self.race("200m Freestyle", "2:10.00")
        pbs = paces.race_pbs(PROFILE)["pbs_lcm"]
        self.assertEqual((pbs["100m Freestyle"]["time"], pbs["100m Freestyle"]["race"]), ("58.70", "Time trial"))
        self.assertEqual(pbs["200m Freestyle"], {"time": "2:10.00", "date": "2026-10-03", "race": "Club champs"})

    def test_a_meet_result_counts_in_its_pools_course(self):
        self.result("100m Freestyle", "1:01.00", pool=25)
        self.assertEqual(paces.race_pbs(PROFILE), {"pbs_scm": {"100m Freestyle": {"time": "1:01.00", "date": "2026-10-03", "race": "County meet"}}})

    def test_yards_are_their_own_course(self):
        self.race("100y Freestyle", "50.00", course="SCY")
        self.assertEqual(paces.race_pbs(PROFILE)["pbs_scy"]["100y Freestyle"]["profile_pb"], "52.00")

    def test_a_time_no_swimmer_could_swim_is_never_a_pb_and_a_profile_typo_gives_way(self):
        self.race("100m Freestyle", "28.00")                       # 28 s for 100 m: a 50's time, logged as a 100
        self.assertEqual(paces.race_pbs(PROFILE), {})
        typo = {**PROFILE, "pbs_lcm": {"100m Freestyle": "9.00"}}
        self.race("100m Freestyle", "59.00")
        self.assertEqual(paces.race_pbs(typo)["pbs_lcm"]["100m Freestyle"]["time"], "59.00")

    def test_a_record_that_cant_be_read_is_left_out_and_the_rest_still_count(self):
        meet = self.result("100m Freestyle", "1:01.00", pool=25)
        del self.db.rows[meet]                                     # a result whose meet is gone
        self.race("100m Freestyle", "58.50")
        with self.assertLogs("app.paces", "WARNING"):
            pbs = paces.race_pbs(PROFILE)
        self.assertEqual(list(pbs), ["pbs_lcm"])

    def test_nothing_is_saved(self):
        self.race("100m Freestyle", "58.50")
        before = self.db.snapshot()
        paces.with_current_pbs(PROFILE)
        self.assertEqual((self.db.snapshot(), self.db.writes), (before, []))


class WithCurrentPbsTests(RacesCase):
    def test_the_races_are_read_once(self):
        self.race("100m Freestyle", "58.50")
        current = paces.with_current_pbs(PROFILE)
        self.assertEqual(current["current_pbs"]["pbs_lcm"]["100m Freestyle"]["time"], "58.50")
        self.assertEqual({key: value for key, value in current.items() if key != "current_pbs"}, PROFILE)
        self.assertNotIn("current_pbs", PROFILE)                   # the profile itself is left as it was
        with patch.object(paces, "race_pbs", side_effect=AssertionError("read again")):
            self.assertIs(paces.with_current_pbs(current), current)

    def test_when_the_races_cant_be_read_the_profiles_pbs_are_used(self):
        with patch.object(paces, "race_pbs", side_effect=RuntimeError("database down")), self.assertLogs("app.paces", "ERROR"):
            current = paces.with_current_pbs(PROFILE)
        self.assertEqual(current["current_pbs"], {})
        self.assertEqual(training.athlete_brief(current), training.athlete_brief(PROFILE))


class PacedFromCurrentPbsTests(RacesCase):
    def test_the_brief_and_the_pace_checks_use_the_race_pb(self):
        self.race("100m Freestyle", "58.50")
        self.race("50m Freestyle", "26.00")
        current = paces.with_current_pbs(PROFILE)
        times = training.athlete_brief(current)["times_by_event"]
        self.assertEqual(times["100m Freestyle"]["LCM PB"], {"time": "58.50", "seconds": 58.5, "pace_per_100m_seconds": 58.5,
                                                             "set_in_race": "Club champs on 2026-10-03", "onboarding_pb": "1:00.00"})
        self.assertEqual(times["100m Freestyle"]["1-year goal"]["time"], "57.00")    # goals stay the athlete's
        self.assertEqual((training.best_pace(PROFILE), training.best_pace(current)), (54.0, 52.0))
        self.assertEqual(training.pb_times(current, "pbs_lcm"), {"100m Freestyle": "58.50", "50m Freestyle": "26.00"})
        self.assertNotIn("current_pbs", training.athlete_data(current))         # the onboarding record stays as it was answered

    def test_without_races_the_brief_is_as_it_always_was(self):
        brief = training.athlete_brief(paces.with_current_pbs(PROFILE))
        self.assertEqual(brief, training.athlete_brief(PROFILE))
        self.assertEqual(brief["times_by_event"]["100m Freestyle"]["LCM PB"], {"time": "1:00.00", "seconds": 60.0, "pace_per_100m_seconds": 60.0})

    def test_a_race_plan_targets_the_pb_as_it_stands_now(self):
        self.result("100m Freestyle", "1:02.00", pool=25, day=date(2026, 9, 26))
        meet = {"id": "meet-1", "name": "Short course champs", "date": "2030-03-01", "pool_length": 25, "events": ["100m Freestyle"], "races": []}
        written = {}
        with patch.object(training, "get_authenticated_profile", return_value=dict(PROFILE)), \
                patch.object(training, "owned_competition", return_value=meet), \
                patch.object(tokens, "charged", return_value=nullcontext()), \
                patch.object(training, "_write_race_plans", side_effect=lambda profile, identifier, meet, targets: written.update(targets)):
            training.generate_race_plan(UUID(int=1), "Bearer token")
        self.assertEqual(written, {"100m Freestyle": "1:02.00"})    # the profile has no SCM PB; the race set one


if __name__ == "__main__":
    unittest.main()
