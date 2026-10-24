from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import json
from itertools import count
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import gym, training, week_coach
from app.coach_plan import CoachExercise, CoachSection
from app.main import app
from app.week_coach import (
    AdjustedExercise, AdjustedSet, Board, BuilderEdit, Change, CoachAnswer, Entry, GymEdit, KeptItem, KeptSet, SwimEdit,
    answer_issues, edited_doc, edited_gym, edited_swim, doc_display, workout_doc,
)

HEADERS = {"Authorization": "Bearer token"}
PROFILE = {"id": "row-1", "facilities": ["50m Pool", "Full Gym Access"], "main_events": ["100m Freestyle"],
           "recommended_coaches": ["Coach Brad"], "session_duration": 90, "swim_sessions_per_week": 4, "gym_sessions_per_week": 2}
TODAY = date(2026, 10, 21)          # a Wednesday
MONDAY = TODAY - timedelta(days=TODAY.weekday())
DAY = {name: MONDAY + timedelta(days=index) for index, name in enumerate(week_coach.WEEKDAYS)}
CHANGE_SET = "3f2e1d0c-9b8a-4c7d-8e6f-5a4b3c2d1e0f"


def item_id(number: int) -> str:
    return f"00000000-0000-4000-8000-{number:012d}"


def swim_set(name: str, repetitions: int, distance: int, zone: str = "Aerobic", gear: list[str] | None = None) -> dict:
    return {"name": name, "rounds": 1, "repetitions": repetitions, "distance_meters": distance, "stroke": "Freestyle",
            "interval": "@1:30", "target_time": None, "training_zone": zone, "equipment": gear or [], "description": f"{name}.",
            "technical_focus": ["Long strokes"]}


def swim(title: str, *sets: dict) -> dict:
    sets = list(sets) or [swim_set("Warm-Up: Easy", 1, 400, "Recovery"), swim_set("Main Set: 8 x 100", 8, 100, "Threshold", ["paddles"]),
                          swim_set("Warm-Down: Easy", 1, 200, "Recovery")]
    return training.SwimSession(title=title, objective=f"{title} objective.", event=None, notes="", estimated_duration_minutes=45,
                                main_training_zones=["Threshold"], equipment=["paddles"], sets=sets).model_dump(mode="json")


def mobility(*names: str) -> list[dict]:
    return [{"category": "Shoulder mobility", "exercise": name, "duration_minutes": 5, "instructions": ["Slowly."]} for name in names]


def gym_workout(title: str, *exercises: str) -> dict:
    return gym.GymWorkout(title=title, objective="Strength for starts.", rationale="Build power.", intensity="Moderate", estimated_duration_minutes=40,
                          warm_up=["Jog 5 minutes"], exercises=[gym.GymExercise(exercise=name, sets=3, repetitions="8", load="RPE 7", rest_seconds=90,
                                                                                demonstration=["Brace.", "Lift."], swim_benefit="Faster starts.")
                                                                for name in exercises or ("Goblet squat", "Push-up")],
                          cool_down=["Stretch"], coaching_notes="Stop if it hurts.").model_dump()


def builder_workout(title: str) -> dict:
    doc = gym.BuilderWorkout(title=title, date=DAY["Friday"], start_time="07:00", end_time="07:45", label="Dryland", location="Club gym",
                             intensity="Moderate", notes="My own session.", sections=[
                                 gym.BuilderSection(id="a", title="Warm-Up", kind="warmup", notes="Jog"),
                                 gym.BuilderSection(id="b", title="Main", kind="main", exercises=[gym.BuilderExercise(name="Pull-up", sets=4, reps="6")])])
    return gym.builder_display(doc)


class FakeQuery:
    """The parts of the Supabase query builder the training code uses, over the database's rows."""

    def __init__(self, database):
        self.database, self.filters, self.action, self.payload, self.limit_to, self.sort = database, [], "select", None, None, []

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def in_(self, key, values):
        values = set(values)
        self.filters.append(lambda row: row.get(key) in values)
        return self

    def order(self, key, desc=False):
        self.sort.append((key, desc))
        return self

    def limit(self, number):
        self.limit_to = number
        return self

    def range(self, start, end):
        self.limit_to = end + 1
        return self

    def upsert(self, rows, on_conflict=None, ignore_duplicates=False):
        self.action, self.payload = "upsert", rows if isinstance(rows, list) else [rows]
        return self

    def update(self, values):
        self.action, self.payload = "update", values
        return self

    def delete(self):
        self.action = "delete"
        return self

    def execute(self):
        rows = self.database.rows
        if self.action == "upsert":
            if self.database.fail_upsert:
                raise RuntimeError("database down")
            saved = []
            for row in self.payload:
                stored = {**rows.get(row["id"], {"created_at": next(self.database.clock)}), **deepcopy(row)}
                rows[row["id"]] = stored
                saved.append(deepcopy(stored))
            self.database.writes.append(("upsert", sorted(row["id"] for row in self.payload)))
            return SimpleNamespace(data=saved)
        matched = [row for row in rows.values() if all(test(row) for test in self.filters)]
        if self.action == "delete":
            for row in matched:
                del rows[row["id"]]
            self.database.writes.append(("delete", sorted(row["id"] for row in matched)))
            return SimpleNamespace(data=deepcopy(matched))
        if self.action == "update":
            for row in matched:
                row.update(deepcopy(self.payload))
            return SimpleNamespace(data=deepcopy(matched))
        for key, desc in reversed(self.sort):
            matched.sort(key=lambda row: str(row.get(key)), reverse=desc)
        return SimpleNamespace(data=deepcopy(matched[:self.limit_to] if self.limit_to else matched))


