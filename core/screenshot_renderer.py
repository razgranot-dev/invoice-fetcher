"""
צילומי מסך של אימיילים — HTML→PNG via direct Chrome subprocess, PDF fallback via PyMuPDF.

Calls Chrome headless directly (no html2image wrapper) so we can hard-kill
the process on timeout. Auto-crops whitespace so the result contains only
the actual email content.
"""

import html
import logging
import os
import re
import shutil
import sys
import subprocess
import tempfile
import zipfile
from datetime import date
from pathlib import Path

_MINIMAL_BODY_THRESHOLD = 100
_MINIMAL_BODY_PATTERNS = re.compile(
    r"(?:see\s+attached|ראה?\s+מצורף|קובץ\s+מצורף|attached\s+(?:invoice|file|document))",
    re.IGNORECASE,
)
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*]')
# Strip everything except ASCII letters, digits, dash, underscore, dot
_FILENAME_ASCII_ONLY = re.compile(r'[^a-zA-Z0-9._-]')


def _transliterate_hebrew(text: str) -> str:
    """Transliterate common Hebrew chars to ASCII approximations for filenames."""
    _MAP = {
        'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'v',
        'ז': 'z', 'ח': 'ch', 'ט': 't', 'י': 'y', 'כ': 'k', 'ך': 'k',
        'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's',
        'ע': 'a', 'פ': 'p', 'ף': 'f', 'צ': 'ts', 'ץ': 'ts', 'ק': 'q',
        'ר': 'r', 'ש': 'sh', 'ת': 't',
    }
    return ''.join(_MAP.get(c, c) for c in text)


def is_minimal_body(text: str) -> bool:
    """Check if email body is too minimal to screenshot (likely just 'see attached')."""
    stripped = text.strip()
    if len(stripped) < _MINIMAL_BODY_THRESHOLD:
        return True
    if _MINIMAL_BODY_PATTERNS.search(stripped):
        return True
    return False


def build_html_template(body_html: str, plain_text: str = "") -> str:
    """Wrap email HTML in a clean, RTL-ready template for screenshot rendering."""
    content = body_html if body_html else f"<pre style='white-space:pre-wrap;'>{html.escape(plain_text)}</pre>"
    return f"""<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {{
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: rtl;
    background: #ffffff;
    color: #1a1a1a;
    max-width: 800px;
    margin: 0 auto;
    padding: 32px;
    line-height: 1.6;
  }}
  img {{ max-width: 100%; height: auto; }}
  table {{ border-collapse: collapse; width: 100%; }}
  td, th {{ border: 1px solid #ddd; padding: 8px; text-align: right; }}
</style>
</head>
<body>
{content}
</body>
</html>"""


def generate_filename(date_str: str, vendor: str, amount: float | None, index: int | None = None) -> str:
    """Generate a clean, ASCII-safe filename for a screenshot PNG.

    Aggressively strips non-ASCII characters (including Hebrew) to prevent
    Chrome headless from silently failing to write the --screenshot output.
    """
    # Transliterate Hebrew → ASCII, then strip anything remaining that isn't safe
    transliterated = _transliterate_hebrew(vendor)
    safe_vendor = _FILENAME_ASCII_ONLY.sub('_', transliterated)
    # Collapse multiple underscores and trim
    safe_vendor = re.sub(r'_+', '_', safe_vendor).strip('_')[:40]
    if not safe_vendor:
        safe_vendor = "email"

    safe_date = _FILENAME_ASCII_ONLY.sub('', date_str)[:10]
    suffix = f"_{index}" if index is not None else ""
    if amount is not None:
        name = f"{safe_date}_{safe_vendor}_{amount:.2f}{suffix}.png"
    else:
        name = f"{safe_date}_{safe_vendor}{suffix}.png"
    return name


_logger = logging.getLogger(__name__)

# ── Chrome path detection ──────────────────────────────────────────────────
# Hardcoded known path — checked first, always works if Chrome is installed
_CHROME_OVERRIDE = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

