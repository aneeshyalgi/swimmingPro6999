"""What the athlete did with their plan (app/training_log.py): how their swims went lately, which eases a week back in only
for an athlete who ticks their swims off, and their weeks as the coach chat sees them."""
from datetime import date, timedelta
import unittest
from unittest.mock import patch

from app import training, training_log
from tests.test_week_coach import DAY, MONDAY, PROFILE, TODAY, FakeDatabase, WeekCoachCase, swim

MON = MONDAY                      # this week (TODAY is its Wednesday)
EASE_NONE = {"planned": 0, "done": 0, "ticks": False, "ease": 1.0, "period": "over the last 14 days", "text": ""}


def week_plan(monday: date, swims: dict[int, str]) -> dict:
    """A generated swim week with a swim on each day of `swims` ({weekday: title})."""
    days = [{"date": (monday + timedelta(days=index)).isoformat(), "objective": "Plan.", "swims": [swim(swims[index])] if index in swims else [],
             "strength": None, "mobility": [], "recovery": ["Sleep"], "rest": index not in swims} for index in range(7)]
    return training.WeekPlan.model_validate({"phase": "Build", "days": days, "coaching_note": "Note."}).model_dump(mode="json")


class RecordsCase(unittest.TestCase):
    """An athlete's records in a database of their own."""

    def setUp(self):
        self.db = FakeDatabase()
        patcher = patch.object(training, "get_supabase_client", return_value=self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def week(self, monday: date, weekdays=(0, 1, 3, 4, 5), removed=()) -> list[str]:
        """A generated week with a swim on each of `weekdays`: the swims' keys, in order."""
        swims = {index: f"Swim {monday + timedelta(days=index)}" for index in weekdays}
        row = self.db.add(f"week:{monday}", "week_plan", monday, {"plan": week_plan(monday, swims), "pool_length": 50, "source_files": []})
        keys = [f"{row}:{monday + timedelta(days=index)}:0" for index in weekdays]
        if removed:
            self.db.rows[row]["details"]["removed"] = [keys[index] for index in removed]
        return keys

    def tick(self, *keys: str):
        for key in keys:
            day = date.fromisoformat(key.split(":")[1])
            self.db.add(f"completed:{key}", "swim", day, {"workout_key": key, "completion_status": "completed"})

    def recent(self) -> dict:
        return training_log.recent_training(PROFILE, TODAY)


class RecentTrainingTests(RecordsCase):
    def habit(self):
        """A week three weeks ago with most of its swims ticked off: the athlete ticks their swims off."""
        self.tick(*self.week(MON - timedelta(weeks=3))[:4])

    def lately(self) -> list[str]:
        """The ten swims planned over the last 14 days (TODAY is a Wednesday): three of the week two weeks ago, five of last
        week's and Monday and Tuesday of this week."""
        keys = [key for key in self.week(MON - timedelta(weeks=2)) if key.split(":")[1] >= (TODAY - timedelta(days=14)).isoformat()]
        keys += self.week(MON - timedelta(weeks=1))
        keys += self.week(MON)[:2]
        self.assertEqual(len(keys), 10)
        return keys

    def test_an_athlete_who_never_ticks_a_swim_off_is_planned_as_always(self):
        self.lately()
        recent = self.recent()
        self.assertEqual((recent["planned"], recent["done"], recent["ticks"], recent["ease"]), (10, 0, False, 1.0))
        self.assertIn("0 of 10 swims ticked off (0 of 14,000 m)", recent["text"])
        self.assertIn("They don't tick every swim off, so a past swim that isn't ticked off may still have been done: never assume it was missed.",
                      recent["text"])

    def test_after_many_missed_swims_an_athlete_who_ticks_them_off_eases_back_in(self):
        self.habit()
        keys = self.lately()
        self.tick(*keys[:2])
        recent = self.recent()
        self.assertEqual((recent["planned"], recent["done"], recent["ticks"], recent["ease"]), (10, 2, True, 0.75))
        self.assertIn("They tick their swims off", recent["text"])

    def test_some_missed_eases_a_little_and_half_done_is_planned_in_full(self):
        self.habit()
        keys = self.lately()
        self.tick(*keys[:4])
        self.assertEqual(self.recent()["ease"], 0.85)
        self.tick(keys[4])
        self.assertEqual((self.recent()["done"], self.recent()["ease"]), (5, 1.0))

    def test_ticking_most_of_a_recent_week_shows_the_habit_too(self):
        keys = self.lately()
        self.tick(*keys[3:8])        # all five of last week's
        recent = self.recent()
        self.assertEqual((recent["ticks"], recent["done"], recent["ease"]), (True, 5, 1.0))

    def test_too_few_swims_lately_say_nothing_either_way(self):
        self.habit()
        self.week(MON - timedelta(weeks=1), weekdays=(4, 5))
        recent = self.recent()
        self.assertEqual((recent["planned"], recent["done"], recent["ease"]), (2, 0, 1.0))

    def test_a_swim_still_ahead_today_counts_once_ticked_off_and_is_never_missed(self):
        self.habit()
        monday, wednesday = self.week(MON, weekdays=(0, 2))
        self.assertEqual((self.recent()["planned"], self.recent()["done"]), (1, 0))
        self.tick(wednesday)
        self.assertEqual((self.recent()["planned"], self.recent()["done"]), (2, 1))

    def test_swims_before_the_athlete_started_ticking_sessions_off_say_nothing(self):
        self.week(MON - timedelta(weeks=1))                     # five swims last week, none ticked off: they didn't tick yet
        self.tick(*self.week(MON)[:2])                          # this week they did: Monday's and Tuesday's
        recent = self.recent()
        self.assertEqual((recent["planned"], recent["done"], recent["ticks"], recent["ease"]), (2, 2, True, 1.0))
        self.assertEqual(recent["period"], "since Mon 19 Oct, when they started ticking sessions off")
        self.assertIn("in SwimGPT since Mon 19 Oct, when they started ticking sessions off): 2 of 2 swims ticked off", recent["text"])
        # A gym workout or mobility ticked off is a start too: last week's swims after it count.
        self.db.add("gym:1", "gym_workout", MON - timedelta(days=4), {"workout": {"title": "Legs", "estimated_duration_minutes": 40, "exercises": []},
                                                                     "date": (MON - timedelta(days=4)).isoformat(), "dose": "Moderate", "focus": "Lower body"})
        self.db.add("gym-completed:1", "strength", MON - timedelta(days=4), {"completion_status": "completed", "gym_key": training.record_id("row-1", "gym:1")})
        self.assertEqual((self.recent()["planned"], self.recent()["done"]), (5, 2))   # Thursday's, Friday's and Saturday's of last week too

    def test_swims_the_athlete_took_off_their_week_are_not_missed_and_their_own_count(self):
        self.week(MON - timedelta(weeks=1), removed=(0, 1))
        self.db.add("own-swim:1", "workout", MON - timedelta(days=3), {
            "workout": swim("My own swim"), "date": (MON - timedelta(days=3)).isoformat(), "phase": "Build", "pool_length": 50, "event": None,
            "template": False, "source": "manual", "source_files": []})
        self.assertEqual(self.recent()["planned"], 4)       # the plan's three left and their own

    def test_nothing_planned_lately_says_nothing(self):
        self.assertEqual(self.recent(), EASE_NONE)

    def test_records_that_cant_be_read_never_fail_what_asked(self):
        with patch.object(training_log, "read_training", side_effect=RuntimeError("database down")), \
                self.assertLogs("app.training_log", "ERROR"):
            self.assertEqual(self.recent(), EASE_NONE)


class WeekLoadTests(unittest.TestCase):
    MISSED = {"planned": 10, "done": 2, "ticks": True, "ease": 0.75, "text": "..."}

    def test_only_this_week_and_next_ease_and_never_a_taper(self):
        for weeks, taper, ease in ((0, False, 0.75), (1, False, 0.75), (2, False, 1.0), (0, True, 1.0)):
            kept, line = training_log.week_load(self.MISSED, MON + timedelta(weeks=weeks), TODAY, taper)
            self.assertEqual(kept, ease, (weeks, taper))
            self.assertEqual(line.startswith("EASING BACK IN: the athlete ticked off only 2 of the 10 swims"), ease < 1)

    def test_a_consistent_athlete_hears_so_and_anyone_else_nothing(self):
        kept, line = training_log.week_load({"planned": 10, "done": 8, "ticks": True, "ease": 1.0}, MON, TODAY, False)
        self.assertEqual(kept, 1.0)
        self.assertIn("ticked off 8 of the 10 swims planned over the last 14 days: they're swimming consistently", line)
        for recent in ({"planned": 10, "done": 0, "ticks": False, "ease": 1.0}, {"planned": 2, "done": 2, "ticks": True, "ease": 1.0}, EASE_NONE):
            self.assertEqual(training_log.week_load(recent, MON, TODAY, False), (1.0, ""))


class CoachWeeksTests(WeekCoachCase):
    """The coach chat's view of the athlete's weeks (tests/test_week_coach.py has the week: TODAY is its Wednesday)."""

    def weeks(self) -> str:
        return training_log.coach_weeks(PROFILE, TODAY)

    def test_each_day_with_what_was_ticked_off_and_todays_sessions_in_full(self):
        text = self.weeks()
        self.assertIn("(today is Wednesday 21 October 2026)", text)
        self.assertIn("LAST WEEK (Mon 12 Oct to Sun 18 Oct): no swim week was generated for it; nothing was planned on it.", text)
        self.assertIn("THIS WEEK (Mon 19 Oct to Sun 25 Oct; phase: Build; the coach's note for it: \"A build week.\"): "
                      "so far 0 of 1 swim ticked off (0 of 1,400 m).", text)
        for line in ("- Mon 19 Oct: swim \"Monday threshold\", 1,400 m, 45 min, not ticked off",
                     "- Tue 20 Oct: rest day",
                     "- Wed 21 Oct (today): swim \"Wednesday aerobic\", 1,400 m, 45 min, not ticked off yet; "
                     "gym workout \"Leg power\", 40 min, not ticked off yet",
                     "- Thu 22 Oct: swim \"Thursday sprint\", 1,400 m, 45 min; mobility, 10 min",
                     "- Fri 23 Oct: swim (their own) \"My own swim\", 1,400 m, 45 min; gym workout \"Pull day\", 45 min",
                     "- Sat 24 Oct: rest day; mobility, 5 min"):
            self.assertIn(line + "\n", text)
        self.assertIn("NEXT WEEK (Mon 26 Oct to Sun 1 Nov): its swim week isn't generated yet; nothing is planned on it yet.", text)
        self.assertNotIn("Mon 26 Oct:", text)                              # an empty week is one line
        today = text.split("TODAY'S SESSIONS IN FULL:\n")[1]
        self.assertIn("Swim \"Wednesday aerobic\" (1,400 m, 45 min, not ticked off yet):\n", today)
        self.assertIn("  2. Main Set: 8 x 100: 8 x 100 m Freestyle, @1:30, Threshold, with paddles\n", today)
        self.assertIn("Gym workout \"Leg power\", not ticked off yet:\n  1. Goblet squat 3 x 8, RPE 7, rest 90 s", today)

    def test_what_they_ticked_off_is_done(self):
        monday = f"{self.week_id}:{DAY['Monday'].isoformat()}:0"
        self.db.add(f"completed:{monday}", "swim", DAY["Monday"], {"workout_key": monday, "completion_status": "completed"})
        self.db.add(f"gym-completed:{self.ai_gym}", "strength", TODAY, {"completion_status": "completed", "gym_key": self.ai_gym})
        self.db.add(f"mobility-completed:{DAY['Thursday']}", "mobility", DAY["Thursday"], {"completion_status": "completed"})
        text = self.weeks()
        self.assertIn("so far 1 of 1 swim ticked off (1,400 of 1,400 m); so far 1 of 1 gym workout ticked off.", text)
        self.assertIn("- Mon 19 Oct: swim \"Monday threshold\", 1,400 m, 45 min, done\n", text)
        self.assertIn("gym workout \"Leg power\", 40 min, done\n", text)
        self.assertIn("- Thu 22 Oct: swim \"Thursday sprint\", 1,400 m, 45 min; mobility, 10 min\n", text)   # still ahead: no status

    def test_a_swimmer_who_ticks_their_swims_off_is_read_as_one(self):
        self.assertIn("They don't tick every swim off", self.weeks())
        previous = MON - timedelta(weeks=1)
        row = self.db.add(f"week:{previous}", "week_plan", previous, {"plan": week_plan(previous, {0: "A", 2: "B", 4: "C"}), "pool_length": 50})
        for index in (0, 2):
            key = f"{row}:{previous + timedelta(days=index)}:0"
            self.db.add(f"completed:{key}", "swim", previous + timedelta(days=index), {"workout_key": key, "completion_status": "completed"})
        text = self.weeks()
        self.assertIn("They tick their swims off (most of a week's swims ticked off), so a past swim that isn't ticked off was most likely missed.", text)
        self.assertIn("LAST WEEK (Mon 12 Oct to Sun 18 Oct; phase: Build): 2 of 3 swims ticked off (2,800 of 4,200 m).", text)
        self.assertIn("- Fri 16 Oct: swim \"C\", 1,400 m, 45 min, not ticked off\n", text)

    def test_a_meet_is_on_its_day(self):
        self.db.add("meet:1", "competition", DAY["Saturday"], {"competition": {"name": "Club champs", "priority": "B", "date": DAY["Saturday"].isoformat()}})
        self.assertIn("- Sat 24 Oct: rest day; meet: Club champs (B priority); mobility, 5 min\n", self.weeks())

    def test_records_that_cant_be_read_leave_the_coach_as_before(self):
        with patch.object(training_log, "read_training", side_effect=RuntimeError("database down")), \
                self.assertLogs("app.training_log", "ERROR"):
            self.assertEqual(self.weeks(), "")


if __name__ == "__main__":
    unittest.main()
