"""Short course yards PBs in onboarding: asked of athletes who join from now on; athletes who joined before keep their
profile exactly as it was."""
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app.main import app
from app.performance import YARD_EVENTS
from app.schemas import ONBOARDING_EVENTS, OnboardingSubmission, yard_event
from app.training import athlete_brief, best_pace

HEADERS = {"Authorization": "Bearer token"}
BODY = {
    "age": 19, "gender": "male", "country": "United States", "height": 185, "weight": 78, "swim_experience": 9,
    "main_events": ["50m Freestyle", "400m Freestyle"], "swimmer_type": "mid",
    "pbs_lcm": {"50m Freestyle": "23.90", "400m Freestyle": "4:12.50"},
    "one_year_goal_times": {"50m Freestyle": "23.40", "400m Freestyle": "4:08.00"},
    "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "120", "facilities": ["25m Pool"],
    "coaching_situation": "team", "coach": "Coach Brad",
}
MISSING_COLUMN = APIError({"message": "Could not find the 'pbs_scy' column of 'user_profiles' in the schema cache",
                           "code": "PGRST204", "hint": None, "details": None})


class YardEventTests(unittest.TestCase):
    def test_every_onboarding_event_has_its_yard_event(self):
        self.assertEqual({event: yard_event(event) for event in ("100m Backstroke", "200m IM", "400m Freestyle", "800m Freestyle", "1500m Freestyle")},
                         {"100m Backstroke": "100y Backstroke", "200m IM": "200y IM", "400m Freestyle": "500y Freestyle",
                          "800m Freestyle": "1000y Freestyle", "1500m Freestyle": "1650y Freestyle"})
        # The Performance page lists these as SCY results.
        self.assertTrue(all(yard_event(event) in YARD_EVENTS for event in ONBOARDING_EVENTS))

    def test_yard_times_are_optional_for_selected_events_and_must_be_realistic(self):
        self.assertEqual(OnboardingSubmission(**BODY).to_storage_record()["pbs_scy"], {})
        fast_sprint = OnboardingSubmission(**BODY, pbs_scy={"50y Freestyle": "19.10", "500y Freestyle": ""})
        self.assertEqual(fast_sprint.to_storage_record()["pbs_scy"], {"50y Freestyle": {"minutes": 0, "seconds": 19, "hundredths": 10}})
        for times in ({"50m Freestyle": "21.00"}, {"100y Freestyle": "48.00"}, {"50y Freestyle": "15.00"}, {"500y Freestyle": "25:00.00"}):
            with self.subTest(times=times), self.assertRaises(ValueError):
                OnboardingSubmission(**BODY, pbs_scy=times)


