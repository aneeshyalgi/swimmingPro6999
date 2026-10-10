"""Training Plan store: SwimGPT's premade training plans, sold one at a time through Stripe Checkout and read in SwimGPT.

The catalog lives here (never in the browser) so prices can't be changed client-side. Checkout uses a one-off
payment; the success page verifies the session server-side before showing a confirmation.

Buying needs a SwimGPT account, and only that: no subscription or onboarding. Every purchase is kept against the account
in the user_plan_purchases table: a row is written as checkout opens ("pending") and marked "paid" once Stripe confirms
the payment, on the success page or, for a buyer who never got there, the next time their purchases are read.

A plan is delivered as a book, never as a PDF: the pages rebuilt from its premade PDF (scripts/build_plan_books.py) are
served only to an account that bought it, and SwimGPT's reader redraws them. A plan without a book isn't for sale.
"""
from __future__ import annotations

import gzip
import json
import logging
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import stripe
from fastapi import APIRouter, Header, HTTPException, Response, status
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from app.auth import get_authenticated_user
from app.config import get_settings
from app.db import get_supabase_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/plans", tags=["Plan store"])
PURCHASES = "user_plan_purchases"
NOT_SAVED = "Your purchase couldn't be saved to your account just now, so checkout didn't open. Nothing was charged; please try again."
BOOKS = Path(__file__).resolve().parents[1] / "plan_books"

CATEGORIES = ["Sprint", "Middle distance", "Distance", "Dryland", "Youth & Masters"]
PLAN_PRICE = 4999  # cents: every plan is US$49.99

