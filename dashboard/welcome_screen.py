"""
מסך ברוכים הבאים — עיצוב SaaS כהה, כפתור אחד בלבד לחיבור Google.
"""

import os
import sys
import time
from pathlib import Path

import streamlit as st

sys.path.insert(0, str(Path(__file__).parent.parent))


def _inject_welcome_css():
    st.markdown("""
    <style>
    @keyframes fadein {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .welcome-panel {
        background: linear-gradient(145deg, #1E293B 0%, #0F172A 100%);
        border: 1px solid rgba(59,130,246,0.25);
        border-radius: 24px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
        padding: 48px 44px 44px 44px;
        max-width: 480px;
        margin: 40px auto 0 auto;
        position: relative;
        overflow: hidden;
        animation: fadein 0.5s ease both;
    }

    .welcome-panel::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, #3B82F6, #8B5CF6, #10B981);
        border-radius: 24px 24px 0 0;
    }

    .welcome-panel::after {
        content: '';
        position: absolute;
        bottom: -60px; right: -60px;
        width: 200px; height: 200px;
        background: radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%);
        border-radius: 50%;
    }

    .welcome-icon {
        font-size: 4rem;
        display: block;
        text-align: center;
        margin-bottom: 20px;
        line-height: 1;
    }

    .welcome-title {
        font-size: 1.9rem;
        font-weight: 900;
        color: #F8FAFC;
        text-align: center;
        margin-bottom: 8px;
        line-height: 1.2;
        letter-spacing: -0.02em;
    }

    .welcome-subtitle {
        color: #94A3B8;
        font-size: 0.95rem;
        text-align: center;
        direction: rtl;
        margin-bottom: 36px;
        font-weight: 500;
        line-height: 1.6;
    }

    .connect-btn-wrapper > div > button {
        background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%) !important;
        color: #ffffff !important;
        font-size: 1rem !important;
        font-weight: 700 !important;
        padding: 14px 28px !important;
        border-radius: 12px !important;
        border: none !important;
        width: 100% !important;
        cursor: pointer !important;
        box-shadow: 0 4px 20px rgba(59,130,246,0.5) !important;
        letter-spacing: 0.02em !important;
        transition: all 0.2s ease !important;
    }

    .connect-btn-wrapper > div > button:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 8px 32px rgba(59,130,246,0.6) !important;
        background: linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%) !important;
    }

    .connect-btn-wrapper > div > button:active {
        transform: translateY(0) !important;
        box-shadow: 0 2px 8px rgba(59,130,246,0.4) !important;
    }

    .readonly-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        color: #94A3B8;
        font-size: 0.78rem;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 100px;
        text-align: center;
        direction: rtl;
        margin-top: 20px;
    }

    .not-configured-card {
        background: #1E293B;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.4);
        padding: 40px 44px;
        direction: rtl;
        text-align: right;
        max-width: 620px;
        margin: 40px auto;
        animation: fadein 0.5s ease both;
        position: relative;
        overflow: hidden;
    }

    .not-configured-card::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 3px;
        background: linear-gradient(90deg, #F59E0B, #EF4444);
        border-radius: 20px 20px 0 0;
    }

    .env-pill {
        display: inline-block;
        background: rgba(59,130,246,0.15);
        border: 1px solid rgba(59,130,246,0.3);
        color: #60A5FA;
        font-family: 'Cascadia Code', 'Consolas', monospace;
        font-size: 0.82rem;
        padding: 2px 10px;
        border-radius: 6px;
        font-weight: 600;
    }

    .env-block {
        background: #0F172A;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        box-shadow: inset 0 2px 8px rgba(0,0,0,0.3);
        padding: 18px 22px;
        font-family: 'Cascadia Code', 'Consolas', monospace;
        font-size: 0.85rem;
        color: #F8FAFC;
        direction: ltr;
        text-align: left;
        margin-top: 16px;
        line-height: 2.2;
    }
    </style>
    """, unsafe_allow_html=True)


