from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
import stripe

from app.main import PAYMENT_PLANS, app
from app.payments import adopt_subscription, billing_account, is_paid


def profiles(*rows):
    """A user_profiles table whose select chain returns `rows`."""
    table = MagicMock()
    for method in ("select", "eq", "limit"):
        getattr(table, method).return_value = table
    table.execute.return_value = SimpleNamespace(data=list(rows))
    return table


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
        self.profile = {"id": "row-1", "user_key": "profile-1", "auth_user_id": "user-1", "is_paid": False}
        self.table = profiles(self.profile)
        self.user = SimpleNamespace(id="user-1", email="athlete@example.com", email_confirmed_at="2026-10-01T00:00:00Z")
        mocks = {}
        for target, options in [
            ("app.main.get_supabase_client", {"return_value": MagicMock(table=MagicMock(return_value=self.table))}),
            ("app.main.get_authenticated_user", {"side_effect": lambda authorization: self.user}),
            # By default the athlete's email has no Stripe customer yet.
            ("app.main.billing_account", {"return_value": (None, None)}),
        ]:
            patcher = patch(target, **options)
            mocks[target] = patcher.start()
            self.addCleanup(patcher.stop)
        self.billing = mocks["app.main.billing_account"]

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
        # The subscription itself names the SwimGPT account, and is billed to the account's own email.
        self.assertEqual(options["subscription_data"], {"metadata": self.payload})
        self.assertEqual(options["customer_email"], "athlete@example.com")
        self.assertNotIn("customer", options)
        self.assertEqual(options["client_reference_id"], "user-1")
        self.assertEqual(options["success_url"], "http://localhost:3000/payment/success?session_id={CHECKOUT_SESSION_ID}")
        self.assertEqual(options["cancel_url"], "http://localhost:3000/subscribe?checkout=cancelled")

    @patch("app.main.stripe.checkout.Session.create")
    def test_checkout_bills_the_athletes_existing_stripe_customer(self, create):
        self.billing.return_value = (None, "cus_1")
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/test", id="cs_test_1")
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 200)
        self.billing.assert_called_once_with(self.user)
        options = create.call_args.kwargs
        self.assertEqual(options["customer"], "cus_1")
        self.assertNotIn("customer_email", options)

    @patch("app.main.adopt_subscription")
    @patch("app.main.stripe.checkout.Session.create")
    def test_an_email_that_already_pays_is_never_charged_twice(self, create, adopt):
        # Say the athlete deleted their account and signed up again: their old subscription is still being paid.
        existing = SimpleNamespace(id="sub_old", customer="cus_1", metadata={})
        self.billing.return_value = (existing, "cus_1")
        response = self.client.post("/api/payments/checkout", json=self.payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Your coaching plan is already active.")
        adopt.assert_called_once_with(self.profile, existing)
        create.assert_not_called()

    @patch("app.main.stripe.checkout.Session.create")
    def test_no_checkout_while_stripe_cannot_say_what_the_email_pays_for(self, create):
        self.billing.side_effect = stripe.error.APIConnectionError("Stripe is down")
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 502)
        create.assert_not_called()
        self.table.update.assert_not_called()

    @patch("app.main.stripe.checkout.Session.create")
    def test_checkout_needs_the_athletes_own_signed_in_account(self, create):
        self.user.id = "someone-else"
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 403)
        with patch("app.main.get_authenticated_user", side_effect=HTTPException(status_code=401, detail="Sign in.")):
            self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 401)
        create.assert_not_called()

    @patch("app.main.stripe.checkout.Session.create")
    def test_checkout_is_remembered_on_the_profile(self, create):
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/test", id="cs_test_1")
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 200)
        self.table.eq.assert_any_call("user_key", "profile-1")
        self.table.eq.assert_any_call("auth_user_id", "user-1")
        self.table.update.assert_called_once_with({"stripe_checkout_session_id": "cs_test_1"})
        self.table.update.return_value.eq.assert_called_once_with("id", "row-1")

    @patch("app.payments.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy"))
    @patch("app.main.stripe.checkout.Session.retrieve")
    @patch("app.main.stripe.checkout.Session.expire")
    @patch("app.main.stripe.checkout.Session.create")
    def test_a_new_checkout_closes_the_previous_unpaid_one(self, create, expire, retrieve, settings):
        self.profile["stripe_checkout_session_id"] = "cs_old"
        retrieve.return_value = SimpleNamespace(metadata=self.payload, payment_status="unpaid")
        create.return_value = SimpleNamespace(url="https://checkout.stripe.com/c/pay/test", id="cs_new")
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 200)
        expire.assert_called_once_with("cs_old")
        self.table.update.assert_called_once_with({"stripe_checkout_session_id": "cs_new"})
        # A previous checkout that already finished can't be expired; that never blocks a new one.
        expire.side_effect = stripe.error.InvalidRequestError("Only open sessions can be expired", None)
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 200)

    @patch("app.main.stripe.checkout.Session.create")
    def test_paid_or_missing_profiles_cannot_check_out(self, create):
        self.table.execute.return_value = SimpleNamespace(data=[{**self.profile, "is_paid": True}])
        response = self.client.post("/api/payments/checkout", json=self.payload)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "Your coaching plan is already active.")
        self.table.execute.return_value = SimpleNamespace(data=[])
        self.assertEqual(self.client.post("/api/payments/checkout", json=self.payload).status_code, 404)
        create.assert_not_called()
        self.table.update.assert_not_called()

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
        self.table.update.assert_not_called()

    @patch("app.payments.get_supabase_client")
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
                    "is_paid": True,
                    "payment_status": "paid", "payment_plan_id": plan_id,
                    "stripe_checkout_session_id": "cs_test_1",
                    "stripe_customer_id": "cus_test_1", "stripe_subscription_id": "sub_test_1",
                    "subscription_checked_at": None,
                })
                update = supabase.table.return_value.update.return_value
                update.eq.assert_called_once_with("user_key", "profile-1")
                update.eq.return_value.eq.assert_called_once_with("auth_user_id", "user-1")
                update.eq.return_value.eq.return_value.execute.assert_called_once()

    @patch("app.payments.get_supabase_client")
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