CATALOG: list[dict[str, Any]] = [
    {
        "id": "50-free-speed-lab", "title": "50m Freestyle Speed", "tagline": "Raw speed, race-pace 25s and starts that win the first 15 m.",
        "category": "Sprint", "level": "Advanced", "weeks": 6, "sessions_per_week": 6, "pages": 48, "price": PLAN_PRICE,
        "accent": "cyan", "badge": "Bestseller", "events": ["50m Freestyle", "50m Butterfly", "50m Backstroke", "50m Breaststroke"],
        "includes": ["36 fully written sessions: 4 in the pool and 2 in the gym each week", "Top-end, assisted and resisted speed work",
                     "Gym A and Gym B strength-power sessions", "A six-week roadmap with every week's swim volume", "A final performance check against Week 1"],
        "sample_week": [["Mon", "Top End Speed"], ["Tue", "Gym A"], ["Wed", "Assisted Speed"], ["Thu", "Rest"], ["Fri", "Hybrid Gym / Swim"], ["Sat", "Speed Work + Gym B"], ["Sun", "Rest"]],
    },
    {
        "id": "100-race-pace-system", "title": "100m Race Pace", "tagline": "Hold your goal pace for the whole 100 with broken swims that build.",
        "category": "Sprint", "level": "Intermediate – Elite", "weeks": 6, "sessions_per_week": 5, "pages": 51, "price": PLAN_PRICE,
        "accent": "violet", "badge": None, "events": ["100m Freestyle", "100m Butterfly", "100m Backstroke", "100m Breaststroke"],
        "includes": ["30 fully written sessions, 5 a week (62,750 m in all)", "Power, 50 race pace, resistance and 100 race pace work",
                     "Front End and Back End Speed for a precise 100", "The 100m race plan, applied to all four strokes", "Your race profile and six weekly training logs"],
        "sample_week": [["01", "Power"], ["02", "50 Race Pace"], ["03", "Aerobic / Recovery"], ["04", "Resistance"], ["05", "100 Race Pace"]],
    },
    {
        "id": "200-free-back-half", "title": "200m Endurance and Speed", "tagline": "Threshold, pacing discipline and the closing speed to finish strong.",
        "category": "Middle distance", "level": "Advanced", "weeks": 6, "sessions_per_week": 8, "pages": 67, "price": PLAN_PRICE,
        "accent": "sky", "badge": "New", "events": ["200m Freestyle", "200m Butterfly", "200m Backstroke", "200m Breaststroke", "200m IM"],
        "includes": ["48 fully written sessions, 8 a week (241.95 km in all)", "Threshold, VO2max and USRPT 200 race-pace sets",
                     "A 200m goal-pace baseline and colour-coded intensity", "Race guidance for each 200m stroke and the IM", "Session trackers, a race & taper checklist and a performance review"],
        "sample_week": [["Mon", "Power + Overspeed"], ["Tue", "Threshold / Aerobic Strength"], ["Tue", "Active Rest + Technique"], ["Wed", "200m Race Pace / USRPT"],
                        ["Thu", "Threshold / Aerobic Endurance"], ["Thu", "50m / 100m Speed Support"], ["Fri", "VO2max / 200m Speed Endurance"], ["Sat", "Kick + Aerobic Integration"]],
    },
    {
        "id": "distance-engine", "title": "Distance Freestyle", "tagline": "Big aerobic base, smart volume and pacing that never fades.",
        "category": "Distance", "level": "Intermediate – Elite", "weeks": 6, "sessions_per_week": 6, "pages": 53, "price": PLAN_PRICE,
        "accent": "emerald", "badge": None, "events": ["400m Freestyle", "800m Freestyle", "1500m Freestyle"],
        "includes": ["36 fully written sessions, 6 a week (199 km in all)", "Aerobic, threshold, recovery, IM, active-rest and race-pace sessions",
                     "Event guidance for the 400, 800 and 1500", "Pacing and championship-taper guidance", "A training log and every weekly session order"],
        "sample_week": [["01", "Low Level Aerobic"], ["02", "Threshold"], ["03", "Recovery"], ["04", "IM"], ["05", "Active-Rest"], ["06", "Lactate / Race-Pace"]],
    },
    {
        "id": "dryland-power", "title": "Strength and Power", "tagline": "Strength, power and shoulder health that carry straight into the water.",
        "category": "Dryland", "level": "Beginner – Advanced", "weeks": 8, "sessions_per_week": 3, "pages": 40, "price": PLAN_PRICE,
        "accent": "violet", "badge": None, "events": ["All events"],
        "includes": ["Gym and bodyweight-only versions", "Shoulder prehab routine", "Jump and start-power progressions", "Core for streamline", "Exercise videos by QR code"],
        "sample_week": [["Mon", "Lower power + core"], ["Wed", "Upper pull + shoulders"], ["Fri", "Full-body power"]],
    },
    {
        "id": "age-group-foundations", "title": "Age Group Development", "tagline": "Skills, aerobic base and all four strokes, the right way for young swimmers.",
        "category": "Youth & Masters", "level": "Ages 10–14", "weeks": 6, "sessions_per_week": 5, "pages": 75, "price": PLAN_PRICE,
        "accent": "emerald", "badge": None, "events": ["All four strokes", "IM"],
        "includes": ["30 sessions, each written for Level 1 (ages 10–12) and Level 2 (13–14)", "Four core sessions a week, plus an optional fifth",
                     "Four-stroke, IM, aerobic and speed-mechanics work", "Technique-first safety rules, with no forced breath-holding", "Skill checks and guidance for adapting to your pool"],
        "sample_week": [["01", "Four-Stroke Foundations"], ["02", "Aerobic Rhythm"], ["03", "The Speed Toolkit"], ["04", "IM Skills Circuit"], ["05", "Kick & Balance Lab (optional)"]],
    },
    {
        "id": "masters-comeback", "title": "Masters Performance", "tagline": "Speed, 50 and 100 race pace and smart recovery, built for competitive Masters swimmers.",
        "category": "Youth & Masters", "level": "Competitive Masters", "weeks": 6, "sessions_per_week": 5, "pages": 54, "price": PLAN_PRICE,
        "accent": "amber", "badge": "New", "events": ["50m events", "100m events"],
        "includes": ["24 swim sessions, 4 a week, plus a weekly strength or mobility session", "Power, 50 and 100 race pace, and aerobic technique work",
                     "Adapting the plan to your age and training history", "Three- and five-swim weeks and volume scaling", "A six-week training log and a post-block review"],
        "sample_week": [["Mon", "Swim: speed / power"], ["Tue", "Strength or mobility"], ["Wed", "Swim: aerobic / technique"], ["Thu", "Rest"],
                        ["Fri", "Swim: race pace"], ["Sat", "Rest"], ["Sun", "Swim: technical consolidation"]],
    },
]
BY_ID = {plan["id"]: plan for plan in CATALOG}


