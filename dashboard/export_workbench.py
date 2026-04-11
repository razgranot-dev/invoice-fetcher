# -*- coding: utf-8 -*-
"""
Export Workbench -- editable table with checkbox selection and export controls.
Appears after scan results are available.
"""

import os
import streamlit as st
import pandas as pd

from core.amount_extractor import enrich_results
from core.invoice_classifier import (
    TIER_CONFIRMED, TIER_LIKELY, TIER_POSSIBLE, TIER_NOT,
    tier_display_name, format_signal_breakdown,
)
from core.screenshot_renderer import render_selected_to_zip
from core.word_exporter import create_invoice_report
from dashboard.components import _extract_company


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
        tier = r.get("classification_tier", TIER_POSSIBLE)
        rows.append({
            _COL_SELECTED: tier in (TIER_CONFIRMED, TIER_LIKELY),
            _COL_DATE: _sanitize_str(r.get("date", "")[:16] if r.get("date") else ""),
            _COL_VENDOR: _sanitize_str(r.get("description", "")),
            _COL_AMOUNT: r.get("amount"),
            _COL_CURRENCY: _sanitize_str(r.get("currency", "\u20aa")),
            _COL_STATUS: "\u05e7\u05d5\u05d1\u05e5 \u05de\u05e6\u05d5\u05e8\u05e3" if r.get("saved_path") or r.get("attachments") else "\u05dc\u05dc\u05d0 \u05e7\u05d5\u05d1\u05e5",
            _COL_NOTES: _sanitize_str(r.get("notes", "")),
            _COL_CONFIDENCE: _sanitize_str(tier_display_name(tier)),
            "_uid": _sanitize_str(r.get("uid", "")),
            "_tier": tier,
            "_score": r.get("classification_score", 0),
        })
    return pd.DataFrame(rows)


