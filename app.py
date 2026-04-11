"""
Invoice Fetcher — two-phase product experience.

Phase 1: Scan Composer — focused, centered scan form (sidebar hidden)
Phase 2: Results Narrative — sidebar controls + tabbed results/analytics/export

Launch: streamlit run app.py
"""

import os

import streamlit as st
from dotenv import load_dotenv

# st.set_page_config must be the first Streamlit command in the script
st.set_page_config(
    page_title="Invoice Fetcher",
    page_icon="\u2709",
    layout="wide",
    initial_sidebar_state="auto",
)

# Load .env before anything else
load_dotenv()

# Bridge GID/GSECRET → GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.
for _src, _dst in (("GID", "GOOGLE_CLIENT_ID"), ("GSECRET", "GOOGLE_CLIENT_SECRET"), ("APP_URL", "APP_URL")):
    try:
        if _src in st.secrets:
            os.environ[_dst] = st.secrets[_src]
    except Exception:
        pass
    if not os.environ.get(_dst) and os.environ.get(_src):
        os.environ[_dst] = os.environ[_src]

from dashboard.analytics import render_analytics
from dashboard.export_workbench import render_export_workbench
from dashboard.components import (
    inject_css,
    render_app_shell,
    render_scan_composer,
    render_results_hero,
    render_sidebar_results,
    filter_results_by_company,
    render_results_table,
)
from dashboard.scanner import run_email_scan
from dashboard.welcome_screen import render_not_configured_screen, render_welcome_screen

inject_css()

# ── Session state init ─────────────────────────────────────────────────────
for _key, _default in [("results", []), ("scan_done", False)]:
    if _key not in st.session_state:
        st.session_state[_key] = _default

# ── Detect state ───────────────────────────────────────────────────────────
from core.gmail_connector import GmailConnector

_connector = GmailConnector()

# ══ State 1: env vars missing ═════════════════════════════════════════════
if not _connector.is_configured():
    render_not_configured_screen()
    st.stop()

# ══ State 2: not authenticated — welcome screen ══════════════════════════
if not _connector.is_authenticated():
    connected = render_welcome_screen()
    if connected:
        st.rerun()
    st.stop()

# ══ State 3: Authenticated — Two-Phase Product Experience ════════════════

render_app_shell()

_has_results = bool(st.session_state.results)

# ── PHASE 1: Scan Composer (no results yet) ────────────────────────────────
if not _has_results and not st.session_state.scan_done:
    scan_params = render_scan_composer()

    if scan_params.get("start_scan"):
        st.session_state.results = run_email_scan(scan_params)
        st.session_state.scan_done = True
        st.session_state.pop("enriched_results", None)
        st.rerun()

    # Footer
    st.markdown(
        '<div class="app-footer">'
        'Invoice Fetcher &middot; \u05db\u05dc \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd '
        '\u05de\u05e2\u05d5\u05d1\u05d3\u05d9\u05dd \u05d1\u05d0\u05d5\u05e4\u05df \u05de\u05e7\u05d5\u05de\u05d9 \u05d1\u05dc\u05d1\u05d3'
        '</div>',
        unsafe_allow_html=True,
    )
    st.stop()

# ── PHASE 2: Results Narrative ─────────────────────────────────────────────

# Sidebar — scan controls + company filter + disconnect
sidebar_params = render_sidebar_results(st.session_state.results)

# Handle disconnect
if sidebar_params.get("_disconnect"):
    for _k in ("_creds_json", "_pkce_code_verifier", "_oauth_csrf_state",
                "enriched_results", "export_df", "_company_selection"):
        st.session_state.pop(_k, None)
    st.session_state.results = []
    st.session_state.scan_done = False
    st.rerun()

# Handle re-scan from sidebar
if sidebar_params.get("start_scan"):
    st.session_state.results = run_email_scan(sidebar_params)
    st.session_state.scan_done = True
    st.session_state.pop("enriched_results", None)
    st.rerun()

# ── Display results ────────────────────────────────────────────────────────
if st.session_state.results:
    # Apply company filter
    filtered = filter_results_by_company(st.session_state.results)

    # Hero — big number reveal
    render_results_hero(filtered)

    st.markdown('<div style="height:8px;"></div>', unsafe_allow_html=True)

    # Tabbed content — results / analytics / export
    tab_results, tab_analytics, tab_export = st.tabs([
        "\u05ea\u05d5\u05e6\u05d0\u05d5\u05ea",
        "\u05e0\u05d9\u05ea\u05d5\u05d7",
        "\u05d9\u05d9\u05e6\u05d5\u05d0",
    ])

    with tab_results:
        render_results_table(filtered)

    with tab_analytics:
        render_analytics(filtered)

    with tab_export:
        render_export_workbench(st.session_state.results)

elif st.session_state.scan_done:
    st.markdown(
        '<div class="empty-hero">'
        '<div class="empty-hero-icon" style="background:var(--error-dim);">&#x1F4ED;</div>'
        '<h3>\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d5\u05e6\u05d0\u05d5\u05ea</h3>'
        '<p>\u05e0\u05e1\u05d4 \u05dc\u05d4\u05e8\u05d7\u05d9\u05d1 \u05d0\u05ea '
        '\u05d8\u05d5\u05d5\u05d7 \u05d4\u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd '
        '\u05d0\u05d5 \u05dc\u05e9\u05e0\u05d5\u05ea \u05de\u05d9\u05dc\u05d5\u05ea \u05de\u05e4\u05ea\u05d7</p>'
        '</div>',
        unsafe_allow_html=True,
    )

# ── Footer ─────────────────────────────────────────────────────────────────
st.markdown(
    '<div class="app-footer">'
    'Invoice Fetcher &middot; \u05db\u05dc \u05d4\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd '
    '\u05de\u05e2\u05d5\u05d1\u05d3\u05d9\u05dd \u05d1\u05d0\u05d5\u05e4\u05df \u05de\u05e7\u05d5\u05de\u05d9 \u05d1\u05dc\u05d1\u05d3'
    '</div>',
    unsafe_allow_html=True,
)
