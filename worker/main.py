"""
Invoice Fetcher — Python Worker API.

Wraps the existing core/ business logic as a FastAPI service.
Called by the Next.js app to execute Gmail scans and exports.

Start: uvicorn worker.main:app --port 8000
"""

import logging
import os
import sys
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

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Add project root to path so we can import core/
sys.path.insert(0, _project_root)

from core.gmail_connector import GmailConnector
from core.invoice_classifier import classify_results
from core.amount_extractor import enrich_results
from core.body_parser import BodyParser
from core.attachment_handler import AttachmentHandler

app = FastAPI(title="Invoice Fetcher Worker", version="0.1.0")


# ── Request/Response models ──────────────────────────────────────────────


class ScanRequest(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_expiry: str | None = None
    keywords: list[str] = []
    days_back: int = 30
    unread_only: bool = True
    scan_id: str = ""  # For tracking


class ScanResult(BaseModel):
    scan_id: str
    total_messages: int
    invoices: list[dict[str, Any]]
    error: str | None = None


class ExportRequest(BaseModel):
    invoices: list[dict[str, Any]]
    format: str = "csv"  # csv, word
    organization_name: str = ""
    include_screenshots: bool = False


# ── Health ───────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok", "service": "invoice-fetcher-worker"}


# ── Scan ─────────────────────────────────────────────────────────────────


@app.post("/scan", response_model=ScanResult)
async def run_scan(req: ScanRequest):
    """Execute a Gmail scan using the provided OAuth tokens."""

    # Build credentials JSON for the connector
    import json
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

    try:
        # Search messages
        msg_ids = connector.list_message_ids(
            req.keywords, req.days_back, req.unread_only
        )

        if not msg_ids:
            return ScanResult(
                scan_id=req.scan_id, total_messages=0, invoices=[]
            )

        # Process each message
        body_parser = BodyParser()
        att_handler = AttachmentHandler(base_output_dir="output/invoices")
        results: list[dict] = []

        for msg_id in msg_ids:
            try:
                msg = connector.get_message(msg_id)
                if not msg:
                    continue

                parsed = connector.parse_message(msg)

                # Save attachments
                saved_path = None
                for att in parsed.get("attachments", []):
                    if att.get("attachment_id"):
                        att["data"] = connector.fetch_attachment_data(
                            att["msg_id"], att["attachment_id"]
                        )
                    path = att_handler.save_attachment(
                        att, parsed.get("sender", ""), parsed.get("date", "")
                    )
                    if path:
                        saved_path = path
                parsed["saved_path"] = saved_path

                # Parse body
                text = body_parser.extract_text(
                    parsed.get("body_text", ""), parsed.get("body_html", "")
                )
                parsed["notes"] = (
                    "Invoice content found in body"
                    if body_parser.looks_like_invoice(text)
                    else ""
                )

                results.append(parsed)
            except Exception as exc:
                logger.warning("Skipping message %s: %s", msg_id, exc)
                continue

        # Classify
        classify_results(results)

        # Enrich with amounts
        enriched = enrich_results(results)

        # Strip binary data before returning (keep body_html for screenshots)
        for r in enriched:
            r.pop("body_text", None)
            for att in r.get("attachments", []):
                att.pop("data", None)

        return ScanResult(
            scan_id=req.scan_id,
            total_messages=len(msg_ids),
            invoices=enriched,
        )

    except Exception as e:
        return ScanResult(
            scan_id=req.scan_id,
            total_messages=0,
            invoices=[],
            error=str(e),
        )


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
                    if inv.get("screenshot_error"):
                        screenshot_failures.append({
                            "supplier": inv.get("company") or inv.get("sender") or "Unknown",
                            "date": str(inv.get("date") or "")[:10],
                            "reason": inv["screenshot_error"],
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
                file_data = base64.b64encode(f.read()).decode()

            result = {"progress": 100, "message": "Complete", "file": file_data}
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
                if inv.get("screenshot_error"):
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
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for inv in succeeded:
                    screenshot_path = inv.get("screenshot_path")
                    if not screenshot_path or not os.path.isfile(screenshot_path):
                        continue

                    sender = (inv.get("sender") or "unknown").split("@")[-1].replace(">", "").split(".")[0]
                    date_str = str(inv.get("date") or "")[:10].replace("/", "-")
                    inv_id = str(inv.get("id") or "")[:8]
                    for ch in r'<>:"/\|?*':
                        sender = sender.replace(ch, "_")

                    zip_name = f"{sender}_{date_str}_{inv_id}.png"
                    zf.write(screenshot_path, zip_name)
                    zipped_count += 1

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

            file_data = base64.b64encode(zip_bytes).decode()
            summary = f"{zipped_count} screenshots"
            if failed:
                summary += f", {len(failed)} failed"

            yield _json.dumps({
                "progress": 100,
                "message": f"Complete \u2014 {summary}",
                "file": file_data,
                "succeeded": zipped_count,
                "failed_count": len(failed),
                "failures": failed if failed else None,
            }) + "\n"

        except Exception as e:
            logger.error("ZIP creation failed: %s", e)
            yield _json.dumps({"progress": 100, "message": str(e), "error": str(e)}) + "\n"

    return StreamingResponse(_generate(), media_type="application/x-ndjson")