class FakeDatabase:
    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.writes: list = []
        self.clock = (f"2026-10-01T00:00:{second:02d}" for second in count())
        self.fail_upsert = False

    def table(self, name):
        return FakeQuery(self)

    def add(self, key, kind, day, details, name="Session"):
        row = {"id": training.record_id(PROFILE["id"], key), "user_id": PROFILE["id"], "session_type": kind, "session_name": name,
               "session_date": f"{day}T00:00:00+00:00" if day else None, "details": details, "created_at": next(self.clock)}
        self.rows[row["id"]] = row
        return row["id"]

    def snapshot(self):
        return {key: {name: value for name, value in row.items() if name != "created_at"} for key, row in self.rows.items()
                if row["session_type"] != week_coach.CHANGE_KIND}


def week_plan() -> dict:
    days = []
    for name, day in DAY.items():
        swims = {"Monday": [swim("Monday threshold")], "Wednesday": [swim("Wednesday aerobic")], "Thursday": [swim("Thursday sprint")]}.get(name, [])
        days.append({"date": day.isoformat(), "objective": f"{name}'s plan.", "swims": swims, "strength": None,
                     "mobility": {"Thursday": mobility("Arm circles", "Thread the needle"), "Saturday": mobility("Cat-cow")}.get(name, []),
                     "recovery": ["Sleep 8 hours"], "rest": not swims})
    return training.WeekPlan.model_validate({"phase": "Build", "days": days, "coaching_note": "A build week."}).model_dump(mode="json")


class WeekCoachCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = FakeDatabase()
        self.week_id = self.db.add(f"week:{MONDAY}", "week_plan", MONDAY, {"plan": week_plan(), "pool_length": 50, "source_files": ["Coach Brad"]})
        self.own_id = self.db.add("own-swim:1", "workout", DAY["Friday"], {
            "workout": swim("My own swim"), "date": DAY["Friday"].isoformat(), "phase": "Build", "pool_length": 50, "event": None,
            "template": False, "source": "manual", "source_files": []})
        self.state_id = self.db.add(f"state:{self.own_id}", "workout_state", None, {"key": self.own_id, "favorite": True, "template": False})
        self.ai_gym = self.db.add("gym:ai", "gym_workout", TODAY, {"workout": gym_workout("Leg power"), "date": TODAY.isoformat(), "dose": "Moderate",
                                                                    "focus": "Lower body", "source": "ai", "week_start": MONDAY.isoformat()})
        self.own_gym = self.db.add("gym:own", "gym_workout", DAY["Friday"], {"workout": builder_workout("Pull day"), "date": DAY["Friday"].isoformat(),
                                                                              "dose": "Moderate", "focus": "Your own workout", "source": "manual"})
        self.patch(training, "get_supabase_client", return_value=self.db)
        self.patch(week_coach, "get_authenticated_profile", return_value=PROFILE)
        self.patch(week_coach, "_now", return_value=datetime(2026, 10, 21, 9, tzinfo=timezone.utc))
        self.patch(training, "datetime", wraps=datetime, **{"now.return_value": datetime(2026, 10, 21, 9, tzinfo=timezone.utc)})

    def patch(self, target, name, **options):
        patcher = patch.object(target, name, **options)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def board(self, kind="swim") -> Board:
        return week_coach.load_board(PROFILE, kind, MONDAY, TODAY)

    def plan_key(self, day: str, index: int = 0) -> str:
        return f"{self.week_id}:{DAY[day].isoformat()}:{index}"


class BoardTests(WeekCoachCase):
    def test_the_swim_week_reads_as_numbered_sessions_with_the_ones_that_cant_change_locked(self):
        board = self.board()
        refs = {(entry.ref, entry.kind, entry.date, entry.locked) for entry in board.entries}
        self.assertEqual(refs, {("S1", "swim", DAY["Monday"].isoformat(), "past"), ("S2", "swim", TODAY.isoformat(), None),
                                ("S3", "swim", DAY["Thursday"].isoformat(), None), ("S4", "swim", DAY["Friday"].isoformat(), None),
                                ("M1", "mobility", DAY["Thursday"].isoformat(), None), ("M2", "mobility", DAY["Saturday"].isoformat(), None)})
        self.assertIn("S3 swim: \"Thursday sprint\", 1,400 m, 45 min, from the generated week", board.text)
        self.assertIn("2. Main Set: 8 x 100: 8 x 100 m Freestyle = 800 m, @1:30, Threshold, with paddles", board.text)
        self.assertIn("S4 swim: \"My own swim\", 1,400 m, 45 min, the athlete's own", board.text)
        self.assertIn("Monday 2026-10-19 (past: locked)", board.text)

    def test_a_ticked_off_swim_is_locked(self):
        self.db.add(f"completed:{self.plan_key('Thursday')}", "swim", DAY["Thursday"], {"workout_key": self.plan_key("Thursday"), "completion_status": "completed"})
        self.assertEqual(self.board().entry("S3").locked, "ticked off")

    def test_the_gym_week_reads_its_workouts_in_both_forms(self):
        board = self.board("gym")
        self.assertEqual([(entry.ref, entry.builder) for entry in board.entries], [("G1", False), ("G2", True)])
        self.assertIn("1. Goblet squat 3 x 8, RPE 7, rest 90 s", board.text)
        self.assertIn("Main: Pull-up 4 x 6", board.text)


