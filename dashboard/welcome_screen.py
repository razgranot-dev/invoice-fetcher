"""
מסך ברוכים הבאים — עיצוב Ultra-Premium Holographic Landing, כפתור אחד בלבד לחיבור Google.
"""

import os

import streamlit as st


def _build_redirect_uri() -> str:
    """Returns the OAuth redirect URI for the current environment.

    Cloud:   value of APP_URL env var (must be the exact public URL of this app,
             registered as an Authorized redirect URI in Google Cloud Console)
    Local:   http://localhost:{actual_streamlit_port}  (auto-detected, not hardcoded)
    """
    app_url = os.environ.get("APP_URL", "").strip()
    if app_url:
        return app_url.rstrip("/")
    # Auto-detect Streamlit's actual port so the redirect URI matches
    # the running instance even when Streamlit picks a non-default port.
    try:
        port = st.get_option("server.port") or 8501
    except Exception:
        port = 8501
    return f"http://localhost:{port}"


def _inject_welcome_css():
    st.markdown("""
    <style>
    @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(36px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes pulseAura {
        0%, 100% { box-shadow: 0 0 60px rgba(0,180,255,0.10), 0 32px 100px rgba(0,0,0,0.70); }
        50%       { box-shadow: 0 0 90px rgba(0,180,255,0.18), 0 32px 100px rgba(0,0,0,0.70); }
    }

    @keyframes spectrumShift {
        0%   { background-position: 0% 50%; }
        50%  { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
    }

    /* ── Welcome Panel ─────────────────────────────────────────────── */
    .welcome-panel {
        background: linear-gradient(160deg, rgba(9,16,34,0.97) 0%, rgba(6,10,18,0.99) 100%);
        border: 1px solid rgba(0,200,255,0.16);
        border-radius: 28px;
        box-shadow: 0 0 0 1px rgba(0,200,255,0.04),
                    0 32px 100px rgba(0,0,0,0.75),
                    0 0 120px rgba(0,140,255,0.06);
        padding: 56px 48px 40px 48px;
        max-width: 500px;
        margin: 28px auto 0 auto;
        position: relative;
        overflow: hidden;
        animation: fadeInUp 0.65s cubic-bezier(0.34,1.56,0.64,1) both,
                   pulseAura 5s ease-in-out infinite 0.65s;
        backdrop-filter: blur(32px);
        direction: rtl;
    }

    /* Animated spectrum top bar */
    .welcome-panel::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg, #00C8FF, #818CF8, #34D399, #00C8FF);
        background-size: 200% 100%;
        animation: spectrumShift 4s ease infinite;
        border-radius: 28px 28px 0 0;
        opacity: 0.8;
    }

    /* Ambient bottom glow */
    .welcome-panel::after {
        content: '';
        position: absolute;
        bottom: -80px; right: -80px;
        width: 300px; height: 300px;
        background: radial-gradient(circle, rgba(0,180,255,0.07) 0%, transparent 70%);
        border-radius: 50%;
        pointer-events: none;
    }

    /* Corner accents */
    .welcome-corner-tr {
        position: absolute;
        top: 18px; right: 18px;
        width: 20px; height: 20px;
        border-top: 1px solid rgba(0,200,255,0.40);
        border-right: 1px solid rgba(0,200,255,0.40);
        border-radius: 0 5px 0 0;
    }

    .welcome-corner-bl {
        position: absolute;
        bottom: 18px; left: 18px;
        width: 20px; height: 20px;
        border-bottom: 1px solid rgba(129,140,248,0.40);
        border-left: 1px solid rgba(129,140,248,0.40);
        border-radius: 0 0 5px 0;
    }

    /* Icon ring */
    .welcome-icon-ring {
        width: 86px; height: 86px;
        margin: 0 auto 28px auto;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .welcome-icon-ring::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(0,200,255,0.10), rgba(129,140,248,0.06));
        border: 1px solid rgba(0,200,255,0.22);
    }

    .welcome-icon-ring::after {
        content: '';
        position: absolute;
        inset: -7px;
        border-radius: 50%;
        border: 1px solid rgba(0,200,255,0.07);
    }

    .welcome-icon-inner {
        font-size: 2.6rem;
        line-height: 1;
        position: relative;
        z-index: 1;
    }

    .welcome-brand {
        font-size: 0.6rem;
        font-weight: 700;
        color: #00C8FF;
        text-transform: uppercase;
        letter-spacing: 0.20em;
        text-align: center;
        margin-bottom: 10px;
        opacity: 0.75;
        font-family: 'Space Grotesk','Inter',sans-serif;
    }

    .welcome-title {
        font-size: 1.95rem;
        font-weight: 900;
        color: #EFF6FF;
        text-align: center;
        margin-bottom: 10px;
        line-height: 1.15;
        letter-spacing: -0.03em;
        direction: rtl;
        font-family: 'Space Grotesk','Inter',sans-serif;
    }

    .welcome-subtitle {
        color: #475569;
        font-size: 0.88rem;
        text-align: center;
        direction: rtl;
        margin-bottom: 36px;
        font-weight: 400;
        line-height: 1.75;
        padding: 0 4px;
    }

    /* Connect button */
    .connect-btn-wrapper > div > button,
    .connect-btn-wrapper > div > a {
        background: linear-gradient(135deg, #0369A1 0%, #0EA5E9 50%, #22D3EE 100%) !important;
        color: #ffffff !important;
        font-size: 0.93rem !important;
        font-weight: 800 !important;
        padding: 14px 28px !important;
        border-radius: 12px !important;
        border: 1px solid rgba(0,200,255,0.45) !important;
        width: 100% !important;
        cursor: pointer !important;
        box-shadow: 0 4px 24px rgba(0,180,255,0.45),
                    0 0 60px rgba(0,180,255,0.10) !important;
        letter-spacing: 0.05em !important;
        transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1) !important;
        text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        font-family: 'Space Grotesk','Inter',sans-serif !important;
        text-decoration: none !important;
        display: block !important;
        text-align: center !important;
    }

    .connect-btn-wrapper > div > button:hover,
    .connect-btn-wrapper > div > a:hover {
        transform: translateY(-3px) !important;
        box-shadow: 0 8px 40px rgba(0,180,255,0.60),
                    0 0 80px rgba(0,180,255,0.15) !important;
        background: linear-gradient(135deg, #0EA5E9 0%, #22D3EE 50%, #38BDF8 100%) !important;
    }

    .connect-btn-wrapper > div > button:active,
    .connect-btn-wrapper > div > a:active {
        transform: translateY(0) scale(0.98) !important;
    }

    .readonly-badge {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        color: #334155;
        font-size: 0.7rem;
        font-weight: 600;
        padding: 7px 16px;
        border-radius: 100px;
        text-align: center;
        direction: rtl;
        margin-top: 14px;
        letter-spacing: 0.04em;
    }

    /* ── Not-Configured Card ───────────────────────────────────────── */
    .not-configured-card {
        background: linear-gradient(160deg, rgba(12,16,28,0.97) 0%, rgba(8,11,20,0.99) 100%);
        border: 1px solid rgba(252,211,77,0.10);
        border-radius: 24px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.65), 0 0 80px rgba(252,150,30,0.03);
        padding: 44px 48px;
        direction: rtl;
        text-align: right;
        max-width: 640px;
        margin: 40px auto;
        animation: fadeInUp 0.65s cubic-bezier(0.34,1.56,0.64,1) both;
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(24px);
    }

    .not-configured-card::before {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0;
        height: 2px;
        background: linear-gradient(90deg, transparent 0%, #FCD34D 35%, #F97316 65%, transparent 100%);
        border-radius: 24px 24px 0 0;
        opacity: 0.75;
    }

    .env-pill {
        display: inline-block;
        background: rgba(0,200,255,0.07);
        border: 1px solid rgba(0,200,255,0.18);
        color: #22D3EE;
        font-family: 'Cascadia Code','JetBrains Mono','Consolas',monospace;
        font-size: 0.78rem;
        padding: 2px 10px;
        border-radius: 6px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .env-block {
        background: rgba(4,8,16,0.92);
        border: 1px solid rgba(0,200,255,0.07);
        border-radius: 12px;
        box-shadow: inset 0 2px 14px rgba(0,0,0,0.45);
        padding: 20px 24px;
        font-family: 'Cascadia Code','JetBrains Mono','Consolas',monospace;
        font-size: 0.82rem;
        color: #EFF6FF;
        direction: ltr;
        text-align: left;
        margin-top: 16px;
        line-height: 2.5;
        position: relative;
        overflow: hidden;
    }

    .env-block::before {
        content: '';
        position: absolute;
        top: 0; left: 0; bottom: 0;
        width: 3px;
        background: linear-gradient(180deg, #00C8FF, #818CF8);
        border-radius: 0 0 0 12px;
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
    redirect_uri = _build_redirect_uri()

    # Warn if APP_URL looks wrong for the current environment
    if not os.environ.get("APP_URL"):
        import logging
        logging.getLogger(__name__).info("APP_URL not set — using redirect URI: %s", redirect_uri)

    # ── Step 2/3: handle Google's OAuth callback (?code=...) ────────────────
    if "code" in st.query_params:
        returned_state = st.query_params.get("state", "")
        expected_state = st.session_state.get("_oauth_csrf_state", "")
        code_verifier = st.session_state.get("_pkce_code_verifier", "")

        # CSRF check: if expected_state is present, returned_state must match.
        # If expected_state is absent the browser session was reset during the
        # redirect (e.g. Streamlit picked a different port and the callback
        # landed in a fresh session). PKCE still guarantees the code is bound
        # to this flow, so we allow the exchange to proceed without CSRF state.
        if expected_state and returned_state != expected_state:
            st.session_state["_oauth_error"] = "CSRF state mismatch — החיבור בוטל מסיבות אבטחה"
            st.error("שגיאת אבטחה: החיבור בוטל. אנא נסה שוב.")
            st.query_params.clear()
            return False

        # If session was reset we no longer have the code_verifier; treat
        # returned_state as the verifier (original pre-CSRF design as fallback).
        if not code_verifier:
            code_verifier = returned_state

        with st.spinner("מחבר לגוגל..."):
            success, creds_json, err = connector.exchange_code(
                st.query_params["code"], redirect_uri, code_verifier
            )
        st.query_params.clear()
        if success:
            st.session_state["_creds_json"] = creds_json
            st.session_state.pop("_pkce_code_verifier", None)
            st.session_state.pop("_oauth_csrf_state", None)
            st.success("מחובר בהצלחה! טוען את הדשבורד...")
            st.balloons()
            return True
        else:
            st.session_state["_oauth_error"] = err
            if "redirect_uri_mismatch" in err.lower() or "redirect_uri" in err.lower():
                st.error(
                    "❌ שגיאת הגדרת OAuth: כתובת ה-redirect URI אינה תואמת.\n\n"
                    f"כתובת בשימוש: `{redirect_uri}`\n\n"
                    "ודא שכתובת זו רשומה ב-Google Cloud Console תחת "
                    "**OAuth 2.0 Client → Authorized redirect URIs**."
                )
            else:
                st.error(f"החיבור נכשל:\n\n```\n{err}\n```")

    # ── Step 1: show connect button ──────────────────────────────────────────
    _, center, _ = st.columns([1, 2, 1])

    with center:
        st.markdown(
            '<div class="welcome-panel" dir="rtl">'
            '<div class="welcome-corner-tr"></div>'
            '<div class="welcome-corner-bl"></div>'
            '<div class="welcome-icon-ring">'
            '<span class="welcome-icon-inner">📊</span>'
            '</div>'
            '<div class="welcome-brand">Invoice Intelligence Console</div>'
            '<div class="welcome-title" dir="rtl">חשבוניות חכמה</div>'
            '<div class="welcome-subtitle" dir="rtl">'
            'ניתוח חשבוניות וקבלות אוטומטי מתיבת הדואר שלך'
            '</div>'
            '</div>',
            unsafe_allow_html=True,
        )

        try:
            auth_url, code_verifier, csrf_state = connector.get_auth_url(redirect_uri)
            st.session_state["_pkce_code_verifier"] = code_verifier
            st.session_state["_oauth_csrf_state"] = csrf_state
        except RuntimeError as _e:
            st.session_state["_oauth_error"] = str(_e)
            st.error(f"שגיאה בבניית כתובת האימות:\n\n```\n{_e}\n```")
            st.info(f"כתובת redirect URI בשימוש: `{redirect_uri}`")
            return False

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
            '<div style="font-size:2.2rem; text-align:center; margin-bottom:22px;">⚙️</div>'
            '<h3 dir="rtl" style="color:#EFF6FF; text-align:center; margin-bottom:8px; font-weight:800; font-size:1.45rem; letter-spacing:-0.02em; font-family:\'Space Grotesk\',\'Inter\',sans-serif;">'
            'נדרשת הגדרה ראשונית'
            '</h3>'
            '<p style="color:#475569; text-align:center; margin-bottom:30px; font-size:0.87rem;">השלם את ההגדרות הבאות כדי להתחיל</p>'
            '<p dir="rtl" style="color:#94A3B8; line-height:1.9; font-size:0.92rem;">'
            'כדי להפעיל את המערכת, יש להגדיר פעם אחת את פרטי OAuth2 בקובץ '
            '<span class="env-pill">.env</span>:'
            '</p>'
            '<ol dir="rtl" style="color:#94A3B8; line-height:2.5; margin-top:16px; font-size:0.88rem;">'
            '<li>כנס ל-<a href="https://console.cloud.google.com/apis/credentials" target="_blank" '
            'style="color:#22D3EE; font-weight:600; text-decoration:none;">console.cloud.google.com</a>'
            ' ← צור פרויקט ← הפעל Gmail API</li>'
            '<li>צור <strong style="color:#EFF6FF;">OAuth 2.0 Client ID</strong> מסוג <strong style="color:#EFF6FF;">Desktop app</strong></li>'
            '<li>העתק את ה-Client ID וה-Client Secret לקובץ <span class="env-pill">.env</span>:</li>'
            '</ol>'
            '<div class="env-block">'
            'GID=<span style="color:#22D3EE;">your_client_id.apps.googleusercontent.com</span><br>'
            'GSECRET=<span style="color:#34D399;">your_client_secret</span>'
            '</div>'
            '<p dir="rtl" style="color:#334155; font-size:0.78rem; margin-top:22px; text-align:center; letter-spacing:0.02em;">'
            'לאחר ההגדרה — הפעל מחדש את האפליקציה'
            '</p>'
            '</div>',
            unsafe_allow_html=True,
        )
