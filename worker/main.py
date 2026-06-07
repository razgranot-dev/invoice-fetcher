"""
Invoice Fetcher — Python Worker API.

Wraps the existing core/ business logic as a FastAPI service.
Called by the Next.js app to execute Gmail scans and exports.

Start: python -m worker.main (binds to 0.0.0.0:$PORT, default 8000)
"""

import logging
import os
import sys
import time
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


@app.middleware("http")
async def verify_worker_auth(request: Request, call_next):
    # Health endpoint is exempt — used by load balancers / monitors
    if request.url.path == "/health":
        return await call_next(request)

    if _WORKER_SECRET:
        auth_header = request.headers.get("authorization", "")
        expected = f"Bearer {_WORKER_SECRET}"
        if auth_header != expected:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or missing worker authorization"},
            )

    return await call_next(request)


# ── In-memory file cache (TTL-based, size-bounded) ───────────────────────────

_FILE_CACHE: dict[str, dict] = {}
_CACHE_TTL = 1800  # 30 minutes
_CACHE_MAX_ENTRIES = 50  # Max cached files to prevent OOM
_CACHE_MAX_BYTES = 500 * 1024 * 1024  # 500 MB total cache limit
_cache_lock = Lock()


def _cache_total_bytes() -> int:
    """Total bytes of cached file data. Must be called with _cache_lock held."""
    return sum(len(v.get("data", b"")) for v in _FILE_CACHE.values())


def _cache_put(job_id: str, data: bytes, metadata: dict | None = None):
    """Store a generated file in the in-memory cache.

    Enforces entry count and total size limits. Evicts oldest entries
    when limits are exceeded to prevent unbounded memory growth.
    """
    with _cache_lock:
        _FILE_CACHE[job_id] = {
            "data": data,
            "created": time.time(),
            **(metadata or {}),
        }
        _cache_cleanup()
        # Evict oldest entries if over count or size limits
        while (
            len(_FILE_CACHE) > _CACHE_MAX_ENTRIES
            or _cache_total_bytes() > _CACHE_MAX_BYTES
        ) and len(_FILE_CACHE) > 1:
            oldest_key = min(_FILE_CACHE, key=lambda k: _FILE_CACHE[k]["created"])
            if oldest_key == job_id:
                break  # Don't evict the entry we just added
            del _FILE_CACHE[oldest_key]


def _cache_get(job_id: str) -> dict | None:
    """Retrieve a cached file. Returns None if expired or missing."""
    with _cache_lock:
        entry = _FILE_CACHE.get(job_id)
        if not entry:
            return None
        if time.time() - entry["created"] > _CACHE_TTL:
            del _FILE_CACHE[job_id]
            return None
        return entry


def _cache_cleanup():
    """Remove expired entries. Called inside _cache_put (already holds lock)."""
    now = time.time()
    expired = [k for k, v in _FILE_CACHE.items() if now - v["created"] > _CACHE_TTL]
    for k in expired:
        del _FILE_CACHE[k]


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

    return JSONResponse(status_code=200, content={
        "worker_version": WORKER_VERSION,
        "paypal_discovery_anchor": _PAYPAL_DISCOVERY_ANCHOR,
        "auth_ok": True,
        "days_back": req.days_back,
        "since": since,
        "full_scan_query": full_query,
        "probes": probes,
        "paypal_classification_sample": pipeline_sample,
    })


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

    return JSONResponse(status_code=200, content={
        "worker_version": WORKER_VERSION,
        "auth_ok": True,
        "days_back": req.days_back,
        "import_query": import_query,
        "funnel": funnel,
        "skip_reasons": skipped[:50],
        "invoices": paypal_invoices,
    })


