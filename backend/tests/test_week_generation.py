"""Week generation that can't hang or fail on a slip: replies are streamed and stopped when they stall, small slips are
accepted rather than failing the week, long swims are written in parts, and errors read as plain words."""
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from openai import APIConnectionError
from pydantic import BaseModel, Field

from app import jobs, training
from app.coach_programs import PROGRAMS, session_lines
from app.swim_planner import session_parts
from app.today import SwimSession, SwimSet


class Reply(BaseModel):
    title: str = Field(min_length=1)
    items: list[int] = Field(max_length=3)


def chunk(text="", finish=None):
    return SimpleNamespace(usage=None, choices=[SimpleNamespace(delta=SimpleNamespace(content=text), finish_reason=finish)])


class FakeStream:
    def __init__(self, chunks):
        self.chunks, self.closed = chunks, False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.closed = True

    def __iter__(self):
        return iter(self.chunks)


class FakeClient:
    """Each create() serves the next scripted reply (a list of chunks, or an exception to raise)."""

    def __init__(self, *replies):
        self.replies, self.requests = list(replies), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **request):
        self.requests.append(request)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        self.stream = FakeStream(reply)
        return self.stream


def answer(text):
    return [chunk(text[: len(text) // 2]), chunk(text[len(text) // 2:]), chunk(finish="stop")]


class StreamedReplyTests(unittest.TestCase):
    def reply(self, client, job=None):
        return training._reply(client, [{"role": "user", "content": "x"}], {"json_schema": {"name": "Reply"}}, 500, job)

    def test_a_complete_reply_is_returned(self):
        client = FakeClient(answer('{"title": "a", "items": []}'))
        self.assertEqual(self.reply(client), '{"title": "a", "items": []}')
        self.assertTrue(client.stream.closed)
        self.assertEqual(client.requests[0]["max_completion_tokens"], 500)

    def test_a_reply_stuck_writing_whitespace_is_stopped_at_once(self):
        stuck = [chunk('{"title": "a", "items": [1, 2, 3'), *[chunk("    ") for _ in range(10_000)]]
        client = FakeClient(stuck)
        with self.assertRaises(training.ReplyCutOff):
            self.reply(client)
        self.assertTrue(client.stream.closed)

    def test_a_reply_cut_off_by_the_output_limit_is_not_used(self):
        with self.assertRaises(training.ReplyCutOff):
            self.reply(FakeClient([chunk('{"title": "a", "it'), chunk(finish="length")]))

    def test_leaving_the_page_stops_the_reply(self):
        job = jobs.Job(("p", "swim", "2030-01-07"))
        job.cancelled.set()
        with self.assertRaises(jobs.GenerationCancelled):
            self.reply(FakeClient(answer('{"title": "a", "items": []}')), job)


class StructuredGenerationTests(unittest.TestCase):
    def generate(self, client, check=None, attempts=3):
        with patch.object(training, "openai_client", return_value=client):
            return training.generate_structured({"id": "p"}, Reply, "Write it.", check=check, attempts=attempts, grounding=("g", ["s"]),
                                                max_tokens=500)[0]

    def test_a_stalled_reply_is_tried_again_from_scratch(self):
        client = FakeClient([chunk('{"title": "a", "items": [1, 2, 3'), *[chunk("     ") for _ in range(50)]],
                            answer('{"title": "b", "items": [1]}'))
        self.assertEqual(self.generate(client).title, "b")
        self.assertEqual(client.requests[0]["messages"], client.requests[1]["messages"])   # the stuck reply isn't echoed back

    def test_a_dropped_connection_is_tried_again(self):
        client = FakeClient(APIConnectionError(request=httpx.Request("POST", "https://api.openai.com")), answer('{"title": "b", "items": []}'))
        self.assertEqual(self.generate(client).title, "b")

    def test_shared_data_comes_first_so_the_prompt_cache_serves_it(self):
        client = FakeClient(answer('{"title": "b", "items": []}'))
        self.generate(client)
        messages = client.requests[0]["messages"]
        self.assertEqual([message["role"] for message in messages], ["system", "user", "user"])
        self.assertIn("g", messages[1]["content"])
        self.assertEqual(messages[2]["content"], "Write it.")

    def test_rejected_json_goes_back_with_its_problems_and_only_the_latest_attempt(self):
        client = FakeClient(answer('{"title": "a", "items": [1]}'), answer('{"title": "a", "items": [2]}'), answer('{"title": "a", "items": [3]}'))
        result = self.generate(client, check=lambda reply: [] if reply.items == [3] else ["items must be [3]"])
        self.assertEqual(result.items, [3])
        third = client.requests[2]["messages"]
        self.assertEqual(len(third), 5)
        self.assertIn('[2]', third[3]["content"])
        self.assertIn("items must be [3]", third[4]["content"])

    def test_small_slips_are_accepted_rather_than_failing(self):
        client = FakeClient(*[answer('{"title": "a", "items": [1]}') for _ in range(3)])
        result = self.generate(client, check=lambda reply: [training.SoftIssue("a little long")])
        self.assertEqual(result.title, "a")

    def test_a_real_problem_fails_with_plain_words(self):
        client = FakeClient(*[answer('{"title": "a", "items": [1]}') for _ in range(3)])
        with self.assertLogs("app.training", "WARNING"), self.assertRaises(HTTPException) as failure:
            self.generate(client, check=lambda reply: ["wrong session"])
        self.assertEqual(failure.exception.detail, training.GENERATION_FAILED)
        self.assertNotIn("JSON", failure.exception.detail)

    def status_error(self, kind, status):
        request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
        return kind("refused", response=httpx.Response(status, request=request, headers={"retry-after-ms": "10"}), body=None)

    def test_rate_limits_wait_as_asked_and_dont_use_up_attempts(self):
        from openai import RateLimitError
        client = FakeClient(*[self.status_error(RateLimitError, 429) for _ in range(4)], answer('{"title": "b", "items": []}'))
        with patch.object(training, "_wait"):
            self.assertEqual(self.generate(client, attempts=1).title, "b")

    def test_server_errors_and_dropped_connections_are_retried_on_their_own_budget(self):
        from openai import InternalServerError
        request = httpx.Request("POST", "https://api.openai.com")
        client = FakeClient(self.status_error(InternalServerError, 500), APIConnectionError(request=request),
                            self.status_error(InternalServerError, 503), answer('{"title": "b", "items": []}'))
        with patch.object(training, "_wait"):
            self.assertEqual(self.generate(client, attempts=1).title, "b")

    def test_a_request_openai_will_never_accept_fails_at_once(self):
        from openai import BadRequestError
        client = FakeClient(self.status_error(BadRequestError, 400), answer('{"title": "b", "items": []}'))
        with self.assertRaises(BadRequestError):
            self.generate(client)
        self.assertEqual(len(client.requests), 1)

    def test_running_out_of_time_says_so_in_plain_words(self):
        job = jobs.Job(("p", "swim", "2030-01-07"))
        job.deadline = time.monotonic() - 1
        with patch.object(training, "openai_client", return_value=FakeClient()), self.assertLogs("app.training", "WARNING"), \
                self.assertRaises(HTTPException) as slow:
            training.generate_structured({"id": "p"}, Reply, "Write it.", grounding=("g", []), job=job)
        self.assertEqual(slow.exception.status_code, 503)
        self.assertEqual(slow.exception.detail, training.GENERATION_SLOW)

    def test_minor_issues_get_one_more_attempt_and_are_then_repaired(self):
        client = FakeClient(*[answer('{"title": "a", "items": [1]}') for _ in range(3)])

        def check(reply):
            return [training.soft("title must be b", lambda: setattr(reply, "title", "b"))]

        result = self.generate(client, check=check)
        self.assertEqual(len(client.requests), training.SOFT_ATTEMPTS)
        self.assertEqual(result.title, "b")


class SchemaTests(unittest.TestCase):
    def test_required_text_must_have_a_visible_character(self):
        schema = training.strict_schema(SwimSet.model_json_schema())
        self.assertEqual(schema["properties"]["interval"]["pattern"], r"\S")
        self.assertNotIn("pattern", schema["properties"]["equipment"])
        self.assertNotIn("minLength", schema["properties"]["interval"])
        self.assertFalse(schema["additionalProperties"])

    def test_a_swim_has_room_for_every_line_of_the_longest_coach_session(self):
        longest = max(sum(not line.header for line in session_lines(session))
                      for program in PROGRAMS.values() for pool in (program.sessions, program.taper) for session in pool)
        self.assertLessEqual(longest, SwimSession.model_fields["sets"].metadata[1].max_length)


class SessionPartTests(unittest.TestCase):
    sessions = [session for program in PROGRAMS.values() for pool in (program.sessions, program.taper) for session in pool
                if session.type not in program.non_swim_types]

    def test_parts_cover_every_line_once_in_order(self):
        for session in self.sessions:
            parts = session_parts(session, 5)
            self.assertEqual([line for part in parts for line in part], session_lines(session), session)

    def test_parts_are_balanced_and_short_sessions_stay_whole(self):
        for session in self.sessions:
            parts = session_parts(session, 5)
            swims = [sum(line.meters > 0 for line in part) for part in parts]
            if sum(swims) <= 6:
                self.assertEqual(len(parts), 1)
            else:
                self.assertLessEqual(max(swims) - min(swims), 1, session)
                self.assertLessEqual(max(swims), 5)

    def test_a_note_stays_with_its_swim_and_a_block_header_with_its_block(self):
        brad = PROGRAMS["brad"].sessions[0]          # Power #1: "3 rounds:" then its dives
        for part in session_parts(brad, 5):
            if any(line.header for line in part):
                header = next(index for index, line in enumerate(part) if line.header)
                self.assertGreater(part[header + 1].meters, 0)


class PartTargetTests(unittest.TestCase):
    def parts(self, *sections):
        from app.coach_programs import SessionLine
        return [tuple(SessionLine(name, "x", None, float(meters)) for name, meters in part) for part in sections]

    def targets(self, parts, high, low=0):
        return training.part_targets(parts, training.line_shares([line for part in parts for line in part], high, low))

    def test_a_session_that_fits_keeps_every_line(self):
        parts = self.parts([("Warm-Up", 600), ("Main-Set", 400)], [("Main-Set", 1000), ("Warm-Down", 200)])
        self.assertEqual(self.targets(parts, 2400), [1000, 1200])

    def test_a_long_session_is_cut_warm_up_and_warm_down_first(self):
        parts = self.parts([("Warm-Up", 800)], [("Main-Set", 4000)], [("Warm-Down", 400)])
        targets = self.targets(parts, 4800)                                # 400 m over: warm-up and warm-down give it
        self.assertLessEqual(sum(targets), 4800)
        self.assertGreaterEqual(sum(targets), 4600)
        self.assertEqual(targets[1], 4000)
        targets = self.targets(parts, 3000, 2400)                          # far over: half of the rest, then the main set
        self.assertLessEqual(sum(targets), 3000)
        self.assertGreaterEqual(sum(targets), 2400)
        self.assertEqual(targets[0] + targets[2], 600)

    def test_a_line_with_its_own_repetitions_is_cut_in_whole_repetitions(self):
        from app.coach_programs import SessionLine
        line = SessionLine("Warm-Up", "3x200 Free (50 right arm/50 left arm/50 kick/50 swim)", None, 600.0)
        self.assertEqual(training.line_target(line, 0.67), 400)            # 2x200, not "about 400 m"
        self.assertIn("cut to 2 of its 3 repetitions: 600 m -> 2 x 200 m = 400 m",
                      training.listed_lines([line], {True: 1.0, False: 0.67}))

    def test_a_session_cut_in_whole_rounds_still_reaches_the_band(self):
        # Tony's Low Level Aerobic #1 for a sprinter with 60 minutes: every block already at one round is still 700 m
        # too long, so the round itself is shortened (and the lines say so).
        session = next(item for item in PROGRAMS["tony"].sessions if item.type == "Low Level Aerobic" and item.number == 1)
        lines = session_lines(session)
        low, high = training.template_volume_band(6400, (30, 42), 60)
        keep = training.line_shares(lines, high, low)
        kept = sum(training.line_target(line, keep[line.section == "Main-Set"]) for line in lines)
        self.assertTrue(low <= kept <= high, (low, kept, high))
        self.assertIn("cut to 1 round, shortened", training.listed_lines(lines, keep))

    def test_every_coach_session_fits_every_athletes_time(self):
        for program in PROGRAMS.values():
            for session in [*program.sessions, *program.taper]:
                if session.type in program.non_swim_types:
                    continue
                lines = session_lines(session)
                for minutes in (60, 90, 120, 150):
                    for rate in ((30, 42), (36, 50), (45, 60)):
                        low, high = training.template_volume_band(int(sum(line.meters for line in lines)), rate, minutes)
                        keep = training.line_shares(lines, high, low)
                        kept = sum(training.line_target(line, keep[line.section == "Main-Set"]) for line in lines)
                        self.assertLessEqual(kept, high + max(100, high // 10), (program.key, session.type, session.number, minutes, rate))

    def test_a_line_in_a_repeat_block_is_cut_in_whole_rounds(self):
        from app.coach_programs import SessionLine
        line = SessionLine("Main-Set", "200 IM Drill @3:15", "4 rounds:", 800.0, repeats=4)
        self.assertEqual(training.line_target(line, 0.62), 400)             # 2 rounds, not 496 m
        self.assertEqual(training.line_target(line, 1.0), 800)
        listed = training.listed_lines([line], {True: 0.62, False: 0.5})
        self.assertIn("cut to 2 rounds: 4 x 200 m = 800 m -> 2 x 200 m = 400 m", listed)
        self.assertIn("keep: 4 x 200 m = 800 m", training.listed_lines([line], {True: 1.0, False: 1.0}))


class PaceCheckTests(unittest.TestCase):
    def set(self, distance, target, zone="Sprint"):
        return SwimSet(name="Main-Set: dive", rounds=1, repetitions=1, distance_meters=distance, stroke="Free", interval="As needed",
                       target_time=target, training_zone=zone, equipment=[], description="d", technical_focus=["c"])

    def test_a_target_meant_for_another_distance_is_caught(self):
        issues = training.pace_issues([self.set(25, "22.90")], 45.8)          # a 50 m PB on a 25 m dive
        self.assertEqual(len(issues), 1)
        self.assertIsInstance(issues[0], training.SoftIssue)
        self.assertIn("one 25 m repetition", issues[0])

    def test_real_targets_pass(self):
        sets = [self.set(25, "11.45"), self.set(25, "11.45-12.00"), self.set(12, "6.2"), self.set(200, "2:17-2:36", "Aerobic"),
                self.set(50, "36.6", "Race pace"), self.set(400, "5:03-5:48", "Aerobic"), self.set(100, None, "Recovery"),
                self.set(100, "RPE 8", "Threshold"), self.set(100, "1:05.2", "Race pace")]
        self.assertEqual(training.pace_issues(sets, 45.8), [])               # a 22.90 50 m sprinter

    def test_without_a_usable_pb_nothing_is_checked(self):
        self.assertEqual(training.pace_issues([self.set(25, "22.90")], None), [])

    def test_a_target_written_as_a_sum_is_cut_to_its_time(self):
        set_ = self.set(25, "23.40 * 25 / 50 / (1.00) = 11.70")
        issues = training.pace_issues([set_], 45.8)
        self.assertEqual(len(issues), 1)
        self.assertIn("plain time", issues[0])
        issues[0].fix()
        self.assertEqual(set_.target_time, "11.70")

    def test_a_ladder_squeezed_into_one_set_is_caught_but_the_coachs_own_distances_are_not(self):
        squeezed = self.set(233, None, "Aerobic")
        self.assertTrue(training.odd_distance_issues([squeezed], "400, 200, 100 w/Fins"))
        self.assertEqual(training.odd_distance_issues([self.set(65, None, "Recovery")], "4x100 (35 FAST/65 easy)"), [])
        self.assertEqual(training.odd_distance_issues([self.set(150, None, "Aerobic")], ""), [])

    def test_best_pace_uses_the_fastest_usable_pb(self):
        profile = {"pbs_lcm": {"50m Freestyle": "22.90", "100m Freestyle": "52.40"}, "pbs_scm": {"50m Freestyle": "9.0"},
                   "one_year_goal_times": {"50m Freestyle": "21.00"}}
        self.assertAlmostEqual(training.best_pace(profile), 45.8)            # not the goal, not the impossible 9.0
        self.assertIsNone(training.best_pace({}))


class VolumeCheckTests(unittest.TestCase):
    def swim(self, meters, minutes=60):
        return SwimSession(title="t", objective="o", estimated_duration_minutes=minutes, main_training_zones=["Aerobic"], equipment=[],
                           sets=[SwimSet(name="Warm-Up: swim", rounds=1, repetitions=meters // 100, distance_meters=100, stroke="Free",
                                         interval="@1:30", target_time=None, training_zone="Aerobic", equipment=[], description="d",
                                         technical_focus=["c"]),
                                 SwimSet(name="Main-Set: kick", rounds=1, repetitions=1, distance_meters=meters % 100 or 50, stroke="Free",
                                         interval="@1:00", target_time=None, training_zone="Aerobic", equipment=[], description="d",
                                         technical_focus=["c"])])

    def test_close_to_the_band_is_accepted_as_written(self):
        self.assertEqual(training.template_swim_issues(self.swim(1250), 90, 1300, 2375, []), [])     # Brad, 50 m short
        self.assertEqual(training.template_swim_issues(self.swim(6150), 120, 3650, 6000, []), [])    # Robert, 150 m over

    def test_further_off_is_a_soft_issue_and_way_off_must_be_fixed(self):
        soft = training.template_swim_issues(self.swim(1000), 90, 1300, 2375, [])
        self.assertTrue(soft and all(isinstance(issue, training.SoftIssue) for issue in soft))
        hard = training.template_swim_issues(self.swim(500), 90, 1300, 2375, [])
        self.assertTrue(hard and not isinstance(hard[0], training.SoftIssue))

    def test_a_few_minutes_over_is_rounded_down_and_much_more_is_flagged(self):
        swim = self.swim(1800, minutes=96)
        self.assertEqual(training.template_swim_issues(swim, 90, 1300, 2375, []), [])
        self.assertEqual(swim.estimated_duration_minutes, 90)
        self.assertTrue(training.template_swim_issues(self.swim(1800, minutes=140), 90, 1300, 2375, []))

    def test_a_long_time_estimate_never_fails_a_week_it_is_capped(self):
        swim = self.swim(1800, minutes=180)                                    # Timothy's "rest as long as you need"
        issues = training.template_swim_issues(swim, 60, 1300, 2375, [])
        self.assertTrue(issues and all(isinstance(issue, training.SoftIssue) for issue in issues))
        for issue in issues:
            if issue.fix:
                issue.fix()
        self.assertEqual(swim.estimated_duration_minutes, 60)

    def test_a_session_that_warms_up_on_dry_land_is_one_set(self):
        # Timothy's Hybrid Gym and Swim: pull-rope warm-up, then 6 rounds of a 25 m dive. One set is the whole swim.
        swim = SwimSession(title="t", objective="o", estimated_duration_minutes=60, main_training_zones=["Sprint"], equipment=[],
                           sets=[SwimSet(name="Main-Set: Dive 25 MAX", rounds=6, repetitions=1, distance_meters=25, stroke="Free",
                                         interval="1 round every 10 minutes", target_time=None, training_zone="Sprint", equipment=[],
                                         description="d", technical_focus=["c"])])
        self.assertEqual(training.template_swim_issues(swim, 60, 100, 150, [], min_sets=1), [])
        self.assertTrue(training.template_swim_issues(swim, 60, 100, 150, [], min_sets=2))


if __name__ == "__main__":
    unittest.main()
