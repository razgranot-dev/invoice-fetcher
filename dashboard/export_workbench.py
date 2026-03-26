# -*- coding: utf-8 -*-
"""
Export Workbench -- editable table with checkbox selection and export controls.
Appears after scan results are available.
"""

import os
import streamlit as st
import pandas as pd

from core.amount_extractor import enrich_results
from core.screenshot_renderer import render_selected_to_zip
from core.word_exporter import create_invoice_report


def _sanitize_str(s):
    """Strip any bytes that are not valid UTF-8 (including surrogates)."""
    if not isinstance(s, str):
        return s
    return s.encode("utf-8", errors="ignore").decode("utf-8")


def _sanitize_dict(d: dict) -> dict:
    """Sanitize all string values in a dict."""
    return {k: _sanitize_str(v) for k, v in d.items()}


def _init_export_state():
    """Initialize export-related session state keys."""
    if "enriched_results" not in st.session_state:
        st.session_state["enriched_results"] = []
    if "export_df" not in st.session_state:
        st.session_state["export_df"] = None


# Column name constants (Hebrew)
_COL_SELECTED = "\u05e0\u05d1\u05d7\u05e8"          # nbhr
_COL_DATE = "\u05ea\u05d0\u05e8\u05d9\u05da"         # tarikh
_COL_VENDOR = "\u05e9\u05d5\u05dc\u05d7 / \u05ea\u05d9\u05d0\u05d5\u05e8"  # sholekh / teor
_COL_AMOUNT = "\u05e1\u05db\u05d5\u05dd"              # skom
_COL_CURRENCY = "\u05de\u05d8\u05d1\u05e2"            # matbea
_COL_STATUS = "\u05e1\u05d8\u05d8\u05d5\u05e1"        # status
_COL_NOTES = "\u05d4\u05e2\u05e8\u05d5\u05ea"         # hearot
_COL_CONFIDENCE = "\u05d1\u05d9\u05d8\u05d7\u05d5\u05df"  # bitakhon


def _build_dataframe(enriched: list[dict]) -> pd.DataFrame:
    """Build the editable DataFrame from enriched results."""
    rows = []
    for r in enriched:
        rows.append({
            _COL_SELECTED: True,
            _COL_DATE: _sanitize_str(r.get("date", "")[:16] if r.get("date") else ""),
            _COL_VENDOR: _sanitize_str(r.get("description", "")),
            _COL_AMOUNT: r.get("amount"),
            _COL_CURRENCY: _sanitize_str(r.get("currency", "\u20aa")),
            _COL_STATUS: "\u05e7\u05d5\u05d1\u05e5 \u05de\u05e6\u05d5\u05e8\u05e3" if r.get("saved_path") or r.get("attachments") else "\u05dc\u05dc\u05d0 \u05e7\u05d5\u05d1\u05e5",
            _COL_NOTES: _sanitize_str(r.get("notes", "")),
            _COL_CONFIDENCE: _sanitize_str(r.get("confidence", "low")),
            "_uid": _sanitize_str(r.get("uid", "")),
        })
    return pd.DataFrame(rows)


def _get_selected_rows(edited_df: pd.DataFrame, enriched: list[dict]) -> list[dict]:
    """Match selected rows back to enriched results for export."""
    selected = []
    for idx, row in edited_df.iterrows():
        if row.get(_COL_SELECTED, False) and idx < len(enriched):
            result = _sanitize_dict(enriched[idx])
            result["description"] = _sanitize_str(row.get(_COL_VENDOR, result.get("description", "")))
            result["amount"] = row.get(_COL_AMOUNT, result.get("amount"))
            result["notes"] = _sanitize_str(row.get(_COL_NOTES, result.get("notes", "")))
            selected.append(result)
    return selected


