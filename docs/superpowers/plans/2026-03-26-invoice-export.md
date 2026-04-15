# Invoice Export Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add invoice export capabilities — ZIP of email screenshots, Word table with extracted amounts, and a selection-based export workbench UI.

**Architecture:** Two-phase flow. Phase 1 (existing scan) populates results in session state. Phase 2 (new Export Workbench) enriches results with auto-extracted amounts, renders an editable table with checkbox selection, and provides 3 export actions (ZIP screenshots, Word table, both).

**Tech Stack:** Streamlit (existing), python-docx, html2image, PyMuPDF, zipfile (stdlib)

**Spec:** `docs/superpowers/specs/2026-03-26-invoice-export-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `core/amount_extractor.py` | Create | Regex-based amount + description extraction from email text/HTML |
| `core/screenshot_renderer.py` | Create | HTML→PNG via html2image, PDF fallback via PyMuPDF, ZIP packaging |
| `core/word_exporter.py` | Create | .docx table generation with summary row |
| `dashboard/export_workbench.py` | Create | Export UI: enriched editable table, selection, export bar, progress |
| `app.py` | Modify | Wire export workbench into the main app flow |
| `requirements.txt` | Modify | Add python-docx, html2image, PyMuPDF |
| `tests/test_amount_extractor.py` | Create | Unit tests for amount extraction |
| `tests/test_word_exporter.py` | Create | Unit tests for Word document generation |
| `tests/test_screenshot_renderer.py` | Create | Unit tests for screenshot logic (template wrapping, filename generation) |

---

### Task 1: Add New Dependencies

**Files:**
- Modify: `requirements.txt`

- [ ] **Step 1: Add new packages to requirements.txt**

Append these lines to `requirements.txt`:
```
python-docx>=1.1.0
html2image>=2.0.4
PyMuPDF>=1.24.0
```

- [ ] **Step 2: Install dependencies**

Run: `pip install python-docx html2image PyMuPDF`
Expected: All packages install successfully

- [ ] **Step 3: Verify imports**

Run: `python -c "import docx; from html2image import Html2Image; import fitz; print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add requirements.txt
git commit -m "feat: add python-docx, html2image, PyMuPDF dependencies for export feature"
```

---

### Task 2: Amount Extractor Module

**Files:**
- Create: `core/amount_extractor.py`
- Create: `tests/test_amount_extractor.py`

- [ ] **Step 1: Write failing tests for amount extraction**

Create `tests/test_amount_extractor.py`:

```python
"""Tests for core.amount_extractor."""
import pytest
from core.amount_extractor import extract_amount, extract_description


class TestExtractAmount:
    def test_shekel_symbol_before(self):
        result = extract_amount("הסכום לתשלום: ₪89.00")
        assert result["amount"] == 89.00
        assert result["currency"] == "₪"
        assert result["confidence"] == "high"

    def test_shekel_symbol_after(self):
        result = extract_amount("סה\"כ 142.50 ₪ כולל מע\"מ")
        assert result["amount"] == 142.50
        assert result["confidence"] == "high"

    def test_shekel_text_shekel(self):
        result = extract_amount("חיוב של 310.00 ש\"ח")
        assert result["amount"] == 310.00
        assert result["confidence"] == "high"

    def test_english_dollar(self):
        result = extract_amount("Total: $67.30")
        assert result["amount"] == 67.30
        assert result["currency"] == "$"
        assert result["confidence"] == "high"

    def test_labeled_amount_hebrew(self):
        result = extract_amount("סכום: 250.00")
        assert result["amount"] == 250.00
        assert result["confidence"] == "medium"

    def test_takes_largest_amount(self):
        text = "פריט א: ₪50.00\nפריט ב: ₪30.00\nסה\"כ: ₪80.00"
        result = extract_amount(text)
        assert result["amount"] == 80.00

    def test_no_amount_found(self):
        result = extract_amount("הודעה ללא סכום כספי")
        assert result["amount"] is None
        assert result["confidence"] == "low"

    def test_empty_string(self):
        result = extract_amount("")
        assert result["amount"] is None
        assert result["confidence"] == "low"

    def test_integer_amount(self):
        result = extract_amount("₪100")
        assert result["amount"] == 100.0

    def test_comma_thousands(self):
        result = extract_amount("₪1,250.00")
        assert result["amount"] == 1250.00


