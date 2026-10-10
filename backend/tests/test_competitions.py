from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app

MEET = "3f2b8c1e-7d4a-5b6c-9e0f-1a2b3c4d5e6f"
OTHER_MEET = "9a8b7c6d-5e4f-5a3b-8c2d-1e0f9a8b7c6d"
HEADERS = {"Authorization": "Bearer token"}


def record(id, kind, competition_id):
    return {"id": id, "session_type": kind, "details": {"competition_id": competition_id}}


class DeleteCompetitionTests(unittest.TestCase):
    """Deleting a meet takes its race plans and results with it, and nothing else."""

    def setUp(self):
        self.client = TestClient(app)
        self.supabase = MagicMock()
        self.records = [
            record("plan-1", "race_plan", MEET), record("result-50", "race_result", MEET), record("result-100", "race_result", MEET),
            record("plan-2", "race_plan", OTHER_MEET), record("result-other", "race_result", OTHER_MEET),
        ]
        for target, options in [
            ("app.training.get_authenticated_profile", {"return_value": {"id": "row-1"}}),
            ("app.training.owned_competition", {"side_effect": self.owned}),
            ("app.training.load_records", {"side_effect": lambda profile_id, kinds: [row for row in self.records if row["session_type"] in kinds]}),
            ("app.training.get_supabase_client", {"return_value": self.supabase}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def owned(profile, identifier):
        if identifier not in (MEET, OTHER_MEET):
            raise HTTPException(status_code=404, detail="Competition not found in your account.")
        return {"id": identifier, "name": "Regional Championships"}

    def test_the_meet_its_race_plans_and_its_results_go_in_one_delete(self):
        response = self.client.delete(f"/api/training/competitions/{MEET}", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"deleted": MEET})
        table = self.supabase.table
        table.assert_called_once_with("user_training_sessions")
        delete = table.return_value.delete.return_value
        delete.eq.assert_called_once_with("user_id", "row-1")
        delete.eq.return_value.in_.assert_called_once_with("id", [MEET, "plan-1", "result-50", "result-100"])
        delete.eq.return_value.in_.return_value.execute.assert_called_once()

    def test_a_meet_that_is_not_theirs_deletes_nothing(self):
        response = self.client.delete("/api/training/competitions/0b9d8c7a-6e5f-4a3b-8c2d-1e0f9a8b7c6d", headers=HEADERS)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.delete("/api/training/competitions/not-a-meet", headers=HEADERS).status_code, 422)
        self.supabase.table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
