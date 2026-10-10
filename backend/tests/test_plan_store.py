from types import SimpleNamespace
import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
import stripe

from app.main import app
from app.plan_store import BOOKS, CATALOG, CATEGORIES, book_index, for_sale

BUYER = SimpleNamespace(id="user-1", email="swimmer@example.com")


def without_book(plan_id):
    """The books as they'd be if one plan had no premade PDF (Strength and Power has none yet)."""
    return patch("app.plan_store.book_index", return_value={key: value for key, value in book_index().items() if key != plan_id})
SIGNED_IN = {"Authorization": "Bearer token"}


def fake_settings():
    return SimpleNamespace(stripe_secret_key="sk_test_dummy", frontend_url="http://localhost:3000")


def checkout(session_id="cs_new", status="open", payment_status="unpaid", amount=3900, plan=None, buyer="user-1"):
    plan = plan or CATALOG[0]
    return stripe.checkout.Session.construct_from({
        "id": session_id, "status": status, "payment_status": payment_status, "amount_total": amount, "currency": "usd",
        "url": f"https://checkout.stripe.com/c/pay/{session_id}", "customer_details": {"email": "swimmer@example.com"},
        "metadata": {"kind": "pdf_plan", "plan_id": plan["id"], "auth_user_id": buyer},
    }, "sk_test_dummy")


class Query:
    """Just enough of a PostgREST query for the purchases table."""

    def __init__(self, table, action, payload=None, **options):
        self.table, self.action, self.payload, self.options, self.filters = table, action, payload, options, []

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def order(self, column):
        return self

    def limit(self, count):
        return self

    def execute(self):
        if self.action in self.table.failing:
            raise APIError({"message": "relation does not exist"})
        hits = [row for row in self.table.rows if all(row.get(column) == value for column, value in self.filters)]
        if self.action == "select":
            return SimpleNamespace(data=[dict(row) for row in hits])
        if self.action == "update":
            for row in hits:
                row.update(self.payload)
            return SimpleNamespace(data=hits)
        if self.action == "delete":
            self.table.rows = [row for row in self.table.rows if row not in hits]
            return SimpleNamespace(data=hits)
        key = self.options.get("on_conflict")
        if key and any(row[key] == self.payload[key] for row in self.table.rows):
            return SimpleNamespace(data=[])  # upsert that ignores duplicates
        row = {"id": f"purchase-{len(self.table.rows) + 1}", "paid_at": None, **self.payload}
        self.table.rows.append(row)
        return SimpleNamespace(data=[row])


class PurchasesTable:
    def __init__(self, *rows):
        self.rows, self.failing = [dict(row) for row in rows], set()

    def select(self, *_):
        return Query(self, "select")

    def insert(self, payload):
        return Query(self, "insert", payload)

    def upsert(self, payload, on_conflict, ignore_duplicates=False):
        return Query(self, "upsert", payload, on_conflict=on_conflict)

    def update(self, payload):
        return Query(self, "update", payload)

    def delete(self):
        return Query(self, "delete")


def purchase(plan=None, status="paid", session_id="cs_old", buyer="user-1"):
    plan = plan or CATALOG[0]
    return {"id": f"row-{session_id}", "auth_user_id": buyer, "plan_id": plan["id"], "plan_title": plan["title"], "amount": plan["price"],
            "currency": "usd", "status": status, "stripe_checkout_session_id": session_id, "paid_at": "2026-10-01T00:00:00+00:00" if status == "paid" else None}


