# -*- coding: utf-8 -*-
"""
UI components — Invoice Fetcher product experience.
Typography: Heebo (Hebrew body) + DM Sans (display) + JetBrains Mono (data).
Two-phase layout: scan composer (pre-results) / results narrative (post-results).
"""

import html
import re
import streamlit as st
import pandas as pd
from datetime import datetime
from email.utils import parseaddr, parsedate_to_datetime


# ── Company normalization ────────────────────────────────────────────────────

_COMPANY_NOISE = re.compile(
    r"\s*\b(ltd|inc|llc|co|corp|gmbh|בע[\"'" + "\u2019" + r"]?מ|ע\.?ר)\b\.?\s*",
    re.IGNORECASE,
)

_NOREPLY_RE = re.compile(
    r"^(no-?reply|info|billing|invoices?|receipts?|support|noreply|mailer-daemon)$",
    re.IGNORECASE,
)

_FREE_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com",
    "outlook.com", "live.com", "aol.com", "icloud.com", "mail.com",
    "walla.co.il", "012.net.il", "013.net", "bezeqint.net",
}


def _extract_company(sender: str) -> str:
    if not sender:
        return "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2"
    _email_match = re.search(r"<([^>]+)>", sender)
    if _email_match:
        email_addr = _email_match.group(1).strip()
        display_name = sender[: _email_match.start()].strip().strip('"').strip("'").strip()
    else:
        display_name, email_addr = parseaddr(sender)
        display_name = display_name.strip().strip('"').strip("'").strip()
    if display_name and not _NOREPLY_RE.match(display_name):
        label = _COMPANY_NOISE.sub(" ", display_name).strip()
        if label:
            return label
    if email_addr and "@" in email_addr:
        local, domain = email_addr.rsplit("@", 1)
        domain = domain.lower()
        if domain in _FREE_DOMAINS:
            return email_addr.lower()
        parts = domain.split(".")
        label_parts = [p for p in parts if p not in ("com", "co", "il", "org", "net", "io", "gov", "ac", "www")]
        label = label_parts[0] if label_parts else parts[0]
        return label.replace("-", " ").replace("_", " ").title()
    return sender.strip() or "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2"


# ── Shared constants ─────────────────────────────────────────────────────────

_DAY_OPTIONS = [("30 \u05d9\u05de\u05d9\u05dd", 30), ("90 \u05d9\u05de\u05d9\u05dd", 90), ("\u05d4\u05e9\u05e0\u05d4", 365)]

_DEFAULT_KEYWORDS = (
    "\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea\n\u05e7\u05d1\u05dc\u05d4\n\u05d7\u05e9\u05d1\u05d5\u05df\n"
    "\u05d7\u05d9\u05d5\u05d1\n\u05ea\u05e9\u05dc\u05d5\u05dd\n\u05d0\u05d9\u05e9\u05d5\u05e8 \u05ea\u05e9\u05dc\u05d5\u05dd\n"
    "invoice\nreceipt\nbilling\npayment"
)


# ══════════════════════════════════════════════════════════════════════════════
#  CSS — Product Design System
# ══════════════════════════════════════════════════════════════════════════════

