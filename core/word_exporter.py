"""
ייצוא טבלת חשבוניות לקובץ Word (.docx) עם שורת סיכום.
"""

import os
from datetime import date
from pathlib import Path

from docx import Document
from docx.shared import Pt
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
