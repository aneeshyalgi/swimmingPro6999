"""Training Plan store: SwimGPT's own PDF training plans, sold one at a time through Stripe Checkout.

The catalog lives here (never in the browser) so prices can't be changed client-side. Checkout uses a one-off
payment; the success page verifies the session server-side before showing a confirmation.
"""
from __future__ import annotations

from typing import Any

import httpx
import stripe
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import get_authenticated_user
from app.config import get_settings

router = APIRouter(prefix="/api/plans", tags=["Plan store"])

CATEGORIES = ["Sprint", "Middle distance", "Distance", "IM", "Taper", "Dryland", "Open water", "Youth & Masters"]

CATALOG: list[dict[str, Any]] = [
    {
        "id": "50-free-speed-lab", "title": "50 Free Speed Lab", "tagline": "Raw speed, race-pace 25s and starts that win the first 15 m.",
        "category": "Sprint", "level": "Intermediate – Elite", "weeks": 8, "sessions_per_week": 5, "pages": 46, "price": 3900,
        "accent": "cyan", "badge": "Bestseller", "events": ["50m Freestyle"],
        "includes": ["40 pool sessions with send-offs by ability", "Start & breakout progressions", "Race-pace 25s ladder", "2 dryland power sessions a week", "Pre-race warm-up script"],
        "sample_week": [["Mon", "Speed 12 × 25 @ race pace"], ["Tue", "Aerobic 3.2k + kick"], ["Wed", "Dryland power"], ["Thu", "Starts & breakouts"], ["Fri", "Broken 50s from a dive"], ["Sat", "Recovery 2k"]],
    },
    {
        "id": "100-race-pace-system", "title": "100 Race-Pace System", "tagline": "Hold your goal pace for the whole 100 with broken swims that build.",
        "category": "Sprint", "level": "Intermediate – Elite", "weeks": 10, "sessions_per_week": 6, "pages": 58, "price": 4900,
        "accent": "violet", "badge": None, "events": ["100m Freestyle", "100m Backstroke", "100m Breaststroke", "100m Butterfly"],
        "includes": ["Stroke-specific versions for all four strokes", "USRPT-style race-pace blocks", "Underwater kick development", "Split strategy worksheet", "Taper week"],
        "sample_week": [["Mon", "Race pace 3 × (6 × 50)"], ["Tue", "Aerobic pull 4k"], ["Wed", "Underwater kick + IM"], ["Thu", "Broken 100s"], ["Fri", "Threshold 200s"], ["Sat", "Speed + skills"]],
    },
    {
        "id": "200-free-back-half", "title": "200 Free: Own the Back Half", "tagline": "Threshold, pacing discipline and the closing speed to finish strong.",
        "category": "Middle distance", "level": "Intermediate – Advanced", "weeks": 12, "sessions_per_week": 6, "pages": 64, "price": 5900,
        "accent": "sky", "badge": "New", "events": ["200m Freestyle"],
        "includes": ["Threshold & CSS progressions", "Negative-split pacing sets", "Back-half lactate tolerance blocks", "Strength plan for 200 swimmers", "Race-day pacing card"],
        "sample_week": [["Mon", "CSS 8 × 200"], ["Tue", "Race pace 100s"], ["Wed", "Aerobic 5k"], ["Thu", "Back-half 4 × 150"], ["Fri", "Speed 25s + kick"], ["Sat", "Long aerobic"]],
    },
    {
        "id": "distance-engine", "title": "Distance Engine 400–1500", "tagline": "Big aerobic base, smart volume and pacing that never fades.",
        "category": "Distance", "level": "Intermediate – Elite", "weeks": 14, "sessions_per_week": 7, "pages": 72, "price": 5900,
        "accent": "emerald", "badge": None, "events": ["400m Freestyle", "800m Freestyle", "1500m Freestyle"],
        "includes": ["Periodised volume up to 50 km/week", "CSS & pace-clock sets", "Kick and pull endurance", "Mobility for high volume", "Even-split race plans"],
        "sample_week": [["Mon", "Aerobic 6k"], ["Tue", "CSS 20 × 100"], ["Wed", "Pull 5k + paddles"], ["Thu", "Race pace 400s"], ["Fri", "Recovery + technique"], ["Sat", "Long 7k"], ["Sun", "Open"]],
    },
    {
        "id": "im-mastery", "title": "IM Mastery 200 / 400", "tagline": "Four strokes, clean transitions and an IM you can actually pace.",
        "category": "IM", "level": "Intermediate – Advanced", "weeks": 12, "sessions_per_week": 6, "pages": 60, "price": 5900,
        "accent": "amber", "badge": None, "events": ["200m IM", "400m IM"],
        "includes": ["Weak-stroke development blocks", "Transition turn drills", "Broken IM race-pace sets", "Stroke-by-stroke technique cues", "IM pacing calculator page"],
        "sample_week": [["Mon", "IM order 8 × 100"], ["Tue", "Weak-stroke focus"], ["Wed", "Aerobic 4.5k"], ["Thu", "Broken 200 IMs"], ["Fri", "Turns & transitions"], ["Sat", "Speed + kick"]],
    },
    {
        "id": "championship-taper", "title": "Championship Taper Blueprint", "tagline": "The final three weeks: sharpen, rest and arrive ready to swim fast.",
        "category": "Taper", "level": "All levels", "weeks": 3, "sessions_per_week": 6, "pages": 28, "price": 2900,
        "accent": "rose", "badge": "Bestseller", "events": ["All events"],
        "includes": ["Volume and intensity drop by event type", "Daily race-pace touch sets", "Sleep, food and travel checklist", "Meet-day warm-up routines", "Between-swim recovery plan"],
        "sample_week": [["Mon", "Race pace 6 × 50"], ["Tue", "Aerobic 3k easy"], ["Wed", "Broken race"], ["Thu", "Speed touch"], ["Fri", "Rest & stretch"], ["Sat", "Meet warm-up"]],
    },
    {
        "id": "dryland-power", "title": "Dryland Power for Swimmers", "tagline": "Strength, power and shoulder health that carry straight into the water.",
        "category": "Dryland", "level": "Beginner – Advanced", "weeks": 8, "sessions_per_week": 3, "pages": 40, "price": 3500,
        "accent": "violet", "badge": None, "events": ["All events"],
        "includes": ["Gym and bodyweight-only versions", "Shoulder prehab routine", "Jump and start-power progressions", "Core for streamline", "Exercise videos by QR code"],
        "sample_week": [["Mon", "Lower power + core"], ["Wed", "Upper pull + shoulders"], ["Fri", "Full-body power"]],
    },
    {
        "id": "open-water-5k", "title": "Open Water 5K Ready", "tagline": "Sighting, drafting and the pacing to swim a strong 5K in open water.",
        "category": "Open water", "level": "Intermediate", "weeks": 10, "sessions_per_week": 5, "pages": 44, "price": 4500,
        "accent": "sky", "badge": None, "events": ["5 km open water"],
        "includes": ["Pool sessions with sighting drills", "Open-water skills sessions", "Feeding and race-plan guide", "Cold-water acclimatisation", "Pacing by heart rate or effort"],
        "sample_week": [["Mon", "Aerobic 4k + sighting"], ["Tue", "Threshold 300s"], ["Thu", "Drafting & pack skills"], ["Fri", "Long 5k continuous"], ["Sat", "Open water session"]],
    },
    {
        "id": "age-group-foundations", "title": "Age Group Foundations (11–14)", "tagline": "Skills, aerobic base and all four strokes, the right way for young swimmers.",
        "category": "Youth & Masters", "level": "Youth", "weeks": 12, "sessions_per_week": 4, "pages": 50, "price": 3900,
        "accent": "emerald", "badge": None, "events": ["All strokes"],
        "includes": ["Skill-first session design", "All four strokes every week", "Age-appropriate dryland", "Parent and coach notes", "Simple progress tracker"],
        "sample_week": [["Mon", "Technique + kick"], ["Wed", "Aerobic IM"], ["Fri", "Starts, turns & relays"], ["Sat", "Fun speed"]],
    },
    {
        "id": "masters-comeback", "title": "Masters Comeback", "tagline": "Back in the pool after a break: fitness, technique and confidence in 8 weeks.",
        "category": "Youth & Masters", "level": "Masters", "weeks": 8, "sessions_per_week": 3, "pages": 36, "price": 3500,
        "accent": "amber", "badge": "New", "events": ["All events"],
        "includes": ["3 sessions a week, 45–60 minutes", "Technique refresh by stroke", "Joint-friendly dryland", "Gradual intensity build", "First-meet preparation"],
        "sample_week": [["Tue", "Technique + aerobic 2k"], ["Thu", "Kick & pull 2.4k"], ["Sat", "Mixed 2.8k"]],
    },
]
BY_ID = {plan["id"]: plan for plan in CATALOG}


