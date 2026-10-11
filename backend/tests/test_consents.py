"""Consents for athletes who join from now on; athletes who joined before (no consent record) are never affected."""
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.consents import LEGAL_VERSION, Guardian
from app.main import app
from app.schemas import OnboardingSubmission
from app.training import record_id

HEADERS = {"Authorization": "Bearer token"}
PROFILE = {"id": "row-1"}
NEW = {"version": LEGAL_VERSION, "accepted_at": "2026-10-11T10:00:00+00:00", "health": None, "parental": None}
MIND = {
    "goal": "nerves", "confidence": 4, "focus": 3, "calm": 2, "motivation": 5, "resilience": 3, "pre_race": "anxious",
    "routine": "loose", "setback": "move_on", "sleep": "ok", "stress": "medium", "mood": "good", "tools": ["self_talk"],
}
BODY = {
    "age": 18, "gender": "female", "country": "Canada", "height": 180, "weight": 72, "swim_experience": 8,
    "main_events": ["200m Freestyle"], "pbs_lcm": {"200m Freestyle": "2:03.40"}, "swimmer_type": "mid",
    "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "90", "facilities": ["50m Pool"],
    "coaching_situation": "club", "one_year_goal_times": {"200m Freestyle": "1:59.80"}, "coach": "Coach Brad",
}


class ConsentApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.record = None
        self.saved = []
        self.supabase = MagicMock()
        for target, options in [
            ("app.consents.get_authenticated_profile", {"return_value": PROFILE}),
            ("app.consents.consent_record", {"side_effect": lambda profile_id: self.record}),
            ("app.consents._save", {"side_effect": lambda profile_id, details: self.saved.append(details)}),
            ("app.consents.get_supabase_client", {"return_value": self.supabase}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_an_athlete_who_joined_before_sees_nothing_new_and_nothing_is_stored_or_deleted(self):
        state = self.client.get("/api/consents", headers=HEADERS).json()
        self.assertEqual((state["health_required"], state["health"], state["parental"]), (False, None, False))
        self.assertFalse(self.client.post("/api/consents/health", headers=HEADERS).json()["health_required"])
        self.assertFalse(self.client.delete("/api/consents/health", headers=HEADERS).json()["health_required"])
        self.assertEqual(self.saved, [])
        self.supabase.table.assert_not_called()

    def test_a_new_athlete_agrees_once_and_it_is_kept_with_the_version(self):
        self.record = dict(NEW)
        self.assertTrue(self.client.get("/api/consents", headers=HEADERS).json()["health_required"])
        state = self.client.post("/api/consents/health", headers=HEADERS).json()
        self.assertFalse(state["health_required"])
        health = self.saved[-1]["health"]
        self.assertEqual((health["version"], health["by"]), (LEGAL_VERSION, "athlete"))
        self.assertTrue(health["given_at"])
        self.assertEqual(self.saved[-1]["parental"], None)  # the rest of the record is kept

    def test_under_16_the_guardian_agreed_at_onboarding(self):
        self.record = {**NEW, "parental": {"name": "Sam Lee", "email": "sam@example.com", "version": LEGAL_VERSION, "given_at": "x"}}
        state = self.client.post("/api/consents/health", headers=HEADERS).json()
        self.assertTrue(state["parental"])
        self.assertEqual(self.saved[-1]["health"]["by"], "guardian")

    def test_withdrawing_deletes_the_health_data_and_asks_again(self):
        self.record = {**NEW, "health": {"version": LEGAL_VERSION, "given_at": "2026-10-11T11:00:00+00:00", "by": "athlete"}}
        state = self.client.delete("/api/consents/health", headers=HEADERS).json()
        self.assertTrue(state["health_required"])
        deletes = self.supabase.table.return_value.delete.return_value.eq.return_value
        ids = deletes.in_.call_args.args
        self.assertEqual(ids, ("id", [record_id("row-1", "mental"), record_id("row-1", "nutrition")]))
        deletes.eq.assert_called_with("session_type", "athlete_feedback")
        self.assertIsNone(self.saved[-1]["health"]["given_at"])
        self.assertTrue(self.saved[-1]["health"]["withdrawn_at"])


class HealthFeaturesTests(unittest.TestCase):
    """Mind, Nutrition and daily check-ins need the consent of a new athlete, and nothing of one who joined before."""

    def setUp(self):
        self.client = TestClient(app)
        self.record = dict(NEW)
        for target, options in [
            ("app.consents.consent_record", {"side_effect": lambda profile_id: self.record}),
            ("app.mental.get_authenticated_profile", {"return_value": PROFILE}),
            ("app.mental.find_record", {"return_value": None}),
            ("app.mental.save_record", {"return_value": "id"}),
            ("app.nutrition.get_authenticated_profile", {"return_value": {"id": "row-1", "age": 20, "gender": "male", "height": 180, "weight": 75}}),
            ("app.nutrition.find_record", {"return_value": None}),
            ("app.today.get_authenticated_profile", {"return_value": PROFILE}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def requests(self):
        return [
            self.client.get("/api/mental", headers=HEADERS),
            self.client.put("/api/mental", json=MIND, headers=HEADERS),
            self.client.post("/api/mental/checkin", json={"date": "2026-10-11", "mood": 3}, headers=HEADERS),
            self.client.get("/api/nutrition", headers=HEADERS),
            self.client.post("/api/today/feedback", json={"date": "2026-10-11", "feedback": {
                "session_rpe": 5, "energy": 3, "muscle_soreness": 2, "sleep_quality": 4, "session_quality": 4}}, headers=HEADERS),
        ]

    def test_a_new_athlete_must_agree_first(self):
        for response in self.requests():
            self.assertEqual(response.status_code, 403, response.request.url)
            self.assertIn("health information", response.json()["detail"])

    def test_after_agreeing_and_for_athletes_who_joined_before_nothing_is_blocked(self):
        for record in ({**NEW, "health": {"given_at": "2026-10-11T11:00:00+00:00"}}, None):
            self.record = record
            for response in self.requests():
                self.assertNotEqual(response.status_code, 403, response.request.url)


class NewAthleteOnboardingTests(unittest.TestCase):
    def post(self, body, existing=None):
        row = {**OnboardingSubmission(**BODY).to_storage_record(),
               "id": "row-1", "user_key": "user_1", "full_name": "Alex Swim", "recommended_coaches": ["Coach Brad"]}
        supabase = MagicMock()
        supabase.table.return_value.insert.return_value.execute.return_value = SimpleNamespace(data=[row])
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[row])
        self.generate = MagicMock(return_value=({"generation_version": 3}, [], "gpt-4.1", "Coach Brad"))
        self.recorded = MagicMock()
        user = SimpleNamespace(id="user-1", user_metadata={"full_name": "Alex Swim"})
        with patch("app.main.get_authenticated_user", return_value=user), patch("app.main.latest_profile_row", return_value=existing), \
                patch("app.main.is_paid", return_value=False), patch("app.main.generate_dashboard_plan", new=self.generate), \
                patch("app.main.get_supabase_client", return_value=supabase), patch("app.main.record_new_athlete", new=self.recorded):
            return TestClient(app).post("/api/onboarding", json={**BODY, **body}, headers=HEADERS)

    def test_swimgpt_is_for_athletes_aged_13_and_over(self):
        self.assertEqual(self.post({"age": 12}).status_code, 422)

    def test_a_new_athlete_under_16_needs_a_parent_or_guardian(self):
        response = self.post({"age": 14})
        self.assertEqual(response.status_code, 400)
        self.assertIn("parent or guardian", response.json()["detail"])
        self.generate.assert_not_called()
        self.assertEqual(self.post({"age": 14, "guardian_consent": True, "guardian_name": "Sam Lee", "guardian_email": "not-an-email"}).status_code, 400)

    def test_the_guardian_who_agreed_is_kept_with_the_new_profile(self):
        response = self.post({"age": 14, "guardian_consent": True, "guardian_name": " Sam Lee ", "guardian_email": "Sam@Example.com"})
        self.assertEqual(response.status_code, 201, response.text)
        profile_id, guardian = self.recorded.call_args.args
        self.assertEqual((profile_id, guardian), ("row-1", Guardian(name="Sam Lee", email="sam@example.com")))

    def test_a_new_athlete_of_16_or_over_joins_without_a_guardian(self):
        self.assertEqual(self.post({"age": 16}).status_code, 201)
        self.assertEqual(self.recorded.call_args.args, ("row-1", None))

    def test_an_athlete_who_joined_before_edits_their_answers_as_before(self):
        existing = {"id": "row-1", "user_key": "user_1", "recommended_coaches": ["Coach Brad"], "is_paid": False}
        response = self.post({"age": 14}, existing=existing)
        self.assertEqual(response.status_code, 201, response.text)
        self.recorded.assert_not_called()


if __name__ == "__main__":
    unittest.main()
