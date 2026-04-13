"""
Email screenshot generator using Playwright (async API).

Renders email HTML bodies as PNG images for embedding in Word exports.
Gracefully handles failures — each screenshot is independent.
Uses a single browser instance for all screenshots in a batch.

Setup: pip install playwright && python -m playwright install chromium
"""

import logging
import os
import re
from pathlib import Path
from typing import Any, AsyncIterator

from core.invoice_classifier import is_screenshot_worthy

logger = logging.getLogger(__name__)

SCREENSHOT_DIR = os.path.join("output", "screenshots")

# CSS injected into EVERY email HTML BEFORE rendering.
# Must be the last <style> tag so !important overrides email CSS.
_OVERRIDE_CSS = """
html, body {
    height: auto !important;
    min-height: unset !important;
    max-height: none !important;
    overflow: visible !important;
    display: block !important;
    width: 100% !important;
}
table { width: 100% !important; }
img {
    max-width: 100% !important;
    height: auto !important;
    display: block !important;
}
"""


def _build_email_html(invoice: dict) -> str:
    """Build a simple email-like HTML from invoice metadata.

    Used when original email HTML is not available.
    """
    company = invoice.get("company") or invoice.get("sender") or "Unknown"
    subject = invoice.get("subject") or "(no subject)"
    sender = invoice.get("sender") or ""
    date_str = invoice.get("date") or ""
    amount = invoice.get("amount")
    currency = invoice.get("currency", "ILS")
    notes = invoice.get("notes") or ""

    amount_display = f"{currency} {amount:,.2f}" if amount else ""

    return f"""<!DOCTYPE html>
<html dir="auto">
<head>
    <meta charset="utf-8">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; padding: 24px;
            background: #f8f9fa; color: #1a1a2e;
        }}
        .email-card {{
            background: white; border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 700px; margin: 0 auto; overflow: hidden;
        }}
        .header {{
            background: #f1f3f5; padding: 16px 20px;
            border-bottom: 1px solid #e9ecef;
        }}
        .header h2 {{ margin: 0 0 8px 0; font-size: 16px; color: #1a1a2e; }}
        .meta {{ font-size: 12px; color: #868e96; }}
        .meta span {{ margin-right: 16px; }}
        .body {{ padding: 20px; font-size: 14px; line-height: 1.6; }}
        .amount {{ font-size: 24px; font-weight: 700; color: #1a1a2e; margin: 12px 0; }}
    </style>
</head>
<body>
    <div class="email-card">
        <div class="header">
            <h2>{subject}</h2>
            <div class="meta">
                <span>From: {sender}</span>
                <span>Date: {date_str}</span>
            </div>
        </div>
        <div class="body">
            <p><strong>{company}</strong></p>
            {f'<div class="amount">{amount_display}</div>' if amount_display else ''}
            {f'<p>{notes}</p>' if notes else ''}
        </div>
    </div>
</body>
</html>"""


def _prepare_email_html(raw_html: str) -> str:
    """Prepare raw email HTML for screenshot rendering.

    Ensures the HTML has a proper document structure, charset, white background,
    and — critically — injects override CSS that prevents the email's own styles
    from clipping or constraining the content.  The override CSS is placed at the
    END of the document (just before </body>) so it wins over any inline styles.
    """
    override_block = f"<style>{_OVERRIDE_CSS}</style>"

    lower = raw_html[:500].lower()

    # Full HTML document — inject override CSS at end of <body>
    if "<html" in lower:
        # Try to inject before </body>
        body_close = raw_html.rfind("</body")
        if body_close == -1:
            body_close = raw_html.rfind("</BODY")
        if body_close != -1:
            return raw_html[:body_close] + override_block + raw_html[body_close:]
        # No </body> — append at end
        return raw_html + override_block

    # HTML fragment — wrap in a full document with our CSS at the end
    return f"""<!DOCTYPE html>
<html dir="auto">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=1200">
    <style>
        html, body {{
            margin: 0; padding: 16px;
            background: #ffffff; color: #1a1a2e;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }}
    </style>
</head>
<body>
{raw_html}
{override_block}
</body>
</html>"""


_PER_SCREENSHOT_TIMEOUT = 45  # hard cap per screenshot — kill and move on
_VIEWPORT_WIDTH = 1200


