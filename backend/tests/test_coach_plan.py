from datetime import date, timedelta
import json
import re
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import coach_plan, gym, main, tokens, training
from app.coach_plan import CoachGym, CoachSwim, PlanOutline, plan_kinds, swim_issues
from app.main import app

LIBRARY = training.library  # the real one, for reading saved records back (the tests below replace it)
HEADERS = {"Authorization": "Bearer token"}
PROFILE = {"id": "row-1", "facilities": ["50m Pool", "Full Gym Access"], "main_events": ["100m Freestyle"],
           "recommended_coaches": ["Coach Brad"]}
TODAY = date(2026, 10, 21)          # a Wednesday
MONDAY = TODAY - timedelta(days=TODAY.weekday())
SWIM_ID = "0b9d8c7a-6e5f-4a3b-8c2d-1e0f9a8b7c6d"
GYM_ID = "1c8e7d6b-5a4f-4b3c-9d2e-0f1a2b3c4d5e"

REPLY = """Here's what I'd do this week.

Monday: Swim
Warm-up: 400 easy choice
Main: 8 x 50 freestyle sprint @1:00
Warm-down: 200 easy

Wednesday: Gym
Goblet squat 3 x 10, RPE 7, 90 s rest
Plank 3 x 45 s

Let me know how it feels."""


def planned_set(name, repetitions, distance, zone="Aerobic", rounds=1, target=None):
    return {"name": name, "rounds": rounds, "repetitions": repetitions, "distance_meters": distance, "stroke": "Freestyle",
            "interval": "@1:00", "target_time": target, "training_zone": zone, "equipment": [], "description": "As written.",
            "technical_focus": ["Long strokes"]}


SWIM = {"title": "Sprint swim", "objective": "Top-end speed.", "event": "100m Freestyle", "notes": "", "estimated_duration_minutes": 40,
        "equipment": [],
        "sets": [planned_set("Warm-Up: Easy", 1, 400, "Recovery"), planned_set("Main Set: Sprints", 8, 50, "Sprint"),
                 planned_set("Warm-Down: Easy", 1, 200, "Recovery")]}
GYM = {"title": "Leg strength", "focus": "strength", "intensity": "Moderate", "objective": "Stronger starts.", "rationale": "",
       "coaching_notes": "Stop if the knee hurts.", "duration_minutes": None,
       "sections": [{"title": "Main Set", "kind": "main", "notes": "", "exercises": [
           {"name": "Goblet squat", "sets": 3, "reps": "10", "load": "RPE 7", "rest_seconds": 90, "tempo": "", "notes": ""},
           {"name": "Plank", "sets": 3, "reps": "45 s", "load": "", "rest_seconds": 60, "tempo": "", "notes": ""}]},
           {"title": "Cool-Down", "kind": "cooldown", "notes": "", "exercises": []}]}
OUTLINE = {"title": "Brad's sprint week", "sessions": [
    {"kind": "swim", "title": "Sprint swim", "day": "Monday", "pieces": [2, 3, 4, 5]},
    {"kind": "gym", "title": "Leg strength", "day": "Wednesday", "pieces": [6, 7, 8]}]}


def swim_workout():
    return coach_plan.as_swim(CoachSwim.model_validate(SWIM), PROFILE["main_events"]).model_dump(mode="json")


def gym_doc():
    return coach_plan.as_doc(CoachGym.model_validate(GYM)).model_dump(mode="json")


CHAT_SWIM = """Here's a sprint swim session for you tomorrow, focusing on your 100m Freestyle:

**Warm-Up:**
- 300 Loosen
- 4x50 scrunch scull w/Fins @1:10
- 4x25 MS descend 1-3/25 easy @1:10

**Main-Set:**
- 2 rounds:
  - 2x15 uw MAX w/socks @1:30
  - 50 easy
- 200 easy to finish."""
SPOKEN_SWIM = ("Let's do a quick power session today. Start with a 300 loosen, then 4x50 scrunch scull with fins. After that, do 15 "
               "MAX freestyle kicks, cruising back to the wall. Finish with 3 rounds of 15 dive MAX efforts. End with a 200 easy with fins.")
SPOKEN_WORDS = "Warm up with three hundred easy, then eight fifties at race pace on a minute fifteen, and finish with two hundred easy."
CHAT_GYM = """Wednesday: Gym
- Warm-up: 5 min bike, band pull-aparts x 15
- Goblet squat 4 x 8 @ RPE 7, 90 s rest
- Pull-ups 3 x 6
- Plank 3 x 45 s"""
ADVICE = ("Aim for 7-9 hours of sleep before a meet to ensure optimal performance and recovery. Your 100m Freestyle and 50m "
          "Freestyle both benefit from it. Keep your 200 free pace steady in training and rest 2 days before.")


class PlanKindsTests(unittest.TestCase):
    """A reply that prescribes sessions is recognised by its sets and exercises, written or said."""

    def test_a_written_swim_is_a_swim(self):
        self.assertEqual(plan_kinds(CHAT_SWIM), "swim")

    def test_a_swim_said_on_a_call_is_a_swim(self):
        self.assertEqual(plan_kinds(SPOKEN_SWIM), "swim")
        self.assertEqual(plan_kinds(SPOKEN_WORDS), "swim")

    def test_a_week_said_on_a_call_is_a_swim_plan(self):
        self.assertEqual(plan_kinds(
            "On Monday, do a threshold session with six one-hundreds freestyle on one twenty, followed by a two-hundred kick. "
            "On Tuesday, hit an active rest session with four rounds of 150 freestyle, descending 1-4. Wednesday, go for a VO2MAX "
            "session with three rounds of two 15s freestyle max speed with paddles."), "swim")
        self.assertTrue(coach_plan.prescribed("swim", "Wednesday, three rounds of two 15s freestyle max speed."))

    def test_a_mobility_routine_with_doses_under_each_exercise_is_a_gym_session(self):
        routine = ("### General Shoulder Mobility Routine (20 minutes)\n\n1. **Arm Circles**  \n   - 2 minutes (1 minute forward, 1 minute "
                   "backward)\n\n2. **Cross-Body Shoulder Stretch**  \n   - 3 sets of 30 seconds each arm\n\n4. **Wall Angels**  \n   - 3 sets "
                   "of 10 repetitions\n\n7. **Child's Pose**  \n   - 2 minutes (hold and breathe deeply)")
        self.assertEqual(plan_kinds(routine), "gym")
        self.assertTrue(coach_plan.prescribed("gym", routine))

    def test_a_gym_session_said_aloud_is_a_gym_session(self):
        self.assertEqual(plan_kinds("Do three sets of ten squats, then three sets of twelve push-ups, and finish with a thirty-second plank."), "gym")

    def test_swim_words_keep_a_clause_a_swims_and_pull_ups_are_not_pulls(self):
        self.assertEqual(plan_kinds("6x50 drill focusing on body rotation\n4x100 pull with buoy @1:30\n200 easy"), "swim")
        self.assertEqual(plan_kinds("Pull-ups 3 x 6\nLat pull-downs 3 x 10\nFace pulls 3 x 15"), "gym")

    def test_only_a_reply_that_holds_one_session_is_copied_early(self):
        self.assertEqual(coach_plan.single_session(CHAT_SWIM), "swim")
        self.assertEqual(coach_plan.single_session(CHAT_GYM), "gym")      # one weekday is one session's day
        self.assertIsNone(coach_plan.single_session(f"Monday: Swim\n{CHAT_SWIM}\nTuesday: Swim\n{CHAT_SWIM}"))
        self.assertIsNone(coach_plan.single_session("Day 1: 4x50 easy, 200 easy\nDay 2: 6x100 pull, 300 easy"))
        self.assertIsNone(coach_plan.single_session(ADVICE))

    def test_a_gym_session_is_a_gym_session(self):
        self.assertEqual(plan_kinds(CHAT_GYM), "gym")

    def test_a_plan_with_both_is_both(self):
        self.assertEqual(plan_kinds(f"Monday: Swim\n{CHAT_SWIM}\n\n{CHAT_GYM}"), "both")

    def test_a_day_named_without_its_training_holds_no_session(self):
        self.assertFalse(coach_plan.prescribed("gym", "On Tuesday, hit the gym for strength training."))
        self.assertFalse(coach_plan.prescribed("swim", "Thursday, an easy swim."))
        self.assertTrue(coach_plan.prescribed("gym", "On Tuesday, do three sets of ten squats and a plank."))
        self.assertTrue(coach_plan.prescribed("swim", "On Monday, do six one-hundreds freestyle on one twenty."))
        self.assertTrue(coach_plan.prescribed("swim", "On Tuesday, four rounds of 150 freestyle, descending 1 to 4."))
        self.assertFalse(coach_plan.prescribed("swim", "Friday, swim easy for 20 minutes."))

    def test_advice_and_a_set_in_passing_are_not_sessions(self):
        self.assertIsNone(plan_kinds(ADVICE))
        self.assertIsNone(plan_kinds("Try 4x50 at race pace once a week to sharpen your speed."))
        self.assertIsNone(plan_kinds("Stretch your hips for 5 min after every swim."))


