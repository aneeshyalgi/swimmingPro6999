"""Tokens (app/tokens.py): each AI feature is paid for in tokens, once per request, and its tokens come back when the
request fails; with the token tables missing (or TOKENS_ENABLED off) everything stays free, as before."""
import asyncio
from datetime import date, datetime, timedelta, timezone
import json
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
import stripe
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app import jobs, main, tokens, training, week_coach
from app.main import app
from app.schemas import CoachChatRequest
from app.video_access import Visitor

HEADERS = {"Authorization": "Bearer token"}
PROFILE = {"id": "row-1", "auth_user_id": "user-1", "user_key": "key-1", "recommended_coaches": ["Coach Brad"],
           "stripe_customer_id": "cus_1", "facilities": ["50m Pool"], "main_events": ["100m Freestyle"], "pbs_lcm": {}, "pbs_scm": {}}
RENEWS = "2026-11-25T00:00:00+00:00"
MONDAY = date(2030, 1, 7)
NEW_ACCOUNT = datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc)
OLDER_ACCOUNT = datetime(2025, 3, 1, 9, 0, tzinfo=timezone.utc)
MISSING = APIError({"code": "PGRST202", "message": "Could not find the function public.swimgpt_spend_tokens in the schema cache"})


class Query:
    """A PostgREST query on one in-memory table."""

    def __init__(self, rows: list[dict], failures: dict):
        self.rows, self.failures, self.filters = rows, failures, []
        self.action, self.values, self.key = "select", None, None

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def insert(self, values):
        self.action, self.values = "insert", values
        return self

    def upsert(self, values, on_conflict=None, ignore_duplicates=False):
        self.action, self.values, self.key = "upsert", values, on_conflict
        return self

    def update(self, values):
        self.action, self.values = "update", values
        return self

    def delete(self):
        self.action = "delete"
        return self

    def execute(self):
        if self.action in self.failures:
            raise self.failures[self.action]
        matching = [row for row in self.rows if all(row.get(column) == value for column, value in self.filters)]
        if self.action == "insert":
            self.rows.append(dict(self.values))
        elif self.action == "upsert" and not any(row[self.key] == self.values[self.key] for row in self.rows):
            self.rows.append(dict(self.values))
        elif self.action == "update":
            for row in matching:
                row.update(self.values)
        elif self.action == "delete":
            for row in matching:
                self.rows.remove(row)
        return SimpleNamespace(data=[dict(row) for row in matching])


class FakeTokens:
    """The migration's functions and the purchases table, in memory. (The SQL itself is tested against Postgres.)"""

    def __init__(self):
        self.lots: list[dict] = []
        self.spends: dict[tuple[str, str], dict] = {}
        self.purchases: list[dict] = []
        self.calls: list[tuple[str, dict]] = []
        self.failure: Exception | None = None
        self.table_failures: dict[str, Exception] = {}
        # Each call is made twice, as the database client resends one whose connection dropped after it was done.
        self.resent = False
        # The athlete's Supabase account (tokens.uses_tokens): made after tokens began, so it uses them.
        self.account = SimpleNamespace(created_at=NEW_ACCOUNT, user_metadata={"accepted_terms": "2026-10-26"})
        self.account_failure: Exception | None = None
        self.lookups: list[str] = []
        self.auth = SimpleNamespace(admin=SimpleNamespace(get_user_by_id=self.get_user_by_id))

    # The Supabase client's surface.
    def get_user_by_id(self, account):
        self.lookups.append(account)
        if self.account_failure:
            raise self.account_failure
        return SimpleNamespace(user=self.account)

    def rpc(self, name, params):
        self.calls.append((name, dict(params)))
        failure = self.failure

        def execute():
            if failure:
                raise failure
            function = getattr(self, name.removeprefix("swimgpt_"))
            if self.resent:
                function(**params)
            return SimpleNamespace(data=function(**params))
        return SimpleNamespace(execute=execute)

    def table(self, name):
        assert name == tokens.PURCHASES, name
        return Query(self.purchases, self.table_failures)

    # The functions.
    def _wallet(self, user, monthly):
        if monthly > 0 and not any(lot["user"] == user and lot["kind"] == "monthly" for lot in self.lots):
            self.lots.append({"id": str(uuid4()), "user": user, "kind": "monthly", "ref": "monthly:now", "amount": monthly,
                              "remaining": monthly, "expires_at": RENEWS})

    def _live(self, user):
        return sorted((lot for lot in self.lots if lot["user"] == user and lot["remaining"] > 0),
                      key=lambda lot: (lot["expires_at"], lot["kind"] != "monthly"))

    def spend_tokens(self, p_user, p_ref, p_action, p_amount, p_monthly):
        self._wallet(p_user, p_monthly)
        available = sum(lot["remaining"] for lot in self._live(p_user))
        earlier = self.spends.get((p_user, p_ref))
        if earlier and not earlier["returned"]:
            return {"ok": True, "repeat": True, "balance": available}
        if available < p_amount:
            return {"ok": False, "balance": available, "renews_at": RENEWS}
        owed, drawn = p_amount, []
        for lot in self._live(p_user):
            taken = min(owed, lot["remaining"])
            lot["remaining"] -= taken
            drawn.append((lot, taken))
            owed -= taken
            if not owed:
                break
        self.spends[(p_user, p_ref)] = {"action": p_action, "amount": p_amount, "drawn": drawn, "returned": False,
                                         "at": datetime.now(timezone.utc).isoformat()}
        return {"ok": True, "repeat": False, "balance": available - p_amount}

    def return_tokens(self, p_user, p_ref):
        spent = self.spends.get((p_user, p_ref))
        if not spent or spent["returned"]:
            return {"returned": False}
        for lot, taken in spent["drawn"]:
            lot["remaining"] = min(lot["amount"], lot["remaining"] + taken)
        spent["returned"] = True
        return {"returned": True}

    def credit_tokens(self, p_user, p_kind, p_ref, p_amount, p_months):
        if any(lot["user"] == p_user and lot["ref"] == p_ref for lot in self.lots):
            return {"credited": False}
        self.lots.append({"id": str(uuid4()), "user": p_user, "kind": p_kind, "ref": p_ref, "amount": p_amount, "remaining": p_amount,
                          "expires_at": "2027-01-26T09:00:00+00:00", "months": p_months})
        return {"credited": True}

    def tokens(self, p_user, p_monthly):
        self._wallet(p_user, p_monthly)
        return {
            "period_start": "2026-10-25T00:00:00+00:00", "period_end": RENEWS,
            "lots": [{"kind": lot["kind"], "amount": lot["amount"], "remaining": lot["remaining"], "starts_at": "2026-10-25T00:00:00+00:00",
                      "expires_at": lot["expires_at"]} for lot in self.lots if lot["user"] == p_user],
            "recent": [{"action": spend["action"], "amount": spend["amount"], "at": spend["at"], "returned": spend["returned"]}
                       for (user, _), spend in reversed(self.spends.items()) if user == p_user],
        }

    # What the tests look at.
    def balance(self, user="row-1"):
        return sum(lot["remaining"] for lot in self._live(user))

    def spent(self, user="row-1"):
        """The live spends: (action, tokens)."""
        return [(spend["action"], spend["amount"]) for (owner, _), spend in self.spends.items() if owner == user and not spend["returned"]]