def inject_css():
    """Inject premium design system CSS — Obsidian Luxe aesthetic."""
    from dashboard._styles import FONT_LINK, DESIGN_CSS
    st.markdown(FONT_LINK, unsafe_allow_html=True)
    st.markdown(DESIGN_CSS, unsafe_allow_html=True)
    return  # design system loaded from _styles.py

    # ── Legacy CSS below (dead code, kept for reference) ──────────────
    st.markdown("""
<style>
/* ======================================================================
   Invoice Fetcher — Product Design System
   ====================================================================== */

@keyframes fadein {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadein-slow {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes number-in {
    from { opacity: 0; transform: scale(0.85) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.45; }
}

/* -- Tokens ------------------------------------------------------------ */
:root {
    --bg-base:       #0b0e14;
    --bg-raised:     #131720;
    --bg-overlay:    #1a1f2a;
    --bg-subtle:     #101418;

    --primary:       #4CC9F0;
    --on-primary:    #062A3A;
    --primary-dim:   rgba(76,201,240,0.08);
    --primary-border:rgba(76,201,240,0.16);

    --secondary:     #34D399;
    --on-secondary:  #022C22;
    --secondary-dim: rgba(52,211,153,0.08);
    --secondary-border:rgba(52,211,153,0.16);

    --tertiary:      #F4A261;
    --tertiary-dim:  rgba(244,162,97,0.08);

    --error:         #F87171;
    --error-dim:     rgba(248,113,113,0.08);
    --error-border:  rgba(248,113,113,0.16);

    --on-surface:    #E8ECF4;
    --on-surface-v:  #B0B8C8;
    --outline:       #6B7A8D;
    --outline-variant:rgba(255,255,255,0.06);
    --text-muted:    #7E8C9F;
    --text-faint:    #515d6f;

    --font-body:   'Heebo', system-ui, -apple-system, sans-serif;
    --font-display:'DM Sans', 'Heebo', system-ui, sans-serif;
    --font-mono:   'JetBrains Mono', 'Courier New', monospace;

    --radius-sm: 8px;  --radius-md: 10px;  --radius-lg: 14px;  --radius-xl: 18px;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.24);
    --shadow-md: 0 4px 20px rgba(0,0,0,0.28);
    --shadow-lg: 0 8px 40px rgba(0,0,0,0.36);
    --shadow-glow:0 0 40px rgba(76,201,240,0.06);
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
    --dur: 0.2s;
}

/* -- Reset & Global ---------------------------------------------------- */
*, *::before, *::after { box-sizing: border-box; }
html, body { direction: rtl; font-family: var(--font-body); -webkit-font-smoothing: antialiased; }

[data-testid="stAppViewContainer"],
[data-testid="stAppViewContainer"] > .main {
    background: var(--bg-base); color: var(--on-surface);
    font-family: var(--font-body); direction: rtl;
}

/* -- Hide Streamlit chrome --------------------------------------------- */
#MainMenu { visibility: hidden !important; }
header[data-testid="stHeader"] { background: transparent !important; height: 0 !important; min-height: 0 !important; }
[data-testid="stToolbar"],
.stDeployButton,
[data-testid="stDecoration"] { display: none !important; }
footer { visibility: hidden !important; }

.block-container {
    padding-top: 2rem !important;
    padding-bottom: 2rem !important;
    max-width: 1100px;
    animation: fadein 0.25s var(--ease) both;
}

/* -- Sidebar ----------------------------------------------------------- */
[data-testid="stSidebar"] {
    background: var(--bg-subtle) !important;
    border-left: 1px solid var(--outline-variant) !important;
    border-right: none !important;
    width: 280px !important;
}
[data-testid="stSidebar"] * {
    color: var(--on-surface) !important; direction: rtl; text-align: right;
    font-family: var(--font-body) !important;
}
[data-testid="stSidebar"] .stSlider label,
[data-testid="stSidebar"] .stTextArea label,
[data-testid="stSidebar"] .stCheckbox label,
[data-testid="stSidebar"] .stTextInput label {
    color: var(--text-muted) !important; font-weight: 600; font-size: 0.68rem;
    letter-spacing: 0.04em; text-transform: uppercase; font-family: var(--font-display) !important;
}
[data-testid="stSidebar"] hr { border-color: var(--outline-variant) !important; margin: 14px 0; }
[data-testid="stSidebar"] .stTextArea textarea { font-size: 0.78rem !important; line-height: 1.55 !important; }

/* Hide sidebar in composer phase */
.hide-sidebar [data-testid="stSidebar"],
.hide-sidebar [data-testid="stSidebarCollapsedControl"],
.hide-sidebar button[kind="headerNoPadding"] { display: none !important; }

/* -- Buttons ----------------------------------------------------------- */
.stButton > button {
    background: var(--bg-overlay) !important; color: var(--on-surface-v) !important;
    border: 1px solid var(--outline-variant) !important; border-radius: var(--radius-md) !important;
    font-weight: 600; font-size: 0.8rem; padding: 9px 18px; direction: rtl; width: 100%; cursor: pointer;
    transition: all var(--dur) var(--ease) !important; font-family: var(--font-body) !important;
}
.stButton > button:hover {
    background: var(--bg-surface-bright, #2a3040) !important; color: var(--on-surface) !important;
    border-color: rgba(255,255,255,0.10) !important; transform: translateY(-1px) !important;
    box-shadow: var(--shadow-md) !important;
}
.stButton > button:active { transform: translateY(0) scale(0.98) !important; }

.stButton > button[kind="primary"],
[data-testid="stBaseButton-primary"] {
    background: var(--primary) !important; color: var(--on-primary) !important;
    font-weight: 700 !important; border: none !important;
}
.stButton > button[kind="primary"]:hover,
[data-testid="stBaseButton-primary"]:hover {
    box-shadow: 0 4px 20px rgba(76,201,240,0.20) !important; transform: translateY(-1px) !important;
}

[data-testid="stDownloadButton"] > button {
    background: var(--secondary-dim) !important; color: var(--secondary) !important;
    border: 1px solid var(--secondary-border) !important; border-radius: var(--radius-md) !important;
    font-weight: 600; font-size: 0.8rem; transition: all var(--dur) var(--ease) !important;
}
[data-testid="stDownloadButton"] > button:hover {
    background: rgba(52,211,153,0.12) !important; transform: translateY(-1px) !important;
}

.stLinkButton > a {
    background: var(--primary) !important; color: var(--on-primary) !important;
    border: none !important; border-radius: var(--radius-md) !important; font-weight: 700 !important;
    font-size: 0.84rem !important; padding: 12px 20px !important;
    transition: all var(--dur) var(--ease) !important;
    text-decoration: none !important; display: block !important; text-align: center !important;
}
.stLinkButton > a:hover {
    box-shadow: 0 6px 24px rgba(76,201,240,0.22) !important; transform: translateY(-1px) !important;
}

/* -- Data Table -------------------------------------------------------- */
[data-testid="stDataFrame"],
[data-testid="stDataEditor"] {
    background: var(--bg-raised); border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg); overflow: hidden;
}
[data-testid="stDataFrame"] th,
[data-testid="stDataEditor"] th {
    font-size: 0.68rem !important; font-weight: 700 !important;
    text-transform: uppercase !important; letter-spacing: 0.04em !important;
    font-family: var(--font-display) !important;
}

/* -- Inputs ------------------------------------------------------------ */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea {
    background: var(--bg-base) !important; color: var(--on-surface) !important;
    border: 1px solid var(--outline-variant) !important; border-radius: var(--radius-md) !important;
    direction: rtl; text-align: right; font-family: var(--font-body) !important;
    transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: rgba(76,201,240,0.30) !important; box-shadow: 0 0 0 3px var(--primary-dim) !important;
}
.stTextInput label, .stTextArea label {
    color: var(--text-muted) !important; font-weight: 600; direction: rtl;
    letter-spacing: 0.04em; font-size: 0.68rem; text-transform: uppercase;
    font-family: var(--font-display) !important;
}

[data-testid="stSelectbox"] > div > div {
    background: var(--bg-base) !important; border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-md) !important; color: var(--on-surface) !important;
}

/* -- Progress ---------------------------------------------------------- */
.stProgress > div > div > div { background: var(--primary) !important; border-radius: 3px; }
.stProgress > div > div { background: var(--bg-overlay) !important; border-radius: 3px; height: 3px !important; }

/* -- Alerts ------------------------------------------------------------ */
[data-testid="stAlert"] {
    background: var(--bg-raised) !important; border-radius: var(--radius-lg) !important;
    border: 1px solid var(--outline-variant) !important;
    border-right: 3px solid var(--primary) !important; border-left: none !important;
    color: var(--on-surface) !important; direction: rtl; text-align: right;
}

/* -- Expander ---------------------------------------------------------- */
[data-testid="stExpander"] {
    background: var(--bg-raised) !important; border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-lg) !important; direction: rtl;
}
[data-testid="stExpander"] summary { direction: rtl; color: var(--text-muted) !important; font-size: 0.84rem; font-weight: 500; }

/* -- Misc -------------------------------------------------------------- */
h1,h2,h3,h4,h5,h6 { color: var(--on-surface); direction: rtl; text-align: right; font-family: var(--font-display) !important; letter-spacing: -0.02em; }
hr { border: none; height: 1px; background: var(--outline-variant); margin: 20px 0; }
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }
[data-testid="column"] { direction: rtl; }
.stCaption, [data-testid="stCaptionContainer"] { color: var(--text-muted) !important; direction: rtl; text-align: right; font-size: 0.76rem; }
[data-testid="stCheckbox"] { direction: rtl; }
[data-testid="stStatusWidget"] { border: 1px solid var(--outline-variant) !important; border-radius: var(--radius-md) !important; background: var(--bg-raised) !important; }
[data-testid="stToast"] { background: var(--bg-overlay) !important; border: 1px solid var(--outline-variant) !important; border-radius: var(--radius-lg) !important; box-shadow: var(--shadow-lg) !important; }

/* -- Tabs — primary navigation ----------------------------------------- */
[data-testid="stTabs"] [data-baseweb="tab-list"] {
    gap: 0; border-bottom: 1px solid var(--outline-variant); background: transparent;
}
[data-testid="stTabs"] [data-baseweb="tab"] {
    border-radius: 0; font-family: var(--font-display) !important; font-weight: 600;
    font-size: 0.84rem; padding: 14px 22px;
    transition: all var(--dur) var(--ease); color: var(--text-muted) !important;
    border-bottom: 2px solid transparent;
}
[data-testid="stTabs"] [data-baseweb="tab"][aria-selected="true"] {
    color: var(--on-surface) !important; border-bottom-color: var(--primary) !important;
}
[data-testid="stTabs"] [data-baseweb="tab"]:hover { color: var(--on-surface) !important; }

/* ======================================================================
   PHASE 1 — SCAN COMPOSER
   ====================================================================== */

.composer-wrap {
    max-width: 500px; margin: 0 auto; padding: 56px 0 40px;
    text-align: center; direction: rtl;
    animation: fadein-slow 0.45s var(--ease) both;
}
.composer-icon {
    width: 56px; height: 56px; margin: 0 auto 24px;
    display: flex; align-items: center; justify-content: center;
    background: var(--primary-dim); border: 1px solid var(--primary-border);
    border-radius: var(--radius-lg); font-size: 1.6rem; line-height: 1;
    animation: number-in 0.5s var(--ease) 0.1s both;
}
.composer-title {
    font-size: 1.65rem; font-weight: 800; color: var(--on-surface);
    margin: 0 0 8px; font-family: var(--font-display);
    letter-spacing: -0.03em; line-height: 1.15;
    animation: fadein 0.4s var(--ease) 0.15s both;
}
.composer-sub {
    font-size: 0.88rem; color: var(--text-muted); margin: 0 0 36px;
    line-height: 1.6; font-family: var(--font-body);
    animation: fadein 0.4s var(--ease) 0.25s both;
}
.composer-form {
    background: var(--bg-raised); border: 1px solid var(--outline-variant);
    border-radius: var(--radius-xl); padding: 28px 28px 24px;
    text-align: right; direction: rtl;
    box-shadow: var(--shadow-md), var(--shadow-glow);
    animation: fadein-slow 0.5s var(--ease) 0.3s both;
}
.composer-section-label {
    font-size: 0.62rem; font-weight: 700; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px;
    font-family: var(--font-display); direction: rtl;
}
.composer-scan-btn > div > button {
    background: var(--primary) !important; color: var(--on-primary) !important;
    border: none !important; border-radius: var(--radius-md) !important;
    font-weight: 700 !important; font-size: 0.88rem !important;
    padding: 13px 20px !important; transition: all var(--dur) var(--ease) !important;
    box-shadow: 0 2px 12px rgba(76,201,240,0.20) !important;
}
.composer-scan-btn > div > button:hover {
    box-shadow: 0 6px 24px rgba(76,201,240,0.28) !important; transform: translateY(-2px) !important;
}
.composer-scan-btn > div > button:active { transform: translateY(0) scale(0.98) !important; }
.composer-footer {
    margin-top: 28px; color: var(--text-faint); font-size: 0.72rem;
    animation: fadein 0.5s var(--ease) 0.5s both;
}

/* ======================================================================
   PHASE 2 — RESULTS NARRATIVE
   ====================================================================== */

.results-hero {
    padding: 20px 0 16px; direction: rtl;
    animation: fadein 0.35s var(--ease) both;
}
.results-hero-top {
    display: flex; align-items: flex-start; justify-content: space-between;
    direction: rtl; margin-bottom: 4px;
}
.results-hero-count {
    font-size: 3rem; font-weight: 900; color: var(--on-surface);
    font-family: var(--font-display); letter-spacing: -0.04em; line-height: 1;
    animation: number-in 0.5s var(--ease) 0.1s both;
}
.results-hero-label {
    font-size: 1rem; font-weight: 600; color: var(--text-muted);
    font-family: var(--font-body); margin-bottom: 12px;
}
.results-hero-meta {
    display: flex; gap: 16px; align-items: center; direction: rtl; flex-wrap: wrap;
    animation: fadein 0.4s var(--ease) 0.2s both;
}
.meta-item {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.8rem; color: var(--text-muted);
}
.meta-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.meta-value {
    font-weight: 700; color: var(--on-surface-v);
    font-family: var(--font-mono); font-size: 0.78rem;
}

/* Connected chip */
.chip-connected {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.68rem; font-weight: 600; padding: 5px 12px;
    border-radius: 100px; background: var(--secondary-dim);
    color: var(--secondary); border: 1px solid var(--secondary-border);
    font-family: var(--font-body);
}
.chip-connected-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--secondary); animation: pulse-live 2.5s ease-in-out infinite;
}

/* Sidebar brand */
.sidebar-brand {
    padding: 16px 0 14px; border-bottom: 1px solid var(--outline-variant);
    margin-bottom: 18px; display: flex; flex-direction: row-reverse;
    align-items: center; gap: 12px;
}
.sidebar-brand-icon {
    width: 32px; height: 32px; background: var(--primary);
    border-radius: var(--radius-sm); display: flex; align-items: center;
    justify-content: center; font-size: 13px; color: var(--on-primary);
    font-weight: 800; font-family: var(--font-display); flex-shrink: 0;
}
.sidebar-brand-name {
    font-size: 0.86rem; font-weight: 700; color: var(--on-surface);
    letter-spacing: -0.02em; font-family: var(--font-display);
}
.sidebar-section {
    font-size: 0.6rem; font-weight: 700; color: var(--text-faint);
    text-transform: uppercase; letter-spacing: 0.06em; margin: 16px 0 8px;
    font-family: var(--font-display); direction: rtl;
}

/* Sidebar scan / disconnect buttons */
.sidebar-scan-btn > div > button {
    background: var(--primary) !important; color: var(--on-primary) !important;
    border: none !important; border-radius: var(--radius-md) !important;
    font-weight: 700 !important; font-size: 0.82rem !important;
    padding: 10px 16px !important; transition: all var(--dur) var(--ease) !important;
}
.sidebar-scan-btn > div > button:hover {
    box-shadow: 0 4px 16px rgba(76,201,240,0.22) !important; transform: translateY(-1px) !important;
}
.sidebar-disconnect-btn > div > button {
    background: transparent !important; color: var(--text-faint) !important;
    border: 1px solid var(--outline-variant) !important; font-size: 0.76rem !important;
    transition: all var(--dur) var(--ease) !important;
}
.sidebar-disconnect-btn > div > button:hover {
    color: var(--error) !important; border-color: var(--error-border) !important;
    background: var(--error-dim) !important;
}

/* Empty states */
.empty-hero {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 80px 28px 72px; direction: rtl; text-align: center;
    animation: fadein-slow 0.4s var(--ease) both;
}
.empty-hero-icon {
    width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-lg); font-size: 1.35rem; margin-bottom: 18px;
    border: 1px solid var(--outline-variant);
}
.empty-hero h3 { font-size: 1.05rem; font-weight: 700; color: var(--on-surface); margin: 0 0 8px; font-family: var(--font-display); }
.empty-hero p { font-size: 0.82rem; color: var(--text-muted); margin: 0; max-width: 320px; line-height: 1.65; }
.empty-hero p strong { color: var(--primary); font-weight: 600; }

/* Action bar (export summary) */
.action-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 18px; background: var(--bg-raised);
    border: 1px solid var(--outline-variant); border-radius: var(--radius-lg);
    direction: rtl; gap: 12px; flex-wrap: wrap;
}
.action-bar-stat { display: flex; align-items: center; gap: 8px; }
.action-bar-count { background: var(--primary-dim); color: var(--primary); font-weight: 700; padding: 2px 8px; border-radius: var(--radius-sm); font-size: 0.75rem; font-family: var(--font-mono); }
.action-bar-label { color: var(--text-muted); font-size: 0.72rem; }
.action-bar-sep { color: var(--text-faint); margin: 0 2px; font-size: 0.6rem; }
.action-bar-amount { color: var(--secondary); font-size: 0.75rem; font-weight: 600; font-family: var(--font-mono); }

/* Footer */
.app-footer {
    text-align: center; direction: rtl; margin-top: 48px; padding: 20px 0;
    border-top: 1px solid var(--outline-variant); color: var(--text-faint);
    font-size: 0.68rem; font-weight: 500; letter-spacing: 0.04em; font-family: var(--font-display);
}
</style>
""", unsafe_allow_html=True)


