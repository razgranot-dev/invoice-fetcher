"""
מודול הגדרות — טוען משתני סביבה ומגדיר את פרמטרי האפליקציה.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


def _load_env() -> None:
    """טוען קובץ .env משורש הפרויקט."""
    root = Path(__file__).resolve().parent.parent
    load_dotenv(dotenv_path=root / ".env")


@dataclass
class Settings:
    """הגדרות האפליקציה."""

    imap_server: str
    email_address: str
    email_password: str
    imap_port: int = 993
    keywords: list = field(
        default_factory=lambda: [
            "חשבונית",
            "קבלה",
            "אישור תשלום",
            "invoice",
            "receipt",
        ]
    )
    days_back: int = 30
    unread_only: bool = True
    output_dir: str = "output"
    invoices_dir: str = "output/invoices"


def load_settings() -> Settings:
    """
    טוען ומאמת הגדרות ממשתני הסביבה.

    :raises ValueError: אם חסרים משתני סביבה חיוניים
    :return: אובייקט Settings מאוכלס
    """
    _load_env()

    missing = []
    imap_server = os.getenv("IMAP_SERVER", "").strip()
    email_address = os.getenv("EMAIL_ADDRESS", "").strip()
    email_password = os.getenv("EMAIL_PASSWORD", "").strip()

    if not imap_server:
        missing.append("IMAP_SERVER")
    if not email_address:
        missing.append("EMAIL_ADDRESS")
    if not email_password:
        missing.append("EMAIL_PASSWORD")

    if missing:
        raise ValueError(
            f"חסרים משתני סביבה חיוניים: {', '.join(missing)}. "
            "אנא הגדר אותם בקובץ .env."
        )

    try:
        imap_port = int(os.getenv("IMAP_PORT", "993"))
    except ValueError:
        imap_port = 993

    try:
        days_back = int(os.getenv("DAYS_BACK", "30"))
    except ValueError:
        days_back = 30

    unread_only = os.getenv("UNREAD_ONLY", "true").strip().lower() in (
        "true", "1", "yes", "כן"
    )
    output_dir = os.getenv("OUTPUT_DIR", "output").strip() or "output"

    return Settings(
        imap_server=imap_server,
        imap_port=imap_port,
        email_address=email_address,
        email_password=email_password,
        days_back=days_back,
        unread_only=unread_only,
        output_dir=output_dir,
        invoices_dir=os.path.join(output_dir, "invoices"),
    )
