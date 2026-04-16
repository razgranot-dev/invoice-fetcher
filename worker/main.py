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
    days_back: int = Field(30, ge=1, le=365)
    unread_only: bool = True
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
    return {"status": "ok", "service": "invoice-fetcher-worker"}


# ── Scan ─────────────────────────────────────────────────────────────────


@app.post("/scan")
async def run_scan(req: ScanRequest):
    """Execute a Gmail scan with streaming NDJSON progress.

    Emits lines of {progress, message, stage} as each email is processed.
    Final line contains {progress: 100, result: {scan_id, total_messages, invoices, error}}.
    """
    import json
    from starlette.responses import StreamingResponse

    creds_dict = {
        "token": req.access_token,
        "refresh_token": req.refresh_token,
        "client_id": os.getenv("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.getenv("GOOGLE_CLIENT_SECRET", ""),
        "token_uri": "https://oauth2.googleapis.com/token",
        "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
    }

    connector = GmailConnector()
    ok, result = connector.build_service_from_json(json.dumps(creds_dict))

    if not ok:
        raise HTTPException(status_code=401, detail=f"Gmail auth failed: {result}")

    async def _generate():
        try:
            yield json.dumps({"progress": 1, "message": "Searching inbox...", "stage": "search"}) + "\n"

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

            # Phase 1: Fetch & parse emails (3% – 70%)
            # Serial loop — httplib2.Http inside the Google API client is NOT
            # thread-safe, so concurrent fetching corrupts socket/SSL state.
            # Skip attachment binary download — not needed for classification.
            for i, msg_id in enumerate(msg_ids):
                try:
                    msg = connector.get_message(msg_id)
                    if not msg:
                        continue
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
                    logger.warning("Skipping message %s: %s", msg_id, exc)

                pct = 3 + int((i + 1) / total * 67)
                if total <= 50 or (i + 1) % 5 == 0 or (i + 1) == total:
                    yield json.dumps({
                        "progress": pct,
                        "message": f"Reading email {i + 1}/{total}",
                        "stage": "fetch",
                    }) + "\n"

            # Phase 2: Classify (70–85%)
            yield json.dumps({"progress": 72, "message": "Classifying results...", "stage": "classify"}) + "\n"
            classify_results(results)

            # Phase 3: Enrich amounts (87–95%) — chunked to report progress incrementally
            # (Fixes "stuck at 87%" by emitting updates every 50 emails instead of one
            #  giant silent batch.)
            _ENRICH_BATCH = 50
            enriched: list[dict] = []
            n_results = len(results)
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

            yield json.dumps({
                "progress": 100,
                "message": f"Complete \u2014 {len(enriched)} candidates from {total} emails",
                "stage": "done",
                "result": {
                    "scan_id": req.scan_id,
                    "total_messages": total,
                    "invoices": enriched,
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
