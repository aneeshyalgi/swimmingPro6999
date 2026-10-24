import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app import training, training_days
from app.main import app
from app.strength_planner import Athlete, plan_week
from app.training_days import chosen, describe, even_strength, even_swims

PROFILE = {"id": "row-1", "user_key": "profile-1", "swim_sessions_per_week": 4, "gym_sessions_per_week": 2}
HEADERS = {"Authorization": "Bearer token"}
MON_WED_FRI = {"swim": [1, 0, 2, 0, 1, 0, 0], "gym": [False, True, False, True, False, False, False], "mobility": False}


def saved(details):
    return {"id": training.record_id("row-1", training_days.KEY), "details": details}


class EvenSpreadTests(unittest.TestCase):
    """An athlete who never chose days is shown the week as generating it lays it out."""

    def test_swims_spread_as_a_generated_week_spreads_them(self):
        self.assertEqual(even_swims(4), [1, 1, 0, 1, 0, 1, 0])       # as the week of 23 Nov came out for 4 a week
        self.assertEqual(even_swims(5), [1, 1, 1, 0, 1, 1, 0])
        self.assertEqual(even_swims(10), [2, 1, 2, 1, 2, 1, 1])
        self.assertEqual(even_swims(14), [2] * 7)
        self.assertEqual(even_swims(0), [0] * 7)
        for count in range(15):
            self.assertEqual(sum(even_swims(count)), count)

    def test_strength_days_are_the_gym_planners_own(self):
        monday = __import__("datetime").date(2026, 10, 5)
        week = [monday + __import__("datetime").timedelta(days=index) for index in range(7)]
        for count in range(8):
            athlete = Athlete(coach="Coach Timothy", facility="Full Gym Access", gym_sessions=count, swim_sessions=6, started=monday, age=20)
            planned = {session.day.weekday() for session in plan_week(athlete, monday, week, monday) if session.kind == "strength"}
            self.assertEqual(even_strength(count), [day in planned for day in range(7)], count)


class ChosenDaysTests(unittest.TestCase):
    def read(self, details, profile=PROFILE):
        with patch.object(training, "find_record", return_value=saved(details) if details is not None else None):
            return chosen(profile)

    def test_none_until_the_athlete_chooses(self):
        self.assertIsNone(self.read(None))

    def test_days_that_still_add_up_are_used(self):
        self.assertEqual(self.read(MON_WED_FRI), MON_WED_FRI)

    def test_a_part_that_no_longer_adds_up_is_spread_evenly_again(self):
        # Onboarding changed the numbers since: 5 swims and 2 strength sessions a week now.
        days = self.read(MON_WED_FRI, {**PROFILE, "swim_sessions_per_week": 5})
        self.assertEqual((days["swim"], days["gym"], days["mobility"]), (None, MON_WED_FRI["gym"], False))

    def test_a_record_that_cant_be_read_is_ignored(self):
        with self.assertLogs("app.training_days", level="WARNING"):
            self.assertIsNone(self.read({"swim": [3, 0, 0, 0, 0, 0, 0], "gym": [False] * 7}))

    def test_the_coach_is_told_the_days(self):
        self.assertEqual(describe(MON_WED_FRI), "The athlete's chosen training days: swims on Mon, Wed (two), Fri; strength sessions "
                                                "on Tue, Thu; no mobility routine on the other days.")
        self.assertEqual(describe(None), "")
        self.assertEqual(describe({"swim": None, "gym": [False] * 7, "mobility": True}),
                         "The athlete's chosen training days: no strength sessions; the mobility routine on the other days.")

    def test_a_coachs_prompt_goes_on_without_them_when_they_cant_be_read(self):
        with patch.object(training_days, "chosen", side_effect=APIError({"message": "down"})), \
                self.assertLogs("app.training_days", level="WARNING"):
            self.assertEqual(training_days.coach_line(PROFILE), "")


class TrainingDaysApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.rows: dict[str, dict] = {}
        self.database = MagicMock()
        self.updates = self.database.table.return_value.update
        self.updates.return_value.eq.return_value.execute.return_value.data = [{"id": "row-1"}]
        self.save = MagicMock(side_effect=lambda profile_id, key, kind, name, day, details: self.rows.__setitem__(key, saved(details)))
        for target, options in [
            ("app.training_days.get_authenticated_profile", {"return_value": dict(PROFILE)}),
            ("app.training.find_record", {"side_effect": lambda profile_id, key: self.rows.get(key)}),
            ("app.training.save_record", {"new": self.save}),
            ("app.training.get_supabase_client", {"return_value": self.database}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_an_athlete_who_never_chose_sees_their_weeks_even_spread(self):
        response = self.client.get("/api/training/days", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"swim": [1, 1, 0, 1, 0, 1, 0], "gym": [True, False, False, True, False, False, False],
                                           "mobility": True, "chosen": {"swim": False, "gym": False}, "saved_at": None})
        self.updates.assert_not_called()
        self.save.assert_not_called()

    def test_saving_keeps_the_days_and_sets_the_weekly_numbers_to_match(self):
        response = self.client.put("/api/training/days", headers=HEADERS, json=MON_WED_FRI)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["swim"], body["gym"], body["mobility"], body["chosen"]),
                         (MON_WED_FRI["swim"], MON_WED_FRI["gym"], False, {"swim": True, "gym": True}))
        self.database.table.assert_called_with("user_profiles")
        values = self.updates.call_args.args[0]
        self.assertEqual((values["swim_sessions_per_week"], values["gym_sessions_per_week"]), (4, 2))
        self.updates.return_value.eq.assert_called_with("id", "row-1")
        # One record, with no date: it never counts as training.
        key, kind, name, day, details = self.save.call_args.args[1:]
        self.assertEqual((key, kind, day), ("training-days", "training_days", None))
        self.assertEqual({field: details[field] for field in ("swim", "gym", "mobility")}, MON_WED_FRI)
        self.assertEqual(self.client.get("/api/training/days", headers=HEADERS).json()["swim"], MON_WED_FRI["swim"])

    def test_new_numbers_follow_the_days(self):
        days = {"swim": [2, 2, 2, 2, 2, 0, 0], "gym": [True] * 5 + [False] * 2, "mobility": True}
        self.client.put("/api/training/days", headers=HEADERS, json=days)
        values = self.updates.call_args.args[0]
        self.assertEqual((values["swim_sessions_per_week"], values["gym_sessions_per_week"]), (10, 5))

    def test_days_that_cant_be_kept_put_the_numbers_back(self):
        self.save.side_effect = APIError({"message": "down"})
        response = self.client.put("/api/training/days", headers=HEADERS, json={**MON_WED_FRI, "swim": [1, 1, 1, 1, 1, 1, 1]})
        self.assertEqual(response.status_code, 502)
        first, last = self.updates.call_args_list[0].args[0], self.updates.call_args_list[-1].args[0]
        self.assertEqual(first["swim_sessions_per_week"], 7)
        self.assertEqual(last, {"swim_sessions_per_week": 4, "gym_sessions_per_week": 2})

    def test_numbers_that_arent_saved_keep_the_days_unsaved(self):
        self.updates.return_value.eq.return_value.execute.return_value.data = []
        response = self.client.put("/api/training/days", headers=HEADERS, json=MON_WED_FRI)
        self.assertEqual(response.status_code, 500)
        self.save.assert_not_called()

    def test_numbers_that_cant_be_read_show_an_empty_week(self):
        for broken in ({"swim_sessions_per_week": 20}, {"swim_sessions_per_week": "lots"}, {"swim_sessions_per_week": None}):
            with self.subTest(broken=broken), patch("app.training_days.get_authenticated_profile", return_value={**PROFILE, **broken}):
                body = self.client.get("/api/training/days", headers=HEADERS).json()
                self.assertEqual(body["swim"], [0] * 7)
        with patch("app.training_days.get_authenticated_profile", return_value={**PROFILE, "swim_sessions_per_week": "4"}):
            self.assertEqual(sum(self.client.get("/api/training/days", headers=HEADERS).json()["swim"]), 4)

    def test_mobility_stays_on_when_it_isnt_sent(self):
        response = self.client.put("/api/training/days", headers=HEADERS, json={"swim": MON_WED_FRI["swim"], "gym": MON_WED_FRI["gym"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["mobility"])

    def test_saving_the_same_days_again_changes_nothing_else(self):
        first = self.client.put("/api/training/days", headers=HEADERS, json=MON_WED_FRI).json()
        second = self.client.put("/api/training/days", headers=HEADERS, json=MON_WED_FRI).json()
        self.assertEqual({key: first[key] for key in ("swim", "gym", "mobility", "chosen")}, {key: second[key] for key in ("swim", "gym", "mobility", "chosen")})
        self.assertEqual(len(self.rows), 1)

    def test_only_whole_weeks_of_zero_to_two_swims_a_day_and_at_least_one_swim(self):
        for days in ({**MON_WED_FRI, "swim": [0] * 7}, {**MON_WED_FRI, "swim": [3, 0, 0, 0, 0, 0, 0]},
                     {**MON_WED_FRI, "swim": [1, 1, 1]}, {**MON_WED_FRI, "gym": [True] * 8}, {**MON_WED_FRI, "swim": [-1, 1, 1, 1, 1, 1, 1]}):
            with self.subTest(days=days):
                self.assertEqual(self.client.put("/api/training/days", headers=HEADERS, json=days).status_code, 422)
        self.updates.assert_not_called()
        self.save.assert_not_called()



class SignedOutTests(unittest.TestCase):
    def test_the_days_need_a_signed_in_athlete(self):
        client = TestClient(app)
        self.assertEqual(client.get("/api/training/days").status_code, 401)
        self.assertEqual(client.put("/api/training/days", json=MON_WED_FRI).status_code, 401)


if __name__ == "__main__":
    unittest.main()