class PlanCheckoutRequest(BaseModel):
    plan_id: str = Field(min_length=1, max_length=80)


def _public(plan: dict[str, Any]) -> dict[str, Any]:
    return {**plan, "currency": "usd"}


@lru_cache(maxsize=1)
def book_index() -> dict[str, dict[str, int]]:
    """The plans that have a book (plan id -> pages, weeks, sessions a week), from plan_books/index.json."""
    try:
        return json.loads((BOOKS / "index.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.error("No plan books in %s: run scripts/build_plan_books.py", BOOKS)
        return {}


def for_sale() -> list[dict[str, Any]]:
    """The plans on sale: the ones with a book to deliver."""
    books = book_index()
    return [plan for plan in CATALOG if plan["id"] in books]


@lru_cache(maxsize=8)
def _book_bytes(plan_id: str) -> tuple[bytes, bytes]:
    """A book's JSON, as stored and gzipped. Books run to about a megabyte, so each is compressed once and kept."""
    data = (BOOKS / f"{plan_id}.json").read_bytes()
    return data, gzip.compress(data, compresslevel=6)


def _owns(auth_user_id: str, plan_id: str) -> bool:
    rows = (get_supabase_client().table(PURCHASES).select("id").eq("auth_user_id", auth_user_id).eq("plan_id", plan_id)
            .eq("status", "paid").limit(1).execute().data)
    return bool(rows)


def _purchases(auth_user_id: str) -> list[dict[str, Any]]:
    """Every purchase row of an account, oldest first."""
    return (get_supabase_client().table(PURCHASES).select("*").eq("auth_user_id", auth_user_id)
            .order("created_at").execute().data) or []


def _mark_paid(session: Any) -> dict[str, Any]:
    """Marks a checkout's pending purchase paid (a purchase already marked keeps its first paid_at)."""
    fields = {"status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(), "amount": session.amount_total}
    get_supabase_client().table(PURCHASES).update(fields).eq("stripe_checkout_session_id", session.id).eq("status", "pending").execute()
    return fields


def _settled(auth_user_id: str, closing: str | None = None) -> list[dict[str, Any]]:
    """The account's purchases, with pending ones brought up to date with Stripe first: paid ones are marked paid and
    expired (abandoned) ones removed; one still being paid (say by bank transfer) stays pending. A checkout still open
    for the plan `closing` is closed, so it can't be paid as well as a new one. Raises stripe.error.StripeError when
    Stripe can't be asked."""
    settled = []
    for row in _purchases(auth_user_id):
        if row["status"] == "pending":
            session = stripe.checkout.Session.retrieve(row["stripe_checkout_session_id"])
            if session.status == "open" and row["plan_id"] == closing:
                try:
                    session = stripe.checkout.Session.expire(session.id)
                except stripe.error.InvalidRequestError:
                    session = stripe.checkout.Session.retrieve(session.id)  # paid just now, so it can't be closed
            if session.payment_status == "paid":
                row = {**row, **_mark_paid(session)}
            elif session.status == "expired":
                get_supabase_client().table(PURCHASES).delete().eq("id", row["id"]).execute()
                continue
        settled.append(row)
    return settled


@router.get("/catalog")
def get_catalog() -> dict[str, Any]:
    plans = for_sale()
    return {"categories": [name for name in CATEGORIES if any(plan["category"] == name for plan in plans)],
            "plans": [_public(plan) for plan in plans]}


@router.get("/purchases")
def my_purchases(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """The plans the signed-in account has bought, oldest first."""
    buyer = get_authenticated_user(authorization)
    stripe.api_key = get_settings().stripe_secret_key
    try:
        try:
            rows = _settled(buyer.id)
        except stripe.error.StripeError:
            logger.warning("Could not settle pending plan purchases with Stripe", exc_info=True)
            rows = _purchases(buyer.id)  # what's recorded so far
    except APIError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Your plans couldn't be loaded just now.") from exc
    fields = ("plan_id", "plan_title", "amount", "currency", "paid_at")
    return {"purchases": [{field: row[field] for field in fields} for row in rows if row["status"] == "paid"]}


@router.post("/checkout")
def create_plan_checkout(request: PlanCheckoutRequest, authorization: str | None = Header(default=None)) -> dict[str, str]:
    """One-off Stripe Checkout for a single plan. It needs a signed-in account (any account: no subscription or
    onboarding), and the purchase is recorded against it before the buyer is sent to pay."""
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Payments aren't configured yet.")
    buyer = get_authenticated_user(authorization)
    plan = BY_ID.get(request.plan_id)
    if not plan or plan["id"] not in book_index():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That plan isn't available.")
    stripe.api_key = settings.stripe_secret_key
    try:
        purchases = _settled(buyer.id, closing=plan["id"])
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe couldn't be reached just now. Nothing was charged; please try again.") from exc
    except APIError as exc:
        logger.exception("Could not read plan purchases")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_SAVED) from exc
    if any(row["plan_id"] == plan["id"] and row["status"] == "paid" for row in purchases):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"You already own {plan['title']} on this account. Open it from Training Plans whenever you like.")
    metadata = {"kind": "pdf_plan", "plan_id": plan["id"], "auth_user_id": buyer.id}
    options: dict[str, Any] = {
        "mode": "payment",
        "managed_payments": {"enabled": False},
        "line_items": [{
            "price_data": {
                "currency": "usd", "unit_amount": plan["price"],
                "product_data": {"name": f"{plan['title']} · SwimGPT training plan",
                                 "description": f"{plan['weeks']}-week plan · {plan['sessions_per_week']} sessions/week · {plan['pages']} pages, "
                                                f"read in your SwimGPT account. {plan['tagline']}"},
            },
            "quantity": 1,
        }],
        "success_url": f"{settings.frontend_url}/training-plans/success?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.frontend_url}/training-plans?checkout=cancelled&plan={plan['id']}",
        "metadata": metadata,
        "payment_intent_data": {"metadata": metadata},
        "client_reference_id": buyer.id,
        **({"customer_email": buyer.email} if buyer.email else {}),
    }
    try:
        session = stripe.checkout.Session.create(**options)
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Stripe checkout error: {exc}") from exc
    if not session.url:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Stripe did not return a checkout URL.")
    try:
        get_supabase_client().table(PURCHASES).insert({
            "auth_user_id": buyer.id, "plan_id": plan["id"], "plan_title": plan["title"], "amount": plan["price"],
            "currency": "usd", "status": "pending", "stripe_checkout_session_id": session.id,
        }).execute()
    except APIError as exc:
        # Never send anyone to pay for a purchase their account won't show.
        logger.exception("Could not record plan checkout %s", session.id)
        try:
            stripe.checkout.Session.expire(session.id)
        except stripe.error.StripeError:
            logger.warning("Could not close unrecorded plan checkout %s", session.id, exc_info=True)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=NOT_SAVED) from exc
    return {"checkout_url": session.url, "session_id": session.id}


@router.get("/verify/{session_id}")
def verify_plan_checkout(session_id: str) -> dict[str, Any]:
    """Confirm a plan purchase with Stripe before the success page shows it, and mark it paid on the buyer's account."""
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
    paid = session.payment_status == "paid"
    buyer_id = metadata.get("auth_user_id")
    if paid and buyer_id:
        try:
            # The row written as checkout opened; recreated if it's missing, so a paid purchase is always on record.
            get_supabase_client().table(PURCHASES).upsert({
                "auth_user_id": buyer_id, "plan_id": plan["id"], "plan_title": plan["title"], "amount": session.amount_total,
                "currency": session.currency or "usd", "status": "pending", "stripe_checkout_session_id": session.id,
            }, on_conflict="stripe_checkout_session_id", ignore_duplicates=True).execute()
            _mark_paid(session)
        except APIError:
            # Still paid: the pending row is marked paid the next time the buyer's purchases are read.
            logger.exception("Could not record plan purchase %s", session.id)
    details = session.customer_details
    return {
        "paid": paid,
        "plan": _public(plan),
        "email": getattr(details, "email", None) if details else None,
        "amount_total": session.amount_total,
        "account": bool(buyer_id),
    }


@router.get("/{plan_id}/book")
def read_plan_book(plan_id: str, authorization: str | None = Header(default=None), accept_encoding: str = Header(default="")) -> Response:
    """The plan's book, for the account that bought it and nobody else. SwimGPT's reader redraws its pages; no PDF is
    ever sent."""
    buyer = get_authenticated_user(authorization)
    plan = BY_ID.get(plan_id)
    if plan is None or plan_id not in book_index():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="There's no book for that plan.")
    try:
        owned = _owns(buyer.id, plan_id)
        if not owned:
            # Paid, but not marked yet (the buyer closed the tab before the success page): Stripe has the last word.
            stripe.api_key = get_settings().stripe_secret_key
            try:
                owned = any(row["plan_id"] == plan_id and row["status"] == "paid" for row in _settled(buyer.id))
            except stripe.error.StripeError:
                logger.warning("Could not settle pending plan purchases with Stripe", exc_info=True)
    except APIError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Your plan couldn't be opened just now. Please try again.") from exc
    if not owned:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"{plan['title']} isn't on this account. Buy it from Training Plans to read it.")
    data, compressed = _book_bytes(plan_id)
    headers = {"Cache-Control": "private, no-store", "Vary": "Accept-Encoding"}
    if "gzip" in accept_encoding.lower():
        return Response(compressed, media_type="application/json", headers={**headers, "Content-Encoding": "gzip"})
    return Response(data, media_type="application/json", headers=headers)


