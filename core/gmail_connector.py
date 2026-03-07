"""
מחבר Gmail — OAuth2 מבוסס משתני סביבה.
לא נדרש קובץ credentials.json ידני — הכול מנוהל פנימית.
"""

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import traceback
from datetime import datetime, timedelta
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

_log = logging.getLogger(__name__)

_TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds; doubled each attempt
_MAX_MESSAGES = 2000     # upper bound on messages fetched per scan

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _is_auth_error(exc: Exception) -> bool:
    """Returns True if the exception indicates an auth failure that requires re-login.

    Auth errors: token revoked, expired, invalid_grant, 401 Unauthorized.
    These cannot be recovered by retrying — the user must re-authenticate.
    """
    try:
        from google.auth.exceptions import RefreshError
        if isinstance(exc, RefreshError):
            return True
    except ImportError:
        pass
    try:
        from googleapiclient.errors import HttpError
        if isinstance(exc, HttpError) and exc.resp.status == 401:
            return True
    except (ImportError, AttributeError):
        pass
    msg = str(exc).lower()
    return any(
        sig in msg for sig in (
            "invalid_grant",
            "token has been expired",
            "token has been revoked",
            "invalid_client",
            "unauthorized_client",
            "access_denied",
        )
    )


class GmailConnector:
    AUTH_ERROR_PREFIX = "AUTH_ERROR:"
    """
    מנהל חיבור ואימות מול Gmail API.
    פרטי OAuth נטענים ממשתני הסביבה GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET (ממופים מ-GID ו-GSECRET).
    הטוקן נשמר ומתרענן אוטומטית — המשתמש לא רואה שום קובץ.
    """

    def __init__(self):
        self.service: Any = None
        self._client_id = os.getenv("GOOGLE_CLIENT_ID")
        self._client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

    # ── בדיקות מצב ───────────────────────────────────────────────────

    def is_configured(self) -> bool:
        """מחזיר True אם GID ו-GSECRET הוגדרו."""
        return bool(self._client_id and self._client_secret)

    def is_authenticated(self) -> bool:
        """Returns True if st.session_state contains valid or refreshable credentials."""
        import streamlit as st
        creds_json = st.session_state.get("_creds_json", "")
        if not creds_json:
            return False
        try:
            creds = Credentials.from_authorized_user_info(
                json.loads(creds_json), SCOPES
            )
            return creds.valid or (creds.expired and bool(creds.refresh_token))
        except Exception:
            return False

    # ── אימות ────────────────────────────────────────────────────────

    def _build_web_client_config(self) -> dict:
        """Client config for web-based OAuth flow.
        NOTE: The redirect URI used at runtime must be registered in Google Cloud Console
        under OAuth 2.0 Client → Authorized redirect URIs, otherwise Google will reject it.
        """
        return {
            "web": {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uris": [],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

    def get_auth_url(self, redirect_uri: str) -> tuple[str, str, str]:
        """Returns (auth_url, code_verifier, csrf_state).
        Store both code_verifier and csrf_state in st.session_state.
        The state param carries an opaque CSRF token (NOT the code_verifier, which
        must not be exposed in URLs).
        """
        try:
            code_verifier = secrets.token_urlsafe(96)
            code_challenge = base64.urlsafe_b64encode(
                hashlib.sha256(code_verifier.encode("ascii")).digest()
            ).rstrip(b"=").decode("ascii")

            csrf_state = secrets.token_urlsafe(32)

            flow = Flow.from_client_config(
                self._build_web_client_config(), scopes=SCOPES, redirect_uri=redirect_uri
            )
            auth_url, _ = flow.authorization_url(
                prompt="consent",
                access_type="offline",
                code_challenge=code_challenge,
                code_challenge_method="S256",
                state=csrf_state,
            )
            return auth_url, code_verifier, csrf_state
        except Exception as e:
            raise RuntimeError(
                f"get_auth_url failed | redirect_uri={redirect_uri!r} | "
                f"client_id_set={bool(self._client_id)} | "
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            ) from e

    def exchange_code(self, code: str, redirect_uri: str, code_verifier: str) -> tuple[bool, str, str]:
        """Exchange OAuth code for token. Returns (success, creds_json, error_message).
        On success, creds_json is a JSON string to store in st.session_state["_creds_json"].
        On failure, creds_json is '' and error_message describes the problem.
        On redirect_uri_mismatch: error_message will contain 'redirect_uri_mismatch'.
        """
        try:
            flow = Flow.from_client_config(
                self._build_web_client_config(), scopes=SCOPES, redirect_uri=redirect_uri
            )
            flow.fetch_token(code=code, code_verifier=code_verifier)
            creds = flow.credentials
            return True, creds.to_json(), ""
        except Exception as e:
            return False, "", f"{type(e).__name__}: {e}\n{traceback.format_exc()}"

    def build_service_from_json(self, creds_json: str) -> tuple[bool, str]:
        """Load credentials from JSON string, refresh if needed, build Gmail service.
        Returns (success, result):
          - Success:     (True, updated_creds_json)  — caller persists back to session_state
          - Auth error:  (False, "AUTH_ERROR: ...")  — caller must clear session + prompt re-login
          - Other error: (False, "ErrorType: msg")   — transient / config issue
        """
        try:
            creds = Credentials.from_authorized_user_info(
                json.loads(creds_json), SCOPES
            )
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            self.service = build("gmail", "v1", credentials=creds)
            return True, creds.to_json()
        except Exception as e:
            if _is_auth_error(e):
                _log.warning("Gmail auth error (token revoked/expired): %s", e)
                return False, f"{GmailConnector.AUTH_ERROR_PREFIX} {type(e).__name__}: {e}"
            _log.warning("Gmail service init error: %s", e)
            return False, f"{type(e).__name__}: {e}"

    def revoke_token(self) -> bool:
        """Clears the in-memory service. Caller must clear st.session_state['_creds_json']."""
        self.service = None
        return True

    # ── בנייה ושליפה ─────────────────────────────────────────────────

    def _exec(self, request) -> dict:
        """Execute a Google API request object with exponential backoff retry.

        Retries on transient HTTP errors (429, 500-504). Does NOT retry auth
        errors (401) — those are surfaced immediately so the caller can clear
        the session and prompt re-login.
        """
        from googleapiclient.errors import HttpError

        for attempt in range(_MAX_RETRIES + 1):
            try:
                return request.execute()
            except HttpError as exc:
                status = int(exc.resp.status)
                if status == 401:
                    raise  # auth error — propagate immediately, no retry
                if status in _TRANSIENT_STATUS_CODES and attempt < _MAX_RETRIES:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    _log.warning(
                        "Gmail API HTTP %d — retry %d/%d in %.1fs",
                        status, attempt + 1, _MAX_RETRIES, delay,
                    )
                    time.sleep(delay)
                    continue
                raise  # non-retryable or exhausted retries

    def build_query(self, keywords: list[str], days_back: int, unread_only: bool) -> str:
        """בונה שאילתת חיפוש Gmail לפי מילות מפתח, טווח ימים וסינון לא-נקרא."""
        parts = []
        if unread_only:
            parts.append("is:unread")
        since = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
        parts.append(f"after:{since}")
        if keywords:
            clauses = [f'subject:"{kw}" OR {kw}' for kw in keywords]
            parts.append(f"({' OR '.join(clauses)})")
        return " ".join(parts)

    def list_message_ids(
        self,
        keywords: list[str],
        days_back: int = 30,
        unread_only: bool = True,
    ) -> list[str]:
        """Returns matching message IDs. Caps at _MAX_MESSAGES to prevent unbounded scans."""
        query = self.build_query(keywords, days_back, unread_only)
        ids: list[str] = []
        page_token = None

        while True:
            params: dict = {"userId": "me", "q": query, "maxResults": 500}
            if page_token:
                params["pageToken"] = page_token

            resp = self._exec(self.service.users().messages().list(**params))
            ids.extend(m["id"] for m in resp.get("messages", []))

            if len(ids) >= _MAX_MESSAGES:
                _log.warning(
                    "Message cap reached (%d). Stopping pagination early.", _MAX_MESSAGES
                )
                ids = ids[:_MAX_MESSAGES]
                break

            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        return ids

    def get_message(self, msg_id: str) -> dict:
        """שולף הודעה מלאה מ-Gmail."""
        return self._exec(
            self.service.users().messages().get(userId="me", id=msg_id, format="full")
        )

    def parse_message(self, msg: dict) -> dict:
        """ממיר הודעת Gmail API למילון מובנה."""
        result: dict[str, Any] = {
            "uid": msg.get("id", ""),
            "date": "", "sender": "", "subject": "",
            "body_text": "", "body_html": "",
            "attachments": [], "saved_path": None, "notes": "",
        }
        payload = msg.get("payload", {})
        for h in payload.get("headers", []):
            n = h.get("name", "").lower()
            v = h.get("value", "")
            if n == "date":
                result["date"] = v
            elif n == "from":
                result["sender"] = v
            elif n == "subject":
                result["subject"] = v
        self._extract_parts(payload, result)
        return result

    def _extract_parts(self, payload: dict, result: dict) -> None:
        """חילוץ רקורסיבי של גוף ההודעה וקבצים מצורפים."""
        parts = payload.get("parts")
        if parts:
            for part in parts:
                self._extract_parts(part, result)
            return

        mime = payload.get("mimeType", "")
        filename = payload.get("filename", "")
        body = payload.get("body", {})
        att_id = body.get("attachmentId")
        data = body.get("data", "")

        if att_id or filename:
            result["attachments"].append({
                "filename": filename,
                "content_type": mime,
                "attachment_id": att_id,
                "msg_id": result["uid"],
                "data": None,
            })
        elif mime == "text/plain" and data and not result["body_text"]:
            try:
                result["body_text"] = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            except Exception:
                pass
        elif mime == "text/html" and data and not result["body_html"]:
            try:
                result["body_html"] = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            except Exception:
                pass

    def fetch_attachment_data(self, msg_id: str, attachment_id: str) -> bytes:
        """שולף bytes של קובץ מצורף מ-Gmail."""
        try:
            resp = self._exec(
                self.service.users().messages().attachments().get(
                    userId="me", messageId=msg_id, id=attachment_id
                )
            )
            return base64.urlsafe_b64decode(resp.get("data", "") + "==")
        except Exception:
            return b""
