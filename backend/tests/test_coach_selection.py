from itertools import combinations
import unittest

from app.coach_catalog import COACHES
from app.context import athlete_coach, chat_context, coach_options, coach_recommendation, recommended_coach, select_coach
from app.schemas import OnboardingSubmission

# Events and swimmer types exactly as the onboarding form sends them.
ONBOARDING_EVENTS = [
    "50m Freestyle", "100m Freestyle", "200m Freestyle", "400m Freestyle", "800m Freestyle", "1500m Freestyle",
    "50m Backstroke", "100m Backstroke", "200m Backstroke",
    "50m Breaststroke", "100m Breaststroke", "200m Breaststroke",
    "50m Butterfly", "100m Butterfly", "200m Butterfly",
    "200m IM", "400m IM",
]
SWIMMER_TYPES = ["sprinter", "mid", "distance", "specialist"]
WITH_GYM = {"gym_sessions_per_week": 2, "facilities": ["50m Pool", "Full Gym Access"]}
NO_GYM = {"gym_sessions_per_week": 0, "facilities": ["50m Pool", "No Gym Access"]}

# "Main Events for this coach" as written in each coach's plan PDF.
PDF_MAIN_EVENTS = {
    "brad": {"50m Backstroke", "50m Breaststroke", "50m Butterfly", "50m Freestyle",
             "100m Backstroke", "100m Breaststroke", "100m Butterfly", "100m Freestyle"},
    "pete": {"50m Butterfly", "50m Backstroke", "50m Breaststroke", "50m Freestyle",
             "100m Butterfly", "100m Backstroke", "100m Breaststroke", "100m Freestyle"},
    "timothy": {"50m Freestyle", "50m Butterfly", "50m Backstroke", "50m Breaststroke"},
    "robert": {"200m IM", "400m IM", "200m Butterfly", "200m Backstroke", "400m Freestyle", "200m Freestyle", "200m Breaststroke"},
    "tony": {"400m Freestyle", "800m Freestyle", "1500m Freestyle", "400m IM"},
}


def pick(events, swimmer_type, gym=WITH_GYM):
    return select_coach({"main_events": events, "swimmer_type": swimmer_type, **gym})


class CatalogTests(unittest.TestCase):
    def test_catalog_events_match_the_coach_pdfs(self):
        for key, events in PDF_MAIN_EVENTS.items():
            self.assertEqual(set(COACHES[key]["main_events"]), events, key)

    def test_every_onboarding_event_has_a_coach(self):
        covered = set().union(*(coach["main_events"] for coach in COACHES.values()))
        self.assertEqual(covered, set(ONBOARDING_EVENTS))

    def test_coach_names_match_the_programs(self):
        self.assertEqual([coach["name"] for coach in COACHES.values()],
                         ["Coach Brad", "Coach Pete", "Coach Timothy", "Coach Robert", "Coach Tony"])
        self.assertEqual(COACHES["robert"]["source_files"], ["Coach Robert Plan", "Coach Robert Taper Sessions"])


