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
    "confirmed_invoice": "\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05de\u05ea\u05ea",      # חשבונית מאומתת
    "likely_invoice": "\u05db\u05e0\u05e8\u05d0\u05d4 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea",                # כנראה חשבונית
    "possible_financial_email": "\u05de\u05d9\u05d9\u05dc \u05e4\u05d9\u05e0\u05e0\u05e1\u05d9 \u05dc\u05d1\u05d3\u05d9\u05e7\u05d4",  # מייל פיננסי לבדיקה
    "not_invoice": "\u05dc\u05d0 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea",                                      # לא חשבונית
}


def _set_rtl(paragraph):
    """Set paragraph direction to RTL for Hebrew content."""
    from docx.oxml.ns import qn
    pPr = paragraph._p.get_or_add_pPr()
    bidi = pPr.makeelement(qn("w:bidi"), {})
    pPr.append(bidi)


def _set_cell_rtl(cell):
    """Set all paragraphs in a table cell to RTL."""
    for p in cell.paragraphs:
        _set_rtl(p)


def _add_styled_heading(doc: Document, text: str, level: int = 1):
    """Add a heading with consistent styling."""
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x2E)
    _set_rtl(h)
    h.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT
    return h


def _add_key_value(doc: Document, key: str, value: str):
    """Add a key: value paragraph with RTL support."""
    p = doc.add_paragraph()
    _set_rtl(p)
    p.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT
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
    org_label = organization_name or "\u05d3\u05d5\u05d7 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea"  # דוח חשבוניות
    title = _add_styled_heading(doc, org_label, level=1)

    subtitle = doc.add_paragraph()
    _set_rtl(subtitle)
    subtitle.alignment = WD_PARAGRAPH_ALIGNMENT.RIGHT
    run = subtitle.add_run(
        f"\u05d3\u05d5\u05d7 \u05d9\u05d9\u05e6\u05d5\u05d0 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea  \u2022  "  # דוח ייצוא חשבוניות
        f"\u05d4\u05d5\u05e4\u05e7 {datetime.now().strftime('%d/%m/%Y %H:%M')}  \u2022  "  # הופק
        f"{len(rows)} \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea"  # חשבוניות
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

    _add_styled_heading(doc, "\u05e1\u05d9\u05db\u05d5\u05dd", level=2)  # סיכום

    summary_table = doc.add_table(rows=1, cols=4)
    summary_table.style = "Light List Accent 1"
    summary_table.alignment = WD_TABLE_ALIGNMENT.LEFT

    headers = [
        "\u05e1\u05d4\"\u05db \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea",  # סה"כ חשבוניות
        "\u05e1\u05d4\"\u05db \u05e1\u05db\u05d5\u05dd",                              # סה"כ סכום
        "\u05e1\u05e4\u05e7\u05d9\u05dd",                                              # ספקים
        "\u05e1\u05d9\u05d5\u05d5\u05d2 \u05de\u05d5\u05d1\u05d9\u05dc",              # סיווג מוביל
    ]
    for i, h in enumerate(headers):
        cell = summary_table.rows[0].cells[i]
        cell.text = h
        _set_cell_rtl(cell)
        for p in cell.paragraphs:
            p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(9)

    companies = set(r.get("company") for r in rows if r.get("company"))
    # Exclude "not_invoice" from the top-tier summary — it's noise
    relevant_tiers = {k: v for k, v in tiers.items() if k != "not_invoice"}
    top_tier = max(relevant_tiers, key=relevant_tiers.get) if relevant_tiers else (max(tiers, key=tiers.get) if tiers else "\u2014")

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
        _set_cell_rtl(cell)
        for p in cell.paragraphs:
            p.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
            for run in p.runs:
                run.font.size = Pt(10)

    doc.add_paragraph("")  # spacer

    # -- Invoice detail table --
    _add_styled_heading(doc, "\u05e4\u05d9\u05e8\u05d5\u05d8 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea", level=2)  # פירוט חשבוניות

    detail_headers = [
        "#",
        "\u05e1\u05e4\u05e7",           # ספק
        "\u05e0\u05d5\u05e9\u05d0",     # נושא
        "\u05e1\u05db\u05d5\u05dd",     # סכום
        "\u05ea\u05d0\u05e8\u05d9\u05da",  # תאריך
        "\u05e1\u05d9\u05d5\u05d5\u05d2",  # סיווג
        "\u05de\u05d9\u05d9\u05dc \u05de\u05e7\u05d5\u05e8",  # מייל מקור
    ]
    detail_table = doc.add_table(rows=1, cols=len(detail_headers))
    detail_table.style = "Light List Accent 1"
    detail_table.alignment = WD_TABLE_ALIGNMENT.LEFT

    header_row = detail_table.rows[0]
    for i, h in enumerate(detail_headers):
        cell = header_row.cells[i]
        cell.text = h
        _set_cell_rtl(cell)
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
            str(row.get("company") or row.get("description") or "\u2014"),
            str(row.get("subject") or "\u2014"),
            _format_currency(amount, currency) if amount else "\u2014",
            str(row.get("date") or "\u2014"),
            TIER_LABELS.get(tier, tier or "\u2014"),
            str(row.get("sender") or "\u2014"),
        ]
        for i, val in enumerate(cell_values):
            cells[i].text = val
            _set_cell_rtl(cells[i])
            for p in cells[i].paragraphs:
                for run in p.runs:
                    run.font.size = Pt(8)

    # -- Summary row --
    summary_cells = detail_table.add_row().cells
    summary_cells[0].text = ""
    summary_cells[1].text = ""
    summary_cells[2].text = "\u05e1\u05d4\"\u05db"  # סה"כ
    summary_cells[3].text = _format_currency(total_amount, "ILS")
    summary_cells[4].text = ""
    summary_cells[5].text = ""
    summary_cells[6].text = ""
    for cell in summary_cells:
        _set_cell_rtl(cell)
        for p in cell.paragraphs:
            for run in p.runs:
                run.bold = True
                run.font.size = Pt(9)

    # -- Individual invoice sections (for detailed view) --
    if len(rows) <= 50:  # Only add detail sections for reasonable counts
        doc.add_page_break()
        _add_styled_heading(doc, "\u05e4\u05d9\u05e8\u05d5\u05d8 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05d1\u05d5\u05d3\u05d3\u05d5\u05ea", level=2)  # פירוט חשבוניות בודדות

        for idx, row in enumerate(rows, start=1):
            _add_styled_heading(
                doc,
                f"\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea #{idx} \u2014 {row.get('company') or row.get('sender') or '\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2'}",  # חשבונית # — ... / לא ידוע
                level=3,
            )

            _add_key_value(doc, "\u05e0\u05d5\u05e9\u05d0", str(row.get("subject") or "\u2014"))                   # נושא
            _add_key_value(doc, "\u05e9\u05d5\u05dc\u05d7", str(row.get("sender") or "\u2014"))                     # שולח

            amount = row.get("amount")
            currency = row.get("currency", "ILS")
            _add_key_value(doc, "\u05e1\u05db\u05d5\u05dd", _format_currency(amount, currency) if amount else "\u2014")  # סכום

            _add_key_value(doc, "\u05ea\u05d0\u05e8\u05d9\u05da", str(row.get("date") or "\u2014"))                 # תאריך

            tier = row.get("classification_tier", "")
            _add_key_value(doc, "\u05e1\u05d9\u05d5\u05d5\u05d2", TIER_LABELS.get(tier, tier or "\u2014"))          # סיווג

            has_att = row.get("has_attachment", False)
            _add_key_value(doc, "\u05e7\u05d1\u05e6\u05d9\u05dd \u05de\u05e6\u05d5\u05e8\u05e4\u05d9\u05dd",      # קבצים מצורפים
                           "\u05db\u05df" if has_att else "\u05dc\u05d0")                                             # כן / לא

            if row.get("notes"):
                _add_key_value(doc, "\u05d4\u05e2\u05e8\u05d5\u05ea", str(row["notes"]))                            # הערות

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
                    _add_key_value(doc, "\u05e6\u05d9\u05dc\u05d5\u05dd \u05de\u05e1\u05da", f"(\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d4\u05d8\u05de\u05e2\u05d4: {e})")  # צילום מסך / שגיאה בהטמעה
            elif screenshot_error:
                _add_key_value(doc, "\u05e6\u05d9\u05dc\u05d5\u05dd \u05de\u05e1\u05da", f"(\u05dc\u05d0 \u05d6\u05de\u05d9\u05df: {screenshot_error})")  # צילום מסך / לא זמין
            elif screenshot_path:
                _add_key_value(doc, "\u05e6\u05d9\u05dc\u05d5\u05dd \u05de\u05e1\u05da", "(\u05e7\u05d5\u05d1\u05e5 \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0)")

            doc.add_paragraph("")  # spacer between invoices

    # -- Footer --
    doc.add_paragraph("")
    footer = doc.add_paragraph()
    footer.alignment = WD_PARAGRAPH_ALIGNMENT.CENTER
    run = footer.add_run(
        f"\u05d4\u05d5\u05e4\u05e7 \u05e2\u05dc \u05d9\u05d3\u05d9 Invoice Fetcher  \u2022  {datetime.now().strftime('%Y-%m-%d %H:%M')}"  # הופק על ידי
    )
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor(0xAA, 0xAA, 0xAA)

    doc.save(filepath)
    return filepath
