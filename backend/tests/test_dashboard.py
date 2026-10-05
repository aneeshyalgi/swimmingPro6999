from datetime import date
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.dashboard import build_dashboard_overview
from app.main import app


PROFILE = {
    "id": "profile-a",
    "auth_user_id": "account-a",
    "user_key": "athlete-a",
    "full_name": "Test Athlete",
    "main_events": ["100m Freestyle"],
    "swim_sessions_per_week": 4,
    "gym_sessions_per_week": 2,
    "session_duration": "90",
    "pbs_lcm": {"100m Freestyle": "1:02.00"},
    "pbs_scm": {"100m Freestyle": "0:59.00"},
    "one_year_goal_times": {"100m Freestyle": "1:00.00"},
}
PLAN = {
    "generation_version": 3,
    "phase": "Race-specific development",
    "phase_duration": "6 weeks",
    "focus": "Build repeatable 100m freestyle race pace.",
    "goals_summary": {"performance": "Work toward 1:00.00 in 100m Freestyle with repeatable race-pace work."},
    "swim": {
        "cycles": [{"name": "Race-pace block"}],
        "sessions": [{"type": "Freestyle race pace", "example": "Short repeats at your target pace."}],
    },
    "gym": {"focus": "Develop stroke-specific strength."},
    "recovery": {"strategies": [
        {"type": "Mobility", "tips": "Use the mobility work in your saved plan."},
        {"type": "Sleep", "tips": "Prioritize your recorded recovery needs."},
    ]},
}


def session(kind="swim", when="2026-10-03T08:00:00Z", **details):
    return {
        "session_type": kind,
        "session_name": "Recorded session",
        "session_date": when,
        "planned_duration_minutes": 90,
        "details": details,
    }


def query(data):
    result = MagicMock()
    for method in ("select", "eq", "order", "limit", "gte", "lt"):
        getattr(result, method).return_value = result
    result.execute.return_value = SimpleNamespace(data=data)
    return result


