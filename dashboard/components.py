"""
רכיבי ממשק משתמש — עיצוב Ultra-Premium Holographic Fintech Console.
"""

import streamlit as st
import pandas as pd
from datetime import datetime


def inject_css():
    """מזריק CSS בסגנון Holographic Intelligence Console."""
    st.markdown("""
<style>
/* ══════════════════════════════════════════════════════════════════════
   INVOICE INTELLIGENCE CONSOLE — Ultra-Premium Dark System
   Design: Holographic Fintech · Cinematic Sci-Fi · RTL-First
   ══════════════════════════════════════════════════════════════════════ */

@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&display=swap');

/* ── CSS Custom Properties ─────────────────────────────────────────── */
:root {
    --bg-void:        #060A12;
    --bg-deep:        #080D18;
    --bg-surface:     #0C1322;
    --bg-panel:       #0D1528;
    --bg-elevated:    #111D35;

    --border-subtle:  rgba(255,255,255,0.04);
    --border-dim:     rgba(255,255,255,0.07);
    --border-soft:    rgba(255,255,255,0.11);

    --cyan:           #00C8FF;
    --cyan-bright:    #22D3EE;
    --cyan-glow:      rgba(0,200,255,0.30);
    --cyan-dim:       rgba(0,200,255,0.10);

    --violet:         #818CF8;
    --violet-bright:  #A78BFA;
    --violet-glow:    rgba(129,140,248,0.30);
    --violet-dim:     rgba(129,140,248,0.10);

    --emerald:        #34D399;
    --emerald-glow:   rgba(52,211,153,0.30);
    --emerald-dim:    rgba(52,211,153,0.10);

    --amber:          #FCD34D;
    --amber-glow:     rgba(252,211,77,0.30);

    --text-primary:   #EFF6FF;
    --text-secondary: #94A3B8;
    --text-muted:     #64748B;

    --font-sans: 'Space Grotesk','Inter','Segoe UI',system-ui,sans-serif;
    --font-mono: 'Cascadia Code','JetBrains Mono','Consolas',monospace;

    --radius-sm:  8px;
    --radius-md:  12px;
    --radius-lg:  18px;
    --radius-xl:  24px;
    --radius-2xl: 32px;

    --shadow-depth: 0 24px 80px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.4);
    --shadow-card:  0 4px 24px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3);
}

/* ── Global Reset & Base ───────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }

html, body {
    direction: rtl;
    font-family: var(--font-sans);
}

/* ── App Container ─────────────────────────────────────────────────── */
[data-testid="stAppViewContainer"],
[data-testid="stAppViewContainer"] > .main {
    background: var(--bg-void);
    background-image:
        radial-gradient(ellipse 90% 55% at 15% -5%, rgba(0,180,255,0.07) 0%, transparent 60%),
        radial-gradient(ellipse 70% 50% at 85% 105%, rgba(129,140,248,0.06) 0%, transparent 60%),
        radial-gradient(ellipse 50% 40% at 50% 50%, rgba(0,0,0,0.35) 0%, transparent 70%);
    color: var(--text-primary);
    font-family: var(--font-sans);
    direction: rtl;
}

/* Subtle dot-grid overlay */
[data-testid="stAppViewContainer"]::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
        radial-gradient(circle, rgba(0,200,255,0.035) 1px, transparent 1px);
    background-size: 40px 40px;
    pointer-events: none;
    z-index: 0;
}

.block-container {
    padding-top: 2rem !important;
    padding-bottom: 4rem !important;
    max-width: 1440px;
    position: relative;
    z-index: 1;
}

/* ── Sidebar — Alien Command Panel ─────────────────────────────────── */
[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #07101E 0%, #050B16 100%) !important;
    border-left: 1px solid rgba(0,200,255,0.10) !important;
    border-right: none !important;
    box-shadow: 4px 0 40px rgba(0,0,0,0.6), inset -1px 0 0 rgba(0,200,255,0.05) !important;
    position: relative;
}

[data-testid="stSidebar"]::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, var(--cyan), var(--violet), transparent);
    opacity: 0.5;
}

[data-testid="stSidebar"] * {
    color: var(--text-primary) !important;
    direction: rtl;
    text-align: right;
    font-family: var(--font-sans) !important;
}

[data-testid="stSidebar"] .stSlider label,
[data-testid="stSidebar"] .stTextArea label,
[data-testid="stSidebar"] .stCheckbox label,
[data-testid="stSidebar"] .stTextInput label {
    color: var(--cyan) !important;
    font-weight: 700;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    opacity: 0.85;
}

[data-testid="stSidebar"] hr {
    border-color: rgba(0,200,255,0.08) !important;
    margin: 16px 0;
}

/* ── Metric Cards — Holographic Status Modules ─────────────────────── */
[data-testid="stMetric"] {
    background: linear-gradient(150deg, var(--bg-panel) 0%, var(--bg-surface) 100%);
    border-radius: var(--radius-lg);
    padding: 24px 28px;
    border: 1px solid var(--border-dim);
    box-shadow: var(--shadow-card);
    direction: rtl;
    text-align: right;
    position: relative;
    overflow: hidden;
    transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1),
                box-shadow 0.3s ease, border-color 0.3s ease;
    backdrop-filter: blur(12px);
}

[data-testid="stMetric"]::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(0,200,255,0.35), transparent);
}

[data-testid="stMetric"]::after {
    content: '';
    position: absolute;
    bottom: -50px; left: -50px;
    width: 140px; height: 140px;
    background: radial-gradient(circle, rgba(0,200,255,0.05) 0%, transparent 70%);
    border-radius: 50%;
    pointer-events: none;
}

[data-testid="stMetric"]:hover {
    transform: translateY(-5px) scale(1.01);
    box-shadow: 0 16px 48px rgba(0,0,0,0.55), 0 0 28px rgba(0,200,255,0.10);
    border-color: rgba(0,200,255,0.18);
}

[data-testid="stMetricLabel"] {
    color: var(--cyan) !important;
    font-size: 0.65rem;
    font-weight: 700;
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    opacity: 0.85;
}

[data-testid="stMetricValue"] {
    color: var(--text-primary) !important;
    font-size: 2.1rem;
    font-weight: 800;
    text-align: right;
    letter-spacing: -0.03em;
    line-height: 1.1;
    font-family: var(--font-sans) !important;
}

[data-testid="stMetricDelta"] {
    font-size: 0.8rem;
    font-weight: 600;
}

/* ── Buttons — Glowing Action Controls ────────────────────────────── */
.stButton > button {
    background: linear-gradient(135deg, rgba(0,180,255,0.12) 0%, rgba(129,140,248,0.08) 100%) !important;
    color: var(--cyan-bright) !important;
    border: 1px solid rgba(0,200,255,0.22) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 700;
    font-size: 0.88rem;
    padding: 11px 24px;
    direction: rtl;
    width: 100%;
    cursor: pointer;
    letter-spacing: 0.04em;
    transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1) !important;
    font-family: var(--font-sans) !important;
    backdrop-filter: blur(8px);
}

.stButton > button:hover {
    background: linear-gradient(135deg, rgba(0,200,255,0.22) 0%, rgba(129,140,248,0.18) 100%) !important;
    border-color: rgba(0,200,255,0.45) !important;
    box-shadow: 0 0 22px rgba(0,200,255,0.18), 0 4px 16px rgba(0,0,0,0.4) !important;
    transform: translateY(-2px);
    color: #ffffff !important;
}

.stButton > button:active {
    transform: translateY(0) scale(0.98) !important;
    box-shadow: 0 0 10px rgba(0,200,255,0.15) !important;
}

/* Scan button — primary electric accent */
.sidebar-scan-btn > div > button {
    background: linear-gradient(135deg, #0369A1 0%, #0EA5E9 50%, #22D3EE 100%) !important;
    color: #ffffff !important;
    border: 1px solid rgba(0,200,255,0.45) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 800 !important;
    font-size: 0.93rem !important;
    letter-spacing: 0.05em !important;
    box-shadow: 0 4px 22px rgba(0,180,255,0.40), 0 0 40px rgba(0,180,255,0.10) !important;
    transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1) !important;
    text-shadow: 0 1px 4px rgba(0,0,0,0.35);
}

.sidebar-scan-btn > div > button:hover {
    transform: translateY(-3px) !important;
    box-shadow: 0 8px 36px rgba(0,180,255,0.55), 0 0 64px rgba(0,180,255,0.14) !important;
    background: linear-gradient(135deg, #0EA5E9 0%, #22D3EE 50%, #38BDF8 100%) !important;
}

.sidebar-scan-btn > div > button:active {
    transform: translateY(0) scale(0.98) !important;
}

/* Download button — emerald accent */
[data-testid="stDownloadButton"] > button {
    background: linear-gradient(135deg, rgba(16,185,129,0.15) 0%, rgba(52,211,153,0.08) 100%) !important;
    color: var(--emerald) !important;
    border: 1px solid rgba(52,211,153,0.28) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 700;
    letter-spacing: 0.04em;
    transition: all 0.25s ease !important;
    backdrop-filter: blur(8px);
}

[data-testid="stDownloadButton"] > button:hover {
    background: linear-gradient(135deg, rgba(52,211,153,0.28) 0%, rgba(16,185,129,0.18) 100%) !important;
    border-color: rgba(52,211,153,0.50) !important;
    box-shadow: 0 0 22px rgba(52,211,153,0.18), 0 4px 16px rgba(0,0,0,0.35) !important;
    transform: translateY(-2px);
    color: #ffffff !important;
}

/* Link buttons (Google connect) */
.stLinkButton > a {
    background: linear-gradient(135deg, #0369A1 0%, #0EA5E9 50%, #22D3EE 100%) !important;
    color: #ffffff !important;
    border: 1px solid rgba(0,200,255,0.45) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 800 !important;
    font-size: 0.93rem !important;
    letter-spacing: 0.05em !important;
    box-shadow: 0 4px 22px rgba(0,180,255,0.40) !important;
    transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1) !important;
    text-decoration: none !important;
    display: block !important;
    text-align: center !important;
}

.stLinkButton > a:hover {
    transform: translateY(-3px) !important;
    box-shadow: 0 8px 36px rgba(0,180,255,0.55) !important;
}

/* ── Data Table — Cyber Data Grid ──────────────────────────────────── */
[data-testid="stDataFrame"] {
    background: linear-gradient(150deg, var(--bg-panel) 0%, var(--bg-surface) 100%);
    border: 1px solid rgba(0,200,255,0.09);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-card), 0 0 40px rgba(0,0,0,0.3);
    backdrop-filter: blur(12px);
}

/* ── Text Inputs ───────────────────────────────────────────────────── */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea {
    background: rgba(6,10,18,0.92) !important;
    color: var(--text-primary) !important;
    border: 1px solid var(--border-soft) !important;
    border-radius: var(--radius-md) !important;
    direction: rtl;
    text-align: right;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    font-family: var(--font-sans) !important;
    backdrop-filter: blur(8px);
}

.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: rgba(0,200,255,0.40) !important;
    box-shadow: 0 0 0 3px rgba(0,200,255,0.09), 0 0 18px rgba(0,200,255,0.07) !important;
}

.stTextInput label, .stTextArea label {
    color: var(--cyan) !important;
    font-weight: 700;
    direction: rtl;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.65rem;
    opacity: 0.85;
}

/* ── Select / Dropdown ─────────────────────────────────────────────── */
[data-testid="stSelectbox"] > div > div {
    background: rgba(6,10,18,0.92) !important;
    border: 1px solid var(--border-soft) !important;
    border-radius: var(--radius-md) !important;
    color: var(--text-primary) !important;
    backdrop-filter: blur(8px);
    transition: border-color 0.2s ease !important;
}

[data-testid="stSelectbox"] > div > div:hover {
    border-color: rgba(0,200,255,0.28) !important;
}

/* ── Progress Bar ──────────────────────────────────────────────────── */
.stProgress > div > div > div {
    background: linear-gradient(90deg, var(--cyan), var(--violet)) !important;
    border-radius: 4px;
    box-shadow: 0 0 8px var(--cyan-glow);
}

.stProgress > div > div {
    background: rgba(255,255,255,0.05) !important;
    border-radius: 4px;
}

/* ── Alerts ────────────────────────────────────────────────────────── */
[data-testid="stAlert"] {
    background: rgba(0,180,255,0.06) !important;
    border-radius: var(--radius-md) !important;
    border: 1px solid rgba(0,200,255,0.13) !important;
    border-right: 3px solid var(--cyan) !important;
    border-left: none !important;
    color: var(--text-primary) !important;
    direction: rtl;
    text-align: right;
    backdrop-filter: blur(8px);
}

/* ── Expander ──────────────────────────────────────────────────────── */
[data-testid="stExpander"] {
    background: rgba(6,10,18,0.65) !important;
    border: 1px solid var(--border-dim) !important;
    border-radius: var(--radius-md) !important;
    backdrop-filter: blur(8px);
    direction: rtl;
}

[data-testid="stExpander"] summary {
    direction: rtl;
    color: var(--text-muted) !important;
    font-size: 0.82rem;
}

[data-testid="stExpander"] summary:hover {
    color: var(--text-secondary) !important;
}

/* ── Headings ──────────────────────────────────────────────────────── */
h1, h2, h3, h4, h5, h6 {
    color: var(--text-primary);
    direction: rtl;
    text-align: right;
    font-family: var(--font-sans) !important;
    letter-spacing: -0.02em;
}

/* ── Dividers ──────────────────────────────────────────────────────── */
hr {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 28px 0;
    position: relative;
}

hr::after {
    content: '';
    position: absolute;
    top: -1px; left: 50%; transform: translateX(-50%);
    width: 80px; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(0,200,255,0.28), transparent);
}

/* ── Scrollbar ─────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: var(--bg-void); }
::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, var(--cyan), var(--violet));
    border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover { opacity: 1; }

/* ── Column direction ──────────────────────────────────────────────── */
[data-testid="column"] { direction: rtl; }

/* ── Caption ───────────────────────────────────────────────────────── */
.stCaption, [data-testid="stCaptionContainer"] {
    color: var(--text-muted) !important;
    direction: rtl;
    text-align: right;
    font-size: 0.75rem;
}

/* ── Custom Component Classes ──────────────────────────────────────── */

/* Holographic glass card */
.holo-card {
    background: linear-gradient(150deg, rgba(13,21,40,0.92) 0%, rgba(8,13,24,0.96) 100%);
    border: 1px solid rgba(0,200,255,0.10);
    border-radius: var(--radius-xl);
    padding: 32px;
    position: relative;
    overflow: hidden;
    backdrop-filter: blur(24px);
    box-shadow: var(--shadow-depth);
    transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.holo-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(0,200,255,0.45),
                rgba(129,140,248,0.30), transparent);
}

.holo-card:hover {
    border-color: rgba(0,200,255,0.18);
    box-shadow: var(--shadow-depth), 0 0 48px rgba(0,200,255,0.05);
}

/* Section title with glowing right accent (RTL) */
.section-title {
    color: var(--text-primary);
    font-size: 1.05rem;
    font-weight: 700;
    direction: rtl;
    text-align: right;
    margin-bottom: 20px;
    padding-right: 14px;
    border-right: 2px solid var(--cyan);
    position: relative;
    letter-spacing: -0.01em;
}

.section-title::after {
    content: '';
    position: absolute;
    right: -2px; top: 0; bottom: 0;
    width: 2px;
    background: var(--cyan);
    box-shadow: 0 0 14px var(--cyan-glow), 0 0 5px var(--cyan);
}
</style>
""", unsafe_allow_html=True)


