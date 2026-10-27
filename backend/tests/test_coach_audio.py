import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from openai import OpenAIError

from app import coach_audio
from app.coach_audio import COACH_VOICES, MAX_AUDIO_BYTES, PCM_MEDIA_TYPE
from app.main import app


class _Streamed:
    """What the OpenAI client's streaming speech request gives: a context manager around a response read in chunks.
    `hang_after`: how many chunks come before the audio stops coming (None: it never stops)."""

    def __init__(self, chunks=(b"\x01\x00", b"\x02\x00\x03"), failure=None, hang_after=None):
        self.chunks, self.failure, self.hang_after, self.closed = chunks, failure, hang_after, False

    async def __aenter__(self):
        if self.failure:
            raise self.failure
        return self

    async def __aexit__(self, *exc):
        self.closed = True
        return False

    async def iter_bytes(self):
        for index, chunk in enumerate(self.chunks):
            if index == self.hang_after:
                await asyncio.Event().wait()
            yield chunk
        if self.hang_after is not None and self.hang_after >= len(self.chunks):
            await asyncio.Event().wait()


class CoachAudioTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.settings = SimpleNamespace(
            openai_api_key="test-dummy",
            openai_transcription_model="gpt-4o-mini-transcribe",
            openai_speech_model="gpt-4o-mini-tts",
        )
        self.profile = {"recommended_coaches": list(COACH_VOICES)}
        self.provider = MagicMock()
        self.provider.with_options.return_value = self.provider
        self.provider.audio.transcriptions.create = AsyncMock(return_value=SimpleNamespace(text="Give me a sprint set."))
        self.provider.audio.speech.create = AsyncMock(return_value=SimpleNamespace(content=b"mp3-audio"))
        self.streamed = _Streamed()
        self.provider.audio.speech.with_streaming_response.create = MagicMock(side_effect=lambda **_: self.streamed)
        patches = [
            patch("app.coach_audio.get_settings", return_value=self.settings),
            patch("app.coach_audio.get_authenticated_profile", return_value=self.profile),
            patch("app.coach_audio.AsyncOpenAI", return_value=self.provider),
            patch.object(coach_audio, "_client", None),
            patch.dict(coach_audio._assigned, clear=True),
        ]
        self.settings_mock, self.auth_mock, self.openai_mock = [item.start() for item in patches][:3]
        for item in patches:
            self.addCleanup(item.stop)

    def transcribe(self, content=b"recorded-audio", content_type="audio/webm;codecs=opus"):
        return self.client.post(
            "/api/coach-chat/transcribe?coach=Coach%20Brad",
            content=content,
            headers={"Content-Type": content_type},
        )

    def speak(self, coach="Coach Brad", text="Swim four easy lengths.", **extra):
        return self.client.post("/api/coach-chat/speech", json={"coach": coach, "text": text, **extra})

    def test_webm_and_mp4_transcription(self):
        for content_type, extension in (("audio/webm;codecs=opus", "webm"), ("audio/mp4", "mp4")):
            with self.subTest(content_type=content_type):
                response = self.transcribe(content_type=content_type)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"text": "Give me a sprint set."})
                options = self.provider.audio.transcriptions.create.call_args.kwargs
                self.assertEqual(options["model"], "gpt-4o-mini-transcribe")
                self.assertEqual(options["file"], (f"dictation.{extension}", b"recorded-audio", content_type.split(";")[0]))

    def test_empty_unsupported_and_oversized_recordings(self):
        self.assertEqual(self.transcribe(content=b"").status_code, 400)
        self.assertEqual(self.transcribe(content_type="text/plain").status_code, 415)
        with patch("app.coach_audio.MAX_AUDIO_BYTES", 12):
            self.assertEqual(self.transcribe(content=b"x" * 13).status_code, 413)
            self.assertEqual(self.transcribe(content=b"x" * 12).status_code, 200)
        self.assertLess(MAX_AUDIO_BYTES, 25 * 1024 * 1024)

    def test_no_speech_is_reported(self):
        self.provider.audio.transcriptions.create.return_value = SimpleNamespace(text="  ")
        self.assertEqual(self.transcribe().status_code, 422)

    def test_each_coach_has_a_distinct_male_voice(self):
        self.assertEqual(len(COACH_VOICES), 5)
        self.assertEqual(len({voice for voice, _ in COACH_VOICES.values()}), 5)
        for coach, (voice, _) in COACH_VOICES.items():
            with self.subTest(coach=coach):
                response = self.speak(coach)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, b"\x01\x00\x02\x00\x03")
                self.assertEqual(response.headers["content-type"], "audio/mpeg")
                self.assertEqual(response.headers["cache-control"], "no-store")
                # The Listen button's MP3 comes from the streaming request too, so it can be hedged.
                options = self.provider.audio.speech.with_streaming_response.create.call_args.kwargs
                self.assertEqual(options["voice"], voice)
                self.assertEqual(options["model"], "gpt-4o-mini-tts")
                self.assertEqual(options["input"], "Swim four easy lengths.")
                self.assertIn("male", options["instructions"])
                self.assertEqual(options["response_format"], "mp3")

    def test_speech_text_limits(self):
        self.assertEqual(self.speak(text="x" * 3000).status_code, 200)
        for text in ("", "   ", "x" * 3001):
            with self.subTest(length=len(text)):
                self.assertEqual(self.speak(text=text).status_code, 422)

    def test_authentication_is_required_for_both_endpoints(self):
        self.auth_mock.side_effect = HTTPException(status_code=401, detail="Sign in.")
        self.assertEqual(self.transcribe().status_code, 401)
        self.assertEqual(self.speak().status_code, 401)
        self.openai_mock.assert_not_called()

    def test_only_assigned_coaches_can_use_audio(self):
        self.profile["recommended_coaches"] = ["Coach Pete"]
        self.assertEqual(self.transcribe().status_code, 403)
        self.assertEqual(self.speak().status_code, 403)
        self.assertEqual(self.speak("Unknown Coach").status_code, 400)
        self.openai_mock.assert_not_called()

    def test_provider_errors_are_actionable(self):
        self.provider.audio.transcriptions.create.side_effect = OpenAIError("provider failure")
        self.streamed = _Streamed(failure=OpenAIError("provider failure"))
        with self.assertLogs("app.coach_audio", level="ERROR"):
            transcription = self.transcribe()
            speech = self.speak()
        self.assertEqual(transcription.status_code, 502)
        self.assertEqual(speech.status_code, 502)
        self.assertIn("try again", transcription.json()["detail"])
        self.assertIn("try again", speech.json()["detail"])

    def test_missing_key_and_empty_audio_fail_explicitly(self):
        self.settings.openai_api_key = ""
        self.assertEqual(self.transcribe().status_code, 503)
        self.assertEqual(self.speak().status_code, 503)
        self.openai_mock.assert_not_called()
        self.settings.openai_api_key = "test-dummy"
        self.streamed = _Streamed(chunks=())
        with self.assertLogs("app.coach_audio", level="ERROR"):
            self.assertEqual(self.speak().status_code, 502)

    def test_a_voice_call_sends_wav(self):
        response = self.transcribe(content=b"RIFF-wav", content_type="audio/wav")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.provider.audio.transcriptions.create.call_args.kwargs["file"], ("dictation.wav", b"RIFF-wav", "audio/wav"))

    def test_a_voice_call_streams_its_speech_as_pcm(self):
        response = self.speak(text="Three weeks out, keep it sharp.", format="pcm")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], PCM_MEDIA_TYPE)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.content, b"\x01\x00\x02\x00\x03")
        options = self.provider.audio.speech.with_streaming_response.create.call_args.kwargs
        self.assertEqual((options["voice"], options["model"], options["input"], options["response_format"]),
                         ("onyx", "gpt-4o-mini-tts", "Three weeks out, keep it sharp.", "pcm"))
        self.assertIn("male", options["instructions"])
        self.assertTrue(self.streamed.closed)
        self.provider.audio.speech.create.assert_not_called()

    def test_streamed_speech_that_cannot_start_is_an_error(self):
        self.streamed = _Streamed(failure=OpenAIError("provider failure"))
        with self.assertLogs("app.coach_audio", level="ERROR"):
            response = self.speak(format="pcm")
        self.assertEqual(response.status_code, 502)
        self.assertIn("try again", response.json()["detail"])

    def test_speech_is_mp3_unless_pcm_is_asked_for(self):
        self.assertEqual(self.speak(format="mp3").headers["content-type"], "audio/mpeg")
        self.assertEqual(self.provider.audio.speech.with_streaming_response.create.call_args.kwargs["response_format"], "mp3")
        self.assertEqual(self.speak(format="ogg").status_code, 422)

    def test_a_sessions_coach_is_remembered_for_a_minute(self):
        headers = {"Authorization": "Bearer token-1"}
        for _ in range(3):
            self.assertEqual(self.client.post("/api/coach-chat/speech", headers=headers, json={"coach": "Coach Brad", "text": "Go."}).status_code, 200)
        self.assertEqual(self.auth_mock.call_count, 1)
        # Another session is looked up, and so is this one once the minute is up.
        self.client.post("/api/coach-chat/speech", headers={"Authorization": "Bearer token-2"}, json={"coach": "Coach Brad", "text": "Go."})
        self.assertEqual(self.auth_mock.call_count, 2)
        for key, (_, coaches) in list(coach_audio._assigned.items()):
            coach_audio._assigned[key] = (0.0, coaches)  # the minute is up
        self.client.post("/api/coach-chat/speech", headers=headers, json={"coach": "Coach Brad", "text": "Go."})
        self.assertEqual(self.auth_mock.call_count, 3)

    def test_a_remembered_session_still_only_gets_its_own_coach(self):
        self.profile["recommended_coaches"] = ["Coach Pete"]
        headers = {"Authorization": "Bearer token-1"}
        self.assertEqual(self.client.post("/api/coach-chat/speech", headers=headers, json={"coach": "Coach Pete", "text": "Go."}).status_code, 200)
        self.assertEqual(self.client.post("/api/coach-chat/speech", headers=headers, json={"coach": "Coach Brad", "text": "Go."}).status_code, 403)
        self.assertEqual(self.auth_mock.call_count, 1)

    def test_a_failed_sign_in_is_never_remembered(self):
        self.auth_mock.side_effect = HTTPException(status_code=401, detail="Sign in.")
        headers = {"Authorization": "Bearer expired"}
        for _ in range(2):
            self.assertEqual(self.client.post("/api/coach-chat/speech", headers=headers, json={"coach": "Coach Brad", "text": "Go."}).status_code, 401)
        self.assertEqual(self.auth_mock.call_count, 2)

    def test_the_openai_client_is_kept_between_requests(self):
        with TestClient(app) as client:
            for _ in range(3):
                client.post("/api/coach-chat/speech", json={"coach": "Coach Brad", "text": "Go."})
        self.assertEqual(self.openai_mock.call_count, 1)