async def _render_single(
    page, html: str, output_path: str, invoice_id: str = ""
) -> tuple[bool, str | None, dict[str, Any]]:
    """Render HTML to PNG using an existing Playwright page.

    Returns (success, error_reason, diagnostics_dict).
    """
    import asyncio

    diag: dict[str, Any] = {"invoice_id": invoice_id}

    async def _do_render():
        # 1. Load HTML — wait for 'load' event (fires after images/CSS/iframes)
        await page.set_content(html, wait_until="load", timeout=20000)

        # 2. Measure page height BEFORE CSS reinforcement
        height_before = await page.evaluate("() => document.body.scrollHeight")
        diag["height_before_css"] = height_before

        # 3. Reinforce override CSS via add_style_tag (in case email injects
        #    dynamic styles after load via JS)
        await page.add_style_tag(content=_OVERRIDE_CSS)

        # 4. Brief wait for any remaining network requests
        try:
            await page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass

        # 5. Measure height AFTER CSS reinforcement
        height_after = await page.evaluate("() => document.body.scrollHeight")
        diag["height_after_css"] = height_after

        # 6. Resize viewport to match full content height (prevents clipping)
        content_height = max(height_after, height_before, 800)
        await page.set_viewport_size({
            "width": _VIEWPORT_WIDTH,
            "height": content_height,
        })
        diag["viewport_set_to"] = f"{_VIEWPORT_WIDTH}x{content_height}"

        # 7. Scroll to bottom then back to top to trigger lazy-loaded images
        await page.evaluate("""
            () => new Promise(resolve => {
                window.scrollTo(0, document.body.scrollHeight);
                setTimeout(() => {
                    window.scrollTo(0, 0);
                    setTimeout(resolve, 2000);
                }, 500);
            })
        """)

        # 8. Final height measurement after scroll (images may have expanded)
        final_height = await page.evaluate("() => document.body.scrollHeight")
        diag["final_scroll_height"] = final_height

        # 9. Resize viewport again if content grew after image load
        if final_height > content_height:
            await page.set_viewport_size({
                "width": _VIEWPORT_WIDTH,
                "height": final_height,
            })
            diag["viewport_resized_to"] = f"{_VIEWPORT_WIDTH}x{final_height}"

        # 10. Take full-page screenshot
        await page.screenshot(path=output_path, full_page=True, timeout=15000)

        # 11. Log screenshot file info
        if os.path.isfile(output_path):
            file_size = os.path.getsize(output_path)
            diag["file_size_bytes"] = file_size
            try:
                # Read PNG header to get dimensions (bytes 16-24)
                with open(output_path, "rb") as f:
                    header = f.read(32)
                if header[:8] == b'\x89PNG\r\n\x1a\n':
                    import struct
                    w, h = struct.unpack('>II', header[16:24])
                    diag["image_dimensions"] = f"{w}x{h}"
            except Exception:
                pass

    try:
        await asyncio.wait_for(_do_render(), timeout=_PER_SCREENSHOT_TIMEOUT)
        if os.path.isfile(output_path) and os.path.getsize(output_path) > 0:
            return True, None, diag
        return False, "Screenshot file was not created", diag
    except asyncio.TimeoutError:
        return False, f"Screenshot timed out after {_PER_SCREENSHOT_TIMEOUT}s", diag
    except Exception as e:
        reason = str(e) or repr(e)
        if "Executable doesn't exist" in reason or "chromium" in reason.lower():
            reason = f"Chromium not installed: {reason}"
        elif "Timeout" in reason or "timeout" in reason:
            reason = f"Render timeout: {reason[:120]}"
        elif "net::ERR_" in reason:
            reason = f"Network error: {reason[:120]}"
        elif "Target closed" in reason or "closed" in reason.lower():
            reason = f"Page crashed: {reason[:120]}"
        return False, reason, diag


def _find_chromium_executable():
    """Locate the Playwright-managed Chromium executable on disk."""
    import platform
    import sys

    home = Path.home()
    candidates = []

    env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env_path:
        candidates.append(Path(env_path))

    if platform.system() == "Windows":
        candidates.append(home / "AppData" / "Local" / "ms-playwright")
    else:
        candidates.append(home / ".cache" / "ms-playwright")
    candidates.append(Path(sys.prefix) / "ms-playwright")

    exe_names = (
        [("chrome-win", "chrome.exe"), ("chrome-win64", "chrome.exe")]
        if platform.system() == "Windows"
        else [("chrome-linux", "chrome"), ("chrome-linux64", "chrome")]
    )

    searched = []
    for base in candidates:
        if not base.exists():
            searched.append(f"{base} (not found)")
            continue
        chromium_dirs = sorted(base.glob("chromium-*"), reverse=True)
        for cdir in chromium_dirs:
            for subdir, name in exe_names:
                exe = cdir / subdir / name
                searched.append(str(exe))
                if exe.is_file():
                    return str(exe)

    logger.debug("Chromium search paths tried: %s", searched)
    return None