class TokensCase(unittest.TestCase):
    def setUp(self):
        self.db = FakeTokens()
        self.settings = SimpleNamespace(tokens_enabled=True, stripe_secret_key="sk_test_dummy", frontend_url="https://swimgpt.test")
        tokens._missing_until = 0.0
        tokens._settled_at.clear()
        tokens._accounts.clear()
        tokens._agreed.clear()
        tokens._not_agreed.clear()
        self.addCleanup(setattr, tokens, "_missing_until", 0.0)
        for cache in (tokens._accounts, tokens._agreed, tokens._not_agreed):
            self.addCleanup(cache.clear)
        # An older athlete's answer to the Terms with tokens (consents.py): none by default.
        self.terms = None
        self.terms_reads = 0
        for name, options in [("get_supabase_client", {"return_value": self.db}), ("get_settings", {"return_value": self.settings})]:
            patcher = patch.object(tokens, name, **options)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch("app.consents.terms_record", side_effect=self.read_terms)
        patcher.start()
        self.addCleanup(patcher.stop)

    def read_terms(self, profile_id):
        self.terms_reads += 1
        return self.terms

    def patch(self, target, name, **options):
        patcher = patch.object(target, name, **options)
        self.addCleanup(patcher.stop)
        return patcher.start()


class ChargeTests(TokensCase):
    def test_a_request_pays_its_actions_tokens_and_gets_them_back_once_when_it_fails(self):
        receipt = tokens.charge(PROFILE, "swim_week")
        self.assertRegex(receipt.ref, r"^swim_week:[0-9a-f-]{36}$")
        self.assertEqual((receipt.action, receipt.tokens), ("swim_week", 10))
        self.assertEqual(self.db.balance(), tokens.MONTHLY_TOKENS - 10)
        tokens.give_back(receipt)
        tokens.give_back(receipt)
        self.assertEqual(self.db.balance(), tokens.MONTHLY_TOKENS)

    def test_every_request_is_charged_with_its_own_id_never_one_from_the_browser(self):
        first, second = tokens.charge(PROFILE, "coach_chat"), tokens.charge(PROFILE, "coach_chat")
        self.assertNotEqual(first.ref, second.ref)
        self.assertEqual(self.db.spent(), [("coach_chat", 1), ("coach_chat", 1)])

    def test_a_call_the_database_client_resends_is_charged_once_and_can_still_be_given_back(self):
        self.db.resent = True
        receipt = tokens.charge(PROFILE, "swim_week")
        self.assertEqual((self.db.spent(), self.db.balance()), ([("swim_week", 10)], tokens.MONTHLY_TOKENS - 10))
        tokens.give_back(receipt)
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))

    def test_not_enough_tokens_spends_nothing_and_says_what_it_needs(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=4)
        with self.assertRaises(tokens.OutOfTokens) as caught:
            tokens.charge(PROFILE, "swim_week")
        self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(caught.exception.tokens, {"needed": 10, "balance": 4, "renews_at": RENEWS})
        self.assertEqual(caught.exception.detail, "This needs 10 tokens and you have 4 left. Get more in the Token store, or your monthly "
                                                  "tokens renew on 25 November.")
        self.assertEqual((self.db.balance(), self.db.spent()), (4, []))

    def test_one_token_reads_as_one(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=0)
        with self.assertRaises(tokens.OutOfTokens) as caught:
            tokens.charge(PROFILE, "coach_chat")
        self.assertTrue(caught.exception.detail.startswith("This needs 1 token and you have 0 left."))

    def test_charged_gives_the_tokens_back_when_its_work_fails(self):
        with tokens.charged(PROFILE, "race_plan") as receipt:
            self.assertEqual(receipt.tokens, 4)
        self.assertEqual(self.db.balance(), tokens.MONTHLY_TOKENS - 4)
        with self.assertRaises(RuntimeError):
            with tokens.charged(PROFILE, "race_plan"):
                raise RuntimeError("model down")
        self.assertEqual(self.db.spent(), [("race_plan", 4)])

    def test_a_meter_charges_its_run_once(self):
        meter = tokens.Meter(PROFILE)
        meter.charge("swim_replan")
        meter.charge("swim_week")  # a re-plan that turned out to be a whole week was already charged
        self.assertEqual(self.db.spent(), [("swim_replan", 6)])
        meter.give_back()
        meter.give_back()
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))