_CHROME_CANDIDATES_WIN = [
    _CHROME_OVERRIDE,
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    os.path.join(os.environ.get("PROGRAMFILES", ""), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
]
_CHROME_CANDIDATES_UNIX = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def _find_chrome() -> str | None:
    """Auto-detect Chrome/Chromium binary path."""
    candidates = _CHROME_CANDIDATES_WIN if sys.platform == "win32" else _CHROME_CANDIDATES_UNIX
    for path in candidates:
        if not path:
            continue
        exists = os.path.isfile(path)
        _logger.info("Chrome candidate: %s → %s", path, "FOUND" if exists else "not found")
        if exists:
            return path
    # Fallback: check PATH
    found = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("chromium")
    _logger.info("Chrome PATH lookup → %s", found or "not found")
    return found


def _autocrop_whitespace(image_path: str, bg_color: tuple = (255, 255, 255), padding: int = 32) -> None:
    """Crop trailing whitespace from a screenshot PNG, keeping content + padding.

    After rendering with a tall viewport, the image has a large white area below
    the actual email content. This trims it to just the content height + padding.
    """
    try:
        from PIL import Image, ImageChops

        img = Image.open(image_path)
        # Create a solid background image to diff against
        bg = Image.new(img.mode, img.size, bg_color)
        diff = ImageChops.difference(img, bg)
        bbox = diff.getbbox()
        if bbox:
            # bbox = (left, upper, right, lower) — expand with padding
            cropped = img.crop((0, 0, img.width, min(bbox[3] + padding, img.height)))
            cropped.save(image_path)
        img.close()
    except Exception:
        _logger.debug("Auto-crop failed for %s — keeping original", image_path, exc_info=True)


_SCREENSHOT_TIMEOUT = 30  # seconds per screenshot before killing Chrome
_VIEWPORT_WIDTH = 800
_VIEWPORT_HEIGHT = 4096   # reasonable height; avoids Chrome memory stalls


def _render_html_to_png_subprocess(
    html_content: str, output_path: str, chrome_path: str,
) -> tuple[bool, str]:
    """Render HTML to PNG by calling Chrome directly via subprocess.

    Uses a unique temp profile per invocation to prevent Chrome profile conflicts.
    Uses ``process.kill()`` for guaranteed hard termination on timeout.

    Returns (success: bool, reason: str).
    """
    # Resolve to absolute path BEFORE anything else — Chrome resolves
    # relative paths from its own install dir, not Python's CWD.
    output_path = os.path.abspath(output_path)
    _logger.info("Screenshot output (absolute): %s", output_path)

    tmp_html: str | None = None
    tmp_profile: str | None = None
    process: subprocess.Popen | None = None
    try:
        # ── Pre-flight checks ────────────────────────────────────────
        output_dir = os.path.dirname(output_path)
        if not os.path.isdir(output_dir):
            _logger.error(
                "Output directory does NOT exist: %s — creating it", output_dir,
            )
            os.makedirs(output_dir, exist_ok=True)

        # Verify the output path is writable by creating/removing a test file
        try:
            _test_path = output_path + ".writetest"
            Path(_test_path).touch()
            os.unlink(_test_path)
        except OSError as write_err:
            _logger.error(
                "Output path is NOT writable: %s — %s", output_path, write_err,
            )
            return False, "output_dir_not_writable"

        _logger.info(
            "Pre-flight OK: output_dir=%s exists=%s, output_path=%s",
            output_dir, os.path.isdir(output_dir), output_path,
        )

        # Write HTML to a temp file Chrome can open
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".html", delete=False, encoding="utf-8",
        ) as f:
            f.write(html_content)
            tmp_html = f.name

        # Unique temp profile so concurrent/sequential Chrome runs don't clash
        tmp_profile = tempfile.mkdtemp(prefix="chrome_snap_")

        file_url = Path(tmp_html).as_uri()

        cmd = [
            chrome_path,
            "--headless=new",
            f"--screenshot={output_path}",
            f"--window-size={_VIEWPORT_WIDTH},{_VIEWPORT_HEIGHT}",
            f"--user-data-dir={tmp_profile}",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--disable-javascript",
            "--run-all-compositor-stages-before-draw",
            "--virtual-time-budget=10000",
            file_url,
        ]

        _logger.info(
            "Chrome CMD: %s", " ".join(f'"{c}"' if " " in c else c for c in cmd),
        )
        _logger.info("Chrome input HTML: %s (%d bytes)", tmp_html, len(html_content))
        _logger.info("Chrome expected output: %s", output_path)

        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        _logger.info("Chrome subprocess: PID=%d", process.pid)

        try:
            stdout_bytes, stderr_bytes = process.communicate(timeout=_SCREENSHOT_TIMEOUT)

            stderr_text = stderr_bytes.decode(errors="replace") if stderr_bytes else ""
            stdout_text = stdout_bytes.decode(errors="replace") if stdout_bytes else ""

            if stderr_text:
                _logger.info("Chrome STDERR:\n%s", stderr_text[:2000])
            if stdout_text:
                _logger.info("Chrome STDOUT:\n%s", stdout_text[:500])

            if process.returncode != 0:
                _logger.error(
                    "Chrome PID=%d CRASHED with code %d. stderr=%s",
                    process.pid, process.returncode, stderr_text[:500],
                )
                return False, "chrome_crash"

            if os.path.isfile(output_path):
                file_size = os.path.getsize(output_path)
                _logger.info(
                    "Chrome PID=%d wrote %s (%d bytes) — SUCCESS",
                    process.pid, output_path, file_size,
                )
                return True, "success"

            # Chrome exited 0 but no file — log everything for diagnosis
            _logger.error(
                "Chrome PID=%d exited 0 but NO OUTPUT FILE at: %s\n"
                "  tmp_html=%s (exists=%s)\n"
                "  output_dir=%s (exists=%s)\n"
                "  chrome_path=%s\n"
                "  stderr=%s",
                process.pid, output_path,
                tmp_html, os.path.isfile(tmp_html) if tmp_html else "N/A",
                output_dir, os.path.isdir(output_dir),
                chrome_path,
                stderr_text[:1000],
            )
            # Check if Chrome wrote to a different path (e.g. CWD)
            basename = os.path.basename(output_path)
            cwd_candidate = os.path.join(os.getcwd(), basename)
            if os.path.isfile(cwd_candidate):
                _logger.warning(
                    "Found file at CWD instead: %s — moving to expected path",
                    cwd_candidate,
                )
                shutil.move(cwd_candidate, output_path)
                return True, "success"

            return False, "no_output_file"

        except subprocess.TimeoutExpired:
            _logger.error(
                "Chrome PID=%d TIMED OUT after %ds — KILLING",
                process.pid, _SCREENSHOT_TIMEOUT,
            )
            process.kill()
            process.wait(timeout=5)
            _logger.info("Chrome PID=%d killed successfully", process.pid)
            return False, "timeout"

    except FileNotFoundError:
        _logger.error("Chrome binary not found at: %s", chrome_path)
        return False, "chrome_missing"
    except Exception as exc:
        _logger.warning("Subprocess screenshot failed: %s", exc, exc_info=True)
        if process and process.poll() is None:
            process.kill()
        return False, "exception"
    finally:
        if tmp_html:
            try:
                os.unlink(tmp_html)
            except OSError:
                pass
        if tmp_profile:
            try:
                shutil.rmtree(tmp_profile, ignore_errors=True)
            except OSError:
                pass


