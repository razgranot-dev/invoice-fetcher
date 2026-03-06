"""
מחבר IMAP — מודול לחיבור מאובטח לשרת דואר אלקטרוני באמצעות SSL.
"""

import imaplib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.logger import get_logger

logger = get_logger(__name__)


class EmailConnector:
    """
    מחבר לשרת IMAP באמצעות SSL.

    קורא פרטי חיבור ממשתני הסביבה (נטענים על-ידי config.settings.load_settings):
        IMAP_SERVER   — כתובת השרת
        IMAP_PORT     — פורט (ברירת מחדל: 993)
        EMAIL_ADDRESS — כתובת הדואר האלקטרוני
        EMAIL_PASSWORD — סיסמת האפליקציה
    """

    def __init__(self):
        self.server = os.environ.get("IMAP_SERVER")
        self.port = int(os.environ.get("IMAP_PORT", 993))
        self.address = os.environ.get("EMAIL_ADDRESS")
        self.password = os.environ.get("EMAIL_PASSWORD")
        self.connection: imaplib.IMAP4_SSL | None = None

        missing = [
            var
            for var, val in {
                "IMAP_SERVER": self.server,
                "EMAIL_ADDRESS": self.address,
                "EMAIL_PASSWORD": self.password,
            }.items()
            if not val
        ]
        if missing:
            raise EnvironmentError(
                f"משתני הסביבה הבאים חסרים: {', '.join(missing)}"
            )

    # ── חיבור וניתוק ─────────────────────────────────────────────────

    def connect(self) -> "EmailConnector":
        """
        מתחבר לשרת ה-IMAP ומבצע כניסה.
        מחזיר את האובייקט עצמו לתמיכה בשרשור קריאות.
        """
        logger.info("מתחבר לשרת IMAP: %s:%d", self.server, self.port)
        try:
            self.connection = imaplib.IMAP4_SSL(self.server, self.port)
        except OSError as exc:
            raise ConnectionError(
                f"נכשל ביצירת חיבור SSL לשרת {self.server}:{self.port} — {exc}"
            ) from exc

        logger.info("מבצע כניסה עם המשתמש: %s", self.address)
        try:
            status, response = self.connection.login(self.address, self.password)
        except imaplib.IMAP4.error as exc:
            raise ConnectionError(
                f"כניסה נכשלה עבור {self.address} — {exc}"
            ) from exc

        if status != "OK":
            raise ConnectionError(
                f"כניסה נכשלה עבור {self.address} — תשובת השרת: {response}"
            )

        logger.info("כניסה בוצעה בהצלחה כ-%s", self.address)
        return self

    def disconnect(self) -> None:
        """מתנתק מהשרת באופן מסודר."""
        if self.connection is None:
            return
        logger.info("מתנתק מהשרת IMAP")
        try:
            self.connection.logout()
            logger.info("ניתוק הושלם")
        except imaplib.IMAP4.error as exc:
            logger.warning("שגיאה במהלך הניתוק: %s", exc)
        finally:
            self.connection = None

    def select_mailbox(self, mailbox: str = "INBOX") -> int:
        """
        בוחר תיקיית דואר ומחזיר את מספר ההודעות בה.
        """
        self._assert_connected()
        logger.info("בוחר תיקיית דואר: %s", mailbox)
        try:
            status, data = self.connection.select(mailbox)
        except imaplib.IMAP4.error as exc:
            raise ValueError(
                f"שגיאה בבחירת התיקייה '{mailbox}' — {exc}"
            ) from exc

        if status != "OK":
            raise ValueError(
                f"לא ניתן לבחור את התיקייה '{mailbox}' — {data}"
            )

        count = int(data[0]) if data and data[0] else 0
        logger.info("תיקיית '%s' נבחרה — %d הודעות", mailbox, count)
        return count

    # ── מנהל הקשר ────────────────────────────────────────────────────

    def __enter__(self) -> "EmailConnector":
        return self.connect()

    def __exit__(self, exc_type, exc_val, exc_tb) -> bool:
        self.disconnect()
        return False

    # ── עזר פנימי ────────────────────────────────────────────────────

    def _assert_connected(self) -> None:
        if self.connection is None:
            raise RuntimeError(
                "אין חיבור פעיל לשרת IMAP — יש לקרוא ל-connect() תחילה"
            )
