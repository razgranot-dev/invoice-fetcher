"""
צילומי מסך של אימיילים — HTML→PNG via html2image, PDF fallback via PyMuPDF.
"""

import html
import logging
import os
import re
import shutil
import sys
import zipfile
from datetime import date
from pathlib import Path

_MINIMAL_BODY_THRESHOLD = 100
_MINIMAL_BODY_PATTERNS = re.compile(
    r"(?:see\s+attached|ראה?\s+מצורף|קובץ\s+מצורף|attached\s+(?:invoice|file|document))",
    re.IGNORECASE,
)
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*]')


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
    """Generate a clean filename for a screenshot PNG."""
    safe_vendor = _UNSAFE_CHARS.sub("", vendor)[:50].strip()
    suffix = f"_{index}" if index is not None else ""
    if amount is not None:
        name = f"{date_str}_{safe_vendor}_{amount:.2f}{suffix}.png"
    else:
        name = f"{date_str}_{safe_vendor}{suffix}.png"
    return name


_logger = logging.getLogger(__name__)

# ── Chrome path detection ──────────────────────────────────────────────────
_CHROME_CANDIDATES_WIN = [
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
        if path and os.path.isfile(path):
            return path
    # Fallback: check PATH
    found = shutil.which("chrome") or shutil.which("google-chrome") or shutil.which("chromium")
    return found


def render_email_screenshot(
    body_html: str,
    body_text: str,
    date_str: str,
    vendor: str,
    amount: float | None,
    attachments: list[dict] | None = None,
    output_dir: str = "exports/screenshots",
    index: int | None = None,
) -> str | None:
    """Render an email to a PNG screenshot.

    Smart fallback: if body is minimal, tries to render first PDF attachment instead.

    Returns path to the PNG, or None on failure.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    filename = generate_filename(date_str, vendor, amount, index)
    output_path = os.path.join(output_dir, filename)

    # Check if body is minimal — try PDF fallback
    if is_minimal_body(body_text or body_html):
        pdf_path = _try_pdf_fallback(attachments, output_path)
        if pdf_path:
            return pdf_path

    # Render HTML to PNG via html2image
    try:
        from html2image import Html2Image

        chrome_path = _find_chrome()
        hti_kwargs = {"output_path": output_dir, "size": (800, 600)}
        if chrome_path:
            hti_kwargs["browser_executable"] = chrome_path
        hti = Html2Image(**hti_kwargs)
        html_content = build_html_template(body_html, body_text)
        hti.screenshot(html_str=html_content, save_as=filename)

        if os.path.isfile(output_path):
            return output_path
    except Exception:
        _logger.warning("html2image screenshot failed for %s", filename, exc_info=True)

    return None


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


def render_selected_to_zip(
    selected_rows: list[dict],
    output_dir: str = "exports",
) -> str | None:
    """Render screenshots for selected invoices and package into a ZIP.

    Each row dict must have: body_html, body_text, date, description (vendor),
    amount, attachments.

    Returns path to the ZIP file, or None if no screenshots were rendered.
    """
    if not selected_rows:
        return None

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    screenshots_dir = os.path.join(output_dir, "screenshots_tmp")
    Path(screenshots_dir).mkdir(parents=True, exist_ok=True)

    rendered_paths: list[str] = []

    for idx, row in enumerate(selected_rows):
        path = render_email_screenshot(
            body_html=row.get("body_html", ""),
            body_text=row.get("body_text", ""),
            date_str=row.get("date", "unknown")[:10],
            vendor=row.get("description", "unknown"),
            amount=row.get("amount"),
            attachments=row.get("attachments"),
            output_dir=screenshots_dir,
            index=idx,
        )
        if path:
            rendered_paths.append(path)

    if not rendered_paths:
        return None

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

    return zip_path
