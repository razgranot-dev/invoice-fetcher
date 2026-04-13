"""
Email screenshot generator using Playwright (async API).

Renders email HTML bodies as PNG images for embedding in Word exports.
Gracefully handles failures — each screenshot is independent.
Uses a single browser instance for all screenshots in a batch.

Setup: pip install playwright && python -m playwright install chromium
"""

import logging
import os
from pathlib import Path
from typing import AsyncIterator

from core.invoice_classifier import is_screenshot_worthy

logger = logging.getLogger(__name__)

SCREENSHOT_DIR = os.path.join("output", "screenshots")


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


_PER_SCREENSHOT_TIMEOUT = 20  # hard cap per screenshot — kill and move on


async def _render_single(page, html: str, output_path: str) -> tuple[bool, str | None]:
    """Render HTML to PNG using an existing Playwright page.

    Returns (True, None) on success, (False, reason) on failure.
    Uses domcontentloaded (not networkidle) so external images/pixels don't block.
    Hard-capped at _PER_SCREENSHOT_TIMEOUT seconds total.
    """
    import asyncio

    async def _do_render():
        await page.set_content(html, wait_until="domcontentloaded", timeout=10000)
        # Override email CSS that constrains height/clips content
        await page.add_style_tag(content=(
            "html, body { height: auto !important; min-height: auto !important; "
            "max-height: none !important; overflow: visible !important; }"
        ))
        await page.screenshot(path=output_path, full_page=True, timeout=10000)

    try:
        await asyncio.wait_for(_do_render(), timeout=_PER_SCREENSHOT_TIMEOUT)
        if os.path.isfile(output_path) and os.path.getsize(output_path) > 0:
            return True, None
        return False, "Screenshot file was not created"
    except asyncio.TimeoutError:
        return False, f"Screenshot timed out after {_PER_SCREENSHOT_TIMEOUT}s"
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
        return False, reason


def _find_chromium_executable():
    """Locate the Playwright-managed Chromium executable on disk.

    Returns the path string if found, None otherwise.
    Checks PLAYWRIGHT_BROWSERS_PATH env var first, then standard install locations.
    """
    import platform
    import sys

    home = Path.home()
    candidates = []

    # Check PLAYWRIGHT_BROWSERS_PATH env override first
    env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env_path:
        candidates.append(Path(env_path))

    # Platform-specific default locations
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


_BROWSER_LAUNCH_TIMEOUT = 30  # seconds — fail fast if Chromium can't start


async def _get_browser():
    """Launch a Playwright browser. Raises with clear message if unavailable."""
    import asyncio

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError(
            "playwright package not installed. Run: pip install playwright && python -m playwright install chromium"
        )

    # Pre-check: verify Chromium executable exists
    exe_path = _find_chromium_executable()
    if exe_path:
        logger.info("Found Chromium at: %s", exe_path)
    else:
        logger.warning("Could not locate Chromium executable in standard paths")

    # Chromium sandbox fails in containers (Linux) and worker processes (Windows)
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
            f"This usually means Chromium is not installed or cannot run in this environment.\n"
            f"Fix: python -m playwright install --with-deps chromium"
        )
    except Exception as e:
        await pw.stop()
        # Build a detailed error — str(e) is often empty for Playwright errors
        msg = str(e) or ""
        exc_repr = repr(e)
        exc_type = type(e).__name__

        if "Executable doesn't exist" in msg or "Executable doesn't exist" in exc_repr:
            raise RuntimeError(
                f"Chromium not installed. Run: python -m playwright install --with-deps chromium\n"
                f"Looked for executable at: {exe_path or '(auto-detect failed)'}\n"
                f"Original error: {exc_repr}"
            )

        # Construct a useful error from whatever we have
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


