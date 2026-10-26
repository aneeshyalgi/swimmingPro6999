"""Saved coach chats: each athlete's conversation with their coach is saved after each exchange and comes back on every
device; starting over ("New chat", "Clear history") deletes it everywhere and nothing from before comes back; until the
tables exist nothing changes. The coach is given the conversation's last 50 messages, the older ones shortened."""
from __future__ import annotations

import itertools
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from app import coach_history, main, tokens
from app.coach_history import CONVERSATIONS, KEPT, MESSAGES, NOT_YOUR_COACH, conversation_history
from app.main import app
from app.schemas import CoachChatMessage

HEADERS = {"Authorization": "Bearer token"}
PROFILE = {"id": "profile-1", "user_key": "key-1", "recommended_coaches": ["Coach Brad"]}
A, B = "conversation-a-0001", "conversation-b-0002"
MISSING = APIError({"code": "PGRST205", "message": "Could not find the table 'public.user_coach_messages' in the schema cache"})
BROKEN = APIError({"code": "23514", "message": "new row violates check constraint", "details": "Failing row contains (my secret words)"})
_clock = itertools.count()


def _now_iso() -> str:
    # Rows made one after another get later times, as the database's now() would across requests.
    return (datetime(2026, 10, 25, 12, tzinfo=timezone.utc) + timedelta(microseconds=next(_clock))).isoformat()


class FakeDatabase:
    """The tables as PostgREST answers for them: filters, order, limit/offset, upsert on a unique key (merging or
    ignoring duplicates), update and delete. `hook(table, action)` runs before each query, to make things happen
    meanwhile (another device)."""

    DEFAULTS = {
        CONVERSATIONS: lambda: {"started_at": _now_iso(), "reset_at": None},
        MESSAGES: lambda: {"id": str(uuid.uuid4()), "voice": False, "plan": None, "created_at": _now_iso()},
    }

    def __init__(self, tables=(CONVERSATIONS, MESSAGES)):
        self.rows = {name: [] for name in tables}
        self.hook = None
        self.failure = None

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.name = db, table
        self.action, self.payload, self.columns = "select", None, None
        self.filters, self.orders, self.limit_to, self.offset = [], [], None, 0
        self.negate = False
        self.on_conflict, self.ignore = "", False

    # ---- what's asked
    def select(self, columns):
        self.columns = [column.strip() for column in columns.split(",")]
        return self

    def insert(self, rows):
        self.action, self.payload = "insert", rows if isinstance(rows, list) else [rows]
        return self

    def upsert(self, rows, on_conflict="", ignore_duplicates=False):
        self.action, self.payload = "upsert", rows if isinstance(rows, list) else [rows]
        self.on_conflict, self.ignore = on_conflict, ignore_duplicates
        return self

    def update(self, values):
        self.action, self.payload = "update", values
        return self

    def delete(self):
        self.action = "delete"
        return self

    @property
    def not_(self):
        self.negate = True
        return self

    def _filter(self, test):
        negate, self.negate = self.negate, False
        self.filters.append((lambda row: not test(row)) if negate else test)
        return self

    def eq(self, column, value):
        return self._filter(lambda row: row.get(column) == value)

    def neq(self, column, value):
        return self._filter(lambda row: row.get(column) != value)

    def in_(self, column, values):
        values = list(values)
        return self._filter(lambda row: row.get(column) in values)

    def order(self, column, desc=False):
        self.orders.append((column, desc))
        return self

    def limit(self, size):
        self.limit_to = size
        return self

    def range(self, start, end):
        self.offset, self.limit_to = start, end - start + 1
        return self

    # ---- the answer
    def execute(self):
        if self.db.hook:
            self.db.hook(self.name, self.action)
        if self.db.failure:
            raise self.db.failure
        if self.name not in self.db.rows:
            raise APIError({"code": "PGRST205", "message": f"Could not find the table 'public.{self.name}' in the schema cache"})
        rows = self.db.rows[self.name]
        matching = [row for row in rows if all(test(row) for test in self.filters)]
        if self.action == "select":
            for column, desc in reversed(self.orders):
                matching.sort(key=lambda row: row.get(column) or "", reverse=desc)
            matching = matching[self.offset:][:self.limit_to] if self.limit_to is not None else matching[self.offset:]
            return SimpleNamespace(data=[{column: row.get(column) for column in self.columns} for row in matching])
        if self.action == "delete":
            self.db.rows[self.name] = [row for row in rows if row not in matching]
            return SimpleNamespace(data=[dict(row) for row in matching])
        if self.action == "update":
            for row in matching:
                row.update(self.payload)
            return SimpleNamespace(data=[dict(row) for row in matching])
        keys = [key.strip() for key in self.on_conflict.split(",") if key.strip()]
        written = []
        for new in self.payload:
            existing = next((row for row in rows if keys and all(row.get(key) == new.get(key) for key in keys)), None)
            if existing is None:
                row = {**FakeDatabase.DEFAULTS[self.name](), **new}
                rows.append(row)
                written.append(dict(row))
            elif self.action == "insert":
                raise APIError({"code": "23505", "message": "duplicate key value violates unique constraint"})
            elif not self.ignore:
                existing.update(new)
                written.append(dict(existing))
        return SimpleNamespace(data=written)


