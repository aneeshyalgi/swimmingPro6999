"""Saved coach chats: the athlete's conversation with their coach, kept for them so the coach remembers it everywhere.

The chat (components/coach-chat.tsx, hooks/use-coach-history.ts) keeps each conversation on the athlete's device and
sends its last messages with every message, typed or said on a voice call (schemas.HISTORY_MESSAGES, the older ones
shortened by conversation_history). After each exchange it saves the new messages here, and when it opens it gets the
saved conversation back: a phone and a laptop share one conversation, and a new device or a cleared browser has it too.

- One conversation per athlete and coach (user_coach_conversations): the one in use, and when it was last started over
  ("New chat" or "Clear history", on any device). A device whose conversation was started over elsewhere starts over
  too, keeping only what was written on it since.
- Its newest KEPT messages (user_coach_messages): older ones are deleted as new ones come, and starting over deletes
  them all. A message is saved once, however often a device sends it.
- Messages written before saved chats existed stay on the device they were written on: the chat never sends them here.

Until the tables exist (migrations/2026-10-25_add_coach_chat_history.sql) saved chats report themselves unavailable and
the chat keeps conversations on the device only, as it always did. Nothing else reads or writes these tables.
"""
from __future__ import annotations

import logging
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Header, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth import get_authenticated_profile
from app.coach_programs import program_for
from app.db import get_supabase_client
from app.schemas import HISTORY_MESSAGES, CoachChatMessage

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/coach-chat/history", tags=["Coach chat"])

CONVERSATIONS, MESSAGES = "user_coach_conversations", "user_coach_messages"
KEPT = HISTORY_MESSAGES  # messages kept of a conversation: what the coach is given of it
MESSAGE_CHARS = 40_000   # a message's text, as the table allows
# How PostgREST answers while a table doesn't exist: PGRST205 from its schema cache, 42P01 from Postgres itself.
MISSING_TABLE = {"PGRST205", "42P01"}
ID = r"^[A-Za-z0-9_-]+$"  # the chat's message and conversation ids (nothing a database filter would have to quote)
UNAVAILABLE = "Saved chats aren't available just now."
NOT_LOADED = "Your saved chats couldn't be loaded just now."
NOT_SAVED = "Your chat couldn't be saved just now."
NOT_CLEARED = "Your saved chats couldn't be cleared just now."
NOT_YOUR_COACH = "That isn't your coach."

# The conversation as the coach is given it with a message, newest first: the 6 newest messages almost whole, the next
# 14 cut to 2,000 characters and the rest to 800, so every message of a long conversation still counts while the reply
# stays quick and affordable. lib/coach-history.ts sends them shortened the same way.
HISTORY_CHARS = ((6, 12_000), (20, 2_000), (HISTORY_MESSAGES, 800))


def conversation_history(messages: list[CoachChatMessage]) -> list[dict[str, str]]:
    """The conversation's last HISTORY_MESSAGES messages for the coach's prompt, oldest first."""
    recent = messages[-HISTORY_MESSAGES:]
    history = []
    for age, item in enumerate(reversed(recent)):
        limit = next(chars for count, chars in HISTORY_CHARS if age < count)
        content = item.content if len(item.content) <= limit else item.content[:limit].rstrip() + " […]"
        history.append({"role": item.role if item.role in {"user", "assistant"} else "user", "content": content})
    return history[::-1]


ConversationId = Annotated[str, Field(min_length=8, max_length=100, pattern=ID)]


class SavedMessage(BaseModel):
    """A message as the chat saves it: its id on the athlete's devices, and when it was written there."""

    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=100, pattern=ID)
    role: Literal["user", "assistant"]
    # Nothing left of it once cleaned: not kept (and not refused, which would keep the device sending it).
    content: str = Field(max_length=MESSAGE_CHARS)
    at: datetime
    voice: bool = False
    plan: Literal["swim", "gym", "both"] | None = None

    @field_validator("content", mode="before")
    @classmethod
    def keepable(cls, value: Any) -> Any:
        # Cleaned first: half of a broken character can't even be read as text.
        return _clean(value) if isinstance(value, str) else value


class SaveRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    coach: str = Field(min_length=1, max_length=100)
    conversation: ConversationId
    messages: list[SavedMessage] = Field(min_length=1, max_length=KEPT)


class ResetRequest(BaseModel):
    """Starting over: the new conversation with each coach, as the athlete's device named it."""

    model_config = ConfigDict(extra="ignore")
    conversations: dict[Annotated[str, Field(min_length=1, max_length=100)], ConversationId] = Field(default_factory=dict, max_length=10)
    # "Clear history": the athlete's other saved chats (with coaches they no longer have) go too.
    everything: bool = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _clean(text: str) -> str:
    """Text as the table can keep it: line breaks and tabs kept, other control characters (Postgres can't store some) and
    halves of broken characters dropped."""
    return "".join(character for character in text
                   if character in "\n\t" or unicodedata.category(character) not in ("Cc", "Cs"))


def _yours(profile: dict[str, Any], coach: str) -> bool:
    """Whether `coach` is the athlete's coach (any coach, for a profile saved before coaches were)."""
    coaches = profile.get("recommended_coaches") or []
    return coach in coaches if coaches else program_for(coach) is not None


def _pointer(profile_id: str, coach: str) -> dict[str, Any] | None:
    """The athlete's conversation with `coach`: which one it is and when it was last started over."""
    rows = (get_supabase_client().table(CONVERSATIONS).select("coach, conversation, started_at, reset_at")
            .eq("user_id", profile_id).eq("coach", coach).limit(1).execute().data)
    return rows[0] if rows else None


def _thread(profile_id: str, pointer: dict[str, Any]) -> dict[str, Any]:
    """A conversation as the chat gets it back: its newest KEPT messages, oldest first."""
    rows = (get_supabase_client().table(MESSAGES).select("message_id, role, content, voice, plan, sent_at")
            .eq("user_id", profile_id).eq("coach", pointer["coach"]).eq("conversation", pointer["conversation"])
            .order("sent_at", desc=True).order("created_at", desc=True).limit(KEPT).execute().data)
    return {
        "conversation": pointer["conversation"], "started_at": pointer["started_at"], "reset_at": pointer["reset_at"],
        "messages": [{"id": row["message_id"], "role": row["role"], "content": row["content"], "at": row["sent_at"],
                      "voice": row["voice"], "plan": row["plan"]} for row in reversed(rows)],
    }


def _failed(action: str, exc: APIError) -> None:
    # Only the error's code and message: its details can repeat a row, and so what the athlete wrote.
    logger.warning("Could not %s saved coach chats (%s: %s)", action, exc.code, exc.message)