def change(action, session=None, day=None, new=None, instruction="", meters=None, minutes=None, label="A change"):
    return Change(action=action, session=session, new=new, day=day, instruction=instruction, meters=meters, minutes=minutes, label=label)


class AnswerTests(WeekCoachCase):
    def issues(self, *changes, kind="swim"):
        return answer_issues(CoachAnswer(message="Done.", changes=list(changes), elsewhere=False), self.board(kind))

    def test_changes_the_week_can_take_pass(self):
        self.assertEqual(self.issues(change("edit", "S3", instruction="Shorter", meters=1000), change("move", "S4", "Sunday"),
                                     change("add", day="Sunday", new="swim", instruction="Easy 1500", meters=1500),
                                     change("copy", "S1", "Saturday"), change("edit", "M1", instruction="Add a stretch")), [])

    def test_a_session_that_isnt_there_or_is_locked_is_sent_back(self):
        self.assertIn("isn't a session of this week", self.issues(change("edit", "S9", instruction="x"))[0])
        self.assertIn("can't be changed, because it's on a day that's already gone", self.issues(change("edit", "S1", instruction="x"))[0])
        self.assertIn("can't be moved", self.issues(change("move", "S1", "Sunday"))[0])

    def test_each_session_gets_one_change_and_needs_what_its_action_needs(self):
        self.assertIn("already has a change", self.issues(change("edit", "S3", instruction="x"), change("remove", "S3"))[0])
        self.assertIn("give the day", self.issues(change("move", "S3"))[0])
        self.assertIn("already on Thursday", self.issues(change("move", "S3", "Thursday"))[0])
        self.assertIn("say in instruction exactly what changes", self.issues(change("edit", "S3"))[0])
        self.assertTrue(any("give the day it goes on" in issue for issue in self.issues(change("add", new="swim", instruction="x"))))
        self.assertIn("new must be one of swim, mobility", self.issues(change("add", day="Sunday", new="strength", instruction="x"))[0])

    def test_nothing_goes_on_a_day_thats_over(self):
        self.assertIn("Tuesday is already over", self.issues(change("add", day="Tuesday", new="swim", instruction="x"))[0])

    def test_a_days_mobility_is_edited_where_there_is_some_and_comes_with_a_generated_week(self):
        self.assertIn("already has mobility (M1): edit it instead", self.issues(change("add", day="Thursday", new="mobility", instruction="x"))[0])
        self.assertEqual(self.issues(change("add", day="Sunday", new="mobility", instruction="Hips")), [])
        self.db.rows.pop(self.week_id)
        self.assertIn("isn't generated yet", self.issues(change("add", day="Sunday", new="mobility", instruction="x"))[0])

    def test_the_days_limits_hold_after_every_change(self):
        too_many = self.issues(change("add", day="Thursday", new="swim", instruction="x"), change("add", day="Thursday", new="swim", instruction="y"))
        self.assertIn("Thursday would have 3 swims", too_many[0])
        self.assertIn("16,000 m", self.issues(change("add", day="Sunday", new="swim", instruction="x", meters=9000),
                                              change("add", day="Sunday", new="swim", instruction="y", meters=8000))[0])
        self.assertIn("a swim is at most 12,000 m", self.issues(change("edit", "S3", instruction="x", meters=13000))[0])
        # A swim moving off a day makes room on it.
        self.assertEqual(self.issues(change("move", "S3", "Saturday"), change("add", day="Thursday", new="swim", instruction="x"),
                                     change("add", day="Thursday", new="swim", instruction="y")), [])

    def test_swims_added_past_the_athletes_week_in_a_week_not_generated_come_with_a_note(self):
        self.db.rows.pop(self.week_id)
        board = self.board()
        adds = [change("add", day=name, new="swim", instruction="x") for name in ("Thursday", "Friday", "Saturday", "Sunday")]
        [note] = week_coach.plan_notes(board, PROFILE, adds)
        self.assertIn("That makes 5 swims this week and your plan has 4 a week", note)
        self.assertEqual(week_coach.plan_notes(board, PROFILE, adds[:3]), [])
        # Changing a swim adds none: no note, however full the week already is.
        self.assertEqual(week_coach.plan_notes(board, {**PROFILE, "swim_sessions_per_week": 1}, [change("edit", "S1", instruction="x")]), [])
        self.assertEqual(week_coach.plan_notes(self.board("gym"), PROFILE, adds), [])

    def test_a_replan_is_the_only_change_and_needs_a_generated_week(self):
        replan = change("replan", label="Fresh plan")
        self.assertEqual(self.issues(replan), [])
        self.assertIn("the only change", self.issues(replan, change("remove", "S3"))[0])
        self.assertEqual(self.issues(replan, kind="gym"), [])
        self.db.rows.pop(self.week_id)
        self.assertIn("isn't generated yet", self.issues(replan)[0])

    def test_a_replan_takes_no_wishes_so_those_are_single_changes(self):
        # Generating the week again follows the athlete's plan only: "only Monday, Wednesday and Friday, more chest" in a
        # replan was dropped and the week came back as it was, so the coach is sent back to make the single changes.
        wishes = change("replan", instruction="Three strength sessions on Monday, Wednesday and Friday with extra chest work", label="Fresh plan")
        for kind in ("gym", "swim"):
            [issue] = self.issues(wishes, kind=kind)
            self.assertIn("can't take an instruction", issue)
            self.assertIn("give the single changes", issue)
        self.assertEqual(self.issues(change("replan", instruction="  ", label="Fresh plan"), kind="gym"), [])

    def test_the_gym_week_holds_three_workouts_a_day(self):
        adds = [change("add", day="Wednesday", new="strength", instruction=str(number)) for number in range(3)]
        self.assertIn("Wednesday would have 4 workouts", self.issues(*adds, kind="gym")[0])
        self.assertEqual(self.issues(*adds[:2], kind="gym"), [])


