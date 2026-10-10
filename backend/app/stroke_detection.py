"""Recognises the stroke in a swimming clip, so the athlete doesn't have to pick it.

The Stroke Lab (public /video-analysis page and the dashboard) samples the clip in the browser: a few small stills, plus
body-tracking evidence measured with MediaPipe on more frames (which way the chest faces and bent knees point, and how
often both knees are deeply bent at once, as in a frog kick). A vision model names the stroke from both. Underwater and
side-on clips are hard to read from stills alone (backstroke looks like freestyle, butterfly like breaststroke); the
measurements settle most of those.

The model is asked twice, in parallel. Two matching answers are reported as they are; when they name different strokes,
the stronger one is reported with its confidence capped and the other as the alternative, so the lab can call it a best
guess; when one sees no stroke at all, the other is only offered as a suggestion.
Nothing is stored, and the athlete can still change the stroke before analysing. Recognition is only for someone who
may still analyse the clip: a subscriber, or a visitor whose free analysis is still there.
"""
from __future__ import annotations

import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException, Request, status
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.video_access import allow_recognition, identify

router = APIRouter(prefix="/api/video-analysis", tags=["Video analysis"])
logger = logging.getLogger(__name__)

STROKES = ("Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM", "Dive")
Stroke = Literal["Freestyle", "Backstroke", "Breaststroke", "Butterfly", "IM", "Dive"]
MAX_FRAMES = 16
# A 640px JPEG still is ~30-80 KB; base64 adds a third. Generous, but bounded.
MAX_FRAME_CHARS = 400_000
DATA_URL = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$")
# Below this many tracked frames the measurements are too thin to mention.
MIN_EVIDENCE_FRAMES = 3
# Independent answers per clip. When they name different strokes the reported confidence is capped at SPLIT (a best
# guess); when one sees no stroke at all, at UNSEEN (only a suggestion).
OPINIONS = 2
SPLIT_CONFIDENCE = 55
UNSEEN_CONFIDENCE = 35

# Names a model (or an older client) might use for each stroke.
ALIASES = {
    "freestyle": "Freestyle", "front crawl": "Freestyle", "crawl": "Freestyle", "free": "Freestyle",
    "backstroke": "Backstroke", "back crawl": "Backstroke", "back": "Backstroke",
    "breaststroke": "Breaststroke", "breast": "Breaststroke",
    "butterfly": "Butterfly", "fly": "Butterfly",
    "im": "IM", "individual medley": "IM", "medley": "IM",
    "dive": "Dive", "racing dive": "Dive", "start": "Dive", "racing start": "Dive",
}

