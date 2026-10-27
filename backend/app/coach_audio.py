"""Authenticated chat audio: bounded microphone uploads and per-coach OpenAI voices.

Audio is processed in memory, never stored. Speech requests use at most 3,000 characters;
the browser plays longer answers in successive chunks. All voices are synthetic. A voice call
asks for raw PCM, streamed as it is synthesised, so the coach starts talking before a piece's
audio is complete.

OpenAI's speech and transcription are usually quick but now and then stall: measured on 2026-10-27, about one speech
request in six took 17-25 s (once 75 s) to send any audio, where the rest started within a second, and one
transcription in six took 3-4.5 s instead of half a second. A call waits on both, so each is hedged (_hedged): when the
first request is slow, the same request is made again, and whichever answers first is used.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal, TypeVar

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.auth import get_authenticated_profile
from app.config import get_settings

router = APIRouter(prefix="/api/coach-chat", tags=["Coach audio"])
logger = logging.getLogger(__name__)
MAX_AUDIO_BYTES = 24 * 1024 * 1024
AUDIO_TYPES = {
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
}
COACH_VOICES = {
    "Coach Brad": ("onyx", "A deep, energetic male voice with a direct American coaching style."),
    "Coach Pete": ("echo", "A clear, measured male voice with a precise American coaching style."),
    "Coach Timothy": ("ash", "A relaxed, confident male voice with an Australian accent."),
    "Coach Robert": ("fable", "A warm, thoughtful male voice with a British accent."),
    "Coach Tony": ("cedar", "A calm, resonant male voice with a steady American coaching style."),
}


# A voice call's speech: 16-bit mono PCM at 24 kHz, as OpenAI streams it.
PCM_MEDIA_TYPE = "audio/L16;rate=24000;channels=1"
# Hedging (see the module's docstring): seconds after the first request that the same request is made again while none
# has answered; how long they all get before the request fails; and, once speech has begun, how long its audio may stop
# before the piece ends there (what arrived is played, and the call goes on to the next).
SPEECH_AGAIN_AFTER = (0.9, 2.0, 3.5, 5.5)
SPEECH_LIMIT = 12.0
SPEECH_STALL = 4.0
# The attempts (by number, the first being 0) made with FALLBACK_SPEECH_MODEL instead, when it has the coach's voice:
# it was never seen to stall (36 requests on 2026-10-27, none over 2.4 s), but starts later than the usual model (1.1 s
# against 0.5 s) and reads without the coach's delivery instructions, so it's only for when the usual model is stuck.
FALLBACK_SPEECH_MODEL = "tts-1"
FALLBACK_ATTEMPTS = frozenset({2, 4})
FALLBACK_VOICES = frozenset({"alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"})
TRANSCRIPTION_AGAIN_AFTER = (0.9, 2.0, 3.5)
TRANSCRIPTION_LIMIT = 25.0
T = TypeVar("T")
# Requests that lost a race, being closed (kept so they aren't collected before they finish).
_closing: set[asyncio.Future] = set()
# A voice call makes several audio requests a turn, so whose coach a session may use is remembered for a minute
# instead of being looked up in the database every time.
ASSIGNED_SECONDS = 60.0
_assigned: dict[str, tuple[float, frozenset[str]]] = {}
_client: tuple[str, Any, Any, AsyncOpenAI] | None = None


class CoachSpeechRequest(BaseModel):
    coach: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=3000)
    # "pcm": streamed as it is synthesised, for a voice call; "mp3": one file, for the chat's Listen button.
    format: Literal["mp3", "pcm"] = "mp3"


class TranscriptionResponse(BaseModel):
    text: str


def _openai(api_key: str) -> AsyncOpenAI:
    """The OpenAI client, kept while the server runs so each request reuses its connections (a client per request
    paid for a new TLS connection to OpenAI every time). One per event loop, as its connections belong to one."""
    global _client
    loop = asyncio.get_running_loop()
    if _client is None or _client[:3] != (api_key, loop, AsyncOpenAI):
        _client = (api_key, loop, AsyncOpenAI, AsyncOpenAI(api_key=api_key, timeout=60, max_retries=1))
    return _client[3]


async def _hedged(start: Callable[[int], Awaitable[T]], again_after: tuple[float, ...], limit: float,
                  close: Callable[[T], Awaitable[None]] | None = None) -> T:
    """The first answer from the same request made more than once: `start(number)` is called now (number 0), again at
    each of `again_after` (seconds from now) while no answer has come, and again at once if all made so far have
    failed. The others are cancelled when one answers (an answer that loses the race is closed with `close`). Raises
    the last failure when every attempt has failed, or TimeoutError when none has answered within `limit` seconds."""
    loop = asyncio.get_running_loop()
    began = loop.time()
    waits = list(again_after)
    made = 0

    def another() -> asyncio.Future:
        nonlocal made
        made += 1
        return asyncio.ensure_future(start(made - 1))

    running: set[asyncio.Future] = {another()}
    failure: BaseException | None = None
    try:
        while True:
            if not running:
                if not waits:
                    raise failure or TimeoutError()
                waits.pop(0)
                running.add(another())
            until = began + (waits[0] if waits else limit)
            done, running = await asyncio.wait(running, timeout=max(0.0, until - loop.time()), return_when=asyncio.FIRST_COMPLETED)
            answers = [task.result() for task in done if not task.cancelled() and task.exception() is None]
            failure = next((task.exception() for task in done if not task.cancelled() and task.exception() is not None), failure)
            if answers:
                for spare in answers[1:]:
                    if close:
                        await close(spare)
                return answers[0]
            if not done:
                if not waits:
                    raise TimeoutError()
                waits.pop(0)
                running.add(another())
    finally:
        if running:
            for task in running:
                task.cancel()
            closing = asyncio.ensure_future(_close_all(running, close))
            _closing.add(closing)
            closing.add_done_callback(_closing.discard)


async def _close_all(tasks: set[asyncio.Future], close: Callable[[Any], Awaitable[None]] | None) -> None:
    """Waits for cancelled attempts to end, closing any that answered just before it."""
    for result in await asyncio.gather(*tasks, return_exceptions=True):
        if close and not isinstance(result, BaseException):
            try:
                await close(result)
            except Exception:  # noqa: BLE001 - a spare answer that can't be closed is let go
                logger.debug("A spare audio answer couldn't be closed", exc_info=True)


async def _require_coach(authorization: str | None, coach: str) -> None:
    key = hashlib.sha256(authorization.encode()).hexdigest() if authorization else None
    now = time.monotonic()
    cached = _assigned.get(key) if key else None
    if cached and cached[0] > now:
        coaches = cached[1]
    else:
        profile = await run_in_threadpool(get_authenticated_profile, authorization)
        coaches = frozenset(profile.get("recommended_coaches") or [])
        if key:
            if len(_assigned) >= 1000:
                for stale in [item for item, (expires, _) in _assigned.items() if expires <= now] or list(_assigned):
                    del _assigned[stale]
            _assigned[key] = (now + ASSIGNED_SECONDS, coaches)
    if coach not in COACH_VOICES:
        raise HTTPException(status_code=400, detail="Unknown coach voice.")
    if coach not in coaches:
        raise HTTPException(status_code=403, detail="This coach is not assigned to your athlete profile.")


@router.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(request: Request, coach: str, authorization: str | None = Header(default=None)):
    await _require_coach(authorization, coach)
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="Voice coaching is not configured.")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    extension = AUDIO_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(status_code=415, detail="Record audio as WebM, MP4, MP3 or WAV.")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Recording is too large. Record a shorter message.")
        content.extend(chunk)
    if not content:
        raise HTTPException(status_code=400, detail="No audio was recorded. Please try again.")
    # Each attempt is tried once: asking again (hedging) does what a retry would, sooner.
    client = _openai(settings.openai_api_key).with_options(max_retries=0)
    recording = (f"dictation.{extension}", bytes(content), content_type)
    try:
        transcript = await _hedged(
            lambda _: client.audio.transcriptions.create(model=settings.openai_transcription_model, file=recording, response_format="json"),
            TRANSCRIPTION_AGAIN_AFTER, TRANSCRIPTION_LIMIT)
    except (OpenAIError, httpx.HTTPError, TimeoutError) as exc:
        logger.exception("OpenAI coach transcription failed")
        raise HTTPException(status_code=502, detail="Could not transcribe your recording. Please try again.") from exc
    text = transcript.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="No speech was detected. Please speak clearly and try again.")
    return TranscriptionResponse(text=text)


@router.post("/speech")
async def coach_speech(request: CoachSpeechRequest, authorization: str | None = Header(default=None)):
    await _require_coach(authorization, request.coach)
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="There is no text to read aloud.")
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="Voice coaching is not configured.")
    voice, delivery = COACH_VOICES[request.coach]
    options = {
        "model": settings.openai_speech_model,
        "voice": voice,
        "input": text,
        "instructions": f"{delivery} Speak as a male swimming coach, naturally and clearly. "
        "Read the supplied text faithfully; do not add or omit advice.",
    }
    # Each attempt is tried once: asking again (hedging) does what a retry would, sooner.
    client = _openai(settings.openai_api_key).with_options(max_retries=0)
    if request.format == "pcm":
        return await _streamed_speech(client, options)
    # The chat's Listen button: the whole MP3, its speech started over once if it stalls partway.
    for attempt in range(2):
        try:
            content = await _whole_speech(client, options)
            break
        except (OpenAIError, httpx.HTTPError, TimeoutError, _NoAudio) as exc:
            if attempt:
                logger.exception("OpenAI coach speech failed")
                raise HTTPException(status_code=502, detail="Could not generate the coach's voice. Please try again.") from exc
    return Response(content=content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


class _NoAudio(Exception):
    """A speech request that ended without any audio."""


async def _begun_speech(client: AsyncOpenAI, options: dict[str, Any]) -> tuple[Any, Any, bytes]:
    """One speech request, as far as its first audio: (its response, its remaining audio, that first audio)."""
    response = client.audio.speech.with_streaming_response.create(**options)
    opened = await response.__aenter__()
    try:
        chunks = opened.iter_bytes()
        first = b""
        while not first:
            try:
                first = await chunks.__anext__()
            except StopAsyncIteration:
                raise _NoAudio() from None
        return response, chunks, first
    except BaseException:
        await response.__aexit__(None, None, None)
        raise


async def _first_speech(client: AsyncOpenAI, options: dict[str, Any]) -> tuple[Any, Any, bytes]:
    """The speech from whichever request (hedged) sends audio first; FALLBACK_ATTEMPTS use FALLBACK_SPEECH_MODEL."""
    fallback = {key: value for key, value in options.items() if key != "instructions"} | {"model": FALLBACK_SPEECH_MODEL}

    def attempt(number: int):
        usable = number in FALLBACK_ATTEMPTS and options["voice"] in FALLBACK_VOICES
        return _begun_speech(client, fallback if usable else options)

    return await _hedged(attempt, SPEECH_AGAIN_AFTER, SPEECH_LIMIT, close=lambda begun: begun[0].__aexit__(None, None, None))


async def _rest_of(chunks: Any):
    """A speech's audio after its first, ending early if it stops coming for SPEECH_STALL seconds."""
    while True:
        try:
            chunk = await asyncio.wait_for(chunks.__anext__(), SPEECH_STALL)
        except StopAsyncIteration:
            return
        except asyncio.TimeoutError:
            logger.warning("OpenAI coach speech stalled partway; it ends where it stopped")
            return
        yield chunk