class TestExtractDescription:
    def test_cleans_re_prefix(self):
        assert extract_description("Re: חשבונית חודשית", "") == "חשבונית חודשית"

    def test_cleans_fwd_prefix(self):
        assert extract_description("Fwd: Invoice #123", "") == "Invoice #123"

    def test_cleans_hebrew_prefix(self):
        assert extract_description("השב: חשבונית", "") == "חשבונית"

    def test_fallback_to_sender(self):
        assert extract_description("", "Hostinger <billing@hostinger.com>") == "Hostinger"

    def test_sender_name_extraction(self):
        assert extract_description("", "John Doe <john@example.com>") == "John Doe"

    def test_sender_email_only(self):
        assert extract_description("", "billing@hostinger.com") == "billing@hostinger.com"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_amount_extractor.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.amount_extractor'`

- [ ] **Step 3: Implement amount_extractor.py**

Create `core/amount_extractor.py`:

```python
"""
חילוץ סכומים ותיאורים מתוכן אימייל — regex-based עם רמות ביטחון.
"""

import re
from typing import Any


# ── Amount patterns (ordered by specificity) ───────────────────────────────
_PATTERNS: list[tuple[str, str, str]] = [
    # ₪XX.XX or ₪XX,XXX.XX
    (r"₪\s?([\d,]+\.?\d*)", "₪", "high"),
    # XX.XX ₪
    (r"([\d,]+\.?\d*)\s?₪", "₪", "high"),
    # XX.XX ש"ח / שקל
    (r'([\d,]+\.?\d*)\s?(?:ש"ח|שקל)', "₪", "high"),
    # $XX.XX or XX.XX$
    (r"\$\s?([\d,]+\.?\d*)", "$", "high"),
    (r"([\d,]+\.?\d*)\s?\$", "$", "high"),
    # Labeled: סכום/סה"כ/לתשלום/Total/Amount Due: XX.XX
    (r'(?:סכום|סה"כ|לתשלום|total|amount\s*due|sum)\s*:?\s*([\d,]+\.?\d*)', "₪", "medium"),
]

# ── Subject cleaning patterns ──────────────────────────────────────────────
_SUBJECT_PREFIXES = re.compile(
    r"^(?:Re|Fwd|FW|השב|העבר)\s*:\s*", re.IGNORECASE
)


def _parse_number(raw: str) -> float:
    """Parse a number string, removing commas."""
    return float(raw.replace(",", ""))


def extract_amount(text: str) -> dict[str, Any]:
    """Extract the primary monetary amount from email text.

    Returns dict with: amount (float|None), currency (str), confidence (str),
    raw_match (str).
    """
    if not text:
        return {"amount": None, "currency": "₪", "confidence": "low", "raw_match": ""}

    found: list[tuple[float, str, str, str]] = []  # (value, currency, confidence, raw)

    for pattern, currency, confidence in _PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            raw_num = match.group(1) if match.lastindex else match.group(0)
            try:
                value = _parse_number(raw_num)
                if value > 0:
                    found.append((value, currency, confidence, match.group(0)))
            except (ValueError, IndexError):
                continue

    if not found:
        return {"amount": None, "currency": "₪", "confidence": "low", "raw_match": ""}

    # Take the largest amount (likely the total)
    best = max(found, key=lambda x: x[0])
    return {
        "amount": best[0],
        "currency": best[1],
        "confidence": best[2],
        "raw_match": best[3],
    }


def extract_description(subject: str, sender: str) -> str:
    """Extract a clean description from subject line, fallback to sender name.

    Removes Re:/Fwd:/השב:/העבר: prefixes. Falls back to sender display name
    if subject is empty.
    """
    cleaned = _SUBJECT_PREFIXES.sub("", subject).strip()
    if cleaned:
        return cleaned

    if not sender:
        return ""

    # Extract display name from "Name <email>" format
    name_match = re.match(r"^(.+?)\s*<", sender)
    if name_match:
        return name_match.group(1).strip().strip('"')

    return sender.strip()


def enrich_results(results: list[dict]) -> list[dict]:
    """Enrich scan results with extracted amounts and descriptions.

    Adds to each result dict: amount, currency, description, confidence, raw_match.
    Does NOT mutate the originals — returns new dicts.
    """
    enriched = []
    for r in results:
        text = r.get("body_text", "") or r.get("body_html", "") or ""
        amount_info = extract_amount(text)
        description = extract_description(r.get("subject", ""), r.get("sender", ""))

        enriched.append({
            **r,
            "amount": amount_info["amount"],
            "currency": amount_info["currency"],
            "description": description,
            "confidence": amount_info["confidence"],
            "raw_match": amount_info["raw_match"],
        })
    return enriched
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_amount_extractor.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/amount_extractor.py tests/test_amount_extractor.py
git commit -m "feat: add amount extractor with regex patterns and confidence levels"
```

