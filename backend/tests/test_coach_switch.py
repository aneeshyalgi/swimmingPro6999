from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
import stripe

from app import coach_switch
from app.main import app
from app.training import record_id

# A sprinter whose best match (the recommended coach) is Coach Brad; their coach is Coach Tony.
PROFILE = {
    "id": "row-1", "user_key": "profile-1", "auth_user_id": "user-1", "full_name": "Aneesh Yalgi", "recommended_coaches": ["Coach Tony"],
    "main_events": ["50m Freestyle", "100m Freestyle"], "swimmer_type": "sprinter", "facilities": ["Full Gym Access"],
    "gym_sessions_per_week": 2, "swim_sessions_per_week": 4, "pbs_lcm": {}, "pbs_scm": {}, "one_year_goal_times": {},
}
HEADERS = {"Authorization": "Bearer token"}


def paid(amount=299, *coaches):
    """What paid_switch() returns for a payment of `amount` cents made for `coaches`."""
    coaches = list(coaches or ["Coach Brad"])
    return {"amount": amount, "coaches": coaches, "details": {"session_id": "cs_paid", "coach": coaches[-1]}}


class CoachSwitchTests(unittest.TestCase):
    """Each switch from the dashboard is paid for ($1.99, or $2.99 to the best match), and a payment pays for one switch."""

    def setUp(self):
        self.client = TestClient(app)
        self.profile = dict(PROFILE)
        self.supabase = MagicMock()
        self.generated = ({"generation_version": 3, "phase": "Speed"}, ["Coach Brad Plan"], "gpt-4.1", "Coach Brad")
        self.generate = MagicMock(side_effect=lambda draft: ({**self.generated[0]}, self.generated[1], self.generated[2], draft["chosen_coach"]))
        self.writes_when_spent = []
        mocks = {}
        for target, options in [
            ("app.main.get_authenticated_profile", {"side_effect": lambda authorization: self.profile}),
            ("app.main.get_supabase_client", {"return_value": self.supabase}),
            ("app.main.generate_dashboard_plan", {"new": self.generate}),
            ("app.main.paid_switch", {"return_value": paid()}),
            ("app.main.spend", {"side_effect": lambda profile, payment: self.writes_when_spent.append(len(self.writes())) or True}),
            ("app.main.restore", {}),
            ("app.main.start_checkout", {"return_value": {"checkout_url": "https://checkout.stripe.com/c/pay/cs_new"}}),
        ]:
            patcher = patch(target, **options)
            mocks[target.rsplit(".", 1)[1]] = patcher.start()
            self.addCleanup(patcher.stop)
        self.paid_switch, self.spend, self.restore, self.start_checkout = (mocks[name] for name in ("paid_switch", "spend", "restore", "start_checkout"))

    def writes(self):
        """(table, method, payload) for every write, in order."""
        found = []
        for call in self.supabase.mock_calls:
            name = call[0]
            if name == "table":
                table = call.args[0]
            elif name.startswith("table().") and name.split(".")[1] in ("upsert", "update", "insert", "delete"):
                found.append((table, name.split(".")[1], call.args[0] if call.args else None))
        return found

    def switch(self, coach):
        return self.client.post("/api/coach", json={"coach": coach}, headers=HEADERS)

    def test_options_rank_every_coach_and_price_each_switch(self):
        self.paid_switch.return_value = None
        response = self.client.get("/api/coach/options", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["current"], "Coach Tony")
        self.assertEqual(len(body["coaches"]), 5)
        self.assertEqual([coach["recommended"] for coach in body["coaches"]].count(True), 1)
        self.assertEqual(body["coaches"][0]["name"], body["recommended"])
        self.assertTrue(all(coach["reasons"] for coach in body["coaches"]))
        self.assertEqual((body["currency"], body["paid_switch"]), ("usd", None))
        # The best match is $2.99, every other coach $1.99, and nothing is paid yet.
        self.assertEqual({coach["name"]: coach["switch"] for coach in body["coaches"]}, {
            "Coach Brad": {"price": 299, "due": 299}, "Coach Pete": {"price": 199, "due": 199}, "Coach Timothy": {"price": 199, "due": 199},
            "Coach Robert": {"price": 199, "due": 199}, "Coach Tony": {"price": 199, "due": 199},
        })

    def test_options_count_a_payment_whose_switch_never_happened(self):
        # $1.99 paid for Pete (say the tab closed): any $1.99 coach is covered, the $2.99 best match needs $1.00 more.
        self.paid_switch.return_value = paid(199, "Coach Pete")
        body = self.client.get("/api/coach/options", headers=HEADERS).json()
        self.assertEqual(body["paid_switch"], {"amount": 199, "coach": "Coach Pete"})
        self.assertEqual({coach["name"]: coach["switch"]["due"] for coach in body["coaches"]},
                         {"Coach Brad": 100, "Coach Pete": 0, "Coach Timothy": 0, "Coach Robert": 0, "Coach Tony": 0})

    def test_options_never_offer_to_charge_while_stripe_cannot_say_what_is_paid(self):
        self.paid_switch.side_effect = stripe.error.APIConnectionError("Stripe is down")
        self.assertEqual(self.client.get("/api/coach/options", headers=HEADERS).status_code, 502)

    def test_checkout_opens_stripe_for_another_coach(self):
        response = self.client.post("/api/coach/checkout", json={"coach": "brad"}, headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"checkout_url": "https://checkout.stripe.com/c/pay/cs_new"})
        self.assertEqual(self.start_checkout.call_args.args, (self.profile, "Coach Brad"))

    def test_checkout_is_only_for_a_different_known_coach(self):
        self.assertEqual(self.client.post("/api/coach/checkout", json={"coach": "Coach Tony"}, headers=HEADERS).status_code, 409)
        self.assertEqual(self.client.post("/api/coach/checkout", json={"coach": "Coach Phelps"}, headers=HEADERS).status_code, 422)
        self.start_checkout.assert_not_called()

    def test_checkout_that_stripe_cannot_open_charges_nothing(self):
        self.start_checkout.side_effect = stripe.error.APIConnectionError("Stripe is down")
        with self.assertLogs("app.main", "WARNING"):
            response = self.client.post("/api/coach/checkout", json={"coach": "brad"}, headers=HEADERS)
        self.assertEqual(response.status_code, 502)
        self.assertIn("Nothing was charged", response.json()["detail"])

    def test_a_paid_switch_rebuilds_the_plan_spends_the_payment_then_saves_the_coach(self):
        response = self.switch("brad")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["coach"], body["changed"], body["coach_profile"]["name"]), ("Coach Brad", True, "Coach Brad"))
        draft = self.generate.call_args.args[0]
        self.assertEqual(draft["chosen_coach"], "Coach Brad")
        self.assertEqual(draft["main_events"], PROFILE["main_events"])
        self.spend.assert_called_once_with(self.profile, paid())
        self.assertEqual(self.writes_when_spent, [0])  # spent before anything is saved
        self.assertEqual(self.writes(), [
            ("user_ai_plans", "upsert", {"user_id": "row-1", "plan": self.generated[0], "context_sources": ["Coach Brad Plan"], "model": "gpt-4.1"}),
            ("user_profiles", "update", {"recommended_coaches": ["Coach Brad"]}),
            ("user_coach_matches", "delete", None),
            ("user_coach_matches", "insert", {"user_id": "row-1", "coach_name": "Coach Brad"}),
        ])
        self.restore.assert_not_called()

    def test_a_payment_counts_for_any_coach_it_covers(self):
        self.assertEqual(self.switch("pete").json()["coach"], "Coach Pete")  # $2.99 paid for Brad covers a $1.99 coach
        self.paid_switch.return_value = paid(199, "Coach Pete")
        self.assertEqual(self.switch("timothy").json()["coach"], "Coach Timothy")  # $1.99 paid for Pete covers Timothy

    def test_the_best_match_needs_the_full_two_ninety_nine(self):
        self.paid_switch.return_value = paid(199, "Coach Pete")
        response = self.switch("brad")
        self.assertEqual(response.status_code, 402)
        self.assertEqual(response.json()["detail"], "Switching to Coach Brad is a one-time $2.99 payment. $1.99 of it is already paid, "
                                                    "so $1.00 is left. Pay for this switch to continue.")
        self.generate.assert_not_called()
        self.spend.assert_not_called()
        self.assertEqual(self.writes(), [])

    def test_a_payment_made_for_a_coach_still_covers_them_after_they_became_the_best_match(self):
        self.paid_switch.return_value = paid(199, "Coach Brad")  # paid when Brad was a $1.99 coach
        self.assertEqual(self.switch("brad").status_code, 200)

    def test_no_switch_without_payment(self):
        self.paid_switch.return_value = None
        for coach, price in (("pete", "$1.99"), ("brad", "$2.99")):
            response = self.switch(coach)
            self.assertEqual(response.status_code, 402)
            self.assertIn(f"one-time {price} payment", response.json()["detail"])
        self.generate.assert_not_called()
        self.spend.assert_not_called()
        self.assertEqual(self.writes(), [])

    def test_no_switch_while_stripe_cannot_confirm_the_payment(self):
        self.paid_switch.side_effect = stripe.error.APIConnectionError("Stripe is down")
        self.assertEqual(self.switch("brad").status_code, 502)
        self.generate.assert_not_called()
        self.assertEqual(self.writes(), [])

    def test_a_failed_plan_changes_nothing_and_keeps_the_payment(self):
        self.generate.side_effect = RuntimeError("model timed out")
        with self.assertLogs("app.main", "ERROR"):
            response = self.switch("Coach Brad")
        self.assertEqual(response.status_code, 502)
        self.assertIn("Nothing changed, and your payment is kept", response.json()["detail"])
        self.spend.assert_not_called()
        self.assertEqual(self.writes(), [])

    def test_one_payment_never_pays_for_two_switches(self):
        self.spend.side_effect = lambda profile, payment: False  # another request used it a moment ago
        self.assertEqual(self.switch("brad").status_code, 409)
        self.assertEqual(self.writes(), [])

    def test_a_coach_that_cannot_be_saved_gives_the_payment_back(self):
        self.supabase.table.return_value.update.return_value.eq.return_value.execute.side_effect = APIError({"message": "down"})
        response = self.switch("brad")
        self.assertEqual(response.status_code, 502)
        self.assertIn("Your payment is kept", response.json()["detail"])
        self.restore.assert_called_once_with(self.profile, paid())

    def test_the_current_coach_or_an_unknown_one_changes_nothing_and_costs_nothing(self):
        same = self.switch("coach tony")
        self.assertEqual((same.status_code, same.json()["changed"], same.json()["coach"]), (200, False, "Coach Tony"))
        self.assertEqual(self.switch("Coach Phelps").status_code, 422)
        self.generate.assert_not_called()
        self.paid_switch.assert_not_called()
        self.spend.assert_not_called()
        self.assertEqual(self.writes(), [])

    def test_only_a_paying_signed_in_athlete_can_switch(self):
        def unpaid(authorization):
            raise HTTPException(status_code=402, detail="Activate your coaching plan to open your dashboard.")
        with patch("app.main.get_authenticated_profile", side_effect=unpaid):
            self.assertEqual(self.switch("brad").status_code, 402)
            self.assertEqual(self.client.post("/api/coach/checkout", json={"coach": "brad"}, headers=HEADERS).status_code, 402)
            self.assertEqual(self.client.get("/api/coach/options", headers=HEADERS).status_code, 402)
        self.generate.assert_not_called()
        self.start_checkout.assert_not_called()


