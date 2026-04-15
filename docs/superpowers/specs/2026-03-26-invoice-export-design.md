# Invoice Export Feature — Design Spec

## Overview
Add export capabilities to the invoice-fetcher app: ZIP of email screenshots, Word table with amounts, and a selection-based export workbench UI.

## Architecture: Two-Phase Flow
- **Phase 1**: Existing scan runs as today, populates `st.session_state.results`
- **Phase 2**: Export Workbench appears after scan — editable table with auto-extracted amounts, checkbox selection, export panel

## New Modules

| File | Purpose |
|------|---------|
| `core/amount_extractor.py` | Regex-based amount/description extraction from email body |
| `core/screenshot_renderer.py` | HTML→PNG via html2image, PDF fallback via PyMuPDF |
| `core/word_exporter.py` | .docx table generation via python-docx |
| `dashboard/export_workbench.py` | Export UI: editable table, selection, export buttons, progress |

## New Dependencies
- `python-docx` — Word document generation
- `html2image` — HTML→PNG rendering (uses installed Chrome)
- `PyMuPDF` — PDF first-page rendering for attachment fallback

## Amount Extraction (`core/amount_extractor.py`)
- Regex patterns (priority): `₪XX.XX`, `XX.XX ש"ח`, `סכום: XX.XX`, `Total: $XX.XX`
- Takes largest amount found (total > line items)
- Description from cleaned subject line, fallback to sender name
- Returns: `{amount, currency, description, confidence, raw_match}`
- Confidence: high (₪ symbol found), medium (amount no symbol), low (nothing found)

## Screenshot Renderer (`core/screenshot_renderer.py`)
- Uses `html2image` with existing Chrome installation
- Smart fallback: if email body is minimal (<100 chars or "see attached"), render PDF first page via PyMuPDF instead
- Filenames: `YYYY-MM-DD_vendor_amount.png`
- Wraps email HTML in a styled template before rendering (RTL support, clean fonts)

## Word Exporter (`core/word_exporter.py`)
- Uses `python-docx` to create formatted table
- Columns: #, Date, Vendor/Description, Amount (₪), Notes
- Summary row at bottom with total amount
- RTL paragraph formatting for Hebrew
- Output: `exports/invoices_report_YYYY-MM-DD.docx`

## Export Workbench UI (`dashboard/export_workbench.py`)
- Appears below existing results after scan completes
- `st.data_editor` with columns: checkbox, date, vendor/description (editable), amount (editable), status, notes (editable)
- Select All / Deselect All buttons
- Sticky bottom bar: selected count, total amount, 3 export buttons (ZIP, Word, Both)
- Progress indicators during export
- `st.download_button` for each generated file

## Data Flow
```
scan results → amount_extractor.enrich(results)
  → st.data_editor (user edits amounts/descriptions, selects rows)
  → export button clicked
  → screenshot_renderer.render_selected(selected_rows) → ZIP
  → word_exporter.create_report(selected_rows) → .docx
  → st.download_button for each file
```

## Files Modified
- `app.py` — add export workbench section after results
- `requirements.txt` — add python-docx, html2image, PyMuPDF

## Output Directory
All exports saved to `exports/` with timestamps:
- `exports/invoices_screenshots_2024-01-15.zip`
- `exports/invoices_report_2024-01-15.docx`
