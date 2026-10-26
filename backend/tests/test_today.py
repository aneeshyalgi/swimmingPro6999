from datetime import date
import json
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app import today, tokens, training
from app.main import app

HEADERS = {"Authorization": "Bearer token"}
DAY = date(2026, 10, 21)            # a Wednesday
PROFILE = {"id": "row-1", "user_key": "key-1", "main_events": ["50m Freestyle"], "swimmer_type": "sprinter", "swim_sessions_per_week": 4,
           "gym_sessions_per_week": 2, "session_duration": "60", "facilities": ["25m Pool"], "recommended_coaches": ["Coach Brad"]}
MOBILITY = [{"category": "Shoulder mobility", "exercise": "Arm circles", "duration_minutes": 5, "instructions": ["Circle slowly."]}]
STRENGTH = {"title": "Leg power", "objective": "Starts.", "estimated_duration_minutes": 30, "exercises": [
    {"exercise": "Squat jump", "sets": 3, "repetitions": "5", "load": "Bodyweight", "rest_seconds": 90, "tempo": None,
     "demonstration": ["Jump."]}]}


def gym_workout(day: str, focus: str) -> dict:
    return {"id": f"gym-{day}-{focus}", "session_type": "gym_workout", "session_date": f"{day}T00:00:00+00:00",
            "details": {"workout": {"title": focus}, "focus": focus, "source": "ai"}}


class FakeTable:
    def __init__(self, database, name):
        self.database, self.name = database, name

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self

    def upsert(self, payload, **_options):
        self.database.saved.append(payload)
        return self

    def execute(self):
        return SimpleNamespace(data=self.database.tables.get(self.name, []))


class FakeDatabase:
    def __init__(self):
        self.tables = {"user_ai_plans": [{"plan": {"phase": "Build"}}], "user_training_sessions": []}
        self.saved = []

    def table(self, name):
        return FakeTable(self, name)


class DailyPlanTests(unittest.TestCase):
    """Today's plan, for a week the athlete hasn't generated: it fits around the Gym week and speaks to the athlete."""

    def setUp(self):
        self.client = TestClient(app)
        self.database = FakeDatabase()
        self.gym = []
        self.openai = MagicMock()
        self.empty = today.TodayResponse(date=DAY.isoformat(), day_name="Wednesday", plan=None, total_swim_distance_meters=None,
                                         sessions_scheduled=0, feedback=None, feedback_saved_at=None, source_files=[], feedback_history=[])
        for target, name, options in [
            (today, "get_authenticated_profile", {"return_value": PROFILE}), (today, "_day", {"return_value": DAY}),
            (today, "_response", {"side_effect": self.response}), (today, "get_supabase_client", {"return_value": self.database}),
            (today, "get_settings", {"return_value": SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-4o-mini",
                                                                       openai_reasoning_effort="low")}),
            (today, "chat_context", {"return_value": ("PROGRAM", [], ["Coach Brad"])}), (today, "recent_athlete_feedback", {"return_value": []}),
            (today, "OpenAI", {"return_value": self.openai}), (tokens, "charge", {"return_value": None}),
            (training, "library", {"return_value": []}), (training, "load_records", {"side_effect": lambda *_args: self.gym}),
            (training, "recent_race_results", {"return_value": []}), (training, "pacing_context", {"return_value": {}}),
        ]:
            patcher = patch.object(target, name, **options)
            self.addCleanup(patcher.stop)
            patcher.start()

    def response(self, _profile_id, _day):
        if not self.database.saved:
            return self.empty
        return self.empty.model_copy(update={"plan": today.DailyPlan.model_validate(self.database.saved[-1]["details"]["plan"])})

    def generate(self, objective="Easy aerobic swim and strength.", strength=None):
        plan = {"training_phase": "Build", "daily_objective": objective, "swim": None, "second_swim": None, "strength": strength,
                "mobility": MOBILITY, "recovery": ["Sleep 8 hours."], "coaching_note": "Keep it easy."}
        self.openai.chat.completions.create.return_value.choices = [SimpleNamespace(message=SimpleNamespace(content=json.dumps(plan)))]
        response = self.client.post("/api/today/generate", headers=HEADERS)
        return response, self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]

    def test_a_day_with_a_strength_workout_on_the_gym_week_gets_no_second(self):
        self.gym = [gym_workout("2026-10-21", "Lower body"), gym_workout("2026-10-20", "Upper body")]
        response, prompt = self.generate(strength=STRENGTH)
        self.assertIn("0 strength sessions", prompt)
        # The plan is told what's already on today, so it never says there's no gym workout.
        self.assertIn('GYM WEEK TODAY (already planned', prompt)
        self.assertIn('["Lower body (strength)"]', prompt)
        self.assertEqual(response.status_code, 502, response.text)
        self.assertEqual(self.database.saved, [])

    def test_the_gym_weeks_strength_workouts_count_toward_the_week_and_mobility_ones_dont(self):
        self.gym = [gym_workout("2026-10-19", "Upper body"), gym_workout("2026-10-21", "Mobility for sprinters"),
                    gym_workout("2026-10-30", "Lower body")]             # next week's doesn't count
        response, prompt = self.generate(strength=STRENGTH)
        self.assertIn("1 strength sessions", prompt)
        self.assertIn('["Mobility for sprinters (mobility)"]', prompt)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["plan"]["strength"]["title"], "Leg power")
        self.gym = []
        self.database.saved.clear()
        self.assertIn("2 strength sessions", self.generate()[1])

    def test_what_the_athlete_reads_never_opens_with_the_date(self):
        response, prompt = self.generate(objective="2026-10-21 (UTC): Easy aerobic swim and strength.")
        self.assertIn("never with the\ndate, the time zone", prompt)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["plan"]["daily_objective"], "Easy aerobic swim and strength.")
        self.assertEqual(self.database.saved[0]["details"]["plan"]["daily_objective"], "Easy aerobic swim and strength.")
        # A date inside the sentence is the athlete's to read.
        self.database.saved.clear()
        response, _ = self.generate(objective="Easy aerobic swim before your meet on 2026-10-24.")
        self.assertEqual(response.json()["plan"]["daily_objective"], "Easy aerobic swim before your meet on 2026-10-24.")


if __name__ == "__main__":
    unittest.main()
