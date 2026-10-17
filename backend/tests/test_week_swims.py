from datetime import date, timedelta
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app import training
from app.main import app

LIBRARY = training.library  # the real one; the tests below replace it to set up each day
HEADERS = {"Authorization": "Bearer token"}
PROFILE = {"id": "row-1", "facilities": ["50m Pool", "Full Gym Access"]}
DAY = date(2026, 10, 15)
MONDAY = DAY - timedelta(days=DAY.weekday())
SWIM_ID = "0b9d8c7a-6e5f-4a3b-8c2d-1e0f9a8b7c6d"


def swim_set(name, repetitions, distance, zone="Aerobic"):
    return {"name": name, "rounds": 1, "repetitions": repetitions, "distance_meters": distance, "stroke": "Freestyle",
            "interval": "@ 1:40", "target_time": None, "training_zone": zone, "equipment": [], "description": "Steady.",
            "technical_focus": ["Long strokes"]}


WORKOUT = {
    "title": "Threshold builder", "objective": "Hold threshold pace.", "event": None, "notes": "", "estimated_duration_minutes": 60,
    "main_training_zones": ["Recovery", "Threshold"], "equipment": [],
    "sets": [swim_set("Warm-up", 1, 400, "Recovery"), swim_set("Main set", 8, 100, "Threshold"), swim_set("Cool-down", 1, 200, "Recovery")],
}


def planned(key, meters, day=DAY):
    return {"key": key, "date": day.isoformat(), "distance_meters": meters}


class AddWeekSwimTests(unittest.TestCase):
    """An athlete adds their own swim to a day of the swim week."""

    def setUp(self):
        self.client = TestClient(app)
        self.library = []
        self.week_plan = {"id": "week-1", "details": {"plan": {"phase": "Build"}}}
        self.supabase = MagicMock()
        self.patch("get_authenticated_profile", return_value=PROFILE)
        self.patch("library", side_effect=lambda profile: self.library)
        self.patch("find_record", side_effect=lambda profile_id, key: self.week_plan if key == f"week:{MONDAY}" else None)
        self.patch("get_supabase_client", return_value=self.supabase)
        self.save = self.patch("save_record", return_value="saved-id")
        self.week = self.patch("week_view", return_value={"week_start": MONDAY.isoformat()})

    def patch(self, name, **options):
        patcher = patch.object(training, name, **options)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def add(self, **body):
        return self.client.post("/api/training/week/swim", headers=HEADERS,
                                json={"date": DAY.isoformat(), "workout": WORKOUT, "id": SWIM_ID, **body})

    def saved_details(self):
        self.save.assert_called_once()
        profile_id, key, kind, name, day, details = self.save.call_args.args
        self.assertEqual((profile_id, key, kind, name, day), ("row-1", f"own-swim:{SWIM_ID}", "workout", "Threshold builder", DAY))
        return details

    def test_the_swim_is_saved_on_its_day_as_the_athletes_own(self):
        response = self.add()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"week_start": MONDAY.isoformat()})
        self.assertEqual(self.saved_details(), {
            "workout": training.SwimSession.model_validate(WORKOUT).model_dump(mode="json"), "date": DAY.isoformat(),
            "phase": "Build", "pool_length": 50, "event": None, "template": False, "source": "manual", "source_files": [],
        })
        self.week.assert_called_once_with(PROFILE, MONDAY)

    def test_the_week_reads_the_saved_swim_as_the_athletes_own(self):
        self.add()
        row = {"id": training.record_id("row-1", f"own-swim:{SWIM_ID}"), "session_type": "workout", "session_date": f"{DAY}T00:00:00+00:00",
               "details": self.saved_details()}
        with patch.object(training, "load_records", return_value=[row]):
            [item] = LIBRARY(PROFILE)
        self.assertEqual((item["key"], item["date"], item["origin"], item["phase"], item["pool_length"], item["distance_meters"], item["completed"]),
                         (row["id"], DAY.isoformat(), "My workout", "Build", 50, 1400, False))
        # Generating the week counts it as the athlete's own swim (and never duplicates it).
        self.assertIn(item["origin"], training.MANUAL_ORIGINS)

    def test_the_phase_is_the_season_plans_until_the_week_is_generated(self):
        self.week_plan = None
        self.supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"plan": {"phase": "General Preparation"}}]
        self.assertEqual(self.add().status_code, 200)
        self.assertEqual(self.saved_details()["phase"], "General Preparation")
        self.supabase.table.assert_called_with("user_ai_plans")

    def test_without_any_plan_the_phase_is_not_recorded(self):
        self.week_plan = None
        self.supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        self.assertEqual(self.add().status_code, 200)
        self.assertEqual(self.saved_details()["phase"], "Not recorded")

    def test_a_day_that_already_has_two_swims_is_refused(self):
        self.library = [planned("a", 3000), planned("b", 3000), planned("other-day", 3000, DAY + timedelta(days=1))]
        response = self.add()
        self.assertEqual(response.status_code, 409)
        self.assertIn("two swim sessions", response.json()["detail"])
        self.save.assert_not_called()

    def test_a_day_over_sixteen_kilometres_is_refused(self):
        self.library = [planned("a", 15000)]
        response = self.add()
        self.assertEqual(response.status_code, 409)
        self.assertIn("16,000 m", response.json()["detail"])
        self.save.assert_not_called()

    def test_sending_the_same_swim_again_saves_it_once(self):
        # The first send was saved but its reply was lost: the swim is already on the day, beside one other.
        self.library = [planned("a", 3000), planned(training.record_id("row-1", f"own-swim:{SWIM_ID}"), 1400)]
        self.assertEqual(self.add().status_code, 200)
        self.assertEqual(self.save.call_args.args[1], f"own-swim:{SWIM_ID}")

    def test_invalid_swims_are_refused_before_anything_is_saved(self):
        too_long = {**WORKOUT, "sets": [swim_set("Main set", 20, 605)]}
        for body in [{"workout": {**WORKOUT, "title": ""}}, {"workout": {**WORKOUT, "sets": []}}, {"workout": too_long},
                     {"id": "not-an-id"}, {"date": "15/10/2026"}, {"workout": {**WORKOUT, "estimated_duration_minutes": 5}}]:
            with self.subTest(body=body):
                self.assertEqual(self.add(**body).status_code, 422)
        self.save.assert_not_called()


if __name__ == "__main__":
    unittest.main()
