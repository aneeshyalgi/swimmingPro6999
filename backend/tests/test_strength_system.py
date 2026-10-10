from datetime import date, timedelta
from itertools import product
import unittest
from unittest.mock import MagicMock, patch

from app.gym import GymWorkout, plan_gym_week
from app.strength_library import DRILLS, EQUIPMENT_BY_FACILITY, FAMILIES
from app.strength_planner import Athlete, context_for, plan_week, training_block
from app.strength_system import COACH_SYSTEMS, MOBILITY_AREAS

MONDAY = date(2026, 10, 5)
WEEK = [MONDAY + timedelta(days=index) for index in range(7)]
COACH_NAMES = {"timothy": "Coach Timothy", "pete": "Coach Pete", "robert": "Coach Robert", "tony": "Coach Tony"}
FACILITIES = ["Full Gym Access", "Basic Gym", "Home Equipment", None]
HEAVY = {variant.name for family in FAMILIES.values() for variant in family.variants if variant.heavy}
ADVANCED = {variant.name for family in FAMILIES.values() for variant in family.variants if variant.level == 3}


def athlete(**overrides) -> Athlete:
    values = dict(age=20, gender="male", weight_kg=75, events=["100m Freestyle"], swimmer_type="sprinter",
                  coach="Coach Timothy", facility="Full Gym Access", gym_sessions=3, swim_sessions=6,
                  years_swimming=4, started=MONDAY)
    values.update(overrides)
    return Athlete(**values)


def strength(sessions):
    return [session for session in sessions if session.kind == "strength"]


def exercise(session, name_part):
    return next(item for item in session.workout["exercises"] if name_part in item["exercise"])


class SystemEncodingTests(unittest.TestCase):
    def test_every_session_has_six_principal_movements(self):
        for coach in COACH_SYSTEMS.values():
            self.assertEqual(sorted(coach.sessions), [1, 2, 3])
            for template in coach.sessions.values():
                with self.subTest(coach=coach.key, session=template.number):
                    self.assertEqual(len(template.main), 6)

    def test_doses_match_the_system(self):
        timothy = [(slot.family, slot.sets, slot.reps) for slot in COACH_SYSTEMS["timothy"].sessions[1].main]
        self.assertEqual(timothy, [("ncm_jump", 5, "3"), ("broad_jump", 4, "3"), ("trap_bar_velocity", 5, "3"),
                                   ("chin_up", 4, "4"), ("pistol", 3, "5/side"), ("ab_wheel", 3, "5–8")])
        microdose = [(slot.family, slot.sets, slot.reps) for slot in COACH_SYSTEMS["pete"].sessions[3].main]
        self.assertEqual(microdose, [("ncm_jump", 3, "2"), ("chin_up", 3, "3"), ("push_up", 2, "5"), ("goblet_squat", 2, "5"),
                                     ("hip_hinge", 2, "5"), ("plank", 2, "20 sec")])
        tony_power = [(slot.family, slot.sets) for slot in COACH_SYSTEMS["tony"].sessions[3].main[:3]]
        self.assertEqual(tony_power, [("ncm_jump", 3), ("broad_jump", 3), ("trap_bar_velocity", 3)])
        self.assertEqual(COACH_SYSTEMS["timothy"].sessions[3].optional.reps, "10 sec MAX")

    def test_every_reference_resolves(self):
        for coach in COACH_SYSTEMS.values():
            for template in coach.sessions.values():
                for slot in (*template.main, *((template.optional,) if template.optional else ())):
                    self.assertIn(slot.family, FAMILIES)
                for dose in (*template.warm_up.mobility, *template.warm_up.activation, *template.finish):
                    self.assertIn(dose.drill, DRILLS)
            for dose in (*coach.mobility.drills, *coach.mobility.then):
                self.assertIn(dose.drill, DRILLS)
        for area in MOBILITY_AREAS.values():
            for drill in (*area.mobilize, *area.control):
                self.assertIn(drill, DRILLS)

    def test_internal_rotation_never_gets_sleeper_stretching(self):
        self.assertEqual(MOBILITY_AREAS["shoulder_internal_rotation"].mobilize, ())
        text = " ".join(" ".join(drill.steps) + drill.name for drill in DRILLS.values()).lower()
        self.assertNotIn("sleeper stretch ", text.replace("sleeper-stretch pressure", ""))


