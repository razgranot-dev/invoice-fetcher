"""
מערכת חשבוניות חכמה — ממשק Streamlit בסגנון David Hockney.

שלושה מצבים:
  1. לא מוגדר  → מסך הגדרת env vars (למפתח)
  2. לא מחובר  → מסך ברוכים הבאים עם כפתור חיבור Google
  3. מחובר     → Dashboard מלא

הפעלה: streamlit run app.py
"""

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

# טעינת .env לפני כל דבר
load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))

st.set_page_config(
    page_title="מערכת חשבוניות חכמה",
    page_icon="🏊",
    layout="wide",
    initial_sidebar_state="auto",
)

from dashboard.analytics import render_analytics
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
    st.markdown('<div style="border-top:1px solid rgba(255,255,255,0.06); padding-top:16px;"></div>', unsafe_allow_html=True)
    if st.button("🔓 התנתק מ-Gmail", use_container_width=True):
        GmailConnector().revoke_token()
        st.session_state.results = []
        st.session_state.scan_done = False
        st.session_state.connecting = False
        st.rerun()

render_header()

# תג "מחובר"
st.markdown(
    '<div style="text-align:left; margin-top:-16px; margin-bottom:16px;">'
    '<span style="display:inline-flex; align-items:center; gap:6px; '
    'background:rgba(16,185,129,0.15); color:#34D399; font-size:0.78rem; '
    'font-weight:700; padding:5px 14px; border-radius:100px; '
    'border:1px solid rgba(16,185,129,0.3);">● מחובר ל-Gmail</span>'
    "</div>",
    unsafe_allow_html=True,
)

# ── הפעלת סריקה ────────────────────────────────────────────────────────────
if scan_params.get("start_scan"):
    st.session_state.results = run_email_scan(scan_params)
    st.session_state.scan_done = True

# ── תצוגת תוצאות ───────────────────────────────────────────────────────────
if st.session_state.results:
    st.markdown("---")
    render_metrics(st.session_state.results)
    st.markdown("---")
    render_results_table(st.session_state.results)
    st.markdown("---")
    render_analytics(st.session_state.results)

elif st.session_state.scan_done:
    st.info("הסריקה הסתיימה ללא תוצאות. נסה לשנות את הגדרות הסריקה.")

else:
    st.markdown("""
    <div style="text-align:center; direction:rtl; padding:80px 20px;">
        <div style="
            display:inline-flex; flex-direction:column; align-items:center; gap:20px;
            background:#1E293B; border:1px solid rgba(255,255,255,0.08);
            border-radius:24px; padding:48px 56px;
            box-shadow:0 24px 80px rgba(0,0,0,0.4);
        ">
            <div style="font-size:3.5rem; line-height:1;">📬</div>
            <div style="font-size:1.4rem; font-weight:800; color:#F8FAFC;">מוכן לסריקה</div>
            <div style="color:#94A3B8; font-size:0.95rem; max-width:280px; line-height:1.6;">
                הגדר פרמטרים בסרגל הצד ולחץ
                <strong style="color:#3B82F6;">🚀 התחל סריקה</strong>
            </div>
        </div>
    </div>
    """, unsafe_allow_html=True)

# ── כותרת תחתונה ───────────────────────────────────────────────────────────
st.markdown("""
<div style="text-align:center; direction:rtl; margin-top:48px; padding:16px;
     border-top:1px solid rgba(255,255,255,0.06); color:#475569; font-size:0.78rem;">
    📊 מערכת חשבוניות חכמה &nbsp;·&nbsp; כל הנתונים מעובדים באופן מקומי בלבד
</div>
""", unsafe_allow_html=True)
