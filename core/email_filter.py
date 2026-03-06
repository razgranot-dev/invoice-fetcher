"""
סינון ועיבוד הודעות דואר — מאתר חשבוניות וקבלות בתיבת הדואר.
"""

import email
import imaplib
import os
import sys
from datetime import datetime, timedelta
from email.header import decode_header
from typing import Any

import chardet

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.logger import get_logger

logger = get_logger(__name__)

_מילות_מפתח_ברירת_מחדל: list[str] = [
    "חשבונית",
    "קבלה",
    "אישור תשלום",
    "invoice",
    "receipt",
]


def _decode_bytes(raw: bytes | str, fallback: str = "utf-8") -> str:
    """ממיר bytes לסטרינג תוך זיהוי קידוד אוטומטי."""
    if isinstance(raw, str):
        return raw
    detected = chardet.detect(raw)
    charset = detected.get("encoding") or fallback
    try:
        return raw.decode(charset, errors="replace")
    except (LookupError, UnicodeDecodeError):
        return raw.decode(fallback, errors="replace")


def _decode_header_value(value: str | None) -> str:
    """מפענח כותרת MIME מקודדת לסטרינג קריא."""
    if not value:
        return ""
    parts = decode_header(value)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(_decode_bytes(part, charset or "utf-8"))
        else:
            decoded.append(part)
    return " ".join(decoded)


class EmailFilter:
    """
    מסנן ומנתח הודעות דואר לאיתור חשבוניות וקבלות.
    """

    def fetch_emails(
        self,
        connector,
        keywords: list[str] | None = None,
        days_back: int = 30,
        unread_only: bool = True,
    ) -> list[str]:
        """
        מחזיר רשימת UID-ים של הודעות התואמות לקריטריוני החיפוש.

        :param connector: מופע EmailConnector מחובר עם תיקייה נבחרת
        :param keywords: מילות מפתח לחיפוש (ברירת מחדל: רשימה מובנית)
        :param days_back: טווח חיפוש בימים אחורה
        :param unread_only: אם True — רק הודעות שלא נקראו
        :return: רשימת מחרוזות UID ממוינות
        """
        connector._assert_connected()

        if keywords is None:
            keywords = _מילות_מפתח_ברירת_מחדל

        since_date = (datetime.now() - timedelta(days=days_back)).strftime("%d-%b-%Y")
        logger.info(
            "מחפש הודעות מאז %s | %d מילות מפתח | רק שלא נקראו: %s",
            since_date, len(keywords), "כן" if unread_only else "לא",
        )

        all_uids: set[str] = set()
        imap: imaplib.IMAP4_SSL = connector.connection

        for kw in keywords:
            criteria = self._build_criteria(kw, since_date, unread_only)
            logger.debug("חיפוש עבור '%s': %s", kw, criteria)
            try:
                status, data = imap.uid("search", None, *criteria)
            except imaplib.IMAP4.error as exc:
                logger.warning("חיפוש עבור '%s' נכשל: %s", kw, exc)
                continue

            if status != "OK" or not data or not data[0]:
                continue

            uids = data[0].decode().split()
            logger.debug("נמצאו %d תוצאות עבור '%s'", len(uids), kw)
            all_uids.update(uids)

        result = sorted(all_uids, key=lambda u: int(u))
        logger.info("סך הכל: %d הודעות ייחודיות", len(result))
        return result

    def parse_email(self, connector, uid: str) -> dict[str, Any]:
        """
        מביא ומנתח הודעה בודדת לפי UID.

        :return: מילון עם uid, date, sender, subject, body_text, body_html, attachments
        """
        connector._assert_connected()
        logger.info("מנתח הודעה UID=%s", uid)

        imap: imaplib.IMAP4_SSL = connector.connection
        try:
            status, msg_data = imap.uid("fetch", uid, "(RFC822)")
        except imaplib.IMAP4.error as exc:
            raise ValueError(f"שגיאה באחזור UID={uid}: {exc}") from exc

        if status != "OK" or not msg_data or msg_data[0] is None:
            raise ValueError(f"אחזור UID={uid} נכשל")

        raw_email: bytes | None = None
        for part in msg_data:
            if isinstance(part, tuple) and len(part) >= 2:
                raw_email = part[1]
                break

        if raw_email is None:
            raise ValueError(f"לא ניתן לחלץ תוכן UID={uid}")

        msg = email.message_from_bytes(raw_email)
        result: dict[str, Any] = {
            "uid": uid,
            "date": msg.get("Date", ""),
            "sender": _decode_header_value(msg.get("From", "")),
            "subject": _decode_header_value(msg.get("Subject", "")),
            "body_text": "",
            "body_html": "",
            "attachments": [],
        }

        logger.debug("נושא: '%s' | שולח: '%s'", result["subject"], result["sender"])
        self._extract_parts(msg, result)
        logger.info("UID=%s — %d קבצים מצורפים", uid, len(result["attachments"]))
        return result

    # ── עזר פנימי ────────────────────────────────────────────────────

    @staticmethod
    def _build_criteria(keyword: str, since_date: str, unread_only: bool) -> list[str]:
        criteria = ["OR", f'SUBJECT "{keyword}"', f'BODY "{keyword}"']
        if unread_only:
            criteria = ["UNSEEN"] + criteria
        criteria += [f"SINCE {since_date}"]
        return criteria

    def _extract_parts(self, msg: email.message.Message, result: dict[str, Any]) -> None:
        if msg.is_multipart():
            for part in msg.walk():
                self._process_part(part, result)
        else:
            self._process_part(msg, result)

    def _process_part(self, part: email.message.Message, result: dict[str, Any]) -> None:
        content_type = part.get_content_type()
        disposition = str(part.get("Content-Disposition", ""))

        if part.get_content_maintype() == "multipart":
            return

        if "attachment" in disposition:
            raw_filename = part.get_filename()
            filename = _decode_header_value(raw_filename) if raw_filename else "ללא_שם"
            payload = part.get_payload(decode=True)
            if payload is not None:
                result["attachments"].append(
                    {"filename": filename, "content_type": content_type, "data": payload}
                )
                logger.debug("קובץ מצורף: '%s' (%s, %d בייטים)", filename, content_type, len(payload))
            return

        if content_type == "text/plain" and not result["body_text"]:
            payload = part.get_payload(decode=True)
            if payload:
                result["body_text"] = _decode_bytes(payload, part.get_content_charset() or "utf-8")

        elif content_type == "text/html" and not result["body_html"]:
            payload = part.get_payload(decode=True)
            if payload:
                result["body_html"] = _decode_bytes(payload, part.get_content_charset() or "utf-8")
