"""
Invoice Fetcher — Python Worker API.

Wraps the existing core/ business logic as a FastAPI service.
Called by the Next.js app to execute Gmail scans and exports.

Start: python -m worker.main (binds to 0.0.0.0:$PORT, default 8000)
"""

import asyncio
import hmac
import json
import logging
import os
import re
import sys
import time
import uuid
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)

# Load web/.env so the worker picks up Google OAuth credentials.
# Next.js uses AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET; the Python core
# expects GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_web_env = os.path.join(_project_root, "web", ".env")
if os.path.isfile(_web_env):
    from dotenv import load_dotenv
    load_dotenv(_web_env)

# Bridge Next-Auth env var names → Python-side names
if not os.getenv("GOOGLE_CLIENT_ID") and os.getenv("AUTH_GOOGLE_ID"):
    os.environ["GOOGLE_CLIENT_ID"] = os.environ["AUTH_GOOGLE_ID"]
if not os.getenv("GOOGLE_CLIENT_SECRET") and os.getenv("AUTH_GOOGLE_SECRET"):
    os.environ["GOOGLE_CLIENT_SECRET"] = os.environ["AUTH_GOOGLE_SECRET"]

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Add project root to path so we can import core/
sys.path.insert(0, _project_root)

from core.gmail_connector import GmailConnector
from core.invoice_classifier import classify_results
from core.amount_extractor import enrich_results
from core.body_parser import BodyParser
from core import paypal_provider

# Route the worker's own logs through the project logger (console + file, with
# the standard format used by core/* modules) so the scan funnel + per-reject
# diagnostics actually surface in Render logs and output/logs/invoice_fetcher.log.
# A bare logging.getLogger() has no handler attached, so those records were
# being dropped. LOG_LEVEL (default INFO) gates them; set LOG_LEVEL=DEBUG to
# also get a per-rejected-email reason line.
from utils.logger import get_logger
logger = get_logger("worker.main")
logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())


def _worker_version() -> str:
    """Best-effort running-commit identifier so /health proves WHICH code is
    live (deploy-cache / wrong-service bugs are otherwise invisible). Render
    injects RENDER_GIT_COMMIT automatically; other platforms use the fallbacks.
    """
    for k in (
        "RENDER_GIT_COMMIT", "WORKER_GIT_SHA", "SOURCE_VERSION",
        "GIT_COMMIT", "VERCEL_GIT_COMMIT_SHA", "RAILWAY_GIT_COMMIT_SHA",
    ):
        v = os.getenv(k)
        if v:
            return v[:12]
    return "unknown"


WORKER_VERSION = _worker_version()

# Behavioural proof that the PayPal discovery fix is actually in THIS build —
# more reliable than a commit hash (which can be stale via build cache). We
# build a probe query at startup and check for the `from:paypal` anchor.
try:
    _PAYPAL_DISCOVERY_ANCHOR = "from:paypal" in GmailConnector().build_query([], 30, False)
except Exception:  # never let a probe crash worker startup
    _PAYPAL_DISCOVERY_ANCHOR = False

logger.info(
    "WORKER STARTUP — version=%s paypal_discovery_anchor=%s log_level=%s",
    WORKER_VERSION, _PAYPAL_DISCOVERY_ANCHOR, logger.level,
)

app = FastAPI(title="Invoice Fetcher Worker", version="0.1.0")

# ── Bearer token auth middleware ─────────────────────────────────────────
# When WORKER_SECRET is set, all requests must include a matching
# Authorization: Bearer <secret> header. This prevents unauthorized
# network callers from invoking scan/export endpoints directly.

_WORKER_SECRET = os.getenv("WORKER_SECRET", "")

if not _WORKER_SECRET:
    # Loud at import time (covers uvicorn-direct AND python -m worker.main):
    # an unset secret silently disables auth on every endpoint.
    logger.critical(
        "WORKER_SECRET not set — worker API is UNAUTHENTICATED. "
        "Set WORKER_SECRET in production to prevent unauthorized access."
    )


@app.middleware("http")
async def verify_worker_auth(request: Request, call_next):
    # Health + readiness endpoints are exempt — used by load balancers /
    # monitors. Neither returns secrets: /health is a static liveness ping and
    # /ready reports only booleans, a commit id, and error TYPE names.
    if request.url.path in ("/health", "/ready"):
        return await call_next(request)

    if _WORKER_SECRET:
        auth_header = request.headers.get("authorization", "")
        expected = f"Bearer {_WORKER_SECRET}"
        # Constant-time compare — a plain != leaks the match length/prefix
        # through response timing.
        if not hmac.compare_digest(auth_header.encode(), expected.encode()):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing worker authorization"},
            )

    return await call_next(request)


# ── Export file cache (memory hot cache + disk persistence) ─────────────────
# Memory is a TTL/size-bounded hot cache; every entry with a valid CUID job_id
# is ALSO persisted to disk so pending downloads survive a worker restart or
# redeploy (previously every restart 410'd all pending downloads).

_FILE_CACHE: dict[str, dict] = {}
_CACHE_TTL = 1800  # 30 minutes
_CACHE_MAX_ENTRIES = 50  # Max cached files to prevent OOM
_CACHE_MAX_BYTES = 500 * 1024 * 1024  # 500 MB total cache limit
_CACHE_DIR = os.path.join("output", "exports", "cache")
# CUID shape — the ONLY job_id form allowed to become a filename. Client
# supplied, so anything else (e.g. "../evil") must never reach a path.
_JOB_ID_RE = re.compile(r"c[a-zA-Z0-9]{20,30}")
_cache_lock = Lock()


def _cache_total_bytes() -> int:
    """Total bytes of cached file data. Must be called with _cache_lock held."""
    return sum(len(v.get("data", b"")) for v in _FILE_CACHE.values())


def _disk_cache_paths(job_id: str) -> tuple[str, str]:
    return (
        os.path.join(_CACHE_DIR, f"{job_id}.bin"),
        os.path.join(_CACHE_DIR, f"{job_id}.json"),
    )


def _disk_cache_unlink(job_id: str) -> None:
    for p in _disk_cache_paths(job_id):
        try:
            os.remove(p)
        except OSError:
            pass


def _disk_cache_put(job_id: str, data: bytes, metadata: dict) -> None:
    """Persist an export to disk (atomic tmp-file + os.replace)."""
    if not _JOB_ID_RE.fullmatch(job_id):
        logger.warning(
            "Disk cache skipped — job_id %r is not a valid CUID", job_id[:40]
        )
        return
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        bin_path, meta_path = _disk_cache_paths(job_id)
        tmp_bin = bin_path + ".tmp"
        with open(tmp_bin, "wb") as f:
            f.write(data)
        os.replace(tmp_bin, bin_path)
        tmp_meta = meta_path + ".tmp"
        with open(tmp_meta, "w", encoding="utf-8") as f:
            json.dump({**metadata, "created": time.time()}, f)
        os.replace(tmp_meta, meta_path)
    except OSError as e:
        logger.warning("Disk cache write failed for %s: %s", job_id, e)


def _disk_cache_get(job_id: str) -> dict | None:
    """Load a persisted export. Expired pairs are unlinked on access."""
    if not _JOB_ID_RE.fullmatch(job_id):
        return None
    bin_path, meta_path = _disk_cache_paths(job_id)
    if not (os.path.isfile(bin_path) and os.path.isfile(meta_path)):
        return None
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        if time.time() - float(meta.get("created", 0)) > _CACHE_TTL:
            _disk_cache_unlink(job_id)
            return None
        with open(bin_path, "rb") as f:
            data = f.read()
        return {"data": data, **meta}
    except (OSError, ValueError) as e:
        logger.warning("Disk cache read failed for %s: %s", job_id, e)
        return None