# ══════════════════════════════════════════════════════════════════════════════
#  App Shell — Product Header
# ══════════════════════════════════════════════════════════════════════════════

def render_app_shell():
    """Branded product header — visible in all authenticated states."""
    st.markdown(
        '<div class="app-shell">'
        '<div class="app-shell-brand">'
        '<span class="app-shell-logo">IF</span>'
        '<span class="app-shell-name">Invoice Fetcher</span>'
        '</div>'
        '<div class="chip-connected">'
        '<span class="chip-connected-dot"></span>'
        '\u05de\u05d7\u05d5\u05d1\u05e8'
        '</div>'
        '</div>',
        unsafe_allow_html=True,
    )


# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 1 — Scan Composer (pre-results)
# ══════════════════════════════════════════════════════════════════════════════

def render_scan_composer() -> dict:
    """Full-screen focused scan composer — the first thing users experience."""

    # Hide sidebar in composer phase
    st.markdown(
        '<style>'
        '[data-testid="stSidebar"],'
        '[data-testid="stSidebarCollapsedControl"],'
        'button[kind="headerNoPadding"] { display: none !important; }'
        '</style>',
        unsafe_allow_html=True,
    )

    _, center, _ = st.columns([1, 2.2, 1])

    with center:
        # Hero — product identity
        st.markdown(
            '<div class="composer-wrap">'
            '<div class="composer-accent"></div>'
            '<div class="composer-title">'
            '\u05e1\u05e8\u05d9\u05e7\u05ea \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea'
            '</div>'
            '<div class="composer-sub">'
            '\u05e1\u05e8\u05d5\u05e7 \u05d0\u05ea \u05ea\u05d9\u05d1\u05ea \u05d4\u05d3\u05d5\u05d0\u05e8 '
            '\u05d5\u05de\u05e6\u05d0 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea '
            '\u05d5\u05e7\u05d1\u05dc\u05d5\u05ea \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9\u05ea'
            '</div>'
            '</div>',
            unsafe_allow_html=True,
        )

        # Form card
        st.markdown('<div class="composer-form">', unsafe_allow_html=True)

        # Day range
        st.markdown(
            '<div class="composer-section-label">'
            '\u05d8\u05d5\u05d5\u05d7 \u05d6\u05de\u05df</div>',
            unsafe_allow_html=True,
        )

        if "days_back" not in st.session_state:
            st.session_state["days_back"] = 30

        day_cols = st.columns(len(_DAY_OPTIONS))
        for col, (label, val) in zip(day_cols, _DAY_OPTIONS):
            with col:
                is_active = st.session_state["days_back"] == val
                if st.button(
                    label, key=f"comp_days_{val}",
                    use_container_width=True,
                    type="primary" if is_active else "secondary",
                ):
                    st.session_state["days_back"] = val

        st.markdown('<div style="height:16px;"></div>', unsafe_allow_html=True)

        # Keywords
        st.markdown(
            '<div class="composer-section-label">'
            '\u05de\u05d9\u05dc\u05d5\u05ea \u05de\u05e4\u05ea\u05d7</div>',
            unsafe_allow_html=True,
        )
        keywords_raw = st.text_area(
            "\u05de\u05d9\u05dc\u05d5\u05ea \u05de\u05e4\u05ea\u05d7",
            value=_DEFAULT_KEYWORDS,
            height=130,
            label_visibility="collapsed",
            help="\u05db\u05dc \u05de\u05d9\u05dc\u05d4 \u05d1\u05e9\u05d5\u05e8\u05d4 \u05e0\u05e4\u05e8\u05d3\u05ea",
        )

        st.markdown('<div style="height:8px;"></div>', unsafe_allow_html=True)

        unread_only = st.checkbox(
            "\u05e8\u05e7 \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea \u05e9\u05dc\u05d0 \u05e0\u05e7\u05e8\u05d0\u05d5",
            value=True,
        )

        st.markdown('<div style="height:16px;"></div>', unsafe_allow_html=True)

        # Scan button — the hero action
        st.markdown('<div class="composer-scan-btn">', unsafe_allow_html=True)
        start_scan = st.button(
            "\u05d4\u05ea\u05d7\u05dc \u05e1\u05e8\u05d9\u05e7\u05d4",
            type="primary", use_container_width=True,
        )
        st.markdown('</div>', unsafe_allow_html=True)

        st.markdown('</div>', unsafe_allow_html=True)  # close composer-form

        st.markdown(
            '<div class="composer-footer">'
            '&#x1F512; '
            '\u05d2\u05d9\u05e9\u05ea \u05e7\u05e8\u05d9\u05d0\u05d4 \u05d1\u05dc\u05d1\u05d3 '
            '\u00b7 \u05dc\u05d0 \u05e0\u05e9\u05de\u05e8\u05ea \u05e1\u05d9\u05e1\u05de\u05d0'
            '</div>',
            unsafe_allow_html=True,
        )

    keywords = [k.strip() for k in keywords_raw.splitlines() if k.strip()]
    return {
        "days_back": st.session_state["days_back"],
        "keywords": keywords,
        "unread_only": unread_only,
        "start_scan": start_scan,
        "output_dir": "output",
    }


