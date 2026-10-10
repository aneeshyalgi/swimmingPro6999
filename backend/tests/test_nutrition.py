from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.nutrition import FOODS, NutritionAnswers, fuel_plan
from app.training import record_id

PROFILE = {
    "id": "row-1", "user_key": "profile-1", "full_name": "Sam Swimmer", "age": 20, "gender": "male", "height": 180,
    "weight": 75, "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "90",
}
ANSWERS = {
    "goal": "perform", "sex": "male", "age": 20, "height_cm": 180, "weight_kg": 75, "swim_time": "early",
    "meals_per_day": 3, "pre_training": "rarely", "water": "1_2", "diet": "any", "avoid": [], "challenge": "energy",
}
HEADERS = {"Authorization": "Bearer token"}


def plan(**changes):
    return fuel_plan(NutritionAnswers(**{**ANSWERS, **changes}), PROFILE)


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class FuelPlanTests(unittest.TestCase):
    def test_every_day_adds_up_and_training_days_get_more_fuel(self):
        result = plan()
        training, rest = result["days"]["training"], result["days"]["rest"]
        for day in (training, rest):
            self.assertEqual(day["calories"], 4 * day["protein_g"] + 4 * day["carbs_g"] + 9 * day["fat_g"])
        # 6 swims of 90 min and 2 gym hours over 6 training days, for a 75 kg, 180 cm, 20-year-old man.
        self.assertEqual((training["calories"], rest["calories"]), (3270, 2490))
        self.assertEqual((training["protein_g"], rest["protein_g"]), (120, 120))  # 1.6 g/kg on both days
        self.assertGreater(training["carbs_g"], rest["carbs_g"])
        self.assertEqual((training["water_l"], rest["water_l"]), (3.5, 2.75))
        self.assertEqual((result["meals"], result["protein_per_meal_g"]), (4, 30))  # three meals get a protein snack too
        self.assertIn("6 swims and 2 gym sessions a week", result["summary"])

    def test_an_adult_getting_leaner_eats_less_mostly_on_rest_days(self):
        perform, lean = plan()["days"], plan(goal="lean")["days"]
        self.assertLess(lean["training"]["calories"], perform["training"]["calories"])
        self.assertGreater(perform["rest"]["calories"] - lean["rest"]["calories"],
                           perform["training"]["calories"] - lean["training"]["calories"])
        self.assertGreater(lean["training"]["protein_g"], perform["training"]["protein_g"])

    def test_no_day_drops_below_the_energy_floor(self):
        small = fuel_plan(NutritionAnswers(**{**ANSWERS, "goal": "lean", "sex": "female", "age": 30, "height_cm": 160, "weight_kg": 50}),
                          {**PROFILE, "swim_sessions_per_week": 1, "gym_sessions_per_week": 0, "session_duration": "60"})
        resting = 10 * 50 + 6.25 * 160 - 5 * 30 - 161
        self.assertGreaterEqual(small["days"]["rest"]["calories"], resting * 1.2 - 15)

    def test_athletes_under_18_never_get_a_deficit(self):
        youth = plan(goal="lean", age=16)
        self.assertEqual(youth["goal"]["key"], "perform")
        self.assertTrue(youth["youth"])
        self.assertIn("never cuts calories", youth["goal"]["approach"])
        self.assertEqual(youth["days"], plan(goal="perform", age=16)["days"])

    def test_food_ideas_respect_the_diet_and_the_foods_avoided(self):
        result = plan(diet="vegan", avoid=["nuts", "soy", "gluten"])
        banned = {"meat", "seafood", "dairy", "eggs", "nuts", "soy", "gluten"}
        lists = [step["ideas"] for step in result["timeline"]] + list(result["sources"].values())
        for foods in lists:
            self.assertGreaterEqual(len(foods), 3)
            for food in foods:
                self.assertFalse(FOODS[food] & banned, food)

    def test_three_habits_each_on_a_different_topic_and_the_goal_always_shows(self):
        # Low energy and fasted early swims are the same advice: it shows once.
        titles = [habit["title"] for habit in plan()["habits"]]
        self.assertEqual(titles, ["Never swim on empty", "Match carbs to training", "Drink more through the day"])
        build = [habit["title"] for habit in plan(goal="build", challenge="none", water="over_3", swim_time="evening")["habits"]]
        self.assertEqual(len(build), 3)
        self.assertEqual(build[0], "Protein at every meal")


class NutritionApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.supabase = MagicMock()
        self.rows = []
        self.save = MagicMock(return_value=record_id("row-1", "nutrition"))
        for target, options in [
            ("app.nutrition.get_authenticated_profile", {"return_value": dict(PROFILE)}),
            ("app.nutrition.find_record", {"side_effect": lambda profile_id, key: self.rows[0] if self.rows and key == "nutrition" else None}),
            ("app.nutrition.get_supabase_client", {"return_value": self.supabase}),
            ("app.nutrition.save_record", {"new": self.save}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_first_visit_has_no_answers_and_starts_from_the_onboarding_profile(self):
        response = self.client.get(f"/api/nutrition?date={today()}", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIsNone(body["answers"])
        self.assertIsNone(body["plan"])
        self.assertEqual(body["defaults"], {"sex": "male", "age": 20, "height_cm": 180.0, "weight_kg": 75.0})
        self.assertEqual(body["water"], {"date": today(), "ml": 0})

    def test_answering_saves_one_record_keeps_logged_water_and_returns_the_plan(self):
        self.rows = [{"id": record_id("row-1", "nutrition"), "details": {"answers": ANSWERS, "water": {today(): 750}}}]
        response = self.client.put(f"/api/nutrition?date={today()}", json={**ANSWERS, "goal": "build"}, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        profile_id, key, kind, _, day, details = self.save.call_args.args
        self.assertEqual((profile_id, key, kind, day), ("row-1", "nutrition", "nutrition_profile", None))
        self.assertEqual(details["answers"]["goal"], "build")
        self.assertEqual(details["water"], {today(): 750})
        body = response.json()
        self.assertEqual(body["plan"]["goal"]["key"], "build")
        self.assertEqual(body["water"]["ml"], 750)

    def test_answers_must_be_complete_and_known(self):
        for answers in ({**ANSWERS, "goal": "bulk"}, {**ANSWERS, "favourite_food": "pasta"}, {key: ANSWERS[key] for key in ANSWERS if key != "diet"}):
            self.assertEqual(self.client.put("/api/nutrition", json=answers, headers=HEADERS).status_code, 422)
        self.save.assert_not_called()

    def test_water_needs_answers_first_then_keeps_the_last_seven_days(self):
        self.assertEqual(self.client.post("/api/nutrition/water", json={"date": today(), "ml": 250}, headers=HEADERS).status_code, 409)
        current = datetime.now(timezone.utc).date()
        history = {(current - timedelta(days=offset)).isoformat(): 1000 for offset in range(1, 9)}
        self.rows = [{"id": "nutrition-row", "details": {"answers": ANSWERS, "water": history}}]
        response = self.client.post("/api/nutrition/water", json={"date": today(), "ml": 1250}, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"date": today(), "ml": 1250})
        saved = self.supabase.table.return_value.update.call_args.args[0]["details"]
        self.assertEqual(saved["answers"], ANSWERS)
        self.assertEqual(len(saved["water"]), 7)
        self.assertEqual(saved["water"][today()], 1250)
        self.assertNotIn((current - timedelta(days=8)).isoformat(), saved["water"])

    def test_a_wrong_device_clock_still_loads_the_plan(self):
        self.rows = [{"id": "nutrition-row", "details": {"answers": ANSWERS, "water": {today(): 500}}}]
        response = self.client.get("/api/nutrition?date=2001-01-01", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["water"], {"date": today(), "ml": 500})

    def test_water_is_only_logged_for_today(self):
        self.rows = [{"id": "nutrition-row", "details": {"answers": ANSWERS}}]
        long_ago = (datetime.now(timezone.utc).date() - timedelta(days=3)).isoformat()
        self.assertEqual(self.client.post("/api/nutrition/water", json={"date": long_ago, "ml": 500}, headers=HEADERS).status_code, 422)
        self.supabase.table.return_value.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