@patch("app.main.get_authenticated_user", return_value=SimpleNamespace(id="user-1"))
class OnboardingAccessTests(unittest.TestCase):
    """Sign-in and onboarding send an athlete to the dashboard only once they've paid, otherwise to the payment screen."""

    def setUp(self):
        self.client = TestClient(app)
        self.row = {"id": "row-1", "user_key": "profile-1", "auth_user_id": "user-1", "is_paid": False,
                    "recommended_coaches": ["Coach Pete"], "main_events": ["50m Freestyle"], "swimmer_type": "Sprinter",
                    "facilities": [], "gym_sessions_per_week": 0, "swim_sessions_per_week": 4,
                    "pbs_lcm": {}, "pbs_scm": {}, "one_year_goal_times": {}}
        self.plan = {"generation_version": 3, "coach_match": {"headline": "Built for speed"}}
        for target, value in [("app.main.latest_profile_row", lambda user_id: self.row),
                              ("app.main._current_plan", lambda profile_id: self.plan)]:
            patcher = patch(target, side_effect=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def get(self, path):
        response = self.client.get(path, headers={"Authorization": "Bearer token"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_status_reports_payment(self, user):
        self.assertEqual(self.get("/api/onboarding/status"),
                         {"completed": True, "paid": False, "has_profile": True, "user_key": "profile-1"})
        self.row["is_paid"] = True
        self.assertTrue(self.get("/api/onboarding/status")["paid"])

    def test_onboarding_answers_report_payment(self, user):
        self.assertFalse(self.get("/api/onboarding")["paid"])
        self.row["is_paid"] = True
        self.assertTrue(self.get("/api/onboarding")["paid"])

    def test_payment_screen_shows_the_real_price_and_the_athletes_program(self, user):
        self.row.update(full_name="Aneesh Yalgi", swim_sessions_per_week=4)
        self.plan.update(phase="Race-specific speed", phase_duration="6 weeks", focus="Race pace", tags=list("abcdef"))
        screen = self.get("/api/subscription")
        self.assertFalse(screen["paid"])
        self.assertEqual(screen["first_name"], "Aneesh")
        self.assertEqual(screen["offer"], {"id": "performance-build", **PAYMENT_PLANS["performance-build"]})
        offer = screen["offer"]
        self.assertEqual((offer["amount"], offer["currency"], offer["interval"]), (1400, "usd", "month"))
        self.assertEqual(screen["coach"]["name"], "Coach Pete")
        program = screen["program"]
        self.assertEqual((program["headline"], program["phase"], program["tags"]), ("Built for speed", "Race-specific speed", list("abcde")))
        self.assertEqual(len(program["week"]), 4)

    def test_payment_screen_needs_a_finished_plan(self, user):
        headers = {"Authorization": "Bearer token"}
        self.plan = None
        self.assertEqual(self.client.get("/api/subscription", headers=headers).status_code, 409)
        self.row = None
        self.assertEqual(self.client.get("/api/subscription", headers=headers).status_code, 404)

    @patch("app.main.adopt_subscription")
    @patch("app.main.billing_account")
    def test_payment_screen_opens_the_dashboard_for_an_email_that_already_pays(self, billing, adopt, user):
        existing = SimpleNamespace(id="sub_old", customer="cus_1", metadata={})
        billing.return_value = (existing, "cus_1")
        self.assertTrue(self.get("/api/subscription")["paid"])
        adopt.assert_called_once_with(self.row, existing)
        # When Stripe can't be asked, the payment screen still shows; checkout asks again before charging.
        adopt.reset_mock()
        billing.side_effect = stripe.error.APIConnectionError("Stripe is down")
        with self.assertLogs("app.main", "WARNING"):
            self.assertFalse(self.get("/api/subscription")["paid"])
        adopt.assert_not_called()


def listing(*items):
    """A Stripe list result, as iterated with auto_paging_iter()."""
    return MagicMock(auto_paging_iter=MagicMock(return_value=iter(items)))


def stripe_subscription(id, created, status="active", ending=False, metadata=None, customer="cus_1"):
    return stripe.Subscription.construct_from({
        "id": id, "created": created, "status": status, "customer": customer, "metadata": metadata or {},
        "cancel_at_period_end": ending, "cancel_at": None,
    }, "sk_test_dummy")


@patch("app.payments.stripe.Subscription.list")
@patch("app.payments.stripe.Customer.list")
@patch("app.payments.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy"))
class BillingAccountTests(unittest.TestCase):
    """A subscription is found by the account's email, whichever account (perhaps since deleted) bought it."""

    user = SimpleNamespace(id="user-2", email="athlete@example.com", email_confirmed_at="2026-10-01T00:00:00Z")

    def test_finds_the_live_subscription_under_any_customer_with_the_email(self, settings, customers, subscriptions):
        customers.return_value = listing(SimpleNamespace(id="cus_new"), SimpleNamespace(id="cus_old"))
        owned = {
            "cus_new": [stripe_subscription("sub_incomplete", 300, status="incomplete")],
            "cus_old": [stripe_subscription("sub_ending", 200, ending=True), stripe_subscription("sub_renewing", 100),
                        stripe_subscription("sub_unpaid", 400, status="unpaid")],
        }
        subscriptions.side_effect = lambda customer, limit: listing(*owned[customer])
        subscription, customer_id = billing_account(self.user)
        # One that keeps renewing beats one that's ending; incomplete and unpaid ones aren't live.
        self.assertEqual((subscription.id, customer_id), ("sub_renewing", "cus_new"))
        customers.assert_called_once_with(email="athlete@example.com", limit=100)

    def test_newest_customer_is_reused_when_nothing_is_live(self, settings, customers, subscriptions):
        customers.return_value = listing(SimpleNamespace(id="cus_new"), SimpleNamespace(id="cus_old"))
        subscriptions.side_effect = lambda customer, limit: listing(stripe_subscription("sub_past", 100, status="past_due"))
        self.assertEqual(billing_account(self.user)[0].id, "sub_past")  # a renewal being retried still counts
        subscriptions.side_effect = lambda customer, limit: listing()
        customers.return_value = listing(SimpleNamespace(id="cus_new"), SimpleNamespace(id="cus_old"))
        self.assertEqual(billing_account(self.user), (None, "cus_new"))
        customers.return_value = listing()
        self.assertEqual(billing_account(self.user), (None, None))

    def test_only_a_confirmed_email_is_looked_up(self, settings, customers, subscriptions):
        for user in (SimpleNamespace(id="u", email="athlete@example.com", email_confirmed_at=None),
                     SimpleNamespace(id="u", email=None, email_confirmed_at="2026-10-01T00:00:00Z"), SimpleNamespace(id="u")):
            with self.subTest(user=user):
                self.assertEqual(billing_account(user), (None, None))
        customers.assert_not_called()


@patch("app.payments.get_supabase_client")
@patch("app.payments.stripe.Subscription.modify")
@patch("app.payments.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy"))
class AdoptSubscriptionTests(unittest.TestCase):
    row = {"id": "row-2", "user_key": "profile-2", "auth_user_id": "user-2", "payment_plan_id": None}

    def test_profile_takes_over_the_subscription_and_stripe_names_the_new_account(self, settings, modify, get_supabase):
        adopt_subscription(self.row, stripe_subscription("sub_old", 100, metadata={"plan_id": "performance-build"}, customer="cus_old"))
        modify.assert_called_once_with("sub_old", metadata={"auth_user_id": "user-2", "user_key": "profile-2"})
        table = get_supabase.return_value.table.return_value
        update = table.update.call_args.args[0]
        self.assertEqual({key: update[key] for key in ("is_paid", "payment_status", "payment_plan_id", "stripe_customer_id", "stripe_subscription_id")},
                         {"is_paid": True, "payment_status": "paid", "payment_plan_id": "performance-build",
                          "stripe_customer_id": "cus_old", "stripe_subscription_id": "sub_old"})
        self.assertIsNotNone(update["subscription_checked_at"])
        table.update.return_value.eq.assert_called_once_with("id", "row-2")

    def test_the_subscription_is_linked_even_if_stripe_cannot_label_it(self, settings, modify, get_supabase):
        modify.side_effect = stripe.error.APIConnectionError("Stripe is down")
        with self.assertLogs("app.payments", "WARNING"):
            adopt_subscription(self.row, stripe_subscription("sub_old", 100))
        get_supabase.return_value.table.return_value.update.assert_called_once()


@patch("app.payments.get_supabase_client")
@patch("app.payments.stripe.Subscription.retrieve")
@patch("app.payments.stripe.checkout.Session.retrieve")
@patch("app.payments.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy"))
class IsPaidTests(unittest.TestCase):
    """An athlete who paid but never reached the success page is confirmed from their last checkout."""

    row = {"id": "row-1", "user_key": "profile-1", "auth_user_id": "user-1", "is_paid": False, "stripe_checkout_session_id": "cs_old"}

    def session(self, **metadata):
        return SimpleNamespace(
            metadata={"user_key": "profile-1", "auth_user_id": "user-1", "plan_id": "performance-build", **metadata},
            payment_status="paid", id="cs_old", customer="cus_1", subscription="sub_1",
        )

    def test_paid_flag_needs_no_stripe_call(self, settings, retrieve, subscription, get_supabase):
        self.assertTrue(is_paid({**self.row, "is_paid": True}))
        self.assertFalse(is_paid({**self.row, "stripe_checkout_session_id": None}))
        retrieve.assert_not_called()
        subscription.assert_not_called()

    def test_paid_checkout_is_recorded(self, settings, retrieve, subscription, get_supabase):
        retrieve.return_value = self.session()
        subscription.return_value = SimpleNamespace(status="active")
        self.assertTrue(is_paid(self.row))
        retrieve.assert_called_once_with("cs_old")
        # Recorded, then the new subscription is confirmed live straight away.
        subscription.assert_called_once_with("sub_1")
        recorded, checked = (call.args[0] for call in get_supabase.return_value.table.return_value.update.call_args_list)
        self.assertTrue(recorded["is_paid"])
        self.assertNotIn("is_paid", checked)

    def test_unpaid_foreign_or_unreachable_checkouts_stay_locked(self, settings, retrieve, subscription, get_supabase):
        retrieve.return_value = SimpleNamespace(**{**vars(self.session()), "payment_status": "unpaid"})
        self.assertFalse(is_paid(self.row))
        retrieve.return_value = self.session(user_key="someone-else")
        self.assertFalse(is_paid(self.row))
        retrieve.side_effect = stripe.error.APIConnectionError("Stripe is down")
        with self.assertLogs("app.payments", "WARNING"):
            self.assertFalse(is_paid(self.row))
        get_supabase.assert_not_called()


