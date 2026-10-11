"""The coach programs encoded in code, checked against facts read from the coach PDFs."""
from datetime import date
import pathlib
import re
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

    def test_the_week_follows_the_coachs_own_weekly_order(self):
        week = assign_week("Coach Robert", self.MONDAY, 6)
        self.assertEqual(len(week), 6)
        self.assertTrue(all(item.coach.key == "robert" for item in week))
        self.assertEqual([item.session.type for item in week], swim_order(PROGRAMS["robert"], 6))

    def test_unknown_coach_or_no_swims_plans_nothing(self):
        self.assertEqual(assign_week("Coach Nobody", self.MONDAY, 5), [])
        self.assertEqual(assign_week("Coach Robert", self.MONDAY, 0), [])

    def test_sessions_rotate_week_to_week(self):
        this = [item.label for item in assign_week("Coach Robert", self.MONDAY, 5)]
        later = [item.label for item in assign_week("Coach Robert", date(2026, 10, 12), 5)]
        self.assertNotEqual(this, later)

    def test_taper_weeks_use_the_written_taper_sessions(self):
        meets = [{"date": "2026-10-16", "priority": "A", "name": "Nationals"}, {"date": "2026-10-07", "priority": "C"}]
        self.assertEqual(taper_meet(meets, self.MONDAY)["name"], "Nationals")
        self.assertTrue(all(item.taper for item in assign_week("Coach Brad", self.MONDAY, 4, taper=True)))
        self.assertFalse(any(item.taper for item in assign_week("Coach Pete", self.MONDAY, 4, taper=True)))   # Pete wrote no taper sessions

    def test_timothy_gym_days_are_not_swims(self):
        week = assign_week("Coach Timothy", self.MONDAY, 6)
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
    """build_week end to end with the AI and database stubbed: every swim is written from a coach's real session, long
    ones in parts that cover every line once, and a swim whose parts don't add up is written whole."""

    monday = date(2030, 1, 7)
    profile = {"id": "p", "main_events": ["200m IM", "400m IM"], "swimmer_type": "specialist", "swim_sessions_per_week": 5,
               "gym_sessions_per_week": 0, "session_duration": "120", "facilities": ["50m Pool"],
               "recommended_coaches": ["Coach Robert"]}

    def run_week(self, part_meters=None, meets=None):
        """Generates the week; part_meters(check) picks the metres a part is written in (default: what its check wants);
        meets: {day index: competition} entered by the athlete."""
        from datetime import timedelta
        from unittest.mock import MagicMock
        from app import training
        from app.today import MobilityWork

        empty_week = {"generated": False, "days": [{"date": (self.monday + timedelta(days=i)).isoformat(), "workouts": [], "strength": None,
                                                    "mobility": [], "competitions": [meets[i]] if meets and i in meets else [],
                                                    "objective": "", "recovery": []} for i in range(7)]}
        calls = []

        def sets_of(meters):
            return [training.PlannedSet(name="Main-Set: kick", rounds=1, repetitions=min(100, (meters - done) // 25), distance_meters=25, stroke="Free",
                            interval="@0:30", target_time=None, training_zone="Aerobic", equipment=["Fins"], description="d", technical_focus=["c"])
                    for done in range(0, meters, 2500)]

        def fake_generate(_profile, schema, objective, check=None, attempts=3, grounding=None, **_options):
            calls.append((schema, objective))
            if schema is training.WeekNote:
                return training.WeekNote(phase="Build", coaching_note="n"), []
            if schema is training.DayPlan:
                return training.DayPlan(objective="o", recovery=["sleep"], mobility=[
                    MobilityWork(category="Shoulder mobility", exercise="e", duration_minutes=5, instructions=["i"])]), []
            if schema is training.SwimHeader:
                return training.SwimHeader(objective="o", notes="", event="200m IM"), []
            if schema is training.SwimPart:
                meters = part_meters(check) if part_meters else next(
                    m for m in range(25, 40000, 25) if not check(training.SwimPart(estimated_minutes=10, sets=sets_of(m))))
                return training.SwimPart(estimated_minutes=10, sets=sets_of(meters)), []
            return training.PlannedSwim.model_validate(AdaptedSessionCheckTests().swim((1, 1, 800), (1, 20, 100), (1, 1, 400)).model_dump()), []

        database = MagicMock()
        database.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [{"plan": {"phase": "Build"}}]
        with patch.object(training, "week_view", return_value=empty_week), patch.object(training, "competitions", return_value=[]),                 patch.object(training, "get_supabase_client", return_value=database),                 patch.object(training, "build_grounding", return_value=("g", [])),                 patch.object(training, "generate_structured", side_effect=fake_generate),                 patch.object(training, "save_record") as save_record:
            training.build_week(self.profile, self.monday)
        return calls, save_record.call_args.args[5]

    def test_every_swim_is_written_from_its_coach_session_and_long_ones_in_parts(self):
        from app import training
        from app.coach_programs import session_lines
        from app.swim_planner import session_parts

        calls, saved = self.run_week()
        expected = assign_week("Coach Robert", self.monday, 5)
        self.assertEqual(saved["source_files"], [assignment.label for assignment in expected])
        swims = [swim for day in saved["plan"]["days"] for swim in day["swims"]]
        self.assertEqual(len(swims), 5)
        self.assertEqual(sum(schema is training.DayPlan for schema, _ in calls), 7)
        self.assertEqual(sum(schema is training.WeekNote for schema, _ in calls), 1)
        for assignment in expected:
            prompts = [(schema, prompt) for schema, prompt in calls if assignment.render() in prompt
                       and schema in (training.PlannedSwim, training.SwimHeader, training.SwimPart)]
            parts = session_parts(assignment.session, training.PART_SIZE)
            if len(parts) == 1:
                self.assertEqual([schema for schema, _ in prompts], [training.PlannedSwim], assignment.label)
                continue
            # A header and one prompt per part; together the parts list every line of the session once, in order.
            self.assertEqual(sorted(schema.__name__ for schema, _ in prompts), ["SwimHeader"] + ["SwimPart"] * len(parts), assignment.label)
            listed = [re.sub(r" -> (?:keep|cut)\b.*$| \(not a set: .*\)$", "", line.split("] ", 1)[1]) for _, prompt in sorted((p for p in prompts if p[0] is training.SwimPart),
                                                                    key=lambda item: item[1].split("Write part ")[1][:3])
                      for line in prompt.splitlines() if line.startswith("- [")]
            self.assertEqual(listed, [line.text for line in session_lines(assignment.session) if not line.header], assignment.label)
        # The title comes from the coach session, the words from the header, the sets from the parts.
        long_swim = next(swim for swim in swims if swim["objective"] == "o")
        self.assertRegex(long_swim["title"], r"#\d \(Coach Robert\)$")
        self.assertEqual(long_swim["event"], "200m IM")
        self.assertEqual(long_swim["equipment"], ["Fins"])

    def test_a_swim_whose_parts_dont_add_up_is_written_whole(self):
        from app import training
        from app.swim_planner import session_parts

        calls, saved = self.run_week(part_meters=lambda check: 25)       # every part far too short
        long_sessions = [a for a in assign_week("Coach Robert", self.monday, 5) if len(session_parts(a.session, training.PART_SIZE)) > 1]
        self.assertTrue(long_sessions)
        for assignment in long_sessions:
            self.assertEqual(sum(schema is training.PlannedSwim and assignment.render() in prompt for schema, prompt in calls), 1)
        self.assertEqual(len([swim for day in saved["plan"]["days"] for swim in day["swims"]]), 5)

    def test_race_day_has_no_coach_session_and_is_not_a_rest_day(self):
        from app import training

        meet = {"name": "State Champs", "date": "2030-01-12", "priority": "C"}
        calls, saved = self.run_week(meets={5: meet})                   # Saturday
        saturday = next(day for day in saved["plan"]["days"] if day["date"] == "2030-01-12")
        self.assertEqual(saturday["swims"], [])
        self.assertFalse(saturday["rest"])
        day_prompts = [prompt for schema, prompt in calls if schema is training.DayPlan and "Plan 2030-01-12" in prompt]
        self.assertIn("race day (State Champs): the athlete races", day_prompts[0])
        self.assertLessEqual(len([swim for day in saved["plan"]["days"] for swim in day["swims"]]), 5)


if __name__ == "__main__":
    unittest.main()