def _get_selected_rows(edited_df: pd.DataFrame, enriched: list[dict]) -> list[dict]:
    """Match selected rows back to enriched results for export using UID."""
    # Build UID → enriched-dict lookup for safe matching
    uid_map = {_sanitize_str(r.get("uid", "")): r for r in enriched}

    selected = []
    for _, row in edited_df.iterrows():
        if not row.get(_COL_SELECTED, False):
            continue
        uid = row.get("_uid", "")
        base = uid_map.get(uid)
        if base is None:
            continue
        result = _sanitize_dict(base)
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

    enriched_all = st.session_state["enriched_results"]

    # Apply company filter (same filter used by the CSV results table)
    selected_companies = st.session_state.get("_company_selection")
    if selected_companies is not None:
        enriched = [
            r for r in enriched_all
            if _extract_company(r.get("sender", "")) in selected_companies
        ]
    else:
        enriched = enriched_all

    # ── Tier filter ─────────────────────────────────────────────────
    # Count tiers across enriched results
    _tier_counts = {}
    for r in enriched:
        t = r.get("classification_tier", TIER_POSSIBLE)
        _tier_counts[t] = _tier_counts.get(t, 0) + 1

    _filter_options = {
        "\u05de\u05d0\u05d5\u05de\u05ea\u05d5\u05ea \u05d1\u05dc\u05d1\u05d3": [TIER_CONFIRMED],                                    # מאומתות בלבד
        "\u05de\u05d0\u05d5\u05de\u05ea\u05d5\u05ea + \u05e1\u05d1\u05d9\u05e8\u05d5\u05ea": [TIER_CONFIRMED, TIER_LIKELY],           # מאומתות + סבירות
        "\u05db\u05dc \u05d4\u05e4\u05d9\u05e0\u05e0\u05e1\u05d9\u05d5\u05ea": [TIER_CONFIRMED, TIER_LIKELY, TIER_POSSIBLE],          # כל הפיננסיות
        "\u05d4\u05db\u05dc (\u05db\u05d5\u05dc\u05dc \u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9)": [TIER_CONFIRMED, TIER_LIKELY, TIER_POSSIBLE, TIER_NOT],  # הכל
    }
    # Default to "confirmed + likely"
    _default_filter = "\u05de\u05d0\u05d5\u05de\u05ea\u05d5\u05ea + \u05e1\u05d1\u05d9\u05e8\u05d5\u05ea"

    col_filter, col_tier_info = st.columns([2, 3])
    with col_filter:
        selected_filter = st.selectbox(
            "\u05e8\u05de\u05ea \u05e1\u05d9\u05e0\u05d5\u05df",  # רמת סינון
            list(_filter_options.keys()),
            index=list(_filter_options.keys()).index(_default_filter),
            key="tier_filter_select",
        )
    with col_tier_info:
        tier_parts = []
        if _tier_counts.get(TIER_CONFIRMED, 0):
            tier_parts.append(f"\u05de\u05d0\u05d5\u05de\u05ea\u05d5\u05ea: {_tier_counts[TIER_CONFIRMED]}")
        if _tier_counts.get(TIER_LIKELY, 0):
            tier_parts.append(f"\u05e1\u05d1\u05d9\u05e8\u05d5\u05ea: {_tier_counts[TIER_LIKELY]}")
        if _tier_counts.get(TIER_POSSIBLE, 0):
            tier_parts.append(f"\u05d0\u05d5\u05dc\u05d9: {_tier_counts[TIER_POSSIBLE]}")
        if _tier_counts.get(TIER_NOT, 0):
            tier_parts.append(f"\u05dc\u05d0 \u05e8\u05dc\u05d5\u05d5\u05e0\u05d8\u05d9: {_tier_counts[TIER_NOT]}")
        st.caption(" · ".join(tier_parts) if tier_parts else "")

    allowed_tiers = _filter_options.get(selected_filter, [TIER_CONFIRMED, TIER_LIKELY])
    enriched = [r for r in enriched if r.get("classification_tier", TIER_POSSIBLE) in allowed_tiers]

    # Show filter status
    if len(enriched) < len(enriched_all):
        st.caption(
            f"\u05de\u05e6\u05d9\u05d2 **{len(enriched)}** "
            f"\u05de\u05ea\u05d5\u05da {len(enriched_all)} \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea "
            f"(\u05dc\u05e4\u05d9 \u05e1\u05d9\u05e0\u05d5\u05df)"
        )

    if not enriched:
        st.info("\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05d1\u05e8\u05de\u05d4 \u05d6\u05d5. \u05e0\u05e1\u05d4 \u05dc\u05d4\u05e8\u05d7\u05d9\u05d1 \u05d0\u05ea \u05d4\u05e1\u05d9\u05e0\u05d5\u05df.")
        return

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
        "_tier": None,
        "_score": None,
    }

    # Final sanitization pass -- catch anything pyarrow can't encode
    df = df.map(_sanitize_str)

    # Key includes row count + UID hash so the editor resets when filters change
    _uid_hash = hash(tuple(r.get("uid", "") for r in enriched))
    editor_key = f"export_table_editor_{len(enriched)}_{_uid_hash}"

    edited_df = st.data_editor(
        df,
        column_config=column_config,
        use_container_width=True,
        hide_index=True,
        num_rows="fixed",
        key=editor_key,
    )

    # Compute selection stats
    selected_mask = edited_df[_COL_SELECTED] == True
    selected_count = selected_mask.sum()
    selected_amounts = edited_df.loc[selected_mask, _COL_AMOUNT].dropna()
    total_amount = selected_amounts.sum()

    # Action bar — compact summary
    st.markdown(
        f'<div class="action-bar">'
        f'<div class="action-bar-stat">'
        f'<span class="action-bar-count">{selected_count}</span>'
        f'<span class="action-bar-label">\u05e0\u05d1\u05d7\u05e8\u05d5</span>'
        f'<span class="action-bar-sep">\u00b7</span>'
        f'<span class="action-bar-amount">\u20aa{total_amount:,.2f}</span>'
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
    result = None
    with st.status("\u05de\u05d9\u05d9\u05e6\u05e8 \u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da...", expanded=True) as status:
        progress = st.progress(0, text="\u05de\u05d0\u05ea\u05d7\u05dc...")
        try:
            total = len(selected_rows)

            def _on_progress(idx, count, vendor):
                pct = int(10 + 85 * idx / max(count, 1))
                progress.progress(min(pct, 95), text=f"\u05de\u05e6\u05dc\u05dd {idx + 1}/{count}: {vendor}")

            progress.progress(5, text=f"\u05de\u05ea\u05d7\u05d9\u05dc \u05e6\u05d9\u05dc\u05d5\u05dd {total} \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea...")
            result = render_selected_to_zip(selected_rows, progress_callback=_on_progress)

            progress.progress(100, text="\u05d4\u05d5\u05e9\u05dc\u05dd!")
            status.update(
                label="\u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da \u05de\u05d5\u05db\u05e0\u05d9\u05dd!",
                state="complete", expanded=False,
            )
        except Exception as exc:
            status.update(
                label="\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d9\u05d9\u05e6\u05d5\u05d0 \u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da",
                state="error", expanded=False,
            )
            st.error(f"\u05d9\u05d9\u05e6\u05d5\u05d0 ZIP \u05e0\u05db\u05e9\u05dc: {exc}")
            return

    # result is a dict with zip_path, stats, and summary
    if not isinstance(result, dict):
        st.warning("\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05dc\u05ea\u05d9 \u05e6\u05e4\u05d5\u05d9\u05d4 \u05d1\u05d9\u05d9\u05e6\u05d5\u05d0.")
        return

    zip_path = result.get("zip_path")
    summary = result.get("summary", "")

    # Always show the export summary
    if summary:
        st.caption(f"\u05e1\u05d9\u05db\u05d5\u05dd: {summary}")

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
        # Show specific failure reason instead of generic message
        if result.get("chrome_missing", 0) > 0:
            st.error(
                "Chrome \u05dc\u05d0 \u05e0\u05de\u05e6\u05d0 \u05d1\u05de\u05d7\u05e9\u05d1. "
                "\u05d5\u05d3\u05d0 \u05e9-Google Chrome \u05de\u05d5\u05ea\u05e7\u05df."
            )
        elif result.get("chrome_crash", 0) > 0:
            st.error(
                f"Chrome \u05e7\u05e8\u05e1 {result['chrome_crash']} \u05e4\u05e2\u05de\u05d9\u05dd. "
                "\u05e0\u05e1\u05d4 \u05dc\u05e1\u05d2\u05d5\u05e8 \u05ea\u05d4\u05dc\u05d9\u05db\u05d9 Chrome \u05d0\u05d7\u05e8\u05d9\u05dd \u05d5\u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1."
            )
        elif result.get("no_output_file", 0) > 0:
            st.warning(
                f"Chrome \u05e8\u05e5 \u05d0\u05d1\u05dc \u05dc\u05d0 \u05d9\u05e6\u05e8 \u05e7\u05d5\u05d1\u05e5 ({result['no_output_file']} \u05e4\u05e2\u05de\u05d9\u05dd). "
                "\u05d1\u05d3\u05e7 \u05d0\u05ea \u05d4\u05dc\u05d5\u05d2 \u05dc\u05e4\u05e8\u05d8\u05d9\u05dd."
            )
        elif result.get("output_dir_not_writable", 0) > 0:
            st.error(
                "\u05ea\u05d9\u05e7\u05d9\u05d9\u05ea \u05d4\u05e4\u05dc\u05d8 \u05d0\u05d9\u05e0\u05d4 \u05e0\u05d9\u05ea\u05e0\u05ea \u05dc\u05db\u05ea\u05d9\u05d1\u05d4. "
                "\u05d1\u05d3\u05e7 \u05d4\u05e8\u05e9\u05d0\u05d5\u05ea \u05dc\u05ea\u05d9\u05e7\u05d9\u05d9\u05ea exports/."
            )
        elif result.get("timed_out", 0) > 0:
            st.warning(
                f"\u05db\u05dc \u05d4\u05e6\u05d9\u05dc\u05d5\u05de\u05d9\u05dd \u05e0\u05db\u05e9\u05dc\u05d5 ({result['timed_out']} \u05d7\u05e8\u05d9\u05d2\u05d5\u05ea \u05d6\u05de\u05df). "
                "\u05e0\u05e1\u05d4 \u05e2\u05dd \u05e4\u05d7\u05d5\u05ea \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea."
            )
        else:
            st.warning(
                "\u05dc\u05d0 \u05d4\u05e6\u05dc\u05d9\u05d7 \u05dc\u05d9\u05d9\u05e6\u05e8 \u05e6\u05d9\u05dc\u05d5\u05de\u05d9 \u05de\u05e1\u05da. "
                "\u05d1\u05d3\u05e7 \u05d0\u05ea \u05d4\u05dc\u05d5\u05d2 \u05dc\u05e4\u05e8\u05d8\u05d9\u05dd."
            )

        # Show bail-out diagnosis if available
        diagnosis = result.get("bail_diagnosis", "")
        if diagnosis:
            st.caption(f"\u05d0\u05d1\u05d7\u05e0\u05d4: {diagnosis}")


def _do_word_export(selected_rows: list[dict]):
    """Run the Word table export with progress feedback."""
    word_path = None
    with st.status("\u05de\u05d9\u05d9\u05e6\u05e8 \u05d3\u05d5\u05d7 Word...", expanded=True) as status:
        progress = st.progress(0, text="\u05de\u05d0\u05ea\u05d7\u05dc...")
        try:
            progress.progress(50, text="\u05d1\u05d5\u05e0\u05d4 \u05d8\u05d1\u05dc\u05d4...")
            word_path = create_invoice_report(selected_rows)

            progress.progress(100, text="\u05d4\u05d5\u05e9\u05dc\u05dd!")
            status.update(
                label="\u05d3\u05d5\u05d7 Word \u05de\u05d5\u05db\u05df!",
                state="complete", expanded=False,
            )
        except Exception as exc:
            status.update(
                label="\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d9\u05d9\u05e6\u05d5\u05d0 Word",
                state="error", expanded=False,
            )
            st.error(f"\u05d9\u05d9\u05e6\u05d5\u05d0 Word \u05e0\u05db\u05e9\u05dc: {exc}")
            return

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
