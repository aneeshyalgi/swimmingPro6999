"""Authenticated chat audio: bounded microphone uploads and per-coach OpenAI voices.

Audio is processed in memory, never stored. Speech requests use at most 3,000 characters;
the browser plays longer answers in successive chunks. All voices are synthetic. A voice call
asks for raw PCM, streamed as it is synthesised, so the coach starts talking before a piece's
audio is complete.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any, Literal

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
    try:
        transcript = await _openai(settings.openai_api_key).audio.transcriptions.create(
            model=settings.openai_transcription_model,
            file=(f"dictation.{extension}", bytes(content), content_type),
            response_format="json",
        )
    except OpenAIError as exc:
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
    client = _openai(settings.openai_api_key)
    if request.format == "pcm":
        return await _streamed_speech(client, options)
    try:
        content = (await client.audio.speech.create(**options, response_format="mp3")).content
    except OpenAIError as exc:
        logger.exception("OpenAI coach speech failed")
        raise HTTPException(status_code=502, detail="Could not generate the coach's voice. Please try again.") from exc
    if not content:
        raise HTTPException(status_code=502, detail="The voice service returned empty audio. Please try again.")
    return Response(content=content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


async def _streamed_speech(client: AsyncOpenAI, options: dict[str, Any]) -> StreamingResponse:
    """The speech as raw PCM, sent on as OpenAI synthesises it. A failure to start is an ordinary error response; if
    the audio breaks off partway, what arrived is still played."""
    stream = client.audio.speech.with_streaming_response.create(**options, response_format="pcm")
    try:
        response = await stream.__aenter__()
    except OpenAIError as exc:
        logger.exception("OpenAI coach speech failed")
        raise HTTPException(status_code=502, detail="Could not generate the coach's voice. Please try again.") from exc

    async def audio():
        try:
            async for chunk in response.iter_bytes():
                yield chunk
        except (OpenAIError, httpx.HTTPError):
            logger.exception("OpenAI coach speech broke off")
        finally:
            await stream.__aexit__(None, None, None)

    return StreamingResponse(audio(), media_type=PCM_MEDIA_TYPE, headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