class AccountTests(TokensCase):
    """Only accounts made under the Terms that brought tokens in use them; older ones keep every AI feature as before."""

    def account(self, made, accepted=None):
        return SimpleNamespace(created_at=made, user_metadata={"accepted_terms": accepted} if accepted else {})

    def test_an_older_account_is_never_charged_and_its_tokens_are_never_touched(self):
        self.db.account = self.account(OLDER_ACCOUNT, accepted="2026-10-26")
        self.assertIsNone(tokens.charge(PROFILE, "swim_week"))
        meter = tokens.Meter(PROFILE)
        meter.charge("swim_week")
        meter.give_back()
        with tokens.charged(PROFILE, "race_plan") as receipt:
            self.assertIsNone(receipt)
        self.assertEqual((self.db.calls, self.db.lots), ([], []))

    def test_which_accounts_use_tokens(self):
        start, week = tokens.TOKENS_FROM, tokens.CHANGEOVER
        second = timedelta(seconds=1)
        cases = [
            (start - second, "2026-10-26", False),         # made before tokens began, whatever it says it accepted
            (OLDER_ACCOUNT, None, False),
            (start, "2026-10-26", True),                   # signed up under the Terms with tokens
            (start + timedelta(hours=5), "2026-10-19", False),  # its sign-up page was opened before they were live
            (start + timedelta(days=2), None, False),
            (start + week - second, "2026-10-19", False),
            (start + week, "2026-10-19", True),            # after the changeover, only when it was made counts
            (start + week, None, True),
            (NEW_ACCOUNT, None, True),
        ]
        for made, accepted, uses in cases:
            with self.subTest(made=made, accepted=accepted):
                self.assertIs(tokens.account_uses_tokens(self.account(made, accepted)), uses)
        self.assertTrue(tokens.account_uses_tokens(self.account("2026-11-20T09:00:00.123456Z")))   # as Supabase writes it
        self.assertFalse(tokens.account_uses_tokens(self.account(datetime(2026, 10, 25, 23, 0))))  # without a time zone: UTC
        self.assertTrue(tokens.account_uses_tokens(self.account(datetime(2026, 11, 20, 9, 0))))
        self.assertFalse(tokens.account_uses_tokens(None))
        self.assertFalse(tokens.account_uses_tokens(self.account(None)))

    def test_an_account_is_looked_up_once(self):
        tokens.charge(PROFILE, "coach_chat")
        tokens.charge(PROFILE, "coach_chat")
        self.assertEqual(self.db.lookups, ["user-1"])
        self.assertEqual(self.db.spent(), [("coach_chat", 1), ("coach_chat", 1)])

    def test_an_account_that_cant_be_looked_up_is_free_that_time_and_looked_up_again(self):
        self.db.account_failure = httpx.ConnectError("down")
        with self.assertLogs("app.tokens", level="WARNING") as logged:
            self.assertIsNone(tokens.charge(PROFILE, "coach_chat"))
        self.assertNotIn("user-1", "".join(logged.output))
        self.db.account_failure = None
        self.assertIsNotNone(tokens.charge(PROFILE, "coach_chat"))
        self.assertEqual(self.db.lookups, ["user-1", "user-1"])

    def test_an_older_account_that_agreed_to_the_terms_uses_tokens(self):
        self.db.account = self.account(OLDER_ACCOUNT)
        self.terms = {"version": "2026-10-26", "accepted_at": "2026-10-27T09:00:00+00:00", "via": "dashboard"}
        self.assertIsNotNone(tokens.charge(PROFILE, "swim_week"))
        self.assertEqual(self.db.spent(), [("swim_week", 10)])
        self.terms = {"declined_at": "2026-10-27T09:00:00+00:00", "ends_at": "2026-11-20T09:00:00+00:00", "cancelled": True}
        tokens._agreed.clear()
        self.assertIsNone(tokens.charge(PROFILE, "swim_week"))  # not agreeing keeps the AI features as they were

    def test_an_agreement_is_looked_up_again_after_a_minute_and_is_kept_for_good(self):
        self.db.account = self.account(OLDER_ACCOUNT)
        self.assertIsNone(tokens.charge(PROFILE, "coach_chat"))
        self.terms = {"version": "2026-10-26", "accepted_at": "2026-10-27T09:00:00+00:00", "via": "dashboard"}
        self.assertIsNone(tokens.charge(PROFILE, "coach_chat"))   # this server still knows the athlete hadn't
        self.assertEqual(self.terms_reads, 1)
        tokens._not_agreed["row-1"] = 0.0                         # a minute later
        self.assertIsNotNone(tokens.charge(PROFILE, "coach_chat"))
        self.terms = None
        self.assertIsNotNone(tokens.charge(PROFILE, "coach_chat"))
        self.assertEqual(self.terms_reads, 2)

    def test_agreeing_on_this_server_starts_tokens_at_once(self):
        self.db.account = self.account(OLDER_ACCOUNT)
        self.assertIsNone(tokens.charge(PROFILE, "coach_chat"))
        tokens.note_agreement("row-1")
        self.assertIsNotNone(tokens.charge(PROFILE, "coach_chat"))

    def test_which_accounts_must_agree_before_subscribing(self):
        older, new = self.account(OLDER_ACCOUNT), self.account(NEW_ACCOUNT)
        self.assertTrue(tokens.terms_required(older, PROFILE))
        self.assertFalse(tokens.terms_required(new, PROFILE))
        self.terms = {"version": "2026-10-26", "accepted_at": "2026-10-27T09:00:00+00:00", "via": "checkout"}
        tokens._not_agreed.clear()
        self.assertFalse(tokens.terms_required(older, PROFILE))
        self.settings.tokens_enabled = False
        tokens._agreed.clear()
        self.terms = None
        self.assertFalse(tokens.terms_required(older, PROFILE))

    def test_a_profile_without_an_account_isnt_charged(self):
        self.assertIsNone(tokens.charge({**PROFILE, "auth_user_id": None}, "coach_chat"))
        self.assertEqual((self.db.lookups, self.db.calls), ([], []))


