"""Who may run a Stroke Lab video analysis: subscribers as often as they like, everyone else once.

The free analysis is remembered on the server under every identity a request carries, so clearing the browser, a
private window, signing up or calling the API directly doesn't give a second one:
- the browser: a random visitor id the page keeps (remembered for good),
- the network: a keyed hash of the IP address and browser (remembered for 30 days, so one person's analysis doesn't
  shut a shared club or mobile network out for good),
- the account, when signed in (remembered for good).
After that, an account with an active subscription is needed (the same check that opens the dashboard).

The records are tiny objects in a private Supabase Storage bucket that the backend creates itself. Creating an object
fails if it already exists, so claiming the free analysis is atomic: two requests at once can't both get it. Deleting
the bucket's objects resets every free analysis (handy when testing locally, where every visitor is 127.0.0.1).
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import ipaddress
import json
import logging
import re
import threading
import time
from typing import Any

from fastapi import HTTPException, Request, status
from storage3.exceptions import StorageApiError

from app.auth import get_authenticated_user, latest_profile_row
from app.config import get_settings
from app.db import get_supabase_client
from app.payments import is_paid

logger = logging.getLogger(__name__)

BUCKET = "video-analysis-free-uses"
NETWORK_MEMORY = timedelta(days=30)
VISITOR_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
# Stroke recognition for someone still on their free analysis: plenty for a few clips, not for running up the AI bill.
FREE_RECOGNITIONS_PER_HOUR = 8

SUBSCRIBED, FREE, SIGNUP_REQUIRED, SUBSCRIPTION_REQUIRED = "subscribed", "free", "signup_required", "subscription_required"
PAYWALL_MESSAGES = {
    SIGNUP_REQUIRED: "You've used your free video analysis. Create an account and subscribe to keep analysing your clips.",
    SUBSCRIPTION_REQUIRED: "You've used your free video analysis. Subscribe to keep analysing your clips.",
}
UNCHECKED = "Your free analysis couldn't be checked just now. Please try again in a moment."


@dataclass
class Visitor:
    """Whoever is asking for an analysis, and where their free analysis is (or would be) recorded."""

    signed_in: bool
    subscribed: bool
    records: dict[str, str]  # "browser" / "network" / "account" -> object path in BUCKET
    # The browser itself remembers using its free analysis (it did before the server kept count). Only ever believed
    # in that direction.
    said_used: bool = False


def _through_proxy(peer: str) -> bool:
    """Whether the connection came from a proxy on a private network, as a hosting platform's load balancer does."""
    try:
        return not ipaddress.ip_address(peer).is_global
    except ValueError:
        return False


def client_ip(request: Request) -> str:
    """The caller's IP address. Through a proxy, it's the one the outermost of TRUSTED_PROXY_HOPS proxies saw (each
    appends to X-Forwarded-For); entries further left were sent by the caller, so they're never trusted, and neither is
    the header from a connection on the open internet, which could have written it itself."""
    peer = request.client.host if request.client else ""
    hops = get_settings().trusted_proxy_hops
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",") if part.strip()]
    if hops > 0 and len(forwarded) >= hops and _through_proxy(peer):
        return forwarded[-hops]
    return peer


def _network(request: Request) -> str:
    # Keyed with the backend's secret, so the stored name can't be turned back into an IP address.
    seen = f"{client_ip(request)}|{request.headers.get('user-agent', '')}"
    return hmac.new(get_settings().supabase_secret_key.encode(), seen.encode(), hashlib.sha256).hexdigest()


def identify(request: Request, authorization: str | None) -> Visitor:
    """Who is asking: signed in or not, subscribed or not. An expired or invalid session is a 401."""
    records = {}
    visitor_id = request.headers.get("x-visitor-id", "").strip().lower()
    if VISITOR_ID.match(visitor_id):
        records["browser"] = f"browser/{visitor_id}"
    records["network"] = f"network/{_network(request)}"
    said_used = request.headers.get("x-free-analysis-used") == "1"
    if not authorization:
        return Visitor(signed_in=False, subscribed=False, records=records, said_used=said_used)
    user = get_authenticated_user(authorization)
    records["account"] = f"account/{user.id}"
    row = latest_profile_row(user.id)
    return Visitor(signed_in=True, subscribed=row is not None and is_paid(row), records=records, said_used=said_used)


_bucket_ready = False
_bucket_lock = threading.Lock()


