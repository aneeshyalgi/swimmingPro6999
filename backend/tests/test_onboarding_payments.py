from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import PAYMENT_PLANS, app


class OnboardingPaymentTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.settings_patch = patch(
            "app.main.settings",
            SimpleNamespace(stripe_secret_key="sk_test_dummy", frontend_url="http://localhost:3000"),
        )
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.payload = {
            "auth_user_id": "user-1",
            "user_key": "profile-1",
            "plan_id": "performance-build",
        }

    @patch("app.main.stripe.checkout.Session.create")
    def test_only_plan_checks_out_at_fourteen_dollars_monthly(self, create):
        self.assertEqual(list(PAYMENT_PLANS), ["performance-build"])
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/test", id="cs_test_1")
        response = self.client.post("/api/payments/checkout", json={**self.payload, "amount": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "checkout_url": create.return_value.url, "session_id": "cs_test_1",
        })
        options = create.call_args.kwargs
        self.assertEqual(options["mode"], "subscription")
        self.assertEqual(options["managed_payments"], {"enabled": False})
        price = options["line_items"][0]["price_data"]
        self.assertEqual(price["unit_amount"], 1400)
        self.assertEqual(price["currency"], "usd")
        self.assertEqual(price["recurring"], {"interval": "month"})
        self.assertEqual(options["line_items"][0]["quantity"], 1)
        self.assertEqual(options["metadata"], self.payload)
        self.assertEqual(options["client_reference_id"], "user-1")
        self.assertEqual(options["success_url"], "http://localhost:3000/payment/success?session_id={CHECKOUT_SESSION_ID}")
        self.assertEqual(options["cancel_url"], "http://localhost:3000/onboarding?payment=cancelled")

    @patch("app.main.stripe.checkout.Session.create")
    def test_removed_and_unknown_plans_cannot_start_checkout(self, create):
        for plan_id in ("swim-foundation", "championship", "unknown"):
            with self.subTest(plan_id=plan_id):
                response = self.client.post("/api/payments/checkout", json={**self.payload, "plan_id": plan_id})
                self.assertEqual(response.status_code, 400)
        create.assert_not_called()

    @patch("app.main.stripe.checkout.Session.create")
    def test_missing_checkout_url_is_an_error(self, create):
        create.return_value = SimpleNamespace(url=None, id="cs_test_1")
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 502)

    @patch("app.main.get_supabase_client")
    @patch("app.main.stripe.checkout.Session.retrieve")
    def test_paid_current_and_legacy_sessions_activate_profile(self, retrieve, get_supabase):
        for plan_id in ("performance-build", "swim-foundation", "championship"):
            with self.subTest(plan_id=plan_id):
                supabase = MagicMock()
                get_supabase.return_value = supabase
                retrieve.return_value = SimpleNamespace(
                    metadata={**self.payload, "plan_id": plan_id},
                    payment_status="paid", id="cs_test_1",
                    customer="cus_test_1", subscription="sub_test_1",
                )
                response = self.client.get("/api/payments/verify/cs_test_1")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"paid": True, "plan_id": plan_id, "user_key": "profile-1"})
                supabase.table.assert_called_once_with("user_profiles")
                supabase.table.return_value.update.assert_called_once_with({
                    "payment_status": "paid", "payment_plan_id": plan_id,
                    "stripe_checkout_session_id": "cs_test_1",
                    "stripe_customer_id": "cus_test_1", "stripe_subscription_id": "sub_test_1",
                })
                update = supabase.table.return_value.update.return_value
                update.eq.assert_called_once_with("user_key", "profile-1")
                update.eq.return_value.eq.assert_called_once_with("auth_user_id", "user-1")
                update.eq.return_value.eq.return_value.execute.assert_called_once()

    @patch("app.main.get_supabase_client")
    @patch("app.main.stripe.checkout.Session.retrieve")
    def test_unpaid_invalid_or_incomplete_sessions_do_not_activate(self, retrieve, get_supabase):
        cases = [
            ("unpaid", self.payload),
            ("paid", {**self.payload, "plan_id": "unknown"}),
            ("paid", {"plan_id": "performance-build"}),
        ]
        for payment_status, metadata in cases:
            with self.subTest(payment_status=payment_status, metadata=metadata):
                retrieve.return_value = SimpleNamespace(metadata=metadata, payment_status=payment_status)
                response = self.client.get("/api/payments/verify/cs_test_1")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["paid"])
        get_supabase.assert_not_called()


if __name__ == "__main__":
    unittest.main()