class TokensOffTests(TokensCase):
    def test_before_the_migration_everything_is_free_and_the_database_is_asked_again_a_minute_later(self):
        self.db.failure = MISSING
        with self.assertLogs("app.tokens", level="WARNING") as logged:
            self.assertIsNone(tokens.charge(PROFILE, "swim_week"))
        self.assertIn("2026-10-26_add_tokens.sql", logged.output[0])
        self.assertIsNone(tokens.charge(PROFILE, "swim_week"))
        self.assertEqual(len(self.db.calls), 1)       # not asked again for a minute
        self.assertFalse(tokens.available())
        tokens._missing_until = 0.0                   # a minute later, the migration has run
        self.db.failure = None
        self.assertIsNotNone(tokens.charge(PROFILE, "swim_week"))

    def test_turned_off_nothing_is_charged(self):
        self.settings.tokens_enabled = False
        self.assertIsNone(tokens.charge(PROFILE, "swim_week"))
        self.assertEqual(self.db.calls, [])

    def test_a_database_that_cant_be_reached_never_blocks_anyone(self):
        self.db.failure = httpx.ConnectError("down")
        with self.assertLogs("app.tokens", level="WARNING"):
            self.assertIsNone(tokens.charge(PROFILE, "coach_chat"))
        self.assertTrue(tokens.available())           # a blip: tried again on the next request
        self.db.failure = APIError({"code": "XX000", "message": "internal error"})
        with self.assertLogs("app.tokens", level="ERROR"):
            self.assertIsNone(tokens.charge(PROFILE, "coach_chat"))

    def test_tokens_that_cant_be_given_back_are_logged_not_raised(self):
        receipt = tokens.charge(PROFILE, "coach_chat")
        self.db.failure = httpx.ReadError("dropped")
        with self.assertLogs("app.tokens", level="ERROR") as logged:
            tokens.give_back(receipt)
        self.assertIn("couldn't be given back", logged.output[-1])
        self.assertNotIn("row-1", "".join(logged.output))


class ReplyStream:
    """A streamed reply: its pieces, then (optionally) a failure partway."""

    def __init__(self, pieces, failure=None):
        self.pieces, self.failure = pieces, failure

    def __iter__(self):
        for piece in self.pieces:
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))])
        if self.failure:
            raise self.failure

    def close(self):
        pass


