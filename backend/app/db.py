import dataclasses
import ssl
import threading
import time

import httpx
from gotrue.http_clients import SyncClient as AuthHttpClient
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


# Loading the CA certificates into an SSL context costs ~0.35 s of CPU, and every client made two (auth and database):
# one context per HTTP version is made once and shared (contexts are safe to share between connections and threads).
_ssl_contexts: dict[bool, ssl.SSLContext] = {}
_ssl_lock = threading.Lock()


def _ssl_context(http2: bool) -> ssl.SSLContext:
    with _ssl_lock:
        if http2 not in _ssl_contexts:
            _ssl_contexts[http2] = httpx.create_ssl_context(http2=http2)
        return _ssl_contexts[http2]


class _ResilientClient(Client):
    @staticmethod
    def _init_postgrest_client(rest_url, headers, schema, timeout=120, verify=True, proxy=None, http_client=None):
        # HTTP/1.1 checks that a pooled connection is still open before reusing it; HTTP/2 does not.
        transport = _RetryTransport(http2=False, verify=_ssl_context(False) if verify is True else verify, proxy=proxy)
        session = httpx.Client(transport=transport, timeout=timeout, follow_redirects=True)
        return SyncPostgrestClient(rest_url, headers=headers, schema=schema, http_client=session)

    @staticmethod
    def _init_supabase_auth_client(auth_url, client_options, verify=True, proxy=None):
        # The auth client's HTTP client, made as the auth library makes it, with the shared SSL context.
        if client_options.httpx_client is None and verify is True:
            client_options = dataclasses.replace(client_options, httpx_client=AuthHttpClient(
                verify=_ssl_context(True), proxy=proxy, follow_redirects=True, http2=True))
        return Client._init_supabase_auth_client(auth_url, client_options, verify, proxy)


# Making a client costs ~0.4 s of CPU (plus a TLS handshake on its first request), and the server's worker threads come
# and go (idle ones are stopped after a few seconds). So a client outlives its thread: when the thread ends, the client
# goes back here for the next new thread, and is still only ever used by one thread at a time.
_idle: list[Client] = []
_idle_lock = threading.Lock()


class _Lease:
    """A thread's hold on a client; returns it to the idle clients when the thread ends."""

    def __init__(self, client: Client):
        self.client = client

    def __del__(self):
        try:
            with _idle_lock:
                _idle.append(self.client)
        except Exception:  # interpreter shutting down
            pass


def warm_clients(count: int) -> None:
    """Make `count` idle clients ahead of time (run once at startup, in the background), so the first burst of requests
    after a deploy doesn't pay for making them one by one."""
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_secret_key:
        return
    for _ in range(count):
        client = _ResilientClient.create(settings.supabase_url, settings.supabase_secret_key)
        with _idle_lock:
            _idle.append(client)


def get_supabase_client() -> Client:
    lease = getattr(_local, "lease", None)
    if lease is None:
        with _idle_lock:
            client = _idle.pop() if _idle else None
        if client is None:
            settings = get_settings()
            if not settings.supabase_url or not settings.supabase_secret_key:
                raise RuntimeError(
                    "Missing SUPABASE_SECRET_KEY or NEXT_PUBLIC_SUPABASE_URL in the backend environment."
                )
            client = _ResilientClient.create(settings.supabase_url, settings.supabase_secret_key)
        lease = _Lease(client)
        _local.lease = lease
    return lease.client
