"""
מחבר Gmail — OAuth2 מבוסס משתני סביבה.
לא נדרש קובץ credentials.json ידני — הכול מנוהל פנימית.
"""

import base64
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
TOKEN_FILE = "token.json"


class GmailConnector:
    """
    מנהל חיבור ואימות מול Gmail API.
    פרטי OAuth נטענים ממשתני הסביבה GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET.
    הטוקן נשמר ומתרענן אוטומטית — המשתמש לא רואה שום קובץ.
    """

    def __init__(self):
        self.token_path = Path(TOKEN_FILE)
        self.service: Any = None
        self._client_id = os.getenv("GOOGLE_CLIENT_ID")
        self._client_secret = os.getenv("GOOGLE_CLIENT_SECRET")

    # ── בדיקות מצב ───────────────────────────────────────────────────

    def is_configured(self) -> bool:
        """מחזיר True אם GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET הוגדרו."""
        return bool(self._client_id and self._client_secret)

    def is_authenticated(self) -> bool:
        """מחזיר True אם קיים טוקן תקין או כזה שניתן לרענן."""
        if not self.token_path.exists():
            return False
        try:
            creds = Credentials.from_authorized_user_file(str(self.token_path), SCOPES)
            return creds.valid or (creds.expired and bool(creds.refresh_token))
        except Exception:
            return False

    # ── אימות ────────────────────────────────────────────────────────

    def _build_client_config(self) -> dict:
        """בונה dict הגדרות OAuth2 ממשתני הסביבה."""
        return {
            "installed": {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uris": ["http://localhost", "urn:ietf:wg:oauth:2.0:oob"],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

    def authenticate(self) -> bool:
        """
        מבצע אימות OAuth2:
        1. טוען טוקן קיים
        2. מרענן אם פג תוקפו
        3. פותח דפדפן לאימות אם אין טוקן
        4. שומר את הטוקן ובונה את שירות Gmail
        מחזיר True בהצלחה, False בכישלון.
        """
        try:
            creds = None

            if self.token_path.exists():
                creds = Credentials.from_authorized_user_file(str(self.token_path), SCOPES)

            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            elif not creds or not creds.valid:
                if not self.is_configured():
                    return False
                flow = InstalledAppFlow.from_client_config(
                    self._build_client_config(), SCOPES
                )
                creds = flow.run_local_server(port=0, prompt="consent")

            # שמירת הטוקן לשימוש עתידי
            self.token_path.write_text(creds.to_json(), encoding="utf-8")
            self.service = build("gmail", "v1", credentials=creds)
            return True

        except Exception:
            return False

    def revoke_token(self) -> bool:
        """מוחק את token.json ומנתק את הגישה."""
        if self.token_path.exists():
            self.token_path.unlink()
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