_BROWSER_LAUNCH_TIMEOUT = 30


async def _get_browser():
    """Launch a Playwright browser. Raises with clear message if unavailable."""
    import asyncio

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError(
            "playwright package not installed. Run: pip install playwright && python -m playwright install chromium"
        )

    exe_path = _find_chromium_executable()
    if exe_path:
        logger.info("Found Chromium at: %s", exe_path)
    else:
        logger.warning("Could not locate Chromium executable in standard paths")

    launch_args = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]

    pw = await async_playwright().start()
    try:
        launch_kwargs = {"headless": True, "args": launch_args}
        if exe_path:
            launch_kwargs["executable_path"] = exe_path

        browser = await asyncio.wait_for(
            pw.chromium.launch(**launch_kwargs),
            timeout=_BROWSER_LAUNCH_TIMEOUT,
        )
        return pw, browser
    except asyncio.TimeoutError:
        await pw.stop()
        raise RuntimeError(
            f"Screenshot engine failed to start: browser launch timed out after {_BROWSER_LAUNCH_TIMEOUT}s\n"
            f"Executable path: {exe_path or '(not found)'}\n"
            f"Fix: python -m playwright install --with-deps chromium"
        )
    except Exception as e:
        await pw.stop()
        msg = str(e) or ""
        exc_repr = repr(e)
        exc_type = type(e).__name__

        if "Executable doesn't exist" in msg or "Executable doesn't exist" in exc_repr:
            raise RuntimeError(
                f"Chromium not installed. Run: python -m playwright install --with-deps chromium\n"
                f"Looked for executable at: {exe_path or '(auto-detect failed)'}\n"
                f"Original error: {exc_repr}"
            )

        detail_parts = []
        if msg:
            detail_parts.append(msg)
        if exc_repr and exc_repr != msg:
            detail_parts.append(f"repr: {exc_repr}")
        if hasattr(e, "message"):
            detail_parts.append(f"message: {e.message}")
        if hasattr(e, "name"):
            detail_parts.append(f"name: {e.name}")

        detail = " | ".join(detail_parts) if detail_parts else f"({exc_type} with no message)"
        raise RuntimeError(
            f"Screenshot engine failed to start ({exc_type}): {detail}\n"
            f"Executable path: {exe_path or '(not found)'}\n"
            f"Launch args: {launch_args}\n"
            f"Fix: python -m playwright install --with-deps chromium"
        )


async def _new_page(browser):
    """Create a new page with the standard viewport."""
    return await browser.new_page(viewport={"width": _VIEWPORT_WIDTH, "height": 800})


def _pick_html(inv: dict, index: int, total: int) -> tuple[str, str]:
    """Choose and prepare HTML for an invoice. Returns (html, source)."""
    invoice_id = inv.get("id", f"inv_{index}")
    body_html = inv.get("body_html")
    body_html_len = len(body_html) if body_html else 0

    if body_html and body_html_len > 50:
        html = _prepare_email_html(body_html)
        source = "email"
        logger.info(
            "Screenshot %d/%d [%s] source=email, body_html=%d chars",
            index + 1, total, invoice_id, body_html_len,
        )
    else:
        html = _build_email_html(inv)
        source = "fallback"
        logger.warning(
            "Screenshot %d/%d [%s] source=FALLBACK — body_html %s "
            "(sender=%s, subject=%.60s)",
            index + 1, total, invoice_id,
            "is empty/null" if not body_html else f"only {body_html_len} chars",
            inv.get("sender", "?"),
            inv.get("subject", "?"),
        )

    return html, source


