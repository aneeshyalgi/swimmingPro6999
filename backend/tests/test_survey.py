"""The dashboard survey: answers are checked, saved as one row per athlete and survey round, and the survey stays out of
the way (and out of everything else) until its table exists."""
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app.main import app
from app.survey import NOT_OPEN, NOT_SAVED, SURVEY_VERSION, TABLE, SurveyAnswers

HEADERS = {"Authorization": "Bearer token"}
ANSWERS = {
    "rating": 4, "usage_frequency": "few_weekly", "training_impact": "better",
    "features_used": ["swim_week", "coach_chat"], "feature_ratings": {"swim_week": 5, "coach_chat": 3},
    "liked": ["personalised", "coach"], "liked_note": "  The plans fit my week.  ",
    "improve": ["phone"], "improve_note": "", "wishlist": ["watch_sync"], "wishlist_note": "   ",
    "recommend": 9, "comments": "Keep going", "contact_ok": True,
}
MISSING = APIError({"code": "PGRST205", "message": "Could not find the table 'public.user_platform_surveys' in the schema cache"})
BROKEN = APIError({"code": "23514", "message": "new row violates check constraint", "details": "Failing row contains (Keep going)"})


class SurveyAnswersTests(unittest.TestCase):
    def test_the_answers_become_the_tables_columns(self):
        record = SurveyAnswers(**ANSWERS).record()
        self.assertEqual(record["liked_note"], "The plans fit my week.")
        self.assertIsNone(record["improve_note"])
        self.assertIsNone(record["wishlist_note"])
        self.assertEqual(record["feature_ratings"], {"swim_week": 5, "coach_chat": 3})
        self.assertEqual((record["rating"], record["recommend"], record["contact_ok"]), (4, 9, True))
        self.assertEqual(set(record), set(ANSWERS))

    def test_free_text_keeps_line_breaks_and_drops_what_postgres_cant_store(self):
        record = SurveyAnswers(**{**ANSWERS, "comments": "Line one\r\nLine two\x00\x07 👋‍", "liked_note": "\x00 \t "}).record()
        self.assertEqual(record["comments"], "Line one\nLine two 👋‍")
        self.assertIsNone(record["liked_note"])

    def test_repeated_choices_count_once(self):
        answers = SurveyAnswers(**{**ANSWERS, "features_used": ["swim_week", "coach_chat", "swim_week"], "liked": ["coach", "coach"]})
        self.assertEqual((answers.features_used, answers.liked), (["swim_week", "coach_chat"], ["coach"]))


class SurveyApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.supabase = MagicMock()
        self.read = self.supabase.table.return_value.select.return_value.eq.return_value.eq.return_value.limit.return_value.execute
        self.read.return_value = SimpleNamespace(data=[])
        self.write = self.supabase.table.return_value.upsert
        self.write.return_value.execute.side_effect = lambda: SimpleNamespace(data=[{**self.write.call_args.args[0], "id": "row"}])
        for target, options in [
            ("app.survey.get_authenticated_profile", {"return_value": {"id": "profile-1"}}),
            ("app.survey.get_supabase_client", {"return_value": self.supabase}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_an_athlete_who_hasnt_answered_is_asked(self):
        response = self.client.get("/api/survey", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"version": SURVEY_VERSION, "available": True, "response": None})
        self.supabase.table.assert_called_with(TABLE)
        query = self.supabase.table.return_value.select.return_value
        query.eq.assert_called_with("user_id", "profile-1")
        query.eq.return_value.eq.assert_called_with("survey_version", SURVEY_VERSION)

    def test_an_athlete_who_answered_this_round_isnt_asked_again(self):
        self.read.return_value = SimpleNamespace(data=[{"rating": 5, "updated_at": "2026-10-18T09:00:00+00:00"}])
        body = self.client.get("/api/survey", headers=HEADERS).json()
        self.assertEqual(body["response"], {"rating": 5, "submitted_at": "2026-10-18T09:00:00+00:00"})

    def test_until_the_table_exists_the_survey_is_simply_not_offered(self):
        self.read.side_effect = MISSING
        response = self.client.get("/api/survey", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"version": SURVEY_VERSION, "available": False, "response": None})
        self.write.side_effect = MISSING
        response = self.client.post("/api/survey", json=ANSWERS, headers=HEADERS)
        self.assertEqual((response.status_code, response.json()["detail"]), (503, NOT_OPEN))

    def test_a_database_error_while_reading_is_a_502(self):
        self.read.side_effect = BROKEN
        with self.assertLogs("app.survey", level="WARNING"):
            self.assertEqual(self.client.get("/api/survey", headers=HEADERS).status_code, 502)

    def test_answers_are_saved_as_one_row_per_athlete_and_round(self):
        response = self.client.post("/api/survey", json=ANSWERS, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        row = self.write.call_args.args[0]
        self.assertEqual(self.write.call_args.kwargs, {"on_conflict": "user_id,survey_version"})
        self.assertEqual((row["user_id"], row["survey_version"], row["rating"]), ("profile-1", SURVEY_VERSION, 4))
        self.assertEqual((row["features_used"], row["liked_note"], row["improve_note"]), (["swim_week", "coach_chat"], "The plans fit my week.", None))
        self.assertNotIn("id", row)  # a first answer gets a new id; sending again keeps the row's id and created_at
        self.assertNotIn("created_at", row)
        self.assertTrue(row["updated_at"])
        self.assertEqual(response.json(), {"version": SURVEY_VERSION, "available": True,
                                           "response": {"rating": 4, "submitted_at": row["updated_at"]}})

    def test_incomplete_or_unknown_answers_are_refused_and_nothing_is_saved(self):
        bad = [
            {key: value for key, value in ANSWERS.items() if key != "rating"},
            {**ANSWERS, "rating": 0}, {**ANSWERS, "rating": 6}, {**ANSWERS, "rating": "5"}, {**ANSWERS, "rating": 4.5},
            {**ANSWERS, "recommend": -1}, {**ANSWERS, "recommend": 11}, {**ANSWERS, "recommend": True},
            {**ANSWERS, "usage_frequency": "hourly"}, {**ANSWERS, "training_impact": None},
            {**ANSWERS, "features_used": []}, {**ANSWERS, "features_used": ["swim_week", "teleport"]},
            {**ANSWERS, "feature_ratings": {"swim_week": 5}},
            {**ANSWERS, "feature_ratings": {"swim_week": 5, "coach_chat": 3, "nutrition": 4}},
            {**ANSWERS, "feature_ratings": {"swim_week": 6, "coach_chat": 3}},
            {**ANSWERS, "liked": []}, {**ANSWERS, "liked": ["coach", "design", "value", "ease"]},
            {**ANSWERS, "improve": []}, {**ANSWERS, "improve": ["nothing", "bugs"]},
            {**ANSWERS, "wishlist": ["teams", "offline", "reminders", "languages"]}, {**ANSWERS, "wishlist": ["flying"]},
            {**ANSWERS, "liked_note": "x" * 1001}, {**ANSWERS, "comments": "x" * 2001},
            {**ANSWERS, "contact_ok": "yes"}, {**ANSWERS, "email": "someone@example.com"},
        ]
        for answers in bad:
            response = self.client.post("/api/survey", json=answers, headers=HEADERS)
            self.assertEqual(response.status_code, 422, answers)
        self.write.assert_not_called()

    def test_the_optional_answers_can_be_left_out(self):
        required = {key: ANSWERS[key] for key in ("rating", "usage_frequency", "training_impact", "features_used",
                                                   "feature_ratings", "liked", "improve", "recommend")}
        response = self.client.post("/api/survey", json=required, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        row = self.write.call_args.args[0]
        self.assertEqual((row["wishlist"], row["comments"], row["contact_ok"]), ([], None, False))

    def test_a_failed_save_is_a_502_and_the_log_leaves_out_what_the_athlete_wrote(self):
        self.write.return_value.execute.side_effect = BROKEN
        with self.assertLogs("app.survey", level="WARNING") as logs:
            response = self.client.post("/api/survey", json=ANSWERS, headers=HEADERS)
        self.assertEqual((response.status_code, response.json()["detail"]), (502, NOT_SAVED))
        self.assertNotIn("Keep going", "\n".join(logs.output))
        self.write.return_value.execute.side_effect = lambda: SimpleNamespace(data=[])
        self.assertEqual(self.client.post("/api/survey", json=ANSWERS, headers=HEADERS).status_code, 502)

    def test_only_signed_in_paying_athletes_take_part(self):
        for code in (401, 402, 404):
            with patch("app.survey.get_authenticated_profile", side_effect=HTTPException(status_code=code, detail="no")):
                self.assertEqual(self.client.get("/api/survey", headers=HEADERS).status_code, code)
                self.assertEqual(self.client.post("/api/survey", json=ANSWERS, headers=HEADERS).status_code, code)
        self.supabase.table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
