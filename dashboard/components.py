"""
רכיבי ממשק משתמש — עיצוב SaaS כהה מקצועי.
"""

import streamlit as st
import pandas as pd
from datetime import datetime


def inject_css():
    """מזריק CSS בסגנון SaaS כהה מקצועי."""
    st.markdown("""
<style>
/* ── Base & Layout ─────────────────────────────────────────────────── */
html, body, [data-testid="stAppViewContainer"] {
    direction: rtl;
    background-color: #0F172A;
    color: #F8FAFC;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}

[data-testid="stAppViewContainer"] > .main {
    background-color: #0F172A;
}

/* ── Sidebar ────────────────────────────────────────────────────────── */
[data-testid="stSidebar"] {
    background-color: #1E293B !important;
    border-right: 1px solid rgba(255,255,255,0.06);
    border-left: none;
}

[data-testid="stSidebar"] * {
    color: #F8FAFC !important;
    direction: rtl;
    text-align: right;
}

[data-testid="stSidebar"] .stSlider label,
[data-testid="stSidebar"] .stTextArea label,
[data-testid="stSidebar"] .stCheckbox label {
    color: #94A3B8 !important;
    font-weight: 600;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

[data-testid="stSidebar"] hr {
    border-color: rgba(255,255,255,0.08) !important;
    margin: 16px 0;
}

/* ── Metric Cards ───────────────────────────────────────────────────── */
[data-testid="stMetric"] {
    background: #1E293B;
    border-radius: 16px;
    padding: 20px 24px;
    border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
    direction: rtl;
    text-align: right;
    position: relative;
    overflow: hidden;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

[data-testid="stMetric"]:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}

[data-testid="stMetricLabel"] {
    color: #94A3B8 !important;
    font-size: 0.75rem;
    font-weight: 700;
    text-align: right;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

[data-testid="stMetricValue"] {
    color: #F8FAFC !important;
    font-size: 2rem;
    font-weight: 800;
    text-align: right;
}

[data-testid="stMetricDelta"] {
    font-size: 0.85rem;
}

/* ── Buttons ────────────────────────────────────────────────────────── */
.stButton > button {
    background: #3B82F6 !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 700;
    font-size: 0.95rem;
    padding: 10px 24px;
    direction: rtl;
    width: 100%;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(59,130,246,0.4) !important;
    letter-spacing: 0.02em;
    transition: all 0.2s ease !important;
}

.stButton > button:hover {
    background: #2563EB !important;
    box-shadow: 0 4px 16px rgba(59,130,246,0.5) !important;
    transform: translateY(-1px);
}

.stButton > button:active {
    transform: translateY(0) !important;
    box-shadow: 0 1px 4px rgba(59,130,246,0.3) !important;
}

/* Scan button — accent color */
.sidebar-scan-btn > div > button {
    background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%) !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 800 !important;
    font-size: 1rem !important;
    box-shadow: 0 4px 16px rgba(59,130,246,0.45) !important;
    transition: all 0.2s ease !important;
}

.sidebar-scan-btn > div > button:hover {
    transform: translateY(-1px) !important;
    box-shadow: 0 6px 24px rgba(59,130,246,0.6) !important;
}

/* Download button */
[data-testid="stDownloadButton"] > button {
    background: #10B981 !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 700;
    box-shadow: 0 2px 8px rgba(16,185,129,0.4) !important;
    transition: all 0.2s ease !important;
}

[data-testid="stDownloadButton"] > button:hover {
    background: #059669 !important;
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(16,185,129,0.5) !important;
}

/* ── Data Table ─────────────────────────────────────────────────────── */
[data-testid="stDataFrame"] {
    background-color: #1E293B;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
}

/* ── Text Inputs ────────────────────────────────────────────────────── */
.stTextInput > div > div > input,
.stTextArea > div > div > textarea {
    background-color: #0F172A !important;
    color: #F8FAFC !important;
    border: 1px solid rgba(255,255,255,0.12) !important;
    border-radius: 10px;
    direction: rtl;
    text-align: right;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.stTextInput > div > div > input:focus,
.stTextArea > div > div > textarea:focus {
    border-color: #3B82F6 !important;
    box-shadow: 0 0 0 3px rgba(59,130,246,0.2) !important;
}

.stTextInput label, .stTextArea label {
    color: #94A3B8 !important;
    font-weight: 600;
    direction: rtl;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.75rem;
}

/* ── Select / Dropdown ──────────────────────────────────────────────── */
[data-testid="stSelectbox"] > div > div {
    background-color: #0F172A !important;
    border: 1px solid rgba(255,255,255,0.12) !important;
    border-radius: 10px !important;
    color: #F8FAFC !important;
}

/* ── Progress Bar ───────────────────────────────────────────────────── */
.stProgress > div > div > div {
    background: linear-gradient(90deg, #3B82F6, #2563EB) !important;
    border-radius: 8px;
}

.stProgress > div > div {
    background-color: rgba(255,255,255,0.08) !important;
    border-radius: 8px;
}

/* ── Alerts ─────────────────────────────────────────────────────────── */
[data-testid="stAlert"] {
    background-color: rgba(59,130,246,0.1) !important;
    border-radius: 12px;
    border-left: 4px solid #3B82F6;
    color: #F8FAFC !important;
    direction: rtl;
    text-align: right;
}

/* ── Headings ───────────────────────────────────────────────────────── */
h1, h2, h3, h4, h5, h6 {
    color: #F8FAFC;
    direction: rtl;
    text-align: right;
}

/* ── Dividers ───────────────────────────────────────────────────────── */
hr {
    border: none;
    border-top: 1px solid rgba(255,255,255,0.08);
    margin: 20px 0;
}

/* ── Scrollbar ──────────────────────────────────────────────────────── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #0F172A; border-radius: 8px; }
::-webkit-scrollbar-thumb { background: #334155; border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: #475569; }

/* ── Column direction ───────────────────────────────────────────────── */
[data-testid="column"] { direction: rtl; }

/* ── Stat card custom class ─────────────────────────────────────────── */
.saas-card {
    background: #1E293B;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 24px;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.saas-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}

/* ── Section titles ─────────────────────────────────────────────────── */
.section-title {
    color: #F8FAFC;
    font-size: 1.25rem;
    font-weight: 700;
    direction: rtl;
    text-align: right;
    margin-bottom: 16px;
    padding-right: 12px;
    border-right: 3px solid #3B82F6;
}
</style>
""", unsafe_allow_html=True)


