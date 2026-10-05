"""The coach programs encoded in code, checked against facts read from the coach PDFs."""
from datetime import date
import pathlib
import unittest
from unittest.mock import patch

from app.coach_catalog import COACHES
from app.coach_programs import PROGRAMS, TOTAL_ERRATA, estimated_volume, session_volume, swim_order
from app.context import chat_context
from app.swim_planner import assign_week, main_strokes, taper_meet
from app.today import SwimSession, SwimSet
from app.training import template_swim_issues, template_volume_band

# Session counts per type, counted from each PDF (plan / taper).
PDF_COUNTS = {
    "brad": ({"Power": 3, "50 Race Pace": 3, "100 Race Pace": 3, "Aerobic/Recovery": 2, "Resistance": 2},
             {"Power": 2, "50 Race Pace": 2, "100 Race Pace": 3, "Aerobic/Recovery": 2, "Resistance": 2}),
    "pete": ({"Overspeed": 2, "50 Pace": 2, "100 Pace": 2, "200 Pace": 1}, {}),
    "timothy": ({"Top End Speed": 1, "Gym": 1, "Assisted Speed": 1, "Hybrid Gym and Swim": 1, "Speed Work": 1}, {}),
    "robert": ({"Power": 2, "Active Rest": 2, "Threshold": 4, "Threshold/Aerobic": 3, "VO2MAX": 5, "Kick": 2},
               {"Power": 1, "Active Rest": 1, "Threshold": 1, "Threshold/Aerobic": 1, "VO2MAX": 3, "Kick": 1}),
    "tony": ({"Low Level Aerobic": 3, "Threshold": 3, "Lactate/Race-Pace": 3, "Active Rest": 2, "Recovery": 2, "IM": 3},
             {"Low Level Aerobic": 3, "Threshold": 2, "Lactate/Race-Pace": 2, "Active Rest": 2, "Recovery": 2, "IM": 2}),
}


def counts(sessions):
    result = {}
    for session in sessions:
        result[session.type] = result.get(session.type, 0) + 1
    return result


def lines_of(coach, kind, type_, number):
    session = next(item for item in (PROGRAMS[coach].sessions if kind == "plan" else PROGRAMS[coach].taper)
                   if item.type == type_ and item.number == number)
    return [line for section in session.sections for line in section.lines]


class EncodingTests(unittest.TestCase):
    def test_every_session_in_every_pdf_is_encoded(self):
        for coach, (plan, taper) in PDF_COUNTS.items():
            with self.subTest(coach=coach):
                self.assertEqual(counts(PROGRAMS[coach].sessions), plan)
                self.assertEqual(counts(PROGRAMS[coach].taper), taper)
                numbers = {}
                for session in (*PROGRAMS[coach].sessions, *PROGRAMS[coach].taper):
                    numbers.setdefault((session.type, session in PROGRAMS[coach].taper), []).append(session.number)
                for found in numbers.values():
                    self.assertEqual(sorted(found), list(range(1, len(found) + 1)))

    def test_weekly_orders_are_as_written(self):
        self.assertEqual(PROGRAMS["robert"].weekly_orders[4], ("Threshold", "Active Rest", "Power", "VO2MAX"))
        self.assertEqual(PROGRAMS["tony"].weekly_orders[6], ("Low Level Aerobic", "Threshold", "Recovery", "IM", "Active Rest", "Lactate/Race-Pace"))
        self.assertEqual(PROGRAMS["pete"].weekly_orders[5], ("Overspeed", "50 Pace", "100 Pace", "Overspeed", "200 Pace"))
        self.assertEqual(PROGRAMS["brad"].weekly_orders[9][-2:], ("50 Race Pace", "Resistance"))
        self.assertEqual(PROGRAMS["timothy"].cycle, ("Top End Speed", "Gym", "Assisted Speed", "Hybrid Gym and Swim", "Speed Work", "Gym"))
        for program in PROGRAMS.values():
            for order in program.weekly_orders.values():
                for kind in order:
                    self.assertTrue(program.sessions_of(kind), f"{program.key}: {kind}")

    def test_prescriptions_are_verbatim(self):
        self.assertIn("50 MS BES Push (2nd 50 of 100)", lines_of("brad", "plan", "100 Race Pace", 2))
        self.assertIn("12x12.5 MS #1 from a push @0:40", lines_of("pete", "plan", "50 Pace", 1))
        self.assertIn("(30 sec extra break pulse check: HR 25-27)", lines_of("robert", "plan", "Threshold", 2))
        self.assertIn("400 Free neg. split @6:00", lines_of("tony", "plan", "Lactate/Race-Pace", 1))
        self.assertIn("10x50 MS MAX EFFORT: 4x @1:30; 1x @1:20; 1x @1:10; 1x @1:00; 1x @0:50; 1x @0:40; 1x @0:30",
                      lines_of("robert", "taper", "VO2MAX", 2))
        self.assertIn("4x25 Assisted w/Stretch cord (getting pulled if possible)", lines_of("timothy", "plan", "Assisted Speed", 1))
        self.assertTrue(any("failure rule" in rule.lower() for rule in PROGRAMS["pete"].rules))
        self.assertEqual(PROGRAMS["timothy"].effort_levels[0][0], "MAX EFFORT")

    def test_line_by_line_volumes_match_the_coaches_totals(self):
        """Independent check of the transcription: the sets add up to each written 'Total volume' within 10%,
        except three sessions where the coach's own total disagrees with the sets as written."""
        mismatched = set()
        checked = 0
        for program in PROGRAMS.values():
            for kind, sessions in (("plan", program.sessions), ("taper", program.taper)):
                for session in sessions:
                    if session.stated_volume_m:
                        checked += 1
                        if abs(estimated_volume(session) - session.stated_volume_m) > 0.1 * session.stated_volume_m:
                            mismatched.add((program.key, kind, session.type, session.number))
        self.assertEqual(checked, 55)   # Robert 18 + 8, Tony 16 + 13
        self.assertEqual(mismatched, set(TOTAL_ERRATA))
        for (coach, kind, type_, number), metres in TOTAL_ERRATA.items():
            session = next(item for item in (PROGRAMS[coach].sessions if kind == "plan" else PROGRAMS[coach].taper)
                           if item.type == type_ and item.number == number)
            self.assertEqual(session_volume(session), metres)

    def test_catalog_is_derived_from_the_programs(self):
        self.assertEqual(COACHES["pete"]["taper_sessions"], [])
        robert = {item["type"]: item["count"] for item in COACHES["robert"]["sessions"]}
        self.assertEqual(robert, PDF_COUNTS["robert"][0])
        self.assertEqual(COACHES["timothy"]["training_cycle"][0], "Top End Speed")


