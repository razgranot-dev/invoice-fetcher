"""
מחבר Gmail — OAuth2 מבוסס משתני סביבה.
לא נדרש קובץ credentials.json ידני — הכול מנוהל פנימית.
"""

import base64
import hashlib
import json
import os
import secrets
import traceback
from datetime import datetime, timedelta
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


class GmailConnector:
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

    def is_authenticated(self, creds_json: str | None = None) -> bool:
        """Returns True if creds_json contains valid or refreshable credentials."""
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
        Returns (success, updated_creds_json).
        updated_creds_json may differ from input if the token was refreshed — caller
        should persist it back to st.session_state["_creds_json"].
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
            return False, f"{type(e).__name__}: {e}"

    def revoke_token(self) -> bool:
        """Clears the in-memory service. Caller must clear st.session_state['_creds_json']."""
        self.service = None
        return True

    # ── בנייה ושליפה ─────────────────────────────────────────────────

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
        """מחזיר רשימת מזהי הודעות התואמות לשאילתה, כולל דפדוף."""
        query = self.build_query(keywords, days_back, unread_only)
        ids: list[str] = []
        page_token = None
        while True:
            params: dict = {"userId": "me", "q": query, "maxResults": 500}
            if page_token:
                params["pageToken"] = page_token
            resp = self.service.users().messages().list(**params).execute()
            ids.extend(m["id"] for m in resp.get("messages", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return ids

    def get_message(self, msg_id: str) -> dict:
        """שולף הודעה מלאה מ-Gmail."""
        return self.service.users().messages().get(
            userId="me", id=msg_id, format="full"
        ).execute()

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
            resp = self.service.users().messages().attachments().get(
                userId="me", messageId=msg_id, id=attachment_id
            ).execute()
            return base64.urlsafe_b64decode(resp.get("data", "") + "==")
        except Exception:
            return b""