class CoachReplyTests(TokensCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)
        self.openai = MagicMock()
        self.openai.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Swim easy."))])
        for name, value in [("get_authenticated_profile", dict(PROFILE)), ("recent_athlete_feedback", []), ("coach_line", ""),
                            ("chat_context", ("PROGRAM", [], ["Coach Brad"])), ("recent_race_results", []), ("pacing_context", {}),
                            ("_chat_openai", self.openai)]:
            self.patch(main, name, return_value=value)
        self.patch(main, "settings", new=SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-4o-mini", openai_voice_model="gpt-4o-mini",
                                                         openai_reasoning_effort="low"))
        patcher = patch.dict(main._call_context, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def ask(self, path="/api/coach-chat", **body):
        return self.client.post(path, headers=HEADERS, json={"user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "Hi", **body})

    def live(self, pieces, failure=None, **body):
        self.openai.chat.completions.create.return_value = ReplyStream(pieces, failure)
        response = self.ask("/api/coach-chat/live", mode="conversation", **body)
        return response, [json.loads(line) for line in response.text.splitlines() if line.strip()] if response.status_code == 200 else []

    def test_each_typed_message_costs_a_token(self):
        self.assertEqual(self.ask().status_code, 200)
        self.assertEqual(self.ask(message="And tomorrow?").status_code, 200)
        self.assertEqual(self.db.spent(), [("coach_chat", 1), ("coach_chat", 1)])

    def test_an_id_from_the_browser_cant_make_a_message_free(self):
        for _ in range(2):
            self.assertEqual(self.ask(message_id="same-id", ref="coach_chat:same").status_code, 200)
        self.assertEqual(self.db.spent(), [("coach_chat", 1), ("coach_chat", 1)])

    def test_out_of_tokens_the_coach_isnt_asked_and_the_page_is_told_why(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=0)
        response = self.ask()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["tokens"], {"needed": 1, "balance": 0, "renews_at": RENEWS})
        self.assertIn("Get more in the Token store", response.json()["detail"])
        self.openai.chat.completions.create.assert_not_called()

    def test_a_reply_that_doesnt_come_gives_its_token_back(self):
        self.openai.chat.completions.create.side_effect = RuntimeError("model down")
        self.assertEqual(self.ask().status_code, 502)
        self.openai.chat.completions.create.side_effect = None
        self.openai.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=""))])
        self.assertEqual(self.ask().status_code, 502)
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))
        # Asked again once the coach is back, the message is paid for after all.
        self.openai.chat.completions.create.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Hi."))])
        self.assertEqual(self.ask().status_code, 200)
        self.assertEqual(self.db.spent(), [("coach_chat", 1)])

    def test_someone_elses_profile_costs_nothing(self):
        self.assertEqual(self.client.post("/api/coach-chat", headers=HEADERS, json={
            "user_key": "key-2", "selected_coaches": ["Coach Brad"], "message": "Hi"}).status_code, 403)
        self.assertEqual(self.db.calls, [])

    def test_a_call_reply_costs_a_token_as_it_starts(self):
        response, lines = self.live(["Eight twenty-fives, ", "fast."])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(lines[-1]["done"])
        self.assertEqual(self.db.spent(), [("voice_reply", 1)])

    def test_a_call_reply_that_breaks_off_or_cant_start_gives_its_token_back(self):
        with self.assertLogs("app.main", level="ERROR"):
            _, lines = self.live(["Start with"], failure=RuntimeError("reset"))
        self.assertIn("error", lines[-1])
        _, lines = self.live([])
        self.assertEqual(lines, [{"error": "The coach returned an empty response."}])
        self.openai.chat.completions.create.side_effect = RuntimeError("model down")
        self.assertEqual(self.ask("/api/coach-chat/live", mode="conversation").status_code, 502)
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))

    def call_reply(self, pieces):
        """The live route's response, as a server gets it, before any of it is sent."""
        self.openai.chat.completions.create.return_value = ReplyStream(pieces)
        return main.coach_chat_live(CoachChatRequest(user_key="key-1", selected_coaches=["Coach Brad"], message="Hi", mode="conversation"),
                                    "Bearer token")

    def test_a_call_reply_none_of_which_reaches_the_athlete_is_free(self):
        response = self.call_reply(["Eight twenty-fives, ", "fast."])
        self.assertEqual(self.db.spent(), [("voice_reply", 1)])
        asyncio.run(response.background())  # the call moved on (they went on talking, or hung up) before it was sent
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))

    def test_a_call_reply_that_began_to_reach_the_athlete_is_theirs(self):
        response = self.call_reply(["Eight twenty-fives, ", "fast."])

        async def hear_the_start_then_leave():
            await response.body_iterator.__anext__()
            await response.body_iterator.__anext__()  # asked for more: the first piece was sent
            await response.background()
        asyncio.run(hear_the_start_then_leave())
        self.assertEqual(self.db.spent(), [("voice_reply", 1)])

    def test_a_call_reply_that_failed_is_given_back_once(self):
        response = self.call_reply([])

        async def hear_it_all():
            lines = [line async for line in response.body_iterator]
            await response.background()
            return lines
        self.assertEqual(asyncio.run(hear_it_all()), ['{"error": "The coach returned an empty response."}\n'])
        self.assertEqual(sum(name == "swimgpt_return_tokens" for name, _ in self.db.calls), 1)
        self.assertEqual(self.db.balance(), tokens.MONTHLY_TOKENS)

    def test_out_of_tokens_on_a_call_nothing_streams(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=0)
        response, _ = self.live(["Hi."])
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["tokens"]["needed"], 1)
        self.openai.chat.completions.create.assert_not_called()


class FakeRequest:
    """The HTTP request of a generation: `leave()` is the browser going away."""

    def __init__(self):
        self.gone = threading.Event()

    def leave(self):
        self.gone.set()

    async def receive(self):
        while not self.gone.is_set():
            await asyncio.sleep(0.02)
        return {"type": "http.disconnect"}