async def generate_screenshots(invoices: list[dict]) -> list[dict]:
    """Generate screenshots for a list of invoices. Best-effort.

    Uses a single browser instance for all screenshots.
    Adds to each invoice dict:
      - 'screenshot_path': path to PNG on success
      - 'screenshot_error': failure reason string on failure
      - 'screenshot_html_source': 'email' or 'fallback' indicating HTML origin
    """
    abs_dir = os.path.abspath(SCREENSHOT_DIR)
    Path(abs_dir).mkdir(parents=True, exist_ok=True)

    # Try to launch browser once
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

    try:
        page = await browser.new_page(viewport={"width": 800, "height": 600})

        for i, inv in enumerate(invoices):
            invoice_id = inv.get("id", f"inv_{i}")
            output_path = os.path.join(abs_dir, f"{invoice_id}.png")

            # Quality gate — skip weak/non-invoice emails
            worthy, skip_reason = is_screenshot_worthy(inv)
            if not worthy:
                inv["screenshot_error"] = skip_reason
                inv["screenshot_html_source"] = "skipped"
                fail_count += 1
                logger.info(
                    "Screenshot %d/%d skipped for %s (%s): %s",
                    i + 1, len(invoices), invoice_id,
                    inv.get("sender", "?"), skip_reason,
                )
                continue

            body_html = inv.get("body_html")
            if body_html:
                html = body_html
                inv["screenshot_html_source"] = "email"
            else:
                html = _build_email_html(inv)
                inv["screenshot_html_source"] = "fallback"

            ok, reason = await _render_single(page, html, output_path)
            if ok:
                inv["screenshot_path"] = output_path
                success_count += 1
            else:
                inv["screenshot_error"] = reason or "Unknown render failure"
                fail_count += 1
                logger.info(
                    "Screenshot %d/%d failed for %s (%s): %s",
                    i + 1, len(invoices), invoice_id,
                    inv.get("sender", "?"), reason,
                )
                if reason and ("crashed" in reason.lower() or "closed" in reason.lower() or "timed out" in reason.lower()):
                    try:
                        await page.close()
                    except Exception:
                        pass
                    page = await browser.new_page(viewport={"width": 800, "height": 600})

        await page.close()
    finally:
        await browser.close()
        await pw.stop()

    logger.info(
        "Screenshots: %d succeeded, %d failed out of %d total",
        success_count, fail_count, len(invoices),
    )
    return invoices


async def generate_screenshots_with_progress(
    invoices: list[dict],
) -> AsyncIterator[list[dict]]:
    """Generate screenshots one by one, yielding the full list after each.

    Uses a single browser instance for all screenshots.
    Yields the invoice list after each screenshot attempt.

    Each invoice gets:
      - 'screenshot_path': on success
      - 'screenshot_error': reason string on failure
      - 'screenshot_html_source': 'email' or 'fallback'
    """
    abs_dir = os.path.abspath(SCREENSHOT_DIR)
    Path(abs_dir).mkdir(parents=True, exist_ok=True)

    # Try to launch browser once
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

    try:
        page = await browser.new_page(viewport={"width": 800, "height": 600})

        for i, inv in enumerate(invoices):
            invoice_id = inv.get("id", f"inv_{i}")
            output_path = os.path.join(abs_dir, f"{invoice_id}.png")

            # Quality gate — skip weak/non-invoice emails
            worthy, skip_reason = is_screenshot_worthy(inv)
            if not worthy:
                inv["screenshot_error"] = skip_reason
                inv["screenshot_html_source"] = "skipped"
                logger.info(
                    "Screenshot %d/%d skipped for %s (%s): %s",
                    i + 1, len(invoices), invoice_id,
                    inv.get("sender", "?"), skip_reason,
                )
                yield invoices
                continue

            body_html = inv.get("body_html")
            if body_html:
                html = body_html
                inv["screenshot_html_source"] = "email"
            else:
                html = _build_email_html(inv)
                inv["screenshot_html_source"] = "fallback"

            ok, reason = await _render_single(page, html, output_path)
            if ok:
                inv["screenshot_path"] = output_path
            else:
                inv["screenshot_error"] = reason or "Unknown render failure"
                logger.info(
                    "Screenshot %d/%d failed for %s (%s): %s",
                    i + 1, len(invoices), invoice_id,
                    inv.get("sender", "?"), reason,
                )
                # If the page crashed, create a fresh one for remaining screenshots
                if reason and ("crashed" in reason.lower() or "closed" in reason.lower() or "timed out" in reason.lower()):
                    try:
                        await page.close()
                    except Exception:
                        pass
                    page = await browser.new_page(viewport={"width": 800, "height": 600})

            yield invoices

        await page.close()
    finally:
        await browser.close()
        await pw.stop()