---

### Task 3: Word Exporter Module

**Files:**
- Create: `core/word_exporter.py`
- Create: `tests/test_word_exporter.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_word_exporter.py`:

```python
"""Tests for core.word_exporter."""
import os
import pytest
from pathlib import Path
from core.word_exporter import create_invoice_report


@pytest.fixture
def sample_rows():
    return [
        {"date": "2024-01-15", "description": "Hostinger VPS", "amount": 89.00, "currency": "₪", "notes": "חודשי"},
        {"date": "2024-01-22", "description": "Google Cloud", "amount": 142.50, "currency": "₪", "notes": ""},
        {"date": "2024-02-03", "description": "AWS Services", "amount": 67.30, "currency": "₪", "notes": "ניסיון"},
    ]


@pytest.fixture
def tmp_exports(tmp_path):
    return tmp_path / "exports"


class TestCreateInvoiceReport:
    def test_creates_docx_file(self, sample_rows, tmp_exports):
        path = create_invoice_report(sample_rows, output_dir=str(tmp_exports))
        assert path.endswith(".docx")
        assert os.path.isfile(path)

    def test_file_not_empty(self, sample_rows, tmp_exports):
        path = create_invoice_report(sample_rows, output_dir=str(tmp_exports))
        assert os.path.getsize(path) > 0

    def test_contains_correct_row_count(self, sample_rows, tmp_exports):
        from docx import Document
        path = create_invoice_report(sample_rows, output_dir=str(tmp_exports))
        doc = Document(path)
        table = doc.tables[0]
        # header + 3 data rows + 1 summary = 5
        assert len(table.rows) == 5

    def test_summary_row_total(self, sample_rows, tmp_exports):
        from docx import Document
        path = create_invoice_report(sample_rows, output_dir=str(tmp_exports))
        doc = Document(path)
        table = doc.tables[0]
        last_row = table.rows[-1]
        total_cell = last_row.cells[3].text
        assert "298.80" in total_cell

    def test_empty_rows_returns_none(self, tmp_exports):
        result = create_invoice_report([], output_dir=str(tmp_exports))
        assert result is None

    def test_creates_output_dir(self, sample_rows, tmp_path):
        new_dir = str(tmp_path / "new_dir" / "exports")
        path = create_invoice_report(sample_rows, output_dir=new_dir)
        assert os.path.isfile(path)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_word_exporter.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement word_exporter.py**

Create `core/word_exporter.py`:

```python
"""
ייצוא טבלת חשבוניות לקובץ Word (.docx) עם שורת סיכום.
"""

import os
from datetime import date
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT


def create_invoice_report(
    rows: list[dict],
    output_dir: str = "exports",
    filename: str | None = None,
) -> str | None:
    """Create a formatted .docx invoice report with a summary row.

    Args:
        rows: list of dicts with keys: date, description, amount, currency, notes
        output_dir: directory to save the file
        filename: optional filename override (default: invoices_report_YYYY-MM-DD.docx)

    Returns:
        Path to created .docx file, or None if rows is empty.
    """
    if not rows:
        return None

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    if filename is None:
        filename = f"invoices_report_{date.today()}.docx"
    filepath = os.path.join(output_dir, filename)

    doc = Document()

    # Title
    title = doc.add_heading("דוח חשבוניות", level=1)
    title.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT

    subtitle = doc.add_paragraph(f"תאריך הפקה: {date.today().strftime('%d/%m/%Y')}")
    subtitle.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT

    # Table
    headers = ["#", "תאריך", "שולח / תיאור", "סכום (₪)", "הערות"]
    table = doc.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    # Header row
    header_row = table.rows[0]
    for i, h in enumerate(headers):
        cell = header_row.cells[i]
        cell.text = h
        para = cell.paragraphs[0]
        para.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
        run = para.runs[0]
        run.bold = True
        run.font.size = Pt(10)

    # Data rows
    total = 0.0
    for idx, row in enumerate(rows, start=1):
        amount = row.get("amount") or 0.0
        currency = row.get("currency", "₪")
        total += amount

        cells = table.add_row().cells
        cells[0].text = str(idx)
        cells[1].text = str(row.get("date", ""))
        cells[2].text = str(row.get("description", ""))
        cells[3].text = f"{currency}{amount:,.2f}" if amount else ""
        cells[4].text = str(row.get("notes", ""))

        # Right-align text
        for cell in cells:
            cell.paragraphs[0].alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT
        # Center the index
        cells[0].paragraphs[0].alignment = WD_PARAGRAPH_ALIGNMENT.CENTER

    # Summary row
    summary = table.add_row().cells
    summary[0].text = ""
    summary[1].text = ""
    summary[2].text = "סה\"כ"
    summary[3].text = f"₪{total:,.2f}"
    summary[4].text = ""

    for cell in summary:
        para = cell.paragraphs[0]
        para.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT
        if para.runs:
            para.runs[0].bold = True

    # Bold the summary text
    for i in [2, 3]:
        run = summary[i].paragraphs[0].runs[0]
        run.bold = True
        run.font.size = Pt(10)

    doc.save(filepath)
    return filepath
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_word_exporter.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/word_exporter.py tests/test_word_exporter.py
git commit -m "feat: add Word exporter with formatted invoice table and summary row"
```

---

### Task 4: Screenshot Renderer Module

**Files:**
- Create: `core/screenshot_renderer.py`
- Create: `tests/test_screenshot_renderer.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_screenshot_renderer.py`:

```python
"""Tests for core.screenshot_renderer."""
import pytest
from core.screenshot_renderer import (
    build_html_template,
    generate_filename,
    is_minimal_body,
)


class TestBuildHtmlTemplate:
    def test_wraps_html_body(self):
        result = build_html_template("<p>Hello</p>")
        assert "<p>Hello</p>" in result
        assert "<!DOCTYPE html>" in result
        assert "direction: rtl" in result

    def test_includes_utf8_meta(self):
        result = build_html_template("<p>שלום</p>")
        assert "utf-8" in result.lower()

    def test_plain_text_wrapped_in_pre(self):
        result = build_html_template("", plain_text="Plain content here")
        assert "Plain content here" in result


class TestGenerateFilename:
    def test_basic_filename(self):
        name = generate_filename("2024-01-15", "Hostinger", 89.0)
        assert name == "2024-01-15_Hostinger_89.00.png"

    def test_sanitizes_special_chars(self):
        name = generate_filename("2024-01-15", "Google/Cloud <billing>", 142.5)
        assert "/" not in name
        assert "<" not in name
        assert ">" not in name

    def test_no_amount(self):
        name = generate_filename("2024-01-15", "Vendor", None)
        assert name == "2024-01-15_Vendor.png"

    def test_truncates_long_vendor(self):
        name = generate_filename("2024-01-15", "A" * 100, 50.0)
        assert len(name) <= 120


class TestIsMinimalBody:
    def test_short_text_is_minimal(self):
        assert is_minimal_body("see attached invoice") is True

    def test_long_text_is_not_minimal(self):
        assert is_minimal_body("x" * 200) is False

    def test_empty_is_minimal(self):
        assert is_minimal_body("") is True

    def test_see_attached_pattern(self):
        assert is_minimal_body("Please find the attached invoice for your records.") is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_screenshot_renderer.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement screenshot_renderer.py**

Create `core/screenshot_renderer.py`:

```python
"""
צילומי מסך של אימיילים — HTML→PNG via html2image, PDF fallback via PyMuPDF.
"""

import os
import re
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
    content = body_html if body_html else f"<pre style='white-space:pre-wrap;'>{plain_text}</pre>"
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


def generate_filename(date_str: str, vendor: str, amount: float | None) -> str:
    """Generate a clean filename for a screenshot PNG."""
    safe_vendor = _UNSAFE_CHARS.sub("", vendor)[:50].strip()
    if amount is not None:
        name = f"{date_str}_{safe_vendor}_{amount:.2f}.png"
    else:
        name = f"{date_str}_{safe_vendor}.png"
    return name


def render_email_screenshot(
    body_html: str,
    body_text: str,
    date_str: str,
    vendor: str,
    amount: float | None,
    attachments: list[dict] | None = None,
    output_dir: str = "exports/screenshots",
) -> str | None:
    """Render an email to a PNG screenshot.

    Smart fallback: if body is minimal, tries to render first PDF attachment instead.

    Returns path to the PNG, or None on failure.
    """
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    filename = generate_filename(date_str, vendor, amount)
    output_path = os.path.join(output_dir, filename)

    # Check if body is minimal — try PDF fallback
    if is_minimal_body(body_text or body_html):
        pdf_path = _try_pdf_fallback(attachments, output_path)
        if pdf_path:
            return pdf_path

    # Render HTML to PNG via html2image
    try:
        from html2image import Html2Image

        hti = Html2Image(output_path=output_dir, size=(800, 600))
        html = build_html_template(body_html, body_text)
        hti.screenshot(html_str=html, save_as=filename)

        if os.path.isfile(output_path):
            return output_path
    except Exception:
        pass

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

    for row in selected_rows:
        path = render_email_screenshot(
            body_html=row.get("body_html", ""),
            body_text=row.get("body_text", ""),
            date_str=row.get("date", "unknown")[:10],
            vendor=row.get("description", "unknown"),
            amount=row.get("amount"),
            attachments=row.get("attachments"),
            output_dir=screenshots_dir,
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

    # Cleanup temp screenshots
    for p in rendered_paths:
        try:
            os.remove(p)
        except OSError:
            pass

    return zip_path
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_screenshot_renderer.py -v`
Expected: All tests PASS (only testing pure functions — template, filename, minimal body check)

- [ ] **Step 5: Commit**

```bash
git add core/screenshot_renderer.py tests/test_screenshot_renderer.py
git commit -m "feat: add screenshot renderer with HTML-to-PNG and PDF fallback"
```

---

### Task 5: Export Workbench UI

**Files:**
- Create: `dashboard/export_workbench.py`

- [ ] **Step 1: Create export_workbench.py**

Create `dashboard/export_workbench.py`:

```python
"""
Export Workbench — editable table with checkbox selection and export controls.
Appears after scan results are available.
"""

import streamlit as st
import pandas as pd
from datetime import datetime

from core.amount_extractor import enrich_results
from core.screenshot_renderer import render_selected_to_zip
from core.word_exporter import create_invoice_report


def _init_export_state():
    """Initialize export-related session state keys."""
    if "enriched_results" not in st.session_state:
        st.session_state["enriched_results"] = []
    if "export_df" not in st.session_state:
        st.session_state["export_df"] = None


def _build_dataframe(enriched: list[dict]) -> pd.DataFrame:
    """Build the editable DataFrame from enriched results."""
    rows = []
    for r in enriched:
        rows.append({
            "נבחר": True,
            "תאריך": r.get("date", "")[:16] if r.get("date") else "",
            "שולח / תיאור": r.get("description", ""),
            "סכום": r.get("amount"),
            "מטבע": r.get("currency", "₪"),
            "סטטוס": "📎 קובץ מצורף" if r.get("saved_path") or r.get("attachments") else "ללא קובץ",
            "הערות": r.get("notes", ""),
            "ביטחון": r.get("confidence", "low"),
            # Hidden data for export
            "_uid": r.get("uid", ""),
        })
    return pd.DataFrame(rows)


def _get_selected_rows(edited_df: pd.DataFrame, enriched: list[dict]) -> list[dict]:
    """Match selected rows back to enriched results for export."""
    selected = []
    for idx, row in edited_df.iterrows():
        if row.get("נבחר", False) and idx < len(enriched):
            # Merge edited fields back into the enriched dict
            result = {**enriched[idx]}
            result["description"] = row.get("שולח / תיאור", result.get("description", ""))
            result["amount"] = row.get("סכום", result.get("amount"))
            result["notes"] = row.get("הערות", result.get("notes", ""))
            selected.append(result)
    return selected


def render_export_workbench(results: list[dict]):
    """Render the full export workbench UI section."""
    _init_export_state()

    # Enrich results with amounts (only once per scan)
    if not st.session_state["enriched_results"] or len(st.session_state["enriched_results"]) != len(results):
        st.session_state["enriched_results"] = enrich_results(results)

    enriched = st.session_state["enriched_results"]

    # Section header
    st.markdown('<div class="section-title">ייצוא חשבוניות</div>', unsafe_allow_html=True)

    # Select All / Deselect All controls
    col_sel, col_desel, col_count, col_spacer = st.columns([1, 1, 2, 4])
    with col_sel:
        select_all = st.button("בחר הכל", key="exp_select_all", use_container_width=True)
    with col_desel:
        deselect_all = st.button("בטל בחירה", key="exp_deselect_all", use_container_width=True)

    # Build or update DataFrame
    df = _build_dataframe(enriched)

    if select_all:
        df["נבחר"] = True
    elif deselect_all:
        df["נבחר"] = False

    # Confidence color hint in the amount column
    column_config = {
        "נבחר": st.column_config.CheckboxColumn("נבחר", default=True, width="small"),
        "תאריך": st.column_config.TextColumn("תאריך", width="medium", disabled=True),
        "שולח / תיאור": st.column_config.TextColumn("שולח / תיאור", width="large"),
        "סכום": st.column_config.NumberColumn("סכום (₪)", format="%.2f", width="small"),
        "מטבע": st.column_config.TextColumn("מטבע", width="small", disabled=True),
        "סטטוס": st.column_config.TextColumn("סטטוס", width="medium", disabled=True),
        "הערות": st.column_config.TextColumn("הערות", width="medium"),
        "ביטחון": st.column_config.TextColumn("ביטחון", width="small", disabled=True),
        "_uid": None,  # Hide internal ID column
    }

    edited_df = st.data_editor(
        df,
        column_config=column_config,
        use_container_width=True,
        hide_index=True,
        num_rows="fixed",
        key="export_table_editor",
    )

    # Compute selection stats
    selected_mask = edited_df["נבחר"] == True
    selected_count = selected_mask.sum()
    selected_amounts = edited_df.loc[selected_mask, "סכום"].dropna()
    total_amount = selected_amounts.sum()

    # ── Export Bar ──────────────────────────────────────────────────────────
    st.markdown(
        f'<div style="'
        f'margin-top:16px; padding:14px 24px; background:#141722; '
        f'border:1px solid rgba(255,255,255,0.06); border-radius:12px; '
        f'display:flex; align-items:center; justify-content:space-between; '
        f'direction:rtl; flex-wrap:wrap; gap:10px;'
        f'">'
        f'<div style="display:flex; align-items:center; gap:8px;">'
        f'<span style="background:rgba(212,168,67,0.12); color:#D4A843; font-weight:700; '
        f'padding:4px 10px; border-radius:6px; font-size:14px;">{selected_count}</span>'
        f'<span style="color:#8B8D97; font-size:13px;">חשבוניות נבחרו</span>'
        f'<span style="color:#4E5260; margin:0 4px;">·</span>'
        f'<span style="color:#44C4A1; font-size:13px; font-weight:600;">₪{total_amount:,.2f} סה"כ</span>'
        f'</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    # Export buttons
    col_zip, col_word, col_both = st.columns(3)

    with col_zip:
        export_zip = st.button("📁 צילומי מסך (ZIP)", key="exp_zip", use_container_width=True,
                               disabled=selected_count == 0)
    with col_word:
        export_word = st.button("📄 טבלת Word", key="exp_word", use_container_width=True,
                                disabled=selected_count == 0)
    with col_both:
        export_both = st.button("ייצוא הכל", key="exp_both", use_container_width=True,
                                disabled=selected_count == 0, type="primary")

    # Handle exports
    selected_rows = _get_selected_rows(edited_df, enriched)

    if export_zip or export_both:
        _do_zip_export(selected_rows)

    if export_word or export_both:
        _do_word_export(selected_rows)


def _do_zip_export(selected_rows: list[dict]):
    """Run the ZIP screenshot export with progress feedback."""
    with st.status("מייצר צילומי מסך...", expanded=True) as status:
        progress = st.progress(0, text="מאתחל...")

        progress.progress(20, text="מעבד אימיילים...")
        zip_path = render_selected_to_zip(selected_rows)

        progress.progress(100, text="הושלם!")
        status.update(label="צילומי מסך מוכנים!", state="complete", expanded=False)

    if zip_path:
        with open(zip_path, "rb") as f:
            st.download_button(
                label="📁 הורד ZIP",
                data=f.read(),
                file_name=zip_path.split(os.sep)[-1] if os.sep in zip_path else zip_path.split("/")[-1],
                mime="application/zip",
                use_container_width=True,
            )
    else:
        st.warning("לא הצליח לייצר צילומי מסך. ודא ש-Chrome מותקן במחשב.")


def _do_word_export(selected_rows: list[dict]):
    """Run the Word table export with progress feedback."""
    with st.status("מייצר דוח Word...", expanded=True) as status:
        progress = st.progress(0, text="מאתחל...")

        progress.progress(50, text="בונה טבלה...")
        word_path = create_invoice_report(selected_rows)

        progress.progress(100, text="הושלם!")
        status.update(label="דוח Word מוכן!", state="complete", expanded=False)

    if word_path:
        with open(word_path, "rb") as f:
            st.download_button(
                label="📄 הורד Word",
                data=f.read(),
                file_name=word_path.split(os.sep)[-1] if os.sep in word_path else word_path.split("/")[-1],
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True,
            )
    else:
        st.warning("לא הצליח לייצר דוח Word.")
```