# ══════════════════════════════════════════════════════════════════════════════
#  PHASE 2 — Results Experience (post-scan)
# ══════════════════════════════════════════════════════════════════════════════

def render_results_hero(results: list[dict]):
    """The big number reveal — replaces the dashboard metric cards."""
    total = len(results)
    with_att = sum(1 for r in results if r.get("saved_path") or r.get("attachments"))
    unique_senders = len({r.get("sender", "") for r in results if r.get("sender")})

    dates = []
    for r in results:
        try:
            dates.append(parsedate_to_datetime(r.get("date", "")))
        except Exception:
            pass

    _MONTHS_HE = {1: "\u05d9\u05e0\u05d5\u05d0\u05e8", 2: "\u05e4\u05d1\u05e8\u05d5\u05d0\u05e8",
                  3: "\u05de\u05e8\u05e5", 4: "\u05d0\u05e4\u05e8\u05d9\u05dc",
                  5: "\u05de\u05d0\u05d9", 6: "\u05d9\u05d5\u05e0\u05d9",
                  7: "\u05d9\u05d5\u05dc\u05d9", 8: "\u05d0\u05d5\u05d2\u05d5\u05e1\u05d8",
                  9: "\u05e1\u05e4\u05d8\u05de\u05d1\u05e8", 10: "\u05d0\u05d5\u05e7\u05d8\u05d5\u05d1\u05e8",
                  11: "\u05e0\u05d5\u05d1\u05de\u05d1\u05e8", 12: "\u05d3\u05e6\u05de\u05d1\u05e8"}

    if dates:
        d_min, d_max = min(dates), max(dates)
        date_range = f"{_MONTHS_HE.get(d_min.month, '')} {d_min.year} \u2014 {_MONTHS_HE.get(d_max.month, '')} {d_max.year}"
    else:
        date_range = "\u2014"

    hero_html = (
        '<div class="results-hero">'
        '<div class="results-hero-top">'
        f'<div class="results-hero-count">{total}</div>'
        f'<div class="results-hero-label">\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05e0\u05de\u05e6\u05d0\u05d5</div>'
        '</div>'
        '<div class="kpi-grid">'
        f'<div class="kpi-card" style="--stagger:1">'
        f'<div class="kpi-value" style="color:var(--secondary);">{with_att}</div>'
        f'<div class="kpi-label">\u05e2\u05dd \u05e7\u05d1\u05e6\u05d9\u05dd</div>'
        '</div>'
        f'<div class="kpi-card" style="--stagger:2">'
        f'<div class="kpi-value" style="color:var(--tertiary);">{unique_senders}</div>'
        f'<div class="kpi-label">\u05e9\u05d5\u05dc\u05d7\u05d9\u05dd</div>'
        '</div>'
        f'<div class="kpi-card" style="--stagger:3">'
        f'<div class="kpi-value-text" style="color:var(--primary-light);">{html.escape(date_range)}</div>'
        f'<div class="kpi-label">\u05d8\u05d5\u05d5\u05d7</div>'
        '</div>'
        '</div>'
        '</div>'
    )
    st.markdown(hero_html, unsafe_allow_html=True)


