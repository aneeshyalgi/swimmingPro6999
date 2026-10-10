from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
import stripe

from app.main import app
from app.payments import WITH_PRODUCT

PERIOD_END = 1_762_646_400  # 2025-11-09T00:00:00Z
CHOSEN_DATE = 1_762_214_400  # 2025-11-04T00:00:00Z, a cancellation date picked in the Stripe dashboard
PRODUCT = {"id": "prod_1", "object": "product", "name": "Performance Build"}
PROFILE = {"id": "row-1", "user_key": "profile-1", "is_paid": True, "payment_plan_id": "performance-build",
           "stripe_subscription_id": "sub_1"}


def subscription(status="active", cancel_at_period_end=False, cancel_at=None, product=PRODUCT):
    return stripe.Subscription.construct_from({
        "id": "sub_1", "status": status, "cancel_at_period_end": cancel_at_period_end, "cancel_at": cancel_at,
        "items": {"data": [{"current_period_end": PERIOD_END,
                            "price": {"unit_amount": 1400, "currency": "usd", "recurring": {"interval": "month"},
                                      "product": product}}]},
    }, "sk_test_dummy")


@patch("app.payments.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy"))
@patch("app.payments.stripe.Subscription.modify")
@patch("app.payments.stripe.Subscription.retrieve")
class SubscriptionBillingTests(unittest.TestCase):
    """Cancelling stops renewal at the end of the paid month: no refund, and access lasts until then."""

    def setUp(self):
        self.client = TestClient(app)
        self.profile = dict(PROFILE)
        patcher = patch("app.main.get_authenticated_profile", side_effect=lambda authorization: self.profile)
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, method, path):
        response = getattr(self.client, method)(path, headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_billing_shows_price_and_renewal(self, retrieve, modify, settings):
        retrieve.return_value = subscription()
        self.assertEqual(self.call("get", "/api/subscription/billing"), {
            "manageable": True, "status": "active", "cancel_at_period_end": False,
            "period_end": "2025-11-09T00:00:00+00:00", "plan_name": "Performance Build",
            "amount": 1400, "currency": "usd", "interval": "month",
        })
        retrieve.assert_called_once_with("sub_1", expand=WITH_PRODUCT)
        modify.assert_not_called()

    def test_plan_is_named_as_stripe_bills_it(self, retrieve, modify, settings):
        # A subscription carried over from an older plan shows that plan, as it does in the Stripe dashboard.
        retrieve.return_value = subscription(product={**PRODUCT, "name": "Swim Foundation"})
        self.assertEqual(self.call("get", "/api/subscription/billing")["plan_name"], "Swim Foundation")
        retrieve.return_value = subscription(product="prod_1")  # not expanded: the app's own name for the plan
        self.assertEqual(self.call("get", "/api/subscription/billing")["plan_name"], "Performance Build")

    def test_cancel_runs_to_the_end_of_the_paid_month(self, retrieve, modify, settings):
        retrieve.return_value = subscription()
        modify.return_value = subscription(cancel_at_period_end=True, cancel_at=PERIOD_END)
        billing = self.call("post", "/api/subscription/cancel")
        # Only renewal is switched off: the subscription is not deleted, refunded or ended early.
        modify.assert_called_once_with("sub_1", cancel_at_period_end=True, expand=WITH_PRODUCT)
        self.assertEqual((billing["cancel_at_period_end"], billing["status"], billing["period_end"]),
                         (True, "active", "2025-11-09T00:00:00+00:00"))

    def test_resume_undoes_a_cancellation(self, retrieve, modify, settings):
        retrieve.return_value = subscription(cancel_at_period_end=True, cancel_at=PERIOD_END)
        modify.return_value = subscription()
        self.assertFalse(self.call("post", "/api/subscription/resume")["cancel_at_period_end"])
        modify.assert_called_once_with("sub_1", cancel_at_period_end=False, expand=WITH_PRODUCT)

    def test_repeating_a_change_sends_nothing_to_stripe(self, retrieve, modify, settings):
        retrieve.return_value = subscription(cancel_at_period_end=True, cancel_at=PERIOD_END)
        self.assertTrue(self.call("post", "/api/subscription/cancel")["cancel_at_period_end"])
        retrieve.return_value = subscription()
        self.assertFalse(self.call("post", "/api/subscription/resume")["cancel_at_period_end"])
        modify.assert_not_called()

    def test_a_cancellation_dated_in_the_stripe_dashboard_shows_and_can_be_undone(self, retrieve, modify, settings):
        retrieve.return_value = subscription(cancel_at=CHOSEN_DATE)
        billing = self.call("get", "/api/subscription/billing")
        self.assertEqual((billing["cancel_at_period_end"], billing["period_end"]), (True, "2025-11-04T00:00:00+00:00"))
        modify.return_value = subscription()
        self.assertFalse(self.call("post", "/api/subscription/resume")["cancel_at_period_end"])
        modify.assert_called_once_with("sub_1", cancel_at="", expand=WITH_PRODUCT)

    def test_profile_without_a_stripe_subscription_has_nothing_to_manage(self, retrieve, modify, settings):
        self.profile.pop("stripe_subscription_id")
        self.assertEqual(self.call("post", "/api/subscription/cancel"), {"manageable": False})
        retrieve.assert_not_called()
        modify.assert_not_called()

    def test_stripe_failure_is_reported_not_crashed(self, retrieve, modify, settings):
        retrieve.return_value = subscription()
        for failing in (modify, retrieve):
            with self.subTest(failing=failing):
                failing.side_effect = stripe.error.APIConnectionError("Stripe is down")
                response = self.client.post("/api/subscription/cancel", headers={"Authorization": "Bearer token"})
                self.assertEqual(response.status_code, 502)
                self.assertIn("try again", response.json()["detail"])

    def test_only_paying_athletes_can_manage_a_subscription(self, retrieve, modify, settings):
        def unpaid(authorization):
            raise HTTPException(status_code=402, detail="Activate your coaching plan to open your dashboard.")
        with patch("app.main.get_authenticated_profile", side_effect=unpaid):
            for method, path in (("get", "/api/subscription/billing"), ("post", "/api/subscription/cancel")):
                self.assertEqual(getattr(self.client, method)(path, headers={"Authorization": "Bearer token"}).status_code, 402)
        modify.assert_not_called()


if __name__ == "__main__":
    unittest.main()
