import json
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from openai import OpenAIError

from app.main import app
from app.stroke_detection import (
    MAX_FRAMES, SPLIT_CONFIDENCE, UNSEEN_CONFIDENCE, PoseEvidence, StrokeDetectionResponse, combine, evidence_text,
    model_options, normalize_stroke, parse_detection,
)

STILL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="


def answer(stroke, confidence, reason="Seen in the frames"):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"stroke": stroke, "confidence": confidence, "reason": reason})))])


class StrokeDetectionEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.settings = SimpleNamespace(openai_api_key="test-dummy", openai_vision_model="gpt-5.5")
        self.provider = MagicMock()
        self.provider.chat.completions.create.return_value = answer("Backstroke", 90, "Chest up with alternating arms")
        patches = [
            patch("app.stroke_detection.get_settings", return_value=self.settings),
            patch("app.stroke_detection.OpenAI", return_value=self.provider),
            # Who may recognise is covered in test_video_access.py; here everyone may.
            patch("app.stroke_detection.identify", return_value=SimpleNamespace(subscribed=True)),
            patch("app.stroke_detection.allow_recognition"),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def detect(self, **body):
        payload = {"frames": [{"time": 0.5, "image": STILL}, {"time": 1.5, "image": STILL}], "duration_seconds": 8.2, **body}
        return self.client.post("/api/video-analysis/stroke", json=payload)

    def test_names_the_stroke_from_the_frames_and_evidence(self):
        evidence = {"frames": 14, "chest_up": 13, "chest_down": 1, "knees_bending_up": 14, "knees_bending_down": 1, "both_knees_bent": 0}
        response = self.detect(evidence=evidence)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"stroke": "Backstroke", "confidence": 90, "reason": "Chest up with alternating arms", "alternative": None})
        # Asked twice, each time with every frame as a low-detail image and the measurements in words.
        self.assertEqual(self.provider.chat.completions.create.call_count, 2)
        call = self.provider.chat.completions.create.call_args.kwargs
        self.assertEqual(call["model"], "gpt-5.5")
        self.assertEqual(call["reasoning_effort"], "low")
        self.assertNotIn("temperature", call)
        self.assertEqual(call["response_format"]["type"], "json_schema")
        content = call["messages"][1]["content"]
        images = [part for part in content if part["type"] == "image_url"]
        self.assertEqual(len(images), 2)
        self.assertTrue(all(part["image_url"] == {"url": STILL, "detail": "low"} for part in images))
        self.assertIn("Chest facing up in 13 frames, down in 1.", content[0]["text"])
        self.assertIn("Both knees deeply bent at once in 0 frames.", content[0]["text"])
        self.assertIn("8.2 seconds", content[0]["text"])

    def test_two_different_strokes_make_a_best_guess_with_the_other_as_alternative(self):
        self.provider.chat.completions.create.side_effect = [answer("Butterfly", 86), answer("Breaststroke", 80)]

        body = self.detect().json()

        self.assertEqual(body["stroke"], "Butterfly")
        self.assertEqual(body["alternative"], "Breaststroke")
        self.assertEqual(body["confidence"], SPLIT_CONFIDENCE)

    def test_no_swimming_seen_returns_null(self):
        self.provider.chat.completions.create.return_value = answer(None, 0, "Only an interview")

        self.assertEqual(self.detect().json(), {"stroke": None, "confidence": 0, "reason": "Only an interview", "alternative": None})

    def test_rejects_frames_that_are_not_images(self):
        response = self.client.post("/api/video-analysis/stroke", json={"frames": [{"time": 0, "image": "https://example.com/frame.jpg"}]})
        self.assertEqual(response.status_code, 422)
        self.provider.chat.completions.create.assert_not_called()

    def test_rejects_too_many_or_no_frames(self):
        too_many = [{"time": index, "image": STILL} for index in range(MAX_FRAMES + 1)]
        self.assertEqual(self.client.post("/api/video-analysis/stroke", json={"frames": too_many}).status_code, 422)
        self.assertEqual(self.client.post("/api/video-analysis/stroke", json={"frames": []}).status_code, 422)
        self.provider.chat.completions.create.assert_not_called()

    def test_provider_failure_is_a_bad_gateway(self):
        self.provider.chat.completions.create.side_effect = OpenAIError("provider failure")
        response = self.detect()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "Stroke recognition is unavailable right now.")

    def test_unreadable_answer_is_a_bad_gateway(self):
        self.provider.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="not json"))])
        self.assertEqual(self.detect().status_code, 502)

    def test_missing_api_key_is_unavailable(self):
        self.settings.openai_api_key = ""
        self.assertEqual(self.detect().status_code, 503)
        self.provider.chat.completions.create.assert_not_called()


class StrokeDetectionHelperTests(unittest.TestCase):
    def test_strokes_are_mapped_onto_the_six_options(self):
        self.assertEqual(normalize_stroke("Front crawl"), "Freestyle")
        self.assertEqual(normalize_stroke(" fly "), "Butterfly")
        self.assertEqual(normalize_stroke("Individual Medley"), "IM")
        self.assertEqual(normalize_stroke("Backstroke"), "Backstroke")
        self.assertIsNone(normalize_stroke("Sidestroke"))
        self.assertIsNone(normalize_stroke(None))

    def test_answers_are_validated_and_clamped(self):
        parsed = parse_detection(json.dumps({"stroke": "breast", "confidence": 140, "reason": "  Frog   kick  "}))
        self.assertEqual((parsed.stroke, parsed.confidence, parsed.reason), ("Breaststroke", 100, "Frog kick"))
        unknown = parse_detection(json.dumps({"stroke": "Sidestroke", "confidence": 90, "reason": "?"}))
        self.assertEqual((unknown.stroke, unknown.confidence), (None, 0))

    def test_combining_two_answers(self):
        backstroke = StrokeDetectionResponse(stroke="Backstroke", confidence=90, reason="Chest up")
        agreed = combine([backstroke, backstroke.model_copy(update={"confidence": 80})])
        self.assertEqual((agreed.stroke, agreed.confidence, agreed.alternative), ("Backstroke", 85, None))

        unseen = StrokeDetectionResponse(stroke=None, confidence=0, reason="No swimmer")
        offered = combine([unseen, backstroke])
        self.assertEqual((offered.stroke, offered.confidence, offered.alternative), ("Backstroke", UNSEEN_CONFIDENCE, None))
        self.assertIsNone(combine([unseen, unseen]).stroke)

    def test_evidence_is_described_only_when_there_is_enough(self):
        self.assertEqual(evidence_text(None), "")
        thin = PoseEvidence(frames=1, chest_up=0, chest_down=1, knees_bending_up=0, knees_bending_down=0)
        self.assertIn("too few frames", evidence_text(thin))
        full = evidence_text(PoseEvidence(frames=18, chest_up=0, chest_down=18, knees_bending_up=0, knees_bending_down=11, both_knees_bent=4))
        self.assertIn("in 18 frames", full)
        self.assertIn("Both knees deeply bent at once in 4 frames.", full)

    def test_reasoning_models_get_an_effort_and_others_a_temperature(self):
        self.assertEqual(model_options("gpt-5.5"), {"reasoning_effort": "low"})
        self.assertEqual(model_options("o4-mini"), {"reasoning_effort": "low"})
        self.assertEqual(model_options("gpt-4.1"), {"temperature": 0})


if __name__ == "__main__":
    unittest.main()
