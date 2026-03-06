"""
ייצוא נתונים — שמירת רשומות חשבוניות לקבצי CSV ו-JSON.
"""

import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from utils.logger import get_logger

logger = get_logger(__name__)


class DataExporter:
    """
    מנהל ייצוא נתוני חשבוניות לקבצי CSV ו-JSON.

    כותרות עמודות ה-CSV הן בעברית לצורך תצוגה נוחה ב-Excel.
    """

    # מיפוי שדות מקור → שמות עמודות בעברית
    _COLUMN_MAP = {
        "uid":            "מזהה",
        "date":           "תאריך",
        "sender":         "שולח",
        "subject":        "נושא",
        "saved_path":     "נתיב_קובץ",
        "has_attachment": "קובץ_מצורף",
        "notes":          "הערות",
    }

    def __init__(self, output_dir: str = "output", filename_prefix: str = "חשבוניות"):
        self.output_dir = Path(output_dir)
        self.filename_prefix = filename_prefix
        self._records: list[dict[str, Any]] = []

    def add_record(
        self,
        uid: str,
        date_str: str,
        sender: str,
        subject: str,
        file_path: str = "",
        has_attachment: bool = False,
        notes: str = "",
    ) -> None:
        """מוסיף רשומת חשבונית לרשימה הפנימית."""
        self._records.append(
            {
                "uid": uid,
                "date": date_str,
                "sender": sender,
                "subject": subject,
                "saved_path": file_path,
                "has_attachment": "כן" if has_attachment else "לא",
                "notes": notes,
            }
        )

    def add_from_parsed(self, parsed: dict[str, Any]) -> None:
        """
        מוסיף רשומה ישירות ממילון ParsedEmail.
        שיטת נוחות המשמשת את main.py.
        """
        self.add_record(
            uid=parsed.get("uid", ""),
            date_str=parsed.get("date", ""),
            sender=parsed.get("sender", ""),
            subject=parsed.get("subject", ""),
            file_path=parsed.get("saved_path", ""),
            has_attachment=bool(parsed.get("attachments")),
            notes=parsed.get("notes", ""),
        )

    def export_csv(self) -> str:
        """
        מייצא את כל הרשומות לקובץ CSV.

        :return: נתיב קובץ ה-CSV שנוצר
        """
        try:
            import pandas as pd
        except ImportError as exc:
            raise ImportError(
                "pandas לא מותקן — הפעל: pip install pandas"
            ) from exc

        self.output_dir.mkdir(parents=True, exist_ok=True)
        filename = self.output_dir / f"{self.filename_prefix}_{date.today()}.csv"

        # בניית DataFrame עם כותרות עברית
        rows = [
            {self._COLUMN_MAP[k]: v for k, v in rec.items() if k in self._COLUMN_MAP}
            for rec in self._records
        ]
        df = pd.DataFrame(rows, columns=list(self._COLUMN_MAP.values()))

        # UTF-8-sig כדי ש-Excel יזהה עברית נכון
        df.to_csv(filename, index=False, encoding="utf-8-sig")
        logger.info("CSV יוצא: %s (%d שורות)", filename, len(df))
        return str(filename)

    def export_json(self) -> str:
        """
        מייצא את כל הרשומות לקובץ JSON.

        :return: נתיב קובץ ה-JSON שנוצר
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)
        filename = self.output_dir / f"{self.filename_prefix}_{date.today()}.json"

        with open(filename, "w", encoding="utf-8") as f:
            json.dump(self._records, f, ensure_ascii=False, indent=2)

        logger.info("JSON יוצא: %s (%d רשומות)", filename, len(self._records))
        return str(filename)

    def get_summary(self) -> str:
        """מחזיר מחרוזת סיכום בעברית."""
        total = len(self._records)
        with_att = sum(1 for r in self._records if r.get("has_attachment") == "כן")
        return (
            f"סה\"כ חשבוניות שנמצאו: {total} | "
            f"עם קובץ מצורף: {with_att} | "
            f"ללא קובץ מצורף: {total - with_att}"
        )