class EditTests(unittest.TestCase):
    def setUp(self):
        self.before = {**swim("Threshold", swim_set("Warm-Up: Easy", 1, 400, "Recovery", ["fins"]), swim_set("Main Set: 8 x 100", 8, 100, "Threshold", ["paddles"]),
                              swim_set("Warm-Down: Pull", 1, 200, "Recovery", ["pull buoy"])), "equipment": ["paddles", "pull buoy"]}

    def test_a_swim_keeps_the_sets_it_keeps_exactly_and_adjusts_only_the_fields_given(self):
        edit = SwimEdit(working="", title=None, objective=None, notes=None, estimated_duration_minutes=35, sets=[
            KeptSet(keep=1),
            AdjustedSet(adjust=2, name="Main Set: 6 x 100", rounds=None, repetitions=6, distance_meters=None, interval=None, target_time=None,
                        training_zone=None, description=None),
            training.PlannedSet(**{**swim_set("Kick: 4 x 50", 4, 50), "equipment": ["kickboard"]})])
        result = edited_swim(self.before, edit)
        self.assertEqual(result.sets[0].model_dump(), self.before["sets"][0])
        self.assertEqual((result.sets[1].name, result.sets[1].repetitions, result.sets[1].description, result.sets[1].equipment),
                         ("Main Set: 6 x 100", 6, "Main Set: 8 x 100.", ["paddles"]))
        self.assertEqual(result.total_distance_meters, 400 + 600 + 200)
        self.assertEqual((result.title, result.objective, result.estimated_duration_minutes), ("Threshold", "Threshold objective.", 35))
        # Gear only a set that's gone used goes (the warm-down's pull buoy); gear the sets kept or new use stays or comes.
        self.assertEqual(result.equipment, ["paddles", "fins", "kickboard"])

    def test_a_gym_workout_keeps_its_exercises_and_adjusts_a_dose(self):
        before = gym_workout("Legs", "Goblet squat", "Split squat", "Plank")
        edit = GymEdit(title=None, objective=None, rationale=None, coaching_notes=None, intensity="Minimal", estimated_duration_minutes=25, warm_up=None,
                       exercises=[KeptItem(keep=1), AdjustedExercise(adjust=3, sets=2, repetitions="30 s", load=None, rest_seconds=None, tempo=None),
                                  gym.GymExercise(exercise="Glute bridge", sets=3, repetitions="12", load="Bodyweight", rest_seconds=60,
                                                  demonstration=["Lift."], swim_benefit="Turns.")], cool_down=["Walk"])
        result = edited_gym(before, edit)
        self.assertEqual(result["exercises"][0], before["exercises"][0])
        self.assertEqual((result["exercises"][1]["exercise"], result["exercises"][1]["sets"], result["exercises"][1]["repetitions"],
                          result["exercises"][1]["demonstration"]), ("Plank", 2, "30 s", ["Brace.", "Lift."]))
        self.assertEqual([item["exercise"] for item in result["exercises"]], ["Goblet squat", "Plank", "Glute bridge"])
        self.assertEqual((result["warm_up"], result["cool_down"], result["intensity"], result["title"]), (["Jog 5 minutes"], ["Walk"], "Minimal", "Legs"))

    def test_a_builder_workout_keeps_its_sections_time_and_place(self):
        before = builder_workout("Pull day")
        edit = BuilderEdit(title=None, notes=None, coaching_notes=None, intensity="Full", duration_minutes=50, sections=[
            KeptItem(keep=2), CoachSection(title="Core", kind="core", notes="", exercises=[
                CoachExercise(name="Plank", sets=3, reps="45 s", load="", rest_seconds=45, tempo="", notes="")])])
        doc = edited_doc(before, edit)
        display = doc_display(doc, DAY["Friday"])
        self.assertEqual([section["title"] for section in display["sections"]], ["Main", "Core"])
        self.assertEqual(display["sections"][0], before["sections"][1])
        self.assertEqual((display["meta"]["start_time"], display["meta"]["location"], display["intensity"]), ("07:00", "Club gym", "Full"))
        # Its times say how long it lasts.
        self.assertEqual(display["estimated_duration_minutes"], 45)
        self.assertEqual(workout_doc(before).sections[0].title, "Warm-Up")

    def test_a_total_far_from_the_one_asked_for_is_sent_back_with_what_each_set_comes_to(self):
        sets = [training.PlannedSet(**swim_set("Main", 10, 100))]
        self.assertEqual(week_coach._distance_issue(sets, 1050), [])
        [soft] = week_coach._distance_issue(sets, 1300)
        self.assertIsInstance(soft, training.SoftIssue)
        [hard] = week_coach._distance_issue(sets, 2000)
        self.assertNotIsInstance(hard, training.SoftIssue)
        self.assertIn("(Main 1000 m)", hard)
        self.assertIn("add about 1,000 m", hard)

    def test_a_swim_off_its_total_is_evened_out_by_its_easy_work_never_its_main_set(self):
        sets = [training.PlannedSet(**swim_set("Warm-Up: 400 easy", 1, 400, "Recovery")), training.PlannedSet(**swim_set("Warm-Up: 4 x 50 drill", 4, 50, "Aerobic")),
                training.PlannedSet(**swim_set("Main Set: 8 x 100", 8, 100, "Threshold")),
                training.PlannedSet(**swim_set("Warm-Down: 300 easy", 1, 300, "Recovery")), training.PlannedSet(**swim_set("Warm-Down: 50 easy", 1, 50, "Recovery"))]
        # 1,750 m to come to 1,250: a step at a time from each easy set, warm-down first; the 50 m swim-down stays as it is.
        plan = week_coach.evened(sets, 500)
        self.assertEqual(plan, {3: (1, 100), 0: (1, 250), 1: (1, 50)})
        self.assertNotIn(2, plan)
        self.assertEqual(sum((plan.get(index, (item.repetitions, item.distance_meters))[0] * plan.get(index, (item.repetitions, item.distance_meters))[1])
                             for index, item in enumerate(sets)), 1250)
        # A swim under its total: the easy swims lengthen, warm-down first.
        self.assertEqual(week_coach.evened(sets, -200), {4: (1, 150), 3: (1, 350), 0: (1, 450)})
        self.assertEqual(week_coach._relabelled("Warm-Up: 4 x 50 drill", (4, 50), (1, 50)), "Warm-Up: 1 x 50 drill")
        self.assertEqual(week_coach._relabelled("Warm-Down: 300 easy", (1, 300), (1, 50)), "Warm-Down: 50 easy")
        # Only hard work: nothing to even out.
        self.assertEqual(week_coach.evened([sets[2]], 300), {})