class GeneratedWeekTests(unittest.TestCase):
    def test_every_combination_is_valid_and_uses_only_available_equipment(self):
        for coach, facility, age, completed in product(COACH_NAMES.values(), FACILITIES, (12, 20), (0, 12, 40)):
            subject = athlete(coach=coach, facility=facility, age=age, completed_sessions=completed)
            names = {variant.name: variant for family in FAMILIES.values() for variant in family.variants}
            for session in plan_week(subject, MONDAY, WEEK, MONDAY):
                with self.subTest(coach=coach, facility=facility, age=age, completed=completed, day=session.day):
                    GymWorkout.model_validate(session.workout)
                    for item in session.workout["exercises"]:
                        if item["exercise"] in names:
                            self.assertLessEqual(names[item["exercise"]].needs, EQUIPMENT_BY_FACILITY[facility])
                        if age < 14:
                            self.assertNotIn(item["exercise"], HEAVY)
                        if completed < 30:
                            self.assertNotIn(item["exercise"], ADVANCED)

    def test_weekly_frequency_and_spacing(self):
        sessions = plan_week(athlete(), MONDAY, WEEK, MONDAY)
        self.assertEqual([session.day.weekday() for session in strength(sessions)], [0, 2, 4])
        self.assertEqual(len(sessions), 7)  # the coach's mobility routine fills the other days
        self.assertTrue(all(session.workout["intensity"] == "Minimal" for session in sessions if session.kind == "mobility"))

    def test_signup_mid_week_gets_a_pro_rated_number_of_sessions(self):
        thursday = MONDAY + timedelta(days=3)
        sessions = plan_week(athlete(), MONDAY, WEEK[3:], thursday)
        self.assertEqual(len(strength(sessions)), 2)
        self.assertTrue(all(session.day >= thursday for session in sessions))

    def test_distance_program_keeps_power_with_two_sessions(self):
        sessions = strength(plan_week(athlete(coach="Coach Tony", gym_sessions=2), MONDAY, WEEK, MONDAY))
        self.assertEqual([session.meta["session"] for session in sessions], ["tony-1", "tony-3"])

    def test_tony_skips_rotation_volume_unless_restricted(self):
        def rotation_work(subject):
            sessions = plan_week(subject, MONDAY, WEEK, MONDAY)
            return any("T-spine rotation" in text for session in sessions
                       for text in [*session.workout["warm_up"], *(item["exercise"] for item in session.workout["exercises"])])
        self.assertFalse(rotation_work(athlete(coach="Coach Tony", events=["1500m Freestyle"])))
        self.assertTrue(rotation_work(athlete(coach="Coach Tony", events=["1500m Freestyle"],
                                              assessment={"mobility": {"t_spine_rotation": "restricted"}})))
        self.assertTrue(rotation_work(athlete(coach="Coach Pete")))

    def test_stroke_demands_shape_mobility(self):
        session = strength(plan_week(athlete(coach="Coach Pete", events=["200m Breaststroke"]), MONDAY, WEEK, MONDAY))[0]
        warm_up = " ".join(session.workout["warm_up"])
        self.assertIn("Hip IR/ER", warm_up)
        self.assertIn("Ankle", warm_up)