def _disk_cache_sweep() -> None:
    """Unlink expired/orphaned disk-cache files. Runs at startup (purging
    leftovers from before a crash) and opportunistically on each put."""
    if not os.path.isdir(_CACHE_DIR):
        return
    now = time.time()
    for name in os.listdir(_CACHE_DIR):
        path = os.path.join(_CACHE_DIR, name)
        try:
            if name.endswith(".json"):
                with open(path, "r", encoding="utf-8") as f:
                    created = float(json.load(f).get("created", 0))
                if now - created > _CACHE_TTL:
                    _disk_cache_unlink(name[:-5])
            elif now - os.path.getmtime(path) > _CACHE_TTL:
                # Orphaned .bin or leftover .tmp from an interrupted write.
                os.remove(path)
        except (OSError, ValueError):
            continue


def _cache_trim_locked(protect: str) -> None:
    """Enforce the TTL/count/byte caps on the in-memory hot cache.

    Must be called with _cache_lock held. Drops expired entries, then evicts
    the oldest entries until both _CACHE_MAX_ENTRIES and _CACHE_MAX_BYTES are
    satisfied — never evicting ``protect`` (the entry the caller just inserted
    and still needs to serve). Shared by _cache_put AND _cache_get so a disk
    hit that repopulates memory is bounded by the SAME caps as a fresh put
    (otherwise a post-restart download burst grows _FILE_CACHE unbounded → OOM).

    Evicts the oldest *non-protected* entry each pass (rather than breaking when
    the overall-oldest is the protected one): on a disk repopulate the freshly
    inserted entry carries its original — possibly oldest — created timestamp,
    so a break-on-protected loop would stop without enforcing the caps.
    """
    _cache_cleanup()
    while (
        len(_FILE_CACHE) > _CACHE_MAX_ENTRIES
        or _cache_total_bytes() > _CACHE_MAX_BYTES
    ) and len(_FILE_CACHE) > 1:
        evictable = [k for k in _FILE_CACHE if k != protect]
        if not evictable:
            break  # only the protected entry remains — we must keep it
        oldest_key = min(evictable, key=lambda k: _FILE_CACHE[k]["created"])
        del _FILE_CACHE[oldest_key]


def _cache_put(job_id: str, data: bytes, metadata: dict | None = None):
    """Store a generated file (memory hot cache + disk persistence).

    Memory enforces entry count and total size limits, evicting oldest
    entries to prevent unbounded growth. Disk persistence only happens for
    valid CUID job_ids and is what lets downloads survive a restart.
    Blocking (disk I/O) — call via asyncio.to_thread from async code.
    """
    meta = dict(metadata or {})
    with _cache_lock:
        _FILE_CACHE[job_id] = {
            "data": data,
            "created": time.time(),
            **meta,
        }
        _cache_trim_locked(job_id)
    _disk_cache_put(job_id, data, meta)
    _disk_cache_sweep()


def _cache_get(job_id: str) -> dict | None:
    """Retrieve a cached file (memory first, then disk). None if expired or
    missing. Blocking on the disk path — call via asyncio.to_thread."""
    with _cache_lock:
        entry = _FILE_CACHE.get(job_id)
        if entry:
            if time.time() - entry["created"] > _CACHE_TTL:
                del _FILE_CACHE[job_id]
            else:
                return entry
    # Memory miss (fresh process, eviction, or expiry) — try the disk copy.
    entry = _disk_cache_get(job_id)
    if entry:
        with _cache_lock:
            _FILE_CACHE.setdefault(job_id, entry)
            # Enforce the SAME count/byte caps as _cache_put. A post-restart
            # burst of downloads of many/large pending exports would otherwise
            # repopulate _FILE_CACHE unbounded (setdefault bypasses eviction) →
            # OOM. Protect job_id so the bytes we return stay served.
            _cache_trim_locked(job_id)
    return entry


def _cache_cleanup():
    """Remove expired memory entries. Called inside _cache_put (holds lock)."""
    now = time.time()
    expired = [k for k, v in _FILE_CACHE.items() if now - v["created"] > _CACHE_TTL]
    for k in expired:
        del _FILE_CACHE[k]


# Startup sweep — purge disk-cache leftovers that expired while down.
try:
    _disk_cache_sweep()
except Exception:  # never block worker startup on cache hygiene
    logger.warning("Startup disk-cache sweep failed", exc_info=True)


# ── Request/Response models ──────────────────────────────────────────────


class ScanRequest(BaseModel):
    access_token: str = Field(..., max_length=4096)
    refresh_token: str | None = Field(None, max_length=4096)
    token_expiry: str | None = Field(None, max_length=64)
    keywords: list[str] = Field(default=[], max_length=20)
    days_back: int = Field(30, ge=1, le=730)
    # Default False: scanning ALL mail (read + unread) is the correct default —
    # most invoices are already read. A True default was a silent-exclusion
    # footgun if any caller omitted the field. The web always sends an explicit
    # value; this only affects direct/diagnostic callers.
    unread_only: bool = False
    scan_id: str = Field("", max_length=64)


class ScanResult(BaseModel):
    scan_id: str
    total_messages: int
    invoices: list[dict[str, Any]]
    error: str | None = None


class ExportRequest(BaseModel):
    invoices: list[dict[str, Any]] = Field(default=[], max_length=10_000)
    format: str = Field("csv", max_length=20)
    organization_name: str = Field("", max_length=500)
    include_screenshots: bool = False
    job_id: str = Field("", max_length=64)


# ── Health ───────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    # version + paypal_discovery_anchor make it possible to PROVE, with a single
    # unauthenticated curl, that this process is running the new PayPal code and
    # not a stale build. (/health was previously version-less — the exact gap
    # that made "is the worker actually redeployed?" unanswerable.)
    return {
        "status": "ok",
        "service": "invoice-fetcher-worker",
        "version": WORKER_VERSION,
        "paypal_discovery_anchor": _PAYPAL_DISCOVERY_ANCHOR,
    }


@app.get("/ready")
async def ready():
    """Deep readiness — proves the worker can actually START scan work, not just
    answer a shallow liveness ping. A warm /health can coexist with a /scan that
    hangs before its first byte (the exact failure this endpoint exists to
    catch), because /health never exercises the scan path's dependencies.

    Checks, both bounded so this endpoint itself can never hang:
      (a) the scan pipeline imports and can build a query (in-process), and
      (b) outbound TLS to Google's OAuth token host is reachable — this is the
          dependency /scan's synchronous token refresh needs, and a blocked or
          slow egress here is what stalls a scan before any progress is emitted.

    Uses NO user tokens and returns NO secrets (booleans, a commit id, and
    exception TYPE names only). Returns 200 when ready, 503 otherwise.
    """
    from starlette.concurrency import run_in_threadpool

    checks: dict[str, Any] = {}
    t0 = time.monotonic()

    # (a) scan pipeline import + query build — cheap, proves the process can
    #     construct the objects /scan needs.
    try:
        GmailConnector().build_query([], 30, False)
        checks["scan_pipeline_importable"] = True
    except Exception as e:  # pragma: no cover - defensive
        checks["scan_pipeline_importable"] = False
        checks["pipeline_error"] = type(e).__name__

    # (b) bounded reachability probe to Google's OAuth token host. Connection +
    #     TLS handshake only — no request body, no credentials.
    def _probe_google_oauth() -> None:
        import socket
        import ssl

        ctx = ssl.create_default_context()
        with socket.create_connection(("oauth2.googleapis.com", 443), timeout=4) as sock:
            with ctx.wrap_socket(sock, server_hostname="oauth2.googleapis.com"):
                pass

    try:
        await asyncio.wait_for(run_in_threadpool(_probe_google_oauth), timeout=5)
        checks["google_oauth_reachable"] = True
    except Exception as e:
        checks["google_oauth_reachable"] = False
        checks["oauth_probe_error"] = type(e).__name__

    ready_ok = (
        checks.get("scan_pipeline_importable") is True
        and checks.get("google_oauth_reachable") is True
    )
    return JSONResponse(
        status_code=200 if ready_ok else 503,
        content={
            "ready": ready_ok,
            "version": WORKER_VERSION,
            "checks": checks,
            "probe_ms": int((time.monotonic() - t0) * 1000),
        },
    )


