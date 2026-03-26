"""
מערכת חשבוניות חכמה — ממשק Streamlit בעיצוב Midnight Gold.

שלושה מצבים:
  1. לא מוגדר  → מסך הגדרת env vars (למפתח)
  2. לא מחובר  → מסך ברוכים הבאים עם כפתור חיבור Google
  3. מחובר     → Dashboard מלא

הפעלה: streamlit run app.py
"""

import os

import streamlit as st
from dotenv import load_dotenv

# st.set_page_config must be the first Streamlit command in the script
st.set_page_config(
    page_title="מערכת חשבוניות חכמה",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="auto",
)

# טעינת .env לפני כל דבר
load_dotenv()

# Bridge GID/GSECRET → GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET.
# Checks st.secrets first (Streamlit Cloud), then os.environ short names (local .env).
for _src, _dst in (("GID", "GOOGLE_CLIENT_ID"), ("GSECRET", "GOOGLE_CLIENT_SECRET"), ("APP_URL", "APP_URL")):
    # st.secrets always wins — Streamlit Cloud auto-injects secrets into os.environ
    # using the secret's own key name, so an old GOOGLE_CLIENT_ID secret would
    # already be in os.environ before this runs. Always overwrite with the short-name value.
    try:
        if _src in st.secrets:
            os.environ[_dst] = st.secrets[_src]
    except Exception:
        pass
    # Fallback: if still not set, try the short name in os.environ (local .env)
    if not os.environ.get(_dst) and os.environ.get(_src):
        os.environ[_dst] = os.environ[_src]

from dashboard.analytics import render_analytics
from dashboard.export_workbench import render_export_workbench
from dashboard.components import (
    inject_css,
    render_header,
    render_metrics,
    render_results_table,
    render_sidebar,
)
from dashboard.scanner import run_email_scan
from dashboard.welcome_screen import render_not_configured_screen, render_welcome_screen

inject_css()

# ── אתחול מצב סשן ──────────────────────────────────────────────────────────
for _key, _default in [("results", []), ("scan_done", False)]:
    if _key not in st.session_state:
        st.session_state[_key] = _default

# ── זיהוי מצב ──────────────────────────────────────────────────────────────
from core.gmail_connector import GmailConnector

_connector = GmailConnector()

# ══ מצב 1: env vars חסרים ══════════════════════════════════════════════════
if not _connector.is_configured():
    render_not_configured_screen()
    st.stop()

# ══ מצב 2: לא מחובר — מסך ברוכים הבאים ════════════════════════════════════
if not _connector.is_authenticated():
    connected = render_welcome_screen()
    if connected:
        st.rerun()
    st.stop()

# ══ מצב 3: Dashboard ════════════════════════════════════════════════════════

scan_params = render_sidebar()

# כפתור התנתקות בסרגל הצד
with st.sidebar:
    st.markdown('<div style="height:8px;"></div>', unsafe_allow_html=True)
    st.markdown(
        '<div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:16px;"></div>',
        unsafe_allow_html=True,
    )
    if st.button("התנתק מ-Gmail", use_container_width=True):
        st.session_state.pop("_creds_json", None)
        st.session_state.pop("_pkce_code_verifier", None)
        st.session_state.pop("_oauth_csrf_state", None)
        st.session_state.results = []
        st.session_state.scan_done = False
        st.rerun()

render_header()

# תג "מחובר"
st.markdown(
    '<div style="text-align:left; margin-top:-12px; margin-bottom:20px; direction:rtl;">'
    '<span style="display:inline-flex; align-items:center; gap:6px; '
    'background:rgba(68,196,161,0.08); '
    'color:#44C4A1; font-size:0.7rem; font-weight:600; '
    'padding:5px 14px; border-radius:100px; '
    'border:1px solid rgba(68,196,161,0.18); '
    'font-family:\'Plus Jakarta Sans\',system-ui,sans-serif;">'
    '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;'
    'background:#44C4A1;flex-shrink:0;"></span>'
    'מחובר ל-Gmail'
    '</span>'
    "</div>",
    unsafe_allow_html=True,
)

# ── הפעלת סריקה ────────────────────────────────────────────────────────────
if scan_params.get("start_scan"):
    st.session_state.results = run_email_scan(scan_params)
    st.session_state.scan_done = True
    st.session_state.pop("enriched_results", None)  # force re-enrichment

# ── תצוגת תוצאות ───────────────────────────────────────────────────────────
if st.session_state.results:
    st.markdown("---")
    render_metrics(st.session_state.results)
    st.markdown("---")
    render_results_table(st.session_state.results)
    st.markdown("---")
    render_analytics(st.session_state.results)
    st.markdown("---")
    render_export_workbench(st.session_state.results)

elif st.session_state.scan_done:
    # ── מצב ריק: סריקה ללא תוצאות ──────────────────────────────────────────
    st.markdown("""
    <div style="text-align:center; direction:rtl; padding:64px 20px;">
        <div style="
            display:inline-flex; flex-direction:column; align-items:center; gap:16px;
            background:#141722; border:1px solid rgba(255,255,255,0.06);
            border-radius:20px; padding:48px 56px;
        ">
            <div style="
                width:56px; height:56px; border-radius:50%;
                background:rgba(232,113,111,0.08); border:1px solid rgba(232,113,111,0.15);
                display:flex; align-items:center; justify-content:center; font-size:1.5rem;
            ">📭</div>
            <div style="font-size:1.1rem; font-weight:700; color:#EDEAE3;
                letter-spacing:-0.02em; font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
                לא נמצאו תוצאות
            </div>
            <div style="color:#8B8D97; font-size:0.85rem; max-width:280px; line-height:1.7;
                font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
                נסה להרחיב את טווח התאריכים או לשנות את מילות המפתח בסרגל הצד
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

else:
    # ── מצב התחלתי: מוכן לסריקה ─────────────────────────────────────────────
    st.markdown("""
    <div style="text-align:center; direction:rtl; padding:64px 20px;">
        <div style="
            display:inline-flex; flex-direction:column; align-items:center; gap:16px;
            background:#141722; border:1px solid rgba(255,255,255,0.06);
            border-radius:20px; padding:48px 56px;
        ">
            <div style="
                width:56px; height:56px; border-radius:50%;
                background:rgba(212,168,67,0.08); border:1px solid rgba(212,168,67,0.15);
                display:flex; align-items:center; justify-content:center; font-size:1.5rem;
            ">📬</div>
            <div style="font-size:1.1rem; font-weight:700; color:#EDEAE3;
                letter-spacing:-0.02em; font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
                מוכן לסריקה
            </div>
            <div style="color:#8B8D97; font-size:0.85rem; max-width:280px; line-height:1.7;
                font-family:'Plus Jakarta Sans',system-ui,sans-serif;">
                הגדר פרמטרים בסרגל הצד ולחץ
                <strong style="color:#D4A843; font-weight:700;">התחל סריקה</strong>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

# ── כותרת תחתונה ───────────────────────────────────────────────────────────
st.markdown("""
<div style="
    text-align:center; direction:rtl; margin-top:48px; padding:16px;
    border-top:1px solid rgba(255,255,255,0.04);
">
    <span style="
        color:#4E5260; font-size:0.7rem; font-weight:500;
        letter-spacing:0.04em;
        font-family:'Plus Jakarta Sans',system-ui,sans-serif;
    ">
        Invoice Fetcher &nbsp;·&nbsp; כל הנתונים מעובדים באופן מקומי בלבד
    </span>
</div>
""", unsafe_allow_html=True)