@router.get("")
def get_history(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """The athlete's saved conversation with each of their coaches, or `available` false while the tables don't exist.
    `context`: how many messages of the conversation the coach takes with a message (the chat sends no more than a
    backend from before took until it's told)."""
    profile = get_authenticated_profile(authorization)
    try:
        pointers = (get_supabase_client().table(CONVERSATIONS).select("coach, conversation, started_at, reset_at")
                    .eq("user_id", profile["id"]).execute().data)
        threads = {pointer["coach"]: _thread(profile["id"], pointer) for pointer in pointers if _yours(profile, pointer["coach"])}
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            return {"available": False, "threads": {}, "context": HISTORY_MESSAGES}
        _failed("read", exc)
        raise HTTPException(status_code=502, detail=NOT_LOADED) from exc
    return {"available": True, "threads": threads, "context": HISTORY_MESSAGES}


@router.post("")
def save_messages(request: SaveRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Saves new messages of the athlete's conversation with their coach (the first ones start it). A device that's
    behind, its conversation started over on another device, gets `stale` and the conversation as it is now, and
    nothing it sent is kept."""
    profile = get_authenticated_profile(authorization)
    if not _yours(profile, request.coach):
        raise HTTPException(status_code=403, detail=NOT_YOUR_COACH)
    supabase, profile_id, coach, conversation = get_supabase_client(), profile["id"], request.coach, request.conversation
    now = _now()
    ids = [message.id for message in request.messages]
    rows = []
    for message in request.messages:
        if message.content.strip():
            at = message.at if message.at.tzinfo else message.at.replace(tzinfo=timezone.utc)
            rows.append({"user_id": profile_id, "coach": coach, "conversation": conversation, "message_id": message.id,
                         "role": message.role, "content": message.content, "voice": message.voice, "plan": message.plan,
                         "sent_at": min(at, now + timedelta(days=1)).isoformat()})
    try:
        pointer = _pointer(profile_id, coach)
        if pointer is None:
            # The first messages saved with this coach start the conversation; a device doing the same at that moment
            # finds it started.
            supabase.table(CONVERSATIONS).upsert({"user_id": profile_id, "coach": coach, "conversation": conversation,
                                                   "started_at": now.isoformat()},
                                                  on_conflict="user_id,coach", ignore_duplicates=True).execute()
            pointer = _pointer(profile_id, coach)
        if pointer is None or pointer["conversation"] != conversation:
            return {"stale": True, "thread": _thread(profile_id, pointer) if pointer else None}
        if rows:
            supabase.table(MESSAGES).upsert(rows, on_conflict="user_id,message_id", ignore_duplicates=True).execute()
        # Started over on another device while these were being saved: they belong to the conversation that ended.
        current = _pointer(profile_id, coach)
        if current is None or current["conversation"] != conversation:
            (supabase.table(MESSAGES).delete().eq("user_id", profile_id).eq("coach", coach).eq("conversation", conversation)
             .in_("message_id", ids).execute())
            return {"stale": True, "thread": _thread(profile_id, current) if current else None}
        older = (supabase.table(MESSAGES).select("id").eq("user_id", profile_id).eq("coach", coach)
                 .eq("conversation", conversation).order("sent_at", desc=True).order("created_at", desc=True)
                 .range(KEPT, KEPT + 999).execute().data)
        if older:
            supabase.table(MESSAGES).delete().in_("id", [row["id"] for row in older]).execute()
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc
        _failed("save", exc)
        raise HTTPException(status_code=502, detail=NOT_SAVED) from exc
    return {"stale": False, "conversation": conversation, "saved": ids}


@router.post("/reset")
def reset_history(request: ResetRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """Starts the athlete's conversation with each coach given over ("New chat"), as the new conversation their device
    named, deleting what was saved of the old one; with `everything` ("Clear history") their other saved chats are
    deleted too. Sent again, it changes nothing more: what was saved in the new conversation since stays."""
    profile = get_authenticated_profile(authorization)
    supabase, profile_id = get_supabase_client(), profile["id"]
    starts = {coach: conversation for coach, conversation in request.conversations.items() if _yours(profile, coach)}
    now = _now().isoformat()
    try:
        for coach, conversation in starts.items():
            pointer = _pointer(profile_id, coach)
            if pointer is None or pointer["conversation"] != conversation:
                # The new conversation first: a device still saving into the old one is then told it's behind.
                supabase.table(CONVERSATIONS).upsert({"user_id": profile_id, "coach": coach, "conversation": conversation,
                                                       "started_at": now, "reset_at": now}, on_conflict="user_id,coach").execute()
            supabase.table(MESSAGES).delete().eq("user_id", profile_id).eq("coach", coach).neq("conversation", conversation).execute()
        if request.everything:
            for table in (MESSAGES, CONVERSATIONS):
                query = supabase.table(table).delete().eq("user_id", profile_id)
                (query.not_.in_("coach", list(starts)) if starts else query).execute()
    except APIError as exc:
        if exc.code in MISSING_TABLE:
            raise HTTPException(status_code=503, detail=UNAVAILABLE) from exc
        _failed("clear", exc)
        raise HTTPException(status_code=502, detail=NOT_CLEARED) from exc
    return {"reset": sorted(starts)}