class CoachChatPlanTests(unittest.TestCase):
    """The chat asks the coach to write sessions out in full and returns which kinds a reply prescribes."""

    def setUp(self):
        self.client = TestClient(app)
        self.openai = MagicMock()
        for name, value in [("get_authenticated_profile", {**PROFILE, "user_key": "key-1"}), ("recent_athlete_feedback", []),
                            ("chat_context", ("PROGRAM", [], ["Coach Brad"])), ("recent_race_results", []), ("pacing_context", {}),
                            ("coach_line", ""),
                            ("settings", SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-4o-mini", openai_voice_model="gpt-4o-mini",
                                                         openai_reasoning_effort="low"))]:
            patcher = patch.object(main, name, **({"return_value": value} if name != "settings" else {"new": value}))
            self.addCleanup(patcher.stop)
            patcher.start()
        for target, name, value in [(main, "OpenAI", self.openai), (tokens, "charge", None)]:
            patcher = patch.object(target, name, return_value=value)
            self.addCleanup(patcher.stop)
            patcher.start()

    def chat(self, reply, mode="chat"):
        self.openai.chat.completions.create.return_value.choices = [SimpleNamespace(message=SimpleNamespace(content=reply))]
        return self.client.post("/api/coach-chat", headers=HEADERS, json={
            "user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "Give me a sprint set", "mode": mode})

    def test_a_reply_with_a_session_says_its_kind_and_is_otherwise_unchanged(self):
        response = self.chat(CHAT_SWIM)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.json()["content"], response.json()["plan"]), (CHAT_SWIM, "swim"))
        prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("write it out in full", prompt)

    def test_a_session_said_on_a_call_says_its_kind_too(self):
        self.assertEqual(self.chat(SPOKEN_SWIM, mode="conversation").json()["plan"], "swim")

    def test_on_a_call_sessions_are_asked_for_as_speech_not_a_written_list(self):
        self.chat(SPOKEN_SWIM, mode="conversation")
        prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("never as a list", prompt)
        self.assertNotIn("write it out in full", prompt)

    def test_a_reply_without_sessions_offers_nothing(self):
        self.assertIsNone(self.chat(ADVICE).json()["plan"])

    def test_a_plan_is_written_at_once_without_asking_what_the_profile_says(self):
        for mode, rule in (("chat", "Write it in this reply, without asking questions first"),
                           ("conversation", "Say it straight away, without asking questions first")):
            self.chat(CHAT_SWIM, mode=mode)
            prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
            self.assertIn(rule, prompt)
            self.assertIn("Never ask the athlete for anything their profile below already tells you", prompt)

    def test_the_coach_is_given_every_session_type_of_the_athletes_week(self):
        with patch.object(main, "get_authenticated_profile", return_value={**PROFILE, "user_key": "key-1", "swim_sessions_per_week": 5}):
            self.chat(CHAT_SWIM)
        self.assertEqual(main.chat_context.call_args.kwargs["swims"], 5)
        self.chat(CHAT_SWIM)
        self.assertEqual(main.chat_context.call_args.kwargs["swims"], 0)

    def test_the_athletes_chosen_days_are_where_a_week_goes(self):
        self.chat(CHAT_SWIM)
        self.assertNotIn("chosen training days", self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"])
        with patch.object(main, "coach_line", return_value="The athlete's chosen training days: swims on Mon, Wed, Fri."):
            self.chat(CHAT_SWIM)
        prompt = self.openai.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("The athlete's chosen training days: swims on Mon, Wed, Fri. When you write a week of sessions, put them on these days.", prompt)

    def test_on_gpt_5_the_chat_reasons_and_a_call_answers_at_once(self):
        with patch.object(main, "settings", SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-5.5", openai_voice_model="gpt-5.5",
                                                            openai_reasoning_effort="low")):
            self.chat(CHAT_SWIM)
            chat = self.openai.chat.completions.create.call_args.kwargs
            self.chat(SPOKEN_SWIM, mode="conversation")
            call = self.openai.chat.completions.create.call_args.kwargs
        self.assertEqual((chat["model"], chat["reasoning_effort"]), ("gpt-5.5", "low"))
        self.assertEqual(call["reasoning_effort"], "none")
        self.assertNotIn("temperature", chat)
        # Any other model answers at its temperature, as before.
        self.chat(ADVICE)
        self.assertEqual(self.openai.chat.completions.create.call_args.kwargs["temperature"], 0.2)

    def test_on_gpt_6_the_chat_reasons_and_a_call_comes_from_its_own_model(self):
        # The chat on GPT-6.1 Sol reasons; a call's reply comes from GPT-6 Sol, which can answer without reasoning.
        with patch.object(main, "settings", SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-6.1-sol", openai_voice_model="gpt-6-sol",
                                                            openai_reasoning_effort="low")):
            self.chat(CHAT_SWIM)
            chat = self.openai.chat.completions.create.call_args.kwargs
            self.chat(SPOKEN_SWIM, mode="conversation")
            call = self.openai.chat.completions.create.call_args.kwargs
        self.assertEqual((chat["model"], chat["reasoning_effort"]), ("gpt-6.1-sol", "low"))
        self.assertEqual((call["model"], call["reasoning_effort"]), ("gpt-6-sol", "none"))
        self.assertNotIn("temperature", chat)
        self.assertNotIn("temperature", call)
        # Calls set to GPT-6.1 Sol, which always reasons (it refuses none), reason as little as it can.
        with patch.object(main, "settings", SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-6.1-sol", openai_voice_model="gpt-6.1-sol",
                                                            openai_reasoning_effort="low")):
            self.chat(SPOKEN_SWIM, mode="conversation")
        self.assertEqual(self.openai.chat.completions.create.call_args.kwargs["reasoning_effort"], "low")