class PeriodisationTests(unittest.TestCase):
    def meet(self, days_from_monday, priority="A"):
        return [{"date": (MONDAY + timedelta(days=days_from_monday)).isoformat(), "priority": priority, "name": "Nationals"}]

    def test_blocks_are_planned_backward_from_the_meet(self):
        for weeks, block in [(0, "W6"), (1, "W5"), (2, "W3-4"), (3, "W3-4"), (4, "W1-2"), (5, "W1-2")]:
            self.assertEqual(training_block(athlete(competitions=self.meet(weeks * 7 + 5)), MONDAY).key, block)
        self.assertEqual(training_block(athlete(competitions=self.meet(5, "C")), MONDAY).key, "W1-2")

    def test_race_week_is_a_microdose_away_from_the_meet(self):
        sessions = plan_week(athlete(coach="Coach Pete", competitions=self.meet(5)), MONDAY, WEEK, MONDAY)
        hard = strength(sessions)
        self.assertLessEqual(len(hard), 2)
        self.assertTrue(all(session.meta["session"] == "pete-3" for session in hard))
        self.assertTrue(all((MONDAY + timedelta(days=5) - session.day).days > 2 for session in hard))
        self.assertNotIn(MONDAY + timedelta(days=5), [session.day for session in sessions])
        self.assertEqual(exercise(hard[0], "Chin-up")["sets"], 3)  # the microdose is already the taper dose

    def test_competition_block_cuts_volume_but_keeps_power(self):
        normal = strength(plan_week(athlete(), MONDAY, WEEK, MONDAY))[0]
        competition = strength(plan_week(athlete(competitions=self.meet(12)), MONDAY, WEEK, MONDAY))
        session = next(item for item in competition if item.meta["session"] == "timothy-1")
        self.assertEqual(exercise(session, "Non-countermovement")["sets"], exercise(normal, "Non-countermovement")["sets"])
        self.assertLess(exercise(session, "hin-up")["sets"], exercise(normal, "hin-up")["sets"])

    def test_low_readiness_reduces_volume_and_drops_the_finisher(self):
        tired = athlete(gym_sessions=1, readiness=[{"energy": 1, "muscle_soreness": 5, "sleep_quality": 2}])
        fresh = strength(plan_week(athlete(gym_sessions=1), MONDAY, WEEK, MONDAY))[0]
        flat = strength(plan_week(tired, MONDAY, WEEK, MONDAY))[0]
        self.assertTrue(any("Assault bike" in item["exercise"] for item in fresh.workout["exercises"]))
        self.assertFalse(any("Assault bike" in item["exercise"] for item in flat.workout["exercises"]))
        self.assertLess(sum(item["sets"] for item in flat.workout["exercises"]), sum(item["sets"] for item in fresh.workout["exercises"]) - 3)


class PersonalisationTests(unittest.TestCase):
    def test_weakest_bucket_rule_swimmers_a_and_b(self):
        base = strength(plan_week(athlete(gym_sessions=1, completed_sessions=12), MONDAY, WEEK, MONDAY))[0]
        a = strength(plan_week(athlete(gym_sessions=1, completed_sessions=12, assessment={
            "kpi_ratings": {"broad_jump": "excellent", "ncm_jump": "excellent", "weighted_pull_up": "poor"},
            "mobility": {"shoulder_flexion": "restricted"}}), MONDAY, WEEK, MONDAY))[0]
        b = strength(plan_week(athlete(gym_sessions=1, completed_sessions=12, assessment={
            "kpi_ratings": {"weighted_pull_up": "excellent", "broad_jump": "poor", "ncm_jump": "poor"}}), MONDAY, WEEK, MONDAY))[0]
        self.assertGreater(exercise(a, "pull-up")["sets"], exercise(base, "pull-up")["sets"])
        self.assertLess(exercise(a, "broad jump")["sets"], exercise(base, "broad jump")["sets"])
        self.assertIn("extra time on shoulder flexion", " ".join(a.workout["warm_up"]))
        self.assertGreater(exercise(b, "broad jump")["sets"], exercise(base, "broad jump")["sets"])
        self.assertLess(exercise(b, "pull-up")["sets"], exercise(base, "pull-up")["sets"])

    def test_relative_pull_up_kpi_is_scored_against_the_elite_range(self):
        weak = context_for(athlete(weight_kg=80, assessment={"kpis": {"weighted_pull_up_added_kg": 5}}), MONDAY)
        strong = context_for(athlete(weight_kg=80, assessment={"kpis": {"weighted_pull_up_added_kg": 40}}), MONDAY)
        self.assertEqual(weak.buckets["upper_strength"], "build")
        self.assertEqual(strong.buckets["upper_strength"], "minimal")

    def test_hypermobile_warm_up_is_activation_then_control(self):
        session = strength(plan_week(athlete(assessment={"mobility": {
            "shoulder_flexion": "hypermobile", "shoulder_external_rotation": "hypermobile", "hip_rotation": "hypermobile"}}),
            MONDAY, WEEK, MONDAY))[0]
        stages = [line.split(" (")[0].split(":")[0] for line in session.workout["warm_up"]]
        self.assertEqual(stages, ["Temperature", "Activation", "Stability/control"])

    def test_a_poor_fundamental_blocks_progression_however_strong(self):
        session = strength(plan_week(athlete(completed_sessions=40, assessment={"movement": {"chin_up": "poor"}}), MONDAY, WEEK, MONDAY))[0]
        self.assertEqual(exercise(session, "hin-up")["exercise"], "Chin-up")

    def test_level_one_uses_regressions_of_the_advanced_targets(self):
        session = strength(plan_week(athlete(completed_sessions=0, years_swimming=2), MONDAY, WEEK, MONDAY))[0]
        names = [item["exercise"] for item in session.workout["exercises"]]
        self.assertIn("Goblet split squat", names)
        self.assertIn("Chin-up", names)


