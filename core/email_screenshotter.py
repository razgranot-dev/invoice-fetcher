"""
Email screenshot generator using Playwright (async API).

Renders email HTML bodies as PNG images for embedding in Word exports.
Gracefully handles failures — each screenshot is independent.
Uses a single browser instance for all screenshots in a batch.

Setup: pip install playwright && python -m playwright install chromium
"""

import asyncio
import html
import ipaddress
import logging
import os
import re
import socket
from pathlib import Path
from typing import Any, AsyncIterator
from urllib.parse import urlparse

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

# Hostnames that must never be reached from rendered email content.
_BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal"}

# Schemes the renderer is allowed to fetch. Everything else (file:, ftp:,
# blob:, chrome:, etc.) is aborted so untrusted email HTML cannot reach the
# local filesystem or unexpected protocols.
_ALLOWED_SCHEMES = {"http", "https", "data"}


def _safe_filename_id(raw: Any) -> str:
    """Sanitize an invoice id for use as a filename stem.

    Keeps only [A-Za-z0-9_-], replaces every other character with "_", caps the
    result at 64 chars, and falls back to "inv" when nothing usable remains.
    Prevents path traversal / absolute paths built from untrusted invoice ids.
    """
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "_", str(raw))
    cleaned = cleaned[:64]
    return cleaned or "inv"


def _legacy_ipv4(hostname: str):
    """Coerce legacy IPv4 notations that browsers resolve as addresses.

    Chromium (per the WHATWG URL spec) treats pure-integer hostnames — decimal
    ("2130706433"), hex ("0x7f000001"), octal ("0177.0.0.1"), and shortened
    dotted forms ("127.1") — as IPv4 addresses, but ipaddress.ip_address only
    accepts canonical dotted-quad. socket.inet_aton implements the historical
    numbers-and-dots grammar, closing that bypass. Returns an IPv4Address, or
    None when the hostname is a genuine domain name.
    """
    # Pre-filter: legacy IPv4 notation only ever contains hex digits, "x"/"X"
    # (0x prefix), and dots. This keeps behavior deterministic across
    # platforms whose inet_aton tolerates trailing garbage.
    if not hostname or not re.fullmatch(r"[0-9a-fx.]+", hostname, re.IGNORECASE):
        return None
    try:
        return ipaddress.ip_address(socket.inet_aton(hostname))
    except (OSError, ValueError):
        return None


