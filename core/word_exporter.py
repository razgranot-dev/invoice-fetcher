"""
Export invoices to a professional Word document (.docx).

Supports:
- Bilingual headers (Hebrew / English)
- Per-invoice sections with full metadata
- Optional embedded screenshot images
- Summary statistics
"""

import os
import logging
from datetime import date, datetime
from pathlib import Path

from docx import Document
from docx.shared import Pt, Inches, Cm, RGBColor
from docx.enum.text import WD_PARAGRAPH_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT

logger = logging.getLogger(__name__)

TIER_LABELS = {
    "confirmed_invoice": "Confirmed Invoice",
    "likely_invoice": "Likely Invoice",
    "possible_financial_email": "Possible Financial",
    "not_invoice": "Not an Invoice",
}


def _add_styled_heading(doc: Document, text: str, level: int = 1):
    """Add a heading with consistent styling."""
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)
    return h


def _add_key_value(doc: Document, key: str, value: str):
    """Add a key: value paragraph."""
    p = doc.add_paragraph()
    run_key = p.add_run(f"{key}: ")
    run_key.bold = True
    run_key.font.size = Pt(10)
    run_key.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    run_val = p.add_run(value)
    run_val.font.size = Pt(10)
    return p


def _format_currency(amount: float | None, currency: str = "ILS") -> str:
    if amount is None:
        return "—"
    symbols = {"ILS": "\u20aa", "USD": "$", "EUR": "\u20ac", "GBP": "\u00a3"}
    sym = symbols.get(currency, currency + " ")
    return f"{sym}{amount:,.2f}"