def render_welcome_screen() -> bool:
    """
    מציג מסך ברוכים הבאים עם כפתור חיבור Google יחיד.
    מחזיר True אם החיבור הושלם בהצלחה.

    Flow:
      1. User clicks the link button → sent to Google consent screen.
      2. Google redirects back to APP_URL?code=XXX.
      3. Streamlit reruns; we exchange the code for a token here.
    """
    from core.gmail_connector import GmailConnector

    _inject_welcome_css()

    connector = GmailConnector()
    redirect_uri = os.environ.get("APP_URL", "http://localhost:8501")

    # ── Step 2/3: handle Google's OAuth callback (?code=...) ────────────────
    if "code" in st.query_params:
        with st.spinner("מחבר לגוגל..."):
            success = connector.exchange_code(st.query_params["code"], redirect_uri)
        st.query_params.clear()
        if success:
            st.success("מחובר בהצלחה! טוען את הדשבורד...")
            st.balloons()
            time.sleep(1.2)
            return True
        else:
            st.error("החיבור נכשל. בדוק את ה-Client ID וה-Secret ונסה שוב.")

    # ── Step 1: show connect button ──────────────────────────────────────────
    _, center, _ = st.columns([1, 2, 1])

    with center:
        st.markdown(
            '<div class="welcome-panel" dir="rtl">'
            '<span class="welcome-icon">📊</span>'
            '<div class="welcome-title" dir="rtl">חשבוניות חכמה</div>'
            '<div class="welcome-subtitle" dir="rtl">'
            'ניתוח חשבוניות וקבלות אוטומטי מתיבת הדואר שלך'
            '</div>'
            '</div>',
            unsafe_allow_html=True,
        )

        st.markdown("<div style='height:20px;'></div>", unsafe_allow_html=True)

        auth_url = connector.get_auth_url(redirect_uri)
        st.markdown('<div class="connect-btn-wrapper">', unsafe_allow_html=True)
        st.link_button("🔗  התחבר לחשבון Google", auth_url, use_container_width=True, type="primary")
        st.markdown("</div>", unsafe_allow_html=True)

        st.markdown(
            '<div style="text-align:center;">'
            '<span class="readonly-badge" dir="rtl">'
            '🔒 גישת קריאה בלבד · לא נשמרת סיסמא'
            '</span>'
            '</div>',
            unsafe_allow_html=True,
        )

    return False


def render_not_configured_screen():
    """
    מוצג כאשר GID או GSECRET חסרים מ-.env.
    """
    _inject_welcome_css()

    _, center, _ = st.columns([1, 3, 1])

    with center:
        st.markdown(
            '<div class="not-configured-card" dir="rtl">'
            '<div style="font-size:2.4rem; text-align:center; margin-bottom:20px;">⚙️</div>'
            '<h3 dir="rtl" style="color:#F8FAFC; text-align:center; margin-bottom:8px; font-weight:800; font-size:1.5rem;">'
            'נדרשת הגדרה ראשונית'
            '</h3>'
            '<p style="color:#94A3B8; text-align:center; margin-bottom:28px; font-size:0.9rem;">השלם את ההגדרות הבאות כדי להתחיל</p>'
            '<p dir="rtl" style="color:#CBD5E1; line-height:1.9; font-size:0.95rem;">'
            'כדי להפעיל את המערכת, יש להגדיר פעם אחת את פרטי OAuth2 בקובץ '
            '<span class="env-pill">.env</span>:'
            '</p>'
            '<ol dir="rtl" style="color:#CBD5E1; line-height:2.4; margin-top:16px; font-size:0.9rem;">'
            '<li>כנס ל-<a href="https://console.cloud.google.com/apis/credentials" target="_blank" '
            'style="color:#60A5FA; font-weight:600; text-decoration:none;">console.cloud.google.com</a>'
            ' ← צור פרויקט ← הפעל Gmail API</li>'
            '<li>צור <strong style="color:#F8FAFC;">OAuth 2.0 Client ID</strong> מסוג <strong style="color:#F8FAFC;">Desktop app</strong></li>'
            '<li>העתק את ה-Client ID וה-Client Secret לקובץ <span class="env-pill">.env</span>:</li>'
            '</ol>'
            '<div class="env-block">'
            'GID=<span style="color:#60A5FA;">your_client_id.apps.googleusercontent.com</span><br>'
            'GSECRET=<span style="color:#34D399;">your_client_secret</span>'
            '</div>'
            '<p dir="rtl" style="color:#475569; font-size:0.82rem; margin-top:20px; text-align:center;">'
            'לאחר ההגדרה — הפעל מחדש את האפליקציה'
            '</p>'
            '</div>',
            unsafe_allow_html=True,
        )