class HedgedAudioTests(CoachAudioTests):
    """OpenAI's speech and transcription now and then stall: the same request is made again, and the first answer used."""

    def setUp(self):
        super().setUp()
        for name, value in [("SPEECH_AGAIN_AFTER", (0.05, 0.15)), ("SPEECH_LIMIT", 1.0), ("SPEECH_STALL", 0.2),
                            ("TRANSCRIPTION_AGAIN_AFTER", (0.05, 0.15)), ("TRANSCRIPTION_LIMIT", 1.0)]:
            patcher = patch.object(coach_audio, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def answers(self, *streams):
        """The speech requests answer, in turn, with these streams."""
        queue = list(streams)
        self.provider.audio.speech.with_streaming_response.create = MagicMock(side_effect=lambda **_: queue.pop(0))

    def test_a_speech_that_sends_no_audio_is_asked_for_again_and_the_quick_one_is_heard(self):
        stuck, quick = _Streamed(chunks=(b"\x09\x09",), hang_after=0), _Streamed()
        self.answers(stuck, quick)
        response = self.speak(format="pcm")
        self.assertEqual((response.status_code, response.content), (200, b"\x01\x00\x02\x00\x03"))
        self.assertEqual(self.provider.audio.speech.with_streaming_response.create.call_count, 2)
        self.assertTrue(quick.closed)

    def test_the_listen_buttons_speech_is_asked_for_again_too(self):
        self.answers(_Streamed(chunks=(b"\x09",), hang_after=0), _Streamed())
        response = self.speak()
        self.assertEqual((response.status_code, response.content), (200, b"\x01\x00\x02\x00\x03"))

    def test_a_speech_failing_at_once_is_asked_for_again_at_once(self):
        self.answers(_Streamed(failure=OpenAIError("busy")), _Streamed())
        response = self.speak(format="pcm")
        self.assertEqual((response.status_code, response.content), (200, b"\x01\x00\x02\x00\x03"))

    def test_speech_that_never_starts_is_an_error_in_the_end(self):
        self.answers(*[_Streamed(hang_after=0) for _ in range(3)])
        with self.assertLogs("app.coach_audio", level="ERROR"):
            response = self.speak(format="pcm")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.provider.audio.speech.with_streaming_response.create.call_count, 3)

    def test_the_third_try_uses_the_model_that_doesnt_stall_in_the_coachs_voice(self):
        self.answers(_Streamed(hang_after=0), _Streamed(hang_after=0), _Streamed())
        response = self.speak(format="pcm")
        self.assertEqual((response.status_code, response.content), (200, b"\x01\x00\x02\x00\x03"))
        calls = [call.kwargs for call in self.provider.audio.speech.with_streaming_response.create.call_args_list]
        self.assertEqual([call["model"] for call in calls], ["gpt-4o-mini-tts", "gpt-4o-mini-tts", "tts-1"])
        self.assertEqual({call["voice"] for call in calls}, {"onyx"})
        self.assertNotIn("instructions", calls[2])   # tts-1 takes none
        self.assertEqual(calls[2]["response_format"], "pcm")

    def test_a_voice_the_fallback_model_lacks_keeps_to_the_usual_model(self):
        self.answers(_Streamed(hang_after=0), _Streamed(hang_after=0), _Streamed())
        self.assertEqual(self.speak("Coach Tony", format="pcm").status_code, 200)
        calls = [call.kwargs for call in self.provider.audio.speech.with_streaming_response.create.call_args_list]
        self.assertEqual([(call["model"], call["voice"]) for call in calls], [("gpt-4o-mini-tts", "cedar")] * 3)

    def test_speech_that_stops_partway_ends_there_and_the_call_goes_on(self):
        stalls = _Streamed(chunks=(b"\x01\x00", b"\x02\x00", b"\x03\x00"), hang_after=2)
        self.answers(stalls)
        with self.assertLogs("app.coach_audio", level="WARNING"):
            response = self.speak(format="pcm")
        self.assertEqual((response.status_code, response.content), (200, b"\x01\x00\x02\x00"))
        self.assertTrue(stalls.closed)

    def test_a_listen_mp3_that_stops_partway_is_made_again_whole(self):
        self.answers(_Streamed(chunks=(b"a", b"b"), hang_after=1), _Streamed(chunks=(b"whole", b"-mp3")))
        response = self.speak()
        self.assertEqual((response.status_code, response.content), (200, b"whole-mp3"))

    def test_a_slow_transcription_is_asked_for_again_and_the_first_answer_used(self):
        calls = []

        async def transcription(**options):
            calls.append(options)
            if len(calls) == 1:
                await asyncio.Event().wait()
            return SimpleNamespace(text="Give me a kick set.")
        self.provider.audio.transcriptions.create = AsyncMock(side_effect=transcription)
        response = self.transcribe(content=b"RIFF-wav", content_type="audio/wav")
        self.assertEqual((response.status_code, response.json()), (200, {"text": "Give me a kick set."}))
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["file"], calls[1]["file"])