class GenerationTests(TokensCase):
    def setUp(self):
        super().setUp()
        jobs._running.clear()
        jobs._by_id.clear()

    def generate(self, work, request=None):
        return asyncio.run(jobs.run_generation(request or FakeRequest(), PROFILE["id"], "swim", MONDAY, str(uuid4()), work,
                                               meter=tokens.Meter(PROFILE)))

    def wait_for(self, condition):
        deadline = time.monotonic() + 3
        while not condition() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(condition())

    def test_a_week_is_charged_once_as_the_coach_starts_writing_it(self):
        def work():
            jobs.charge("swim_week")
            jobs.charge("swim_week")
            return "week"
        self.assertEqual(self.generate(work), "week")
        self.assertEqual(self.db.spent(), [("swim_week", 10)])

    def test_a_week_that_needs_no_writing_costs_nothing(self):
        self.assertEqual(self.generate(lambda: "already generated"), "already generated")
        self.assertEqual(self.db.calls, [])

    def test_a_week_that_fails_gives_its_tokens_back(self):
        def work():
            jobs.charge("swim_week")
            raise RuntimeError("model down")
        with self.assertRaises(RuntimeError):
            self.generate(work)
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))

    def test_a_week_the_athlete_leaves_gives_its_tokens_back(self):
        request = FakeRequest()

        def work():
            jobs.charge("swim_week")
            request.leave()
            job = jobs.current()
            while not job.cancelled.is_set():
                time.sleep(0.01)
            jobs.checkpoint()
        with self.assertRaises(HTTPException) as caught:
            self.generate(work, request)
        self.assertEqual(caught.exception.status_code, 409)
        self.wait_for(lambda: self.db.balance() == tokens.MONTHLY_TOKENS)
        self.assertEqual(self.db.spent(), [])

    def test_out_of_tokens_the_week_isnt_written(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=9)
        written = []

        def work():
            jobs.charge("swim_week")
            written.append(True)
        with self.assertRaises(tokens.OutOfTokens) as caught:
            self.generate(work)
        self.assertEqual(caught.exception.tokens["needed"], 10)
        self.assertEqual((written, self.db.balance()), ([], 9))

    def test_the_week_routes_charge_the_athlete(self):
        client = TestClient(app)
        self.patch(training, "get_authenticated_profile", return_value=dict(PROFILE))

        def build(profile, week_start):
            jobs.charge("swim_week")
            return {"week_start": week_start.isoformat()}

        def replan(profile, week_start):
            jobs.charge("swim_replan")
            return {"replanned": True}
        self.patch(training, "build_week", side_effect=build)
        self.patch(training, "replan_week", side_effect=replan)
        # The same job id twice (a page could send any): each run is paid for.
        job_id = str(uuid4())
        for path in ("generate", "generate", "replan"):
            response = client.post(f"/api/training/week/{path}", headers=HEADERS, json={"week_start": MONDAY.isoformat(), "job_id": job_id})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(sorted(self.db.spent()), [("swim_replan", 6), ("swim_week", 10), ("swim_week", 10)])
        self.patch(tokens, "MONTHLY_TOKENS", new=0)
        self.db.lots.clear()
        response = client.post("/api/training/week/generate", headers=HEADERS, json={"week_start": MONDAY.isoformat()})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["tokens"]["needed"], 10)


class WeekCoachTests(TokensCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)
        self.patch(week_coach, "get_authenticated_profile", return_value=dict(PROFILE))
        self.patch(week_coach, "_now", return_value=datetime(2030, 1, 8, 9, tzinfo=timezone.utc))
        self.patch(week_coach, "load_board", return_value=MagicMock())
        self.patch(week_coach, "_grounding", return_value=("ATHLETE", []))
        self.patch(week_coach, "coach_line", return_value="")
        self.patch(week_coach, "athlete_coach", return_value="Coach Brad")
        self.patch(week_coach, "plan_prompt", return_value="PROMPT")
        self.patch(week_coach, "plan_notes", return_value=[])
        self.generate = self.patch(training, "generate_structured")

    def chat(self, **body):
        response = self.client.post("/api/training/week-coach/chat", headers=HEADERS,
                                    json={"kind": "swim", "week_start": MONDAY.isoformat(), "message": "Make Friday easier", **body})
        return response, [json.loads(line) for line in response.text.splitlines() if line.strip()] if response.status_code == 200 else []

    def test_each_message_costs_its_tokens(self):
        self.generate.return_value = (week_coach.CoachAnswer(message="Nothing to change.", changes=[], elsewhere=False), [])
        _, events = self.chat()
        self.assertEqual([event["type"] for event in events], ["plan", "done"])
        self.chat(message="And Saturday?")
        self.assertEqual(self.db.spent(), [("week_coach", 3), ("week_coach", 3)])

    def test_an_answer_that_cant_be_given_gives_its_tokens_back(self):
        self.generate.side_effect = HTTPException(status_code=503, detail="Out of time.")
        _, events = self.chat()
        self.assertEqual(events, [{"type": "error", "detail": "Out of time."}])
        self.generate.side_effect = RuntimeError("model down")
        with self.assertLogs("app.week_coach", level="ERROR"):
            _, events = self.chat()
        self.assertEqual(events[0]["type"], "error")
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))

    def test_out_of_tokens_the_coach_isnt_asked(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=2)
        response, _ = self.chat()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["tokens"], {"needed": 3, "balance": 2, "renews_at": RENEWS})
        self.generate.assert_not_called()


class RacePlanTests(TokensCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)
        self.meet = {"id": str(uuid4()), "name": "Nationals", "date": "2030-03-01", "pool_length": 50, "events": ["100m Freestyle"], "races": []}
        self.patch(training, "get_authenticated_profile", return_value=dict(PROFILE))
        self.patch(training, "owned_competition", side_effect=lambda profile, identifier: self.meet)
        self.save = self.patch(training, "save_record")
        self.generate = self.patch(training, "generate_structured", return_value=({"races": [{
            "event": "100m Freestyle", "target_time": None, "target_splits": [], "race_strategy": "Even.", "stroke_rate_target": None,
            "underwater_target": None, "breakout_target": None, "technical_cues": ["Long."], "mental_cues": ["Calm."]}]}, ["Coach Brad"]))

    def plan(self):
        return self.client.post(f"/api/training/competitions/{self.meet['id']}/plan", headers=HEADERS)

    def test_race_plans_cost_their_tokens(self):
        response = self.plan()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.db.spent(), [("race_plan", 4)])
        self.save.assert_called()

    def test_plans_already_made_cost_nothing(self):
        self.meet["races"] = [{"event": "100m Freestyle"}]
        self.assertEqual(self.plan().status_code, 200)
        self.assertEqual(self.db.calls, [])

    def test_plans_that_fail_give_their_tokens_back(self):
        self.generate.return_value = ({"races": []}, [])  # don't match the meet's events
        self.assertEqual(self.plan().status_code, 502)
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))
        self.save.assert_not_called()