async def generate_screenshots(invoices: list[dict]) -> list[dict]:
    """Generate screenshots for a list of invoices. Best-effort."""
    abs_dir = os.path.abspath(SCREENSHOT_DIR)
    Path(abs_dir).mkdir(parents=True, exist_ok=True)

    try:
        pw, browser = await _get_browser()
    except Exception as e:
        error_msg = str(e) or repr(e) or f"Browser launch failed ({type(e).__name__})"
        logger.error("Cannot generate screenshots: %s", error_msg)
        for inv in invoices:
            inv["screenshot_error"] = error_msg
            inv["screenshot_html_source"] = "skipped"
        return invoices

    success_count = 0
    fail_count = 0
    total = len(invoices)

    try:
        page = await _new_page(browser)

        for i, inv in enumerate(invoices):
            invoice_id = inv.get("id", f"inv_{i}")
            output_path = os.path.join(abs_dir, f"{invoice_id}.png")

            worthy, skip_reason = is_screenshot_worthy(inv)
            if not worthy:
                inv["screenshot_error"] = skip_reason
                inv["screenshot_html_source"] = "skipped"
                fail_count += 1
                logger.info(
                    "Screenshot %d/%d [%s] SKIPPED: %s (tier=%s)",
                    i + 1, total, invoice_id, skip_reason,
                    inv.get("classification_tier", "?"),
                )
                continue

            html, source = _pick_html(inv, i, total)
            inv["screenshot_html_source"] = source

            ok, reason, diag = await _render_single(page, html, output_path, invoice_id)
            if ok:
                inv["screenshot_path"] = output_path
                success_count += 1
                logger.info(
                    "Screenshot %d/%d [%s] OK — source=%s, dims=%s, "
                    "heights: before=%s after=%s final=%s, size=%s bytes",
                    i + 1, total, invoice_id, source,
                    diag.get("image_dimensions", "?"),
                    diag.get("height_before_css", "?"),
                    diag.get("height_after_css", "?"),
                    diag.get("final_scroll_height", "?"),
                    diag.get("file_size_bytes", "?"),
                )
            else:
                inv["screenshot_error"] = reason or "Unknown render failure"
                fail_count += 1
                logger.warning(
                    "Screenshot %d/%d [%s] FAILED: %s (diag: %s)",
                    i + 1, total, invoice_id, reason, diag,
                )
                if reason and ("crashed" in reason.lower() or "closed" in reason.lower() or "timed out" in reason.lower()):
                    try:
                        await page.close()
                    except Exception:
                        pass
                    page = await _new_page(browser)

        await page.close()
    finally:
        await browser.close()
        await pw.stop()

    logger.info(
        "Screenshots complete: %d succeeded, %d failed out of %d total",
        success_count, fail_count, total,
    )
    return invoices


async def generate_screenshots_with_progress(
    invoices: list[dict],
) -> AsyncIterator[list[dict]]:
    """Generate screenshots one by one, yielding the full list after each."""
    abs_dir = os.path.abspath(SCREENSHOT_DIR)
    Path(abs_dir).mkdir(parents=True, exist_ok=True)

    try:
        pw, browser = await _get_browser()
    except Exception as e:
        error_msg = str(e) or repr(e) or f"Browser launch failed ({type(e).__name__})"
        logger.error("Cannot generate screenshots: %s", error_msg)
        for inv in invoices:
            inv["screenshot_error"] = error_msg
            inv["screenshot_html_source"] = "skipped"
            yield invoices
        return

    total = len(invoices)

    try:
        page = await _new_page(browser)

        for i, inv in enumerate(invoices):
            invoice_id = inv.get("id", f"inv_{i}")
            output_path = os.path.join(abs_dir, f"{invoice_id}.png")

            worthy, skip_reason = is_screenshot_worthy(inv)
            if not worthy:
                inv["screenshot_error"] = skip_reason
                inv["screenshot_html_source"] = "skipped"
                logger.info(
                    "Screenshot %d/%d [%s] SKIPPED: %s (tier=%s)",
                    i + 1, total, invoice_id, skip_reason,
                    inv.get("classification_tier", "?"),
                )
                yield invoices
                continue

            html, source = _pick_html(inv, i, total)
            inv["screenshot_html_source"] = source

            ok, reason, diag = await _render_single(page, html, output_path, invoice_id)
            if ok:
                inv["screenshot_path"] = output_path
                logger.info(
                    "Screenshot %d/%d [%s] OK — source=%s, dims=%s, "
                    "heights: before=%s after=%s final=%s, size=%s bytes",
                    i + 1, total, invoice_id, source,
                    diag.get("image_dimensions", "?"),
                    diag.get("height_before_css", "?"),
                    diag.get("height_after_css", "?"),
                    diag.get("final_scroll_height", "?"),
                    diag.get("file_size_bytes", "?"),
                )
            else:
                inv["screenshot_error"] = reason or "Unknown render failure"
                logger.warning(
                    "Screenshot %d/%d [%s] FAILED: %s (diag: %s)",
                    i + 1, total, invoice_id, reason, diag,
                )
                if reason and ("crashed" in reason.lower() or "closed" in reason.lower() or "timed out" in reason.lower()):
                    try:
                        await page.close()
                    except Exception:
                        pass
                    page = await _new_page(browser)

            yield invoices

        await page.close()
    finally:
        await browser.close()
        await pw.stop()