def _is_blocked_url(url: str) -> bool:
    """Decide whether a request URL must be aborted (SSRF guard).

    Blocks when the scheme is not http/https/data, when the hostname is a known
    sensitive name (localhost / metadata.google.internal), or when the hostname
    parses as an IP address that is private, loopback, link-local, or otherwise
    reserved — including legacy integer/hex/octal IPv4 notations and
    IPv4-mapped IPv6. Non-IP hostnames (regular domains) are allowed. Pure
    function so it can be unit-tested without a browser.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        # Un-parseable URL — safest to block.
        return True

    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        return True

    # data: URLs carry no host and never hit the network — always allowed.
    if scheme == "data":
        return False

    hostname = (parsed.hostname or "").lower()
    # A single trailing dot is a root-FQDN marker browsers strip before
    # resolving ("localhost." == "localhost", "127.0.0.1." == 127.0.0.1).
    if hostname.endswith("."):
        hostname = hostname[:-1]
    if not hostname:
        # http/https with no host is malformed — block.
        return True

    if hostname in _BLOCKED_HOSTNAMES:
        return True

    # If the hostname is an IP literal, block any non-public range.
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        # Not canonical — try legacy integer/hex/octal IPv4 notations that
        # Chromium still resolves as addresses (e.g. http://2130706433/).
        ip = _legacy_ipv4(hostname)
        if ip is None:
            # A normal domain name, allowed.
            return False

    # IPv4-mapped IPv6 (::ffff:127.0.0.1) must be judged by the mapped IPv4.
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped

    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


async def _install_request_guard(page) -> None:
    """Route every request through the SSRF guard.

    Aborts requests to blocked URLs; allows everything else. The guard never
    raises — on any unexpected error it lets the request continue so a single
    odd URL cannot break the whole render.
    """
    async def guard(route):
        try:
            if _is_blocked_url(route.request.url):
                await route.abort()
            else:
                await route.continue_()
        except Exception:
            try:
                await route.continue_()
            except Exception:
                pass

    await page.route("**/*", guard)


def _build_email_html(invoice: dict) -> str:
    """Build a simple email-like HTML from invoice metadata.

    Used when original email HTML is not available.
    """
    # Escape every email-controlled field — these are interpolated into HTML
    # below and must not be able to inject markup or script into the card.
    company = html.escape(str(invoice.get("company") or invoice.get("sender") or "Unknown"))
    subject = html.escape(str(invoice.get("subject") or "(no subject)"))
    sender = html.escape(str(invoice.get("sender") or ""))
    date_str = html.escape(str(invoice.get("date") or ""))
    amount = invoice.get("amount")
    currency = html.escape(str(invoice.get("currency", "ILS")))
    notes = html.escape(str(invoice.get("notes") or ""))

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
_MAX_VIEWPORT_HEIGHT = 12000  # hard cap — untrusted content must not force a giant viewport


async def _render_single(
    page, html: str, output_path: str, invoice_id: str = ""
) -> tuple[bool, str | None, dict[str, Any]]:
    """Render HTML to PNG using an existing Playwright page.

    Returns (success, error_reason, diagnostics_dict).
    """
    import asyncio

    diag: dict[str, Any] = {"invoice_id": invoice_id}

    async def _do_render():
        # 1. Load HTML — wait for 'load' event (fires after images/CSS/iframes).
        #    A single slow remote image can block 'load' until timeout; when that
        #    happens, fall back to 'domcontentloaded' rather than failing the whole
        #    screenshot.
        try:
            await page.set_content(html, wait_until="load", timeout=20000)
        except Exception as e:
            diag["set_content_load_failed"] = str(e)[:120]
            await page.set_content(html, wait_until="domcontentloaded", timeout=10000)
            diag["set_content_fallback"] = "domcontentloaded"

        # 2. Measure page height BEFORE CSS reinforcement
        height_before = await page.evaluate("() => document.body.scrollHeight")
        diag["height_before_css"] = height_before

        # 3. Reinforce override CSS. Injected via plain evaluate — NOT
        #    page.add_style_tag, which waits for a stylesheet 'load' event
        #    that never fires while page JavaScript is disabled (it would
        #    hang until the per-screenshot cap and fail every render).
        await page.evaluate(
            """(css) => {
                const s = document.createElement('style');
                s.textContent = css;
                (document.head || document.documentElement).appendChild(s);
            }""",
            _OVERRIDE_CSS,
        )

        # 4. Brief wait for any remaining network requests — bounded and
        #    best-effort; we capture anyway when the network never settles.
        try:
            await page.wait_for_load_state("networkidle", timeout=2000)
        except Exception:
            pass

        # 5. Measure height AFTER CSS reinforcement
        height_after = await page.evaluate("() => document.body.scrollHeight")
        diag["height_after_css"] = height_after

        # 6. Resize viewport to match full content height (prevents clipping),
        #    capped so untrusted content cannot force an enormous viewport.
        uncapped_content_height = max(height_after, height_before, 800)
        content_height = uncapped_content_height
        if content_height > _MAX_VIEWPORT_HEIGHT:
            diag["viewport_height_clamped"] = f"{content_height}->{_MAX_VIEWPORT_HEIGHT}"
            content_height = _MAX_VIEWPORT_HEIGHT
        await page.set_viewport_size({
            "width": _VIEWPORT_WIDTH,
            "height": content_height,
        })
        diag["viewport_set_to"] = f"{_VIEWPORT_WIDTH}x{content_height}"

        # 7. Scroll to bottom then back to top to trigger lazy-loaded images.
        #    Short, fixed settle, slept on the PYTHON side — in-page
        #    setTimeout timers never fire while page JavaScript is disabled,
        #    so a Promise-based settle would hang until the per-screenshot
        #    cap. Slow images already got their chance in steps 1 and 4.
        await page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(0.3)
        await page.evaluate("() => window.scrollTo(0, 0)")
        await asyncio.sleep(0.7)

        # 8. Final height measurement after scroll (images may have expanded)
        final_height = await page.evaluate("() => document.body.scrollHeight")
        diag["final_scroll_height"] = final_height

        # 9. Resize viewport again if content grew after image load (still capped)
        if final_height > content_height:
            capped_final = final_height
            if capped_final > _MAX_VIEWPORT_HEIGHT:
                diag["final_viewport_height_clamped"] = f"{final_height}->{_MAX_VIEWPORT_HEIGHT}"
                capped_final = _MAX_VIEWPORT_HEIGHT
            await page.set_viewport_size({
                "width": _VIEWPORT_WIDTH,
                "height": capped_final,
            })
            diag["viewport_resized_to"] = f"{_VIEWPORT_WIDTH}x{capped_final}"

        # 10. Capture. full_page=True captures the entire scrollable document
        #     regardless of viewport size, so when content exceeds the height
        #     cap we clip explicitly (clip and full_page are mutually exclusive
        #     in Playwright) — a giant digest email cannot produce a giant PNG
        #     that hits Chromium texture limits or bloats the export ZIP.
        uncapped_total_height = max(final_height, uncapped_content_height)
        if uncapped_total_height > _MAX_VIEWPORT_HEIGHT:
            diag["screenshot_clipped"] = f"{uncapped_total_height}->{_MAX_VIEWPORT_HEIGHT}"
            await page.screenshot(
                path=output_path,
                clip={
                    "x": 0,
                    "y": 0,
                    "width": _VIEWPORT_WIDTH,
                    "height": _MAX_VIEWPORT_HEIGHT,
                },
                timeout=15000,
            )
        else:
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


def _package_local_browsers_dir() -> Path | None:
    """Browser dir used by PLAYWRIGHT_BROWSERS_PATH=0 installs (package-local)."""
    try:
        import playwright
    except ImportError:
        return None
    return Path(playwright.__file__).parent / "driver" / "package" / ".local-browsers"


def _repo_browsers_dir() -> Path:
    """Repo-relative browser dir used by worker/build.sh (worker/.pw-browsers).

    Baked into the search path so a clean Linux deploy finds Chromium even when
    the runtime environment does not export PLAYWRIGHT_BROWSERS_PATH.
    """
    return Path(__file__).resolve().parent.parent / "worker" / ".pw-browsers"


def _find_chromium_executable():
    """Locate the Playwright-managed Chromium executable on disk."""
    import platform
    import sys

    home = Path.home()
    candidates = []

    env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env_path == "0":
        # "0" is Playwright's sentinel for "install into the package dir",
        # not a real directory — search the package-local dir instead.
        pkg_dir = _package_local_browsers_dir()
        if pkg_dir is not None:
            candidates.append(pkg_dir)
    elif env_path:
        candidates.append(Path(env_path))

    candidates.append(_repo_browsers_dir())
    if platform.system() == "Windows":
        candidates.append(home / "AppData" / "Local" / "ms-playwright")
    else:
        candidates.append(home / ".cache" / "ms-playwright")
    candidates.append(Path(sys.prefix) / "ms-playwright")
    # Belt and braces: a previous build may have installed with the "0"
    # sentinel even though the runtime env no longer says so.
    pkg_dir = _package_local_browsers_dir()
    if pkg_dir is not None and pkg_dir not in candidates:
        candidates.append(pkg_dir)

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
    """Create a new page with the standard viewport.

    JavaScript is disabled so untrusted email HTML cannot execute scripts, and
    a request guard is installed to block SSRF-style requests (private/loopback
    IPs, cloud metadata endpoints, non-web schemes). Playwright's own
    page.evaluate()/add_style_tag() continue to work with page JS disabled.
    """
    page = await browser.new_page(
        java_script_enabled=False,
        viewport={"width": _VIEWPORT_WIDTH, "height": 800},
    )
    await _install_request_guard(page)
    return page


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


_DEFAULT_CONCURRENCY = 3

# Sentinel a render worker puts on the completion queue when it exits.
_WORKER_EXIT = object()


def _screenshot_concurrency() -> int:
    """Concurrent Chromium pages (env SCREENSHOT_CONCURRENCY, clamped 1-8).

    3 is the safe ceiling for small (512MB) instances; each page costs
    Chromium memory, so the cap is deliberately conservative.
    """
    raw = os.environ.get("SCREENSHOT_CONCURRENCY", "")
    try:
        n = int(raw) if raw else _DEFAULT_CONCURRENCY
    except ValueError:
        n = _DEFAULT_CONCURRENCY
    return max(1, min(n, 8))


async def _process_one(
    page, i: int, inv: dict, total: int, abs_dir: str
) -> tuple[bool, bool]:
    """Render (or skip) one invoice on the given page.

    Mutates `inv` in place with screenshot_path / screenshot_error /
    screenshot_html_source. Returns (ok, needs_page_recycle).
    """
    invoice_id = inv.get("id", f"inv_{i}")
    output_path = os.path.join(abs_dir, f"{_safe_filename_id(invoice_id)}.png")

    worthy, skip_reason = is_screenshot_worthy(inv)
    if not worthy:
        inv["screenshot_error"] = skip_reason
        inv["screenshot_html_source"] = "skipped"
        logger.info(
            "Screenshot %d/%d [%s] SKIPPED: %s (tier=%s)",
            i + 1, total, invoice_id, skip_reason,
            inv.get("classification_tier", "?"),
        )
        return False, False

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
        return True, False

    inv["screenshot_error"] = reason or "Unknown render failure"
    logger.warning(
        "Screenshot %d/%d [%s] FAILED: %s (diag: %s)",
        i + 1, total, invoice_id, reason, diag,
    )
    recycle = bool(reason) and (
        "crashed" in reason.lower()
        or "closed" in reason.lower()
        or "timed out" in reason.lower()
    )
    return False, recycle


async def _render_worker(
    browser, work: "asyncio.Queue", done: "asyncio.Queue", total: int, abs_dir: str
) -> None:
    """Pull invoices off the work queue and render them on one owned page.

    Puts (index, ok) on `done` per finished invoice and _WORKER_EXIT when the
    worker stops (queue drained or the browser died). Never raises — a dead
    worker must not strand the consumer.
    """
    page = None
    try:
        page = await _new_page(browser)
        while True:
            try:
                i, inv = work.get_nowait()
            except asyncio.QueueEmpty:
                break
            try:
                ok, recycle = await _process_one(page, i, inv, total, abs_dir)
            except Exception as e:
                inv["screenshot_error"] = str(e) or repr(e)
                inv.setdefault("screenshot_html_source", "unknown")
                ok, recycle = False, True
            await done.put((i, ok))
            if recycle:
                try:
                    await page.close()
                except Exception:
                    pass
                page = await _new_page(browser)  # raises if the browser died
    except Exception as e:
        logger.error("Screenshot worker exited unexpectedly: %s", e)
    finally:
        if page is not None:
            try:
                await page.close()
            except Exception:
                pass
        await done.put(_WORKER_EXIT)


async def generate_screenshots_with_progress(
    invoices: list[dict],
) -> AsyncIterator[list[dict]]:
    """Generate screenshots with a small pool of concurrent pages.

    Yields the full (mutated) list once per completed invoice — completion
    order is not input order, but the yield count matches the invoice count so
    progress consumers can keep counting monotonically.
    """
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
    work: asyncio.Queue = asyncio.Queue()
    for item in enumerate(invoices):
        work.put_nowait(item)
    done: asyncio.Queue = asyncio.Queue()

    n_workers = max(1, min(_screenshot_concurrency(), total))
    workers = [
        asyncio.create_task(_render_worker(browser, work, done, total, abs_dir))
        for _ in range(n_workers)
    ]

    completed = 0
    active = n_workers
    try:
        while completed < total and active > 0:
            item = await done.get()
            if item is _WORKER_EXIT:
                active -= 1
                continue
            completed += 1
            yield invoices
        if completed < total:
            # Every worker died before the batch finished (browser crash) —
            # mark the leftovers so callers never see a silent gap. Total
            # yields stay <= len(invoices).
            for inv in invoices:
                if "screenshot_path" not in inv and "screenshot_error" not in inv:
                    inv["screenshot_error"] = (
                        "Screenshot worker exited before rendering this invoice"
                    )
                    inv.setdefault("screenshot_html_source", "skipped")
            yield invoices
    finally:
        for w in workers:
            w.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        await browser.close()
        await pw.stop()


async def generate_screenshots(invoices: list[dict]) -> list[dict]:
    """Generate screenshots for a list of invoices. Best-effort."""
    async for _ in generate_screenshots_with_progress(invoices):
        pass

    total = len(invoices)
    success_count = sum(1 for inv in invoices if inv.get("screenshot_path"))
    logger.info(
        "Screenshots complete: %d succeeded, %d failed out of %d total",
        success_count, total - success_count, total,
    )
    return invoices