def message(number, role=None, **extra):
    """The chat's message `number`, written a minute after the one before."""
    at = datetime(2026, 10, 25, 9, tzinfo=timezone.utc) + timedelta(minutes=number)
    return {"id": f"1729000000{number:03d}-m{number:03d}", "role": role or ("user" if number % 2 else "assistant"),
            "content": f"Message {number}", "at": at.isoformat(), **extra}


class HistoryApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = FakeDatabase()
        self.profile = dict(PROFILE)
        for target, options in [
            ("app.coach_history.get_authenticated_profile", {"side_effect": lambda authorization: self.profile}),
            ("app.coach_history.get_supabase_client", {"return_value": self.db}),
        ]:
            patcher = patch(target, **options)
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self, *numbers, conversation=A, coach="Coach Brad", **extra):
        return self.client.post("/api/coach-chat/history", headers=HEADERS, json={
            "coach": coach, "conversation": conversation, "messages": [message(number, **extra) for number in numbers]})

    def reset(self, conversations, everything=False):
        return self.client.post("/api/coach-chat/history/reset", headers=HEADERS, json={"conversations": conversations, "everything": everything})

    def thread(self):
        response = self.client.get("/api/coach-chat/history", headers=HEADERS)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_until_the_tables_exist_saved_chats_are_unavailable_and_nothing_else_changes(self):
        self.db = FakeDatabase(tables=())
        with patch("app.coach_history.get_supabase_client", return_value=self.db):
            self.assertEqual(self.thread(), {"available": False, "threads": {}, "context": 50})
            response = self.save(1, 2)
            self.assertEqual((response.status_code, response.json()["detail"]), (503, coach_history.UNAVAILABLE))
            self.assertEqual(self.reset({"Coach Brad": B}, everything=True).status_code, 503)

    def test_the_first_messages_start_the_conversation_and_come_back_oldest_first(self):
        self.assertEqual(self.thread(), {"available": True, "threads": {}, "context": 50})
        response = self.save(1, 2)
        self.assertEqual(response.json(), {"stale": False, "conversation": A, "saved": [message(1)["id"], message(2)["id"]]})
        self.save(3, voice=True, plan="swim")
        saved = self.thread()["threads"]["Coach Brad"]
        self.assertEqual((saved["conversation"], saved["reset_at"]), (A, None))
        self.assertEqual([item["content"] for item in saved["messages"]], ["Message 1", "Message 2", "Message 3"])
        self.assertEqual({key: saved["messages"][2][key] for key in ("id", "role", "voice", "plan")},
                         {"id": message(3)["id"], "role": "user", "voice": True, "plan": "swim"})
        self.assertEqual(datetime.fromisoformat(saved["messages"][0]["at"]), datetime.fromisoformat(message(1)["at"]))
        row = self.db.rows[MESSAGES][0]
        self.assertEqual((row["user_id"], row["coach"], row["conversation"]), ("profile-1", "Coach Brad", A))

    def test_a_message_is_saved_once_however_often_it_is_sent(self):
        self.save(1, 2)
        self.save(1, 2, 3)
        self.save(3)
        self.assertEqual(sorted(row["content"] for row in self.db.rows[MESSAGES]), ["Message 1", "Message 2", "Message 3"])

    def test_only_the_newest_messages_are_kept(self):
        self.save(*range(1, KEPT + 1))
        self.save(*range(KEPT + 1, KEPT + 13))
        kept = self.thread()["threads"]["Coach Brad"]["messages"]
        self.assertEqual(len(self.db.rows[MESSAGES]), KEPT)
        self.assertEqual([item["content"] for item in kept], [f"Message {number}" for number in range(13, KEPT + 13)])

    def test_a_device_behind_is_told_and_nothing_it_sent_is_kept(self):
        self.save(1, 2)
        response = self.save(3, 4, conversation=B)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIs(response.json()["stale"], True)
        self.assertEqual([item["content"] for item in response.json()["thread"]["messages"]], ["Message 1", "Message 2"])
        self.assertEqual({row["conversation"] for row in self.db.rows[MESSAGES]}, {A})

    def test_starting_over_deletes_the_conversation_and_devices_still_on_it_are_told(self):
        self.save(1, 2)
        response = self.reset({"Coach Brad": B})
        self.assertEqual(response.json(), {"reset": ["Coach Brad"]})
        saved = self.thread()["threads"]["Coach Brad"]
        self.assertEqual((saved["conversation"], saved["messages"]), (B, []))
        self.assertIsNotNone(saved["reset_at"])
        self.assertEqual(self.db.rows[MESSAGES], [])
        # A device that hadn't heard: told, and what it sent isn't kept.
        self.assertIs(self.save(3, conversation=A).json()["stale"], True)
        self.assertEqual(self.db.rows[MESSAGES], [])
        self.save(4, conversation=B)
        self.assertEqual([item["content"] for item in self.thread()["threads"]["Coach Brad"]["messages"]], ["Message 4"])

    def test_starting_over_told_again_keeps_what_was_saved_since(self):
        self.reset({"Coach Brad": B})
        first = self.thread()["threads"]["Coach Brad"]["reset_at"]
        self.save(1, 2, conversation=B)
        self.reset({"Coach Brad": B})  # the same start over, sent again (its answer was lost)
        saved = self.thread()["threads"]["Coach Brad"]
        self.assertEqual(([item["content"] for item in saved["messages"]], saved["reset_at"]), (["Message 1", "Message 2"], first))

    def test_clear_history_deletes_every_saved_chat(self):
        self.save(1, 2)
        self.profile = {**PROFILE, "recommended_coaches": ["Coach Pete"]}  # a coach since switched from...
        self.save(3, 4, coach="Coach Pete", conversation=B)
        response = self.reset({"Coach Pete": "conversation-c-0003"}, everything=True)
        self.assertEqual(response.json(), {"reset": ["Coach Pete"]})
        self.assertEqual(self.db.rows[MESSAGES], [])
        self.assertEqual([(row["coach"], row["conversation"]) for row in self.db.rows[CONVERSATIONS]], [("Coach Pete", "conversation-c-0003")])
        self.reset({}, everything=True)
        self.assertEqual(self.db.rows[CONVERSATIONS], [])

    def test_only_the_athletes_own_coach(self):
        response = self.save(1, coach="Coach Pete")
        self.assertEqual((response.status_code, response.json()["detail"]), (403, NOT_YOUR_COACH))
        self.assertEqual(self.reset({"Coach Pete": B}).json(), {"reset": []})
        self.assertEqual(self.db.rows, {CONVERSATIONS: [], MESSAGES: []})
        # A profile saved before coaches were: any of the coaches, but only a real one.
        self.profile = {**PROFILE, "recommended_coaches": []}
        self.assertEqual(self.save(1, coach="Coach Pete").status_code, 200)
        self.assertEqual(self.save(1, coach="Coach Nobody").status_code, 403)

    def test_saving_while_another_device_starts_over_keeps_nothing_of_the_old_conversation(self):
        self.save(1, 2)

        def meanwhile(table, action):
            if table == MESSAGES and action == "upsert":
                self.db.hook = None
                self.reset({"Coach Brad": B})
        self.db.hook = meanwhile
        response = self.save(3, 4)
        self.assertIs(response.json()["stale"], True)
        self.assertEqual(response.json()["thread"]["conversation"], B)
        self.assertEqual(self.db.rows[MESSAGES], [])

    def test_text_is_kept_as_the_table_can_keep_it(self):
        response = self.client.post("/api/coach-chat/history", headers=HEADERS, json={"coach": "Coach Brad", "conversation": A, "messages": [
            {**message(1), "content": "Line one\nLine\ttwo\x00 \x07end \ud83d"}, {**message(2), "content": "\x00\x01"}]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["saved"], [message(1)["id"], message(2)["id"]])  # nothing left of the second: not kept
        self.assertEqual([row["content"] for row in self.db.rows[MESSAGES]], ["Line one\nLine\ttwo end "])

    def test_a_clock_far_ahead_is_held_to_today(self):
        far = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat()
        self.client.post("/api/coach-chat/history", headers=HEADERS, json={"coach": "Coach Brad", "conversation": A, "messages": [{**message(1), "at": far}]})
        self.assertLess(datetime.fromisoformat(self.db.rows[MESSAGES][0]["sent_at"]), datetime.now(timezone.utc) + timedelta(days=2))

    def test_what_the_tables_cant_take_is_refused_and_nothing_is_saved(self):
        for change in [
            {"messages": [message(number) for number in range(KEPT + 1)]},
            {"messages": []},
            {"messages": [{**message(1), "id": "has.a.dot"}]},
            {"messages": [{**message(1), "role": "system"}]},
            {"messages": [{**message(1), "content": "x" * 40_001}]},
            {"messages": [{**message(1), "at": "yesterday"}]},
            {"conversation": "short"},
            {"conversation": "has spaces in it"},
        ]:
            body = {"coach": "Coach Brad", "conversation": A, "messages": [message(1)], **change}
            self.assertEqual(self.client.post("/api/coach-chat/history", headers=HEADERS, json=body).status_code, 422, change)
        self.assertEqual(self.reset({f"Coach {number}": B for number in range(11)}).status_code, 422)
        self.assertEqual(self.db.rows, {CONVERSATIONS: [], MESSAGES: []})

    def test_a_database_error_is_a_502_and_the_log_leaves_out_what_was_written(self):
        self.db.failure = BROKEN
        with self.assertLogs("app.coach_history", level="WARNING") as logs:
            self.assertEqual(self.save(1).status_code, 502)
            self.assertEqual(self.client.get("/api/coach-chat/history", headers=HEADERS).status_code, 502)
            self.assertEqual(self.reset({"Coach Brad": B}).status_code, 502)
        self.assertNotIn("my secret words", "".join(logs.output))
        self.assertNotIn("Message 1", "".join(logs.output))


class ConversationGivenToTheCoachTests(unittest.TestCase):
    def test_the_last_50_messages_with_older_ones_shortened(self):
        messages = [CoachChatMessage(role="user" if number % 2 else "assistant", content=f"{number}:" + "x" * 20_000) for number in range(60)]
        history = conversation_history(messages)
        self.assertEqual(len(history), 50)
        self.assertEqual(history[0]["content"][:3], "10:")  # the oldest given: the 50th from the end
        lengths = [len(item["content"]) for item in reversed(history)]  # newest first
        self.assertEqual(lengths[:6], [12_000 + 4] * 6)
        self.assertEqual(lengths[6:20], [2_000 + 4] * 14)
        self.assertEqual(lengths[20:], [800 + 4] * 30)
        self.assertTrue(history[-1]["content"].endswith(" […]"))

    def test_short_messages_are_given_whole_and_roles_as_the_coach_knows_them(self):
        history = conversation_history([CoachChatMessage(role="user", content="Hi"), CoachChatMessage(role="system", content="Be nice"),
                                        CoachChatMessage(role="assistant", content="Hello")])
        self.assertEqual(history, [{"role": "user", "content": "Hi"}, {"role": "user", "content": "Be nice"},
                                   {"role": "assistant", "content": "Hello"}])

    def test_the_chat_sends_up_to_50_and_the_coach_is_given_them(self):
        client = TestClient(app)
        openai = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=None)))
        prompts = []

        def create(**kwargs):
            prompts.append(kwargs["messages"][1]["content"])
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Swim easy today."))])
        openai.chat.completions.create = create
        history = [{"role": "user" if number % 2 else "assistant", "content": f"Earlier message {number}"} for number in range(50)]
        with patch.object(main, "get_authenticated_profile", return_value={**PROFILE}), \
                patch.object(main, "recent_athlete_feedback", return_value=[]), patch.object(main, "coach_line", return_value=""), \
                patch.object(main, "chat_context", return_value=("PROGRAM", [], ["Coach Brad"])), \
                patch.object(main, "recent_race_results", return_value=[]), patch.object(main, "pacing_context", return_value={}), \
                patch.object(main, "settings", SimpleNamespace(openai_api_key="test-dummy", openai_model="gpt-4o-mini", openai_voice_model="gpt-4o-mini",
                                                               openai_reasoning_effort="low")), \
                patch.object(main, "_chat_openai", return_value=openai), patch.object(tokens, "charge", return_value=None):
            body = {"user_key": "key-1", "selected_coaches": ["Coach Brad"], "message": "And today?", "history": history}
            response = client.post("/api/coach-chat", headers=HEADERS, json=body)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("Earlier message 0", prompts[0])
            self.assertIn("Earlier message 49", prompts[0])
            too_many = {**body, "history": history + [{"role": "user", "content": "one more"}]}
            self.assertEqual(client.post("/api/coach-chat", headers=HEADERS, json=too_many).status_code, 422)


if __name__ == "__main__":
    unittest.main()