class VideoAnalysisTests(TokensCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)
        self.visitor = Visitor(signed_in=True, subscribed=True, records={"account": "account/user-1"}, profile=dict(PROFILE))
        self.patch(main, "identify", side_effect=lambda request, authorization: self.visitor)
        self.patch(main, "settings", new=SimpleNamespace(openai_api_key="test-openai"))
        self.claims = self.patch(main, "start_analysis", side_effect=lambda visitor: [] if visitor.subscribed else ["browser/1"])
        self.released = self.patch(main, "release")
        self.brief = self.patch(main, "_coach_brief", return_value={"headline": "Catch earlier"})

    def analyse(self):
        return self.client.post("/api/video-analysis", json={"stroke": "Freestyle"}, headers=HEADERS)

    def test_a_subscribers_analysis_costs_tokens(self):
        self.assertEqual(self.analyse().status_code, 200)
        self.assertEqual(self.db.spent(), [("video_analysis", 5)])

    def test_the_free_analysis_costs_no_tokens(self):
        self.visitor = Visitor(signed_in=False, subscribed=False, records={"browser": "browser/1"})
        self.assertEqual(self.analyse().status_code, 200)
        self.assertEqual(self.db.calls, [])

    def test_a_failed_analysis_gives_its_tokens_back(self):
        self.brief.side_effect = RuntimeError("model down")
        with self.assertLogs("app.main", level="ERROR"):
            self.assertEqual(self.analyse().status_code, 500)
        self.assertEqual((self.db.spent(), self.db.balance()), ([], tokens.MONTHLY_TOKENS))

    def test_out_of_tokens_nothing_is_analysed(self):
        self.patch(tokens, "MONTHLY_TOKENS", new=1)
        response = self.analyse()
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["tokens"]["needed"], 5)
        self.brief.assert_not_called()


def checkout_session(**changes):
    session = SimpleNamespace(id="cs_1", url="https://checkout.stripe.test/cs_1", payment_status="paid", status="complete", amount_total=2599,
                              currency="usd", metadata={"kind": "tokens", "pack": "plus", "tokens": "300", "user_id": "row-1"})
    for key, value in changes.items():
        setattr(session, key, value)
    return session


