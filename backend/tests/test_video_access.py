from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from storage3.exceptions import StorageApiError

from app import video_access
from app.main import app
from app.video_access import FREE_RECOGNITIONS_PER_HOUR, Visitor, claim, client_ip

VISITOR = "6f1c2a9e-3b7d-4c55-9a10-2d8e4f6b7c01"
OTHER_VISITOR = "0b9d8c7a-6e5f-4a3b-8c2d-1e0f9a8b7c6d"
STILL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=="


class FakeBucket:
    """The Storage bucket in memory, with its rule that creating an object that exists fails (unless upserting)."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.down = False

    def _check(self):
        if self.down:
            raise StorageApiError("Storage is unavailable", "InternalError", "500")

    def upload(self, path, data, options):
        self._check()
        if path in self.objects and options.get("upsert") != "true":
            raise StorageApiError("The resource already exists", "Duplicate", "409")
        self.objects[path] = data

    def download(self, path):
        self._check()
        if path not in self.objects:
            raise StorageApiError("Object not found", "not_found", "404")
        return self.objects[path]

    def remove(self, paths):
        self._check()
        for path in paths:
            self.objects.pop(path, None)

    def kinds(self):
        return sorted(path.split("/")[0] for path in self.objects)


class VideoAccessTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.bucket = FakeBucket()
        self.user = SimpleNamespace(id="user-1")
        self.profile = {"id": "row-1", "auth_user_id": "user-1"}
        self.paid = False
        video_access._recognitions.clear()
        for target, options in [
            ("app.video_access._files", {"return_value": self.bucket}),
            ("app.video_access.get_settings", {"return_value": SimpleNamespace(trusted_proxy_hops=1, supabase_secret_key="test-secret")}),
            ("app.video_access.get_authenticated_user", {"side_effect": lambda authorization: self.user}),
            ("app.video_access.latest_profile_row", {"side_effect": lambda user_id: self.profile}),
            ("app.video_access.is_paid", {"side_effect": lambda row: self.paid}),
            # As deployed: behind a hosting platform's proxy, which reports each caller's address in X-Forwarded-For.
            ("app.video_access._through_proxy", {"return_value": True}),
            ("app.main.settings", {"new": SimpleNamespace(openai_api_key="test-openai")}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)
        brief = patch("app.main._coach_brief", return_value={"headline": "Catch earlier"})
        self.brief = brief.start()
        self.addCleanup(brief.stop)

    def headers(self, visitor=VISITOR, network="198.51.100.7", browser="Chrome", signed_in=False, **extra):
        headers = {"User-Agent": browser, "X-Forwarded-For": network, **extra}
        if visitor:
            headers["X-Visitor-Id"] = visitor
        if signed_in:
            headers["Authorization"] = "Bearer token"
        return headers

    def access(self, **who):
        response = self.client.get("/api/video-analysis/access", headers=self.headers(**who))
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access"]

    def analyse(self, **who):
        return self.client.post("/api/video-analysis", json={"stroke": "Freestyle"}, headers=self.headers(**who))


class FreeAnalysisTests(VideoAccessTestCase):
    def test_a_visitor_gets_one_free_analysis_then_is_asked_to_sign_up(self):
        self.assertEqual(self.access(), "free")
        response = self.analyse()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"headline": "Catch earlier"})
        self.assertEqual(self.bucket.kinds(), ["browser", "network"])
        self.assertEqual(self.access(), "signup_required")
        again = self.analyse()
        self.assertEqual(again.status_code, 402)
        self.assertEqual(again.json()["detail"]["code"], "signup_required")
        self.brief.assert_called_once()

    def test_a_private_window_a_cleared_browser_or_a_direct_api_call_gets_no_second_one(self):
        self.assertEqual(self.analyse().status_code, 200)
        self.assertEqual(self.analyse(visitor=OTHER_VISITOR).status_code, 402)  # same network and browser, new visitor id
        self.assertEqual(self.analyse(visitor=None).status_code, 402)  # no visitor id at all
        self.assertEqual(self.analyse(visitor="not-a-uuid").status_code, 402)
        self.brief.assert_called_once()

    def test_the_network_address_cannot_be_faked(self):
        self.assertEqual(self.analyse().status_code, 200)
        # A made-up address in front of the one the proxy saw changes nothing.
        spoofed = self.analyse(visitor=OTHER_VISITOR, network="203.0.113.50, 198.51.100.7")
        self.assertEqual(spoofed.status_code, 402)

    def test_someone_else_on_another_network_and_browser_gets_their_own(self):
        self.assertEqual(self.analyse().status_code, 200)
        self.assertEqual(self.analyse(visitor=OTHER_VISITOR, network="203.0.113.9").status_code, 200)
        self.assertEqual(self.brief.call_count, 2)

    def test_a_network_is_remembered_for_thirty_days(self):
        self.assertEqual(self.analyse().status_code, 200)
        network = next(path for path in self.bucket.objects if path.startswith("network/"))
        long_ago = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        self.bucket.objects[network] = json.dumps({"used_at": long_ago}).encode()
        # A new browser on that network a month later gets one; the original browser never does.
        self.assertEqual(self.analyse().status_code, 402)
        self.assertEqual(self.analyse(visitor=OTHER_VISITOR).status_code, 200)
        self.assertNotEqual(json.loads(self.bucket.objects[network])["used_at"], long_ago)

    def test_signing_up_does_not_give_another_free_analysis(self):
        self.assertEqual(self.analyse().status_code, 200)
        self.assertEqual(self.access(signed_in=True), "subscription_required")
        response = self.analyse(signed_in=True)
        self.assertEqual((response.status_code, response.json()["detail"]["code"]), (402, "subscription_required"))

    def test_an_account_without_a_subscription_gets_one_then_needs_to_subscribe(self):
        self.assertEqual(self.access(signed_in=True), "free")
        self.assertEqual(self.analyse(signed_in=True).status_code, 200)
        self.assertEqual(self.bucket.kinds(), ["account", "browser", "network"])
        # Not even from another device on another network.
        elsewhere = self.analyse(signed_in=True, visitor=OTHER_VISITOR, network="203.0.113.9", browser="Safari")
        self.assertEqual((elsewhere.status_code, elsewhere.json()["detail"]["code"]), (402, "subscription_required"))

    def test_subscribers_analyse_without_limit(self):
        self.paid = True
        self.assertEqual(self.analyse().status_code, 200)  # signed out: their free one
        self.assertEqual(self.access(signed_in=True), "subscribed")
        for _ in range(3):
            self.assertEqual(self.analyse(signed_in=True).status_code, 200)
        self.assertEqual(self.brief.call_count, 4)
        self.assertEqual(self.bucket.kinds(), ["browser", "network"])  # nothing recorded for a subscriber

    def test_an_account_without_a_profile_is_not_subscribed(self):
        self.profile = None
        self.assertEqual(self.access(signed_in=True), "free")

    def test_a_failed_analysis_gives_the_free_one_back(self):
        self.brief.side_effect = HTTPException(status_code=502, detail="OpenAI returned an empty video analysis.")
        self.assertEqual(self.analyse().status_code, 502)
        self.assertEqual(self.bucket.objects, {})
        self.assertEqual(self.access(), "free")
        self.brief.side_effect = RuntimeError("connection reset")
        self.assertEqual(TestClient(app, raise_server_exceptions=False).post(
            "/api/video-analysis", json={}, headers=self.headers()).status_code, 500)
        self.assertEqual(self.access(), "free")

    def test_two_requests_at_once_cannot_both_have_it(self):
        records = {"browser": f"browser/{VISITOR}", "network": "network/abc"}
        first, second = Visitor(False, False, dict(records)), Visitor(False, False, dict(records))
        self.assertEqual(claim(first), [f"browser/{VISITOR}", "network/abc"])
        self.assertIsNone(claim(second))
        # A second browser on the same network loses too, and its own record is taken back.
        other = Visitor(False, False, {"browser": f"browser/{OTHER_VISITOR}", "network": "network/abc"})
        self.assertIsNone(claim(other))
        self.assertNotIn(f"browser/{OTHER_VISITOR}", self.bucket.objects)

    def test_records_that_cannot_be_read_mean_no_free_analysis(self):
        self.bucket.down = True
        with self.assertLogs("app.video_access", "ERROR"):
            self.assertEqual(self.client.get("/api/video-analysis/access", headers=self.headers()).status_code, 503)
            self.assertEqual(self.analyse().status_code, 503)
        self.brief.assert_not_called()
        self.paid = True  # subscribers don't depend on them
        self.assertEqual(self.analyse(signed_in=True).status_code, 200)

    def test_a_browser_that_remembers_using_it_is_believed(self):
        self.assertEqual(self.access(**{"X-Free-Analysis-Used": "1"}), "signup_required")
        self.assertEqual(self.analyse(**{"X-Free-Analysis-Used": "1"}).status_code, 402)

    def test_an_expired_session_is_refused_not_treated_as_signed_out(self):
        def expired(authorization):
            raise HTTPException(status_code=401, detail="Your session is invalid or expired.")
        with patch("app.video_access.get_authenticated_user", side_effect=expired):
            self.assertEqual(self.analyse(signed_in=True).status_code, 401)
        self.assertEqual(self.bucket.objects, {})


def answer():
    content = json.dumps({"stroke": "Backstroke", "confidence": 90, "reason": "Chest up"})
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class StrokeRecognitionAccessTests(VideoAccessTestCase):
    def setUp(self):
        super().setUp()
        self.provider = MagicMock()
        self.provider.chat.completions.create.return_value = answer()
        for target, options in [
            ("app.stroke_detection.OpenAI", {"return_value": self.provider}),
            ("app.stroke_detection.get_settings", {"return_value": SimpleNamespace(openai_api_key="test-openai", openai_vision_model="gpt-5.5")}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def recognise(self, **who):
        body = {"frames": [{"time": 0.5, "image": STILL}], "duration_seconds": 4}
        return self.client.post("/api/video-analysis/stroke", json=body, headers=self.headers(**who))

    def test_recognition_stops_once_the_free_analysis_is_used(self):
        self.assertEqual(self.recognise().status_code, 200)
        self.assertEqual(self.analyse().status_code, 200)
        blocked = self.recognise(visitor=OTHER_VISITOR)
        self.assertEqual((blocked.status_code, blocked.json()["detail"]["code"]), (402, "signup_required"))
        self.assertEqual(self.provider.chat.completions.create.call_count, 2)  # the one recognition, asked twice
        self.assertEqual(self.bucket.kinds(), ["browser", "network"])  # recognising never uses the free analysis

    def test_free_recognitions_are_capped_per_hour(self):
        for _ in range(FREE_RECOGNITIONS_PER_HOUR):
            self.assertEqual(self.recognise(visitor=None).status_code, 200)
        self.assertEqual(self.recognise(visitor=OTHER_VISITOR).status_code, 429)
        self.assertEqual(self.recognise(network="203.0.113.9").status_code, 200)  # another network has its own

    def test_subscribers_recognise_without_limit(self):
        self.paid = True
        for _ in range(FREE_RECOGNITIONS_PER_HOUR + 2):
            self.assertEqual(self.recognise(signed_in=True).status_code, 200)


class ClientIpTests(unittest.TestCase):
    def ip(self, hops, forwarded=None, peer="10.0.0.2"):
        request = SimpleNamespace(headers={"x-forwarded-for": forwarded} if forwarded else {}, client=SimpleNamespace(host=peer))
        with patch("app.video_access.get_settings", return_value=SimpleNamespace(trusted_proxy_hops=hops)):
            return client_ip(request)

    def test_the_address_the_trusted_proxy_saw_is_used(self):
        self.assertEqual(self.ip(1, "203.0.113.50, 198.51.100.7"), "198.51.100.7")
        self.assertEqual(self.ip(2, "203.0.113.50, 198.51.100.7, 10.1.1.1"), "198.51.100.7")
        self.assertEqual(self.ip(1, "198.51.100.7", peer="100.64.3.2"), "198.51.100.7")  # a platform's shared range

    def test_without_a_proxy_the_header_is_ignored(self):
        self.assertEqual(self.ip(0, "203.0.113.50"), "10.0.0.2")
        self.assertEqual(self.ip(1), "10.0.0.2")  # local development: no header at all
        self.assertEqual(self.ip(2, "198.51.100.7"), "10.0.0.2")  # fewer entries than proxies: not from them
        # Someone on the internet reaching the API directly could have written the header themselves.
        self.assertEqual(self.ip(1, "198.51.100.7", peer="8.8.4.4"), "8.8.4.4")
        self.assertEqual(self.ip(1, "198.51.100.7", peer="testclient"), "testclient")


if __name__ == "__main__":
    unittest.main()
