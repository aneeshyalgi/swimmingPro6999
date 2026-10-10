import time
from typing import Any

import httpx
from fastapi import HTTPException
from gotrue.errors import AuthApiError

from app.db import get_supabase_client
from app.payments import is_paid
from app.swim_times import with_display_times


def get_authenticated_user(authorization: str | None):
    """The Supabase user behind a Bearer token (for endpoints used before a profile exists)."""
    if not authorization or not authorization.startswith("Bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Sign in to load your athlete profile.")
    supabase = get_supabase_client()
    for attempt in range(3):
        try:
            authenticated = supabase.auth.get_user(authorization[7:])
            break
        except AuthApiError as exc:
            raise HTTPException(status_code=401, detail="Your session is invalid or expired.") from exc
        except httpx.TransportError:
            # Token verification is read-only, so a dropped connection is safe to retry.
            if attempt == 2:
                raise
            time.sleep(0.2 * (attempt + 1))
    if not authenticated.user:
        raise HTTPException(status_code=401, detail="Your session is invalid or expired.")
    return authenticated.user


def latest_profile_row(auth_user_id: str) -> dict[str, Any] | None:
    """The athlete profile linked to an account (the newest one if older duplicates exist)."""
    result = (
        get_supabase_client().table("user_profiles").select("*")
        .eq("auth_user_id", auth_user_id)
        .order("created_at", desc=True).limit(1).execute()
    )
    return result.data[0] if result.data else None


def get_authenticated_profile(authorization: str | None) -> dict[str, Any]:
    """The signed-in athlete's profile, for the dashboard and every feature in it: only a paid profile gets one."""
    user = get_authenticated_user(authorization)
    row = latest_profile_row(user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Complete onboarding to create your athlete profile.")
    if not is_paid(row):
        raise HTTPException(status_code=402, detail="Activate your coaching plan to open your dashboard.")
    profile = with_display_times(row)
    # An athlete has one coach. Profiles saved when athletes had two keep only their head coach.
    profile["recommended_coaches"] = (row.get("recommended_coaches") or [])[:1]
    return profile