class PlanCheckoutRequest(BaseModel):
    plan_id: str = Field(min_length=1, max_length=80)


def _public(plan: dict[str, Any]) -> dict[str, Any]:
    return {**plan, "currency": "usd"}


@router.get("/catalog")
def get_catalog() -> dict[str, Any]:
    return {"categories": CATEGORIES, "plans": [_public(plan) for plan in CATALOG]}


@router.post("/checkout")
def create_plan_checkout(request: PlanCheckoutRequest, authorization: str | None = Header(default=None)) -> dict[str, str]:
    """One-off Stripe Checkout for a single PDF plan. Signed-in buyers are linked to their account."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payments aren't configured yet.")
    plan = BY_ID.get(request.plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That plan isn't available.")
    buyer = None
    if authorization:
        try:
            buyer = get_authenticated_user(authorization)
        except (HTTPException, httpx.TransportError):
            buyer = None  # buying as a guest is fine; Checkout collects the email
    metadata = {"kind": "pdf_plan", "plan_id": plan["id"], "auth_user_id": buyer.id if buyer else ""}
    options: dict[str, Any] = {
        "mode": "payment",
        "managed_payments": {"enabled": False},
        "line_items": [{
            "price_data": {
                "currency": "usd", "unit_amount": plan["price"],
                "product_data": {"name": f"{plan['title']} · PDF training plan",
                                 "description": f"{plan['weeks']}-week plan · {plan['sessions_per_week']} sessions/week · {plan['pages']} pages. {plan['tagline']}"},
            },
            "quantity": 1,
        }],
        "success_url": f"{settings.frontend_url}/training-plans/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.frontend_url}/training-plans?checkout=cancelled&plan={plan['id']}",
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata},
    }
    if buyer:
        options["client_reference_id"] = buyer.id
        if buyer.email:
            options["customer_email"] = buyer.email
    try:
        stripe.api_key = settings.stripe_secret_key
        session = stripe.checkout.Session.create(**options)
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Stripe checkout error: {exc}") from exc
    if not session.url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe did not return a checkout URL.")
    return {"checkout_url": session.url, "session_id": session.id}


@router.get("/verify/{session_id}")
def verify_plan_checkout(session_id: str) -> dict[str, Any]:
    """Confirm a plan purchase with Stripe before the success page shows it."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payments aren't configured yet.")
    try:
        stripe.api_key = settings.stripe_secret_key
        session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Stripe verification error: {exc}") from exc
    metadata = session.metadata or {}
    plan = BY_ID.get(metadata.get("plan_id", ""))
    if metadata.get("kind") != "pdf_plan" or plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This checkout isn't a training plan purchase.")
    details = session.customer_details
    return {
        "paid": session.payment_status == "paid",
        "plan": _public(plan),
        "email": getattr(details, "email", None) if details else None,
        "amount_total": session.amount_total,
    }
