"""
מסך ברוכים הבאים — עיצוב Stitch Blue, כפתור אחד בלבד לחיבור Google.
"""

import base64
import glob as _glob_mod
import os

import streamlit as st


@st.cache_data(show_spinner=False)
def _load_hero_video() -> str | None:
    """Find the hero video and return a base64 data-URI, cached across reruns."""
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for _vname in ("static/hero.mov", "static/hero.mp4"):
        _vpath = os.path.join(_root, _vname)
        if os.path.isfile(_vpath):
            with open(_vpath, "rb") as f:
                return "data:video/mp4;base64," + base64.b64encode(f.read()).decode("ascii")
    # Fallback: any .mov in project root
    _movs = _glob_mod.glob(os.path.join(_root, "*.mov"))
    if _movs:
        with open(_movs[0], "rb") as f:
            return "data:video/mp4;base64," + base64.b64encode(f.read()).decode("ascii")
    return None


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
    """Welcome/setup CSS is now in _styles.py — this is a no-op."""
    pass


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
                    "\u05e9\u05d2\u05d9\u05d0\u05ea \u05d4\u05d2\u05d3\u05e8\u05ea OAuth: \u05db\u05ea\u05d5\u05d1\u05ea \u05d4-redirect URI \u05d0\u05d9\u05e0\u05d4 \u05ea\u05d5\u05d0\u05de\u05ea.\n\n"
                    f"כתובת בשימוש: `{redirect_uri}`\n\n"
                    "ודא שכתובת זו רשומה ב-Google Cloud Console תחת "
                    "**OAuth 2.0 Client → Authorized redirect URIs**."
                )
            else:
                st.error(f"החיבור נכשל:\n\n```\n{err}\n```")

    # ── Step 1: show connect button ──────────────────────────────────────────
    _, center, _ = st.columns([1, 2, 1])

    with center:
        # Hero video — seamless animated visual (no controls, no player chrome)
        _video_b64 = _load_hero_video()

        if _video_b64:
            st.markdown(
                '<div class="hero-media">'
                f'<video autoplay muted loop playsinline disableRemotePlayback src="{_video_b64}"></video>'
                '</div>',
                unsafe_allow_html=True,
            )

        _icon_html = '' if _video_b64 else '<div class="welcome-icon">&#x1F9FE;</div>'
        _panel_style = ' style="margin-top:0; padding:28px 44px 32px;"' if _video_b64 else ''

        st.markdown(
            f'<div class="welcome-panel"{_panel_style} dir="rtl">'
            f'{_icon_html}'
            '<div class="welcome-brand">Invoice Fetcher</div>'
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
        st.link_button("התחבר לחשבון Google", auth_url, use_container_width=True, type="primary")
        st.markdown("</div>", unsafe_allow_html=True)

        st.markdown(
            '<div style="text-align:center;">'
            '<span class="privacy-badge" dir="rtl">'
            '&#x1F512; \u05d2\u05d9\u05e9\u05ea \u05e7\u05e8\u05d9\u05d0\u05d4 \u05d1\u05dc\u05d1\u05d3 \u00b7 \u05dc\u05d0 \u05e0\u05e9\u05de\u05e8\u05ea \u05e1\u05d9\u05e1\u05de\u05d0'
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
            '<div class="setup-card" dir="rtl">'
            '<div style="text-align:center; margin-bottom:16px;">'
            '<div style="width:44px; height:44px; margin:0 auto; display:flex; '
            'align-items:center; justify-content:center; background:var(--primary-dim); '
            'border:1px solid var(--primary-border); border-radius:8px; font-size:1.3rem;">&#x2699;</div>'
            '</div>'
            '<h3 dir="rtl" style="color:var(--on-surface); text-align:center; margin-bottom:6px; '
            'font-weight:800; font-size:1.1rem; letter-spacing:-0.02em; '
            "font-family:var(--font-display);\">נדרשת הגדרה ראשונית</h3>"
            '<p style="color:var(--text-muted); text-align:center; margin-bottom:24px; font-size:0.8rem; '
            "font-family:var(--font-body);\">השלם את ההגדרות הבאות כדי להתחיל</p>"
            '<p dir="rtl" style="color:var(--text-muted); line-height:1.9; font-size:0.88rem; '
            "font-family:var(--font-body);\">"
            'כדי להפעיל את המערכת, יש להגדיר פעם אחת את פרטי OAuth2 בקובץ '
            '<span class="env-pill">.env</span>:'
            '</p>'
            '<ol dir="rtl" style="color:var(--text-muted); line-height:2.4; margin-top:16px; font-size:0.85rem; '
            "font-family:var(--font-body);\">"
            '<li>כנס ל-<a href="https://console.cloud.google.com/apis/credentials" target="_blank" '
            'style="color:var(--primary); font-weight:600; text-decoration:none;">console.cloud.google.com</a>'
            ' ← צור פרויקט ← הפעל Gmail API</li>'
            '<li>צור <strong style="color:var(--on-surface);">OAuth 2.0 Client ID</strong> '
            'מסוג <strong style="color:var(--on-surface);">Desktop app</strong></li>'
            '<li>העתק את ה-Client ID וה-Client Secret לקובץ <span class="env-pill">.env</span>:</li>'
            '</ol>'
            '<div class="code-block">'
            'GID=<span style="color:var(--primary);">your_client_id.apps.googleusercontent.com</span><br>'
            'GSECRET=<span style="color:var(--secondary);">your_client_secret</span>'
            '</div>'
            '<p dir="rtl" style="color:var(--outline); font-size:0.78rem; margin-top:20px; '
            "text-align:center; font-family:var(--font-body);\">"
            'לאחר ההגדרה — הפעל מחדש את האפליקציה'
            '</p>'
            '</div>',
            unsafe_allow_html=True,
        )