class ApplyTests(WeekCoachCase):
    def apply(self, *changes, kind="swim", identifier=CHANGE_SET):
        return self.client.post("/api/training/week-coach/apply", headers=HEADERS,
                                json={"id": identifier, "kind": kind, "week_start": MONDAY.isoformat(), "changes": list(changes)})

    def undo(self, kind="swim", identifier=CHANGE_SET):
        return self.client.post("/api/training/week-coach/undo", headers=HEADERS, json={"id": identifier, "kind": kind, "week_start": MONDAY.isoformat()})

    def target(self, ref, kind="swim"):
        entry = self.board("gym" if kind == "gym" else "swim").entry(ref)
        return {"key": entry.key, "base": entry.base, "kind": entry.kind}

    def swims_on(self, week, day):
        return [item["workout"]["title"] for item in next(entry for entry in week["days"] if entry["date"] == DAY[day].isoformat())["workouts"]]

    def test_a_generated_weeks_swim_is_edited_in_place_and_keeps_its_key(self):
        new = swim("Wednesday shorter", swim_set("Main", 6, 100, "Threshold"))
        response = self.apply({"id": item_id(1), "action": "edit", **self.target("S2"), "workout": new})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["change"], {"id": CHANGE_SET, "highlight": [self.plan_key("Wednesday")], "undo": True})
        self.assertEqual(self.swims_on(body["week"], "Wednesday"), ["Wednesday shorter"])
        self.assertEqual(self.db.rows[self.week_id]["details"]["plan"]["days"][2]["swims"][0]["title"], "Wednesday shorter")
        # Everything else in the plan is as it was.
        self.assertEqual(self.db.rows[self.week_id]["details"]["plan"]["days"][3], week_plan()["days"][3])

    def test_a_swim_moved_with_an_edit_becomes_a_swim_of_its_own_and_the_plans_copy_is_hidden(self):
        new = swim("Saturday easy", swim_set("Easy", 1, 1000, "Recovery"))
        response = self.apply({"id": item_id(1), "action": "edit", **self.target("S3"), "date": DAY["Saturday"].isoformat(), "workout": new})
        self.assertEqual(response.status_code, 200, response.text)
        week = response.json()["week"]
        self.assertEqual((self.swims_on(week, "Thursday"), self.swims_on(week, "Saturday")), ([], ["Saturday easy"]))
        moved = training.record_id(PROFILE["id"], f"week-coach:{CHANGE_SET}:{item_id(1)}")
        self.assertEqual(response.json()["change"]["highlight"], [moved])
        self.assertEqual((self.db.rows[moved]["details"]["source"], self.db.rows[moved]["details"]["copied_from"]), ("ai", self.plan_key("Thursday")))
        self.assertIn(self.plan_key("Thursday"), self.db.rows[self.week_id]["details"]["removed"])

    def test_adds_copies_moves_and_removals_save_as_the_week_saves_its_own(self):
        before = self.db.snapshot()
        response = self.apply(
            {"id": item_id(1), "action": "add", "kind": "swim", "date": DAY["Sunday"].isoformat(), "workout": swim("Sunday recovery")},
            {"id": item_id(2), "action": "copy", **self.target("S1"), "date": DAY["Saturday"].isoformat()},
            {"id": item_id(3), "action": "remove", **self.target("S4")},
            {"id": item_id(4), "action": "move", **self.target("M2"), "date": DAY["Sunday"].isoformat()})
        self.assertEqual(response.status_code, 200, response.text)
        week = response.json()["week"]
        self.assertEqual(self.swims_on(week, "Sunday"), ["Sunday recovery"])
        self.assertEqual(self.swims_on(week, "Saturday"), ["Monday threshold"])
        self.assertEqual(self.swims_on(week, "Friday"), [])
        self.assertEqual([[len(day["mobility"]) for day in week["days"]][index] for index in (5, 6)], [0, 1])
        added = self.db.rows[training.record_id(PROFILE["id"], f"week-coach:{CHANGE_SET}:{item_id(1)}")]["details"]
        self.assertEqual((added["source"], added["coach"], added["phase"], added["pool_length"]), ("ai", "Coach Brad", "Build", 50))
        # The athlete's own swim and its favorite went; undo puts every record back as it was.
        self.assertNotIn(self.own_id, self.db.rows)
        self.assertNotIn(self.state_id, self.db.rows)
        undone = self.undo()
        self.assertEqual(undone.status_code, 200, undone.text)
        self.assertEqual(self.db.snapshot(), before)
        self.assertIn(self.own_id, undone.json()["highlight"])

    def test_a_days_mobility_is_rewritten_in_the_generated_week(self):
        response = self.apply({"id": item_id(1), "action": "edit", **self.target("M1"), "mobility": mobility("Hip circles")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["change"]["highlight"], [f"mobility:{DAY['Thursday']}"])
        self.assertEqual([item["exercise"] for item in response.json()["week"]["days"][3]["mobility"]], ["Hip circles"])

    def test_a_session_changed_since_the_coach_read_it_stops_every_change(self):
        target = self.target("S2")
        self.db.rows[self.week_id]["details"]["plan"]["days"][2]["swims"][0]["title"] = "Edited in another tab"
        before = self.db.snapshot()
        response = self.apply({"id": item_id(1), "action": "add", "kind": "swim", "date": DAY["Sunday"].isoformat(), "workout": swim("x")},
                              {"id": item_id(2), "action": "edit", **target, "workout": swim("y")})
        self.assertEqual(response.status_code, 409)
        self.assertIn("changed since", response.json()["detail"])
        self.assertEqual(self.db.snapshot(), before)

    def test_locked_sessions_and_days_over_their_limits_are_refused(self):
        self.assertEqual(self.apply({"id": item_id(1), "action": "remove", **self.target("S1")}).status_code, 409)
        crowded = self.apply(*[{"id": item_id(number), "action": "add", "kind": "swim", "date": DAY["Thursday"].isoformat(), "workout": swim(str(number))}
                               for number in (1, 2)])
        self.assertEqual(crowded.status_code, 409)
        self.assertIn("more than two swims", crowded.json()["detail"])
        self.assertEqual(self.apply({"id": item_id(1), "action": "add", "kind": "swim", "date": DAY["Tuesday"].isoformat(), "workout": swim("x")}).status_code, 409)
        self.assertEqual(self.apply({"id": item_id(1), "action": "add", "kind": "swim", "date": (MONDAY + timedelta(days=8)).isoformat(),
                                     "workout": swim("x")}).status_code, 422)

    def test_a_change_sent_again_is_applied_once(self):
        first = self.apply({"id": item_id(1), "action": "add", "kind": "swim", "date": DAY["Sunday"].isoformat(), "workout": swim("Sunday")})
        writes = len(self.db.writes)
        again = self.apply({"id": item_id(1), "action": "add", "kind": "swim", "date": DAY["Sunday"].isoformat(), "workout": swim("Sunday")})
        self.assertEqual((first.status_code, again.status_code), (200, 200))
        self.assertEqual(len(self.db.writes), writes)
        self.assertEqual(self.swims_on(again.json()["week"], "Sunday"), ["Sunday"])

    def test_undo_waits_for_nothing_to_have_moved_on(self):
        self.apply({"id": item_id(1), "action": "edit", **self.target("S2"), "workout": swim("Shorter")})
        # Ticked off since: undoing would leave the tick on a swim that isn't the one done.
        tick = self.db.add(f"completed:{self.plan_key('Wednesday')}", "swim", TODAY, {"workout_key": self.plan_key("Wednesday"), "completion_status": "completed"})
        self.assertEqual(self.undo().status_code, 409)
        self.db.rows.pop(tick)
        # Changed again since.
        self.db.rows[self.week_id]["details"]["coaching_note"] = "Changed"
        self.assertEqual(self.undo().status_code, 409)
        self.db.rows[self.week_id]["details"].pop("coaching_note")
        self.assertEqual(self.undo().status_code, 200)
        self.assertEqual(self.undo().status_code, 404)

    def test_the_gym_week_keeps_each_workouts_form(self):
        ai = self.target("G1", "gym")
        edited = {**gym_workout("Leg power", "Goblet squat", "Glute bridge"), "intensity": "Minimal"}
        response = self.apply({"id": item_id(1), "action": "edit", **ai, "workout": edited}, kind="gym")
        self.assertEqual(response.status_code, 200, response.text)
        row = self.db.rows[self.ai_gym]["details"]
        self.assertEqual((row["dose"], row["edited"], row["source"], [item["exercise"] for item in row["workout"]["exercises"]]),
                         ("Minimal", True, "ai", ["Goblet squat", "Glute bridge"]))
        own = self.target("G2", "gym")
        wrong = self.apply({"id": item_id(1), "action": "edit", **own, "workout": gym_workout("x")}, kind="gym", identifier=item_id(99))
        self.assertEqual(wrong.status_code, 422)
        doc = workout_doc(self.board("gym").entry("G2").content).model_dump(mode="json")
        doc["title"] = "Pull day, harder"
        kept = self.apply({"id": item_id(1), "action": "edit", **own, "doc": doc}, kind="gym", identifier=item_id(98))
        self.assertEqual(kept.status_code, 200, kept.text)
        saved = self.db.rows[self.own_gym]["details"]
        self.assertEqual((saved["workout"]["title"], saved["workout"]["meta"]["start_time"], saved["edited"]), ("Pull day, harder", "07:00", False))

    def test_a_coach_workout_added_to_the_gym_week_is_the_coachs(self):
        response = self.apply({"id": item_id(1), "action": "add", "kind": "gym", "date": DAY["Sunday"].isoformat(), "focus": "mobility",
                               "workout": {**gym_workout("Hips"), "intensity": "Minimal"}}, kind="gym")
        self.assertEqual(response.status_code, 200, response.text)
        row = self.db.rows[response.json()["change"]["highlight"][0]]
        self.assertEqual((row["details"]["source"], row["details"]["focus"], row["details"]["dose"]), ("coach", "Mobility from your coach", "Minimal"))
        crowded = self.apply(*[{"id": item_id(number), "action": "add", "kind": "gym", "date": TODAY.isoformat(), "workout": gym_workout(str(number))}
                               for number in (2, 3, 4)], kind="gym", identifier=item_id(97))
        self.assertEqual(crowded.status_code, 409)

    def test_gym_moves_copies_and_removals_undo(self):
        before = self.db.snapshot()
        response = self.apply({"id": item_id(1), "action": "move", **self.target("G1", "gym"), "date": DAY["Saturday"].isoformat()},
                              {"id": item_id(2), "action": "copy", **self.target("G2", "gym"), "date": DAY["Sunday"].isoformat()}, kind="gym")
        self.assertEqual(response.status_code, 200, response.text)
        days = {day["date"]: [item["workout"]["title"] for item in day["workouts"]] for day in response.json()["week"]["days"]}
        self.assertEqual((days[TODAY.isoformat()], days[DAY["Saturday"].isoformat()], days[DAY["Sunday"].isoformat()]), ([], ["Leg power"], ["Pull day"]))
        self.assertEqual(self.undo("gym").status_code, 200)
        self.assertEqual(self.db.snapshot(), before)


class ChatTests(WeekCoachCase):
    def setUp(self):
        super().setUp()
        self.patch(week_coach, "_grounding", return_value=("ATHLETE", []))
        self.answers = []
        self.patch(training, "generate_structured", side_effect=self.generate)

    def generate(self, profile, schema, objective, check=None, **options):
        reply = self.answers.pop(0)
        if isinstance(reply, Exception):
            raise reply
        result = schema.model_validate(reply)
        if check:
            issues = check(result)
            if issues and not all(isinstance(issue, training.SoftIssue) for issue in issues):
                raise HTTPException(status_code=502, detail="; ".join(issues))
        return result, []

    def chat(self, message="Make Wednesday shorter", kind="swim", week=MONDAY):
        response = self.client.post("/api/training/week-coach/chat", headers=HEADERS,
                                    json={"kind": kind, "week_start": week.isoformat(), "message": message, "history": [{"role": "athlete", "text": "Hi"}]})
        return response, [json.loads(line) for line in response.text.splitlines() if line.strip()]

    def test_the_answer_comes_first_then_each_change_as_its_written(self):
        self.answers = [
            {"message": "Shorter it is.", "changes": [
                {"action": "edit", "session": "S2", "new": None, "day": None, "instruction": "Main set 6 x 100", "meters": 1200, "minutes": None, "label": "Shorter"},
                {"action": "remove", "session": "S4", "new": None, "day": None, "instruction": "", "meters": None, "minutes": None, "label": "Rest"}], "elsewhere": False},
            {"working": "1400 - 200 = 1200", "title": None, "objective": None, "notes": None, "estimated_duration_minutes": 35, "sets": [
                {"keep": 1}, {"adjust": 2, "name": "Main Set: 6 x 100", "rounds": None, "repetitions": 6, "distance_meters": None, "interval": None,
                              "target_time": None, "training_zone": None, "description": None}, {"keep": 3}]},
        ]
        response, events = self.chat()
        self.assertEqual(response.status_code, 200)
        self.assertEqual([event["type"] for event in events], ["plan", "change", "done"])
        plan = events[0]
        self.assertEqual(plan["message"], "Shorter it is.")
        edit, removal = plan["changes"]
        self.assertEqual((edit["action"], edit["ref"], edit["key"], edit["writing"], edit["before"]["title"]), ("edit", "S2", self.plan_key("Wednesday"), True, "Wednesday aerobic"))
        self.assertEqual((removal["writing"], removal["key"]), (False, self.own_id))
        self.assertEqual(edit["base"], self.board().entry("S2").base)
        written = events[1]
        self.assertEqual(written["id"], edit["id"])
        self.assertEqual(sum(item["repetitions"] * item["distance_meters"] for item in written["workout"]["sets"]), 1200)

    def test_the_coach_is_told_the_athletes_training_days(self):
        prompts = []
        answer = self.generate

        def remember(profile, schema, objective, check=None, **options):
            prompts.append(objective)
            return answer(profile, schema, objective, check, **options)

        self.patch(training, "generate_structured", side_effect=remember)
        self.answers = [{"message": "Which day?", "changes": [], "elsewhere": False}]
        self.chat()
        self.assertNotIn("chosen training days", prompts[-1])
        self.db.add("training-days", "training_days", None, {"swim": [1, 0, 1, 0, 1, 0, 1], "gym": [False, True, False, True, False, False, False],
                                                             "mobility": True, "saved_at": "2026-10-20T08:00:00+00:00"})
        self.answers = [{"message": "Which day?", "changes": [], "elsewhere": False}]
        self.chat()
        self.assertIn("The athlete's chosen training days: swims on Mon, Wed, Fri, Sun; strength sessions on Tue, Thu; the mobility "
                      "routine on the other days.", prompts[-1])

    def test_a_change_that_cant_be_written_is_left_out_and_said_so(self):
        self.answers = [{"message": "Here.", "changes": [
            {"action": "add", "session": None, "new": "swim", "day": "Sunday", "instruction": "Easy", "meters": 1500, "minutes": None, "label": "Easy swim"}], "elsewhere": False},
            HTTPException(status_code=502, detail=training.GENERATION_FAILED)]
        _, events = self.chat()
        self.assertEqual([event["type"] for event in events], ["plan", "failed", "done"])
        self.assertEqual(events[1]["detail"], training.GENERATION_FAILED)

    def test_an_answer_that_cant_be_given_says_so(self):
        self.answers = [HTTPException(status_code=503, detail=training.GENERATION_SLOW)]
        response, events = self.chat()
        self.assertEqual((response.status_code, events), (200, [{"type": "error", "detail": training.GENERATION_SLOW}]))

    def test_a_replan_of_the_week_is_offered_to_run_as_generating_does(self):
        self.answers = [{"message": "A fresh plan.", "changes": [
            {"action": "replan", "session": None, "new": None, "day": None, "instruction": "", "meters": None, "minutes": None, "label": "Fresh plan"}],
            "elsewhere": False}]
        _, events = self.chat("Re-plan the rest of my week")
        self.assertEqual([event["type"] for event in events], ["plan", "done"])
        [replan] = events[0]["changes"]
        self.assertEqual((replan["action"], replan["kind"], replan["date"], replan["to"], replan["writing"]), ("replan", "swim", TODAY.isoformat(), None, False))
        self.assertFalse(events[0]["elsewhere"])

    def test_a_question_for_the_main_chat_says_so(self):
        self.answers = [{"message": "Eat light. Ask me in the coach chat for more.", "changes": [], "elsewhere": True}]
        _, events = self.chat("What should I eat before a race?")
        self.assertTrue(events[0]["elsewhere"])

    def test_a_question_back_changes_nothing(self):
        self.answers = [{"message": "Which day?", "changes": [], "elsewhere": False}]
        _, events = self.chat("change it")
        self.assertEqual([event["type"] for event in events], ["plan", "done"])
        self.assertEqual(events[0]["changes"], [])

    def test_a_week_thats_over_cant_be_changed(self):
        response, _ = self.chat(week=MONDAY - timedelta(days=7))
        self.assertEqual(response.status_code, 409)

    def test_the_coach_is_told_the_week_its_rules_and_the_chat_so_far(self):
        seen = []

        def generate(profile, schema, objective, **options):
            seen.append((objective, options["rules"]))
            return CoachAnswer(message="Ok.", changes=[], elsewhere=False), []
        training.generate_structured.side_effect = generate
        self.chat("Add more kick")
        objective, rules = seen[0]
        self.assertEqual(rules, week_coach.WEEK_RULES)
        self.assertIn("THE ATHLETE'S SWIM WEEK", objective)
        self.assertIn("Athlete: Hi", objective)
        self.assertIn("THE ATHLETE'S NEW MESSAGE: Add more kick", objective)
        self.assertIn("TODAY: Wednesday 2026-10-21", objective)


if __name__ == "__main__":
    unittest.main()