def render_sidebar() -> dict:
    """מציג את סרגל הצד עם הגדרות הסריקה ומחזיר dict של פרמטרים."""
    with st.sidebar:
        st.markdown("""
        <div style="
            padding: 20px 0 28px 0;
            border-bottom: 1px solid rgba(0,200,255,0.08);
            margin-bottom: 24px;
        ">
            <div style="
                font-size: 0.6rem; font-weight: 700;
                color: #00C8FF; text-transform: uppercase;
                letter-spacing: 0.18em; margin-bottom: 8px;
                opacity: 0.8;
            ">Invoice Intelligence</div>
            <div style="
                font-size: 1.05rem; font-weight: 800;
                color: #EFF6FF; letter-spacing: -0.02em;
            ">הגדרות סריקה</div>
            <div style="
                width: 28px; height: 2px; margin-top: 10px;
                background: linear-gradient(90deg, #00C8FF, #818CF8);
                border-radius: 2px;
            "></div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown(
            '<p style="color:#00C8FF; font-size:0.62rem; text-transform:uppercase; '
            'letter-spacing:0.15em; font-weight:700; margin-bottom:10px; opacity:0.8;">טווח תאריכים</p>',
            unsafe_allow_html=True,
        )

        _DAY_OPTIONS = [("7 ימים", 7), ("30 יום", 30), ("90 יום", 90), ("שנה", 365)]

        if "days_back" not in st.session_state:
            st.session_state["days_back"] = 30

        cols = st.columns(len(_DAY_OPTIONS))
        for col, (label, val) in zip(cols, _DAY_OPTIONS):
            with col:
                is_active = st.session_state["days_back"] == val
                if st.button(
                    label,
                    key=f"days_btn_{val}",
                    use_container_width=True,
                    type="primary" if is_active else "secondary",
                ):
                    st.session_state["days_back"] = val

        days_back = st.session_state["days_back"]

        keywords_raw = st.text_area(
            "מילות מפתח (שורה לכל מילה)",
            value="חשבונית\nקבלה\nאישור תשלום\ninvoice\nreceipt",
            height=140,
            help="כל מילה בשורה נפרדת",
        )

        unread_only = st.checkbox(
            "רק הודעות שלא נקראו",
            value=True,
            help="סנן רק הודעות שטרם נקראו",
        )

        st.markdown('<div style="height:28px;"></div>', unsafe_allow_html=True)
        st.markdown('<div class="sidebar-scan-btn">', unsafe_allow_html=True)
        start_scan = st.button("🚀  התחל סריקה", type="primary", use_container_width=True)
        st.markdown("</div>", unsafe_allow_html=True)

    keywords = [k.strip() for k in keywords_raw.splitlines() if k.strip()]
    return {"days_back": days_back, "keywords": keywords, "unread_only": unread_only, "start_scan": start_scan, "output_dir": "output"}


def render_header():
    """מציג את הכותרת הראשית — Cinematic Intelligence Console Header."""
    st.markdown("""
    <div style="
        background: linear-gradient(145deg, rgba(8,16,36,0.98) 0%, rgba(6,10,18,0.99) 100%);
        border: 1px solid rgba(0,200,255,0.12);
        border-radius: 22px;
        padding: 36px 40px;
        margin-bottom: 28px;
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(24px);
        box-shadow: 0 8px 40px rgba(0,0,0,0.55), 0 0 80px rgba(0,150,255,0.04);
    ">
        <div style="
            position: absolute; top: 0; left: 0; right: 0; height: 2px;
            background: linear-gradient(90deg, transparent 0%, #00C8FF 25%, #818CF8 60%, #34D399 85%, transparent 100%);
            border-radius: 22px 22px 0 0;
            opacity: 0.75;
        "></div>
        <div style="
            position: absolute; top: 18px; right: 18px;
            width: 22px; height: 22px;
            border-top: 1px solid rgba(0,200,255,0.35);
            border-right: 1px solid rgba(0,200,255,0.35);
            border-radius: 0 5px 0 0;
        "></div>
        <div style="
            position: absolute; bottom: 18px; left: 18px;
            width: 22px; height: 22px;
            border-bottom: 1px solid rgba(129,140,248,0.35);
            border-left: 1px solid rgba(129,140,248,0.35);
            border-radius: 0 0 5px 0;
        "></div>
        <div style="position: relative; z-index: 1; direction: rtl; text-align: right;">
            <div style="
                font-size: 0.62rem; font-weight: 700; color: #00C8FF;
                text-transform: uppercase; letter-spacing: 0.18em; margin-bottom: 10px;
                opacity: 0.8;
            ">
                ● LIVE &nbsp;·&nbsp; מערכת ניהול חשבוניות
            </div>
            <h1 style="
                color: #EFF6FF; font-size: 2.1rem; font-weight: 900;
                margin: 0 0 10px 0; letter-spacing: -0.03em; line-height: 1.08;
                text-align: right; font-family: 'Space Grotesk','Inter',sans-serif;
            ">
                חשבוניות חכמה
            </h1>
            <p style="
                color: #64748B; font-size: 0.92rem; margin: 0;
                font-weight: 400; text-align: right; line-height: 1.6;
            ">
                סורק ומנתח חשבוניות וקבלות מתיבת הדואר האלקטרוני שלך — בזמן אמת
            </p>
        </div>
        <div style="
            position: absolute; bottom: -60px; left: -60px;
            width: 200px; height: 200px;
            background: radial-gradient(circle, rgba(0,180,255,0.07) 0%, transparent 70%);
            border-radius: 50%; pointer-events: none;
        "></div>
        <div style="
            position: absolute; top: -40px; right: 20%;
            width: 160px; height: 160px;
            background: radial-gradient(circle, rgba(129,140,248,0.05) 0%, transparent 70%);
            border-radius: 50%; pointer-events: none;
        "></div>
    </div>
    """, unsafe_allow_html=True)


_METRIC_ACCENTS = ["#00C8FF", "#34D399", "#FCD34D", "#818CF8"]


def render_metrics(results: list[dict]):
    """מציג 4 כרטיסי מדד — Holographic Status Modules."""
    if not results:
        return

    total = len(results)
    with_att = sum(1 for r in results if r.get("saved_path") or r.get("attachments"))
    unique_senders = len({r.get("sender", "") for r in results if r.get("sender")})

    from email.utils import parsedate_to_datetime
    dates = []
    for r in results:
        try:
            dates.append(parsedate_to_datetime(r.get("date", "")))
        except Exception:
            pass

    date_range = f"{min(dates).strftime('%d/%m/%y')} — {max(dates).strftime('%d/%m/%y')}" if dates else "—"

    metrics = [
        ('סה"כ חשבוניות', total, "#00C8FF", "📄"),
        ("עם קובץ מצורף", with_att, "#34D399", "📎"),
        ("שולחים ייחודיים", unique_senders, "#FCD34D", "👤"),
        ("טווח תאריכים", date_range, "#818CF8", "📅"),
    ]

    c1, c2, c3, c4 = st.columns(4)
    for col, (label, value, accent, icon) in zip([c1, c2, c3, c4], metrics):
        with col:
            st.markdown(
                f'<div style="height:2px; '
                f'background:linear-gradient(90deg,{accent},{accent}88); '
                f'border-radius:2px; margin-bottom:4px; '
                f'box-shadow:0 0 8px {accent}66;"></div>',
                unsafe_allow_html=True,
            )
            st.metric(label, value)


def render_results_table(results: list[dict]):
    """מציג טבלה ניתנת לחיפוש עם כפתור הורדת CSV."""
    st.markdown('<div class="section-title">רשימת חשבוניות</div>', unsafe_allow_html=True)

    if not results:
        st.warning("לא נמצאו חשבוניות.")
        return

    col_search, col_spacer = st.columns([3, 1])
    with col_search:
        search_term = st.text_input(
            "חיפוש",
            placeholder="חפש לפי שולח, נושא, תאריך...",
            label_visibility="collapsed",
        )

    rows = []
    for r in results:
        rows.append({
            "מזהה":       r.get("uid", ""),
            "תאריך":      r.get("date", "")[:25] if r.get("date") else "",
            "שולח":       r.get("sender", ""),
            "נושא":       r.get("subject", ""),
            "קובץ מצורף": "✅" if r.get("saved_path") else "—",
            "נתיב קובץ":  r.get("saved_path", ""),
            "הערות":      r.get("notes", ""),
        })

    df = pd.DataFrame(rows)

    if search_term:
        mask = df.apply(lambda col: col.astype(str).str.contains(search_term, case=False, na=False)).any(axis=1)
        df = df[mask]
        st.caption(f"נמצאו **{len(df)}** תוצאות מתוך {len(results)}")
    else:
        st.caption(f"מציג **{len(df)}** חשבוניות")

    st.dataframe(df, use_container_width=True, hide_index=True)

    if not df.empty:
        col_dl, col_sp = st.columns([1, 3])
        with col_dl:
            csv_data = df.to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig")
            st.download_button(
                label="⬇️  הורד CSV",
                data=csv_data,
                file_name=f"חשבוניות_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True,
            )
