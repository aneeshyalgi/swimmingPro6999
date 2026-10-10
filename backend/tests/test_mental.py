from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.mental import MentalAnswers, mind_plan, _payload

ANSWERS = {
    "goal": "nerves", "confidence": 4, "focus": 3, "calm": 2, "motivation": 5, "resilience": 3, "pre_race": "anxious",
    "routine": "loose", "setback": "move_on", "sleep": "ok", "stress": "medium", "mood": "good", "tools": ["self_talk"],
}
HEADERS = {"Authorization": "Bearer token"}


def plan(**changes):
    return mind_plan(MentalAnswers(**{**ANSWERS, **changes}))


def today():
    return datetime.now(timezone.utc).date()


class MindPlanTests(unittest.TestCase):
    def test_strength_and_focus_area_come_from_the_ratings(self):
        result = plan()
        self.assertEqual((result["strength"], result["working_on"]), ("motivation", "calm"))
        self.assertEqual(result["goal"]["title"], "Race calm, race fast")
        self.assertEqual([skill["value"] for skill in result["skills"]], [4, 3, 2, 5, 3])

    def test_equal_ratings_have_no_strength_and_work_on_the_goal(self):
        result = plan(goal="focus", confidence=3, focus=3, calm=3, motivation=3, resilience=3)
        self.assertIsNone(result["strength"])
        self.assertEqual(result["working_on"], "focus")

    def test_three_different_skills_led_by_the_goal_and_marked_when_already_used(self):
        tools = plan()["toolkit"]
        self.assertEqual([tool["key"] for tool in tools], ["control", "visualisation", "cue_words"])
        self.assertEqual([tool["uses"] for tool in tools], [False, False, True])  # self-talk is cue words
        for tool in tools:
            self.assertTrue(tool["why"] and len(tool["steps"]) == 3)

    def test_the_answers_bring_in_the_skills_they_call_for(self):
        tools = [tool["key"] for tool in plan(mood="low", sleep="poorly", pre_race="flat", setback="doubt")["toolkit"]]
        self.assertEqual(tools, ["control", "talk", "wind_down"])
        self.assertIn("reset", [tool["key"] for tool in plan(setback="frustrated")["toolkit"]])
        self.assertIn("energise", [tool["key"] for tool in plan(pre_race="flat")["toolkit"]])

    def test_the_race_routine_fits_how_they_feel_and_handle_bad_swims(self):
        steps = {step["key"]: step for step in plan()["routine"]["steps"]}
        self.assertEqual(list(steps), ["night", "warmup", "blocks", "after"])
        self.assertEqual(steps["blocks"]["title"], "Breathe, then go")
        self.assertEqual(steps["after"]["title"], "Learn and let go")
        flat = {step["key"]: step for step in plan(pre_race="flat", setback="replay", routine="none")["routine"]["steps"]}
        self.assertEqual((flat["warmup"]["title"], flat["blocks"]["title"], flat["after"]["title"]), ("Wake up", "Switch on", "3R reset"))
        self.assertIn("Start with this", plan(routine="none")["routine"]["note"])

    def test_the_support_card_shows_for_low_mood_stress_with_poor_sleep_or_a_low_week(self):
        day = today()
        self.assertFalse(_payload({"answers": ANSWERS}, day)["support"])
        self.assertTrue(_payload({"answers": {**ANSWERS, "mood": "low"}}, day)["support"])
        self.assertTrue(_payload({"answers": {**ANSWERS, "stress": "high", "sleep": "poorly"}}, day)["support"])
        self.assertFalse(_payload({"answers": {**ANSWERS, "stress": "high"}}, day)["support"])
        two_low = {(day - timedelta(days=offset)).isoformat(): mood for offset, mood in [(0, 2), (1, 1), (2, 4)]}
        self.assertFalse(_payload({"answers": ANSWERS, "checkins": two_low}, day)["support"])
        three_low = {**two_low, (day - timedelta(days=3)).isoformat(): 2}
        self.assertTrue(_payload({"answers": ANSWERS, "checkins": three_low}, day)["support"])


class MentalApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.supabase = MagicMock()
        self.rows = []
        self.save = MagicMock()
        for target, options in [
            ("app.mental.get_authenticated_profile", {"return_value": {"id": "row-1"}}),
            ("app.mental.find_record", {"side_effect": lambda profile_id, key: self.rows[0] if self.rows and key == "mental" else None}),
            ("app.mental.get_supabase_client", {"return_value": self.supabase}),
            ("app.mental.save_record", {"new": self.save}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_first_visit_has_no_answers_and_an_empty_week(self):
        response = self.client.get(f"/api/mental?date={today()}", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["answers"], body["plan"], body["support"]), (None, None, False))
        self.assertEqual(len(body["week"]), 7)
        self.assertEqual(body["week"][-1], {"date": today().isoformat(), "mood": None})

    def test_answering_saves_one_record_and_keeps_the_check_ins(self):
        self.rows = [{"id": "mental-row", "details": {"answers": ANSWERS, "checkins": {today().isoformat(): 4}}}]
        response = self.client.put(f"/api/mental?date={today()}", json={**ANSWERS, "goal": "confidence"}, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        profile_id, key, kind, _, day, details = self.save.call_args.args
        self.assertEqual((profile_id, key, kind, day), ("row-1", "mental", "mental_profile", None))
        self.assertEqual(details["checkins"], {today().isoformat(): 4})
        self.assertEqual(response.json()["plan"]["goal"]["key"], "confidence")
        self.assertEqual(response.json()["week"][-1]["mood"], 4)

    def test_answers_must_be_complete_and_in_range(self):
        missing = {key: value for key, value in ANSWERS.items() if key != "calm"}
        for answers in (missing, {**ANSWERS, "focus": 6}, {**ANSWERS, "goal": "luck"}, {**ANSWERS, "diary": "secret"}):
            self.assertEqual(self.client.put("/api/mental", json=answers, headers=HEADERS).status_code, 422)
        self.save.assert_not_called()

    def test_a_check_in_needs_answers_first_then_keeps_two_weeks(self):
        self.assertEqual(self.client.post("/api/mental/checkin", json={"date": today().isoformat(), "mood": 4}, headers=HEADERS).status_code, 409)
        history = {(today() - timedelta(days=offset)).isoformat(): 3 for offset in range(1, 16)}
        self.rows = [{"id": "mental-row", "details": {"answers": ANSWERS, "checkins": history}}]
        response = self.client.post("/api/mental/checkin", json={"date": today().isoformat(), "mood": 1}, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["week"][-1], {"date": today().isoformat(), "mood": 1})
        self.assertFalse(body["support"])
        saved = self.supabase.table.return_value.update.call_args.args[0]["details"]
        self.assertEqual(saved["answers"], ANSWERS)
        self.assertEqual(len(saved["checkins"]), 14)
        self.assertEqual(saved["checkins"][today().isoformat()], 1)

    def test_check_ins_are_only_for_today_and_from_1_to_5(self):
        self.rows = [{"id": "mental-row", "details": {"answers": ANSWERS}}]
        old = (today() - timedelta(days=4)).isoformat()
        self.assertEqual(self.client.post("/api/mental/checkin", json={"date": old, "mood": 3}, headers=HEADERS).status_code, 422)
        self.assertEqual(self.client.post("/api/mental/checkin", json={"date": today().isoformat(), "mood": 0}, headers=HEADERS).status_code, 422)
        self.supabase.table.return_value.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
