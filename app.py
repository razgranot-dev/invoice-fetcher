"""
מערכת חשבוניות חכמה — ממשק Streamlit בסגנון David Hockney.

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
    '<span style="display:inline-flex; align-items:center; gap:8px; '
    'background:linear-gradient(135deg,rgba(52,211,153,0.10),rgba(0,200,255,0.06)); '
    'color:#34D399; font-size:0.68rem; font-weight:700; '
    'padding:6px 16px; border-radius:100px; '
    'border:1px solid rgba(52,211,153,0.22); '
    'box-shadow:0 0 14px rgba(52,211,153,0.10); '
    'letter-spacing:0.08em; text-transform:uppercase; '
    'backdrop-filter:blur(8px); font-family:\'Space Grotesk\',\'Inter\',sans-serif;">'
    '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;'
    'background:#34D399;box-shadow:0 0 6px #34D399;flex-shrink:0;"></span>'
    'מחובר ל-Gmail'
    '</span>'
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
            display:inline-flex; flex-direction:column; align-items:center; gap:22px;
            background:linear-gradient(160deg,rgba(13,21,40,0.95) 0%,rgba(6,10,18,0.98) 100%);
            border:1px solid rgba(0,200,255,0.10);
            border-radius:28px; padding:56px 64px;
            box-shadow:0 32px 100px rgba(0,0,0,0.65), 0 0 80px rgba(0,150,255,0.04);
            position:relative; overflow:hidden; backdrop-filter:blur(24px);
        ">
            <div style="position:absolute;top:0;left:0;right:0;height:2px;
                background:linear-gradient(90deg,transparent,#00C8FF,#818CF8,transparent);
                border-radius:28px 28px 0 0; opacity:0.6;"></div>
            <div style="position:absolute;top:16px;right:16px;width:18px;height:18px;
                border-top:1px solid rgba(0,200,255,0.35);border-right:1px solid rgba(0,200,255,0.35);
                border-radius:0 5px 0 0;"></div>
            <div style="position:absolute;bottom:16px;left:16px;width:18px;height:18px;
                border-bottom:1px solid rgba(129,140,248,0.35);border-left:1px solid rgba(129,140,248,0.35);
                border-radius:0 0 5px 0;"></div>
            <div style="
                width:80px;height:80px;border-radius:50%;
                background:linear-gradient(135deg,rgba(0,200,255,0.10),rgba(129,140,248,0.06));
                border:1px solid rgba(0,200,255,0.20);
                display:flex;align-items:center;justify-content:center;
                font-size:2.4rem; position:relative;
            ">
                <div style="position:absolute;inset:-7px;border-radius:50%;
                    border:1px solid rgba(0,200,255,0.06);"></div>
                📬
            </div>
            <div style="font-size:1.3rem; font-weight:800; color:#EFF6FF;
                letter-spacing:-0.02em; font-family:'Space Grotesk','Inter',sans-serif;">
                מוכן לסריקה
            </div>
            <div style="color:#475569; font-size:0.88rem; max-width:260px; line-height:1.75;">
                הגדר פרמטרים בסרגל הצד ולחץ
                <strong style="color:#22D3EE; font-weight:700;">🚀 התחל סריקה</strong>
            </div>
            <div style="position:absolute;bottom:-60px;left:-60px;width:180px;height:180px;
                background:radial-gradient(circle,rgba(0,180,255,0.06) 0%,transparent 70%);
                border-radius:50%;pointer-events:none;"></div>
        </div>
    </div>
    """, unsafe_allow_html=True)

# ── כותרת תחתונה ───────────────────────────────────────────────────────────
st.markdown("""
<div style="
    text-align:center; direction:rtl; margin-top:56px; padding:20px;
    border-top:1px solid rgba(0,200,255,0.06);
    position:relative;
">
    <div style="
        position:absolute; top:-1px; left:50%; transform:translateX(-50%);
        width:80px; height:1px;
        background:linear-gradient(90deg,transparent,rgba(0,200,255,0.25),transparent);
    "></div>
    <span style="
        color:#334155; font-size:0.7rem; font-weight:500;
        letter-spacing:0.08em; text-transform:uppercase;
        font-family:'Space Grotesk','Inter',sans-serif;
    ">
        Invoice Intelligence Console &nbsp;·&nbsp; כל הנתונים מעובדים באופן מקומי בלבד
    </span>
</div>
""", unsafe_allow_html=True)