# Status constants returned by render_email_screenshot
STATUS_SUCCESS = "success"
STATUS_PDF_FALLBACK = "pdf_fallback"
STATUS_TIMEOUT = "timeout"
STATUS_CHROME_MISSING = "chrome_missing"
STATUS_CHROME_ERROR = "chrome_error"
STATUS_CHROME_CRASH = "chrome_crash"
STATUS_NO_OUTPUT = "no_output_file"
STATUS_OUTPUT_DIR_NOT_WRITABLE = "output_dir_not_writable"
STATUS_EXCEPTION = "exception"


def render_email_screenshot(
    body_html: str,
    body_text: str,
    date_str: str,
    vendor: str,
    amount: float | None,
    attachments: list[dict] | None = None,
    output_dir: str = "exports/screenshots",
    index: int | None = None,
    chrome_path: str | None = None,
) -> tuple[str | None, str]:
    """Render an email to a PNG screenshot.

    Args:
        chrome_path: Pre-resolved Chrome binary path.  When provided the
            function skips detection (faster, deterministic).

    Returns (path_or_None, status_reason).
    """
    output_dir = os.path.abspath(output_dir)
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    filename = generate_filename(date_str, vendor, amount, index)
    output_path = os.path.join(output_dir, filename)
    _logger.info("Screenshot [%s]: starting render → %s", filename, output_path)

    # Check if body is minimal — try PDF fallback
    if is_minimal_body(body_text or body_html):
        _logger.info("Screenshot [%s]: minimal body — trying PDF fallback", filename)
        pdf_path = _try_pdf_fallback(attachments, output_path)
        if pdf_path:
            return pdf_path, STATUS_PDF_FALLBACK

    # Use provided Chrome path or detect
    if not chrome_path:
        chrome_path = _find_chrome()
    if not chrome_path:
        _logger.error("Screenshot [%s]: Chrome/Chromium not found", filename)
        return None, STATUS_CHROME_MISSING

    # Render via direct subprocess
    html_content = build_html_template(body_html, body_text)
    _logger.info("Screenshot [%s]: Chrome subprocess (timeout=%ds)", filename, _SCREENSHOT_TIMEOUT)

    ok, reason = _render_html_to_png_subprocess(html_content, output_path, chrome_path)

    if ok and os.path.isfile(output_path):
        _logger.info("Screenshot [%s]: success, cropping whitespace", filename)
        _autocrop_whitespace(output_path)
        return output_path, STATUS_SUCCESS

    _logger.warning("Screenshot [%s]: FAILED — reason=%s", filename, reason)
    return None, reason


