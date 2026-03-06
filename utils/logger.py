"""
מודול לוגר — מספק לוגינג צבעוני לקונסול ולקובץ.
כל הודעות הלוג מוצגות בעברית.
"""

import logging
import os
from pathlib import Path

# קודי ANSI לצבעים
_RESET = "\033[0m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_RED = "\033[31m"
_CYAN = "\033[36m"

LOG_DIR = Path("output/logs")
LOG_FILE = LOG_DIR / "invoice_fetcher.log"

_FORMAT = "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class _ColorFormatter(logging.Formatter):
    """פורמטר צבעוני לפלט הקונסול."""

    _LEVEL_COLORS = {
        logging.DEBUG: _CYAN,
        logging.INFO: _GREEN,
        logging.WARNING: _YELLOW,
        logging.ERROR: _RED,
        logging.CRITICAL: _RED,
    }

    def format(self, record: logging.LogRecord) -> str:
        color = self._LEVEL_COLORS.get(record.levelno, _RESET)
        record.levelname = f"{color}{record.levelname}{_RESET}"
        return super().format(record)


def get_logger(name: str) -> logging.Logger:
    """
    מחזיר לוגר מוגדר עם פלט לקונסול ולקובץ.

    :param name: שם הלוגר (בדרך כלל __name__ של המודול הקורא)
    :return: אובייקט Logger מוגדר
    """
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger

    logger.setLevel(logging.DEBUG)

    # handler לקונסול עם צבעים
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG)
    console_handler.setFormatter(_ColorFormatter(fmt=_FORMAT, datefmt=_DATE_FORMAT))

    # handler לקובץ לוג
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(fmt=_FORMAT, datefmt=_DATE_FORMAT))

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)
    return logger


def log_separator(logger: logging.Logger | None = None) -> None:
    """מדפיס קו הפרדה ברוחב 60 תווים ברמת INFO."""
    sep = "─" * 60
    target = logger if logger is not None else get_logger("separator")
    target.info(sep)
