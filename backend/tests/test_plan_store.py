from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.plan_store import CATALOG, CATEGORIES


def fake_settings():
    return SimpleNamespace(stripe_secret_key="sk_test_dummy", frontend_url="http://localhost:3000")


class PlanStoreTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_catalog_is_well_formed(self):
        ids = [plan["id"] for plan in CATALOG]
        self.assertEqual(len(ids), len(set(ids)))
        for plan in CATALOG:
            self.assertIn(plan["category"], CATEGORIES)
            self.assertGreater(plan["price"], 0)
            self.assertTrue(plan["includes"] and plan["sample_week"])
        body = self.client.get("/api/plans/catalog").json()
        self.assertEqual(len(body["plans"]), len(CATALOG))
        self.assertEqual(body["plans"][0]["currency"], "usd")

    @patch("app.plan_store.get_settings", fake_settings)
    @patch("app.plan_store.stripe.checkout.Session.create")
    def test_guest_checkout_uses_server_price(self, create):
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/x", id="cs_test_1")
        plan = CATALOG[0]
        response = self.client.post("/api/plans/checkout", json={"plan_id": plan["id"], "price": 1})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["checkout_url"], "https://checkout.stripe.com/c/pay/x")
        options = create.call_args.kwargs
        self.assertEqual(options["mode"], "payment")
        self.assertEqual(options["managed_payments"], {"enabled": False})
        self.assertEqual(options["line_items"][0]["price_data"]["unit_amount"], plan["price"])
        self.assertEqual(options["metadata"], {"kind": "pdf_plan", "plan_id": plan["id"], "auth_user_id": ""})
        self.assertIn("/training-plans/success?session_id={CHECKOUT_SESSION_ID}", options["success_url"])
        self.assertNotIn("customer_email", options)

    @patch("app.plan_store.get_settings", fake_settings)
    @patch("app.plan_store.stripe.checkout.Session.create")
    @patch("app.plan_store.get_authenticated_user")
    def test_signed_in_checkout_links_account(self, get_user, create):
        get_user.return_value = SimpleNamespace(id="user-1", email="swimmer@example.com")
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/y", id="cs_test_2")
        response = self.client.post("/api/plans/checkout", json={"plan_id": CATALOG[1]["id"]}, headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 200)
        options = create.call_args.kwargs
        self.assertEqual(options["client_reference_id"], "user-1")
        self.assertEqual(options["customer_email"], "swimmer@example.com")
        self.assertEqual(options["metadata"]["auth_user_id"], "user-1")

    @patch("app.plan_store.get_settings", fake_settings)
    @patch("app.plan_store.stripe.checkout.Session.create")
    @patch("app.plan_store.get_authenticated_user", side_effect=HTTPException(status_code=401))
    def test_expired_token_falls_back_to_guest(self, _get_user, create):
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/z", id="cs_test_3")
        response = self.client.post("/api/plans/checkout", json={"plan_id": CATALOG[0]["id"]}, headers={"Authorization": "Bearer stale"})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("client_reference_id", create.call_args.kwargs)

    @patch("app.plan_store.get_settings", fake_settings)
    @patch("app.plan_store.stripe.checkout.Session.create")
    def test_unknown_plan_is_rejected(self, create):
        response = self.client.post("/api/plans/checkout", json={"plan_id": "free-plan"})
        self.assertEqual(response.status_code, 404)
        create.assert_not_called()

    @patch("app.plan_store.get_settings", fake_settings)
    @patch("app.plan_store.stripe.checkout.Session.retrieve")
    def test_verify(self, retrieve):
        plan = CATALOG[2]
        retrieve.return_value = SimpleNamespace(metadata={"kind": "pdf_plan", "plan_id": plan["id"]}, payment_status="paid",
                                                customer_details=SimpleNamespace(email="buyer@example.com"), amount_total=plan["price"])
        body = self.client.get("/api/plans/verify/cs_test_1").json()
        self.assertEqual((body["paid"], body["plan"]["id"], body["email"]), (True, plan["id"], "buyer@example.com"))

        # A subscription checkout from onboarding isn't a plan purchase.
        retrieve.return_value = SimpleNamespace(metadata={"plan_id": "pro"}, payment_status="paid", customer_details=None, amount_total=999)
        self.assertEqual(self.client.get("/api/plans/verify/cs_test_2").status_code, 404)


if __name__ == "__main__":
    unittest.main()
