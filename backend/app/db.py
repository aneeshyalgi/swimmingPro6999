import threading
import time

import httpx
from postgrest import SyncPostgrestClient
from supabase import Client

from app.config import get_settings

# FastAPI runs sync endpoints in a thread pool. A single shared Supabase client multiplexes every
# thread over one HTTP/2 connection, which fails intermittently under concurrent requests
# ("Server disconnected"), so each worker thread gets its own client.
_local = threading.local()

_TRANSIENT = (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError, httpx.WriteError)


def _safe_to_retry(request: httpx.Request, exc: Exception) -> bool:
    if isinstance(exc, httpx.ConnectError):
        return True  # the request never reached the server
    if request.method != "POST":
        return True  # GET / PATCH / DELETE are idempotent
    # POST is an upsert (merge-duplicates) or a read-only RPC; plain inserts are never replayed.
    return "merge-duplicates" in request.headers.get("prefer", "") or "/rpc/" in request.url.path


class _RetryTransport(httpx.HTTPTransport):
    """Retries requests that fail because Supabase dropped a pooled connection."""

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        for attempt in range(3):
            try:
                return super().handle_request(request)
            except _TRANSIENT as exc:
                if attempt == 2 or not _safe_to_retry(request, exc):
                    raise
                time.sleep(0.2 * (attempt + 1))
        raise AssertionError("unreachable")


class _ResilientClient(Client):
    @staticmethod
    def _init_postgrest_client(rest_url, headers, schema, timeout=120, verify=True, proxy=None, http_client=None):
        # HTTP/1.1 checks that a pooled connection is still open before reusing it; HTTP/2 does not.
        session = httpx.Client(transport=_RetryTransport(http2=False, verify=verify, proxy=proxy), timeout=timeout, follow_redirects=True)
        return SyncPostgrestClient(rest_url, headers=headers, schema=schema, http_client=session)


def get_supabase_client() -> Client:
    client = getattr(_local, "client", None)
    if client is None:
        settings = get_settings()
        if not settings.supabase_url or not settings.supabase_secret_key:
            raise RuntimeError(
                "Missing SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_URL in the backend environment."
            )
        client = _ResilientClient.create(settings.supabase_url, settings.supabase_secret_key)
        _local.client = client
    return client
