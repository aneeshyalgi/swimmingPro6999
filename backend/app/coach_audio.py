"""Authenticated chat audio: bounded microphone uploads and per-coach OpenAI voices.

Audio is processed in memory, never stored. Speech requests use at most 3,000 characters;
the browser plays longer answers in successive chunks. All voices are synthetic.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import Response
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


class CoachSpeechRequest(BaseModel):
    coach: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=3000)


class TranscriptionResponse(BaseModel):
    text: str


async def _require_coach(authorization: str | None, coach: str) -> None:
    profile = await run_in_threadpool(get_authenticated_profile, authorization)
    if coach not in COACH_VOICES:
        raise HTTPException(status_code=400, detail="Unknown coach voice.")
    if coach not in (profile.get("recommended_coaches") or []):
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
        async with AsyncOpenAI(api_key=settings.openai_api_key, timeout=60, max_retries=1) as client:
            transcript = await client.audio.transcriptions.create(
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
    try:
        async with AsyncOpenAI(api_key=settings.openai_api_key, timeout=60, max_retries=1) as client:
            audio = await client.audio.speech.create(
                model=settings.openai_speech_model,
                voice=voice,
                input=text,
                instructions=f"{delivery} Speak as a male swimming coach, naturally and clearly. "
                "Read the supplied text faithfully; do not add or omit advice.",
                response_format="mp3",
            )
            content = audio.content
    except OpenAIError as exc:
        logger.exception("OpenAI coach speech failed")
        raise HTTPException(status_code=502, detail="Could not generate the coach's voice. Please try again.") from exc
    if not content:
        raise HTTPException(status_code=502, detail="The voice service returned empty audio. Please try again.")
    return Response(content=content, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