INSTRUCTIONS = """You identify the swimming stroke in a clip from evenly spaced still frames (in time order). Look at every frame and decide from the swimming you can see:
- Freestyle (front crawl): face down, arms alternate (one arm forward while the other pulls or recovers), flutter kick, body rolls side to side, breathing to the side.
- Backstroke: on the back, face up, arms alternate over the head with straight-arm recoveries, flutter kick.
- Breaststroke: face down with the head lifting to breathe, both arms sweep out and in together and stay in front of the shoulders, frog/whip kick: the knees bend and part, the heels are drawn up toward the seat, then the feet whip out and back together; a long glide in streamline.
- Butterfly: face down, both arms move together, pull through to the hips and recover over the water at the same time; the legs stay together in an up-and-down dolphin kick; the body undulates.
- IM: the clip clearly shows two or more different strokes being swum.
- Dive: the clip is mainly a racing start (on the block, take-off, flight, entry, underwater streamline) rather than stroke cycles.
Underwater and side views hide the face and the recoveries, so read the body:
- Face up or face down: a swimmer on their back has the chest and belly toward the surface, the seat lowest, and the knees bend downward (shins dropping toward the pool floor) as they kick. Face down, the back and seat are toward the surface and the knees bend so the heels rise toward the surface. Alternating arms with the knees bending downward is backstroke, not freestyle.
- Butterfly or breaststroke: with both arms together, look at the legs. Legs that stay together and kick up and down (often throwing bubbles off the feet), with the hands pulling back to the hips, are butterfly. Knees that bend and spread with the heels pulled up to the seat, and hands that stay in front of the shoulders, are breaststroke.
You may also get body-tracking measurements from a pose model run on more frames than you see. Use them to settle what small or underwater images hide, when they are consistent:
- Chest facing up/down and bent knees pointing up/down (counts): a clear majority of chest-up frames together with knees pointing up means the swimmer is on their back (backstroke); a clear majority of both down means face down. Mixed counts tell you nothing.
- Both knees deeply bent at once (count): a frog kick (breaststroke) shows this in several frames (3 or more); flutter and dolphin kicks rarely do, so 0 or 1 argues against breaststroke.
With fewer than 6 tracked frames, rely on the images.
Ignore anything that isn't swimming (titles, graphics, crowds, interviews, people standing on deck). A start or a turn followed by clear stroke cycles is that stroke, not Dive. Underwater dolphin kicks off a wall don't make a clip butterfly on their own. If no one is swimming in any frame, or you can't tell, answer stroke null.
confidence is how sure you are (0-100): above 80 only when several frames clearly show the defining features. reason is at most 12 words naming what you saw, written to the swimmer (e.g. "Both arms recover together over the water")."""

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "stroke_recognition",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "stroke": {"type": ["string", "null"], "enum": [*STROKES, None]},
                "confidence": {"type": "integer"},
                "reason": {"type": "string"},
            },
            "required": ["stroke", "confidence", "reason"],
            "additionalProperties": False,
        },
    },
}


class Frame(BaseModel):
    time: float = Field(ge=0, le=36_000, description="Seconds into the clip")
    image: str = Field(max_length=MAX_FRAME_CHARS, description="JPEG, PNG or WebP data URL")

    @field_validator("image")
    @classmethod
    def _data_url(cls, value: str) -> str:
        if not DATA_URL.match(value):
            raise ValueError("Each frame must be a base64 JPEG, PNG or WebP data URL.")
        return value


class PoseEvidence(BaseModel):
    """Body tracking over the frames where the swimmer lies in the water (counts of frames or bent knees)."""
    frames: int = Field(ge=0, le=1_000)
    chest_up: int = Field(ge=0, le=1_000)
    chest_down: int = Field(ge=0, le=1_000)
    knees_bending_up: int = Field(ge=0, le=2_000)
    knees_bending_down: int = Field(ge=0, le=2_000)
    both_knees_bent: int | None = Field(default=None, ge=0, le=1_000)


class StrokeDetectionRequest(BaseModel):
    frames: list[Frame] = Field(min_length=1, max_length=MAX_FRAMES)
    duration_seconds: float | None = Field(default=None, ge=0, le=36_000)
    evidence: PoseEvidence | None = None


class StrokeDetectionResponse(BaseModel):
    stroke: Stroke | None
    confidence: int = Field(ge=0, le=100)
    reason: str
    # The other stroke when the two answers disagreed (the reported one is then a best guess).
    alternative: Stroke | None = None


def evidence_text(evidence: PoseEvidence | None) -> str:
    """The body-tracking measurements as plain sentences for the model (empty when there were none)."""
    if evidence is None:
        return ""
    if evidence.frames < MIN_EVIDENCE_FRAMES:
        return "Body tracking: the swimmer was found lying in the water in too few frames to measure."
    lines = [
        f"Body tracking found the swimmer lying in the water in {evidence.frames} frames:",
        f"- Chest facing up in {evidence.chest_up} frames, down in {evidence.chest_down}.",
        f"- Bent knees pointing up (shins dropping toward the floor) {evidence.knees_bending_up} times, "
        f"down (heels rising) {evidence.knees_bending_down} times.",
    ]
    if evidence.both_knees_bent is not None:
        lines.append(f"- Both knees deeply bent at once in {evidence.both_knees_bent} frames.")
    return "\n".join(lines)


