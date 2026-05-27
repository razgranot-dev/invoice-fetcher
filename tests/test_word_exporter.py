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
        # The report table is 3 columns (date, amount, supplier); the total
        # lives in the amount cell. Check the whole summary row so the test is
        # robust to column-layout changes rather than pinning a fixed index.
        row_text = " ".join(c.text for c in last_row.cells)
        assert "298.80" in row_text

    def test_empty_rows_returns_none(self, tmp_exports):
        result = create_invoice_report([], output_dir=str(tmp_exports))
        assert result is None

    def test_creates_output_dir(self, sample_rows, tmp_path):
        new_dir = str(tmp_path / "new_dir" / "exports")
        path = create_invoice_report(sample_rows, output_dir=new_dir)
        assert os.path.isfile(path)