class DashboardOverviewTests(unittest.TestCase):
    def overview(self, sessions=None, profile=None):
        return build_dashboard_overview(profile or PROFILE, PLAN, sessions or [], date(2026, 10, 3))

    def test_onboarding_is_not_completed_history(self):
        overview = self.overview()
        self.assertEqual(overview.today, [])
        self.assertEqual(overview.weekly[0].value, "0")
        self.assertEqual(overview.weekly[1].value, "Not recorded")
        self.assertEqual(overview.weekly[2].value, "0")
        self.assertFalse(overview.zones)
        self.assertEqual(overview.training_status[2].value, "Not recorded")
        self.assertEqual(overview.training_status[3].value, "Not scheduled")
        self.assertEqual(overview.performance[2].value, "Not recorded")

    def test_today_shows_only_swims_and_workout_library_workouts(self):
        swim = {"key": "w1", "completed": True, "distance_meters": 3200,
                "workout": {"title": "Race pace 50s", "objective": "Hold race speed.", "estimated_duration_minutes": 75}}
        gym = {"key": "g1", "completed": False, "dose": "Full",
               "workout": {"title": "Pull power", "objective": "Upper-body pull strength.", "estimated_duration_minutes": 45,
                           "meta": {"start_time": "17:00", "end_time": "17:45"}}}
        day = {"date": "2026-10-03", "workouts": [swim], "gym": [gym],
               "strength": {"title": "Legacy strength", "objective": "x", "estimated_duration_minutes": 30, "exercises": []},
               "strength_completed": False, "mobility": [{"exercise": "Band pull-aparts", "duration_minutes": 10}],
               "mobility_completed": False, "recovery": ["Sleep 9 h"]}
        overview = build_dashboard_overview(PROFILE, PLAN, [session(completion_status="completed")], date(2026, 10, 3),
                                            training_week={"days": [day], "summary": {"strength_sessions": 1}})
        self.assertEqual([(item.category, item.name, item.status) for item in overview.today],
                         [("swim", "Race pace 50s", "Completed"), ("workout", "Pull power", "Planned")])
        self.assertEqual(overview.today[0].duration, "75 min · 3,200 m")
        self.assertEqual(overview.today[1].time, "17:00 – 17:45")

    def test_consistency_is_separate_for_swim_week_and_gym_week(self):
        swim = {"key": "w1", "completed": True, "distance_meters": 3000,
                "workout": {"title": "Swim", "objective": "x", "estimated_duration_minutes": 60}}
        days = [
            {"date": "2026-10-02", "workouts": [swim], "gym": [], "strength": None, "strength_completed": False,
             "mobility": [{"exercise": "Band pull-aparts", "duration_minutes": 5}], "mobility_completed": False, "recovery": []},
            {"date": "2026-10-04", "workouts": [dict(swim, key="w2", completed=False)], "gym": [], "strength": None,
             "strength_completed": False, "mobility": [], "mobility_completed": False, "recovery": []},
        ]
        gym = {"days": [{"date": "2026-10-01", "workouts": [{"completed": True}, {"completed": True}]},
                        {"date": "2026-10-05", "workouts": [{"completed": False}]}]}
        overview = build_dashboard_overview(PROFILE, PLAN, [], date(2026, 10, 3),
                                            training_week={"days": days, "summary": {"strength_sessions": 0}}, workout_week=gym)
        metrics = {item.label: item for item in overview.performance}
        self.assertEqual(metrics["Swim week consistency"].value, "1 / 3")
        self.assertEqual(metrics["Swim week consistency"].detail, "1 of 2 due so far · swims, strength and mobility this week")
        self.assertEqual(metrics["Gym week consistency"].value, "2 / 3")
        self.assertEqual(metrics["Gym week consistency"].detail, "2 of 2 due so far · workouts this week")

    def test_pbs_preserve_course_and_lcm_target(self):
        overview = self.overview()
        self.assertEqual(overview.personal_bests[0].time, "1:02.00")
        self.assertEqual(overview.personal_bests[0].target, "1:00.00")
        self.assertEqual(overview.personal_bests[1].course, "SCM")
        self.assertIsNone(overview.personal_bests[1].target)
        self.assertEqual(overview.performance[0].value, "Date not recorded")
        self.assertEqual(overview.insight.body, PLAN["goals_summary"]["performance"])

    def test_completed_records_drive_totals_and_zone_distribution(self):
        overview = self.overview([
            session(completion_status="completed", primary_objective="Race-pace execution",
                    distance_meters=3000, race_pace_meters=600,
                    zone_volumes_meters={"Aerobic": 2400, "Race pace": 600}),
            session(kind="gym", when="2026-10-01T18:00:00Z", completion_status="completed"),
            session(kind="recovery", completion_status="completed"),
            session(kind="recovery", when="2026-10-03T19:00:00Z", completion_status="completed"),
            session(when="2026-09-27T08:00:00Z", completion_status="completed", distance_meters=9000),
            session(when="2026-10-05T08:00:00Z", completion_status="completed", distance_meters=9000),
            session(when="2026-10-04T08:00:00Z", completion_status="scheduled", distance_meters=6000),
        ])
        self.assertEqual([item.value for item in overview.weekly], ["1", "3,000 m", "1", "600 m", "1"])
        self.assertEqual([zone.percentage for zone in overview.zones], [80, 20])
        self.assertEqual(overview.performance[3].value, "2 / 3")

    def test_incomplete_measurements_do_not_become_partial_totals(self):
        overview = self.overview([
            session(completion_status="completed", distance_meters=2000, race_pace_meters=400, zone_volumes_meters={"Aerobic": 2000}),
            session(completion_status="completed"),
        ])
        self.assertEqual(overview.weekly[0].value, "2")
        self.assertEqual(overview.weekly[1].value, "Not recorded")
        self.assertEqual(overview.weekly[3].value, "Not recorded")
        self.assertFalse(overview.zones)

    def test_invalid_measurement_is_explicit_error(self):
        for value in (-1, True, float("nan"), float("inf"), "3000"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.overview([session(completion_status="completed", distance_meters=value)])

    def test_timezone_boundary_uses_utc(self):
        overview = self.overview([
            session(when="2026-10-04T00:30:00+02:00", completion_status="completed"),
            session(when="2026-10-05T00:30:00+02:00", completion_status="completed"),
        ])
        self.assertEqual(overview.weekly[0].value, "2")

    def test_zero_gym_and_empty_pbs_do_not_invent_training(self):
        profile = {**PROFILE, "gym_sessions_per_week": 0, "pbs_lcm": {}, "pbs_scm": {}}
        overview = self.overview(profile=profile)
        self.assertEqual(overview.today, [])
        self.assertEqual(overview.personal_bests, [])
        self.assertEqual(overview.performance[0].value, "Not recorded")


class DashboardEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.supabase = MagicMock()
        self.supabase.auth.get_user.return_value = SimpleNamespace(user=SimpleNamespace(id="account-a"))
        self.profile_query = query([PROFILE])
        self.plan_query = query([{"plan": PLAN}])
        self.session_query = query([])
        self.supabase.table.side_effect = {
            "user_profiles": self.profile_query,
            "user_ai_plans": self.plan_query,
            "user_training_sessions": self.session_query,
        }.__getitem__
        # The token check and profile lookup live in app.auth; the plan/session reads in app.main.
        for target in ("app.main.get_supabase_client", "app.auth.get_supabase_client"):
            patcher = patch(target, return_value=self.supabase)
            patcher.start()
            self.addCleanup(patcher.stop)
        # Calendar and competition loaders read their own tables; an empty week keeps this a unit test.
        empty_week = {"days": [], "summary": {"strength_sessions": 0}, "phase": None, "coaching_note": None, "generated": False}
        for target, value in [("app.main.get_week", empty_week), ("app.main.gym_week", {"days": []}),
                              ("app.main.next_competition", None), ("app.main.competitions", [])]:
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch("app.main.apply_performance_snapshot", side_effect=lambda profile, overview: overview)
        patcher.start()
        self.addCleanup(patcher.stop)

    def get(self, path="/api/dashboard"):
        return self.client.get(path, headers={"Authorization": "Bearer test-access-token"})

    def test_requires_authentication(self):
        self.assertEqual(self.client.get("/api/dashboard").status_code, 401)
        self.assertEqual(self.client.get("/api/dashboard/athlete-a").status_code, 401)
        self.supabase.auth.get_user.assert_not_called()

    def test_dashboard_uses_verified_account_and_profile(self):
        response = self.get()
        self.assertEqual(response.status_code, 200, response.text)
        self.supabase.auth.get_user.assert_called_once_with("test-access-token")
        self.profile_query.eq.assert_called_once_with("auth_user_id", "account-a")
        self.session_query.eq.assert_called_once_with("user_id", "profile-a")
        self.assertEqual(response.json()["profile"]["full_name"], "Test Athlete")
        self.assertEqual(response.json()["overview"]["today"], [])

    def test_legacy_user_key_cannot_select_another_profile(self):
        self.assertEqual(self.get("/api/dashboard/another-athlete").status_code, 403)
        self.plan_query.execute.assert_not_called()
        self.assertEqual(self.get("/api/dashboard/athlete-a").status_code, 200)

    def test_missing_profile_and_plan_are_explicit(self):
        self.profile_query.execute.return_value.data = []
        self.assertEqual(self.get().status_code, 404)
        self.profile_query.execute.return_value.data = [PROFILE]
        self.plan_query.execute.return_value.data = []
        self.assertEqual(self.get().status_code, 409)

    def test_invalid_session_is_rejected(self):
        self.supabase.auth.get_user.return_value = SimpleNamespace(user=None)
        self.assertEqual(self.get().status_code, 401)
        self.profile_query.execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