def checkout(session_id="cs_1", status="open", payment_status="unpaid", amount=199, owner=PROFILE, purpose="coach_switch"):
    return stripe.checkout.Session.construct_from({
        "id": session_id, "status": status, "payment_status": payment_status, "amount_total": amount,
        "url": f"https://checkout.stripe.com/c/pay/{session_id}",
        "metadata": {"purpose": purpose, "user_key": owner["user_key"], "auth_user_id": owner["auth_user_id"], "coach": "Coach Brad"},
    }, "sk_test_dummy")


@patch("app.coach_switch.get_settings", return_value=SimpleNamespace(stripe_secret_key="sk_test_dummy", frontend_url="http://localhost:3000"))
@patch("app.coach_switch.save_record")
@patch("app.coach_switch.find_record", return_value=None)
@patch("app.coach_switch.stripe.checkout.Session.expire")
@patch("app.coach_switch.stripe.checkout.Session.retrieve")
@patch("app.coach_switch.stripe.checkout.Session.create")
class CoachSwitchPaymentTests(unittest.TestCase):
    """The Stripe side of a switch: a one-time card payment, remembered before the athlete is sent to pay."""

    def setUp(self):
        self.profile = {**PROFILE, "stripe_customer_id": "cus_1"}

    @staticmethod
    def stripe_has(retrieve, *sessions):
        by_id = {session.id: session for session in sessions}
        retrieve.side_effect = lambda session_id, *args, **kwargs: by_id[session_id]

    def test_checkout_is_a_one_time_payment_of_one_ninety_nine(self, create, retrieve, expire, find, save, settings):
        create.return_value = checkout("cs_new")
        self.assertEqual(coach_switch.start_checkout(self.profile, "Coach Pete"), {"checkout_url": "https://checkout.stripe.com/c/pay/cs_new"})
        options = create.call_args.kwargs
        self.assertEqual((options["mode"], options["payment_method_types"], options["customer"]), ("payment", ["card"], "cus_1"))
        item = options["line_items"][0]
        self.assertNotIn("recurring", item["price_data"])  # never a subscription
        self.assertEqual((item["price_data"]["unit_amount"], item["price_data"]["currency"], item["quantity"]), (199, "usd", 1))
        self.assertEqual(item["price_data"]["product_data"]["name"], "Coach switch to Coach Pete")
        metadata = {"purpose": "coach_switch", "auth_user_id": "user-1", "user_key": "profile-1", "coach": "Coach Pete"}
        self.assertEqual(options["metadata"], metadata)
        self.assertEqual(options["payment_intent_data"]["metadata"], metadata)
        self.assertEqual(options["success_url"], "http://localhost:3000/dashboard?coach_switch=paid")
        self.assertEqual(options["cancel_url"], "http://localhost:3000/dashboard?coach_switch=cancelled&coach=Coach%20Pete")
        # Remembered (so the payment can't be lost) before the athlete is sent to pay.
        save.assert_called_once_with("row-1", "coach_switch", "coach_switch", "Coach switch payment", None, {"session_id": "cs_new", "coach": "Coach Pete"})
        expire.assert_not_called()

    def test_the_best_match_is_two_ninety_nine(self, create, retrieve, expire, find, save, settings):
        create.return_value = checkout("cs_new")
        coach_switch.start_checkout(self.profile, "Coach Brad")
        price_data = create.call_args.kwargs["line_items"][0]["price_data"]
        self.assertEqual((price_data["unit_amount"], price_data["product_data"]["name"]), (299, "Coach switch to Coach Brad (your best match)"))

    def test_a_new_checkout_closes_the_previous_unpaid_one(self, create, retrieve, expire, find, save, settings):
        find.return_value = {"id": "rec", "details": {"session_id": "cs_old", "coach": "Coach Pete"}}
        self.stripe_has(retrieve, checkout("cs_old"))
        expire.return_value = checkout("cs_old", status="expired")
        create.return_value = checkout("cs_new")
        self.assertEqual(coach_switch.start_checkout(self.profile, "Coach Brad"), {"checkout_url": "https://checkout.stripe.com/c/pay/cs_new"})
        expire.assert_called_once_with("cs_old")
        self.assertEqual(create.call_args.kwargs["line_items"][0]["price_data"]["unit_amount"], 299)
        self.assertEqual(save.call_args.args[-1], {"session_id": "cs_new", "coach": "Coach Brad"})

    def test_a_payment_that_covers_the_switch_is_used_instead_of_charging_again(self, create, retrieve, expire, find, save, settings):
        find.return_value = {"id": "rec", "details": {"session_id": "cs_old", "coach": "Coach Pete"}}
        self.stripe_has(retrieve, checkout("cs_old", status="complete", payment_status="paid"))
        self.assertEqual(coach_switch.start_checkout(self.profile, "Coach Timothy"), {"paid": True})
        create.assert_not_called()
        expire.assert_not_called()
        save.assert_not_called()

    def test_a_smaller_payment_counts_and_only_the_rest_is_charged(self, create, retrieve, expire, find, save, settings):
        find.return_value = {"id": "rec", "details": {"session_id": "cs_old", "coach": "Coach Pete"}}
        self.stripe_has(retrieve, checkout("cs_old", status="complete", payment_status="paid"))
        create.return_value = checkout("cs_rest")
        coach_switch.start_checkout(self.profile, "Coach Brad")
        price_data = create.call_args.kwargs["line_items"][0]["price_data"]
        self.assertEqual((price_data["unit_amount"], price_data["product_data"]["name"]), (100, "Coach switch to Coach Brad: the rest"))
        self.assertIn("$1.99 of it is already paid", price_data["product_data"]["description"])
        # The earlier payment stays on the record, so it still counts if this checkout is never paid.
        self.assertEqual(save.call_args.args[-1], {"session_id": "cs_rest", "coach": "Coach Brad",
                                                   "earlier": [{"session_id": "cs_old", "coach": "Coach Pete"}]})

    def test_an_abandoned_top_up_keeps_the_earlier_payment(self, create, retrieve, expire, find, save, settings):
        details = {"session_id": "cs_rest", "coach": "Coach Brad", "earlier": [{"session_id": "cs_old", "coach": "Coach Pete"}]}
        find.return_value = {"id": "rec", "details": details}
        self.stripe_has(retrieve, checkout("cs_old", status="complete", payment_status="paid"), checkout("cs_rest", amount=100))
        self.assertEqual(coach_switch.paid_switch(self.profile), {"amount": 199, "coaches": ["Coach Pete"], "details": details})
        expire.return_value = checkout("cs_rest", status="expired", amount=100)
        self.assertEqual(coach_switch.start_checkout(self.profile, "Coach Timothy"), {"paid": True})
        expire.assert_called_once_with("cs_rest")
        create.assert_not_called()

    def test_a_paid_top_up_adds_up_to_the_best_match(self, create, retrieve, expire, find, save, settings):
        details = {"session_id": "cs_rest", "coach": "Coach Brad", "earlier": [{"session_id": "cs_old", "coach": "Coach Pete"}]}
        find.return_value = {"id": "rec", "details": details}
        self.stripe_has(retrieve, checkout("cs_old", status="complete", payment_status="paid"),
                        checkout("cs_rest", status="complete", payment_status="paid", amount=100))
        payment = coach_switch.paid_switch(self.profile)
        self.assertEqual(payment, {"amount": 299, "coaches": ["Coach Pete", "Coach Brad"], "details": details})
        self.assertEqual(coach_switch.amount_due(self.profile, "Coach Brad", payment), 0)

    def test_a_checkout_paid_while_it_was_being_closed_is_used(self, create, retrieve, expire, find, save, settings):
        find.return_value = {"id": "rec", "details": {"session_id": "cs_old", "coach": "Coach Pete"}}
        retrieve.side_effect = [checkout("cs_old"), checkout("cs_old", status="complete", payment_status="paid")]
        expire.side_effect = stripe.error.InvalidRequestError("This Checkout Session is already complete.", None)
        self.assertEqual(coach_switch.start_checkout(self.profile, "Coach Pete"), {"paid": True})
        create.assert_not_called()

    def test_a_checkout_that_cannot_be_remembered_is_closed(self, create, retrieve, expire, find, save, settings):
        create.return_value = checkout("cs_new")
        save.side_effect = APIError({"message": "down"})
        with self.assertRaises(APIError):
            coach_switch.start_checkout(self.profile, "Coach Brad")
        expire.assert_called_once_with("cs_new")

    def test_a_customer_gone_from_stripe_pays_as_a_new_one(self, create, retrieve, expire, find, save, settings):
        create.side_effect = [stripe.error.InvalidRequestError("No such customer: 'cus_1'", "customer"), checkout("cs_new")]
        self.assertEqual(coach_switch.start_checkout(self.profile, "Coach Brad"), {"checkout_url": "https://checkout.stripe.com/c/pay/cs_new"})
        self.assertNotIn("customer", create.call_args.kwargs)

    def test_only_this_athletes_paid_checkouts_count(self, create, retrieve, expire, find, save, settings):
        self.assertIsNone(coach_switch.paid_switch(self.profile))  # nothing bought
        retrieve.assert_not_called()
        details = {"session_id": "cs_1", "coach": "Coach Brad"}
        find.return_value = {"id": "rec", "details": details}
        retrieve.return_value = checkout("cs_1", status="complete", payment_status="paid", amount=299)
        self.assertEqual(coach_switch.paid_switch(self.profile), {"amount": 299, "coaches": ["Coach Brad"], "details": details})
        for session in (checkout("cs_1"), checkout("cs_1", status="expired"),
                        checkout("cs_1", status="complete", payment_status="paid", owner={"user_key": "profile-2", "auth_user_id": "user-2"}),
                        checkout("cs_1", status="complete", payment_status="paid", purpose=None)):
            retrieve.return_value = session
            self.assertIsNone(coach_switch.paid_switch(self.profile))


