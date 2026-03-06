"""
ניתוח נתונים — גרפי Plotly בסגנון Hockney בהיר לניתוח חשבוניות.
"""

import re
from collections import Counter

import plotly.graph_objects as go
import streamlit as st
from email.utils import parsedate_to_datetime

_BLUE    = "#3B82F6"
_GREEN   = "#10B981"
_AMBER   = "#F59E0B"
_PURPLE  = "#8B5CF6"
_RED     = "#EF4444"
_CYAN    = "#06B6D4"
_DARK    = "#0F172A"
_CARD    = "#1E293B"
_TEXT    = "#F8FAFC"
_MUTED   = "#94A3B8"
_CHART_COLORS = [_BLUE, _GREEN, _AMBER, _PURPLE, _RED, _CYAN, "#F97316", "#EC4899", "#14B8A6"]
_TEMPLATE = "plotly_dark"
_MONTHS_HE = {1:"ינואר",2:"פברואר",3:"מרץ",4:"אפריל",5:"מאי",6:"יוני",
               7:"יולי",8:"אוגוסט",9:"ספטמבר",10:"אוקטובר",11:"נובמבר",12:"דצמבר"}


def _parse_date(s: str):
    try:
        return parsedate_to_datetime(s) if s else None
    except Exception:
        return None


def _domain(sender: str) -> str:
    m = re.search(r"@([\w.\-]+)", sender or "")
    return m.group(1).lower() if m else "לא ידוע"


def _month_label(ym: str) -> str:
    try:
        y, m = ym.split("-")
        return f"{_MONTHS_HE[int(m)]} {y}"
    except Exception:
        return ym


def _bar_by_month(results: list[dict]) -> go.Figure:
    counts: Counter = Counter()
    for r in results:
        dt = _parse_date(r.get("date", ""))
        if dt:
            counts[dt.strftime("%Y-%m")] += 1

    keys = sorted(counts)

    fig = go.Figure(go.Bar(
        x=[_month_label(k) for k in keys],
        y=[counts[k] for k in keys],
        marker=dict(
            color=_BLUE,
            opacity=0.85,
            line=dict(color=_CARD, width=1),
        ),
        hovertemplate="%{x}: %{y} חשבוניות<extra></extra>",
    ))
    fig.update_layout(
        template=_TEMPLATE,
        title=dict(text="<b>חשבוניות לפי חודש</b>", x=0.5, xanchor="center",
                   font=dict(size=16, color=_TEXT)),
        xaxis_title="חודש", yaxis_title="מספר חשבוניות",
        xaxis=dict(tickangle=-35, tickfont=dict(color=_MUTED), title_font=dict(color=_MUTED)),
        yaxis=dict(tickfont=dict(color=_MUTED), gridcolor="rgba(255,255,255,0.06)", title_font=dict(color=_MUTED)),
        plot_bgcolor=_CARD,
        paper_bgcolor=_CARD,
        margin=dict(t=60, b=80, l=40, r=20),
        font=dict(color=_TEXT, family="'Segoe UI', sans-serif"),
    )
    return fig


def _pie_by_sender(results: list[dict]) -> go.Figure:
    counts: Counter = Counter(_domain(r.get("sender", "")) for r in results)
    top8 = counts.most_common(8)
    other = len(results) - sum(v for _, v in top8)
    labels = [d for d, _ in top8]
    values = [v for _, v in top8]
    if other > 0:
        labels.append("אחר")
        values.append(other)

    fig = go.Figure(go.Pie(
        labels=labels, values=values,
        marker=dict(colors=_CHART_COLORS[:len(labels)],
                    line=dict(color=_CARD, width=2)),
        textinfo="label+percent",
        textfont=dict(color=_TEXT, size=12),
        hovertemplate="%{label}: %{value} (%{percent})<extra></extra>",
    ))
    fig.update_layout(
        template=_TEMPLATE,
        title=dict(text="<b>לפי שולח (דומיין)</b>", x=0.5, xanchor="center",
                   font=dict(size=16, color=_TEXT)),
        paper_bgcolor=_CARD,
        margin=dict(t=60, b=20),
        font=dict(color=_TEXT, family="'Segoe UI', sans-serif"),
    )
    return fig


def _donut_attachment_status(results: list[dict]) -> go.Figure:
    with_att = sum(1 for r in results if r.get("saved_path"))
    without = len(results) - with_att

    fig = go.Figure(go.Pie(
        labels=["עם קובץ מצורף", "ללא קובץ מצורף"],
        values=[with_att, without],
        hole=0.55,
        marker=dict(colors=[_GREEN, _RED],
                    line=dict(color=_CARD, width=3)),
        textinfo="label+value",
        textfont=dict(color=_TEXT, size=12),
        hovertemplate="%{label}: %{value} (%{percent})<extra></extra>",
    ))
    fig.update_layout(
        template=_TEMPLATE,
        title=dict(text="<b>סטטוס קבצים מצורפים</b>", x=0.5, xanchor="center",
                   font=dict(size=16, color=_TEXT)),
        paper_bgcolor=_CARD,
        margin=dict(t=60, b=20),
        font=dict(color=_TEXT, family="'Segoe UI', sans-serif"),
    )
    return fig


def render_analytics(results: list[dict]) -> None:
    """מציג את כל לוחות הניתוח עבור תוצאות הסריקה."""
    st.markdown(
        '<div class="section-title">📊 ניתוח נתונים</div>',
        unsafe_allow_html=True,
    )

    if not results:
        st.info("אין נתונים להצגה.")
        return

    col1, col2 = st.columns(2)
    with col1:
        st.plotly_chart(_bar_by_month(results), use_container_width=True)
    with col2:
        st.plotly_chart(_pie_by_sender(results), use_container_width=True)

    st.plotly_chart(_donut_attachment_status(results), use_container_width=True)
