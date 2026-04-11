"""
ניתוח נתונים — גרפי Plotly בסגנון Onyx לניתוח חשבוניות.
"""

import re
from collections import Counter

import plotly.graph_objects as go
import streamlit as st
from email.utils import parsedate_to_datetime

# ── Obsidian Luxe Palette ──────────────────────────────────────────────────
_PRIMARY = "#5B8DEF"
_TEAL    = "#34D399"
_ORANGE  = "#E8A849"
_BLUE    = "#7BA6F7"
_CORAL   = "#F87171"
_VIOLET  = "#A78BFA"
_DARK    = "#080b12"
_CARD    = "#0e1219"
_TEXT    = "#F0F2F5"
_MUTED   = "#7E8C9F"
_CHART_COLORS = [_PRIMARY, _TEAL, _BLUE, _VIOLET, _ORANGE, _CORAL, "#6EE7B7", "#93C5FD", "#C4B5FD"]
_TEMPLATE = "plotly_dark"
_MONTHS_HE = {1:"\u05d9\u05e0\u05d5\u05d0\u05e8",2:"\u05e4\u05d1\u05e8\u05d5\u05d0\u05e8",3:"\u05de\u05e8\u05e5",4:"\u05d0\u05e4\u05e8\u05d9\u05dc",5:"\u05de\u05d0\u05d9",6:"\u05d9\u05d5\u05e0\u05d9",
               7:"\u05d9\u05d5\u05dc\u05d9",8:"\u05d0\u05d5\u05d2\u05d5\u05e1\u05d8",9:"\u05e1\u05e4\u05d8\u05de\u05d1\u05e8",10:"\u05d0\u05d5\u05e7\u05d8\u05d5\u05d1\u05e8",11:"\u05e0\u05d5\u05d1\u05de\u05d1\u05e8",12:"\u05d3\u05e6\u05de\u05d1\u05e8"}
_FONT_FAMILY = "'Outfit', 'Heebo', system-ui, sans-serif"


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
            color=_PRIMARY,
            opacity=0.9,
            line=dict(color="rgba(0,0,0,0)", width=0),
        ),
        hovertemplate="<b>%{x}</b><br>%{y} חשבוניות<extra></extra>",
    ))
    fig.update_layout(
        template=_TEMPLATE,
        title=dict(text="<b>חשבוניות לפי חודש</b>", x=0.5, xanchor="center",
                   font=dict(size=14, color=_TEXT, family=_FONT_FAMILY)),
        xaxis_title=None, yaxis_title=None,
        xaxis=dict(tickangle=-35, tickfont=dict(color=_MUTED, size=11, family=_FONT_FAMILY)),
        yaxis=dict(tickfont=dict(color=_MUTED, size=11, family=_FONT_FAMILY),
                   gridcolor="rgba(255,255,255,0.04)", zeroline=False),
        plot_bgcolor="rgba(0,0,0,0)",
        paper_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=48, b=56, l=36, r=16),
        font=dict(color=_TEXT, family=_FONT_FAMILY),
        hoverlabel=dict(bgcolor="#161c28", bordercolor="rgba(91,141,239,0.25)",
                        font=dict(color=_TEXT, size=12, family=_FONT_FAMILY)),
        bargap=0.3,
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

    _pull = [0.02] * min(3, len(labels)) + [0] * max(0, len(labels) - 3)
    fig = go.Figure(go.Pie(
        labels=labels, values=values,
        marker=dict(colors=_CHART_COLORS[:len(labels)],
                    line=dict(color="#0e1219", width=2)),
        textinfo="label+percent",
        textfont=dict(color=_TEXT, size=10, family=_FONT_FAMILY),
        hovertemplate="<b>%{label}</b><br>%{value} חשבוניות (%{percent})<extra></extra>",
        pull=_pull,
    ))
    fig.update_layout(
        template=_TEMPLATE,
        title=dict(text="<b>לפי שולח (דומיין)</b>", x=0.5, xanchor="center",
                   font=dict(size=14, color=_TEXT, family=_FONT_FAMILY)),
        paper_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=48, b=16),
        font=dict(color=_TEXT, family=_FONT_FAMILY),
        hoverlabel=dict(bgcolor="#161c28", bordercolor="rgba(91,141,239,0.25)",
                        font=dict(color=_TEXT, size=12, family=_FONT_FAMILY)),
        showlegend=False,
    )
    return fig


def _donut_attachment_status(results: list[dict]) -> go.Figure:
    with_att = sum(1 for r in results if r.get("saved_path"))
    without = len(results) - with_att

    fig = go.Figure(go.Pie(
        labels=["עם קובץ מצורף", "ללא קובץ מצורף"],
        values=[with_att, without],
        hole=0.6,
        marker=dict(colors=[_TEAL, "rgba(248,113,113,0.7)"],
                    line=dict(color="#0e1219", width=2)),
        textinfo="label+value",
        textfont=dict(color=_TEXT, size=10, family=_FONT_FAMILY),
        hovertemplate="<b>%{label}</b><br>%{value} (%{percent})<extra></extra>",
    ))
    fig.update_layout(
        template=_TEMPLATE,
        title=dict(text="<b>סטטוס קבצים מצורפים</b>", x=0.5, xanchor="center",
                   font=dict(size=14, color=_TEXT, family=_FONT_FAMILY)),
        paper_bgcolor="rgba(0,0,0,0)",
        margin=dict(t=48, b=16),
        font=dict(color=_TEXT, family=_FONT_FAMILY),
        hoverlabel=dict(bgcolor="#161c28", bordercolor="rgba(91,141,239,0.25)",
                        font=dict(color=_TEXT, size=12, family=_FONT_FAMILY)),
        showlegend=False,
    )
    return fig


def render_analytics(results: list[dict]) -> None:
    """Analytics charts — called inside the analytics tab."""
    if not results:
        st.markdown(
            '<div class="empty-hero" style="padding:32px 20px;">'
            '<p>\u05d0\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd \u05dc\u05d4\u05e6\u05d2\u05d4</p>'
            '</div>',
            unsafe_allow_html=True,
        )
        return

    _chart_config = {"displayModeBar": False, "scrollZoom": False}

    col1, col2 = st.columns(2)
    with col1:
        st.plotly_chart(_bar_by_month(results), use_container_width=True, config=_chart_config)
    with col2:
        st.plotly_chart(_pie_by_sender(results), use_container_width=True, config=_chart_config)

    _, col_donut, _ = st.columns([1, 2, 1])
    with col_donut:
        st.plotly_chart(_donut_attachment_status(results), use_container_width=True, config=_chart_config)