def render_sidebar_results(results: list[dict]) -> dict:
    """Post-scan sidebar: brand + scan controls + company filter + disconnect."""
    with st.sidebar:
        # -- Scan controls --
        st.markdown('<div class="sidebar-section">\u05e1\u05e8\u05d9\u05e7\u05d4 \u05d7\u05d3\u05e9\u05d4</div>', unsafe_allow_html=True)

        if "days_back" not in st.session_state:
            st.session_state["days_back"] = 30

        day_cols = st.columns(len(_DAY_OPTIONS))
        for col, (label, val) in zip(day_cols, _DAY_OPTIONS):
            with col:
                is_active = st.session_state["days_back"] == val
                if st.button(
                    label, key=f"sb_days_{val}",
                    use_container_width=True,
                    type="primary" if is_active else "secondary",
                ):
                    st.session_state["days_back"] = val

        keywords_raw = st.text_area(
            "\u05de\u05d9\u05dc\u05d5\u05ea \u05de\u05e4\u05ea\u05d7",
            value=_DEFAULT_KEYWORDS,
            height=100,
            help="\u05db\u05dc \u05de\u05d9\u05dc\u05d4 \u05d1\u05e9\u05d5\u05e8\u05d4 \u05e0\u05e4\u05e8\u05d3\u05ea",
        )

        unread_only = st.checkbox(
            "\u05e8\u05e7 \u05dc\u05d0 \u05e0\u05e7\u05e8\u05d0\u05d5",
            value=True,
        )

        st.markdown('<div style="height:6px;"></div>', unsafe_allow_html=True)
        st.markdown('<div class="sidebar-scan-btn">', unsafe_allow_html=True)
        start_scan = st.button(
            "\u05e1\u05e8\u05d5\u05e7 \u05e9\u05d5\u05d1",
            type="primary", use_container_width=True,
        )
        st.markdown('</div>', unsafe_allow_html=True)

        # -- Company filter --
        if results:
            company_labels = [_extract_company(r.get("sender", "")) for r in results]
            company_counts: dict[str, int] = {}
            for c in company_labels:
                company_counts[c] = company_counts.get(c, 0) + 1
            sorted_companies = sorted(company_counts.keys(), key=lambda c: (-company_counts[c], c))

            if len(sorted_companies) > 1:
                st.markdown(
                    '<div class="sidebar-section">'
                    '\u05e1\u05d9\u05e0\u05d5\u05df \u05dc\u05e4\u05d9 \u05d7\u05d1\u05e8\u05d4</div>',
                    unsafe_allow_html=True,
                )

                btn_c1, btn_c2 = st.columns(2)
                with btn_c1:
                    if st.button("\u05d4\u05db\u05dc", key="_comp_all", use_container_width=True):
                        st.session_state["_company_selection"] = set(sorted_companies)
                        st.rerun()
                with btn_c2:
                    if st.button("\u05e0\u05e7\u05d4", key="_comp_none", use_container_width=True):
                        st.session_state["_company_selection"] = set()
                        st.rerun()

                if "_company_selection" not in st.session_state:
                    st.session_state["_company_selection"] = set(sorted_companies)

                selected_companies: set[str] = set()
                for company in sorted_companies:
                    count = company_counts[company]
                    checked = company in st.session_state["_company_selection"]
                    if st.checkbox(
                        f"{company} ({count})",
                        value=checked,
                        key=f"_comp_{company}",
                    ):
                        selected_companies.add(company)
                st.session_state["_company_selection"] = selected_companies
            else:
                st.session_state["_company_selection"] = set(sorted_companies)

        # -- Disconnect --
        st.markdown(
            '<div style="border-top:1px solid var(--outline-variant);'
            'margin-top:14px; padding-top:14px;"></div>',
            unsafe_allow_html=True,
        )
        st.markdown('<div class="sidebar-disconnect-btn">', unsafe_allow_html=True)
        disconnect = st.button(
            "\u05d4\u05ea\u05e0\u05ea\u05e7 \u05de-Gmail",
            use_container_width=True,
        )
        st.markdown('</div>', unsafe_allow_html=True)

    keywords = [k.strip() for k in keywords_raw.splitlines() if k.strip()]
    return {
        "days_back": st.session_state["days_back"],
        "keywords": keywords,
        "unread_only": unread_only,
        "start_scan": start_scan,
        "output_dir": "output",
        "_disconnect": disconnect,
    }