class CatalogTests(unittest.TestCase):
    def test_catalog_is_well_formed(self):
        ids = [plan["id"] for plan in CATALOG]
        self.assertEqual(len(ids), len(set(ids)))
        for plan in CATALOG:
            self.assertIn(plan["category"], CATEGORIES)
            self.assertGreater(plan["price"], 0)
            self.assertTrue(plan["includes"] and plan["sample_week"])
        self.assertEqual(set(CATEGORIES), {plan["category"] for plan in CATALOG})
        body = TestClient(app).get("/api/plans/catalog").json()
        self.assertEqual([plan["id"] for plan in body["plans"]], [plan["id"] for plan in for_sale()])
        self.assertEqual(body["plans"][0]["currency"], "usd")
        # Every category listed has a plan on sale, so the store never shows an empty filter.
        self.assertEqual(body["categories"], [name for name in CATEGORIES if any(plan["category"] == name for plan in body["plans"])])

    def test_only_plans_with_a_book_are_sold(self):
        books = book_index()
        self.assertEqual([plan["id"] for plan in for_sale()], [plan["id"] for plan in CATALOG if plan["id"] in books])
        for plan in for_sale():
            self.assertTrue((BOOKS / f"{plan['id']}.json").is_file(), plan["id"])
        # A plan without a book has nothing to deliver: it isn't listed, and its category goes with it.
        with without_book("dryland-power"):
            body = TestClient(app).get("/api/plans/catalog").json()
        self.assertNotIn("dryland-power", [plan["id"] for plan in body["plans"]])
        self.assertNotIn("Dryland", body["categories"])

    def test_each_listing_matches_its_book(self):
        books = book_index()
        for plan in for_sale():
            book = books[plan["id"]]
            self.assertEqual((plan["weeks"], plan["sessions_per_week"], plan["pages"]), (book["weeks"], book["sessions_per_week"], book["pages"]), plan["id"])

    def test_look_inside_shows_anyone_the_two_pages_after_the_cover(self):
        client = TestClient(app)
        for plan in for_sale():
            book = json.loads((BOOKS / f"{plan['id']}.json").read_text(encoding="utf-8"))
            response = client.get(f"/api/plans/{plan['id']}/preview", headers={"Accept-Encoding": "gzip"})  # nobody signed in
            self.assertEqual(response.status_code, 200, plan["id"])
            self.assertEqual(response.headers["content-encoding"], "gzip")
            preview = response.json()
            self.assertEqual((preview["first_page"], preview["page_count"], len(preview["pages"])), (1, len(book["pages"]), 2), plan["id"])
            self.assertEqual([page["ops"] for page in preview["pages"]], [page["ops"] for page in book["pages"][1:3]], plan["id"])
            # Nothing beyond those two pages: no in-book links, contents or session list, and only the images they draw.
            self.assertFalse(any("links" in page for page in preview["pages"]), plan["id"])
            self.assertNotIn("toc", preview)
            self.assertNotIn("sessions", preview)
            self.assertEqual(set(preview["images"]), {op[1] for page in preview["pages"] for op in page["ops"] if op[0] == "i"}, plan["id"])

    def test_no_preview_without_a_book(self):
        client = TestClient(app)
        self.assertEqual(client.get("/api/plans/nothing-here/preview").status_code, 404)
        with without_book("dryland-power"):
            self.assertEqual(client.get("/api/plans/dryland-power/preview").status_code, 404)

    def test_the_store_sells_these_plans(self):
        self.assertEqual([plan["title"] for plan in CATALOG], [
            "50m Freestyle Speed", "100m Race Pace", "200m Endurance and Speed", "Distance Freestyle", "Strength and Power", "Age Group Development", "Masters Performance",
        ])