class CoachSelectionTests(unittest.TestCase):
    def test_distance_swimmer(self):
        self.assertEqual(pick(["800m Freestyle", "1500m Freestyle"], "distance"), "Coach Tony")
        self.assertEqual(pick(["400m Freestyle"], "distance"), "Coach Tony")

    def test_im_specialist(self):
        self.assertEqual(pick(["200m IM"], "specialist"), "Coach Robert")
        self.assertEqual(pick(["200m IM", "400m IM"], "specialist"), "Coach Robert")

    def test_mid_distance_swimmer(self):
        self.assertEqual(pick(["200m Freestyle"], "mid"), "Coach Robert")
        self.assertEqual(pick(["200m Freestyle", "400m Freestyle"], "mid"), "Coach Robert")

    def test_50_and_100_sprinter(self):
        self.assertEqual(pick(["50m Freestyle", "100m Freestyle"], "sprinter"), "Coach Brad")

    def test_pure_50_sprinter_gets_timothy_only_with_gym_access(self):
        self.assertEqual(pick(["50m Freestyle"], "sprinter", WITH_GYM), "Coach Timothy")
        self.assertEqual(pick(["50m Freestyle"], "sprinter", NO_GYM), "Coach Brad")
        self.assertEqual(pick(["50m Freestyle"], "sprinter", {"gym_sessions_per_week": 0, "facilities": []}), "Coach Brad")

    def test_200_events_bring_in_petes_200_pace_sessions(self):
        self.assertEqual(pick(["100m Butterfly", "200m Butterfly"], "sprinter"), "Coach Pete")
        self.assertEqual(pick(["100m Freestyle", "200m Freestyle"], "mid"), "Coach Robert")

    def test_events_outweigh_swimmer_type(self):
        # A "sprinter" racing 200s and the 400 still gets the coach who programs those events.
        self.assertEqual(pick(["200m Freestyle", "400m Freestyle"], "sprinter"), "Coach Robert")

    def test_coach_covers_as_many_events_as_possible(self):
        self.assertEqual(pick(["50m Freestyle", "100m Freestyle", "1500m Freestyle"], "sprinter"), "Coach Brad")

    def test_exhaustive_onboarding_combinations(self):
        for size in (1, 2, 3):
            for events in combinations(ONBOARDING_EVENTS, size):
                for swimmer_type in SWIMMER_TYPES:
                    for gym in (WITH_GYM, NO_GYM):
                        profile = {"main_events": list(events), "swimmer_type": swimmer_type, **gym}
                        name = select_coach(profile)
                        key = next(key for key, coach in COACHES.items() if coach["name"] == name)
                        with self.subTest(events=events, swimmer_type=swimmer_type, gym=gym is WITH_GYM):
                            def coverage(coach_key):
                                return len(set(events) & set(COACHES[coach_key]["main_events"]))

                            # The coach programs as many of the athlete's events as any coach can.
                            self.assertEqual(coverage(key), max(coverage(other) for other in COACHES))
                            # Every event is a main event of some coach, so the coach always covers at least one.
                            self.assertGreaterEqual(coverage(key), 1)
                            # Never assign Timothy without gym access when another coach covers as many events.
                            if gym is NO_GYM:
                                self.assertFalse(key == "timothy" and any(
                                    coverage(other) == coverage(key) for other in COACHES if other != "timothy"))


class RecommendationDetailTests(unittest.TestCase):
    def test_recommendation_explains_the_coach(self):
        profile = {"main_events": ["100m Butterfly", "200m Butterfly"], "swimmer_type": "sprinter", "swim_sessions_per_week": 6, **WITH_GYM}
        pete = coach_recommendation(profile, "Coach Pete")
        self.assertEqual(pete["name"], "Coach Pete")
        self.assertEqual(pete["covered_events"], ["100m Butterfly"])
        self.assertEqual(pete["supported_events"], ["200m Butterfly"])
        self.assertIn("Your 100m Butterfly is one of Coach Pete's main events.", pete["reasons"])
        self.assertIn("Adds 200 Pace USRPT sessions for your 200m Butterfly.", pete["reasons"])
        self.assertIn("Specialises in sprinter swimmers.", pete["reasons"])
        self.assertEqual(pete["your_week"], {"requested": 6, "sessions_per_week": 6,
                                             "order": ["Overspeed", "50 Pace", "100 Pace", "200 Pace", "Overspeed", "50 Pace"]})
        self.assertIn("principles", pete)
        self.assertEqual(pete["source_files"], ["Coach Pete Plan"])   # Pete's program has no taper sessions
        self.assertEqual(pete["taper_sessions"], [])

    def test_coach_without_the_athletes_events_says_so(self):
        robert = coach_recommendation({"main_events": ["50m Freestyle"], "swimmer_type": "sprinter", **WITH_GYM}, "Coach Robert")
        self.assertIn("Built for 200m IM, 400m IM and 200m Butterfly rather than your events.", robert["reasons"])

    def test_unknown_coach_is_rejected(self):
        with self.assertRaises(ValueError):
            coach_recommendation({}, "Coach Nobody")

    def test_weekly_template_is_clamped_to_what_the_coach_wrote(self):
        profile = {"main_events": ["800m Freestyle"], "swimmer_type": "distance", "swim_sessions_per_week": 12}
        self.assertEqual(coach_recommendation(profile, "Coach Tony")["your_week"]["sessions_per_week"], 9)
        profile["swim_sessions_per_week"] = 2
        self.assertEqual(coach_recommendation(profile, "Coach Tony")["your_week"]["sessions_per_week"], 4)

    def test_timothy_without_gym_is_flagged(self):
        timothy = coach_recommendation({"main_events": ["50m Freestyle"], "swimmer_type": "sprinter", **NO_GYM}, "Coach Timothy")
        self.assertIn("Includes gym sessions, but you haven't listed gym access, so those days will need adapting.", timothy["reasons"])
        self.assertIsNone(timothy["your_week"])


