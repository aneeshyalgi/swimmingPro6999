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
    """What the OpenAI client's streaming speech request gives: a context manager around a response read in chunks."""

    def __init__(self, chunks=(b"\x01\x00", b"\x02\x00\x03"), failure=None):
        self.chunks, self.failure, self.closed = chunks, failure, False

    async def __aenter__(self):
        if self.failure:
            raise self.failure
        return self

    async def __aexit__(self, *exc):
        self.closed = True
        return False

    async def iter_bytes(self):
        for chunk in self.chunks:
            yield chunk


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
                self.assertEqual(response.content, b"mp3-audio")
                self.assertEqual(response.headers["content-type"], "audio/mpeg")
                self.assertEqual(response.headers["cache-control"], "no-store")
                options = self.provider.audio.speech.create.call_args.kwargs
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
        self.provider.audio.speech.create.side_effect = OpenAIError("provider failure")
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
        self.provider.audio.speech.create.return_value = SimpleNamespace(content=b"")
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
        self.assertEqual(self.speak(format="ogg").status_code, 422)
        self.provider.audio.speech.with_streaming_response.create.assert_not_called()

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


if __name__ == "__main__":
    unittest.main()