def filter_results_by_company(results: list[dict]) -> list[dict]:
    """Filter results based on company selection in session state."""
    selected = st.session_state.get("_company_selection")
    if selected is None:
        return results
    company_labels = [_extract_company(r.get("sender", "")) for r in results]
    return [r for r, c in zip(results, company_labels) if c in selected]


def render_results_table(results: list[dict]):
    """Results table with text search — company filter is in sidebar."""
    if not results:
        st.markdown(
            '<div class="empty-hero">'
            '<div class="empty-hero-icon" style="background:var(--primary-dim);">&#x1F4E8;</div>'
            '<h3>\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea</h3>'
            '<p>\u05d4\u05e8\u05e5 \u05e1\u05e8\u05d9\u05e7\u05d4 \u05de\u05d4\u05e1\u05e8\u05d2\u05dc \u05d4\u05e6\u05d3\u05d9</p>'
            '</div>',
            unsafe_allow_html=True,
        )
        return

    company_labels = [_extract_company(r.get("sender", "")) for r in results]

    # Text search
    search_term = st.text_input(
        "\u05d7\u05d9\u05e4\u05d5\u05e9",
        placeholder="\u05d7\u05e4\u05e9 \u05dc\u05e4\u05d9 \u05e9\u05d5\u05dc\u05d7, \u05e0\u05d5\u05e9\u05d0, \u05ea\u05d0\u05e8\u05d9\u05da...",
        label_visibility="collapsed",
    )

    # Build DataFrame
    rows = []
    for r, company in zip(results, company_labels):
        rows.append({
            "\u05d7\u05d1\u05e8\u05d4": company,
            "\u05de\u05d6\u05d4\u05d4": r.get("uid", ""),
            "\u05ea\u05d0\u05e8\u05d9\u05da": r.get("date", "")[:25] if r.get("date") else "",
            "\u05e9\u05d5\u05dc\u05d7": r.get("sender", ""),
            "\u05e0\u05d5\u05e9\u05d0": r.get("subject", ""),
            "\u05e7\u05d5\u05d1\u05e5 \u05de\u05e6\u05d5\u05e8\u05e3": "\u2705" if r.get("saved_path") else "\u2014",
            "\u05e0\u05ea\u05d9\u05d1 \u05e7\u05d5\u05d1\u05e5": r.get("saved_path", ""),
            "\u05d4\u05e2\u05e8\u05d5\u05ea": r.get("notes", ""),
        })

    df = pd.DataFrame(rows)

    if search_term:
        mask = df.apply(
            lambda col: col.astype(str).str.contains(search_term, case=False, na=False)
        ).any(axis=1)
        df = df[mask]

    st.caption(
        f"\u05de\u05e6\u05d9\u05d2 **{len(df)}** \u05de\u05ea\u05d5\u05da {len(results)} \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea"
        if search_term else f"**{len(df)}** \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea"
    )

    # ── Mobile card view (visible < 768px, hidden on desktop via CSS) ────
    _cards_html_parts = ['<div class="mobile-cards" dir="rtl">']
    for idx, row in df.iterrows():
        _co = html.escape(str(row.get("\u05d7\u05d1\u05e8\u05d4", "")))
        _subj = html.escape(str(row.get("\u05e0\u05d5\u05e9\u05d0", "")))
        _date = html.escape(str(row.get("\u05ea\u05d0\u05e8\u05d9\u05da", "")))
        _sender = html.escape(str(row.get("\u05e9\u05d5\u05dc\u05d7", "")))
        _has_file = str(row.get("\u05e7\u05d5\u05d1\u05e5 \u05de\u05e6\u05d5\u05e8\u05e3", "")) == "\u2705"
        _badge = (
            '<span class="mobile-card-badge">\u05e7\u05d5\u05d1\u05e5</span>'
            if _has_file
            else '<span class="mobile-card-badge mobile-card-badge--empty">\u05dc\u05dc\u05d0 \u05e7\u05d5\u05d1\u05e5</span>'
        )
        _cards_html_parts.append(
            f'<div class="mobile-card" style="--card-i:{idx}">'
            f'<div class="mobile-card-company">{_co}</div>'
            f'<div class="mobile-card-subject">{_subj}</div>'
            f'<div class="mobile-card-meta">'
            f'<span>{_date}</span>'
            f'<span>{_sender}</span>'
            f'{_badge}'
            f'</div>'
            f'</div>'
        )
    _cards_html_parts.append('</div>')
    st.markdown('\n'.join(_cards_html_parts), unsafe_allow_html=True)

    # ── Desktop table (hidden < 768px via CSS) ───────────────────────────
    st.markdown('<div class="desktop-table">', unsafe_allow_html=True)
    st.dataframe(df, use_container_width=True, hide_index=True)
    st.markdown('</div>', unsafe_allow_html=True)

    if not df.empty:
        csv_data = df.to_csv(index=False, encoding="utf-8-sig").encode("utf-8-sig")
        st.download_button(
            label="\u05d4\u05d5\u05e8\u05d3 CSV",
            data=csv_data,
            file_name=f"\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
            mime="text/csv",
        )


# ── Legacy aliases (keep imports working) ─────────────────────────────────

def render_sidebar() -> dict:
    """Legacy — redirects to scan composer or sidebar based on state."""
    return render_scan_composer()


def render_header():
    """Legacy — no longer needed, results_hero handles this."""
    pass


def render_metrics(results: list[dict]):
    """Legacy — no longer needed, results_hero handles this."""
    pass