class HedgeTests(unittest.TestCase):
    """_hedged on its own."""

    @staticmethod
    def after(seconds, value=None, failure=None):
        async def attempt():
            await asyncio.sleep(seconds)
            if failure:
                raise failure
            return value
        return attempt

    def run_hedged(self, attempts, again_after=(0.05, 0.1), limit=0.5, close=None):
        made = []

        def start(number):
            made.append(number)
            return attempts[number]()
        return asyncio.run(coach_audio._hedged(start, again_after, limit, close)), made

    def test_a_quick_answer_needs_no_second_request(self):
        self.assertEqual(self.run_hedged([self.after(0.01, "first")]), ("first", [0]))

    def test_the_first_answer_wins_whoever_was_asked_first(self):
        self.assertEqual(self.run_hedged([self.after(0.4, "slow"), self.after(0.01, "quick")]), ("quick", [0, 1]))

    def test_every_failure_is_followed_by_another_request_until_none_are_left(self):
        with self.assertRaises(ValueError):
            self.run_hedged([self.after(0, failure=ValueError(n)) for n in range(3)])

    def test_no_answer_within_the_limit_is_a_timeout(self):
        with self.assertRaises(TimeoutError):
            self.run_hedged([self.after(5, "late") for _ in range(3)], limit=0.3)

    def test_an_answer_that_loses_the_race_is_closed(self):
        closed = []

        async def close(value):
            closed.append(value)

        async def scenario():
            answering = asyncio.Event()
            made = []

            async def attempt(name):
                await answering.wait()
                return name

            def start(number):
                made.append(number)
                if number == 1:  # once it's asked again, both answer at the same moment
                    asyncio.get_running_loop().call_later(0.01, answering.set)
                return attempt("ab"[number])
            return await coach_audio._hedged(start, (0.05,), 0.5, close)
        result = asyncio.run(scenario())
        self.assertIn(result, ("a", "b"))
        self.assertEqual(closed, ["b" if result == "a" else "a"])


if __name__ == "__main__":
    unittest.main()