def create_invoice_report(
    rows: list[dict],
    output_dir: str = "exports",
    filename: str | None = None,
    organization_name: str | None = None,
) -> str | None:
    """Create a professional .docx invoice report.

    Args:
        rows: list of invoice dicts. Supported keys:
            - id, company, subject, sender, amount, currency,
              date, classification_tier, has_attachment, scan_id, notes
            - Legacy keys also supported: description, date, amount, currency, notes
        output_dir: directory to save the file
        filename: optional filename override
        organization_name: org name for the header

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

    # -- Styles --
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10)

    # -- Title page --
    org_label = organization_name or "Invoice Report"
    title = _add_styled_heading(doc, org_label, level=1)
    title.alignment = WD_PARAGRAPH_ALIGNMENT.LEFT

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_PARAGRAPH_ALIGNMENT.LEFT
    run = subtitle.add_run(
        f"Invoice Export Report  \u2022  "
        f"Generated {datetime.now().strftime('%B %d, %Y at %H:%M')}  \u2022  "
        f"{len(rows)} invoice{'s' if len(rows) != 1 else ''}"
    )
    run.font.size = Pt(9)
    run.font.color.rgb = RGBColor(0x88, 0x88, 0x88)

    doc.add_paragraph("")  # spacer

    # -- Summary table --
    total_amount = sum(r.get("amount") or 0 for r in rows)
    tiers = {}
    for r in rows:
        t = r.get("classification_tier", "unknown")
        tiers[t] = tiers.get(t, 0) + 1

    _add_styled_heading(doc, "Summary", level=2)

    summary_table = doc.add_table(rows=1, cols=4)
    summary_table.style = "Light List Accent 1"
    summary_table.alignment = WD_TABLE_ALIGNMENT.LEFT

    headers = ["Total Invoices", "Total Amount", "Companies", "Top Tier"]
    for i, h in enumerate(headers):
        cell = summary_table.rows[0].cells[i]
        cell.text = h
        for p in cell.paragraphs:
            p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(9)

    companies = set(r.get("company") for r in rows if r.get("company"))
    top_tier = max(tiers, key=tiers.get) if tiers else "—"

    values = [
        str(len(rows)),
        _format_currency(total_amount, "ILS"),
        str(len(companies)),
        TIER_LABELS.get(top_tier, top_tier),
    ]
    data_row = summary_table.add_row()
    for i, v in enumerate(values):
        cell = data_row.cells[i]
        cell.text = v
        for p in cell.paragraphs:
            p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
            for run in p.runs:
                run.font.size = Pt(10)

    doc.add_paragraph("")  # spacer

    # -- Invoice detail table --
    _add_styled_heading(doc, "Invoice Details", level=2)

    detail_headers = ["#", "Company", "Subject", "Amount", "Date", "Tier", "Sender"]
    detail_table = doc.add_table(rows=1, cols=len(detail_headers))
    detail_table.style = "Light List Accent 1"
    detail_table.alignment = WD_TABLE_ALIGNMENT.LEFT

    header_row = detail_table.rows[0]
    for i, h in enumerate(detail_headers):
        cell = header_row.cells[i]
        cell.text = h
        for p in cell.paragraphs:
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(8)

    for idx, row in enumerate(rows, start=1):
        amount = row.get("amount")
        currency = row.get("currency", "ILS")
        tier = row.get("classification_tier", "")

        cells = detail_table.add_row().cells
        cell_values = [
            str(idx),
            str(row.get("company") or row.get("description") or "—"),
            str(row.get("subject") or "—"),
            _format_currency(amount, currency) if amount else "—",
            str(row.get("date") or "—"),
            TIER_LABELS.get(tier, tier or "—"),
            str(row.get("sender") or "—"),
        ]
        for i, val in enumerate(cell_values):
            cells[i].text = val
            for p in cells[i].paragraphs:
                for run in p.runs:
                    run.font.size = Pt(8)

    # -- Summary row --
    summary_cells = detail_table.add_row().cells
    summary_cells[0].text = ""
    summary_cells[1].text = ""
    summary_cells[2].text = "TOTAL"
    summary_cells[3].text = _format_currency(total_amount, "ILS")
    summary_cells[4].text = ""
    summary_cells[5].text = ""
    summary_cells[6].text = ""
    for cell in summary_cells:
        for p in cell.paragraphs:
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(9)

    # -- Individual invoice sections (for detailed view) --
    if len(rows) <= 50:  # Only add detail sections for reasonable counts
        doc.add_page_break()
        _add_styled_heading(doc, "Individual Invoice Details", level=2)

        for idx, row in enumerate(rows, start=1):
            _add_styled_heading(
                doc,
                f"Invoice #{idx} — {row.get('company') or row.get('sender') or 'Unknown'}",
                level=3,
            )

            _add_key_value(doc, "Subject", str(row.get("subject") or "—"))
            _add_key_value(doc, "Sender", str(row.get("sender") or "—"))

            amount = row.get("amount")
            currency = row.get("currency", "ILS")
            _add_key_value(doc, "Amount", _format_currency(amount, currency) if amount else "—")

            _add_key_value(doc, "Date", str(row.get("date") or "—"))

            tier = row.get("classification_tier", "")
            _add_key_value(doc, "Classification", TIER_LABELS.get(tier, tier or "—"))

            has_att = row.get("has_attachment", False)
            _add_key_value(doc, "Attachments", "Yes" if has_att else "No")

            if row.get("notes"):
                _add_key_value(doc, "Notes", str(row["notes"]))

            # Embed screenshot if available
            screenshot_path = row.get("screenshot_path")
            screenshot_error = row.get("screenshot_error")
            if screenshot_path and os.path.isfile(screenshot_path):
                try:
                    doc.add_paragraph("")
                    p = doc.add_paragraph()
                    p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
                    run = p.add_run()
                    run.add_picture(screenshot_path, width=Inches(6))
                except Exception as e:
                    supplier = row.get("company") or row.get("sender") or "Unknown"
                    logger.warning(
                        "Failed to embed screenshot for invoice #%d (%s): %s",
                        idx, supplier, e,
                    )
                    _add_key_value(doc, "Screenshot", f"(failed to embed: {e})")
            elif screenshot_error:
                _add_key_value(doc, "Screenshot", f"(not available: {screenshot_error})")
            elif screenshot_path:
                _add_key_value(doc, "Screenshot", "(file not found)")

            doc.add_paragraph("")  # spacer between invoices

    # -- Footer --
    doc.add_paragraph("")
    footer = doc.add_paragraph()
    footer.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
    run = footer.add_run(
        f"Generated by Invoice Fetcher  \u2022  {datetime.now().strftime('%Y-%m-%d %H:%M')}"
    )
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(0xAA, 0xAA, 0xAA)

    doc.save(filepath)
    return filepath