Note: `_do_zip_export` uses `os` — add `import os` at the top of the file alongside the other imports.

- [ ] **Step 2: Verify module imports**

Run: `python -c "from dashboard.export_workbench import render_export_workbench; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add dashboard/export_workbench.py
git commit -m "feat: add export workbench UI with editable table and export controls"
```

---

### Task 6: Wire Export Workbench into App

**Files:**
- Modify: `app.py:43-50` (imports) and `app.py:103-127` (results display section)

- [ ] **Step 1: Add import to app.py**

Add this import at the top of `app.py` alongside the other dashboard imports (after line 49):

```python
from dashboard.export_workbench import render_export_workbench
```

- [ ] **Step 2: Add export workbench section after results**

In `app.py`, in the `if st.session_state.results:` block (around line 103), add the export workbench call after `render_analytics`:

After:
```python
    render_analytics(st.session_state.results)
```

Add:
```python
    st.markdown("---")
    render_export_workbench(st.session_state.results)
```

- [ ] **Step 3: Verify app loads without errors**

Run: `python -c "import app; print('OK')"` — this won't fully run Streamlit but verifies imports.
Better: `streamlit run app.py` and verify the app loads in the browser.

- [ ] **Step 4: Commit**

```bash
git add app.py
git commit -m "feat: wire export workbench into main app flow"
```

---

### Task 7: Create tests/__init__.py and Run Full Test Suite

**Files:**
- Create: `tests/__init__.py`

- [ ] **Step 1: Create tests init**

Create empty `tests/__init__.py` to make tests a proper package.

- [ ] **Step 2: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/__init__.py
git commit -m "test: add tests package init"
```

---

### Task 8: Manual Integration Test

- [ ] **Step 1: Start the app**

Run: `streamlit run app.py`

- [ ] **Step 2: Test the full flow**

1. Connect to Gmail (existing OAuth flow)
2. Run a scan with default parameters
3. Verify the Export Workbench section appears below Analytics
4. Edit some amounts in the table
5. Select/deselect invoices via checkboxes
6. Test "Select All" / "Deselect All" buttons
7. Verify selected count and total update
8. Click "📄 טבלת Word" — verify .docx downloads
9. Click "📁 צילומי מסך (ZIP)" — verify .zip downloads (requires Chrome)
10. Click "ייצוא הכל" — verify both download

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete invoice export feature — screenshots, Word table, selection UI"
```
