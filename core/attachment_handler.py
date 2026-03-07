"""
טיפול בקבצים מצורפים — הורדה ושמירה לתיקיות מאורגנות לפי שנה/חודש.
"""

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)

_SUPPORTED_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
}

_SAFE_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MB


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

        if len(data) > _MAX_ATTACHMENT_BYTES:
            logger.warning(
                "קובץ '%s' גדול מדי (%d בייטים) — מדלג", filename, len(data)
            )
            return None

        # חישוב תיקיית היעד לפי שנה/חודש
        target_dir = self._resolve_target_dir(date_str)

        # Build a deterministic filename using message/attachment IDs as prefix
        _stem, _ext = os.path.splitext(filename)
        _safe_stem = self._sanitize_filename(_stem)
        safe_name = self._sanitize_filename(
            self._make_deterministic_name(attachment, _safe_stem, _ext)
        )
        dest = target_dir / safe_name

        # Idempotency: if this exact deterministic filename already exists,
        # the attachment was already saved in a previous scan — return it.
        if dest.exists():
            logger.info("קובץ '%s' כבר קיים מסריקה קודמת — מדלג שמירה", dest.name)
            return str(dest)

        # Safety: ensure the resolved path stays inside base_dir (prevents path traversal)
        try:
            dest.resolve().relative_to(self.base_dir.resolve())
        except ValueError:
            logger.error(
                "ניסיון path traversal זוהה בקובץ '%s' — מדלג", filename
            )
            return None

        target_dir.mkdir(parents=True, exist_ok=True)

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

    @staticmethod
    def _make_deterministic_name(attachment: dict, sanitized_stem: str, ext: str) -> str:
        """Build a deterministic filename using msg_id + attachment_id as prefix.

        Using message/attachment IDs ensures the same attachment always maps to
        the same filename (idempotent re-scans) and prevents collisions between
        attachments with the same original name from different messages.

        Format: {msg_id[:10]}_{att_id[:8]}_{original_stem}{ext}
        Falls back to the sanitized original name if no IDs are available.
        """
        msg_id = (attachment.get("msg_id") or "").strip()
        att_id = (attachment.get("attachment_id") or "").strip()

        id_prefix = ""
        if msg_id:
            id_prefix += msg_id[:10]
        if att_id:
            id_prefix += f"_{att_id[:8]}"

        if id_prefix:
            return f"{id_prefix}_{sanitized_stem}{ext}" if sanitized_stem else f"{id_prefix}{ext or '.bin'}"
        return f"{sanitized_stem}{ext}" if sanitized_stem else f"attachment{ext or '.bin'}"

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
