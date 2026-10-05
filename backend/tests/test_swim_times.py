import unittest

from pydantic import ValidationError

from app.schemas import OnboardingSubmission
from app.swim_times import format_swim_time, swim_time_parts, with_display_times


BASE = {
    "age": 18, "gender": "female", "country": "Canada", "height": "180", "weight": "72", "swim_experience": 8,
    "main_events": ["200m Freestyle"], "pbs_lcm": {"200m Freestyle": "2:03.40"}, "swimmer_type": "mid",
    "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "90", "facilities": ["50m Pool"],
    "coaching_situation": "club", "one_year_goal_times": {"200m Freestyle": "1:59.80"},
}


class SwimTimeTests(unittest.TestCase):
    def test_legacy_text_is_split_into_parts(self):
        self.assertEqual(swim_time_parts("2:03.4"), {"minutes": 2, "seconds": 3, "hundredths": 40})
        self.assertEqual(swim_time_parts("24.05"), {"minutes": 0, "seconds": 24, "hundredths": 5})
        self.assertEqual(swim_time_parts("75.5"), {"minutes": 1, "seconds": 15, "hundredths": 50})
        with self.assertRaises(ValueError):
            swim_time_parts("fast")

    def test_parts_render_as_text_for_downstream_code(self):
        self.assertEqual(format_swim_time({"minutes": 2, "seconds": 3, "hundredths": 40}), "2:03.40")
        self.assertEqual(format_swim_time({"minutes": 0, "seconds": 24, "hundredths": 5}), "24.05")
        self.assertEqual(format_swim_time("1:02.00"), "1:02.00")
        profile = {
            "pbs_lcm": {"200m Freestyle": {"minutes": 2, "seconds": 3, "hundredths": 40}, "50m Freestyle": ""},
            "one_year_goal_times": {"200m Freestyle": {"minutes": 1, "seconds": 59, "hundredths": 80}},
            "full_name": "A",
        }
        display = with_display_times(profile)
        self.assertEqual(display["pbs_lcm"], {"200m Freestyle": "2:03.40"})
        self.assertEqual(display["one_year_goal_times"], {"200m Freestyle": "1:59.80"})
        self.assertIsInstance(profile["pbs_lcm"]["200m Freestyle"], dict)

    def test_onboarding_stores_times_as_parts(self):
        submission = OnboardingSubmission(**{
            **BASE,
            "main_events": ["200m Freestyle", "100m Freestyle"],
            "pbs_lcm": {"200m Freestyle": {"minutes": 2, "seconds": 3, "hundredths": 40}, "100m Freestyle": "58.90"},
            "pbs_scm": {"200m Freestyle": "", "100m Freestyle": "59.10"},
            "one_year_goal_times": {"200m Freestyle": {"minutes": 1, "seconds": 59, "hundredths": 80}, "100m Freestyle": "56.00"},
        })
        record = submission.to_storage_record()
        self.assertEqual(record["pbs_lcm"]["200m Freestyle"], {"minutes": 2, "seconds": 3, "hundredths": 40})
        self.assertEqual(record["pbs_scm"], {"100m Freestyle": {"minutes": 0, "seconds": 59, "hundredths": 10}})
        self.assertEqual((record["height"], record["weight"]), (180, 72))
        self.assertIsInstance(record["height"], int)

    def test_out_of_range_parts_are_rejected(self):
        for bad in (
            {"minutes": 1, "seconds": 60, "hundredths": 0},
            {"minutes": 1, "seconds": 5, "hundredths": 100},
            {"minutes": 0, "seconds": 0, "hundredths": 0},
        ):
            with self.subTest(bad=bad), self.assertRaises(ValidationError):
                OnboardingSubmission(**{**BASE, "pbs_lcm": {"200m Freestyle": bad}})


if __name__ == "__main__":
    unittest.main()