def _try_pdf_fallback(
    attachments: list[dict] | None, output_path: str
) -> str | None:
    """Try to render the first page of a PDF attachment as PNG."""
    if not attachments:
        return None

    for att in attachments:
        content_type = att.get("content_type", "")
        data = att.get("data")
        if "pdf" not in content_type.lower() or not data:
            continue

        try:
            import fitz  # PyMuPDF

            doc = fitz.open(stream=data, filetype="pdf")
            page = doc.load_page(0)
            pix = page.get_pixmap(dpi=150)
            pix.save(output_path)
            doc.close()
            return output_path
        except Exception:
            _logger.warning("PDF fallback failed for attachment", exc_info=True)
            continue

    return None


_MAX_CONSECUTIVE_FAILURES = 10  # bail out only after this many in a row


def render_selected_to_zip(
    selected_rows: list[dict],
    output_dir: str = "exports",
    progress_callback=None,
) -> dict:
    """Render screenshots for selected invoices and package into a ZIP.

    Chrome path is resolved ONCE and reused for every item.

    Args:
        progress_callback: optional callable(current, total, message) for UI updates.

    Returns dict with keys:
        zip_path (str|None), total, succeeded, timed_out, chrome_missing,
        chrome_crash, chrome_error, pdf_fallback, exception, no_output_file,
        output_dir_not_writable, skipped_bail_out, failure_reasons (dict),
        bail_diagnosis (str), summary (str).
    """
    stats = {
        "zip_path": None,
        "total": 0,
        "succeeded": 0,
        "timed_out": 0,
        "chrome_missing": 0,
        "chrome_error": 0,
        "chrome_crash": 0,
        "no_output_file": 0,
        "output_dir_not_writable": 0,
        "pdf_fallback": 0,
        "exception": 0,
        "skipped_bail_out": 0,
        "failure_reasons": {},  # reason → count for diagnosis
        "bail_diagnosis": "",
        "summary": "",
    }

    if not selected_rows:
        stats["summary"] = "No rows selected."
        return stats

    total = len(selected_rows)
    stats["total"] = total
    _logger.info("ZIP export: starting %d screenshots", total)

    # ── Resolve Chrome ONCE for the entire run ─────────────────────────────
    chrome_path = _find_chrome()
    if chrome_path:
        _logger.info("ZIP export: Chrome resolved ONCE → %s", chrome_path)
    else:
        _logger.error("ZIP export: Chrome NOT FOUND — entire export will fail")
        stats["chrome_missing"] = total
        stats["summary"] = f"0/{total} exported — Chrome not found on this system."
        return stats

    output_dir = os.path.abspath(output_dir)
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    screenshots_dir = os.path.join(output_dir, "screenshots_tmp")
    Path(screenshots_dir).mkdir(parents=True, exist_ok=True)
    _logger.info("ZIP export: output_dir=%s, screenshots_dir=%s", output_dir, screenshots_dir)

    rendered_paths: list[str] = []
    consecutive_failures = 0
    consecutive_reasons: list[str] = []  # track reasons for diagnosis

    for idx, row in enumerate(selected_rows):
        vendor = row.get("description", "unknown")
        _logger.info("ZIP export: rendering %d/%d — %s", idx + 1, total, vendor)
        if progress_callback:
            progress_callback(idx, total, vendor)

        # Diagnose before bailing: do all consecutive failures share a root cause?
        if consecutive_failures >= _MAX_CONSECUTIVE_FAILURES:
            reason_counts: dict[str, int] = {}
            for r in consecutive_reasons[-_MAX_CONSECUTIVE_FAILURES:]:
                reason_counts[r] = reason_counts.get(r, 0) + 1
            stats["failure_reasons"] = reason_counts

            # Build diagnosis
            if len(reason_counts) == 1:
                sole_reason = list(reason_counts.keys())[0]
                diagnosis = f"All {_MAX_CONSECUTIVE_FAILURES} failures share the same cause: {sole_reason}"
            else:
                parts_diag = [f"{r}={c}" for r, c in sorted(reason_counts.items(), key=lambda x: -x[1])]
                diagnosis = f"Mixed failure causes: {', '.join(parts_diag)}"

            _logger.error(
                "ZIP export: %d consecutive failures — DIAGNOSIS: %s — bailing, skipping %d remaining",
                consecutive_failures, diagnosis, total - idx,
            )
            stats["bail_diagnosis"] = diagnosis
            stats["skipped_bail_out"] += total - idx
            break

        path, reason = render_email_screenshot(
            body_html=row.get("body_html", ""),
            body_text=row.get("body_text", ""),
            date_str=row.get("date", "unknown")[:10],
            vendor=vendor,
            amount=row.get("amount"),
            attachments=row.get("attachments"),
            output_dir=screenshots_dir,
            index=idx,
            chrome_path=chrome_path,
        )

        # Track stats by reason
        if reason in stats:
            stats[reason] += 1

        if path:
            rendered_paths.append(path)
            consecutive_failures = 0
            consecutive_reasons.clear()
            _logger.info("ZIP export: %d/%d OK %s [%s]", idx + 1, total, vendor, reason)
        else:
            consecutive_failures += 1
            consecutive_reasons.append(reason)
            _logger.warning(
                "ZIP export: %d/%d FAIL %s [reason=%s, consecutive=%d]",
                idx + 1, total, vendor, reason, consecutive_failures,
            )

    # ── Build summary ──────────────────────────────────────────────────────
    parts = [f"{stats['succeeded']}/{total} exported"]
    if stats["pdf_fallback"]:
        parts.append(f"{stats['pdf_fallback']} via PDF")
    if stats["timed_out"]:
        parts.append(f"{stats['timed_out']} timed out")
    if stats["chrome_crash"]:
        parts.append(f"{stats['chrome_crash']} Chrome crashed")
    if stats["chrome_error"]:
        parts.append(f"{stats['chrome_error']} Chrome errors")
    if stats["no_output_file"]:
        parts.append(f"{stats['no_output_file']} no output file")
    if stats["output_dir_not_writable"]:
        parts.append(f"{stats['output_dir_not_writable']} dir not writable")
    if stats["exception"]:
        parts.append(f"{stats['exception']} exceptions")
    if stats["skipped_bail_out"]:
        parts.append(f"{stats['skipped_bail_out']} skipped (bail-out)")
    if stats["bail_diagnosis"]:
        parts.append(f"Diagnosis: {stats['bail_diagnosis']}")
    stats["summary"] = " · ".join(parts)

    _logger.info("ZIP export SUMMARY: %s", stats["summary"])

    if not rendered_paths:
        return stats

    zip_filename = f"invoices_screenshots_{date.today()}.zip"
    zip_path = os.path.join(output_dir, zip_filename)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in rendered_paths:
            zf.write(p, os.path.basename(p))

    # Cleanup temp screenshots and directory
    for p in rendered_paths:
        try:
            os.remove(p)
        except OSError:
            pass
    try:
        os.rmdir(screenshots_dir)
    except OSError:
        pass

    _logger.info("ZIP export: complete — %s", zip_path)
    stats["zip_path"] = zip_path
    return stats