class _ReplyStream:
    """A streamed chat completion: the reply in pieces, then (optionally) a failure partway."""

    def __init__(self, pieces, failure=None):
        self.pieces, self.failure, self.closed = pieces, failure, False

    def __iter__(self):
        for piece in self.pieces:
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))])
        yield SimpleNamespace(choices=[])  # the closing usage chunk has no choices
        if self.failure:
            raise self.failure

    def close(self):
        self.closed = True


class CoachChatLiveTests(unittest.TestCase):
    """A voice call's reply streams as it is written: the same prompt as the chat's, a line of JSON per piece, then the
    whole reply with its sources and the kinds of session it prescribes."""

    def setUp(self):
        self.client = TestClient(app)
        self.openai = MagicMock()
        for name, value in [("get_authenticated_profile", {**PROFILE, "user_key": "key-1"}), ("recent_athlete_feedback", []),
                            ("chat_context", ("PROGRAM", [{"source_file": "Power 1", "coach_name": "Coach Brad", "similarity": 3.0}], ["Coach Brad"])),
                            ("recent_race_results", []), ("pacing_context", {}), ("coach_line", ""),
                            ("settings", SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-5.5", openai_voice_model="gpt-5.5",
                                                         openai_reasoning_effort="low"))]:
            patcher = patch.object(main, name, **({"return_value": value} if name != "settings" else {"new": value}))
            self.addCleanup(patcher.stop)
            patcher.start()
        for target, name, value in [(main, "OpenAI", self.openai), (tokens, "charge", None)]:
            patcher = patch.object(target, name, return_value=value)
            self.addCleanup(patcher.stop)
            patcher.start()
        patcher = patch.dict(main._call_context, clear=True)
        self.addCleanup(patcher.stop)
        patcher.start()

    def live(self, stream, user_key="key-1"):
        self.openai.chat.completions.create.return_value = stream
        response = self.client.post("/api/coach-chat/live", headers=HEADERS, json={
            "user_key": user_key, "selected_coaches": ["Coach Brad"], "message": "Give me a sprint set", "mode": "conversation"})
        lines = [json.loads(line) for line in response.text.splitlines() if line.strip()] if response.status_code == 200 else []
        return response, lines

    def test_the_reply_streams_then_comes_whole_with_its_plan(self):
        pieces = [SPOKEN_SWIM[:40], SPOKEN_SWIM[40:120], SPOKEN_SWIM[120:]]
        stream = _ReplyStream(pieces)
        response, lines = self.live(stream)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/x-ndjson")
        self.assertEqual([line["delta"] for line in lines[:-1]], pieces)
        self.assertEqual(lines[-1], {"done": True, "content": SPOKEN_SWIM, "plan": "swim",
                                     "sources": [{"source_file": "Power 1", "coach_name": "Coach Brad", "similarity": 3.0}]})
        options = self.openai.chat.completions.create.call_args.kwargs
        self.assertTrue(options["stream"])
        self.assertEqual((options["model"], options["reasoning_effort"]), ("gpt-5.5", "none"))
        self.assertIn("never as a list", options["messages"][1]["content"])
        self.assertTrue(stream.closed)

    def test_it_asks_exactly_what_the_chat_endpoint_asks(self):
        self.live(_ReplyStream(["Fine."]))
        live = self.openai.chat.completions.create.call_args.kwargs
        self.openai.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Fine."))])
        self.client.post("/api/coach-chat", headers=HEADERS, json={
            "user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "Give me a sprint set", "mode": "conversation"})
        chat = self.openai.chat.completions.create.call_args.kwargs
        self.assertEqual(live["messages"], chat["messages"])
        self.assertEqual({key: value for key, value in live.items() if key != "stream"}, chat)

    def test_a_reply_that_breaks_off_ends_with_an_error(self):
        stream = _ReplyStream(["Start with a 300 loosen"], failure=RuntimeError("connection reset"))
        with self.assertLogs("app.main", level="ERROR"):
            _, lines = self.live(stream)
        self.assertEqual(lines[0], {"delta": "Start with a 300 loosen"})
        self.assertIn("try again", lines[-1]["error"])
        self.assertTrue(stream.closed)

    def test_an_empty_reply_is_an_error(self):
        _, lines = self.live(_ReplyStream([]))
        self.assertEqual(lines, [{"error": "The coach returned an empty response."}])

    def test_someone_elses_profile_is_refused_before_anything_streams(self):
        response, _ = self.live(_ReplyStream(["Hi."]), user_key="key-2")
        self.assertEqual(response.status_code, 403)
        self.openai.chat.completions.create.assert_not_called()

    def test_a_reply_that_cannot_start_is_an_ordinary_error(self):
        self.openai.chat.completions.create.side_effect = RuntimeError("model unavailable")
        response = self.client.post("/api/coach-chat/live", headers=HEADERS, json={
            "user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "Hi", "mode": "conversation"})
        self.assertEqual(response.status_code, 502)

    def test_a_calls_turns_reuse_the_athletes_records_for_a_minute(self):
        lookups = [main.get_authenticated_profile, main.recent_athlete_feedback, main.recent_race_results, main.pacing_context, main.coach_line]
        for _ in range(3):
            self.live(_ReplyStream(["Fine."]))
        self.assertEqual([lookup.call_count for lookup in lookups], [1] * 5)
        prompts = [call.kwargs["messages"][1]["content"] for call in self.openai.chat.completions.create.call_args_list]
        self.assertEqual(len(set(prompts)), 1)
        # Another session's call is its own, and so is this one's once the minute is up.
        self.openai.chat.completions.create.return_value = _ReplyStream(["Fine."])
        self.client.post("/api/coach-chat/live", headers={"Authorization": "Bearer other"}, json={
            "user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "Hi", "mode": "conversation"})
        self.assertEqual(main.get_authenticated_profile.call_count, 2)
        for key, (_, profile, looked_up) in list(main._call_context.items()):
            main._call_context[key] = (0.0, profile, looked_up)
        self.live(_ReplyStream(["Fine."]))
        self.assertEqual(main.get_authenticated_profile.call_count, 3)

    def test_the_typed_chat_always_looks_everything_up(self):
        self.live(_ReplyStream(["Fine."]))
        self.openai.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Fine."))])
        for _ in range(2):
            self.client.post("/api/coach-chat", headers=HEADERS, json={"user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "Hi"})
        self.assertEqual(main.get_authenticated_profile.call_count, 3)
        self.assertEqual(main.recent_athlete_feedback.call_count, 3)

    def test_a_remembered_call_is_still_checked_against_its_profile(self):
        self.live(_ReplyStream(["Fine."]))
        response, _ = self.live(_ReplyStream(["Fine."]), user_key="key-2")
        self.assertEqual(response.status_code, 403)

    def test_the_openai_client_is_kept_between_replies(self):
        for _ in range(3):
            self.live(_ReplyStream(["Fine."]))
        self.assertEqual(main.OpenAI.call_count, 1)


class ReadPlanTests(unittest.TestCase):
    """A coach's reply is read into sessions in the swim and gym weeks' own formats; nothing is saved."""

    def setUp(self):
        self.client = TestClient(app)
        self.outline = OUTLINE
        self.calls = []
        self.patch(coach_plan, "get_authenticated_profile", return_value=PROFILE)
        self.patch(training, "athlete_brief", return_value={"main_events": PROFILE["main_events"]})
        self.patch(training, "best_pace", return_value=None)
        self.patch(training, "generate_structured", side_effect=self.generate)
        self.save = self.patch(training, "save_record")

    def patch(self, target, name, **options):
        patcher = patch.object(target, name, **options)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def generate(self, profile, schema, objective, check=None, **options):
        self.calls.append((schema, objective, check, options))
        data = {PlanOutline: self.outline, CoachSwim: SWIM, CoachGym: GYM}[schema]
        return schema.model_validate(data), []

    def read(self, **body):
        return self.client.post("/api/training/coach-plan/read", headers=HEADERS, json={"reply": REPLY, "request": "Plan my week", **body})

    def call(self, schema):
        """The call that wrote `schema` (the sessions are written at the same time, in no set order)."""
        return next(call for call in self.calls if call[0] is schema)

    def test_each_session_comes_back_in_its_weeks_format_with_its_day(self):
        response = self.read()
        self.assertEqual(response.status_code, 200, response.text)
        plan = response.json()
        self.assertEqual((plan["title"], plan["coach"]), ("Brad's sprint week", "Coach Brad"))
        swim, workout = plan["sessions"]
        self.assertEqual((swim["kind"], swim["day"], swim["title"]), ("swim", "Monday", "Sprint swim"))
        session = training.SwimSession.model_validate(swim["workout"])
        self.assertEqual((session.total_distance_meters, session.main_training_zones), (1000, ["Recovery", "Sprint"]))
        self.assertEqual((workout["kind"], workout["day"], workout["focus"]), ("gym", "Wednesday", "strength"))
        # Its workout is the Workout Builder's (an empty section left out), shown as the gym week shows it.
        self.assertEqual([section["title"] for section in workout["doc"]["sections"]], ["Main Set"])
        self.assertEqual([item["exercise"] for item in workout["workout"]["exercises"]], ["Goblet squat", "Plank"])
        self.assertEqual(workout["workout"]["sections"][0]["exercises"][0]["load"], "RPE 7")
        self.assertNotEqual(swim["id"], workout["id"])
        self.save.assert_not_called()

    def test_each_session_is_copied_from_its_own_lines_with_the_copying_rules(self):
        self.read()
        outline, swim, workout = self.call(PlanOutline), self.call(CoachSwim), self.call(CoachGym)
        self.assertIn("3: Warm-up: 400 easy choice", outline[1])
        self.assertIn('"Sprint swim", for Monday', swim[1])
        self.assertIn("Copy only this session", swim[1])
        self.assertIn("Main: 8 x 50 freestyle sprint @1:00", swim[1])
        self.assertNotIn("Goblet squat", swim[1])
        self.assertIn("Goblet squat 3 x 10", workout[1])
        for _schema, _objective, _check, options in self.calls:
            self.assertEqual(options["rules"], coach_plan.CONVERSION_RULES)
            self.assertTrue(options["urgent"])

    def test_a_session_only_named_is_left_out_and_said_so_never_made_up(self):
        self.outline = {"title": "Week", "sessions": [*OUTLINE["sessions"], {"kind": "gym", "title": "Strength", "day": "Friday", "pieces": [9]}]}
        response = self.client.post("/api/training/coach-plan/read", headers=HEADERS,
                                    json={"reply": REPLY.replace("Let me know how it feels.", "On Friday, hit the gym for strength training.")})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([session["day"] for session in response.json()["sessions"]], ["Monday", "Wednesday"])
        self.assertEqual(response.json()["skipped"], [{"kind": "gym", "title": "Strength", "day": "Friday", "reason": "named"}])
        self.assertEqual(sum(call[0] is CoachGym for call in self.calls), 1)   # nothing was written for Friday

    def test_a_reply_said_on_a_call_is_read_as_speech(self):
        self.read(spoken=True)
        self.assertIn("eight twenty-fives", self.calls[0][1])

    def test_a_reply_with_no_session_says_so(self):
        self.outline = {"title": "Advice", "sessions": []}
        response = self.read()
        self.assertEqual(response.status_code, 422)
        self.assertIn("no complete session", response.json()["detail"])
        self.assertEqual(len(self.calls), 1)

    def test_a_title_that_only_says_the_kind_of_session_is_named_by_the_copy(self):
        self.outline = {"title": "x", "sessions": [{**OUTLINE["sessions"][0], "title": "Swim Session"}, OUTLINE["sessions"][1]]}
        self.read()
        objective = self.call(CoachSwim)[1]
        self.assertIn("THE COACH'S SWIM (the whole reply)", objective)   # the copy isn't told a title...
        self.assertIn("never its day", objective)                         # ...it names the swim itself
        for title in ("Swim Session", "Strength Training", "Monday Gym Workout", "Tomorrow's Swim"):
            self.assertTrue(coach_plan.generic_title(title), title)
        for title in ("Threshold IM Swim", "Breaststroke Technique Set", "Shoulder Mobility Routine", "Recovery Swim", "Leg Power Circuit"):
            self.assertFalse(coach_plan.generic_title(title), title)

    def test_a_title_still_generic_is_named_from_what_the_session_trains(self):
        self.outline = {"title": "x", "sessions": [{**OUTLINE["sessions"][0], "title": "Swim Session"},
                                                   {**OUTLINE["sessions"][1], "title": "Strength Training"}]}
        with patch.dict(SWIM, {"title": "Swim Session"}), patch.dict(GYM, {"title": "Gym Workout"}):
            titles = [session["title"] for session in self.read().json()["sessions"]]
        self.assertEqual(titles, ["Sprint Freestyle Swim", "Goblet squat & Plank"])

    def test_an_early_copy_takes_the_splits_title(self):
        reply = "Here's your session for tomorrow:\nWarm-up: 400 easy\nMain: 8 x 50 freestyle sprint @1:00\nWarm-down: 200 easy"
        self.outline = {"title": "Sprint", "sessions": [{"kind": "swim", "title": "Race-Pace Sprint 50s", "day": "tomorrow", "pieces": [1, 2, 3, 4]}]}
        session = self.client.post("/api/training/coach-plan/read", headers=HEADERS, json={"reply": reply}).json()["sessions"][0]
        self.assertEqual((session["title"], session["workout"]["title"]), ("Race-Pace Sprint 50s", "Race-Pace Sprint 50s"))

    def test_the_outline_may_only_point_at_pieces_the_reply_has(self):
        self.read()
        check = self.call(PlanOutline)[2]
        bad = PlanOutline.model_validate({"title": "x", "sessions": [{"kind": "swim", "title": "Swim", "day": None, "pieces": [3, 40]}]})
        self.assertIn("pieces [40]", check(bad)[0])
        self.assertEqual(check(PlanOutline.model_validate(OUTLINE)), [])

    def test_a_week_said_in_one_paragraph_is_told_apart_by_its_sentences(self):
        pieces = coach_plan.reply_pieces(
            "This week, let's build speed.\n\nOn Monday, do six one-hundreds on 1:20, then a 200 kick. On Tuesday, do four 12.5 m "
            "sprints at 1:05.2 pace. On Wednesday, rest.")
        self.assertEqual(pieces, ["This week, let's build speed.", "On Monday, do six one-hundreds on 1:20, then a 200 kick.",
                                  "On Tuesday, do four 12.5 m sprints at 1:05.2 pace.", "On Wednesday, rest."])

    def test_a_workout_without_exercises_is_sent_back(self):
        self.read()
        check = self.call(CoachGym)[2]
        notes_only = CoachGym.model_validate({**GYM, "sections": [{"title": "Stretch", "kind": "mobility", "notes": "10 min stretching", "exercises": []}]})
        self.assertTrue(check(notes_only))
        self.assertEqual(check(CoachGym.model_validate(GYM)), [])

    def test_a_session_that_cant_be_copied_is_listed_and_the_rest_still_come(self):
        def failing(profile, schema, objective, check=None, **options):
            if schema is CoachGym:
                raise HTTPException(status_code=502, detail=training.GENERATION_FAILED)
            return self.generate(profile, schema, objective, check, **options)
        with patch.object(training, "generate_structured", side_effect=failing):
            response = self.read()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([session["kind"] for session in response.json()["sessions"]], ["swim"])
        self.assertEqual(response.json()["skipped"], [{"kind": "gym", "title": "Leg strength", "day": "Wednesday", "reason": "unreadable"}])

    def test_when_no_session_can_be_copied_the_read_fails(self):
        def failing(profile, schema, objective, check=None, **options):
            if schema is not PlanOutline:
                raise HTTPException(status_code=502, detail=training.GENERATION_FAILED)
            return self.generate(profile, schema, objective, check, **options)
        with patch.object(training, "generate_structured", side_effect=failing):
            self.assertEqual(self.read().status_code, 502)

    def test_two_sessions_with_the_same_title_are_both_kept(self):
        self.outline = {"title": "x", "sessions": [{**OUTLINE["sessions"][0], "title": "Threshold"},
                                                   {**OUTLINE["sessions"][0], "title": "Threshold", "day": "Friday", "pieces": [4]}]}
        sessions = self.read().json()["sessions"]
        self.assertEqual([session["day"] for session in sessions], ["Monday", "Friday"])

    def test_one_session_is_copied_while_the_reply_is_still_being_split(self):
        reply = "Here's your session for tomorrow:\nWarm-up: 400 easy\nMain: 8 x 50 freestyle sprint @1:00\nWarm-down: 200 easy"
        self.outline = {"title": "Sprint", "sessions": [{"kind": "swim", "title": "Sprint swim", "day": "tomorrow", "pieces": [1, 2, 3, 4]}]}
        response = self.client.post("/api/training/coach-plan/read", headers=HEADERS, json={"reply": reply})
        self.assertEqual(response.status_code, 200, response.text)
        swims = [call for call in self.calls if call[0] is CoachSwim]
        self.assertEqual(len(swims), 1)                       # the early copy is the session: it isn't copied twice
        self.assertIn("THE COACH'S SWIM (the whole reply)", swims[0][1])
        self.assertEqual(response.json()["sessions"][0]["day"], "tomorrow")   # its day comes from the split

    def test_an_early_copy_the_split_disagrees_with_is_set_aside(self):
        reply = "Swim: 400 easy, 8 x 50 sprint, 200 easy.\nAnd later: another 6 x 100 aerobic, 200 easy."
        self.outline = {"title": "Two", "sessions": [{"kind": "swim", "title": "One", "day": None, "pieces": [1]},
                                                     {"kind": "swim", "title": "Two", "day": None, "pieces": [2]}]}
        response = self.client.post("/api/training/coach-plan/read", headers=HEADERS, json={"reply": reply})
        self.assertEqual([session["title"] for session in response.json()["sessions"]], ["Sprint swim", "Sprint swim"])
        swims = [call[1] for call in self.calls if call[0] is CoachSwim]
        self.assertEqual(len(swims), 3)                       # the early copy, then one for each session the split found
        self.assertTrue(any('THE COACH\'S SWIM ("One")' in objective for objective in swims))

    def test_a_failed_early_copy_is_copied_again_from_the_split(self):
        reply = "Swim today: 400 easy, 8 x 50 sprint @1:00, 200 easy."
        self.outline = {"title": "One", "sessions": [{"kind": "swim", "title": "Sprint", "day": "today", "pieces": [1]}]}
        attempts = []

        def flaky(profile, schema, objective, check=None, **options):
            if schema is CoachSwim:
                attempts.append(objective)
                if len(attempts) == 1:
                    raise HTTPException(status_code=502, detail=training.GENERATION_FAILED)
            return self.generate(profile, schema, objective, check, **options)
        with patch.object(training, "generate_structured", side_effect=flaky):
            response = self.client.post("/api/training/coach-plan/read", headers=HEADERS, json={"reply": reply})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(attempts), 2)
        self.assertIn('THE COACH\'S SWIM ("Sprint", for today)', attempts[1])

    LONG = ("Here's your swim:\n**Warm-Up:**\n- 2 rounds of:\n- 200 swim WHITE @3:00\n- 200 kick PINK @3:15\n- 4x50 drill @1:10\n"
            "**Pre-Set:**\n- 8x150 pull PINK\n**Main-Set:**\n- 6x100 Fr @1:20 WHITE\n- 1x200 kick @3:50 PINK\n- 4x50 Fly @1:00 RED\n"
            "- 100 easy\n- 6x100 IM @1:30 WHITE\n**Warm-Down:**\n- 4x200 Free w/Fins @2:45\n- 100 easy")

    def read_long(self, generate):
        self.outline = {"title": "Long", "sessions": [{"kind": "swim", "title": "Threshold", "day": None, "pieces": list(range(1, 18))}]}
        with patch.object(training, "generate_structured", side_effect=generate):
            return self.client.post("/api/training/coach-plan/read", headers=HEADERS, json={"reply": self.LONG})

    def test_a_long_swim_is_copied_in_parts_at_the_same_time_and_joined_in_order(self):
        def generate(profile, schema, objective, check=None, **options):
            if schema in (coach_plan.SwimHead, coach_plan.SwimSets):
                self.calls.append((schema, objective, check, options))
            if schema is coach_plan.SwimHead:
                return schema.model_validate({key: SWIM[key] for key in ("title", "objective", "event", "notes", "estimated_duration_minutes", "equipment")}), []
            if schema is coach_plan.SwimSets:
                number = int(re.search(r"part (\d) of", objective).group(1))
                return schema.model_validate({"sets": [planned_set(f"Part {number}", 1, 100)]}), []
            return self.generate(profile, schema, objective, check, **options)
        response = self.read_long(generate)
        self.assertEqual(response.status_code, 200, response.text)
        names = [item["name"] for item in response.json()["sessions"][0]["workout"]["sets"]]
        parts = [call for call in self.calls if call[0] is coach_plan.SwimSets]
        self.assertEqual(names, [f"Part {number}" for number in range(1, len(parts) + 1)])
        self.assertGreater(len(parts), 1)
        self.assertFalse(any(call[0] is CoachSwim for call in self.calls))         # never copied whole as well
        # A block like "2 rounds of:" stays whole inside its part.
        self.assertTrue(any("2 rounds of:" in call[1] and "4x50 drill" in call[1].split("THE LINES OF PART")[1] for call in parts))

    def test_a_long_swim_whose_part_fails_is_copied_whole(self):
        def generate(profile, schema, objective, check=None, **options):
            if schema in (coach_plan.SwimHead, coach_plan.SwimSets):
                self.calls.append((schema, objective, check, options))
            if schema is coach_plan.SwimSets:
                raise HTTPException(status_code=502, detail=training.GENERATION_FAILED)
            if schema is coach_plan.SwimHead:
                return schema.model_validate({key: SWIM[key] for key in ("title", "objective", "event", "notes", "estimated_duration_minutes", "equipment")}), []
            return self.generate(profile, schema, objective, check, **options)
        with self.assertLogs("app.coach_plan", level="WARNING"):
            response = self.read_long(generate)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(sum(call[0] is CoachSwim for call in self.calls), 1)

    def test_the_parts_of_a_swim_are_whole_sections(self):
        parts = coach_plan.swim_parts(self.LONG)
        self.assertGreater(len(parts), 1)
        self.assertEqual("\n".join(parts), self.LONG)
        for part in parts[1:]:
            self.assertRegex(part.splitlines()[0], r"\*\*(Pre-Set|Main-Set|Warm-Down):\*\*")
        self.assertEqual(coach_plan.swim_parts("Warm-up: 400 easy\nMain: 8x50 fast\nWarm-down: 200 easy"), ["Warm-up: 400 easy\nMain: 8x50 fast\nWarm-down: 200 easy"])

    def test_the_copy_knows_the_coachs_own_terms_and_colours(self):
        self.read()
        objective = self.call(CoachSwim)[1]
        self.assertIn("WHITE is Aerobic", objective)
        self.assertIn("PINK is Threshold", objective)


class SwimCopyCheckTests(unittest.TestCase):
    def swim(self, **changes):
        return CoachSwim.model_validate({**SWIM, **changes})

    def test_a_swim_as_the_coach_wrote_it_passes(self):
        self.assertEqual(swim_issues(self.swim(), None, "Warm-up: 400 easy. Main: 8 x 50 sprint. Warm-down: 200 easy."), [])

    def test_a_distance_the_coach_never_gave_gets_another_look(self):
        [issue] = swim_issues(self.swim(sets=[planned_set("Main: Kick", 15, 25)]), None, "Then 15 fast kicks and pulls.")
        self.assertIsInstance(issue, training.SoftIssue)
        self.assertIn("didn't give", issue)
        # Said aloud counts as given.
        spoken = self.swim(sets=[planned_set("Main", 6, 100), planned_set("Kick", 1, 200), planned_set("Pull", 4, 150), planned_set("Fast", 8, 50)])
        self.assertEqual(swim_issues(spoken, None, "Six one-hundreds, a two-hundred kick, four rounds of 150 pull, eight fifties fast."), [])

    def test_a_swim_over_twelve_kilometres_must_be_fixed(self):
        issues = swim_issues(self.swim(sets=[planned_set("Main", 100, 200)]), None, "100 x 200")
        self.assertTrue(any("12,000 m" in issue and not isinstance(issue, training.SoftIssue) for issue in issues))

    def test_an_event_outside_the_athletes_events_is_dropped(self):
        self.assertIsNone(coach_plan.as_swim(self.swim(event="1500m Freestyle"), PROFILE["main_events"]).event)

    def test_a_ladder_copied_as_repeats_gets_another_look(self):
        line = "15, 20, 25 FAST kick GREEN - cruise back to wall between each (60 sec rest)\n4x50 drills @1:10"
        wrong = self.swim(sets=[planned_set("Kick", 3, 15), planned_set("Kick", 3, 20), planned_set("Kick", 3, 25), planned_set("Drill", 4, 50)])
        [issue] = swim_issues(wrong, None, line)
        self.assertIn("is a ladder", issue)
        right = self.swim(sets=[planned_set("Kick", 1, 15), planned_set("Kick", 1, 20), planned_set("Kick", 1, 25), planned_set("Drill", 4, 50)])
        self.assertEqual(swim_issues(right, None, line), [])
        # Breathing patterns and thousands aren't ladders, and a distance written as repeats elsewhere isn't checked.
        self.assertEqual(swim_issues(self.swim(sets=[planned_set("Pull", 8, 150)]), None, "8x150 pull (breathe every 3,5,7 by 50) ~4,600 m"), [])
        self.assertEqual(swim_issues(self.swim(sets=[planned_set("Main", 4, 50), planned_set("Ladder", 1, 100)]), None, "4x50 fast\n200, 100, 50 easy"), [])

    def test_a_total_copied_as_a_set_is_left_out(self):
        # The swim's total made a set of its own: as written, cut down to fit a set ("**2,500 m | ...**" as 250 m), or at
        # the end. The coach's lines (SWIM's sets) add up to it.
        lines = "Warm-up: 400 easy\nMain: 8 x 50 sprint\nWarm-down: 200 easy"
        for total, words in ((planned_set("Session overview", 1, 1000), f"I'd use my 1,000 m session.\n{lines}"),
                             (planned_set("Monday: Swim", 1, 100), f"## Monday: Swim\n**1,000 m | about 30 minutes**\n{lines}"),
                             (planned_set("Total", 1, 1000), f"{lines}\nTotal: 1,000 m")):
            swim = self.swim(sets=[total, *SWIM["sets"]])
            [issue] = [issue for issue in swim_issues(swim, None, words) if "is the total" in issue]
            self.assertIsInstance(issue, training.SoftIssue)
            issue.fix()
            self.assertEqual([item.name for item in swim.sets], [item["name"] for item in SWIM["sets"]], words)
        # A part's heading above its lines.
        swim = self.swim(sets=[planned_set("Warm-Up", 1, 600), planned_set("Warm-Up: Easy", 1, 400), planned_set("Warm-Up: Kick", 4, 50),
                               planned_set("Main Set: Sprints", 8, 50, "Sprint")])
        [issue] = swim_issues(swim, None, "**Warm-up — 600 m**\n- 400 easy\n- 4 x 50 kick\n**Main set — 400 m**\n- 8 x 50 sprint")
        self.assertIn("for that part", issue)
        issue.fix()
        self.assertEqual([item.name for item in swim.sets], ["Warm-Up: Easy", "Warm-Up: Kick", "Main Set: Sprints"])

    def test_a_set_that_only_adds_up_like_a_total_stays(self):
        def issues(sets, words):
            return [issue for issue in swim_issues(self.swim(sets=sets), None, words) if "is the total" in issue]
        # A warm-up of the same length as the rest, and a warm-up line that lists more than its own distance.
        self.assertEqual(issues([planned_set("Warm-Up", 1, 400), planned_set("Main: Fast", 2, 100), planned_set("Main: Kick", 4, 50)],
                                "Warm-up: 400 m\nMain: 2 x 100 fast, 4 x 50 kick"), [])
        self.assertEqual(issues([planned_set("Warm-Up", 1, 200), planned_set("Warm-Up: Kick", 4, 25), planned_set("Warm-Up: Drill", 4, 25)],
                                "Warm-up: 200 m, 4 x 25 kick, 4 x 25 drill"), [])
        # A total the coach wrote that their lines add up to, with no set of its own.
        self.assertEqual(issues(SWIM["sets"], "Warm-up: 400 easy\nMain: 8 x 50 sprint\nWarm-down: 200 easy\nTotal: 1,000 m"), [])
        # A warm-up's first line as long as the rest of it, beside another part's heading of that length.
        self.assertEqual(issues([planned_set("Warm-up: Freestyle", 1, 300), planned_set("Warm-up: Kick", 1, 200), planned_set("Warm-up: Drill", 1, 50),
                                 planned_set("Warm-up: Swim", 1, 50), planned_set("Pre-set: Kick", 3, 100)],
                                "**Warm-up — 600 m**\n- 1 × 300 freestyle\n- 1 × 200 kick\n- 1 × 50 drill\n- 1 × 50 swim\n"
                                "**Pre-set — 300 m**\n- 3 × 100 kick"), [])

    def test_the_pool_the_coach_mentions_is_not_a_set(self):
        swim = self.swim(sets=[planned_set("Assumptions", 1, 25), *SWIM["sets"]])
        words = "Assumptions: a 25 m pool, with fins.\nWarm-up: 400 easy\nMain: 8 x 50 sprint\nWarm-down: 200 easy"
        [issue] = swim_issues(swim, None, words)
        self.assertIn("length of the pool", issue)
        issue.fix()
        self.assertEqual([item.name for item in swim.sets], [item["name"] for item in SWIM["sets"]])
        # 25s the coach gives are sets, pool or not.
        self.assertEqual(swim_issues(self.swim(sets=[planned_set("Main: Sprints", 8, 25)]), None, "In the 25 m pool: 8 x 25 sprint"), [])

    def test_a_distance_written_with_a_thousands_comma_was_given(self):
        self.assertEqual(swim_issues(self.swim(sets=[planned_set("Main: Steady", 1, 2000)]), None, "2,000 steady freestyle"), [])

    def test_one_fifties_are_not_fifties(self):
        [issue] = swim_issues(self.swim(sets=[planned_set("Kick", 1, 50)]), None, "Eight one-fifties pull, then some fast kicks.")
        self.assertIn("didn't give", issue)
        self.assertEqual(swim_issues(self.swim(sets=[planned_set("Pull", 8, 150)]), None, "Eight one-fifties pull."), [])

    def test_a_swim_given_only_in_part_keeps_a_length_that_fits_it(self):
        short = coach_plan.as_swim(self.swim(sets=[planned_set("Main", 1, 200)], estimated_duration_minutes=60), PROFILE["main_events"])
        self.assertEqual(short.estimated_duration_minutes, 20)
        full = coach_plan.as_swim(self.swim(estimated_duration_minutes=45), PROFILE["main_events"])
        self.assertEqual(full.estimated_duration_minutes, 45)

    def test_a_lone_repeat_written_as_rounds_becomes_repetitions_but_a_group_keeps_its_rounds(self):
        swim = coach_plan.as_swim(self.swim(sets=[
            planned_set("Warm-Up: Kick", 1, 50, rounds=4),                                       # "4 x 50 kick"
            planned_set("Main Set: Race pace", 4, 50, "Race pace", rounds=3),                    # "3 rounds of: 4 x 50,
            planned_set("Main Set: Easy", 1, 100, "Recovery", rounds=3),                         #   then 100 easy"
        ]), PROFILE["main_events"])
        self.assertEqual([(item.rounds, item.repetitions, item.distance_meters) for item in swim.sets], [(1, 4, 50), (3, 4, 50), (3, 1, 100)])
        self.assertEqual(swim.total_distance_meters, 200 + 600 + 300)


class AddPlanTests(unittest.TestCase):
    """The athlete's chosen sessions go on their days, saved as the swim and gym weeks save the athlete's own."""

    def setUp(self):
        self.client = TestClient(app)
        self.library = []
        self.week_plan = {"id": "week-1", "details": {"plan": {"phase": "Build"}}}
        self.patch(coach_plan, "get_authenticated_profile", return_value=PROFILE)
        self.patch(training, "library", side_effect=lambda profile: self.library)
        self.patch(training, "find_record", side_effect=lambda profile_id, key: self.week_plan if key == f"week:{MONDAY}" else None)
        # The plan is saved in one upsert: the rows of each are kept, and saved as sent.
        self.upserts = []

        def upsert(rows, on_conflict=None):
            self.upserts.append(rows)
            query = MagicMock()
            query.execute.return_value.data = rows
            return query
        self.database = MagicMock()
        self.database.table.return_value.upsert.side_effect = upsert
        self.patch(training, "get_supabase_client", return_value=self.database)
        clock = self.patch(coach_plan, "datetime")
        clock.now.return_value.date.return_value = TODAY

    def patch(self, target, name, **options):
        patcher = patch.object(target, name, **options)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def add(self, *sessions):
        return self.client.post("/api/training/coach-plan/add", headers=HEADERS, json={"sessions": list(sessions)})

    def swim(self, day=TODAY, identifier=SWIM_ID, workout=None):
        return {"kind": "swim", "id": identifier, "date": day.isoformat(), "workout": workout or swim_workout()}

    def gym(self, day=TODAY, focus="strength"):
        return {"kind": "gym", "id": GYM_ID, "date": day.isoformat(), "focus": focus, "doc": gym_doc()}

    def saved(self, key):
        """The record saved under `key`, as save_record's arguments (profile, key, kind, name, day, details)."""
        row = next(row for rows in self.upserts for row in rows if row["id"] == training.record_id("row-1", key))
        return "row-1", key, row["session_type"], row["session_name"], date.fromisoformat(row["session_date"][:10]), row["details"]

    def test_a_swim_is_saved_as_a_swim_week_swim_and_a_workout_as_a_coach_workout(self):
        response = self.add(self.swim(), self.gym(TODAY + timedelta(days=1)))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["added"], [
            {"kind": "swim", "date": TODAY.isoformat(), "title": "Sprint swim", "week_start": MONDAY.isoformat()},
            {"kind": "gym", "date": (TODAY + timedelta(days=1)).isoformat(), "title": "Leg strength", "week_start": MONDAY.isoformat()}])
        profile_id, key, kind, name, day, details = self.saved(f"coach-swim:{SWIM_ID}")
        self.assertEqual((profile_id, kind, name, day), ("row-1", "workout", "Sprint swim", TODAY))
        self.assertEqual(details, {"workout": swim_workout(), "date": TODAY.isoformat(), "phase": "Build", "pool_length": 50,
                                   "event": "100m Freestyle", "template": False, "source": "ai", "source_files": [], "coach": "Coach Brad"})
        _, _, kind, name, day, details = self.saved(f"coach-gym:{GYM_ID}")
        self.assertEqual((kind, name, day), ("gym_workout", "Leg strength", TODAY + timedelta(days=1)))
        self.assertEqual((details["source"], details["dose"], details["focus"], details["week_start"]),
                         ("coach", "Moderate", "From your coach", MONDAY.isoformat()))
        self.assertEqual(details["workout"]["title"], "Leg strength")
        self.assertEqual(details["workout"]["sections"][0]["exercises"][0]["name"], "Goblet squat")

    def test_the_swim_week_reads_a_coach_swim_as_the_athletes_scheduled_swim(self):
        self.add(self.swim())
        _, key, _, _, _, details = self.saved(f"coach-swim:{SWIM_ID}")
        row = {"id": training.record_id("row-1", key), "session_type": "workout", "session_date": f"{TODAY}T00:00:00+00:00", "details": details}
        with patch.object(training, "load_records", return_value=[row]):
            [item] = LIBRARY(PROFILE)
        self.assertEqual((item["date"], item["origin"], item["distance_meters"], item["completed"]), (TODAY.isoformat(), "AI workout", 1000, False))
        # Generating or re-planning the week keeps it and counts it, never replaces or duplicates it.
        self.assertIn(item["origin"], training.MANUAL_ORIGINS)

    def test_the_gym_week_shows_a_coach_workout_and_planning_the_week_keeps_it(self):
        self.add(self.gym())
        _, key, _, _, _, details = self.saved(f"coach-gym:{GYM_ID}")
        row = {"id": training.record_id("row-1", key), "session_type": "gym_workout", "session_date": f"{TODAY}T00:00:00+00:00", "details": details}
        [item] = training.gym_items("row-1", [row], MONDAY, MONDAY + timedelta(days=7))
        self.assertEqual((item["source"], item["dose"], item["completed"]), ("coach", "Moderate", False))
        week = {"days": [{"date": (MONDAY + timedelta(days=index)).isoformat(), "workouts": [item] if MONDAY + timedelta(days=index) == TODAY else []}
                         for index in range(7)]}
        database = MagicMock()
        with patch.object(gym, "gym_week", return_value=week), patch.object(gym, "strength_athlete"), \
                patch.object(gym, "plan_week", return_value=[]) as plan_week, patch.object(gym, "get_supabase_client", return_value=database), \
                patch("app.gym.datetime") as clock:
            clock.now.return_value.date.return_value = TODAY
            with self.assertRaises(HTTPException):
                gym.plan_gym_week(PROFILE, MONDAY)       # nothing left to plan in this made-up week
        # Its day isn't planned over, it counts as a strength session, and it's never deleted.
        open_days, kept_strength = plan_week.call_args.args[2], plan_week.call_args.args[4]
        self.assertNotIn(TODAY, open_days)
        self.assertEqual(kept_strength, 1)
        database.table.return_value.delete.assert_not_called()

    def test_a_mobility_workout_counts_as_mobility_when_the_gym_week_is_planned(self):
        self.add(self.gym(focus="mobility"))
        self.assertTrue(self.saved(f"coach-gym:{GYM_ID}")[5]["focus"].startswith("Mobility"))

    def test_the_coachs_length_is_kept(self):
        doc = {**gym_doc(), "duration_minutes": 45}
        self.add({**self.gym(), "doc": doc})
        self.assertEqual(self.saved(f"coach-gym:{GYM_ID}")[5]["workout"]["estimated_duration_minutes"], 45)

    def test_a_day_that_would_have_three_swims_is_refused_before_anything_is_saved(self):
        self.library = [{"key": "a", "date": TODAY.isoformat(), "distance_meters": 3000},
                        {"key": "b", "date": TODAY.isoformat(), "distance_meters": 3000}]
        response = self.add(self.gym(), self.swim())
        self.assertEqual(response.status_code, 409)
        self.assertIn("more than two swims", response.json()["detail"])
        self.assertEqual(self.upserts, [])

    def test_two_swims_added_together_count_against_the_same_day(self):
        self.library = [{"key": "a", "date": TODAY.isoformat(), "distance_meters": 3000}]
        other = "2d9f8e7c-6b5a-4c3d-8e2f-1a0b9c8d7e6f"
        response = self.add(self.swim(), self.swim(identifier=other))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.upserts, [])

    def test_a_day_over_sixteen_kilometres_is_refused(self):
        self.library = [{"key": "a", "date": TODAY.isoformat(), "distance_meters": 15500}]
        response = self.add(self.swim())
        self.assertEqual(response.status_code, 409)
        self.assertIn("16,000 m", response.json()["detail"])

    def test_sending_the_same_plan_again_saves_each_session_once(self):
        # The first send was saved but its reply was lost: the swim is already on its day, beside another.
        self.library = [{"key": "a", "date": TODAY.isoformat(), "distance_meters": 3000},
                        {"key": training.record_id("row-1", f"coach-swim:{SWIM_ID}"), "date": TODAY.isoformat(), "distance_meters": 1000}]
        self.assertEqual(self.add(self.swim()).status_code, 200)
        self.assertEqual([row["id"] for row in self.upserts[-1]], [training.record_id("row-1", f"coach-swim:{SWIM_ID}")])

    def test_a_day_that_is_over_is_refused(self):
        response = self.add(self.swim(TODAY - timedelta(days=2)))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.upserts, [])

    def test_yesterday_is_allowed_for_athletes_ahead_of_utc(self):
        self.assertEqual(self.add(self.swim(TODAY - timedelta(days=1))).status_code, 200)

    def test_the_same_session_twice_or_none_at_all_is_refused(self):
        self.assertEqual(self.add(self.swim(), self.swim()).status_code, 422)
        self.assertEqual(self.add().status_code, 422)
        self.assertEqual(self.upserts, [])

    def test_the_whole_plan_is_saved_in_one_statement(self):
        self.assertEqual(self.add(self.swim(), self.gym(TODAY + timedelta(days=1))).status_code, 200)
        self.assertEqual(len(self.upserts), 1)
        self.assertEqual({row["session_type"] for row in self.upserts[0]}, {"workout", "gym_workout"})

    def test_a_save_that_doesnt_come_back_whole_says_so(self):
        def short(rows, on_conflict=None):
            query = MagicMock()
            query.execute.return_value.data = rows[:1]
            return query
        self.database.table.return_value.upsert.side_effect = short
        response = self.add(self.swim(), self.gym(TODAY + timedelta(days=1)))
        self.assertEqual(response.status_code, 500)
        self.assertIn("nothing will be added twice", response.json()["detail"])

    def test_the_phase_is_the_season_plans_until_the_week_is_generated(self):
        self.week_plan = None
        self.database.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
            {"plan": {"phase": "General Preparation"}}]
        self.assertEqual(self.add(self.swim()).status_code, 200)
        self.assertEqual(self.saved(f"coach-swim:{SWIM_ID}")[5]["phase"], "General Preparation")


if __name__ == "__main__":
    unittest.main()
