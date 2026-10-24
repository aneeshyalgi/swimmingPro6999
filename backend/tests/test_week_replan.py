from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from app import training
from app.coach_programs import program_for
from app.swim_planner import assign_week

TODAY = date(2026, 10, 14)  # a Wednesday
MONDAY = TODAY - timedelta(days=TODAY.weekday())
DAYS = [MONDAY + timedelta(days=index) for index in range(7)]
MON, TUE, WED, THU, FRI, SAT, SUN = DAYS
WEEK_ID = "week-row"
PROFILE = {"id": "row-1", "facilities": ["50m Pool"], "recommended_coaches": ["Coach Robert"]}


class Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(TODAY.year, TODAY.month, TODAY.day, 10, tzinfo=timezone.utc)


def swim(title, meters=1000):
    return {"title": title, "objective": "Train.", "event": None, "notes": "", "estimated_duration_minutes": 60,
            "main_training_zones": ["Aerobic"], "equipment": [],
            "sets": [{"name": "Main", "rounds": 1, "repetitions": meters // 100, "distance_meters": 100, "stroke": "Freestyle",
                      "interval": "@1:40", "target_time": None, "training_zone": "Aerobic", "equipment": [], "description": "Steady.",
                      "technical_focus": ["Long strokes"]}]}


def mobility(name):
    return [{"category": "Shoulder mobility", "exercise": name, "duration_minutes": 5, "instructions": ["Slowly."]}]


def key(day, position):
    return f"{WEEK_ID}:{day}:{position}"


class Athlete:
    """One athlete's saved swim week, as the training records hold it, and what re-planning it saves."""

    def __init__(self, swims_a_week=6):
        self.swims_a_week = swims_a_week
        self.days = {day.isoformat(): {"date": day.isoformat(), "objective": f"Old plan {day:%a}", "swims": [], "strength": None,
                                       "mobility": mobility(f"Old mobility {day:%a}"), "recovery": ["Sleep"], "rest": True} for day in DAYS}
        self.removed: set[str] = set()
        self.ticked: set[str] = set()     # swim keys ticked off
        self.states: dict[str, dict] = {}  # swim key -> favorite / template
        self.own: dict[str, list[str]] = {}  # day -> the athlete's own swims (titles)
        self.mobility_done: set[str] = set()
        self.meets: dict[str, str] = {}
        self.chosen: list[int] | None = None   # the swims a day the athlete chose on the dashboard, if they did
        self.saved = None
        self.layout = None

    def plan_swim(self, day, title):
        entry = self.days[day.isoformat()]
        entry["swims"].append(swim(title))
        entry["rest"] = False
        return key(day, len(entry["swims"]) - 1)

    # ---- the records, as the training module reads them
    def row(self):
        details = {"plan": {"phase": "Build", "days": list(self.days.values()), "coaching_note": "Old note"}, "pool_length": 50,
                   "source_files": ["Old session"], "removed": sorted(self.removed)}
        return {"id": WEEK_ID, "details": details}

    def view(self, profile, week_start):
        days = []
        for day in DAYS:
            iso = day.isoformat()
            items = [{"key": key(iso, position), "origin": "Weekly plan", "workout": item, "completed": key(iso, position) in self.ticked,
                      "favorite": self.states.get(key(iso, position), {}).get("favorite", False),
                      "template": self.states.get(key(iso, position), {}).get("template", False)}
                     for position, item in enumerate(self.days[iso]["swims"]) if key(iso, position) not in self.removed]
            items += [{"key": f"own:{iso}:{index}", "origin": "My workout", "workout": swim(title), "completed": False, "favorite": False,
                       "template": False} for index, title in enumerate(self.own.get(iso, []))]
            days.append({"date": iso, "workouts": items, "mobility_completed": iso in self.mobility_done,
                         "competitions": [{"name": self.meets[iso]}] if iso in self.meets else []})
        return {"generated": True, "days": days}

    def records(self, profile_id, kinds):
        return ([{"session_type": "swim", "details": {"workout_key": item}} for item in self.ticked]
                + [{"session_type": "workout_state", "details": {"key": item, **state}} for item, state in self.states.items()])

    def write(self, profile, week_start, phase, layout, context, swim_plan, swim_slots, assignments, days_to_plan):
        """Stands in for the coach: every new swim is its coach session's title."""
        self.layout, self.swim_plan, self.assignments, self.days_to_plan = layout, swim_plan, assignments, days_to_plan
        note = training.WeekNote(phase="Build", coaching_note="New note")
        plans = {day: training.DayPlan(objective=f"New plan {day:%a}", mobility=mobility(f"New mobility {day:%a}"), recovery=["Rest"])
                 for day in days_to_plan}
        written = {slot: training.SwimSession.model_validate(swim(training._session_title(assignments[slot]))) for slot in swim_slots}
        return note, plans, written

    # ---- re-planning
    def replan(self, during=None):
        client = MagicMock()
        client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value.data = [{"id": WEEK_ID}]

        def write(*args):
            result = self.write(*args)
            if during:
                during()
            return result

        with ExitStack() as stack:
            for name, value in {"week_view": self.view, "find_record": lambda profile_id, record: self.row(), "load_records": self.records,
                                "_week_settings": lambda profile: ("Build", self.swims_a_week), "competitions": lambda profile: [],
                                "_write_week": write, "get_supabase_client": lambda: client, "datetime": Frozen}.items():
                stack.enter_context(patch.object(training, name, value))
            stack.enter_context(patch("app.training_days.chosen", lambda profile: self.chosen and {"swim": self.chosen, "gym": None, "mobility": True}))
            training.replan_week(PROFILE, MONDAY)
        update = client.table.return_value.update
        self.saved = update.call_args.args[0]["details"] if update.called else None
        return self.saved

    def saved_day(self, day):
        return next(item for item in self.saved["plan"]["days"] if item["date"] == day.isoformat())