def render_export_workbench(results: list[dict]):
    """Render the full export workbench UI section."""
    _init_export_state()

    # Enrich results with amounts (only once per scan)
    if not st.session_state["enriched_results"] or len(st.session_state["enriched_results"]) != len(results):
        st.session_state["enriched_results"] = [
            _sanitize_dict(r) for r in enrich_results(results)
        ]

    enriched = st.session_state["enriched_results"]

    # Section header
    st.markdown(
        '<div class="section-title">\u05d9\u05d9\u05e6\u05d5\u05d0 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea</div>',
        unsafe_allow_html=True,
    )

    # Select All / Deselect All controls
    col_sel, col_desel, col_count, col_spacer = st.columns([1, 1, 2, 4])
    with col_sel:
        select_all = st.button("\u05d1\u05d7\u05e8 \u05d4\u05db\u05dc", key="exp_select_all", use_container_width=True)
    with col_desel:
        deselect_all = st.button("\u05d1\u05d8\u05dc \u05d1\u05d7\u05d9\u05e8\u05d4", key="exp_deselect_all", use_container_width=True)

    # Build or update DataFrame
    df = _build_dataframe(enriched)

    if select_all:
        df[_COL_SELECTED] = True
    elif deselect_all:
        df[_COL_SELECTED] = False

    # Column config for the data editor
    column_config = {
        _COL_SELECTED: st.column_config.CheckboxColumn(_COL_SELECTED, default=True, width="small"),
        _COL_DATE: st.column_config.TextColumn(_COL_DATE, width="medium", disabled=True),
        _COL_VENDOR: st.column_config.TextColumn(_COL_VENDOR, width="large"),
        _COL_AMOUNT: st.column_config.NumberColumn(_COL_AMOUNT + " (\u20aa)", format="%.2f", width="small"),
        _COL_CURRENCY: st.column_config.TextColumn(_COL_CURRENCY, width="small", disabled=True),
        _COL_STATUS: st.column_config.TextColumn(_COL_STATUS, width="medium", disabled=True),
        _COL_NOTES: st.column_config.TextColumn(_COL_NOTES, width="medium"),
        _COL_CONFIDENCE: st.column_config.TextColumn(_COL_CONFIDENCE, width="small", disabled=True),
        "_uid": None,
    }

    # Final sanitization pass -- catch anything pyarrow can't encode
    df = df.applymap(_sanitize_str)

    edited_df = st.data_editor(
        df,
        column_config=column_config,
        use_container_width=True,
        hide_index=True,
        num_rows="fixed",
        key="export_table_editor",
    )

    # Compute selection stats
    selected_mask = edited_df[_COL_SELECTED] == True
    selected_count = selected_mask.sum()
    selected_amounts = edited_df.loc[selected_mask, _COL_AMOUNT].dropna()
    total_amount = selected_amounts.sum()

    # Export Bar
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
        f'<span style="color:#8B8D97; font-size:13px;">'
        f'\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05e0\u05d1\u05d7\u05e8\u05d5</span>'
        f'<span style="color:#4E5260; margin:0 4px;">\u00b7</span>'
        f'<span style="color:#44C4A1; font-size:13px; font-weight:600;">'
        f'\u20aa{total_amount:,.2f} '
        f'\u05e1\u05d4"\u05db</span>'
        f'</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    # Export buttons -- plain text labels, no emojis
    col_zip, col_word, col_both = st.columns(3)

    with col_zip:
        export_zip = st.button(
            "\u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da (ZIP)",
            key="exp_zip", use_container_width=True,
            disabled=selected_count == 0,
        )
    with col_word:
        export_word = st.button(
            "\u05d8\u05d1\u05dc\u05ea Word",
            key="exp_word", use_container_width=True,
            disabled=selected_count == 0,
        )
    with col_both:
        export_both = st.button(
            "\u05d9\u05d9\u05e6\u05d5\u05d0 \u05d4\u05db\u05dc",
            key="exp_both", use_container_width=True,
            disabled=selected_count == 0, type="primary",
        )

    # Handle exports
    selected_rows = _get_selected_rows(edited_df, enriched)

    if export_zip or export_both:
        _do_zip_export(selected_rows)

    if export_word or export_both:
        _do_word_export(selected_rows)


def _do_zip_export(selected_rows: list[dict]):
    """Run the ZIP screenshot export with progress feedback."""
    with st.status("\u05de\u05d9\u05d9\u05e6\u05e8 \u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da...", expanded=True) as status:
        progress = st.progress(0, text="\u05de\u05d0\u05ea\u05d7\u05dc...")

        progress.progress(20, text="\u05de\u05e2\u05d1\u05d3 \u05d0\u05d9\u05de\u05d9\u05d9\u05dc\u05d9\u05dd...")
        zip_path = render_selected_to_zip(selected_rows)

        progress.progress(100, text="\u05d4\u05d5\u05e9\u05dc\u05dd!")
        status.update(
            label="\u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da \u05de\u05d5\u05db\u05e0\u05d9\u05dd!",
            state="complete", expanded=False,
        )

    if zip_path:
        with open(zip_path, "rb") as f:
            st.download_button(
                label="\u05d4\u05d5\u05e8\u05d3 ZIP",
                data=f.read(),
                file_name=os.path.basename(zip_path),
                mime="application/zip",
                use_container_width=True,
            )
    else:
        st.warning("\u05dc\u05d0 \u05d4\u05e6\u05dc\u05d9\u05d7 \u05dc\u05d9\u05d9\u05e6\u05e8 \u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da. \u05d5\u05d3\u05d0 \u05e9-Chrome \u05de\u05d5\u05ea\u05e7\u05df \u05d1\u05de\u05d7\u05e9\u05d1.")


def _do_word_export(selected_rows: list[dict]):
    """Run the Word table export with progress feedback."""
    with st.status("\u05de\u05d9\u05d9\u05e6\u05e8 \u05d3\u05d5\u05d7 Word...", expanded=True) as status:
        progress = st.progress(0, text="\u05de\u05d0\u05ea\u05d7\u05dc...")

        progress.progress(50, text="\u05d1\u05d5\u05e0\u05d4 \u05d8\u05d1\u05dc\u05d4...")
        word_path = create_invoice_report(selected_rows)

        progress.progress(100, text="\u05d4\u05d5\u05e9\u05dc\u05dd!")
        status.update(
            label="\u05d3\u05d5\u05d7 Word \u05de\u05d5\u05db\u05df!",
            state="complete", expanded=False,
        )

    if word_path:
        with open(word_path, "rb") as f:
            st.download_button(
                label="\u05d4\u05d5\u05e8\u05d3 Word",
                data=f.read(),
                file_name=os.path.basename(word_path),
                mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                use_container_width=True,
            )
    else:
        st.warning("\u05dc\u05d0 \u05d4\u05e6\u05dc\u05d9\u05d7 \u05dc\u05d9\u05d9\u05e6\u05e8 \u05d3\u05d5\u05d7 Word.")
