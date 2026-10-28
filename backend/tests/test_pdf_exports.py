"""The PDF exports (week, swim, mobility, gym workout, strength session, paces) in SwimGPT's brand (app/pdf_brand.py): the
app's logo and icons drawn from the same shapes as the app's, its typeface embedded, and text the typeface can't draw left
out rather than printed as boxes. Without the typeface's files every export still prints, in Helvetica."""
import copy
from datetime import date, timedelta
import json
from pathlib import Path
import subprocess
import sys
import unittest

from app import pdf_brand
from app.pace_calculator import CalculateRequest, calculate
from app.pace_pdf import render_pace_pdf
from app.week_pdf import render_gym_week_pdf, render_mobility_pdf, render_swim_pdf, render_training_week_pdf, strength_sections
from app.workout_pdf import prepared_for, render_workout_pdf

BACKEND = Path(__file__).resolve().parents[1]

SWIM_SET = {"name": "Main set", "training_zone": "Threshold", "rounds": 2, "repetitions": 4, "distance_meters": 100, "stroke": "Freestyle",
            "interval": "1:40", "target_time": "1:20", "description": "Hold the pace through every repeat.", "equipment": ["Pull buoy"],
            "technical_focus": ["Long catch"]}
SWIM_ITEM = {
    "key": "swim-1", "date": "2026-10-27", "distance_meters": 1000, "zones": {"Threshold": 800, "Recovery": 200}, "completed": False, "origin": "AI",
    "pool_length": 50, "event": "100m Freestyle", "phase": "Base", "workout": {
        "title": "Threshold builder", "objective": "Build threshold speed.", "estimated_duration_minutes": 55, "main_training_zones": ["Threshold"],
        "equipment": ["Pull buoy"], "notes": "Breathe normally throughout.",
        "sets": [SWIM_SET, {**SWIM_SET, "name": "Warm-down", "training_zone": "Recovery", "rounds": 1, "repetitions": 1, "distance_meters": 200,
                            "interval": "As needed", "target_time": "", "equipment": [], "technical_focus": []}]}}
MOBILITY = [{"exercise": "Shoulder circles", "category": "Shoulders", "duration_minutes": 3, "instructions": ["Circle slowly.", "Breathe."]},
            {"exercise": "Thoracic rotations", "category": "Spine", "duration_minutes": 4, "instructions": ["Rotate gently."]}]
STRENGTH = {"title": "Upper-body pull strength", "objective": "Pulling strength for the catch.", "estimated_duration_minutes": 40,
            "exercises": [{"exercise": "Pull-up", "sets": 4, "repetitions": "6", "load": "Bodyweight", "rest_seconds": 90, "tempo": "2-1-1",
                           "demonstration": ["Hang with straight arms", "Pull your chest to the bar"]}]}
DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONDAY = date(2026, 10, 26)


def day(index, **parts):
    return {"date": (MONDAY + timedelta(days=index)).isoformat(), "day_name": DAY_NAMES[index], "objective": "Plan for the day.", "workouts": [], "strength": None,
            "strength_completed": False, "mobility": [], "mobility_completed": False, "recovery": [], "competitions": [], "rest": False, **parts}


WEEK = {
    "week_start": "2026-10-26", "phase": "Sprint race-pace build", "generated": True, "coaching_note": "Quality over quantity this week.",
    "summary": {"swim_volume_meters": 2000, "swim_sessions": 2, "duration_minutes": 150, "mobility_sessions": 2},
    "zones": [{"zone": "Threshold", "meters": 1600, "percentage": 80}, {"zone": "Recovery", "meters": 400, "percentage": 20}],
    "composition": [{"label": "Pull", "meters": 400}],
    "days": [
        day(0, workouts=[{**SWIM_ITEM, "date": "2026-10-26", "completed": True}], mobility=MOBILITY, mobility_completed=True, recovery=["Sleep well."]),
        day(1, workouts=[SWIM_ITEM, {**SWIM_ITEM, "key": "swim-2", "origin": "My workout"}], strength=STRENGTH),
        day(2, competitions=[{"id": "meet", "name": "County championships", "location": "City pool", "pool_length": 50, "priority": "A",
                              "events": ["100m Freestyle"]}]),
        day(3, rest=True, recovery=["Light walk."]),
        day(4, objective="Not planned"),
        day(5, mobility=MOBILITY),
        day(6),
    ],
}
GYM_ITEM = {
    "key": "gym-1", "date": "2026-10-26", "dose": "Full", "focus": "Lower-body power (squats)", "completed": False, "source": "ai",
    "workout": {"title": "Power and strength", "objective": "Explosive legs.", "estimated_duration_minutes": 50, "rationale": "Power for starts.",
                "coaching_notes": "Stop a set if jump height drops.", "intensity": "Full",
                "meta": {"start_time": "07:00", "end_time": "07:50", "label": "Morning", "location": "Home gym"},
                "sections": [{"id": "warm", "title": "Warm-up", "kind": "warmup", "notes": "Jog lightly.\nSkip.", "exercises": []},
                             {"id": "main", "title": "Main", "kind": "main", "notes": "",
                              "exercises": [{"name": "Jump squat", "sets": 4, "reps": "5", "load": "Bodyweight", "rest_seconds": 90, "tempo": "Explode",
                                             "notes": "Land softly."}]}]}}