def model_options(model: str) -> dict[str, Any]:
    """Reasoning models (GPT-5, o-series) take a reasoning effort and no temperature; others answer at temperature 0."""
    return {"reasoning_effort": "low"} if model.startswith(("gpt-5", "o1", "o3", "o4")) else {"temperature": 0}


def normalize_stroke(value: Any) -> str | None:
    """A stroke name from the model, mapped onto the lab's six options (None when it isn't one of them)."""
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned if cleaned in STROKES else ALIASES.get(cleaned.lower())


def parse_detection(content: str | None) -> StrokeDetectionResponse:
    """One model answer, with the stroke validated and the confidence clamped to 0-100."""
    try:
        data = json.loads(content or "")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stroke recognition returned an unreadable answer.") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stroke recognition returned an unreadable answer.")
    stroke = normalize_stroke(data.get("stroke"))
    try:
        confidence = int(round(float(data.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0
    reason = data.get("reason") if isinstance(data.get("reason"), str) else ""
    return StrokeDetectionResponse(
        stroke=stroke,
        confidence=max(0, min(100, confidence)) if stroke else 0,
        reason=" ".join(reason.split())[:160],
    )


def combine(answers: list[StrokeDetectionResponse]) -> StrokeDetectionResponse:
    """One verdict from independent answers: agreement keeps the average confidence; disagreement is a best guess."""
    named = [answer for answer in answers if answer.stroke]
    if not named:
        return answers[0]
    best = max(named, key=lambda answer: answer.confidence)
    others = {answer.stroke for answer in answers} - {best.stroke}
    if not others:
        return best.model_copy(update={"confidence": round(sum(answer.confidence for answer in answers) / len(answers))})
    alternative = next((stroke for stroke in others if stroke), None)
    if alternative is None:
        # One answer saw no swimming at all: offer the stroke, but don't pick it.
        return best.model_copy(update={"confidence": min(best.confidence, UNSEEN_CONFIDENCE)})
    return best.model_copy(update={"confidence": min(best.confidence, SPLIT_CONFIDENCE), "alternative": alternative})


@router.post("/stroke", response_model=StrokeDetectionResponse)
def detect_stroke(payload: StrokeDetectionRequest, request: Request, authorization: str | None = Header(default=None)) -> StrokeDetectionResponse:
    """Names the stroke swum in the clip: one of the lab's six options, or null when no stroke can be seen. Only for
    someone who may still analyse it (see app/video_access.py)."""
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Stroke recognition is not configured.")
    allow_recognition(identify(request, authorization))

    intro = f"{len(payload.frames)} frames from the clip, in order."
    if payload.duration_seconds:
        intro += f" The clip is {payload.duration_seconds:.1f} seconds long."
    measured = evidence_text(payload.evidence)
    content: list[dict[str, Any]] = [{"type": "text", "text": f"{intro}\n{measured}" if measured else intro}]
    for index, frame in enumerate(payload.frames, start=1):
        content.append({"type": "text", "text": f"Frame {index} at {frame.time:.1f}s"})
        content.append({"type": "image_url", "image_url": {"url": frame.image, "detail": "low"}})

    model = settings.openai_vision_model
    client = OpenAI(api_key=settings.openai_api_key, timeout=45, max_retries=1)

    def ask(_: int) -> StrokeDetectionResponse:
        response = client.chat.completions.create(
            model=model,
            response_format=RESPONSE_FORMAT,
            messages=[{"role": "system", "content": INSTRUCTIONS}, {"role": "user", "content": content}],
            **model_options(model),
        )
        return parse_detection(response.choices[0].message.content)

    try:
        with ThreadPoolExecutor(max_workers=OPINIONS) as pool:
            answers = list(pool.map(ask, range(OPINIONS)))
    except OpenAIError as exc:
        logger.warning("Stroke recognition failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stroke recognition is unavailable right now.") from exc
    return combine(answers)
