"""
טיפול בקבצים מצורפים — הורדה ושמירה לתיקיות מאורגנות לפי שנה/חודש.
"""

import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.logger import get_logger

logger = get_logger(__name__)

_SUPPORTED_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
}

_SAFE_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class AttachmentHandler:
    """
    מטפל בשמירת קבצים מצורפים לתיקיות מאורגנות לפי שנה וחודש.
    """

    def __init__(self, base_output_dir: str = "output/invoices"):
        self.base_dir = Path(base_output_dir)

    def save_attachment(
        self, attachment: dict[str, Any], sender: str, date_str: str
    ) -> str | None:
        """
        שומר קובץ מצורף לתיקייה המתאימה.

        :param attachment: מילון עם מפתחות filename, content_type, data
        :param sender: כתובת השולח (לצורך לוג)
        :param date_str: מחרוזת תאריך ה-RFC2822 של ההודעה
        :return: נתיב הקובץ שנשמר, או None אם הקובץ אינו נתמך
        """
        content_type = attachment.get("content_type", "").lower()
        filename = attachment.get("filename", "ללא_שם")
        data: bytes = attachment.get("data", b"")

        if not self.is_supported(content_type):
            logger.warning(
                "סוג קובץ '%s' אינו נתמך — מדלג על '%s'", content_type, filename
            )
            return None

        if not data:
            logger.warning("קובץ '%s' ריק — מדלג", filename)
            return None

        # חישוב תיקיית היעד לפי שנה/חודש
        target_dir = self._resolve_target_dir(date_str)
        target_dir.mkdir(parents=True, exist_ok=True)

        safe_name = self._sanitize_filename(filename)
        dest = self._unique_path(target_dir / safe_name)

        try:
            dest.write_bytes(data)
            logger.info(
                "קובץ נשמר: %s (%d בייטים) | שולח: %s",
                dest, len(data), sender,
            )
            return str(dest)
        except OSError as exc:
            logger.error("שגיאה בשמירת '%s': %s", dest, exc)
            return None

    def is_supported(self, content_type: str) -> bool:
        """מחזיר True אם סוג ה-MIME נתמך."""
        return content_type.lower().split(";")[0].strip() in _SUPPORTED_TYPES

    # ── עזר פנימי ────────────────────────────────────────────────────

    def _resolve_target_dir(self, date_str: str) -> Path:
        """מחשב תת-תיקייה YYYY/MM מתוך מחרוזת תאריך."""
        try:
            from email.utils import parsedate_to_datetime
            dt = parsedate_to_datetime(date_str)
        except Exception:
            dt = datetime.now()
        return self.base_dir / str(dt.year) / f"{dt.month:02d}"

    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """מסיר תווים לא חוקיים משם הקובץ."""
        clean = _SAFE_FILENAME_RE.sub("_", name).strip()
        return clean or "קובץ_מצורף"

    @staticmethod
    def _unique_path(path: Path) -> Path:
        """מחזיר נתיב ייחודי — מוסיף מספר אם הקובץ קיים."""
        if not path.exists():
            return path
        stem, suffix = path.stem, path.suffix
        counter = 1
        while True:
            candidate = path.parent / f"{stem}_{counter}{suffix}"
            if not candidate.exists():
                return candidate
            counter += 1