@patch("app.payments.get_supabase_client")
@patch("app.payments.stripe.Subscription.retrieve")
@patch("app.payments.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy"))
class MonthlySubscriptionTests(unittest.TestCase):
    """Access lasts only while the monthly subscription is live, checked with Stripe at most once a day."""

    def paid_row(self, checked_hours_ago=None):
        checked_at = None if checked_hours_ago is None else (datetime.now(timezone.utc) - timedelta(hours=checked_hours_ago)).isoformat()
        return {"id": "row-1", "user_key": "profile-1", "auth_user_id": "user-1", "is_paid": True,
                "stripe_subscription_id": "sub_1", "stripe_checkout_session_id": "cs_1", "subscription_checked_at": checked_at}

    def update(self, get_supabase):
        table = get_supabase.return_value.table.return_value
        table.update.return_value.eq.assert_called_once_with("id", "row-1")
        return table.update.call_args.args[0]

    def test_checked_today_needs_no_stripe_call(self, settings, subscription, get_supabase):
        self.assertTrue(is_paid(self.paid_row(checked_hours_ago=3)))
        subscription.assert_not_called()
        get_supabase.assert_not_called()

    def test_live_subscription_is_rechecked_daily(self, settings, subscription, get_supabase):
        for status in ("active", "trialing", "past_due"):
            with self.subTest(status=status):
                get_supabase.reset_mock()
                subscription.return_value = SimpleNamespace(status=status)
                self.assertTrue(is_paid(self.paid_row(checked_hours_ago=25)))
                self.assertEqual(set(self.update(get_supabase)), {"subscription_checked_at"})

    def test_ended_subscription_locks_the_dashboard(self, settings, subscription, get_supabase):
        for status in ("canceled", "unpaid", "incomplete_expired", "paused"):
            with self.subTest(status=status):
                get_supabase.reset_mock()
                subscription.return_value = SimpleNamespace(status=status)
                self.assertFalse(is_paid(self.paid_row()))
                update = self.update(get_supabase)
                self.assertEqual((update["is_paid"], update["payment_status"], update["stripe_checkout_session_id"]), (False, status, None))

    def test_stripe_outage_never_locks_out_a_paying_athlete(self, settings, subscription, get_supabase):
        subscription.side_effect = stripe.error.APIConnectionError("Stripe is down")
        with self.assertLogs("app.payments", "WARNING"):
            self.assertTrue(is_paid(self.paid_row(checked_hours_ago=48)))
        get_supabase.assert_not_called()


if __name__ == "__main__":
    unittest.main()