# ── Scan ─────────────────────────────────────────────────────────────────


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

    connector = GmailConnector()
    ok, result = connector.build_service_from_json(json.dumps(creds_dict))

    if not ok:
        raise HTTPException(status_code=401, detail=f"Gmail auth failed: {result}")

    async def _generate():
        try:
            yield json.dumps({"progress": 1, "message": "Searching inbox...", "stage": "search"}) + "\n"

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
                chunk = results[ei:ei + _ENRICH_BATCH]
                enriched.extend(enrich_results(chunk))
                pct = 87 + int((ei + len(chunk)) / n_results * 8)  # 87–95%
                yield json.dumps({
                    "progress": pct,
                    "message": f"Extracting amounts {ei + len(chunk)}/{n_results}",
                    "stage": "enrich",
                }) + "\n"

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

    async def _generate():
        from core.word_exporter import create_invoice_report

        invoices = list(req.invoices)
        total = len(invoices)
        screenshot_failures = []

        # Phase 1: Screenshots (0-70%)
        if req.include_screenshots and total > 0:
            yield _json.dumps({"progress": 2, "message": f"Capturing screenshots for {total} invoices..."}) + "\n"
            try:
                from core.email_screenshotter import generate_screenshots_with_progress

                i = 0
                async for inv_list in generate_screenshots_with_progress(invoices):
                    invoices = inv_list
                    inv = invoices[i]
                    pct = int((i + 1) / total * 70)
                    sender = inv.get("sender") or "unknown"
                    error = inv.get("screenshot_error") or ""
                    if error.startswith("skipped:"):
                        msg = f"Screenshot {i + 1}/{total} {error} — {sender}"
                    elif error:
                        screenshot_failures.append({
                            "supplier": inv.get("company") or inv.get("sender") or "Unknown",
                            "date": str(inv.get("date") or "")[:10],
                            "reason": error,
                        })
                        msg = f"Screenshot {i + 1}/{total} failed — {sender}"
                    else:
                        msg = f"Screenshot {i + 1}/{total} — {sender}"
                    yield _json.dumps({"progress": pct, "message": msg}) + "\n"
                    i += 1
            except ImportError:
                try:
                    from core.email_screenshotter import generate_screenshots
                    invoices = await generate_screenshots(invoices)
                    yield _json.dumps({"progress": 70, "message": "Screenshots complete"}) + "\n"
                except Exception as exc:
                    yield _json.dumps({"progress": 70, "message": f"Screenshots skipped: {exc}"}) + "\n"
            except Exception as e:
                error_str = str(e) or repr(e)
                logger.warning("Screenshot generation failed: %s", error_str)
                if "failed to start" in error_str.lower() or "timed out" in error_str.lower():
                    yield _json.dumps({"progress": 70, "message": f"Screenshot engine failed to start — continuing without screenshots. ({error_str[:200]})"}) + "\n"
                else:
                    yield _json.dumps({"progress": 70, "message": f"Screenshots failed: {error_str[:200]}"}) + "\n"

            if screenshot_failures:
                summary = f"{len(screenshot_failures)} screenshot(s) failed"
                yield _json.dumps({"progress": 72, "message": summary}) + "\n"
        else:
            yield _json.dumps({"progress": 5, "message": "Preparing data..."}) + "\n"

        # Phase 2: Build document (70-95%)
        yield _json.dumps({"progress": 75, "message": "Building Word document..."}) + "\n"

        try:
            path = create_invoice_report(
                invoices,
                output_dir="output/exports",
                organization_name=req.organization_name or None,
            )
            if not path:
                yield _json.dumps({"progress": 100, "message": "No invoices to export", "error": "empty"}) + "\n"
                return

            yield _json.dumps({"progress": 90, "message": "Encoding document..."}) + "\n"

            with open(path, "rb") as f:
                file_bytes = f.read()

            # Cache file for later download when job_id is provided
            if req.job_id:
                _cache_put(req.job_id, file_bytes, {
                    "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "filename": os.path.basename(path),
                })

            result: dict[str, Any] = {"progress": 100, "message": "Complete"}
            if req.job_id:
                result["file_cached"] = True
                result["file_size"] = len(file_bytes)
                result["job_id"] = req.job_id
            else:
                result["file"] = base64.b64encode(file_bytes).decode()
            if screenshot_failures:
                result["message"] = f"Complete \u2014 {len(screenshot_failures)} screenshot(s) failed"
                result["failures"] = screenshot_failures
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

    async def _generate():
        invoices = list(req.invoices)
        total = len(invoices)

        if total == 0:
            yield _json.dumps({"progress": 100, "message": "No invoices", "error": "empty"}) + "\n"
            return

        yield _json.dumps({"progress": 2, "message": f"Capturing {total} invoice screenshots..."}) + "\n"

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

                    sender = (inv.get("sender") or "unknown").split("@")[-1].replace(">", "").split(".")[0]
                    date_str = str(inv.get("date") or "")[:10].replace("/", "-")
                    inv_id = str(inv.get("id") or "")
                    for ch in r'<>:"/\|?*':
                        sender = sender.replace(ch, "_")

                    zip_name = f"{sender}_{date_str}_{inv_id}.png"
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

            if skipped_missing:
                logger.warning("ZIP: %d files were missing on disk despite successful render", skipped_missing)

                # Include failure diagnostic only when there ARE successful screenshots alongside failures
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

            zip_bytes = zip_buffer.getvalue()

            yield _json.dumps({"progress": 95, "message": "Encoding ZIP..."}) + "\n"

            summary = f"{zipped_count} screenshots"
            if failed:
                summary += f", {len(failed)} failed"

            # Cache file for later download when job_id is provided
            if req.job_id:
                _cache_put(req.job_id, zip_bytes, {
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


# ── File download (serves from in-memory cache) ────────────────────────────


@app.get("/export/{job_id}/download")
async def download_export(job_id: str):
    """Serve a cached export file. Files expire after 30 minutes."""
    import re
    from starlette.responses import Response

    # Validate job_id format to prevent path traversal / injection.
    # Expected format: CUID (starts with 'c', alphanumeric, 20-30 chars).
    if not re.fullmatch(r"c[a-zA-Z0-9]{20,30}", job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    entry = _cache_get(job_id)
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