def render_sidebar() -> dict:
    """מציג את סרגל הצד עם הגדרות הסריקה ומחזיר dict של פרמטרים."""
    with st.sidebar:
        st.markdown("""
        <div style="padding: 16px 0 24px 0; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 24px;">
            <div style="font-size: 0.7rem; font-weight: 700; color: #3B82F6; text-transform: uppercase;
                        letter-spacing: 0.1em; margin-bottom: 6px;">Invoice Fetcher</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: #F8FAFC;">הגדרות סריקה</div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown('<p style="color:#94A3B8; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; margin-bottom:8px;">טווח תאריכים</p>', unsafe_allow_html=True)
        days_back = st.slider(
            "ימים אחורה",
            min_value=7, max_value=365, value=30, step=1,
            help="בחר כמה ימים אחורה לסרוק",
        )

        st.markdown('<div style="height:16px;"></div>', unsafe_allow_html=True)
        st.markdown('<p style="color:#94A3B8; font-size:0.7rem; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; margin-bottom:8px;">מילות מפתח</p>', unsafe_allow_html=True)
        keywords_raw = st.text_area(
            "מילות מפתח (שורה לכל מילה)",
            value="חשבונית\nקבלה\nאישור תשלום\ninvoice\nreceipt",
            height=140,
            help="כל מילה בשורה נפרדת",
        )

        st.markdown('<div style="height:8px;"></div>', unsafe_allow_html=True)
        unread_only = st.checkbox(
            "רק הודעות שלא נקראו",
            value=True,
            help="סנן רק הודעות שטרם נקראו",
        )

        st.markdown('<div style="height:24px;"></div>', unsafe_allow_html=True)
        st.markdown('<div class="sidebar-scan-btn">', unsafe_allow_html=True)
        start_scan = st.button("🚀  התחל סריקה", type="primary", use_container_width=True)
        st.markdown("</div>", unsafe_allow_html=True)

    keywords = [k.strip() for k in keywords_raw.splitlines() if k.strip()]
    return {"days_back": days_back, "keywords": keywords, "unread_only": unread_only, "start_scan": start_scan}


def render_header():
    """מציג את הכותרת הראשית בסגנון SaaS כהה."""
    st.markdown("""
    <div style="
        background: linear-gradient(135deg, #1E40AF 0%, #1E293B 60%, #0F172A 100%);
        border: 1px solid rgba(59,130,246,0.2);
        border-radius: 16px;
        padding: 32px 36px;
        margin-bottom: 28px;
        position: relative;
        overflow: hidden;
    ">
        <div style="
            position: absolute; top: 0; left: 0; right: 0; height: 3px;
            background: linear-gradient(90deg, #3B82F6, #8B5CF6, #10B981);
            border-radius: 16px 16px 0 0;
        "></div>
        <div style="position: relative; z-index: 1; direction: rtl; text-align: right;">
            <div style="font-size: 0.75rem; font-weight: 700; color: #60A5FA;
                        text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">
                מערכת ניהול חשבוניות
            </div>
            <h1 style="color: #F8FAFC; font-size: 2.2rem; font-weight: 900; margin: 0 0 8px 0;
                       letter-spacing: -0.02em; line-height: 1.1; text-align: right;">
                חשבוניות חכמה
            </h1>
            <p style="color: #94A3B8; font-size: 1rem; margin: 0; font-weight: 500; text-align: right;">
                סורק ומנתח חשבוניות וקבלות מתיבת הדואר האלקטרוני שלך
            </p>
        </div>
        <div style="
            position: absolute; bottom: -30px; left: -30px;
            width: 160px; height: 160px;
            background: radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%);
            border-radius: 50%;
        "></div>
    </div>
    """, unsafe_allow_html=True)


_METRIC_ACCENTS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"]


def render_metrics(results: list[dict]):
    """מציג 4 כרטיסי מדד."""
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
        ('סה"כ חשבוניות', total, "#3B82F6", "📄"),
        ("עם קובץ מצורף", with_att, "#10B981", "📎"),
        ("שולחים ייחודיים", unique_senders, "#F59E0B", "👤"),
        ("טווח תאריכים", date_range, "#8B5CF6", "📅"),
    ]

    c1, c2, c3, c4 = st.columns(4)
    for col, (label, value, accent, icon) in zip([c1, c2, c3, c4], metrics):
        with col:
            st.markdown(
                f'<div style="height:3px; background:{accent}; border-radius:2px; margin-bottom:2px;"></div>',
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