class OnboardingScyTests(unittest.TestCase):
    def post(self, body, existing=None, insert_errors=()):
        row = {**OnboardingSubmission(**BODY).to_storage_record(),
               "id": "row-1", "user_key": "user_1", "full_name": "Sam Yards", "recommended_coaches": ["Coach Brad"]}
        self.supabase = MagicMock()
        table = self.supabase.table.return_value
        errors = list(insert_errors)

        def insert():  # the given errors first (the profile is the first insert), then every insert succeeds
            if errors:
                raise errors.pop(0)
            return SimpleNamespace(data=[row])
        table.insert.return_value.execute.side_effect = insert
        table.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[row])
        self.generate = MagicMock(return_value=({"generation_version": 3}, [], "gpt-4.1", "Coach Brad"))
        user = SimpleNamespace(id="user-1", user_metadata={"full_name": "Sam Yards"})
        with patch("app.main.get_authenticated_user", return_value=user), patch("app.main.latest_profile_row", return_value=existing), \
                patch("app.main.is_paid", return_value=False), patch("app.main.generate_dashboard_plan", new=self.generate), \
                patch("app.main.get_supabase_client", return_value=self.supabase), patch("app.main.record_new_athlete"):
            return TestClient(app).post("/api/onboarding", json={**BODY, **body}, headers=HEADERS)

    def written(self, method):
        """What was written to user_profiles (the other tables' rows have no auth_user_id)."""
        return [call.args[0] for call in getattr(self.supabase.table.return_value, method).call_args_list if "auth_user_id" in call.args[0]]

    def test_a_new_athlete_s_yard_times_are_saved_and_planned_with(self):
        response = self.post({"pbs_scy": {"500y Freestyle": "4:39.80"}})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.written("insert")[0]["pbs_scy"], {"500y Freestyle": {"minutes": 4, "seconds": 39, "hundredths": 80}})
        self.assertEqual(self.generate.call_args.args[0]["pbs_scy"], {"500y Freestyle": "4:39.80"})

    def test_a_new_athlete_without_yard_times_is_marked_as_asked(self):
        self.assertEqual(self.post({}).status_code, 201)
        self.assertEqual(self.written("insert")[0]["pbs_scy"], {})

    def test_yard_times_for_an_event_that_isn_t_selected_are_refused(self):
        self.assertEqual(self.post({"pbs_scy": {"100y Backstroke": "52.00"}}).status_code, 422)
        self.generate.assert_not_called()

    def test_an_athlete_who_joined_before_keeps_their_profile_as_it_was(self):
        existing = {"id": "row-1", "user_key": "user_1", "recommended_coaches": ["Coach Brad"], "is_paid": False, "pbs_scy": None}
        self.assertEqual(self.post({"pbs_scy": {"500y Freestyle": "4:39.80"}}, existing=existing).status_code, 201)
        self.assertNotIn("pbs_scy", self.written("update")[0])

    def test_an_athlete_who_joined_with_yards_can_edit_them(self):
        existing = {"id": "row-1", "user_key": "user_1", "recommended_coaches": ["Coach Brad"], "is_paid": False, "pbs_scy": {}}
        self.assertEqual(self.post({"pbs_scy": {"50y Freestyle": "20.85"}}, existing=existing).status_code, 201)
        self.assertEqual(self.written("update")[0]["pbs_scy"], {"50y Freestyle": {"minutes": 0, "seconds": 20, "hundredths": 85}})

    def test_until_the_column_exists_the_profile_is_saved_without_the_yard_times(self):
        response = self.post({"pbs_scy": {"500y Freestyle": "4:39.80"}}, insert_errors=[MISSING_COLUMN])
        self.assertEqual(response.status_code, 201, response.text)
        first, retry = self.written("insert")
        self.assertIn("pbs_scy", first)
        self.assertNotIn("pbs_scy", retry)
        self.assertEqual({key: value for key, value in first.items() if key != "pbs_scy"}, retry)

    def test_other_database_errors_are_not_hidden(self):
        other = APIError({"message": "duplicate key value", "code": "23505", "hint": None, "details": None})
        self.assertEqual(self.post({}, insert_errors=[other]).status_code, 400)
        self.assertEqual(len(self.written("insert")), 1)

    def test_saved_answers_report_yard_times_only_for_athletes_who_were_asked(self):
        user = SimpleNamespace(id="user-1")
        for saved, expected in ((None, None), ({"500y Freestyle": {"minutes": 4, "seconds": 39, "hundredths": 80}}, {"500y Freestyle": {"minutes": 4, "seconds": 39, "hundredths": 80}})):
            row = {"id": "row-1", "user_key": "user_1", "pbs_scy": saved}
            with patch("app.main.get_authenticated_user", return_value=user), patch("app.main.latest_profile_row", return_value=row), \
                    patch("app.main._has_plan", return_value=True), patch("app.main.is_paid", return_value=False):
                answers = TestClient(app).get("/api/onboarding", headers=HEADERS).json()["answers"]
            self.assertEqual(answers["pbs_scy"], expected)


class CoachBriefTests(unittest.TestCase):
    def test_yard_pbs_are_paced_per_100_yards_and_kept_out_of_the_metre_pace(self):
        profile = {"pbs_lcm": {"400m Freestyle": "4:12.50"}, "pbs_scy": {"500y Freestyle": "4:39.80", "50y Freestyle": "19.10"}}
        times = athlete_brief(profile)["times_by_event"]
        self.assertEqual(times["500y Freestyle"]["SCY PB"]["pace_per_100yd_seconds"], 56.0)
        self.assertNotIn("usable_for_pacing", times["50y Freestyle"]["SCY PB"])  # 38.2 s per 100 yd is a real sprint
        self.assertEqual(best_pace(profile), 63.1)  # the 400m LCM pace, not a yard pace read as metres


if __name__ == "__main__":
    unittest.main()
