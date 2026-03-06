"""
פיענוח גוף הודעה — חילוץ טקסט נקי מ-plain-text או HTML.
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.logger import get_logger

logger = get_logger(__name__)

_INVOICE_KEYWORDS = [
    "חשבונית",
    "קבלה",
    "סכום",
    'מע"מ',
    "שקל",
    "₪",
    "לתשלום",
    "invoice",
    "receipt",
    "total",
    "amount due",
]

_WHITESPACE_RE = re.compile(r"\s{3,}")


class BodyParser:
    """
    מנתח גוף הודעות דואר אלקטרוני.
    """

    def extract_text(self, body_text: str, body_html: str) -> str:
        """
        מחלץ טקסט נקי מגוף ההודעה.

        מעדיף plain-text; אם אינו זמין, מנסה לנתח את ה-HTML.

        :param body_text: גוף ה-plain-text של ההודעה
        :param body_html: גוף ה-HTML של ההודעה
        :return: טקסט נקי
        """
        if body_text and body_text.strip():
            logger.debug("משתמש ב-plain-text (%d תווים)", len(body_text))
            return self._clean_text(body_text)

        if body_html and body_html.strip():
            logger.debug("מנתח HTML (%d תווים)", len(body_html))
            return self._parse_html(body_html)

        logger.debug("גוף ריק — מחזיר מחרוזת ריקה")
        return ""

    def looks_like_invoice(self, text: str) -> bool:
        """
        בודק האם הטקסט מכיל מאפיינים של חשבונית/קבלה.

        :param text: הטקסט לבדיקה
        :return: True אם 2 מילות מפתח לפחות נמצאו
        """
        text_lower = text.lower()
        hits = sum(1 for kw in _INVOICE_KEYWORDS if kw.lower() in text_lower)
        logger.debug("נמצאו %d מילות מפתח חשבוניות בטקסט", hits)
        return hits >= 2

    # ── עזר פנימי ────────────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        """מנקה רווחים עודפים מהטקסט."""
        return _WHITESPACE_RE.sub("\n", text).strip()

    @staticmethod
    def _parse_html(html: str) -> str:
        """מחלץ טקסט נקי מ-HTML באמצעות BeautifulSoup."""
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            logger.warning("beautifulsoup4 לא מותקן — מחזיר HTML גולמי")
            return html

        soup = BeautifulSoup(html, "html.parser")

        # הסרת תגי script ו-style
        for tag in soup(["script", "style", "head", "meta", "link"]):
            tag.decompose()

        text = soup.get_text(separator="\n")
        return _WHITESPACE_RE.sub("\n", text).strip()