class CoachContextTests(unittest.TestCase):
    def test_every_selected_coach_is_represented(self):
        context, sources, names = chat_context(["Coach Robert", "Coach Tony"], "threshold sets for my 400 free", limit=8)
        self.assertEqual(names, ["Coach Robert", "Coach Tony"])
        self.assertIn("=== Coach Robert PROGRAM ===", context)
        self.assertIn("=== Coach Tony PROGRAM ===", context)
        self.assertEqual({source["coach_name"] for source in sources}, {"Coach Robert", "Coach Tony"})
        self.assertEqual(len(sources), 8)

    def test_unknown_coaches_are_rejected(self):
        with self.assertRaises(ValueError):
            chat_context(["Coach Nobody"], "anything")



SPRINTER = {"main_events": ["50m Freestyle", "100m Butterfly"], "swimmer_type": "sprinter", "swim_sessions_per_week": 6, **WITH_GYM}


class AthleteChoiceTests(unittest.TestCase):
    def test_the_chosen_coach_is_used(self):
        self.assertEqual(select_coach(SPRINTER, "coach robert"), "Coach Robert")

    def test_choice_saved_on_the_profile_is_used(self):
        self.assertEqual(select_coach({**SPRINTER, "chosen_coach": "tony"}), "Coach Tony")

    def test_no_pick_is_the_recommendation(self):
        self.assertEqual(select_coach(SPRINTER), recommended_coach(SPRINTER))
        self.assertEqual(select_coach({**SPRINTER, "chosen_coach": None}), recommended_coach(SPRINTER))
        self.assertEqual(select_coach(SPRINTER, "Coach Nobody"), recommended_coach(SPRINTER))

    def test_athlete_coach_is_the_saved_head_coach(self):
        self.assertEqual(athlete_coach({**SPRINTER, "recommended_coaches": ["Coach Tony", "Coach Robert"]}), "Coach Tony")
        self.assertEqual(athlete_coach({**SPRINTER, "recommended_coaches": []}), recommended_coach(SPRINTER))

    def test_options_list_every_coach_with_the_recommended_coach_first(self):
        options = coach_options(SPRINTER)
        self.assertEqual({item["key"] for item in options["coaches"]}, set(COACHES))
        self.assertEqual(options["coaches"][0]["name"], options["recommended"])
        self.assertEqual(options["recommended"], recommended_coach(SPRINTER))
        self.assertEqual([item["recommended"] for item in options["coaches"]], [True, False, False, False, False])
        for item in options["coaches"]:
            self.assertTrue(item["reasons"])
            self.assertNotIn("partner", item)

    def test_submission_accepts_one_known_coach(self):
        base = {"age": 19, "gender": "male", "country": "Norway", "weight": 75, "swim_experience": 8,
                "main_events": ["50m Freestyle"], "pbs_lcm": {"50m Freestyle": "0:24.50"}, "swimmer_type": "sprinter",
                "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "90",
                "facilities": ["50m Pool"], "coaching_situation": "solo", "one_year_goal_times": {"50m Freestyle": "0:24.00"}}
        submission = OnboardingSubmission.model_validate({**base, "coach": "Coach Pete"})
        self.assertEqual(submission.coach, "Coach Pete")
        self.assertNotIn("coach", submission.to_storage_record())
        self.assertIsNone(OnboardingSubmission.model_validate(base).coach)
        with self.assertRaises(ValueError):
            OnboardingSubmission.model_validate({**base, "coach": "Coach Nobody"})


if __name__ == "__main__":
    unittest.main()
