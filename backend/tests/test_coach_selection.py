from itertools import combinations
import unittest

from app.coach_catalog import COACHES
from app.context import chat_context, coach_options, coach_recommendations, select_coaches
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
    return select_coaches({"main_events": events, "swimmer_type": swimmer_type, **gym})[1]


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
        self.assertEqual(pick(["800m Freestyle", "1500m Freestyle"], "distance"), ["Coach Tony", "Coach Robert"])
        self.assertEqual(pick(["400m Freestyle"], "distance"), ["Coach Tony", "Coach Robert"])

    def test_im_specialist(self):
        self.assertEqual(pick(["200m IM"], "specialist"), ["Coach Robert", "Coach Tony"])
        self.assertEqual(pick(["200m IM", "400m IM"], "specialist"), ["Coach Robert", "Coach Tony"])

    def test_mid_distance_swimmer(self):
        self.assertEqual(pick(["200m Freestyle"], "mid"), ["Coach Robert", "Coach Tony"])
        self.assertEqual(pick(["200m Freestyle", "400m Freestyle"], "mid"), ["Coach Robert", "Coach Tony"])

    def test_50_and_100_sprinter_gets_both_full_sprint_programs(self):
        self.assertEqual(pick(["50m Freestyle", "100m Freestyle"], "sprinter"), ["Coach Brad", "Coach Pete"])

    def test_pure_50_sprinter_gets_timothy_only_with_gym_access(self):
        self.assertEqual(pick(["50m Freestyle"], "sprinter", WITH_GYM), ["Coach Timothy", "Coach Brad"])
        self.assertEqual(pick(["50m Freestyle"], "sprinter", NO_GYM), ["Coach Brad", "Coach Pete"])
        self.assertEqual(pick(["50m Freestyle"], "sprinter", {"gym_sessions_per_week": 0, "facilities": []}), ["Coach Brad", "Coach Pete"])

    def test_200_events_bring_in_petes_200_pace_sessions(self):
        self.assertEqual(pick(["100m Butterfly", "200m Butterfly"], "sprinter"), ["Coach Pete", "Coach Robert"])
        self.assertEqual(pick(["100m Freestyle", "200m Freestyle"], "mid"), ["Coach Robert", "Coach Pete"])

    def test_events_outweigh_swimmer_type(self):
        # A "sprinter" racing 200s and the 400 still gets the coaches who program those events.
        self.assertEqual(pick(["200m Freestyle", "400m Freestyle"], "sprinter"), ["Coach Robert", "Coach Tony"])

    def test_pair_covers_as_many_events_as_possible(self):
        self.assertEqual(pick(["50m Freestyle", "100m Freestyle", "1500m Freestyle"], "sprinter"), ["Coach Brad", "Coach Tony"])

    def test_exhaustive_onboarding_combinations(self):
        order = list(COACHES)
        for size in (1, 2, 3):
            for events in combinations(ONBOARDING_EVENTS, size):
                for swimmer_type in SWIMMER_TYPES:
                    for gym in (WITH_GYM, NO_GYM):
                        profile = {"main_events": list(events), "swimmer_type": swimmer_type, **gym}
                        keys, names = select_coaches(profile)
                        with self.subTest(events=events, swimmer_type=swimmer_type, gym=gym is WITH_GYM):
                            self.assertEqual(len(set(keys)), 2)
                            self.assertEqual(names, [COACHES[key]["name"] for key in keys])

                            def coverage(pair):
                                return len(set(events) & set().union(*(COACHES[k]["main_events"] for k in pair)))

                            best_coverage = max(coverage(pair) for pair in combinations(order, 2))
                            self.assertEqual(coverage(keys), best_coverage)
                            # Every event is a main event of some coach, so a pair can always cover at least one.
                            self.assertGreaterEqual(coverage(keys), min(size, 1))
                            # Never assign Timothy without gym access when an equally covering pair avoids him.
                            if gym is NO_GYM and "timothy" in keys:
                                self.assertFalse(any(
                                    coverage(pair) == best_coverage and "timothy" not in pair
                                    and sum(len(set(events) & set(COACHES[k]["main_events"])) for k in pair)
                                    >= sum(len(set(events) & set(COACHES[k]["main_events"])) for k in keys)
                                    for pair in combinations(order, 2)
                                ))
                            lead, second = keys
                            self.assertGreaterEqual(
                                len(set(events) & set(COACHES[lead]["main_events"])),
                                len(set(events) & set(COACHES[second]["main_events"])),
                            )