class SpendTests(unittest.TestCase):
    @patch("app.coach_switch.get_supabase_client")
    def test_spending_removes_the_record_only_while_it_holds_that_checkout(self, get_supabase):
        query = get_supabase.return_value.table.return_value.delete.return_value
        query.eq.return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"id": "rec"}])
        payment = paid(199, "Coach Pete")
        self.assertTrue(coach_switch.spend(PROFILE, payment))
        self.assertEqual([call.args for call in query.eq.call_args_list],
                         [("user_id", "row-1"), ("id", record_id("row-1", "coach_switch")), ("details->>session_id", "cs_paid")])
        query.execute.return_value = SimpleNamespace(data=[])
        self.assertFalse(coach_switch.spend(PROFILE, payment))


class OnboardingKeepsAPaidCoachTests(unittest.TestCase):
    """Editing onboarding answers can't switch coach for free: once an athlete has paid, switches go through the dashboard."""

    BODY = {
        "age": 18, "gender": "female", "country": "Canada", "height": 180, "weight": 72, "swim_experience": 8,
        "main_events": ["200m Freestyle"], "pbs_lcm": {"200m Freestyle": "2:03.40"}, "swimmer_type": "mid",
        "swim_sessions_per_week": 6, "gym_sessions_per_week": 2, "session_duration": "90", "facilities": ["50m Pool"],
        "coaching_situation": "club", "one_year_goal_times": {"200m Freestyle": "1:59.80"}, "coach": "Coach Brad",
    }

    def chosen_coach(self, paid: bool) -> str:
        existing = {**PROFILE, "is_paid": paid}
        generate = MagicMock(side_effect=lambda draft: ({"generation_version": 3}, [], "gpt-4.1", draft["chosen_coach"]))
        supabase = MagicMock()
        supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(data=[existing])
        user = SimpleNamespace(id="user-1", user_metadata={"full_name": "Aneesh Yalgi"})
        with patch("app.main.get_authenticated_user", return_value=user), patch("app.main.latest_profile_row", return_value=existing), \
                patch("app.main.is_paid", return_value=paid), patch("app.main.generate_dashboard_plan", new=generate), \
                patch("app.main.get_supabase_client", return_value=supabase):
            response = TestClient(app).post("/api/onboarding", json=self.BODY, headers=HEADERS)
        self.assertEqual(response.status_code, 201, response.text)
        return generate.call_args.args[0]["chosen_coach"]

    def test_a_paid_athlete_keeps_their_coach(self):
        self.assertEqual(self.chosen_coach(paid=True), "Coach Tony")

    def test_an_athlete_who_has_not_paid_yet_picks_freely(self):
        self.assertEqual(self.chosen_coach(paid=False), "Coach Brad")


if __name__ == "__main__":
    unittest.main()