@patch("app.plan_store.get_settings", fake_settings)
@patch("app.plan_store.stripe.checkout.Session.expire")
@patch("app.plan_store.stripe.checkout.Session.retrieve")
@patch("app.plan_store.stripe.checkout.Session.create")
class PlanPurchaseTests(unittest.TestCase):
    """Buying a plan needs an account (nothing more), and every purchase is kept against it."""

    def setUp(self):
        self.client = TestClient(app)
        self.table = PurchasesTable()
        for target, options in [
            ("app.plan_store.get_supabase_client", {"return_value": SimpleNamespace(table=lambda name: self.table)}),
            ("app.plan_store.get_authenticated_user", {"side_effect": self.authenticate}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def authenticate(authorization):
        if authorization != "Bearer token":
            raise HTTPException(status_code=401, detail="Sign in to load your athlete profile.")
        return BUYER

    def buy(self, plan=None, headers=SIGNED_IN):
        return self.client.post("/api/plans/checkout", json={"plan_id": (plan or CATALOG[0])["id"], "price": 1}, headers=headers)

    def test_buying_needs_an_account(self, create, retrieve, expire):
        self.assertEqual(self.buy(headers={}).status_code, 401)
        self.assertEqual(self.buy(headers={"Authorization": "Bearer stale"}).status_code, 401)
        create.assert_not_called()
        self.assertEqual(self.table.rows, [])

    def test_checkout_charges_the_server_price_and_records_the_purchase(self, create, retrieve, expire):
        create.return_value = checkout("cs_new")
        plan = CATALOG[0]
        response = self.buy(plan)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"checkout_url": "https://checkout.stripe.com/c/pay/cs_new", "session_id": "cs_new"})
        options = create.call_args.kwargs
        self.assertEqual((options["mode"], options["managed_payments"]), ("payment", {"enabled": False}))
        self.assertEqual(options["line_items"][0]["price_data"]["unit_amount"], plan["price"])
        self.assertEqual(options["metadata"], {"kind": "pdf_plan", "plan_id": plan["id"], "auth_user_id": "user-1"})
        self.assertEqual((options["client_reference_id"], options["customer_email"]), ("user-1", "swimmer@example.com"))
        self.assertIn("/training-plans/success?session_id={CHECKOUT_SESSION_ID}", options["success_url"])
        self.assertEqual(self.table.rows, [{
            "id": "purchase-1", "paid_at": None, "auth_user_id": "user-1", "plan_id": plan["id"], "plan_title": plan["title"],
            "amount": plan["price"], "currency": "usd", "status": "pending", "stripe_checkout_session_id": "cs_new",
        }])

    def test_unknown_plan_is_rejected(self, create, retrieve, expire):
        response = self.client.post("/api/plans/checkout", json={"plan_id": "free-plan"}, headers=SIGNED_IN)
        self.assertEqual(response.status_code, 404)
        with without_book("dryland-power"):
            self.assertEqual(self.client.post("/api/plans/checkout", json={"plan_id": "dryland-power"}, headers=SIGNED_IN).status_code, 404)
        create.assert_not_called()

    def test_a_plan_already_bought_is_never_sold_twice(self, create, retrieve, expire):
        self.table.rows = [purchase(CATALOG[0])]
        response = self.buy(CATALOG[0])
        self.assertEqual(response.status_code, 409)
        self.assertIn(f"You already own {CATALOG[0]['title']}", response.json()["detail"])
        create.assert_not_called()
        create.return_value = checkout("cs_new", plan=CATALOG[1])
        self.assertEqual(self.buy(CATALOG[1]).status_code, 200)  # another plan is fine

    def test_an_open_checkout_for_the_same_plan_is_closed_first(self, create, retrieve, expire):
        self.table.rows = [purchase(CATALOG[0], status="pending", session_id="cs_tab")]
        retrieve.return_value = checkout("cs_tab")
        expire.return_value = checkout("cs_tab", status="expired")
        create.return_value = checkout("cs_new")
        self.assertEqual(self.buy(CATALOG[0]).status_code, 200)
        expire.assert_called_once_with("cs_tab")
        self.assertEqual([(row["stripe_checkout_session_id"], row["status"]) for row in self.table.rows], [("cs_new", "pending")])

    def test_a_checkout_paid_in_another_tab_counts_as_bought(self, create, retrieve, expire):
        self.table.rows = [purchase(CATALOG[0], status="pending", session_id="cs_tab")]
        retrieve.side_effect = [checkout("cs_tab"), checkout("cs_tab", status="complete", payment_status="paid")]
        expire.side_effect = stripe.error.InvalidRequestError("This Checkout Session is already complete.", None)
        self.assertEqual(self.buy(CATALOG[0]).status_code, 409)
        create.assert_not_called()
        self.assertEqual(self.table.rows[0]["status"], "paid")

    def test_a_purchase_that_cannot_be_recorded_never_opens_checkout(self, create, retrieve, expire):
        create.return_value = checkout("cs_new")
        self.table.failing = {"insert"}
        with self.assertLogs("app.plan_store", "ERROR"):
            response = self.buy()
        self.assertEqual(response.status_code, 503)
        self.assertIn("Nothing was charged", response.json()["detail"])
        expire.assert_called_once_with("cs_new")

    def test_the_success_page_marks_the_purchase_paid(self, create, retrieve, expire):
        plan = CATALOG[2]
        self.table.rows = [purchase(plan, status="pending", session_id="cs_1")]
        retrieve.return_value = checkout("cs_1", status="complete", payment_status="paid", amount=plan["price"], plan=plan)
        body = self.client.get("/api/plans/verify/cs_1").json()
        self.assertEqual((body["paid"], body["plan"]["id"], body["email"], body["account"]), (True, plan["id"], "swimmer@example.com", True))
        row = self.table.rows[0]
        self.assertEqual((row["status"], row["amount"]), ("paid", plan["price"]))
        paid_at = row["paid_at"]
        self.client.get("/api/plans/verify/cs_1")  # opened again: nothing changes
        self.assertEqual((len(self.table.rows), self.table.rows[0]["paid_at"]), (1, paid_at))

    def test_a_paid_checkout_missing_from_the_table_is_recorded(self, create, retrieve, expire):
        plan = CATALOG[1]
        retrieve.return_value = checkout("cs_2", status="complete", payment_status="paid", amount=plan["price"], plan=plan)
        self.client.get("/api/plans/verify/cs_2")
        self.assertEqual([(row["auth_user_id"], row["plan_id"], row["status"]) for row in self.table.rows], [("user-1", plan["id"], "paid")])

    def test_unpaid_or_foreign_checkouts_record_nothing(self, create, retrieve, expire):
        retrieve.return_value = checkout("cs_3")  # still open
        self.assertFalse(self.client.get("/api/plans/verify/cs_3").json()["paid"])
        # A subscription checkout from onboarding isn't a plan purchase.
        retrieve.return_value = SimpleNamespace(id="cs_4", metadata={"plan_id": "pro"}, payment_status="paid", customer_details=None, amount_total=999)
        self.assertEqual(self.client.get("/api/plans/verify/cs_4").status_code, 404)
        self.assertEqual(self.table.rows, [])

    def test_purchases_list_what_the_account_bought(self, create, retrieve, expire):
        self.table.rows = [
            purchase(CATALOG[0]),
            purchase(CATALOG[1], status="pending", session_id="cs_closed_tab"),  # paid, but the success page never loaded
            purchase(CATALOG[2], status="pending", session_id="cs_abandoned"),
            purchase(CATALOG[3], status="pending", session_id="cs_bank"),  # still being paid
            purchase(CATALOG[4], buyer="user-2", session_id="cs_other"),
        ]
        sessions = {
            "cs_closed_tab": checkout("cs_closed_tab", status="complete", payment_status="paid", amount=CATALOG[1]["price"], plan=CATALOG[1]),
            "cs_abandoned": checkout("cs_abandoned", status="expired", plan=CATALOG[2]),
            "cs_bank": checkout("cs_bank", status="complete", plan=CATALOG[3]),
        }
        retrieve.side_effect = lambda session_id: sessions[session_id]
        response = self.client.get("/api/plans/purchases", headers=SIGNED_IN)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["plan_id"] for item in response.json()["purchases"]], [CATALOG[0]["id"], CATALOG[1]["id"]])
        self.assertEqual({row["stripe_checkout_session_id"]: row["status"] for row in self.table.rows},
                         {"cs_old": "paid", "cs_closed_tab": "paid", "cs_bank": "pending", "cs_other": "paid"})
        expire.assert_not_called()
        self.assertEqual(self.client.get("/api/plans/purchases").status_code, 401)

    def read(self, plan=None, headers=SIGNED_IN):
        return self.client.get(f"/api/plans/{(plan or CATALOG[0])['id']}/book", headers=headers)

    def test_a_book_is_only_for_the_account_that_bought_it(self, create, retrieve, expire):
        self.assertEqual(self.read(headers={}).status_code, 401)
        self.table.rows = [purchase(CATALOG[1]), purchase(CATALOG[0], buyer="user-2")]  # another plan; someone else's copy
        response = self.read(CATALOG[0])
        self.assertEqual(response.status_code, 403)
        self.assertIn("isn't on this account", response.json()["detail"])
        retrieve.assert_not_called()  # nothing pending to check with Stripe

    def test_a_buyer_gets_the_whole_book_compressed(self, create, retrieve, expire):
        plan = CATALOG[0]
        self.table.rows = [purchase(plan)]
        response = self.read(plan, headers={**SIGNED_IN, "Accept-Encoding": "gzip"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual((response.headers["content-encoding"], response.headers["cache-control"]), ("gzip", "private, no-store"))
        book = response.json()
        self.assertEqual((book["format"], book["plan_id"], len(book["pages"])), (1, plan["id"], plan["pages"]))
        self.assertEqual(book["pages"][0]["meta"]["k"], "cover")
        self.assertFalse(response.content.startswith(b"%PDF"))  # a book, never the PDF itself

    def test_a_book_opens_once_stripe_confirms_the_payment(self, create, retrieve, expire):
        plan = CATALOG[1]
        self.table.rows = [purchase(plan, status="pending", session_id="cs_closed_tab")]  # paid; the success page never loaded
        retrieve.return_value = checkout("cs_closed_tab", status="complete", payment_status="paid", amount=plan["price"], plan=plan)
        self.assertEqual(self.read(plan).status_code, 200)
        self.assertEqual(self.table.rows[0]["status"], "paid")
        expire.assert_not_called()

    def test_an_unpaid_checkout_or_stripe_outage_opens_nothing(self, create, retrieve, expire):
        plan = CATALOG[2]
        self.table.rows = [purchase(plan, status="pending", session_id="cs_open")]
        retrieve.return_value = checkout("cs_open", plan=plan)
        self.assertEqual(self.read(plan).status_code, 403)
        retrieve.side_effect = stripe.error.APIConnectionError("Stripe is down")
        with self.assertLogs("app.plan_store", "WARNING"):
            self.assertEqual(self.read(plan).status_code, 403)

    def test_plans_without_a_book_and_database_trouble(self, create, retrieve, expire):
        self.table.rows = [purchase(CATALOG[4])]  # Strength and Power, while it has no book
        with without_book("dryland-power"):
            self.assertEqual(self.client.get("/api/plans/dryland-power/book", headers=SIGNED_IN).status_code, 404)
        self.assertEqual(self.client.get("/api/plans/nothing-here/book", headers=SIGNED_IN).status_code, 404)
        self.table.failing = {"select"}
        self.assertEqual(self.read().status_code, 503)


if __name__ == "__main__":
    unittest.main()