class NoDocumentReadingTests(unittest.TestCase):
    def test_coach_context_needs_no_database_or_network(self):
        with patch("app.db.get_supabase_client", side_effect=AssertionError("database used")):
            context, sources, names = chat_context(["Coach Brad", "Coach Pete"], "100 race pace")
        self.assertIn("100 Race Pace", context)
        self.assertEqual(names, ["Coach Brad", "Coach Pete"])

    def test_no_backend_module_reads_pdfs(self):
        for path in pathlib.Path(__file__).resolve().parents[1].joinpath("app").glob("*.py"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("pypdf", text, path.name)
            self.assertNotIn("coach_context_chunks", text, path.name)


class SwimPlannerTests(unittest.TestCase):
    MONDAY = date(2026, 10, 5)

    def test_lead_coach_order_with_second_coach_days(self):
        week = assign_week(["Coach Robert", "Coach Tony"], ["200m IM", "400m IM", "800m Freestyle"], self.MONDAY, 6)
        self.assertEqual(len(week), 6)
        self.assertEqual(sum(item.coach.key == "tony" for item in week), 2)   # 800 free is Tony's alone: 1/3 of events
        robert = [item.session.type for item in week if item.coach.key == "robert"]
        self.assertEqual(robert, [kind for index, kind in enumerate(swim_order(PROGRAMS["robert"], 6)) if index not in (1, 4)])

    def test_sessions_rotate_week_to_week(self):
        this = [item.label for item in assign_week(["Coach Robert"], ["200m IM"], self.MONDAY, 5)]
        later = [item.label for item in assign_week(["Coach Robert"], ["200m IM"], date(2026, 10, 12), 5)]
        self.assertNotEqual(this, later)

    def test_taper_weeks_use_the_written_taper_sessions(self):
        meets = [{"date": "2026-10-16", "priority": "A", "name": "Nationals"}, {"date": "2026-10-07", "priority": "C"}]
        self.assertEqual(taper_meet(meets, self.MONDAY)["name"], "Nationals")
        week = assign_week(["Coach Brad", "Coach Pete"], ["50m Freestyle"], self.MONDAY, 4, taper=True)
        self.assertTrue(all(item.taper for item in week if item.coach.key == "brad"))
        self.assertFalse(any(item.taper for item in week if item.coach.key == "pete"))   # Pete wrote no taper sessions

    def test_timothy_gym_days_are_not_swims(self):
        week = assign_week(["Coach Timothy"], ["50m Freestyle"], self.MONDAY, 6)
        self.assertNotIn("Gym", [item.session.type for item in week])

    def test_main_strokes_follow_the_athletes_events(self):
        self.assertEqual(main_strokes(["100m Butterfly", "50m Freestyle"]), ["Butterfly", "Freestyle"])
        self.assertEqual(main_strokes(["400m IM"]), ["Butterfly", "Backstroke", "Breaststroke", "Freestyle"])


class AdaptedSessionCheckTests(unittest.TestCase):
    def swim(self, *sets):
        return SwimSession(title="t", objective="o", estimated_duration_minutes=60, main_training_zones=["Sprint"], equipment=[],
                           sets=[SwimSet(name=f"s{i}", rounds=r, repetitions=n, distance_meters=d, stroke="Free", interval="rest",
                                         target_time=None, training_zone="Sprint", equipment=[], description="d", technical_focus=["c"])
                                 for i, (r, n, d) in enumerate(sets)])

    def test_sprint_sessions_keep_short_distances_and_low_volume(self):
        low, high = template_volume_band(475, (30, 42), 90)          # Timothy Top End Speed
        self.assertLessEqual(high, 525)
        issues = template_swim_issues(self.swim((1, 1, 300), (1, 2, 20), (1, 2, 25), (1, 1, 15)), 90, low, high, [])
        self.assertEqual(issues, [])

    def test_long_sessions_are_fitted_to_the_athletes_time(self):
        low, high = template_volume_band(6400, (36, 50), 60)          # Robert 6400 m in a 60-minute session
        self.assertEqual(high, 3000)
        self.assertTrue(template_swim_issues(self.swim((1, 1, 1000), (1, 40, 100)), 60, low, high, []))


class SwimWeekGenerationTests(unittest.TestCase):
    """build_week end to end with the AI and database stubbed: every swim is written from a coach's real session."""

    def test_each_swim_prompt_carries_the_assigned_coach_session(self):
        from datetime import timedelta
        from unittest.mock import MagicMock
        from app import training
        from app.today import MobilityWork

        monday = date(2030, 1, 7)
        profile = {"id": "p", "main_events": ["200m IM", "400m IM"], "swimmer_type": "specialist", "swim_sessions_per_week": 5,
                   "gym_sessions_per_week": 0, "session_duration": "120", "facilities": ["50m Pool"],
                   "recommended_coaches": ["Coach Robert", "Coach Tony"]}
        empty_week = {"generated": False, "days": [{"date": (monday + timedelta(days=i)).isoformat(), "workouts": [], "strength": None,
                                                    "mobility": [], "competitions": [], "objective": "", "recovery": []} for i in range(7)]}
        prompts = []

        def fake_generate(_profile, schema, objective, check=None, attempts=3, grounding=None):
            prompts.append(objective)
            if schema is training.WeekOutline:
                outline = training.WeekOutline(phase="Build", coaching_note="n", days=[
                    training.OutlineDay(date=monday + timedelta(days=i), objective="o", swim_focuses=[], strength_focus=None,
                                        mobility=[MobilityWork(category="Shoulder mobility", exercise="e", duration_minutes=5, instructions=["i"])],
                                        recovery=["sleep"]) for i in range(7)])
                check(outline)
                return outline, []
            swim = AdaptedSessionCheckTests().swim((1, 1, 800), (1, 20, 100), (1, 1, 400))
            return swim, []

        database = MagicMock()
        database.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"plan": {"phase": "Build"}}]
        with patch.object(training, "week_view", return_value=empty_week), patch.object(training, "competitions", return_value=[]), \
                patch.object(training, "get_supabase_client", return_value=database), \
                patch.object(training, "build_grounding", return_value=("g", [])), \
                patch.object(training, "generate_structured", side_effect=fake_generate), \
                patch.object(training, "save_record") as save_record:
            training.build_week(profile, monday)

        swim_prompts = [prompt for prompt in prompts if "by adapting this exact session" in prompt]
        self.assertEqual(len(swim_prompts), 5)
        expected = assign_week(["Coach Robert", "Coach Tony"], profile["main_events"], monday, 5)
        for prompt, assignment in zip(swim_prompts, expected):
            self.assertIn(assignment.render(), prompt)
        saved = save_record.call_args.args[5]
        self.assertEqual(saved["source_files"], [assignment.label for assignment in expected])


if __name__ == "__main__":
    unittest.main()