PREVIEW_PAGES = (1, 2)  # Look inside: the two pages after the cover


@lru_cache(maxsize=8)
def _preview_bytes(plan_id: str) -> tuple[bytes, bytes]:
    """A book's Look inside pages with only the images they use. In-book links are dropped: the pages they point to
    aren't in the preview."""
    book = json.loads((BOOKS / f"{plan_id}.json").read_text(encoding="utf-8"))
    pages = [{key: value for key, value in book["pages"][index].items() if key != "links"} for index in PREVIEW_PAGES if index < len(book["pages"])]
    used = {op[1] for page in pages for op in page["ops"] if op[0] == "i"}
    preview = {"format": book["format"], "plan_id": plan_id, "size": book["size"], "fonts": book["fonts"],
               "images": {key: image for key, image in book["images"].items() if key in used},
               "pages": pages, "first_page": PREVIEW_PAGES[0], "page_count": len(book["pages"])}
    data = json.dumps(preview, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return data, gzip.compress(data, compresslevel=6)


@router.get("/{plan_id}/preview")
def preview_plan_book(plan_id: str, accept_encoding: str = Header(default="")) -> Response:
    """Look inside: the first two pages after the cover, for anyone browsing the store. The rest of the book is only
    for the account that bought it."""
    if plan_id not in BY_ID or plan_id not in book_index():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="There's no preview for that plan.")
    data, compressed = _preview_bytes(plan_id)
    headers = {"Cache-Control": "public, max-age=3600", "Vary": "Accept-Encoding"}
    if "gzip" in accept_encoding.lower():
        return Response(compressed, media_type="application/json", headers={**headers, "Content-Encoding": "gzip"})
    return Response(data, media_type="application/json", headers=headers)