async def _whole_speech(client: AsyncOpenAI, options: dict[str, Any]) -> bytes:
    """The whole MP3. Raises TimeoutError if its audio stalls before the end (it is then started over)."""
    response, chunks, first = await _first_speech(client, {**options, "response_format": "mp3"})
    try:
        content = bytearray(first)
        while True:
            try:
                content.extend(await asyncio.wait_for(chunks.__anext__(), SPEECH_STALL))
            except StopAsyncIteration:
                return bytes(content)
    finally:
        await response.__aexit__(None, None, None)


async def _streamed_speech(client: AsyncOpenAI, options: dict[str, Any]) -> StreamingResponse:
    """The speech as raw PCM, sent on as OpenAI synthesises it, from whichever request starts first. A failure to start
    is an ordinary error response; if the audio breaks off or stalls partway, what arrived is still played."""
    try:
        response, chunks, first = await _first_speech(client, {**options, "response_format": "pcm"})
    except (OpenAIError, httpx.HTTPError, TimeoutError, _NoAudio) as exc:
        logger.exception("OpenAI coach speech failed")
        raise HTTPException(status_code=502, detail="Could not generate the coach's voice. Please try again.") from exc

    async def audio():
        try:
            yield first
            async for chunk in _rest_of(chunks):
                yield chunk
        except (OpenAIError, httpx.HTTPError):
            logger.exception("OpenAI coach speech broke off")
        finally:
            await response.__aexit__(None, None, None)

    return StreamingResponse(audio(), media_type=PCM_MEDIA_TYPE, headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