def _files() -> Any:
    """The bucket of free-analysis records, created on first use."""
    global _bucket_ready
    storage = get_supabase_client().storage
    if not _bucket_ready:
        with _bucket_lock:
            if not _bucket_ready:
                try:
                    storage.create_bucket(BUCKET, options={"public": False})
                except StorageApiError as error:
                    if str(error.status) != "409":  # 409: it already exists
                        raise
                _bucket_ready = True
    return storage.from_(BUCKET)


def _stamp() -> bytes:
    return json.dumps({"used_at": datetime.now(timezone.utc).isoformat()}).encode()


def _used(kind: str, path: str) -> bool:
    """Whether a record shows the free analysis as used. A network's record only counts for NETWORK_MEMORY."""
    try:
        record = json.loads(_files().download(path))
    except StorageApiError as error:
        if str(error.status) == "404":
            return False
        raise
    if kind != "network":
        return True
    return datetime.now(timezone.utc) - datetime.fromisoformat(record["used_at"]) < NETWORK_MEMORY


def access(visitor: Visitor) -> str:
    """subscribed, free (the free analysis is still there), or what the visitor needs to keep analysing. Raises when the
    records can't be read."""
    if visitor.subscribed:
        return SUBSCRIBED
    if not visitor.said_used and not any(_used(kind, path) for kind, path in visitor.records.items()):
        return FREE
    return SUBSCRIPTION_REQUIRED if visitor.signed_in else SIGNUP_REQUIRED


def claim(visitor: Visitor) -> list[str] | None:
    """Records the free analysis under each of the visitor's identities. The records written (for release() if the
    analysis then fails), or None, with nothing written, when one of them has already had it."""
    written: list[str] = []
    for kind, path in visitor.records.items():
        try:
            _files().upload(path, _stamp(), {"content-type": "application/json"})
        except StorageApiError as error:
            if str(error.status) != "409":
                release(written)
                raise
            if kind == "network" and not _used(kind, path):
                # The network's last free analysis is older than NETWORK_MEMORY: this one replaces it.
                _files().upload(path, _stamp(), {"content-type": "application/json", "upsert": "true"})
            else:
                release(written)
                return None
        written.append(path)
    return written


def release(paths: list[str]) -> None:
    """Gives a free analysis back (its analysis failed), so it isn't used up by an error."""
    if not paths:
        return
    try:
        _files().remove(paths)
    except Exception:
        logger.warning("Could not give back the free analysis recorded at %s", paths, exc_info=True)


def paywall(visitor: Visitor) -> HTTPException:
    code = SUBSCRIPTION_REQUIRED if visitor.signed_in else SIGNUP_REQUIRED
    return HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail={"code": code, "message": PAYWALL_MESSAGES[code]})


def checked_access(visitor: Visitor) -> str:
    """access(), failing closed: when the records can't be read, nobody gets a free analysis (subscribers aren't affected)."""
    try:
        return access(visitor)
    except Exception as exc:
        logger.exception("Could not read the free video analysis records")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNCHECKED) from exc


def start_analysis(visitor: Visitor) -> list[str]:
    """Lets an analysis go ahead, claiming the free one when it's that. The records claimed ([] for a subscriber), to
    release() if the analysis fails. 402 once the free analysis is used; 503 when that can't be checked."""
    current = checked_access(visitor)
    if current == SUBSCRIBED:
        return []
    if current != FREE:
        raise paywall(visitor)
    try:
        claimed = claim(visitor)
    except Exception as exc:
        logger.exception("Could not record a free video analysis")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNCHECKED) from exc
    if claimed is None:
        raise paywall(visitor)
    return claimed


_recognitions: dict[str, deque[float]] = {}
_recognitions_lock = threading.Lock()


def allow_recognition(visitor: Visitor) -> None:
    """Stroke recognition runs for whoever may still analyse: subscribers, and anyone whose free analysis is still there
    (a few clips an hour per network). 402 once the free analysis is used, 429 past that hourly allowance."""
    current = checked_access(visitor)
    if current == SUBSCRIBED:
        return
    if current != FREE:
        raise paywall(visitor)
    now = time.monotonic()
    with _recognitions_lock:
        if len(_recognitions) > 10_000:  # forget networks quiet for an hour, so this can't grow without end
            for key in [key for key, times in _recognitions.items() if not times or now - times[-1] > 3600]:
                del _recognitions[key]
        recent = _recognitions.setdefault(visitor.records["network"], deque())
        while recent and now - recent[0] > 3600:
            recent.popleft()
        if len(recent) >= FREE_RECOGNITIONS_PER_HOUR:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail="That's a lot of clips in a short time. Try again in a little while.")
        recent.append(now)