class RecommendationDetailTests(unittest.TestCase):
    def test_recommendations_explain_each_coach_and_keep_lead_order(self):
        profile = {"main_events": ["100m Butterfly", "200m Butterfly"], "swimmer_type": "sprinter", "swim_sessions_per_week": 6, **WITH_GYM}
        pete, robert = coach_recommendations(profile, ["Coach Pete", "Coach Robert"])
        self.assertEqual((pete["name"], robert["name"]), ("Coach Pete", "Coach Robert"))
        self.assertEqual(pete["covered_events"], ["100m Butterfly"])
        self.assertEqual(pete["supported_events"], ["200m Butterfly"])
        self.assertIn("Your 100m Butterfly is one of Coach Pete's main events.", pete["reasons"])
        self.assertIn("Adds 200 Pace USRPT sessions for your 200m Butterfly.", pete["reasons"])
        self.assertIn("Specialises in sprinter swimmers.", pete["reasons"])
        self.assertEqual(robert["covered_events"], ["200m Butterfly"])
        self.assertEqual(pete["your_week"], {"requested": 6, "sessions_per_week": 6,
                                             "order": ["Overspeed", "50 Pace", "100 Pace", "200 Pace", "Overspeed", "50 Pace"]})
        self.assertIn("principles", pete)
        self.assertEqual(pete["source_files"], ["Coach Pete Plan"])   # Pete's program has no taper sessions
        self.assertEqual(pete["taper_sessions"], [])

    def test_weekly_template_is_clamped_to_what_the_coach_wrote(self):
        profile = {"main_events": ["800m Freestyle"], "swimmer_type": "distance", "swim_sessions_per_week": 12}
        tony = coach_recommendations(profile, ["Coach Tony"])[0]
        self.assertEqual(tony["your_week"]["sessions_per_week"], 9)
        profile["swim_sessions_per_week"] = 2
        self.assertEqual(coach_recommendations(profile, ["Coach Tony"])[0]["your_week"]["sessions_per_week"], 4)

    def test_timothy_without_gym_is_flagged(self):
        timothy = coach_recommendations({"main_events": ["50m Freestyle"], "swimmer_type": "sprinter", **NO_GYM}, ["Coach Timothy"])[0]
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
    def test_two_picks_are_used_as_given_head_coach_first(self):
        self.assertEqual(select_coaches(SPRINTER, ["Coach Tony", "coach robert"])[1], ["Coach Tony", "Coach Robert"])

    def test_one_pick_leads_and_gets_its_best_partner(self):
        keys, names = select_coaches(SPRINTER, ["Coach Robert"])
        self.assertEqual(names[0], "Coach Robert")
        partner = next(item["partner"] for item in coach_options(SPRINTER)["coaches"] if item["key"] == "robert")
        self.assertEqual(names[1], partner)
        self.assertNotEqual(keys[0], keys[1])

    def test_choices_saved_on_the_profile_are_used(self):
        self.assertEqual(select_coaches({**SPRINTER, "chosen_coaches": ["tony"]})[1][0], "Coach Tony")

    def test_no_pick_is_the_recommendation(self):
        self.assertEqual(select_coaches(SPRINTER, [])[1], pick(SPRINTER["main_events"], "sprinter"))
        self.assertEqual(select_coaches({**SPRINTER, "chosen_coaches": []})[1], select_coaches(SPRINTER)[1])

    def test_options_list_every_coach_with_the_recommended_pair_first(self):
        options = coach_options(SPRINTER)
        self.assertEqual({item["key"] for item in options["coaches"]}, set(COACHES))
        self.assertEqual([item["name"] for item in options["coaches"][:2]], options["recommended"])
        self.assertEqual([item["recommended"] for item in options["coaches"]], [1, 2, None, None, None])
        for item in options["coaches"]:
            self.assertTrue(item["reasons"])
            self.assertNotEqual(item["partner"], item["name"])

    def test_submission_accepts_known_distinct_coaches_only(self):
        base = {"age": 19, "gender": "male", "country": "Norway", "weight": 75, "swim_experience": 8,
                "main_events": ["50m Freestyle"], "pbs_lcm": {"50m Freestyle": "0:24.50"}, "swimmer_type": "sprinter",
                "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "90",
                "facilities": ["50m Pool"], "coaching_situation": "solo", "one_year_goal_times": {"50m Freestyle": "0:24.00"}}
        submission = OnboardingSubmission.model_validate({**base, "coaches": ["Coach Pete"]})
        self.assertEqual(submission.coaches, ["Coach Pete"])
        self.assertNotIn("coaches", submission.to_storage_record())
        for bad in (["Coach Nobody"], ["Coach Pete", "coach pete"], ["brad", "pete", "tony"]):
            with self.assertRaises(ValueError):
                OnboardingSubmission.model_validate({**base, "coaches": bad})


if __name__ == "__main__":
    unittest.main()