class DocumentFidelityTests(unittest.TestCase):
    """Rules found missing or mis-encoded in the audit against the source document."""

    def test_tony_session_two_is_a_plain_push_up(self):
        self.assertEqual(COACH_SYSTEMS["tony"].sessions[2].main[3].family, "push_up")

    def test_optional_finisher_never_exceeds_two_to_three_sprints(self):
        meet = [{"date": (MONDAY + timedelta(days=19)).isoformat(), "priority": "A", "name": "Nationals"}]  # max-power block
        session = next(item for item in strength(plan_week(athlete(competitions=meet), MONDAY, WEEK, MONDAY)) if item.meta["session"] == "timothy-3")
        self.assertLessEqual(exercise(session, "Assault bike")["sets"], 3)

    def test_restricted_external_rotation_adds_rotator_cuff_work(self):
        session = strength(plan_week(athlete(assessment={"mobility": {"shoulder_external_rotation": "restricted"}}), MONDAY, WEEK, MONDAY))[0]
        self.assertIn("scap_cuff", session.meta["families"])
        self.assertIn("External-rotation mobility", " ".join(session.workout["warm_up"]))

    def test_every_alphabet_movement_carries_its_quality_check(self):
        session = strength(plan_week(athlete(), MONDAY, WEEK, MONDAY))[0]
        for item in session.workout["exercises"]:
            if "Assault" not in item["exercise"] and "jump" not in item["exercise"].lower():
                self.assertTrue(any(step.startswith("Quality check") for step in item["demonstration"]), item["exercise"])

    def test_t_spine_rotation_priority_is_timothy_pete_robert_tony(self):
        def volume(coach):
            week = plan_week(athlete(coach=coach, events=["100m Freestyle"]), MONDAY, WEEK, MONDAY)
            return sum(1 for session in week for line in [*session.workout["warm_up"], *session.workout["cool_down"],
                       *(item["exercise"] for item in session.workout["exercises"])] if "T-spine rotation" in line)
        counts = [volume(name) for name in ("Coach Timothy", "Coach Pete", "Coach Robert", "Coach Tony")]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertEqual(counts[-1], 0)


class GymWeekSavingTests(unittest.TestCase):
    @patch("app.gym.generate_structured", side_effect=RuntimeError("model unavailable"))
    @patch("app.gym.save_record")
    @patch("app.gym.get_supabase_client")
    @patch("app.gym.strength_athlete", return_value=athlete())
    @patch("app.gym.gym_week")
    def test_week_is_saved_from_the_system_even_when_the_writer_fails(self, gym_week, _athlete, _db, save_record, _writer):
        gym_week.return_value = {"days": [{"date": day.isoformat(), "workouts": []} for day in WEEK]}
        with patch("app.gym.datetime") as clock:
            clock.now.return_value.date.return_value = MONDAY
            with self.assertLogs("app.gym", level="WARNING"):
                plan_gym_week({"id": "profile-a"}, MONDAY)
        self.assertEqual(save_record.call_count, 7)
        details = save_record.call_args_list[0].args[5]
        GymWorkout.model_validate(details["workout"])
        self.assertEqual(details["source_files"], ["SwimGPT Strength & Mobility System"])
        self.assertEqual(details["strength_system"]["coach"], "Coach Timothy")


class CoachWithoutGymProgramTests(unittest.TestCase):
    def test_brads_athletes_follow_swimgpts_system_without_another_coachs_name(self):
        week = plan_week(athlete(coach="Coach Brad"), MONDAY, WEEK, MONDAY)
        session = strength(week)[0]
        self.assertEqual(session.meta["coach"], "Coach Timothy")   # the sprint system, for a sprinter with a gym
        self.assertEqual(session.brief["coach"], "Coach Brad")     # the AI writer speaks as the athlete's own coach
        self.assertTrue(session.workout["rationale"].startswith("Coach Brad has no written gym program"))
        for item in week:
            text = f"{item.workout['rationale']} {item.workout['coaching_notes']}"
            for other in ("Coach Timothy", "Coach Pete", "Coach Robert", "Coach Tony"):
                self.assertNotIn(other, text)


if __name__ == "__main__":
    unittest.main()
