# -*- coding: utf-8 -*-
"""
Premium Design System — Invoice Fetcher.

Aesthetic: Obsidian Luxe — deep spatial dark with luminous accents.
References: Linear, Arc, Stripe, Apple spatial design.
Fonts: Outfit (display) + Heebo (Hebrew body) + JetBrains Mono (data).
"""

FONT_LINK = (
    '<link href="https://fonts.googleapis.com/css2?'
    'family=Outfit:wght@300;400;500;600;700;800;900'
    '&family=Heebo:wght@300;400;500;600;700;800;900'
    '&family=JetBrains+Mono:wght@400;500;600;700'
    '&display=swap" rel="stylesheet"/>'
)

DESIGN_CSS = """
<style>
/* ═══════════════════════════════════════════════════════════════════════
   Invoice Fetcher — Obsidian Luxe Design System
   Deep spatial dark · luminous accents · glassmorphism · cinematic motion
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Keyframes ──────────────────────────────────────────────────────── */
@keyframes emerge {
    from { opacity: 0; transform: translateY(24px) scale(0.97); filter: blur(3px); }
    to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes emerge-slow {
    from { opacity: 0; transform: translateY(36px); filter: blur(4px); }
    to   { opacity: 1; transform: translateY(0); filter: blur(0); }
}
@keyframes number-reveal {
    from { opacity: 0; transform: scale(0.75) translateY(16px); filter: blur(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
}
@keyframes glow-breathe {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.4; }
}
@keyframes shimmer {
    0%   { background-position: -200% center; }
    100% { background-position: 200% center; }
}
@keyframes gradient-orbit {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}
@keyframes icon-float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    25%  { transform: translateY(-3px) rotate(-1deg); }
    75%  { transform: translateY(2px) rotate(0.5deg); }
}
/* legacy compat */
@keyframes fadein      { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
@keyframes fadein-slow { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
@keyframes number-in   { from { opacity:0; transform:scale(.85) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
@keyframes pulse-live  { 0%,100%{opacity:1;} 50%{opacity:.45;} }

/* ── Design Tokens ──────────────────────────────────────────────────── */
:root {
    /* Spatial dark palette */
    --bg-base:       #080b12;
    --bg-raised:     #0e1219;
    --bg-overlay:    #161c28;
    --bg-subtle:     #0b0e16;
    --bg-glass:      rgba(12, 16, 24, 0.72);
    --bg-glass-strong: rgba(14, 18, 25, 0.88);

    /* Primary — luminous blue */
    --primary:       #5B8DEF;
    --primary-light: #7BA6F7;
    --on-primary:    #071A38;
    --primary-dim:   rgba(91,141,239,0.07);
    --primary-border:rgba(91,141,239,0.14);
    --primary-glow:  rgba(91,141,239,0.10);

    /* Secondary — emerald */
    --secondary:     #34D399;
    --on-secondary:  #022C22;
    --secondary-dim: rgba(52,211,153,0.07);
    --secondary-border:rgba(52,211,153,0.14);

    /* Tertiary — warm amber */
    --tertiary:      #E8A849;
    --tertiary-dim:  rgba(232,168,73,0.07);

    /* Semantic */
    --error:         #F87171;
    --error-dim:     rgba(248,113,113,0.07);
    --error-border:  rgba(248,113,113,0.14);

    /* Text hierarchy */
    --on-surface:    #F0F2F5;
    --on-surface-v:  #B8C4D4;
    --outline:       #6B7A8D;
    --outline-variant:rgba(255,255,255,0.055);
    --text-muted:    #7E8C9F;
    --text-faint:    #3D4654;

    /* Typography */
    --font-body:   'Heebo', system-ui, -apple-system, sans-serif;
    --font-display:'Outfit', 'Heebo', system-ui, sans-serif;
    --font-mono:   'JetBrains Mono', 'Courier New', monospace;

    /* Radii */
    --radius-sm: 8px;  --radius-md: 12px;  --radius-lg: 16px;  --radius-xl: 20px;

    /* Shadows & depth */
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.28);
    --shadow-md: 0 4px 20px rgba(0,0,0,0.32);
    --shadow-lg: 0 8px 40px rgba(0,0,0,0.40);
    --shadow-xl: 0 16px 64px rgba(0,0,0,0.48);
    --shadow-glow: 0 0 60px rgba(91,141,239,0.06);
    --shadow-glow-strong: 0 0 80px rgba(91,141,239,0.10);
    --shadow-inner: inset 0 1px 0 rgba(255,255,255,0.04);

    /* Motion */
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    --dur: 0.2s;
}

/* ── Reset & Global ─────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; }
html, body {
    direction: rtl;
    font-family: var(--font-body);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}

[data-testid="stAppViewContainer"],
[data-testid="stAppViewContainer"] > .main {
    background: var(--bg-base);
    color: var(--on-surface);
    font-family: var(--font-body);
    direction: rtl;
}

/* ── Atmospheric Background ─────────────────────────────────────────── */
[data-testid="stAppViewContainer"]::before {
    content: '';
    position: fixed; inset: 0;
    background:
        radial-gradient(ellipse 80% 50% at 15% -10%, rgba(91,141,239,0.045) 0%, transparent 60%),
        radial-gradient(ellipse 60% 40% at 85% 110%, rgba(52,211,153,0.025) 0%, transparent 55%),
        radial-gradient(ellipse 70% 60% at 50% 50%, rgba(232,168,73,0.012) 0%, transparent 45%);
    pointer-events: none;
    z-index: 0;
    animation: gradient-orbit 30s ease infinite;
    background-size: 200% 200%;
}

/* Subtle grain texture */
[data-testid="stAppViewContainer"]::after {
    content: '';
    position: fixed; inset: 0;
    opacity: 0.018;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-repeat: repeat;
    background-size: 200px;
    pointer-events: none;
    z-index: 0;
}

/* ── Hide Streamlit Chrome ──────────────────────────────────────────── */
#MainMenu { visibility: hidden !important; }
header[data-testid="stHeader"] {
    background: transparent !important;
    height: 0 !important; min-height: 0 !important;
}
[data-testid="stToolbar"],
.stDeployButton,
[data-testid="stDecoration"] { display: none !important; }
footer { visibility: hidden !important; }

.block-container {
    padding-top: 2.5rem !important;
    padding-bottom: 2rem !important;
    max-width: 1100px;
    position: relative;
    z-index: 1;
    animation: emerge 0.35s var(--ease) both;
}

/* ── Sidebar — Frosted Glass Panel ──────────────────────────────────── */
[data-testid="stSidebar"] {
    background: var(--bg-glass-strong) !important;
    backdrop-filter: blur(24px) saturate(1.3) !important;
    -webkit-backdrop-filter: blur(24px) saturate(1.3) !important;
    border-left: 1px solid var(--outline-variant) !important;
    border-right: none !important;
    width: 280px !important;
}
[data-testid="stSidebar"] * {
    color: var(--on-surface) !important;
    direction: rtl; text-align: right;
    font-family: var(--font-body) !important;
}
[data-testid="stSidebar"] .stSlider label,
[data-testid="stSidebar"] .stTextArea label,
[data-testid="stSidebar"] .stCheckbox label,
[data-testid="stSidebar"] .stTextInput label {
    color: var(--text-muted) !important;
    font-weight: 600; font-size: 0.66rem;
    letter-spacing: 0.05em; text-transform: uppercase;
    font-family: var(--font-display) !important;
}
[data-testid="stSidebar"] hr { border-color: var(--outline-variant) !important; margin: 14px 0; }
[data-testid="stSidebar"] .stTextArea textarea { font-size: 0.78rem !important; line-height: 1.55 !important; }

/* Hide sidebar in composer phase */
.hide-sidebar [data-testid="stSidebar"],
.hide-sidebar [data-testid="stSidebarCollapsedControl"],
.hide-sidebar button[kind="headerNoPadding"] { display: none !important; }

/* ── Buttons ────────────────────────────────────────────────────────── */
.stButton > button {
    background: var(--bg-overlay) !important;
    color: var(--on-surface-v) !important;
    border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 600; font-size: 0.8rem;
    padding: 10px 18px; direction: rtl; width: 100%; cursor: pointer;
    transition: all var(--dur) var(--ease) !important;
    font-family: var(--font-body) !important;
    box-shadow: var(--shadow-inner) !important;
}
.stButton > button:hover {
    background: rgba(255,255,255,0.06) !important;
    color: var(--on-surface) !important;
    border-color: var(--outline-variant) !important;
    transform: translateY(-1px) !important;
    box-shadow: var(--shadow-md), var(--shadow-inner) !important;
}
.stButton > button:active {
    transform: translateY(0) scale(0.98) !important;
    box-shadow: var(--shadow-sm) !important;
}

/* Primary CTA */
.stButton > button[kind="primary"],
[data-testid="stBaseButton-primary"] {
    background: linear-gradient(135deg, #5B8DEF 0%, #4A7AE0 50%, #6B9DF5 100%) !important;
    color: #fff !important;
    font-weight: 700 !important;
    border: none !important;
    box-shadow: 0 2px 12px rgba(91,141,239,0.22), var(--shadow-inner) !important;
    background-size: 200% 200% !important;
    animation: gradient-orbit 4s ease infinite !important;
}
.stButton > button[kind="primary"]:hover,
[data-testid="stBaseButton-primary"]:hover {
    box-shadow: 0 6px 28px rgba(91,141,239,0.30), 0 0 60px rgba(91,141,239,0.08) !important;
    transform: translateY(-2px) !important;
}

/* Download button */
[data-testid="stDownloadButton"] > button {
    background: var(--secondary-dim) !important;
    color: var(--secondary) !important;
    border: 1px solid var(--secondary-border) !important;
    border-radius: var(--radius-md) !important;
    font-weight: 600; font-size: 0.8rem;
    transition: all var(--dur) var(--ease) !important;
}
[data-testid="stDownloadButton"] > button:hover {
    background: rgba(52,211,153,0.12) !important;
    transform: translateY(-1px) !important;
    box-shadow: 0 4px 16px rgba(52,211,153,0.12) !important;
}

/* Link button — hero CTA */
.stLinkButton > a {
    background: linear-gradient(135deg, #5B8DEF 0%, #4A7AE0 50%, #6B9DF5 100%) !important;
    color: #fff !important;
    border: none !important;
    border-radius: var(--radius-md) !important;
    font-weight: 700 !important;
    font-size: 0.84rem !important;
    padding: 13px 22px !important;
    transition: all var(--dur) var(--ease) !important;
    text-decoration: none !important;
    display: block !important; text-align: center !important;
    box-shadow: 0 2px 12px rgba(91,141,239,0.22) !important;
    background-size: 200% 200% !important;
    animation: gradient-orbit 4s ease infinite !important;
}
.stLinkButton > a:hover {
    box-shadow: 0 8px 32px rgba(91,141,239,0.28), 0 0 60px rgba(91,141,239,0.08) !important;
    transform: translateY(-2px) !important;
}

/* ── Data Table — Editorial Grid ────────────────────────────────────── */
[data-testid="stDataFrame"],
[data-testid="stDataEditor"] {
    background: var(--bg-raised);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    overflow: hidden;
    box-shadow: var(--shadow-md);
}
[data-testid="stDataFrame"] th,
[data-testid="stDataEditor"] th {
    font-size: 0.66rem !important;
    font-weight: 700 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.05em !important;
    font-family: var(--font-display) !important;
}

/* ── Inputs ──────────────────────────────────────────────────────────── */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea {
    background: var(--bg-base) !important;
    color: var(--on-surface) !important;
    border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-md) !important;
    direction: rtl; text-align: right;
    font-family: var(--font-body) !important;
    transition: border-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: rgba(91,141,239,0.30) !important;
    box-shadow: 0 0 0 3px var(--primary-dim), 0 0 20px var(--primary-glow) !important;
}
.stTextInput label, .stTextArea label {
    color: var(--text-muted) !important;
    font-weight: 600; direction: rtl;
    letter-spacing: 0.05em; font-size: 0.66rem; text-transform: uppercase;
    font-family: var(--font-display) !important;
}
[data-testid="stSelectbox"] > div > div {
    background: var(--bg-base) !important;
    border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-md) !important;
    color: var(--on-surface) !important;
}

/* ── Progress ────────────────────────────────────────────────────────── */
.stProgress > div > div > div {
    background: linear-gradient(90deg, var(--primary), var(--primary-light)) !important;
    border-radius: 3px;
}
.stProgress > div > div {
    background: var(--bg-overlay) !important;
    border-radius: 3px; height: 3px !important;
}

/* ── Alerts ──────────────────────────────────────────────────────────── */
[data-testid="stAlert"] {
    background: var(--bg-raised) !important;
    border-radius: var(--radius-lg) !important;
    border: 1px solid var(--outline-variant) !important;
    border-right: 3px solid var(--primary) !important;
    border-left: none !important;
    color: var(--on-surface) !important;
    direction: rtl; text-align: right;
    backdrop-filter: blur(12px) !important;
}

/* ── Expander ────────────────────────────────────────────────────────── */
[data-testid="stExpander"] {
    background: var(--bg-raised) !important;
    border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-lg) !important;
    direction: rtl;
}
[data-testid="stExpander"] summary {
    direction: rtl; color: var(--text-muted) !important;
    font-size: 0.84rem; font-weight: 500;
}

/* ── Global Typography & Misc ───────────────────────────────────────── */
h1,h2,h3,h4,h5,h6 {
    color: var(--on-surface); direction: rtl; text-align: right;
    font-family: var(--font-display) !important;
    letter-spacing: -0.03em;
}
hr { border: none; height: 1px; background: var(--outline-variant); margin: 20px 0; }

::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.10); }

[data-testid="column"] { direction: rtl; }
.stCaption, [data-testid="stCaptionContainer"] {
    color: var(--text-muted) !important; direction: rtl; text-align: right; font-size: 0.76rem;
}
[data-testid="stCheckbox"] { direction: rtl; }
[data-testid="stStatusWidget"] {
    border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-md) !important;
    background: var(--bg-raised) !important;
}
[data-testid="stToast"] {
    background: var(--bg-glass-strong) !important;
    backdrop-filter: blur(20px) !important;
    border: 1px solid var(--outline-variant) !important;
    border-radius: var(--radius-lg) !important;
    box-shadow: var(--shadow-xl) !important;
}

/* ── Tabs — Refined Navigation ──────────────────────────────────────── */
[data-testid="stTabs"] [data-baseweb="tab-list"] {
    gap: 0;
    border-bottom: 1px solid var(--outline-variant);
    background: transparent;
}
[data-testid="stTabs"] [data-baseweb="tab"] {
    border-radius: 0;
    font-family: var(--font-display) !important;
    font-weight: 600; font-size: 0.82rem;
    padding: 14px 24px;
    transition: all var(--dur) var(--ease);
    color: var(--text-faint) !important;
    border-bottom: 2px solid transparent;
    letter-spacing: -0.01em;
}
[data-testid="stTabs"] [data-baseweb="tab"][aria-selected="true"] {
    color: var(--on-surface) !important;
    border-bottom-color: var(--primary) !important;
}
[data-testid="stTabs"] [data-baseweb="tab"]:hover {
    color: var(--on-surface-v) !important;
}

/* ── App Shell — Product Frame ──────────────────────────────────── */
.app-shell {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    height: 44px;
    background: var(--bg-glass);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-md);
    direction: rtl;
    margin-bottom: 8px;
    position: relative;
    z-index: 10;
    animation: emerge 0.2s var(--ease) both;
}
.app-shell::before {
    content: '';
    position: absolute; top: 0; left: 12%; right: 12%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(91,141,239,0.15), transparent);
}
.app-shell-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-direction: row-reverse;
}
.app-shell-logo {
    width: 26px; height: 26px;
    background: linear-gradient(135deg, var(--primary), #4A7AE0);
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; font-weight: 800;
    color: #fff;
    font-family: var(--font-display);
    box-shadow: 0 1px 4px rgba(91,141,239,0.16);
    letter-spacing: -0.02em;
}
.app-shell-name {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--on-surface-v);
    letter-spacing: -0.01em;
    font-family: var(--font-display);
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 1 — SCAN COMPOSER
   ══════════════════════════════════════════════════════════════════════ */

.composer-wrap {
    max-width: 440px; margin: 0 auto;
    padding: 32px 0 36px;
    text-align: center; direction: rtl;
    animation: emerge-slow 0.5s var(--ease) both;
}

.composer-accent {
    width: 32px; height: 3px;
    margin: 0 auto 20px;
    background: linear-gradient(90deg, var(--primary), var(--primary-light));
    border-radius: 2px;
    animation: emerge 0.3s var(--ease) 0.1s both;
}

.composer-title {
    font-size: 1.4rem; font-weight: 700;
    color: var(--on-surface);
    margin: 0 0 8px;
    font-family: var(--font-display);
    letter-spacing: -0.03em; line-height: 1.15;
    animation: emerge 0.35s var(--ease) 0.12s both;
}

.composer-sub {
    font-size: 0.82rem; color: var(--text-muted);
    margin: 0 0 28px;
    line-height: 1.65;
    font-family: var(--font-body);
    font-weight: 400;
    animation: emerge 0.35s var(--ease) 0.18s both;
    max-width: 340px; margin-left: auto; margin-right: auto;
}

.composer-form {
    background: var(--bg-glass-strong);
    backdrop-filter: blur(20px) saturate(1.2);
    -webkit-backdrop-filter: blur(20px) saturate(1.2);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    padding: 24px 24px 22px;
    text-align: right; direction: rtl;
    box-shadow: var(--shadow-md);
    animation: emerge 0.4s var(--ease) 0.22s both;
    position: relative;
    overflow: hidden;
}
/* Subtle top-edge highlight */
.composer-form::before {
    content: '';
    position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(91,141,239,0.25), transparent);
}

.composer-section-label {
    font-size: 0.6rem; font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 10px;
    font-family: var(--font-display);
    direction: rtl;
}

.composer-scan-btn > div > button {
    background: linear-gradient(135deg, #5B8DEF 0%, #4A7AE0 50%, #6B9DF5 100%) !important;
    color: #fff !important;
    border: none !important;
    border-radius: var(--radius-md) !important;
    font-weight: 700 !important;
    font-size: 0.9rem !important;
    padding: 14px 22px !important;
    transition: all var(--dur) var(--ease) !important;
    box-shadow: 0 2px 16px rgba(91,141,239,0.24) !important;
    background-size: 200% 200% !important;
    animation: gradient-orbit 4s ease infinite !important;
    letter-spacing: -0.01em !important;
}
.composer-scan-btn > div > button:hover {
    box-shadow: 0 8px 32px rgba(91,141,239,0.32), 0 0 60px rgba(91,141,239,0.10) !important;
    transform: translateY(-2px) !important;
}
.composer-scan-btn > div > button:active {
    transform: translateY(0) scale(0.98) !important;
}

.composer-footer {
    margin-top: 32px;
    color: var(--text-faint);
    font-size: 0.7rem;
    animation: emerge 0.5s var(--ease) 0.5s both;
    letter-spacing: 0.01em;
}

/* ══════════════════════════════════════════════════════════════════════
   PHASE 2 — RESULTS NARRATIVE
   ══════════════════════════════════════════════════════════════════════ */

.results-hero {
    padding: 12px 0 10px; direction: rtl;
    animation: emerge 0.3s var(--ease) both;
}
.results-hero-top {
    display: flex; align-items: baseline; justify-content: flex-start;
    direction: rtl; margin-bottom: 6px; gap: 10px;
}
.results-hero-count {
    font-size: 2.2rem; font-weight: 800;
    font-family: var(--font-display);
    letter-spacing: -0.04em; line-height: 1;
    color: var(--on-surface);
    animation: number-reveal 0.5s var(--ease) 0.08s both;
}
.results-hero-label {
    font-size: 0.88rem; font-weight: 500;
    color: var(--text-muted);
    font-family: var(--font-body);
    margin-bottom: 0;
    animation: emerge 0.3s var(--ease) 0.12s both;
}
.results-hero-meta {
    display: flex; gap: 16px; align-items: center;
    direction: rtl; flex-wrap: wrap;
    animation: emerge 0.3s var(--ease) 0.18s both;
}
.meta-item {
    display: flex; align-items: center; gap: 5px;
    font-size: 0.74rem; color: var(--text-muted);
}
.meta-dot {
    width: 5px; height: 5px;
    border-radius: 50%; flex-shrink: 0;
}
.meta-value {
    font-weight: 600; color: var(--on-surface-v);
    font-family: var(--font-mono); font-size: 0.72rem;
}

/* Connected chip — status indicator */
.chip-connected {
    display: inline-flex; align-items: center; gap: 7px;
    font-size: 0.66rem; font-weight: 600;
    padding: 5px 14px;
    border-radius: 100px;
    background: var(--secondary-dim);
    color: var(--secondary);
    border: 1px solid var(--secondary-border);
    font-family: var(--font-display);
    letter-spacing: 0.02em;
}
.chip-connected-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--secondary);
    animation: glow-breathe 2.5s ease-in-out infinite;
    box-shadow: 0 0 6px var(--secondary);
}

/* ── Sidebar Brand & Controls ───────────────────────────────────────── */
.sidebar-brand {
    display: none;
}
.sidebar-brand-icon {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, #5B8DEF, #4A7AE0);
    border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; color: #fff;
    font-weight: 800;
    font-family: var(--font-display);
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(91,141,239,0.20);
}
.sidebar-brand-name {
    font-size: 0.88rem; font-weight: 700;
    color: var(--on-surface);
    letter-spacing: -0.02em;
    font-family: var(--font-display);
}
.sidebar-section {
    font-size: 0.58rem; font-weight: 700;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 18px 0 8px;
    font-family: var(--font-display);
    direction: rtl;
}

.sidebar-scan-btn > div > button {
    background: linear-gradient(135deg, #5B8DEF 0%, #4A7AE0 100%) !important;
    color: #fff !important;
    border: none !important;
    border-radius: var(--radius-md) !important;
    font-weight: 700 !important;
    font-size: 0.82rem !important;
    padding: 10px 16px !important;
    transition: all var(--dur) var(--ease) !important;
    box-shadow: 0 2px 10px rgba(91,141,239,0.18) !important;
}
.sidebar-scan-btn > div > button:hover {
    box-shadow: 0 6px 24px rgba(91,141,239,0.26) !important;
    transform: translateY(-1px) !important;
}

.sidebar-disconnect-btn > div > button {
    background: transparent !important;
    color: var(--text-faint) !important;
    border: 1px solid var(--outline-variant) !important;
    font-size: 0.76rem !important;
    transition: all var(--dur) var(--ease) !important;
}
.sidebar-disconnect-btn > div > button:hover {
    color: var(--error) !important;
    border-color: var(--error-border) !important;
    background: var(--error-dim) !important;
}

/* ── Empty States ───────────────────────────────────────────────────── */
.empty-hero {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 80px 28px 72px; direction: rtl; text-align: center;
    animation: emerge-slow 0.5s var(--ease) both;
}
.empty-hero-icon {
    width: 56px; height: 56px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--radius-lg);
    font-size: 1.4rem; margin-bottom: 20px;
    border: 1px solid var(--outline-variant);
    background: var(--bg-overlay);
}
.empty-hero h3 {
    font-size: 1.08rem; font-weight: 700;
    color: var(--on-surface); margin: 0 0 8px;
    font-family: var(--font-display);
}
.empty-hero p {
    font-size: 0.82rem; color: var(--text-muted);
    margin: 0; max-width: 320px; line-height: 1.65;
}
.empty-hero p strong { color: var(--primary); font-weight: 600; }

/* ── Action Bar ─────────────────────────────────────────────────────── */
.action-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
    background: var(--bg-glass-strong);
    backdrop-filter: blur(12px);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    direction: rtl; gap: 12px; flex-wrap: wrap;
}
.action-bar-stat { display: flex; align-items: center; gap: 8px; }
.action-bar-count {
    background: var(--primary-dim);
    color: var(--primary);
    font-weight: 700; padding: 2px 10px;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-family: var(--font-mono);
}
.action-bar-label { color: var(--text-muted); font-size: 0.72rem; }
.action-bar-sep { color: var(--text-faint); margin: 0 2px; font-size: 0.6rem; }
.action-bar-amount {
    color: var(--secondary);
    font-size: 0.75rem; font-weight: 600;
    font-family: var(--font-mono);
}

/* ── Footer ─────────────────────────────────────────────────────────── */
.app-footer {
    text-align: center; direction: rtl;
    margin-top: 56px; padding: 24px 0;
    border-top: 1px solid var(--outline-variant);
    color: var(--text-faint);
    font-size: 0.66rem; font-weight: 500;
    letter-spacing: 0.05em;
    font-family: var(--font-display);
}

/* ══════════════════════════════════════════════════════════════════════
   WELCOME & SETUP SCREENS
   ══════════════════════════════════════════════════════════════════════ */

.welcome-panel {
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-xl);
    padding: 52px 44px 40px;
    max-width: 440px;
    margin: 56px auto 0 auto;
    position: relative; overflow: hidden;
    animation: emerge-slow 0.5s var(--ease) both;
    direction: rtl; text-align: center;
    box-shadow: var(--shadow-xl), var(--shadow-glow);
}
/* Top edge light */
.welcome-panel::before {
    content: '';
    position: absolute; top: 0; left: 8%; right: 8%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(91,141,239,0.30), transparent);
}

/* ── Hero Media — seamless animated visual ─────────────────────────── */
.hero-media {
    max-width: 340px;
    margin: 0 auto;
    border-radius: var(--radius-xl);
    overflow: hidden;
    position: relative;
    box-shadow: 0 16px 56px rgba(91,141,239,0.14), 0 0 100px rgba(91,141,239,0.06);
    border: 1px solid rgba(91,141,239,0.12);
    animation: emerge-slow 0.6s var(--ease) both;
    background: linear-gradient(135deg, var(--bg-base), rgba(91,141,239,0.03));
    line-height: 0;
    /* Kill any pointer interaction — not a playable widget */
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
}
.hero-media video {
    width: 100%;
    display: block;
    border-radius: var(--radius-xl);
    object-fit: contain;
    /* No controls — force them off at every browser level */
    pointer-events: none;
}
/* Chrome, Edge, Safari — nuke all media controls */
.hero-media video::-webkit-media-controls,
.hero-media video::-webkit-media-controls-panel,
.hero-media video::-webkit-media-controls-start-playback-button,
.hero-media video::-webkit-media-controls-play-button,
.hero-media video::-webkit-media-controls-timeline,
.hero-media video::-webkit-media-controls-current-time-display,
.hero-media video::-webkit-media-controls-time-remaining-display,
.hero-media video::-webkit-media-controls-mute-button,
.hero-media video::-webkit-media-controls-volume-slider,
.hero-media video::-webkit-media-controls-fullscreen-button,
.hero-media video::-webkit-media-controls-enclosure,
.hero-media video::-webkit-media-controls-overlay-play-button {
    display: none !important;
    -webkit-appearance: none !important;
    opacity: 0 !important;
    pointer-events: none !important;
    width: 0 !important; height: 0 !important;
    position: absolute !important;
}
/* Subtle inner vignette for embedded feel */
.hero-media::after {
    content: '';
    position: absolute; inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 24px rgba(8,11,18,0.18);
    pointer-events: none;
}

/* Icon fallback (shown when hero video is absent) */
.welcome-icon {
    width: 60px; height: 60px;
    margin: 0 auto 22px auto;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(135deg, var(--primary-dim), rgba(91,141,239,0.14));
    border: 1px solid var(--primary-border);
    border-radius: var(--radius-xl);
    font-size: 1.6rem; line-height: 1;
    box-shadow: 0 0 40px var(--primary-glow);
    animation: icon-float 6s ease-in-out infinite;
}

.welcome-brand {
    font-size: 0.6rem; font-weight: 700;
    color: var(--outline);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    text-align: center; margin-bottom: 8px;
    font-family: var(--font-display);
}

.welcome-title {
    font-size: 1.5rem; font-weight: 800;
    color: var(--on-surface);
    text-align: center; margin-bottom: 8px;
    line-height: 1.2; letter-spacing: -0.03em;
    direction: rtl;
    font-family: var(--font-display);
}

.welcome-subtitle {
    color: var(--text-muted);
    font-size: 0.84rem; text-align: center; direction: rtl;
    margin-bottom: 36px;
    font-weight: 400; line-height: 1.65;
    font-family: var(--font-body);
}

.connect-btn-wrapper > div > button,
.connect-btn-wrapper > div > a {
    background: linear-gradient(135deg, #5B8DEF 0%, #4A7AE0 50%, #6B9DF5 100%) !important;
    color: #fff !important;
    font-size: 0.84rem !important;
    font-weight: 700 !important;
    padding: 13px 24px !important;
    border-radius: var(--radius-md) !important;
    border: none !important;
    width: 100% !important; cursor: pointer !important;
    transition: all 0.2s var(--ease) !important;
    font-family: var(--font-body) !important;
    text-decoration: none !important;
    display: block !important; text-align: center !important;
    box-shadow: 0 2px 16px rgba(91,141,239,0.22) !important;
    background-size: 200% 200% !important;
    animation: gradient-orbit 4s ease infinite !important;
}
.connect-btn-wrapper > div > button:hover,
.connect-btn-wrapper > div > a:hover {
    box-shadow: 0 8px 32px rgba(91,141,239,0.30), 0 0 60px rgba(91,141,239,0.10) !important;
    transform: translateY(-2px) !important;
}
.connect-btn-wrapper > div > button:active,
.connect-btn-wrapper > div > a:active {
    transform: translateY(0) scale(0.98) !important;
}

.privacy-badge {
    display: inline-flex; align-items: center; gap: 6px;
    background: transparent;
    border: 1px solid var(--outline-variant);
    color: var(--text-faint);
    font-size: 0.66rem; font-weight: 600;
    padding: 5px 14px;
    border-radius: 100px;
    text-align: center; direction: rtl;
    margin-top: 20px;
    font-family: var(--font-display);
    letter-spacing: 0.02em;
}

.setup-card {
    background: var(--bg-glass-strong);
    backdrop-filter: blur(24px) saturate(1.2);
    -webkit-backdrop-filter: blur(24px) saturate(1.2);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-xl);
    padding: 44px 48px;
    direction: rtl; text-align: right;
    max-width: 560px;
    margin: 56px auto;
    animation: emerge-slow 0.5s var(--ease) both;
    position: relative; overflow: hidden;
    box-shadow: var(--shadow-xl), var(--shadow-glow);
}
.setup-card::before {
    content: '';
    position: absolute; top: 0; left: 8%; right: 8%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(91,141,239,0.30), transparent);
}

.env-pill {
    display: inline-block;
    background: var(--primary-dim);
    border: 1px solid var(--primary-border);
    color: var(--primary);
    font-family: var(--font-mono);
    font-size: 0.74rem;
    padding: 2px 9px;
    border-radius: var(--radius-sm);
    font-weight: 600;
}

.code-block {
    background: var(--bg-base);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-md);
    padding: 18px 22px;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--on-surface);
    direction: ltr; text-align: left;
    margin-top: 16px;
    line-height: 2;
    border-left: 3px solid var(--primary);
    box-shadow: var(--shadow-sm);
}

/* ── Spinner / Loading ──────────────────────────────────────────────── */
[data-testid="stSpinner"] {
    color: var(--primary) !important;
}

/* ── Metric Cards (if used) ─────────────────────────────────────────── */
[data-testid="stMetric"] {
    background: var(--bg-raised);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    padding: 16px 20px;
}

/* ══════════════════════════════════════════════════════════════════════
   PREMIUM INTERACTION LAYER
   KPI depth · chart surfaces · control refinement · living motion
   ══════════════════════════════════════════════════════════════════════ */

/* ── KPI Card Grid ─────────────────────────────────────────────────── */
.kpi-grid {
    display: flex; gap: 10px; direction: rtl;
    margin-top: 10px;
}
.kpi-card {
    flex: 1;
    background: var(--bg-glass);
    backdrop-filter: blur(16px) saturate(1.15);
    -webkit-backdrop-filter: blur(16px) saturate(1.15);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    position: relative; overflow: hidden;
    transition: border-color 0.25s var(--ease), transform 0.25s var(--ease), box-shadow 0.3s var(--ease);
    animation: emerge 0.3s var(--ease) calc(0.18s + var(--stagger, 0) * 0.06s) both;
}
.kpi-card::before {
    content: '';
    position: absolute; top: 0; left: 15%; right: 15%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.05), transparent);
}
.kpi-card:hover {
    border-color: rgba(255,255,255,0.09);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md), 0 0 40px rgba(91,141,239,0.04);
}
.kpi-value {
    font-size: 1.25rem; font-weight: 700;
    font-family: var(--font-display);
    letter-spacing: -0.03em; line-height: 1.15;
    color: var(--on-surface);
    margin-bottom: 3px;
    animation: number-reveal 0.45s var(--ease) calc(0.25s + var(--stagger, 0) * 0.06s) both;
}
.kpi-value-text {
    font-size: 0.76rem; font-weight: 600;
    font-family: var(--font-body);
    color: var(--on-surface-v);
    margin-bottom: 3px;
    letter-spacing: -0.01em; line-height: 1.3;
}
.kpi-label {
    font-size: 0.56rem; font-weight: 600;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    font-family: var(--font-display);
}

/* ── Chart Surfaces ────────────────────────────────────────────────── */
[data-testid="stPlotlyChart"] {
    background: var(--bg-raised);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color 0.3s var(--ease), box-shadow 0.3s var(--ease);
    box-shadow: var(--shadow-sm);
    padding: 2px;
}
[data-testid="stPlotlyChart"]:hover {
    border-color: rgba(255,255,255,0.08);
    box-shadow: var(--shadow-md), 0 0 30px rgba(91,141,239,0.03);
}

/* ── Data Table — Hover Depth ──────────────────────────────────────── */
[data-testid="stDataFrame"],
[data-testid="stDataEditor"] {
    transition: box-shadow 0.3s var(--ease), border-color 0.3s var(--ease);
}
[data-testid="stDataFrame"]:hover,
[data-testid="stDataEditor"]:hover {
    border-color: rgba(255,255,255,0.08);
    box-shadow: var(--shadow-lg);
}

/* ── Checkbox Hover ────────────────────────────────────────────────── */
[data-testid="stCheckbox"] label {
    transition: background 0.15s var(--ease);
    border-radius: var(--radius-sm);
    padding: 4px 8px 4px 4px;
    margin: -4px -8px -4px -4px;
}
[data-testid="stCheckbox"] label:hover {
    background: rgba(91,141,239,0.04);
}

/* ── Select Premium ────────────────────────────────────────────────── */
[data-testid="stSelectbox"] > div > div {
    transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease) !important;
}
[data-testid="stSelectbox"] > div > div:hover {
    border-color: rgba(91,141,239,0.18) !important;
}

/* ── Action Bar — Living ───────────────────────────────────────────── */
.action-bar {
    transition: border-color 0.25s var(--ease), box-shadow 0.25s var(--ease);
    animation: emerge 0.3s var(--ease) 0.1s both;
}
.action-bar:hover {
    border-color: rgba(255,255,255,0.08);
    box-shadow: var(--shadow-md);
}
.action-bar-count {
    animation: number-reveal 0.4s var(--ease) 0.15s both;
}

/* ── Tab Active Glow ───────────────────────────────────────────────── */
[data-testid="stTabs"] [data-baseweb="tab"][aria-selected="true"] {
    text-shadow: 0 0 24px rgba(91,141,239,0.15);
}

/* ═══════════════════════════════════════════════════════════════════════
   MOBILE PRODUCT EXPERIENCE
   Not responsive CSS — a true mobile product redesign.
   Touch-native · card-based · fluid · iOS-safe
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Mobile Result Cards (hidden on desktop, shown on mobile) ──────── */
.mobile-cards { display: none; }

.mobile-card {
    background: var(--bg-raised);
    border: 1px solid var(--outline-variant);
    border-radius: var(--radius-md);
    padding: 14px 16px;
    margin-bottom: 10px;
    position: relative;
    overflow: hidden;
    transition: border-color 0.2s var(--ease), box-shadow 0.2s var(--ease);
    animation: emerge 0.3s var(--ease) calc(0.05s + var(--card-i, 0) * 0.04s) both;
}
.mobile-card::before {
    content: '';
    position: absolute; top: 0; left: 10%; right: 10%; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent);
}
.mobile-card:active {
    border-color: rgba(91,141,239,0.18);
    box-shadow: var(--shadow-md);
    transform: scale(0.985);
}
.mobile-card-company {
    font-family: var(--font-display);
    font-weight: 700; font-size: 0.92rem;
    color: var(--on-surface);
    margin-bottom: 4px;
    letter-spacing: -0.01em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mobile-card-subject {
    font-family: var(--font-body);
    font-size: 0.78rem; font-weight: 400;
    color: var(--on-surface-v);
    line-height: 1.4;
    margin-bottom: 8px;
    display: -webkit-box; -webkit-line-clamp: 2;
    -webkit-box-orient: vertical; overflow: hidden;
}
.mobile-card-meta {
    display: flex; align-items: center;
    gap: 12px; flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 0.66rem; font-weight: 500;
    color: var(--text-muted);
}
.mobile-card-meta span {
    display: inline-flex; align-items: center; gap: 4px;
}
.mobile-card-badge {
    display: inline-flex; align-items: center; gap: 3px;
    background: var(--secondary-dim);
    border: 1px solid var(--secondary-border);
    color: var(--secondary);
    font-family: var(--font-display);
    font-size: 0.6rem; font-weight: 600;
    padding: 2px 8px; border-radius: 20px;
    letter-spacing: 0.03em;
}
.mobile-card-badge--empty {
    background: transparent;
    border-color: var(--outline-variant);
    color: var(--text-faint);
}
.mobile-cards-count {
    font-family: var(--font-body);
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
    padding: 8px 0 4px;
}

/* ── Tablet breakpoint (768px) — the core mobile shift ─────────────── */
@media (max-width: 768px) {

    /* Column stacking — Streamlit horizontal blocks become vertical */
    [data-testid="stHorizontalBlock"] {
        flex-wrap: wrap !important;
        gap: 8px !important;
    }
    [data-testid="stHorizontalBlock"] > [data-testid="column"] {
        width: 100% !important;
        flex: 1 1 100% !important;
        min-width: 0 !important;
    }

    /* Tighter app shell */
    [data-testid="stAppViewContainer"] > .main .block-container {
        padding: 1rem 0.75rem 4rem !important;
        max-width: 100% !important;
    }

    /* Typography scale-down */
    .results-hero-count {
        font-size: 2.4rem !important;
    }
    .results-hero-label {
        font-size: 0.72rem !important;
    }

    /* KPI cards — compact on tablet */
    .kpi-grid {
        gap: 8px !important;
    }
    .kpi-card {
        padding: 10px 12px !important;
    }
    .kpi-value {
        font-size: 1.05rem !important;
    }
    .kpi-label {
        font-size: 0.5rem !important;
    }

    /* Touch-friendly buttons — 44px minimum */
    .stButton > button,
    .stDownloadButton > button,
    [data-testid="stBaseButton-primary"],
    [data-testid="stBaseButton-secondary"] {
        min-height: 44px !important;
        font-size: 0.85rem !important;
        padding: 10px 18px !important;
    }

    /* iOS zoom prevention — inputs at 16px */
    input, select, textarea,
    [data-testid="stTextInput"] input,
    [data-testid="stSelectbox"] input,
    [data-testid="stMultiSelect"] input,
    [data-testid="stNumberInput"] input,
    [data-testid="stDateInput"] input,
    [data-testid="stTextArea"] textarea {
        font-size: 16px !important;
    }

    /* Tabs — horizontally scrollable */
    [data-testid="stTabs"] [role="tablist"] {
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        gap: 4px !important;
        padding-bottom: 4px;
    }
    [data-testid="stTabs"] [role="tablist"]::-webkit-scrollbar {
        display: none;
    }
    [data-testid="stTabs"] [data-baseweb="tab"] {
        white-space: nowrap;
        min-height: 40px !important;
        font-size: 0.78rem !important;
        padding: 8px 14px !important;
    }

    /* Checkbox — larger tap target */
    [data-testid="stCheckbox"] label {
        min-height: 40px !important;
        display: flex !important;
        align-items: center !important;
        padding: 6px 10px 6px 6px !important;
        margin: 0 !important;
    }

    /* Welcome screen — compact */
    .welcome-panel {
        padding: 20px 20px 24px !important;
        margin: 0 auto !important;
    }
    .welcome-brand {
        font-size: 1.3rem !important;
    }
    .welcome-title {
        font-size: 1.15rem !important;
    }
    .welcome-subtitle {
        font-size: 0.8rem !important;
    }
    .hero-media {
        max-width: 260px !important;
    }

    /* Connect button — full-width, prominent */
    .connect-btn-wrapper .stLinkButton > a {
        min-height: 48px !important;
        font-size: 0.95rem !important;
    }

    /* Action bar — compact */
    .action-bar {
        padding: 10px 14px !important;
        flex-wrap: wrap !important;
        gap: 8px !important;
    }
    .action-bar .stButton > button,
    .action-bar .stDownloadButton > button {
        min-height: 40px !important;
        font-size: 0.78rem !important;
        padding: 8px 14px !important;
    }

    /* Selectbox / multiselect — touch-sized */
    [data-testid="stSelectbox"] > div > div,
    [data-testid="stMultiSelect"] > div > div {
        min-height: 42px !important;
    }

    /* Chart surfaces — edge-to-edge */
    [data-testid="stPlotlyChart"] {
        border-radius: var(--radius-md) !important;
        margin-left: -4px !important;
        margin-right: -4px !important;
    }

    /* Data tables — smaller font */
    [data-testid="stDataFrame"] {
        font-size: 0.72rem !important;
    }

    /* Sidebar — wider slide-over */
    [data-testid="stSidebar"] {
        min-width: 280px !important;
        max-width: 85vw !important;
    }
    [data-testid="stSidebar"] .block-container {
        padding: 1rem 0.75rem !important;
    }

    /* Show mobile cards, hide desktop table */
    .mobile-cards {
        display: block !important;
    }
    .desktop-table {
        display: none !important;
    }

    /* Setup card — compact */
    .setup-card {
        padding: 20px !important;
        margin: 0 8px !important;
    }
    .setup-card ol {
        font-size: 0.8rem !important;
        padding-right: 20px !important;
    }

    /* Scan composer card — compact */
    .scan-composer {
        padding: 16px !important;
    }

    /* Privacy badge — smaller */
    .privacy-badge {
        font-size: 0.68rem !important;
        padding: 6px 14px !important;
    }

    /* Footer — compact */
    .app-footer {
        padding: 12px 16px !important;
        font-size: 0.62rem !important;
    }

    /* Export workbench tiers — stacked */
    .tier-card {
        padding: 10px 12px !important;
    }

    /* Empty states — compact */
    .empty-hero {
        padding: 28px 20px !important;
    }
    .empty-hero-icon {
        width: 44px !important; height: 44px !important;
        font-size: 1.2rem !important;
    }
    .empty-hero h3 {
        font-size: 0.95rem !important;
    }
}

/* ── Phone breakpoint (480px) — ultra-compact ──────────────────────── */
@media (max-width: 480px) {

    /* Even tighter shell */
    [data-testid="stAppViewContainer"] > .main .block-container {
        padding: 0.75rem 0.5rem 4rem !important;
    }

    /* Hero count — smaller */
    .results-hero-count {
        font-size: 1.9rem !important;
    }

    /* KPI grid — 2+1 wrap layout */
    .kpi-grid {
        flex-wrap: wrap !important;
        gap: 6px !important;
    }
    .kpi-card {
        flex: 1 1 calc(50% - 4px) !important;
        min-width: 0 !important;
        padding: 8px 10px !important;
    }
    .kpi-card:last-child {
        flex: 1 1 100% !important;
    }
    .kpi-value {
        font-size: 0.95rem !important;
    }
    .kpi-value-text {
        font-size: 0.68rem !important;
    }

    /* Hero media — smaller */
    .hero-media {
        max-width: 200px !important;
    }

    /* Welcome — ultra-compact */
    .welcome-panel {
        padding: 16px 14px 18px !important;
    }
    .welcome-brand {
        font-size: 1.1rem !important;
    }
    .welcome-title {
        font-size: 0.95rem !important;
    }

    /* Mobile cards — tighter */
    .mobile-card {
        padding: 12px 14px !important;
        margin-bottom: 8px !important;
    }
    .mobile-card-company {
        font-size: 0.85rem !important;
    }
    .mobile-card-subject {
        font-size: 0.72rem !important;
    }
    .mobile-card-meta {
        font-size: 0.6rem !important;
        gap: 8px !important;
    }

    /* Sidebar — full-width on phones */
    [data-testid="stSidebar"] {
        max-width: 100vw !important;
    }

    /* Chart container — no border-radius on phones */
    [data-testid="stPlotlyChart"] {
        border-radius: var(--radius-sm) !important;
    }

    /* Tabs — even more compact */
    [data-testid="stTabs"] [data-baseweb="tab"] {
        font-size: 0.72rem !important;
        padding: 6px 10px !important;
        min-height: 36px !important;
    }
}

/* ── Touch device refinements ──────────────────────────────────────── */
@media (hover: none) and (pointer: coarse) {
    /* Remove hover-only effects that don't work on touch */
    .kpi-card:hover {
        transform: none;
        border-color: var(--outline-variant);
        box-shadow: none;
    }
    [data-testid="stPlotlyChart"]:hover {
        border-color: var(--outline-variant);
        box-shadow: var(--shadow-sm);
    }

    /* Larger tap targets for touch */
    .stButton > button,
    .stDownloadButton > button {
        min-height: 44px;
    }
    [data-testid="stCheckbox"] label {
        min-height: 44px;
    }

    /* Smooth momentum scrolling */
    [data-testid="stAppViewContainer"],
    [data-testid="stSidebar"] {
        -webkit-overflow-scrolling: touch;
    }
}

/* ── Safe area insets (notched phones) ─────────────────────────────── */
@supports (padding: env(safe-area-inset-bottom)) {
    [data-testid="stAppViewContainer"] > .main .block-container {
        padding-bottom: calc(4rem + env(safe-area-inset-bottom)) !important;
    }
    .app-footer {
        padding-bottom: calc(12px + env(safe-area-inset-bottom)) !important;
    }
}

</style>
"""
