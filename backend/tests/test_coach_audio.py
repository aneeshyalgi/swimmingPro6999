from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from openai import OpenAIError

from app.coach_audio import COACH_VOICES, MAX_AUDIO_BYTES
from app.main import app


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
        manager = MagicMock()
        manager.__aenter__ = AsyncMock(return_value=self.provider)
        manager.__aexit__ = AsyncMock(return_value=False)
        patches = [
            patch("app.coach_audio.get_settings", return_value=self.settings),
            patch("app.coach_audio.get_authenticated_profile", return_value=self.profile),
            patch("app.coach_audio.AsyncOpenAI", return_value=manager),
        ]
        self.settings_mock, self.auth_mock, self.openai_mock = [item.start() for item in patches]
        for item in patches:
            self.addCleanup(item.stop)

    def transcribe(self, content=b"recorded-audio", content_type="audio/webm;codecs=opus"):
        return self.client.post(
            "/api/coach-chat/transcribe?coach=Coach%20Brad",
            content=content,
            headers={"Content-Type": content_type},
        )

    def speak(self, coach="Coach Brad", text="Swim four easy lengths."):
        return self.client.post("/api/coach-chat/speech", json={"coach": coach, "text": text})

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


if __name__ == "__main__":
    unittest.main()