GYM_WEEK = {
    "week_start": "2026-10-26", "equipment": "Bodyweight and bands",
    "summary": {"sessions": 3, "completed": 1, "minutes": 150, "exercises": 3},
    "days": [{"date": (MONDAY + timedelta(days=index)).isoformat(), "day_name": name,
              "workouts": [{**GYM_ITEM, "key": f"gym-{index}", "completed": index == 0, "source": ["ai", "coach", "manual"][index % 3],
                            "focus": "From your coach" if index == 1 else GYM_ITEM["focus"]}] if index < 3 else []}
             for index, name in enumerate(DAY_NAMES)],
}


def pages(pdf: bytes) -> int:
    return pdf.count(b"/Type /Page") - pdf.count(b"/Type /Pages")


class BrandTests(unittest.TestCase):
    def test_the_logo_is_the_apps_waves_icon(self):
        # Lucide's Waves: three strokes from x 2 to x 22, at heights 6, 12 and 18 of its 24.
        for data, height in zip(pdf_brand.ICONS["waves"], (6, 12, 18)):
            segments = pdf_brand.path_segments(data)
            self.assertEqual(segments[0], ("M", 2.0, float(height)))
            self.assertAlmostEqual(segments[-1][-2], 22.0)
            self.assertAlmostEqual(segments[-1][-1], float(height))

    def test_every_icon_is_drawn_from_its_paths_arcs_included(self):
        for name, paths in pdf_brand.ICONS.items():
            for data in paths:
                self.assertTrue(pdf_brand.path_segments(data), name)
        # The moon's two arcs: the first ends at (21, 12), the second back at its start (12, 3).
        moon = pdf_brand.path_segments(pdf_brand.ICONS["moon"][0])
        ends = [(round(segment[-2], 6), round(segment[-1], 6)) for segment in moon if segment[0] == "C"]
        self.assertIn((21.0, 12.0), ends)
        self.assertEqual(ends[-1], (12.0, 3.0))

    def test_malformed_path_data_is_refused_rather_than_looping(self):
        with self.assertRaises(ValueError):
            pdf_brand.path_segments("M2 2Z 4 4")

    def test_the_colours_are_the_apps_theme(self):
        self.assertEqual(pdf_brand.ACCENT.hexval(), "0x00c0c1")       # oklch(0.72 0.15 195), clipped to sRGB as browsers do
        self.assertEqual(pdf_brand.LOGO_STOPS[0].hexval(), pdf_brand.ACCENT.hexval())
        self.assertEqual(pdf_brand.LOGO_STOPS[-1].hexval(), pdf_brand.PRIMARY.hexval())
        self.assertGreater(min(pdf_brand.FOREGROUND.red, pdf_brand.FOREGROUND.green, pdf_brand.FOREGROUND.blue), 0.95)

    def test_the_apps_typeface_is_used(self):
        self.assertTrue(pdf_brand.BRANDED)
        self.assertEqual(pdf_brand.REGULAR, "Geist")

    def test_text_the_typeface_cant_draw_is_left_out_by_the_word(self):
        self.assertEqual(pdf_brand.printable("Plain text · 4 × 50 m – done…"), "Plain text · 4 × 50 m – done…")
        self.assertEqual(pdf_brand.printable("Şawış Zoë Ελλάδα Smith مرزوق"), "Şawış Zoë Smith")
        self.assertEqual(pdf_brand.printable("Пример"), "Пример")

    def test_a_name_is_printed_whole_or_not_at_all(self):
        self.assertEqual(prepared_for("Şawış Łukasz"), "Prepared for Şawış Łukasz")
        self.assertIsNone(prepared_for("مرزوق"))
        self.assertIsNone(prepared_for("Ελλάδα Smith"))
        self.assertIsNone(prepared_for("  "))


# The week's title in the PDF's metadata ("26 Oct – 1 Nov 2026", the dash in PDFDocEncoding).
WEEK_TITLE = b"/Title (26 Oct \\205 1 Nov 2026)"