# ── PayPal discovery debug (real Gmail, no fixtures) ─────────────────────────


class DiscoveryDebugRequest(BaseModel):
    access_token: str = Field(..., max_length=4096)
    refresh_token: str | None = Field(None, max_length=4096)
    token_expiry: str | None = Field(None, max_length=64)
    days_back: int = Field(365, ge=1, le=730)


@app.post("/debug/discovery")
async def debug_discovery(req: DiscoveryDebugRequest):
    """Run REAL Gmail discovery probes for PayPal against the connected account.

    Returns counts + redacted samples + a classification sample so we can prove
    end-to-end exactly where PayPal becomes zero (mailbox / scope / query /
    fetch / classify). Tokens are NEVER echoed back.
    """
    import json
    from datetime import datetime as _dt, timedelta as _td

    creds_dict: dict[str, Any] = {
        "token": req.access_token,
        "refresh_token": req.refresh_token,
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    if req.token_expiry:
        creds_dict["expiry"] = req.token_expiry.rstrip("Z").split(".")[0]

    connector = GmailConnector()
    ok, result = connector.build_service_from_json(json.dumps(creds_dict))
    if not ok:
        # result carries AUTH_ERROR: prefix when the grant lacks gmail.readonly
        return JSONResponse(status_code=200, content={
            "worker_version": WORKER_VERSION,
            "auth_ok": False,
            "auth_error": result[:300],
            "hint": "Reconnect Gmail and tick the Gmail box on Google's consent screen.",
        })

    def _run() -> dict:
        # Blocking Gmail pipeline (15+ serial list/get calls with time.sleep
        # retry backoff) — runs in a worker thread via asyncio.to_thread below
        # so the event loop (/health, concurrent scans) stays responsive (H5).
        since = (_dt.now() - _td(days=req.days_back)).strftime("%Y/%m/%d")
        full_query = connector.build_query([], req.days_back, unread_only=False)

        probes: dict[str, Any] = {}
        probe_specs = [
            ("from:paypal", f"after:{since} from:paypal"),
            ("from:paypal.com", f"after:{since} from:paypal.com"),
            ("word:paypal", f"after:{since} paypal"),
            ("category:purchases", f"after:{since} category:purchases"),
            ("full_scan_query", full_query),
        ]
        for label, q in probe_specs:
            try:
                resp = connector._exec(
                    connector.service.users().messages().list(userId="me", q=q, maxResults=5)
                )
                ids = [m["id"] for m in resp.get("messages", [])]
                samples = []
                for mid in ids[:5]:
                    try:
                        raw = connector.get_message(mid)
                        parsed = connector.parse_message(raw)
                        samples.append({
                            "sender": (parsed.get("sender") or "")[:120],
                            "subject": (parsed.get("subject") or "")[:140],
                            "date": (parsed.get("date") or "")[:40],
                        })
                    except Exception as e:
                        samples.append({"error": f"{type(e).__name__}: {str(e)[:80]}"})
                probes[label] = {
                    "result_size_estimate": resp.get("resultSizeEstimate"),
                    "returned_ids": len(ids),
                    "samples": samples,
                }
            except Exception as e:
                probes[label] = {"error": f"{type(e).__name__}: {str(e)[:120]}"}

        # Classification sample on the from:paypal hits — proves parse → classify.
        from core.invoice_classifier import classify_email as _classify_one
        pipeline_sample = []
        try:
            pp_resp = connector._exec(
                connector.service.users().messages().list(
                    userId="me", q=f"after:{since} from:paypal", maxResults=10
                )
            )
            for mid in [m["id"] for m in pp_resp.get("messages", [])][:10]:
                try:
                    raw = connector.get_message(mid)
                    parsed = connector.parse_message(raw)
                    cls = _classify_one(parsed)
                    intent = paypal_provider.classify_intent(parsed)
                    ex = paypal_provider.extract_paypal(parsed) if intent else {}
                    pipeline_sample.append({
                        "sender": (parsed.get("sender") or "")[:120],
                        "subject": (parsed.get("subject") or "")[:140],
                        "tier": cls.get("classification_tier"),
                        "score": cls.get("classification_score"),
                        "is_transaction": bool(intent),
                        "merchant": ex.get("merchant"),
                        "amount": ex.get("amount"),
                        "currency": ex.get("currency"),
                    })
                except Exception as e:
                    pipeline_sample.append({"error": f"{type(e).__name__}: {str(e)[:80]}"})
        except Exception as e:
            pipeline_sample.append({"error": f"{type(e).__name__}: {str(e)[:120]}"})

        return {
            "worker_version": WORKER_VERSION,
            "paypal_discovery_anchor": _PAYPAL_DISCOVERY_ANCHOR,
            "auth_ok": True,
            "days_back": req.days_back,
            "since": since,
            "full_scan_query": full_query,
            "probes": probes,
            "paypal_classification_sample": pipeline_sample,
        }

    return JSONResponse(status_code=200, content=await asyncio.to_thread(_run))


# ── Emergency PayPal direct import ───────────────────────────────────────────


class PaypalImportRequest(BaseModel):
    access_token: str = Field(..., max_length=4096)
    refresh_token: str | None = Field(None, max_length=4096)
    token_expiry: str | None = Field(None, max_length=64)
    days_back: int = Field(730, ge=1, le=730)


_PAYPAL_IMPORT_CAP = 1500  # safety cap on messages fetched in one emergency run


@app.post("/debug/paypal-import")
async def debug_paypal_import(req: PaypalImportRequest):
    """Emergency PayPal-only import path: bypass the general scan query and run
    `from:paypal OR paypal` directly, fetch → parse → classify → extract, and
    return classified invoice dicts (PayPal senders only) + a full per-stage
    funnel with skip reasons. The WEB side persists with the same idempotent
    dedup the normal scan uses. Tokens are never echoed.
    """
    import json
    from datetime import datetime as _dt, timedelta as _td
    from core.invoice_classifier import classify_email as _classify_one

    creds_dict: dict[str, Any] = {
        "token": req.access_token,
        "refresh_token": req.refresh_token,
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    if req.token_expiry:
        creds_dict["expiry"] = req.token_expiry.rstrip("Z").split(".")[0]

    connector = GmailConnector()
    ok, result = connector.build_service_from_json(json.dumps(creds_dict))
    if not ok:
        return JSONResponse(status_code=200, content={
            "worker_version": WORKER_VERSION, "auth_ok": False,
            "auth_error": result[:300],
            "hint": "Reconnect Gmail and tick the Gmail box on the consent screen.",
        })

    def _run() -> dict:
        # Blocking Gmail pipeline — paginated discovery of up to 1500 ids plus
        # 50-at-a-time batch fetches with time.sleep retry backoff. Runs in a
        # worker thread via asyncio.to_thread below so the event loop (/health,
        # concurrent scans) stays responsive for the minutes this can take (H5).
        since = (_dt.now() - _td(days=req.days_back)).strftime("%Y/%m/%d")

        def _estimate(q: str) -> int | None:
            try:
                r = connector._exec(connector.service.users().messages().list(
                    userId="me", q=q, maxResults=1))
                return r.get("resultSizeEstimate")
            except Exception:
                return None

        raw_from_paypal = _estimate(f"after:{since} from:paypal")
        raw_paypal_word = _estimate(f"after:{since} paypal")
        raw_full_query = _estimate(connector.build_query([], req.days_back, False))

        # Discovery: PayPal sender OR the word paypal anywhere. Paginate (cap).
        import_query = f"after:{since} (from:paypal OR paypal)"
        ids: list[str] = []
        page_token = None
        while True:
            params: dict = {"userId": "me", "q": import_query, "maxResults": 500}
            if page_token:
                params["pageToken"] = page_token
            resp = connector._exec(connector.service.users().messages().list(**params))
            ids.extend(m["id"] for m in resp.get("messages", []))
            if len(ids) >= _PAYPAL_IMPORT_CAP:
                ids = ids[:_PAYPAL_IMPORT_CAP]
                break
            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        body_parser = BodyParser()
        fetched = 0
        paypal_invoices: list[dict] = []
        skipped: list[dict] = []
        candidates = parsed_ok = confirmed_likely = 0

        for bstart in range(0, len(ids), 50):
            raw_msgs = connector.get_messages_batch(ids[bstart:bstart + 50])
            for msg in raw_msgs:
                if msg is None:
                    continue
                fetched += 1
                try:
                    parsed = connector.parse_message(msg)
                except Exception as e:
                    skipped.append({"reason": f"parse_failed: {type(e).__name__}"})
                    continue

                # Emergency import is PayPal-only: ignore non-PayPal senders that
                # merely mention "paypal" in the body.
                if not paypal_provider.is_paypal_sender(parsed.get("sender")):
                    continue

                cls = _classify_one(parsed)
                parsed.update(cls)
                tier = cls.get("classification_tier")
                intent = paypal_provider.classify_intent(parsed)
                if tier == "not_invoice" and not intent:
                    skipped.append({
                        "sender": (parsed.get("sender") or "")[:100],
                        "subject": (parsed.get("subject") or "")[:120],
                        "reason": f"not a transaction (tier=not_invoice, score={cls.get('classification_score')})",
                    })
                    continue

                candidates += 1
                try:
                    pp = paypal_provider.extract_paypal(parsed)
                    parsed["paypal"] = pp
                    parsed["paypal_dedup_key"] = paypal_provider.dedup_key(pp)
                    if pp.get("merchant"):
                        parsed["company"] = pp["merchant"]
                    # amount/currency from provider, else generic extractor below
                    if pp.get("amount") is not None:
                        parsed["amount"] = pp["amount"]
                        parsed["currency"] = pp.get("currency") or "USD"
                    note_bits = []
                    if pp.get("doc_type"):
                        note_bits.append(f"PayPal {pp['doc_type'].replace('_', ' ')}")
                    if pp.get("merchant"):
                        note_bits.append(f"to {pp['merchant']}")
                    if pp.get("transaction_id"):
                        note_bits.append(f"txn {pp['transaction_id']}")
                    parsed["notes"] = " · ".join(note_bits) if note_bits else (parsed.get("notes") or "")
                    parsed_ok += 1
                except Exception as e:
                    skipped.append({"reason": f"extract_failed: {type(e).__name__}"})

                if tier in ("confirmed_invoice", "likely_invoice"):
                    confirmed_likely += 1

                # Generic amount fallback when provider found none
                if parsed.get("amount") is None:
                    try:
                        enriched_one = enrich_results([parsed])[0]
                        parsed["amount"] = enriched_one.get("amount")
                        parsed["currency"] = enriched_one.get("currency") or parsed.get("currency") or "USD"
                    except Exception:
                        pass

                parsed.pop("body_text", None)
                for att in parsed.get("attachments", []):
                    att.pop("data", None)
                paypal_invoices.append(parsed)

        funnel = {
            "raw_from_paypal": raw_from_paypal,
            "raw_paypal_word": raw_paypal_word,
            "raw_full_scan_query": raw_full_query,
            "discovery_ids": len(ids),
            "fetched": fetched,
            "paypal_candidates": candidates,
            "parsed": parsed_ok,
            "confirmed_or_likely": confirmed_likely,
            "skipped": len(skipped),
        }
        logger.info("[PayPal IMPORT] funnel=%s", funnel)

        return {
            "worker_version": WORKER_VERSION,
            "auth_ok": True,
            "days_back": req.days_back,
            "import_query": import_query,
            "funnel": funnel,
            "skip_reasons": skipped[:50],
            "invoices": paypal_invoices,
        }

    return JSONResponse(status_code=200, content=await asyncio.to_thread(_run))


# ── Scan cancellation ────────────────────────────────────────────────────
# Cooperative cancel flags keyed by scan_id. POST /scan/cancel/{id} sets a
# flag; the streaming scan pipeline checks it at every batch boundary and
# stops cleanly with a final {"stage": "cancelled"} NDJSON line. Per-instance
# in-memory state — fine for the single-worker deployment (a restart also
# kills the scan itself). Flags expire after _CANCEL_TTL so the registry
# cannot grow unbounded from cancels that never matched a running scan.
# dict reads/writes are GIL-atomic and the scan generator runs in Starlette's
# threadpool, so no lock is needed for this set-once/read-many flag.

_CANCELLED_SCANS: dict[str, float] = {}
_CANCEL_TTL = 3600  # seconds a cancel flag stays valid


@app.post("/scan/cancel/{scan_id}")
async def cancel_scan(scan_id: str):
    """Request cooperative cancellation of a running scan.

    Covered by the same bearer-auth middleware as /scan. Returns immediately;
    the scan's NDJSON stream ends with a {"stage": "cancelled"} line at its
    next batch boundary (fetch batch / classify item / enrich chunk).
    """
    if not scan_id or len(scan_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid scan ID")
    now = time.time()
    # Prune stale flags so cancels for long-gone scans don't accumulate.
    for sid, ts in list(_CANCELLED_SCANS.items()):
        if now - ts > _CANCEL_TTL:
            _CANCELLED_SCANS.pop(sid, None)
    _CANCELLED_SCANS[scan_id] = now
    logger.info("[Scan %s] cancellation requested", scan_id)
    return {"status": "cancel_requested", "scan_id": scan_id}


# ── Scan ─────────────────────────────────────────────────────────────────

# Hard ceiling on the pre-stream Gmail auth/build step. Must stay well below the
# web app's SCAN_DISPATCH_TIMEOUT_MS (270s) so a stalled OAuth refresh fails
# FAST with a precise 503 here instead of hanging until the caller aborts with a
# generic timeout. Worst-case legitimate cost is a token refresh (~seconds) plus
# tokeninfo (10s) plus service build (30s); 45s leaves margin without masking a
# real stall.
AUTH_INIT_TIMEOUT_S = 45


@app.post("/scan")
async def run_scan(req: ScanRequest):
    """Execute a Gmail scan with streaming NDJSON progress.

    Emits lines of {progress, message, stage} as each email is processed.
    Final line contains {progress: 100, result: {scan_id, total_messages, invoices, error}}.
    """
    import json
    from starlette.responses import StreamingResponse

    # IMPORTANT: omit "scopes" from this dict. Google's token endpoint rejects
    # refresh requests that include a `scope` param with `invalid_scope: Bad
    # Request`, and google-auth's `from_authorized_user_info` prefers
    # info["scopes"] over the function arg when building Credentials, so
    # listing scopes here propagates straight into the failing refresh body.
    # The grant's original scopes remain authoritative server-side.
    #
    # Preserve "expiry" when the web app sent one — otherwise google-auth
    # synthesizes a past expiry (now - CLOCK_SKEW) and forces a refresh on
    # every call, even when the access token is still valid for ~an hour.
    creds_dict: dict[str, Any] = {
        "token": req.access_token,
        "refresh_token": req.refresh_token,
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "token_uri": "https://oauth2.googleapis.com/token",
    }
    if req.token_expiry:
        # token_expiry arrives as ISO-8601 (e.g. "2026-05-17T08:35:26.000Z").
        # google-auth parses "YYYY-MM-DDTHH:MM:SS" (no fractional, no Z).
        normalized = req.token_expiry.rstrip("Z").split(".")[0]
        creds_dict["expiry"] = normalized

    from starlette.concurrency import run_in_threadpool

    # Correlate this request across Vercel <-> worker logs. Prefer the caller's
    # scan_id (already non-PII); fall back to a random id. Never logs tokens.
    req_id = (req.scan_id or uuid.uuid4().hex)[:32]
    t_recv = time.monotonic()
    logger.info("[scan %s] /scan received — Gmail auth init starting", req_id)

    # Gmail service construction (token refresh + tokeninfo + discovery build) is
    # BLOCKING network I/O. Two problems it used to cause, both fixed here:
    #   1. Called inline in this async endpoint, it blocked the event loop, so a
    #      slow/stalled refresh froze /health and every other request until the
    #      platform killed the instance. run_in_threadpool moves it off the loop.
    #   2. google-auth's refresh can stall on blocked egress; with no ceiling the
    #      request hung until the caller's 270s dispatch abort, reported to the
    #      user as a generic "worker unavailable". asyncio.wait_for bounds it so
    #      a stall fails FAST with a precise 503 the web maps to a clear message.
    # This is the pre-first-byte step a shallow /health can never detect.
    connector = GmailConnector()
    try:
        ok, result = await asyncio.wait_for(
            run_in_threadpool(connector.build_service_from_json, json.dumps(creds_dict)),
            timeout=AUTH_INIT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.error(
            "[scan %s] AUTH_INIT_TIMEOUT after %.1fs — Gmail service not built "
            "(stalled OAuth refresh or blocked egress to Google)",
            req_id, time.monotonic() - t_recv,
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "AUTH_INIT_TIMEOUT: worker reached but could not initialize Gmail "
                "access within {}s (stalled token refresh or blocked outbound to "
                "Google).".format(AUTH_INIT_TIMEOUT_S)
            ),
        )
    logger.info(
        "[scan %s] Gmail auth init %s in %.2fs",
        req_id, "ok" if ok else "FAILED", time.monotonic() - t_recv,
    )

    if not ok:
        raise HTTPException(status_code=401, detail=f"Gmail auth failed: {result}")

    # Plain sync generator ON PURPOSE: the whole pipeline below is blocking
    # I/O (Gmail batches with time.sleep backoff, classification, enrichment).
    # Starlette iterates sync generators in a threadpool, so /health and
    # concurrent scans stay responsive. As an `async def` this blocked the
    # entire event loop for the duration of every scan — platform health
    # checks timed out and the instance was restarted mid-scan.
    def _generate():
        def _cancel_requested() -> bool:
            return bool(req.scan_id) and req.scan_id in _CANCELLED_SCANS

        def _cancelled_line(total_messages: int) -> str:
            logger.info("[Scan %s] cancelled — stopping pipeline", req.scan_id)
            return json.dumps({
                "progress": 100,
                "message": "Scan cancelled",
                "stage": "cancelled",
                "result": {
                    "scan_id": req.scan_id,
                    "total_messages": total_messages,
                    "invoices": [],
                    "error": "cancelled",
                },
            }) + "\n"

        try:
            yield json.dumps({"progress": 1, "message": "Searching inbox...", "stage": "search"}) + "\n"

            if _cancel_requested():
                yield _cancelled_line(0)
                return

            # Log the EXACT discovery query so production can be audited from
            # logs — proves whether the PayPal anchor is present and whether an
            # unexpected keyword/unread/date filter is narrowing the search.
            _disco_query = connector.build_query(req.keywords, req.days_back, req.unread_only)
            logger.info("[Scan %s] DISCOVERY QUERY = %s", req.scan_id, _disco_query)
            logger.info(
                "[Scan %s] DISCOVERY PARAMS — days_back=%s unread_only=%s keywords=%s paypal_anchor=%s worker_version=%s",
                req.scan_id, req.days_back, req.unread_only, req.keywords,
                "from:paypal" in _disco_query, WORKER_VERSION,
            )

            # Dedicated PayPal raw-discovery probe — isolates "is PayPal even in
            # this mailbox / reachable by this token" from classification. Cheap
            # (resultSizeEstimate, maxResults=1). If these are 0, the problem is
            # discovery/account/scope, NOT parsing.
            from datetime import datetime as _dt, timedelta as _td
            _since = (_dt.now() - _td(days=req.days_back)).strftime("%Y/%m/%d")
            for _label, _q in (
                ("from:paypal", f"after:{_since} from:paypal"),
                ("from:paypal.com", f"after:{_since} from:paypal.com"),
                ("word:paypal", f"after:{_since} paypal"),
            ):
                try:
                    _r = connector._exec(
                        connector.service.users().messages().list(userId="me", q=_q, maxResults=1)
                    )
                    logger.info(
                        "[Scan %s] PAYPAL PROBE [%s] -> resultSizeEstimate=%s",
                        req.scan_id, _label, _r.get("resultSizeEstimate"),
                    )
                except Exception as _pe:
                    logger.warning("[Scan %s] PAYPAL PROBE [%s] failed: %s",
                                   req.scan_id, _label, f"{type(_pe).__name__}: {str(_pe)[:120]}")

            msg_ids = connector.list_message_ids(
                req.keywords, req.days_back, req.unread_only
            )

            total = len(msg_ids) if msg_ids else 0

            if total == 0:
                yield json.dumps({
                    "progress": 100,
                    "message": "No messages found",
                    "stage": "done",
                    "result": {"scan_id": req.scan_id, "total_messages": 0, "invoices": [], "error": None},
                }) + "\n"
                return

            yield json.dumps({"progress": 3, "message": f"Found {total} emails to scan", "stage": "fetch"}) + "\n"

            body_parser = BodyParser()
            results: list[dict] = []
            parse_failed = 0  # messages fetched OK but parse_message() raised

            # Phase 1: Fetch & parse emails (3% – 70%)
            # Uses Gmail Batch API — up to 50 messages per HTTP round trip,
            # ~10-50x faster than one-by-one serial fetching.
            # Skip attachment binary download — not needed for classification.
            _FETCH_BATCH = 50
            for batch_start in range(0, total, _FETCH_BATCH):
                if _cancel_requested():
                    yield _cancelled_line(total)
                    return
                batch_end = min(batch_start + _FETCH_BATCH, total)
                batch_ids = msg_ids[batch_start:batch_end]

                raw_msgs = connector.get_messages_batch(batch_ids)

                for j, msg in enumerate(raw_msgs):
                    if msg is None:
                        continue
                    try:
                        parsed = connector.parse_message(msg)
                        parsed["saved_path"] = None
                        for att in parsed.get("attachments", []):
                            att.pop("data", None)
                        text = body_parser.extract_text(
                            parsed.get("body_text", ""), parsed.get("body_html", "")
                        )
                        parsed["notes"] = (
                            "\u05ea\u05d5\u05db\u05df \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea \u05e0\u05de\u05e6\u05d0 \u05d1\u05d2\u05d5\u05e3 \u05d4\u05d4\u05d5\u05d3\u05e2\u05d4"
                            if body_parser.looks_like_invoice(text)
                            else ""
                        )
                        results.append(parsed)
                    except Exception as exc:
                        parse_failed += 1
                        # Safe metadata only — no body. The raw Gmail headers
                        # give us the message id; sender/subject may be absent
                        # if parsing failed early, so guard each lookup.
                        hdrs = {}
                        try:
                            for h in msg.get("payload", {}).get("headers", []):
                                n = (h.get("name") or "").lower()
                                if n in ("from", "subject"):
                                    hdrs[n] = (h.get("value") or "")[:80]
                        except Exception:
                            pass
                        logger.warning(
                            "PARSE FAILED — gmail_message_id=%s sender=%r subject=%r reason=%s",
                            batch_ids[j] if j < len(batch_ids) else "?",
                            hdrs.get("from", ""), hdrs.get("subject", ""),
                            f"{type(exc).__name__}: {str(exc)[:120]}",
                        )

                pct = 3 + int(batch_end / total * 67)
                yield json.dumps({
                    "progress": pct,
                    "message": f"Reading email {batch_end}/{total}",
                    "stage": "fetch",
                }) + "\n"

            # Explicit fetch funnel — every message accounted for:
            #   found = fetched_ok + still_failed + parse_failed
            #   fetched_ok includes any recovered by the individual retry.
            still_failed = connector.fetch_failed_final
            recovered = connector.fetch_recovered
            fetched_ok = total - still_failed
            logger.info(
                "[Scan %s] FETCH FUNNEL — found=%d fetched_ok=%d recovered_by_retry=%d "
                "still_failed_after_retry=%d parse_failed=%d classified=%d",
                req.scan_id, total, fetched_ok, recovered,
                still_failed, parse_failed, len(results),
            )
            if connector.fetch_failed_ids:
                logger.warning(
                    "[Scan %s] %d message(s) unfetched after retry (ids+reasons): %s",
                    req.scan_id, still_failed,
                    "; ".join(f"{f['id']}:{f['reason']}" for f in connector.fetch_failed_ids[:20]),
                )

            # Phase 2: Classify (72%–85%) — chunked to keep the stream alive.
            # Originally a single bulk call with no progress emission; a few
            # pathological emails with regex-heavy bodies could silently take
            # 15s+ each, making the UI appear stuck at 70%. Chunked yields
            # plus per-message slow-log surface any future hot spot.
            import time as _time
            yield json.dumps({"progress": 72, "message": "Classifying results...", "stage": "classify"}) + "\n"
            from core.invoice_classifier import classify_email as _classify_one
            _CLASSIFY_BATCH = 25
            n_results = len(results)
            classified = 0
            # PayPal ingestion funnel — discovered → transaction candidate →
            # parsed (structured fields extracted) → skipped (+reason).
            pp_discovered = 0
            pp_candidates = 0
            pp_parsed = 0
            pp_skipped = 0
            for r in results:
                if _cancel_requested():
                    yield _cancelled_line(total)
                    return
                _t = _time.perf_counter()
                r.update(_classify_one(r))
                _dur = _time.perf_counter() - _t

                # ── PayPal provider funnel + structured extraction ──────────
                # Runs only for PayPal senders; everything else is untouched.
                if paypal_provider.is_paypal_sender(r.get("sender")):
                    pp_discovered += 1
                    if r.get("classification_tier") != "not_invoice" or r.get("provider") == "paypal":
                        pp_candidates += 1
                        try:
                            pp = paypal_provider.extract_paypal(r)
                            r["paypal"] = pp
                            r["paypal_dedup_key"] = paypal_provider.dedup_key(pp)
                            if pp.get("merchant") and not r.get("company"):
                                r["company"] = pp["merchant"]
                            # Surface key structured fields in notes (no secrets,
                            # no tokens) so they show in the dashboard + export.
                            note_bits = []
                            if pp.get("doc_type"):
                                note_bits.append(f"PayPal {pp['doc_type'].replace('_', ' ')}")
                            if pp.get("merchant"):
                                note_bits.append(f"to {pp['merchant']}")
                            if pp.get("transaction_id"):
                                note_bits.append(f"txn {pp['transaction_id']}")
                            if pp.get("status"):
                                note_bits.append(f"status {pp['status']}")
                            if note_bits:
                                existing = (r.get("notes") or "").strip()
                                r["notes"] = (existing + " | " if existing else "") + " · ".join(note_bits)
                            pp_parsed += 1
                        except Exception as _pp_exc:  # never let extraction break a scan
                            logger.warning(
                                "[Scan %s] PayPal extract failed — gmail_message_id=%s reason=%s",
                                req.scan_id, r.get("uid", "?"),
                                f"{type(_pp_exc).__name__}: {str(_pp_exc)[:120]}",
                            )
                    else:
                        pp_skipped += 1
                        logger.debug(
                            "[Scan %s] PayPal SKIPPED (non-transactional) — subject=%r score=%s",
                            req.scan_id, (r.get("subject") or "")[:80],
                            r.get("classification_score"),
                        )
                # Per-email rejection reason (DEBUG only — guarded so the
                # signal formatting cost is skipped unless LOG_LEVEL=DEBUG).
                if r.get("classification_tier") == "not_invoice" and logger.isEnabledFor(logging.DEBUG):
                    from core.invoice_classifier import format_signal_breakdown as _fsb
                    logger.debug(
                        "[Scan %s] REJECTED not_invoice — sender=%r subject=%r signals=%s",
                        req.scan_id,
                        (r.get("sender") or "")[:80],
                        (r.get("subject") or "")[:80],
                        _fsb(r.get("classification_signals") or []),
                    )
                if _dur > 1.0:
                    # Log only safe metadata — sender domain + subject prefix, no body
                    sender = (r.get("sender") or "")[:60]
                    subj = (r.get("subject") or "")[:60]
                    logger.warning(
                        "Slow classify (%.2fs) — sender=%r subject=%r",
                        _dur, sender, subj,
                    )
                classified += 1
                if classified % _CLASSIFY_BATCH == 0 or classified == n_results:
                    pct = 72 + int(classified / n_results * 13)  # 72–85%
                    yield json.dumps({
                        "progress": pct,
                        "message": f"Classifying {classified}/{n_results}",
                        "stage": "classify",
                    }) + "\n"

            # Phase 3: Enrich amounts (87–95%) — chunked to report progress incrementally
            # (Fixes "stuck at 87%" by emitting updates every 50 emails instead of one
            #  giant silent batch.)
            _ENRICH_BATCH = 50
            enriched: list[dict] = []
            for ei in range(0, n_results, _ENRICH_BATCH):
                if _cancel_requested():
                    yield _cancelled_line(total)
                    return
                chunk = results[ei:ei + _ENRICH_BATCH]
                enriched.extend(enrich_results(chunk))
                pct = 87 + int((ei + len(chunk)) / n_results * 8)  # 87–95%
                yield json.dumps({
                    "progress": pct,
                    "message": f"Extracting amounts {ei + len(chunk)}/{n_results}",
                    "stage": "enrich",
                }) + "\n"

            # PayPal's structured extraction beats the generic regex when it
            # found an amount — a €12.99 PayPal receipt must not be stored as
            # "12.99 ILS" (the generic extractor defaults labeled totals to
            # ILS and previously had no €/£ patterns at all).
            for r in enriched:
                pp = r.get("paypal") or {}
                if pp.get("amount"):
                    r["amount"] = pp["amount"]
                    if pp.get("currency"):
                        r["currency"] = pp["currency"]

            # Strip binary data
            for r in enriched:
                r.pop("body_text", None)
                for att in r.get("attachments", []):
                    att.pop("data", None)

            # Tier counts surface what the scan actually found \u2014 without
            # these the user sees "N candidates" and has no way to know
            # whether they were real invoices or weak signals filtered out
            # downstream.
            tier_counts = {
                "confirmed_invoice": 0,
                "likely_invoice": 0,
                "possible_financial_email": 0,
                "not_invoice": 0,
            }
            for r in enriched:
                t = r.get("classification_tier") or "not_invoice"
                tier_counts[t] = tier_counts.get(t, 0) + 1

            confirmed = tier_counts["confirmed_invoice"]
            likely = tier_counts["likely_invoice"]
            possible = tier_counts["possible_financial_email"]
            not_inv = tier_counts["not_invoice"]
            summary = (
                f"Complete \u2014 scanned {total}: "
                f"{confirmed} confirmed, {likely} likely, "
                f"{possible} possible (review), {not_inv} not invoice"
            )

            logger.info(
                "[Scan %s] TIER COUNTS — classified=%d | confirmed=%d likely=%d possible=%d not_invoice=%d",
                req.scan_id, len(enriched), confirmed, likely, possible, not_inv,
            )

            # PayPal-specific funnel — makes "missing PayPal" debuggable at a
            # glance: how many PayPal emails were fetched, how many were real
            # transaction candidates, how many parsed into structured records,
            # and how many were skipped as non-transactional (security/marketing).
            logger.info(
                "[Scan %s] PAYPAL FUNNEL — discovered=%d candidates=%d parsed=%d skipped=%d",
                req.scan_id, pp_discovered, pp_candidates, pp_parsed, pp_skipped,
            )

            yield json.dumps({
                "progress": 100,
                "message": summary,
                "stage": "done",
                "tier_counts": tier_counts,
                "result": {
                    "scan_id": req.scan_id,
                    "total_messages": total,
                    "invoices": enriched,
                    "tier_counts": tier_counts,
                    "error": None,
                },
            }) + "\n"

        except Exception as e:
            logger.error("Scan failed: %s", e)
            yield json.dumps({
                "progress": 100,
                "message": str(e),
                "stage": "error",
                "result": {
                    "scan_id": req.scan_id,
                    "total_messages": 0,
                    "invoices": [],
                    "error": str(e),
                },
            }) + "\n"
        finally:
            # Always drop the cancel flag when the stream ends (done, error,
            # or cancelled) so a later scan reusing this id isn't insta-killed.
            if req.scan_id:
                _CANCELLED_SCANS.pop(req.scan_id, None)

    return StreamingResponse(_generate(), media_type="application/x-ndjson")


# ── Export ───────────────────────────────────────────────────────────────


@app.post("/export/word")
async def export_word(req: ExportRequest):
    """Generate a Word document with streaming NDJSON progress updates.

    Returns lines of JSON with {progress, message}, final line has {file} with
    base64-encoded .docx bytes.
    """
    import base64
    import json as _json
    from starlette.responses import StreamingResponse

    # job_id shapes the report filename and the cache-file path — reject
    # anything that isn't a CUID before it can reach the filesystem.
    if req.job_id and not _JOB_ID_RE.fullmatch(req.job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    async def _generate():
        from core.word_exporter import create_invoice_report

        invoices = list(req.invoices)
        total = len(invoices)

        if req.include_screenshots:
            # Dead flag kept for wire compat only: the .docx builder has never
            # embedded screenshots, so the old "screenshot phase" burned 0-70%
            # of the job for zero output. Screenshots ship via the dedicated
            # /export/screenshots-zip endpoint instead.
            logger.warning(
                "export_word: include_screenshots=True ignored — Word reports "
                "do not embed screenshots; use /export/screenshots-zip."
            )

        yield _json.dumps({
            "progress": 5,
            "message": f"Exporting {total} selected invoices...",
            "count": total,
        }) + "\n"

        # Build document (5-95%)
        yield _json.dumps({"progress": 75, "message": "Building Word document..."}) + "\n"

        try:
            # Unique filename per job. A fixed date-based name meant two
            # concurrent exports (e.g. from different organizations) wrote to
            # the SAME path — and since the read happened after a progress
            # yield, one org could download the other org's freshly-saved
            # report. job_id is a CUID; fall back to a random name when absent.
            report_name = f"invoices_report_{req.job_id or uuid.uuid4().hex}.docx"
            # Off the event loop: the docx build makes sequential blocking
            # Bank-of-Israel HTTP calls (one per distinct USD date) — inline
            # it would freeze /health and every other request for its duration.
            path = await asyncio.to_thread(
                create_invoice_report,
                invoices,
                output_dir="output/exports",
                filename=report_name,
                organization_name=req.organization_name or None,
            )
            if not path:
                yield _json.dumps({"progress": 100, "message": "No invoices to export", "error": "empty"}) + "\n"
                return

            # Read the bytes BEFORE any yield suspends this generator, then
            # remove the file — nothing must be able to swap it underneath us,
            # and finished reports shouldn't accumulate on disk.
            with open(path, "rb") as f:
                file_bytes = f.read()
            try:
                os.remove(path)
            except OSError:
                logger.warning("Could not remove temporary report file: %s", path)

            yield _json.dumps({"progress": 90, "message": "Encoding document..."}) + "\n"

            # Cache file for later download when job_id is provided.
            # to_thread: _cache_put persists to disk — keep it off the loop.
            if req.job_id:
                await asyncio.to_thread(_cache_put, req.job_id, file_bytes, {
                    "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "filename": report_name,
                })

            result: dict[str, Any] = {"progress": 100, "message": "Complete"}
            if req.job_id:
                result["file_cached"] = True
                result["file_size"] = len(file_bytes)
                result["job_id"] = req.job_id
            else:
                result["file"] = base64.b64encode(file_bytes).decode()
            yield _json.dumps(result) + "\n"

        except Exception as e:
            logger.error("Word export failed: %s", e)
            yield _json.dumps({"progress": 100, "message": str(e), "error": str(e)}) + "\n"

    return StreamingResponse(_generate(), media_type="application/x-ndjson")


@app.post("/export/screenshots-zip")
async def export_screenshots_zip(req: ExportRequest):
    """Generate screenshots for all invoices and return as a streaming ZIP.

    Returns NDJSON lines with progress, final line has base64-encoded ZIP.
    """
    import base64
    import json as _json
    import zipfile
    import io
    from starlette.responses import StreamingResponse
    from core.email_screenshotter import generate_screenshots_with_progress, SCREENSHOT_DIR

    # job_id shapes the cache-file path — reject anything that isn't a CUID
    # before it can reach the filesystem.
    if req.job_id and not _JOB_ID_RE.fullmatch(req.job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    async def _generate():
        invoices = list(req.invoices)
        total = len(invoices)

        if total == 0:
            yield _json.dumps({"progress": 100, "message": "No invoices", "error": "empty"}) + "\n"
            return

        yield _json.dumps({
            "progress": 2,
            "message": f"Exporting {total} selected invoices — capturing screenshots...",
            "count": total,
        }) + "\n"

        # Phase 1: Generate screenshots (0-80%)
        try:
            i = 0
            async for inv_list in generate_screenshots_with_progress(invoices):
                invoices = inv_list
                inv = invoices[i]
                pct = int((i + 1) / total * 80)
                sender = inv.get("sender") or "unknown"
                error = inv.get("screenshot_error") or ""
                if error.startswith("skipped:"):
                    msg = f"Screenshot {i + 1}/{total} {error} — {sender}"
                elif error:
                    msg = f"Screenshot {i + 1}/{total} failed — {sender}"
                else:
                    msg = f"Screenshot {i + 1}/{total} — {sender}"
                yield _json.dumps({"progress": pct, "message": msg}) + "\n"
                i += 1
        except Exception as e:
            error_str = str(e) or repr(e)
            logger.warning("Screenshot generation error: %s", error_str)
            if "failed to start" in error_str.lower() or "timed out" in error_str.lower():
                yield _json.dumps({"progress": 80, "message": f"Screenshot engine failed to start — export will complete without screenshots. ({error_str[:200]})"}) + "\n"
            else:
                yield _json.dumps({"progress": 80, "message": f"Screenshots failed: {error_str[:200]}"}) + "\n"

        # Classify results AFTER all screenshots are done (covers cached PNGs too)
        succeeded = []
        failed = []
        for inv in invoices:
            invoice_id = inv.get("id", "?")
            has_screenshot = bool(inv.get("screenshot_path"))
            if has_screenshot:
                succeeded.append(inv)
            else:
                failed.append({
                    "id": invoice_id,
                    "supplier": inv.get("company") or inv.get("sender") or "Unknown",
                    "sender": inv.get("sender") or "",
                    "date": str(inv.get("date") or "")[:10],
                    "subject": (inv.get("subject") or "")[:60],
                    "reason": inv.get("screenshot_error") or "No screenshot produced (unknown reason)",
                    "html_source": inv.get("screenshot_html_source", "unknown"),
                })

        # If zero screenshots succeeded, return an error — not an empty ZIP
        if not succeeded:
            # Build a readable error from failure reasons
            by_reason: dict[str, int] = {}
            for f in failed:
                r = f["reason"] or "Unknown failure"
                by_reason[r] = by_reason.get(r, 0) + 1
            reason_summary = "; ".join(f"{r} ({n})" for r, n in by_reason.items())
            error_msg = f"All {total} screenshots failed. Reasons: {reason_summary}"
            logger.error(error_msg)
            yield _json.dumps({
                "progress": 100,
                "message": error_msg,
                "error": error_msg,
                "failed_count": len(failed),
                "failures": failed,
            }) + "\n"
            return

        # Phase 2: Build ZIP (80-95%)
        yield _json.dumps({"progress": 85, "message": f"Building ZIP with {len(succeeded)} screenshots..."}) + "\n"

        try:
            def _build_zip() -> tuple[bytes, int, int]:
                # Blocking (disk reads + deflate) — runs via asyncio.to_thread
                # below so the event loop stays responsive during large
                # archives. Mutates `failed` in place; safe because the single
                # builder thread is joined before `failed` is read again.
                zip_buffer = io.BytesIO()
                zipped_count = 0
                skipped_missing = 0
                seen_names: set[str] = set()
                with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                    for inv in succeeded:
                        screenshot_path = inv.get("screenshot_path")
                        if not screenshot_path or not os.path.isfile(screenshot_path):
                            skipped_missing += 1
                            inv_id_dbg = inv.get("id", "?")
                            logger.warning(
                                "ZIP: screenshot file missing for %s (path=%s, exists=%s)",
                                inv_id_dbg, screenshot_path, os.path.isfile(screenshot_path) if screenshot_path else False,
                            )
                            failed.append({
                                "id": inv_id_dbg,
                                "supplier": inv.get("company") or inv.get("sender") or "Unknown",
                                "sender": inv.get("sender") or "",
                                "date": str(inv.get("date") or "")[:10],
                                "subject": (inv.get("subject") or "")[:60],
                                "reason": "Screenshot file missing from disk",
                                "html_source": inv.get("screenshot_html_source", "unknown"),
                            })
                            continue

                        # Name entries by supplier (sanitized). The sender domain
                        # was misleading for routed receipts — every PayPal-routed
                        # merchant became "paypal_*.png" and Apple receipts became
                        # "email_*.png" (from no_reply@email.apple.com).
                        stem = (inv.get("company") or "").strip()
                        if not stem:
                            stem = (inv.get("sender") or "unknown").split("@")[-1].replace(">", "").split(".")[0]
                        for ch in '<>:"/\\|?* ':
                            stem = stem.replace(ch, "_")
                        stem = re.sub(r"_+", "_", stem).strip("_")[:40] or "unknown"
                        date_str = str(inv.get("date") or "")[:10].replace("/", "-")
                        # The invoice id also lands in the archive entry name —
                        # strip anything path-shaped (zip-slip on extraction).
                        inv_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(inv.get("id") or ""))[:64]

                        zip_name = f"{stem}_{date_str}_{inv_id}.png"
                        # Deduplicate filenames (shouldn't happen with full ID, but safety net)
                        if zip_name in seen_names:
                            counter = 2
                            base = zip_name[:-4]
                            while f"{base}_{counter}.png" in seen_names:
                                counter += 1
                            zip_name = f"{base}_{counter}.png"
                        seen_names.add(zip_name)

                        zf.write(screenshot_path, zip_name)
                        zipped_count += 1

                    # Failure diagnostic for ANY failure kind (render errors and
                    # files missing from disk alike). Must be written while the
                    # archive is still open — a previous version of this block sat
                    # outside the `with`, so writestr() hit a closed ZipFile and a
                    # single missing file failed the whole export.
                    if failed:
                        by_reason: dict[str, list] = {}
                        for f in failed:
                            reason = f["reason"] or "Unknown failure"
                            by_reason.setdefault(reason, []).append(f)

                        lines = [
                            "Screenshot Failure Report",
                            "========================",
                            "",
                            f"{zipped_count} screenshots succeeded, {len(failed)} failed out of {total} total.",
                            "",
                        ]

                        for reason, items in by_reason.items():
                            lines.append(f"--- {reason} ({len(items)} invoice{'s' if len(items) != 1 else ''}) ---")
                            lines.append("")
                            for item in items:
                                parts = []
                                if item["supplier"]:
                                    parts.append(f"Supplier: {item['supplier']}")
                                if item["date"]:
                                    parts.append(f"Date: {item['date']}")
                                if item["subject"]:
                                    parts.append(f"Subject: {item['subject']}")
                                parts.append(f"ID: {item['id']}")
                                lines.append("  " + " | ".join(parts))
                            lines.append("")

                        zf.writestr("_failed_screenshots.txt", "\n".join(lines))

                return zip_buffer.getvalue(), zipped_count, skipped_missing

            zip_bytes, zipped_count, skipped_missing = await asyncio.to_thread(_build_zip)

            if skipped_missing:
                logger.warning("ZIP: %d files were missing on disk despite successful render", skipped_missing)

            yield _json.dumps({"progress": 95, "message": "Encoding ZIP..."}) + "\n"

            summary = f"{zipped_count} screenshots"
            if failed:
                summary += f", {len(failed)} failed"

            # Cache file for later download when job_id is provided.
            # to_thread: _cache_put persists to disk — keep it off the loop.
            if req.job_id:
                await asyncio.to_thread(_cache_put, req.job_id, zip_bytes, {
                    "content_type": "application/zip",
                    "filename": f"screenshots-{req.job_id}.zip",
                })

            result: dict[str, Any] = {
                "progress": 100,
                "message": f"Complete \u2014 {summary}",
                "succeeded": zipped_count,
                "failed_count": len(failed),
                "failures": failed if failed else None,
            }
            if req.job_id:
                result["file_cached"] = True
                result["file_size"] = len(zip_bytes)
                result["job_id"] = req.job_id
            else:
                result["file"] = base64.b64encode(zip_bytes).decode()
            yield _json.dumps(result) + "\n"

        except Exception as e:
            logger.error("ZIP creation failed: %s", e)
            yield _json.dumps({"progress": 100, "message": str(e), "error": str(e)}) + "\n"

    return StreamingResponse(_generate(), media_type="application/x-ndjson")


# ── File download (memory hot cache, disk fallback) ────────────────────────


@app.get("/export/{job_id}/download")
async def download_export(job_id: str):
    """Serve a cached export file. Files expire after 30 minutes."""
    from starlette.responses import Response

    # Validate job_id format to prevent path traversal / injection.
    # Expected format: CUID (starts with 'c', alphanumeric, 20-30 chars).
    if not _JOB_ID_RE.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    # to_thread: on a memory miss _cache_get reads the disk copy.
    entry = await asyncio.to_thread(_cache_get, job_id)
    if not entry:
        raise HTTPException(
            status_code=410,
            detail="Export file has expired or was not found. Please re-run the export.",
        )

    # Sanitize filename — strip any characters that could inject headers or paths.
    raw_filename = entry.get("filename", "export")
    safe_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', raw_filename)

    return Response(
        content=entry["data"],
        media_type=entry.get("content_type", "application/octet-stream"),
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Content-Length": str(len(entry["data"])),
        },
    )


# ── Entrypoint ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("BIND_HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))

    if not _WORKER_SECRET:
        logger.warning(
            "WORKER_SECRET is not set — worker endpoints are unauthenticated. "
            "Set WORKER_SECRET in production to prevent unauthorized access."
        )

    uvicorn.run(app, host=host, port=port)