class StoreTests(TokensCase):
    def setUp(self):
        super().setUp()
        self.client = TestClient(app)
        self.patch(tokens, "get_authenticated_profile", return_value=dict(PROFILE))
        self.patch(tokens, "get_authenticated_user", return_value=SimpleNamespace(id="user-1"))
        self.patch(tokens, "latest_profile_row", return_value=dict(PROFILE))
        self.create = self.patch(stripe.checkout.Session, "create", return_value=checkout_session(payment_status="unpaid", status="open"))
        self.retrieve = self.patch(stripe.checkout.Session, "retrieve", return_value=checkout_session())
        self.expire = self.patch(stripe.checkout.Session, "expire")

    def test_the_store_shows_the_balance_costs_packs_and_latest_spends(self):
        tokens.charge(PROFILE, "swim_week")
        self.db.credit_tokens("row-1", "bought", "bought:cs_0", 100, 2)
        tokens_left = self.client.get("/api/tokens", headers=HEADERS).json()
        self.assertEqual(tokens_left["balance"], tokens.MONTHLY_TOKENS - 10 + 100)
        self.assertEqual(tokens_left["monthly"], {"tokens": tokens.MONTHLY_TOKENS, "remaining": tokens.MONTHLY_TOKENS - 10, "renews_at": RENEWS})
        self.assertEqual(tokens_left["bought"], [{"tokens": 100, "remaining": 100, "expires_at": "2027-01-26T09:00:00+00:00", "gift": False}])
        self.assertEqual(tokens_left["recent"][0]["label"], "Swim week generated")
        self.assertEqual({item["action"]: item["tokens"] for item in tokens_left["costs"]}["swim_week"], 10)
        self.assertNotIn("daily_plan", [item["action"] for item in tokens_left["costs"]])
        self.assertEqual([pack["id"] for pack in tokens_left["packs"]], list(tokens.PACKS))
        self.assertEqual((tokens_left["monthly_tokens"], tokens_left["bought_months"]), (tokens.MONTHLY_TOKENS, 2))

    def test_before_the_migration_the_store_is_hidden(self):
        self.db.failure = MISSING
        with self.assertLogs("app.tokens", level="WARNING"):
            self.assertEqual(self.client.get("/api/tokens", headers=HEADERS).json(), {"available": False})
        self.assertEqual(self.client.post("/api/tokens/checkout", headers=HEADERS, json={"pack": "plus"}).status_code, 503)
        self.create.assert_not_called()

    def test_buying_a_pack_opens_checkout_and_records_it_first(self):
        response = self.client.post("/api/tokens/checkout", headers=HEADERS, json={"pack": "plus", "start_now": True})
        self.assertEqual(response.json(), {"checkout_url": "https://checkout.stripe.test/cs_1"})
        options = self.create.call_args.kwargs
        self.assertEqual((options["mode"], options["customer"], options["payment_method_types"]), ("payment", "cus_1", ["card"]))
        self.assertEqual(options["line_items"][0]["price_data"]["unit_amount"], 2599)
        self.assertEqual(options["line_items"][0]["price_data"]["product_data"]["name"], "150 SwimGPT tokens")
        self.assertEqual(options["success_url"], "https://swimgpt.test/dashboard?tokens=paid&session_id={CHECKOUT_SESSION_ID}")
        self.assertEqual({key: options["metadata"][key] for key in ("kind", "pack", "tokens", "user_id")},
                         {"kind": "tokens", "pack": "plus", "tokens": "150", "user_id": "row-1"})
        self.assertIn("start_now", options["metadata"])
        self.assertEqual(self.db.purchases, [{"user_id": "row-1", "stripe_checkout_session_id": "cs_1", "pack": "plus", "tokens": 150,
                                              "amount": 2599, "currency": "usd", "status": "pending"}])

    def test_an_older_account_has_no_store_and_cant_buy_tokens(self):
        self.db.account = SimpleNamespace(created_at=OLDER_ACCOUNT, user_metadata={})
        self.assertEqual(self.client.get("/api/tokens", headers=HEADERS).json(), {"available": False})
        response = self.client.post("/api/tokens/checkout", headers=HEADERS, json={"pack": "plus", "start_now": True})
        self.assertEqual(response.status_code, 409)
        self.assertIn("without tokens", response.json()["detail"])
        self.create.assert_not_called()
        self.assertEqual((self.db.calls, self.db.purchases), ([], []))

    def test_an_unknown_pack_isnt_sold(self):
        self.assertEqual(self.client.post("/api/tokens/checkout", headers=HEADERS, json={"pack": "free"}).status_code, 404)
        self.create.assert_not_called()

    def test_a_checkout_that_cant_be_recorded_is_closed(self):
        self.db.table_failures["insert"] = APIError({"code": "PGRST205", "message": "missing"})
        with self.assertLogs("app.tokens", level="ERROR"):
            response = self.client.post("/api/tokens/checkout", headers=HEADERS, json={"pack": "plus"})
        self.assertEqual(response.status_code, 503)
        self.expire.assert_called_once_with("cs_1")

    def test_a_customer_gone_from_stripe_is_billed_afresh(self):
        self.create.side_effect = [stripe.error.InvalidRequestError("No such customer", param="customer"), checkout_session(status="open")]
        self.assertEqual(self.client.post("/api/tokens/checkout", headers=HEADERS, json={"pack": "starter"}).status_code, 200)
        self.assertNotIn("customer", self.create.call_args.kwargs)

    def test_a_paid_purchase_adds_its_tokens_once(self):
        for _ in range(2):
            response = self.client.get("/api/tokens/verify/cs_1", headers=HEADERS)
            self.assertEqual(response.json(), {"paid": True, "added": True, "tokens": 300})
        bought = [lot for lot in self.db.lots if lot["kind"] == "bought"]
        self.assertEqual([(lot["ref"], lot["amount"], lot["months"]) for lot in bought], [("bought:cs_1", 300, 2)])
        self.assertEqual(self.db.purchases[0]["status"], "paid")

    def test_someone_elses_or_an_unpaid_purchase_adds_nothing(self):
        self.retrieve.return_value = checkout_session(metadata={"kind": "tokens", "pack": "plus", "tokens": "300", "user_id": "row-2"})
        self.assertEqual(self.client.get("/api/tokens/verify/cs_1", headers=HEADERS).status_code, 404)
        self.retrieve.return_value = checkout_session(metadata={"kind": "pdf_plan", "user_id": "row-1"})
        self.assertEqual(self.client.get("/api/tokens/verify/cs_1", headers=HEADERS).status_code, 404)
        self.retrieve.return_value = checkout_session(payment_status="unpaid", status="open")
        self.assertEqual(self.client.get("/api/tokens/verify/cs_1", headers=HEADERS).json(), {"paid": False, "added": False, "tokens": 300})
        self.assertEqual([lot for lot in self.db.lots if lot["kind"] == "bought"], [])

    def test_a_purchase_that_cant_be_added_yet_is_added_later(self):
        self.db.purchases.append({"user_id": "row-1", "stripe_checkout_session_id": "cs_1", "status": "pending"})
        self.db.failure = httpx.ConnectError("down")
        with self.assertLogs("app.tokens", level="WARNING"):
            self.assertEqual(self.client.get("/api/tokens/verify/cs_1", headers=HEADERS).json()["added"], False)
        self.db.failure = None
        # The athlete's next look at their tokens settles it with Stripe.
        self.assertEqual(self.client.get("/api/tokens", headers=HEADERS).json()["balance"], tokens.MONTHLY_TOKENS + 300)
        self.assertEqual(self.db.purchases[0]["status"], "paid")

    def test_pending_purchases_are_settled_at_most_every_half_minute(self):
        self.db.purchases.append({"user_id": "row-1", "stripe_checkout_session_id": "cs_old", "status": "pending"})
        self.retrieve.return_value = checkout_session(id="cs_old", payment_status="unpaid", status="expired")
        self.client.get("/api/tokens", headers=HEADERS)
        self.assertEqual(self.db.purchases, [])          # abandoned: removed
        self.db.purchases.append({"user_id": "row-1", "stripe_checkout_session_id": "cs_new", "status": "pending"})
        self.client.get("/api/tokens", headers=HEADERS)
        self.assertEqual(self.retrieve.call_count, 1)    # not asked again so soon


if __name__ == "__main__":
    unittest.main()