class ExportTests(unittest.TestCase):
    def assertBranded(self, pdf: bytes, title: bytes):
        self.assertTrue(pdf.startswith(b"%PDF") and pdf.rstrip().endswith(b"%%EOF"), "not a whole PDF")
        self.assertTrue(b"Geist" in pdf, "Geist isn't embedded")
        self.assertTrue(b"/Author (SwimGPT)" in pdf, "SwimGPT isn't its author")
        self.assertTrue(title in pdf, f"{title!r} isn't in it")

    def test_a_swim_week_with_every_kind_of_day(self):
        pdf = render_training_week_pdf(WEEK, "Ana Lima")
        self.assertBranded(pdf, WEEK_TITLE)
        self.assertGreaterEqual(pages(pdf), 2)

    def test_a_week_not_generated_and_empty(self):
        week = {**WEEK, "generated": False, "phase": "", "coaching_note": "", "zones": [], "composition": [],
                "summary": {"swim_volume_meters": 0, "swim_sessions": 0, "duration_minutes": 0, "mobility_sessions": 0},
                "days": [day(index) for index in range(7)]}
        self.assertBranded(render_training_week_pdf(week, None), WEEK_TITLE)

    def test_a_gym_week(self):
        pdf = render_gym_week_pdf(GYM_WEEK, "Ana Lima", lambda workout: workout["sections"])
        self.assertBranded(pdf, WEEK_TITLE)

    def test_a_gym_workout_with_no_exercises_yet(self):
        empty = copy.deepcopy(GYM_WEEK)
        empty["days"][0]["workouts"][0]["workout"]["sections"] = []
        self.assertBranded(render_gym_week_pdf(empty, None, lambda workout: workout["sections"]), WEEK_TITLE)

    def test_a_swim(self):
        self.assertBranded(render_swim_pdf(SWIM_ITEM, "Ana Lima"), b"Threshold builder")

    def test_an_unscheduled_swim_with_a_long_title(self):
        title = "Threshold ladder with descending 100s, broken 200s at race pace and a long easy recovery swim to finish"
        item = {**SWIM_ITEM, "date": None, "pool_length": None, "zones": {}, "event": None, "workout": {**SWIM_ITEM["workout"], "title": title}}
        self.assertBranded(render_swim_pdf(item, "مرزوق"), b"Threshold ladder")

    def test_a_days_mobility(self):
        self.assertBranded(render_mobility_pdf(MONDAY, MOBILITY, True, None),
                           b"Monday mobility")

    def test_a_gym_workout(self):
        self.assertBranded(render_workout_pdf(GYM_ITEM, GYM_ITEM["workout"]["sections"]), b"Power and strength")

    def test_a_swim_weeks_strength_session(self):
        item = {"date": "2026-10-27", "dose": None, "source": "ai", "workout": {**STRENGTH, "intensity": None, "rationale": None, "coaching_notes": None}}
        pdf = render_workout_pdf(item, strength_sections(STRENGTH), kicker="Strength session  ·  Swim Week",
                                 pills=[("1 exercises", "violet"), ("40 min", "glass")], last_stat=("Week phase", "Sprint race-pace build"))
        self.assertBranded(pdf, b"Upper-body pull strength")

    def test_paces(self):
        result = calculate(CalculateRequest.model_validate({"athlete": {"name": "Ana Lima", "course": "SCM", "pbs": {"SCM:Freestyle": [
            {"distance": 100, "time": "58.00"}, {"distance": 200, "time": "2:06.00"}, {"distance": 400, "time": "4:30.00"}]}}}))
        self.assertBranded(render_pace_pdf(result, "Coach Kim"), b"Ana Lima")


class FallbackTests(unittest.TestCase):
    def test_without_the_typeface_every_export_prints_in_helvetica(self):
        # pdf_brand loaded afresh, its fonts' folder pointed somewhere empty, in a process of its own.
        script = f"""
import importlib.util, json, sys, types
spec = importlib.util.find_spec("app.pdf_brand")
source = open(spec.origin, encoding="utf-8").read().replace('os.path.dirname(__file__), "fonts"', 'os.path.dirname(__file__), "no-fonts-here"')
module = types.ModuleType("app.pdf_brand")
module.__file__ = spec.origin
sys.modules["app.pdf_brand"] = module
exec(compile(source, spec.origin, "exec"), module.__dict__)
from app.week_pdf import render_swim_pdf, render_training_week_pdf
item, week = json.loads({json.dumps(json.dumps(SWIM_ITEM))}), json.loads({json.dumps(json.dumps(WEEK))})
pdfs = [render_swim_pdf(item, "Şawış"), render_training_week_pdf(week, "Ana Lima")]
print("branded" if module.BRANDED else "fallback", all(pdf.startswith(b"%PDF") and b"Geist" not in pdf and b"Helvetica" in pdf for pdf in pdfs))
"""
        result = subprocess.run([sys.executable, "-c", script], cwd=BACKEND, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.stdout.split(), ["fallback", "True"], result.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