class ReplanWeekTests(unittest.TestCase):
    def setUp(self):
        self.athlete = Athlete()
        self.sessions = {}
        for day in DAYS[:6]:
            self.sessions[day] = self.athlete.plan_swim(day, f"Old swim {day:%a}")

    def test_the_days_before_today_stay_exactly_as_they_were(self):
        athlete = self.athlete
        athlete.ticked.add(self.sessions[MON])
        athlete.mobility_done.add(TUE.isoformat())
        before = {day: dict(athlete.days[day.isoformat()]) for day in (MON, TUE)}
        saved = athlete.replan()
        self.assertEqual(athlete.saved_day(MON), before[MON])
        self.assertEqual(athlete.saved_day(TUE), before[TUE])
        self.assertEqual(athlete.days_to_plan, DAYS[2:])
        self.assertTrue(all("already planned; keep the preserved plan" in line for line in athlete.layout[:2]))
        self.assertEqual((saved["plan"]["coaching_note"], saved["pool_length"], saved["source_files"][0]), ("New note", 50, "Old session"))

    def test_swims_ticked_favorited_or_saved_as_a_template_keep_their_place(self):
        athlete = self.athlete
        athlete.ticked.add(self.sessions[WED])
        athlete.states[self.sessions[THU]] = {"favorite": True, "template": False}
        athlete.states[self.sessions[FRI]] = {"favorite": False, "template": True}
        athlete.states[self.sessions[SAT]] = {"favorite": False, "template": False}  # unfavorited again: replaced like any other
        athlete.replan()
        for day in (WED, THU, FRI):
            self.assertEqual(athlete.saved_day(day)["swims"], [swim(f"Old swim {day:%a}")])
        self.assertNotEqual(athlete.saved_day(SAT)["swims"], [swim("Old swim Sat")])
        self.assertEqual(athlete.saved_day(WED)["mobility"], mobility("New mobility Wed"))

    def test_the_rest_are_planned_again_with_the_coach_sessions_left_of_the_week(self):
        athlete = self.athlete
        saved = athlete.replan()
        titles = [athlete.saved_day(day)["swims"][0]["title"] if athlete.saved_day(day)["swims"] else None for day in DAYS]
        self.assertEqual(titles[:2], ["Old swim Mon", "Old swim Tue"])
        # 6 a week: the two before today count, so four new swims spread over Wednesday to Sunday.
        self.assertEqual(sum(bool(title) for title in titles[2:]), 4)
        order = [training._session_title(item) for item in assign_week("Coach Robert", MONDAY, 6)]
        self.assertEqual([title for title in titles[2:] if title], order[2:])  # the old swims' titles aren't the coach's: they take the first sessions
        for day in DAYS[2:]:
            self.assertEqual(athlete.saved_day(day)["objective"], f"New plan {day:%a}")
        self.assertEqual(saved["plan"]["days"][6]["rest"], not athlete.saved_day(SUN)["swims"])

    def test_a_swim_that_stays_takes_its_own_coach_session(self):
        athlete = self.athlete
        coach = program_for("Coach Robert")
        order = assign_week(coach.name, MONDAY, 6)
        athlete.days[MON.isoformat()]["swims"][0]["title"] = training._session_title(order[3])
        athlete.replan()
        new = [athlete.saved_day(day)["swims"][0]["title"] for day in DAYS[2:] if athlete.saved_day(day)["swims"]]
        self.assertNotIn(training._session_title(order[3]), new)
        self.assertEqual(len(new), len(set(new)))

    def test_the_week_never_has_more_swims_than_the_athletes_availability(self):
        athlete = self.athlete
        athlete.own[THU.isoformat()] = ["My swim"]
        athlete.ticked.add(self.sessions[WED])
        athlete.replan()
        plan = sum(len(athlete.saved_day(day)["swims"]) for day in DAYS)
        self.assertEqual(plan + 1, 6)
        self.assertEqual(athlete.saved_day(THU)["swims"], [])  # the athlete's own swim is the day's swim
        self.assertIn("1 swim already planned that stays (do not duplicate it)", athlete.layout[3])

    def test_more_swims_a_week_go_on_the_days_left_two_at_most(self):
        athlete = self.athlete
        athlete.swims_a_week = 14
        athlete.replan()
        self.assertEqual([len(athlete.saved_day(day)["swims"]) for day in DAYS], [1, 1, 2, 2, 2, 2, 2])

    def test_on_the_athletes_chosen_days_new_swims_go_only_there(self):
        athlete = self.athlete
        athlete.chosen = [1, 1, 2, 0, 1, 0, 1]      # 6 a week: two on Wednesday, none on Thursday or Saturday
        athlete.replan()
        self.assertEqual([len(athlete.saved_day(day)["swims"]) for day in DAYS], [1, 1, 2, 0, 1, 0, 1])
        self.assertTrue(athlete.saved_day(THU)["rest"])
        self.assertIn("rest / recovery day", athlete.layout[3])

    def test_a_chosen_day_with_a_swim_that_stays_gets_no_second_one(self):
        athlete = self.athlete
        athlete.chosen = [1, 1, 1, 1, 1, 1, 0]
        athlete.ticked.add(self.sessions[WED])
        athlete.replan()
        self.assertEqual([len(athlete.saved_day(day)["swims"]) for day in DAYS], [1, 1, 1, 1, 1, 1, 0])
        self.assertEqual(athlete.saved_day(WED)["swims"], [swim("Old swim Wed")])

    def test_no_coach_swim_on_race_day(self):
        athlete = self.athlete
        athlete.meets[FRI.isoformat()] = "City Champs"
        athlete.replan()
        self.assertEqual(athlete.saved_day(FRI)["swims"], [])
        self.assertFalse(athlete.saved_day(FRI)["rest"])
        self.assertTrue(athlete.layout[4].startswith(f"{FRI} (Friday): race day (City Champs)"))

    def test_ticked_mobility_and_strength_stay(self):
        athlete = self.athlete
        athlete.mobility_done.add(WED.isoformat())
        strength = {"title": "Legacy strength", "objective": "Power", "estimated_duration_minutes": 40,
                    "exercises": [{"exercise": "Squat", "sets": 3, "repetitions": "5", "load": "Moderate", "rest_seconds": 90, "tempo": None,
                                   "demonstration": ["Brace."]}]}
        athlete.days[SUN.isoformat()]["strength"] = strength
        athlete.days[SUN.isoformat()]["rest"] = False
        athlete.replan()
        self.assertEqual(athlete.saved_day(WED)["mobility"], mobility("Old mobility Wed"))
        self.assertEqual(athlete.saved_day(THU)["mobility"], mobility("New mobility Thu"))
        self.assertEqual(athlete.saved_day(SUN)["strength"], strength)
        self.assertFalse(athlete.saved_day(SUN)["rest"])

    def test_a_hidden_swim_with_a_tick_or_favorite_keeps_its_place_hidden(self):
        athlete = self.athlete
        athlete.removed.add(self.sessions[WED])
        athlete.states[self.sessions[WED]] = {"favorite": True, "template": False}
        athlete.swims_a_week = 7
        saved = athlete.replan()
        swims = athlete.saved_day(WED)["swims"]
        self.assertEqual(swims[0], swim("Old swim Wed"))
        self.assertIn(key(WED, 0), saved["removed"])
        self.assertEqual(len(swims), 2)  # today's new swim goes in the next place, under a key of its own
        self.assertNotIn(key(WED, 1), saved["removed"])

    def test_a_hidden_swim_without_one_gives_its_place_to_a_new_swim(self):
        athlete = self.athlete
        athlete.removed.add(self.sessions[WED])
        saved = athlete.replan()
        self.assertEqual(len(athlete.saved_day(WED)["swims"]), 1)
        self.assertNotEqual(athlete.saved_day(WED)["swims"][0], swim("Old swim Wed"))
        self.assertNotIn(key(WED, 0), saved["removed"])

    def test_a_place_left_empty_below_a_swim_that_stays_keeps_its_old_swim_hidden(self):
        athlete = self.athlete
        second = athlete.plan_swim(THU, "Old second swim Thu")
        athlete.ticked.add(second)
        athlete.swims_a_week = 4
        saved = athlete.replan()
        self.assertEqual(athlete.saved_day(THU)["swims"], [swim("Old swim Thu"), swim("Old second swim Thu")])
        self.assertIn(key(THU, 0), saved["removed"])
        self.assertNotIn(key(THU, 1), saved["removed"])

    def test_a_week_that_changed_meanwhile_is_not_saved(self):
        athlete = self.athlete
        with self.assertRaises(HTTPException) as caught:
            athlete.replan(during=lambda: athlete.ticked.add(self.sessions[THU]))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIn("changed while it was being re-planned", caught.exception.detail)
        self.assertIsNone(athlete.saved)

    def test_a_week_that_breaks_the_rules_is_not_saved(self):
        athlete = self.athlete
        athlete.days[MON.isoformat()]["swims"].append(swim("Too much", 12000))
        athlete.days[MON.isoformat()]["swims"].append(swim("Way too much", 12000))
        with self.assertRaises(Exception):
            athlete.replan()
        self.assertIsNone(athlete.saved)

    def test_a_week_that_is_over_is_refused_and_one_not_generated_is_generated(self):
        with patch.object(training, "datetime", Frozen):
            with self.assertRaises(HTTPException) as caught:
                training.replan_week(PROFILE, MONDAY - timedelta(days=7))
            self.assertEqual(caught.exception.status_code, 409)
            with patch.object(training, "_replan_state", return_value=None), patch.object(training, "build_week", return_value={"built": True}) as build:
                self.assertEqual(training.replan_week(PROFILE, MONDAY + timedelta(days=7)), {"built": True})
            build.assert_called_once_with(PROFILE, MONDAY + timedelta(days=7))


if __name__ == "__main__":
    unittest.main()
