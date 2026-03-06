"""
נקודת הכניסה הראשית — מתזמרת את כל שלבי מערכת איסוף החשבוניות.
"""

import sys

from tqdm import tqdm

from config.settings import load_settings
from core.attachment_handler import AttachmentHandler
from core.body_parser import BodyParser
from core.data_exporter import DataExporter
from core.email_connector import EmailConnector
from core.email_filter import EmailFilter
from utils.logger import get_logger, log_separator

logger = get_logger("ראשי")


def _print_banner() -> None:
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║       מערכת איסוף חשבוניות אוטומטית  v1.0          ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()


def _print_summary(fetched: int, saved: int, csv_path: str, json_path: str) -> None:
    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║                    סיכום פעולה                      ║")
    print("╠══════════════════════════════════════════════════════╣")
    print(f"║  אימיילים שנמצאו  : {fetched:<33}║")
    print(f"║  קבצים שנשמרו     : {saved:<33}║")
    print(f"║  קובץ CSV         : {csv_path:<33}║")
    print(f"║  קובץ JSON        : {json_path:<33}║")
    print("╚══════════════════════════════════════════════════════╝")
    print()


def main() -> None:
    _print_banner()
    log_separator(logger)

    # ── שלב 1: טעינת הגדרות ──────────────────────────────────────────
    logger.info("שלב 1/5 — טוען הגדרות מקובץ .env ...")
    try:
        settings = load_settings()
    except ValueError as exc:
        logger.error("שגיאה בהגדרות: %s", exc)
        sys.exit(1)

    logger.info("חשבון: %s | שרת: %s:%d", settings.email_address, settings.imap_server, settings.imap_port)
    log_separator(logger)

    # ── שלב 2: חיבור ל-IMAP וסינון ──────────────────────────────────
    logger.info("שלב 2/5 — מתחבר לשרת הדואר ומסנן הודעות ...")
    email_filter = EmailFilter()
    parser = BodyParser()
    attachment_handler = AttachmentHandler(settings.invoices_dir)
    exporter = DataExporter(settings.output_dir)

    uids: list[str] = []
    try:
        with EmailConnector() as connector:
            connector.select_mailbox("INBOX")

            uids = email_filter.fetch_emails(
                connector,
                keywords=settings.keywords,
                days_back=settings.days_back,
                unread_only=settings.unread_only,
            )
            logger.info("נמצאו %d הודעות רלוונטיות", len(uids))
            log_separator(logger)

            # ── שלב 3: עיבוד כל הודעה ───────────────────────────────
            logger.info("שלב 3/5 — מעבד הודעות ושומר קבצים מצורפים ...")
            saved_count = 0

            for uid in tqdm(uids, desc="מעבד הודעות", unit="הודעה"):
                try:
                    parsed = email_filter.parse_email(connector, uid)
                except Exception as exc:
                    logger.warning("שגיאה בניתוח UID=%s: %s — מדלג", uid, exc)
                    continue

                # טיפול בקבצים מצורפים
                if parsed["attachments"]:
                    for att in parsed["attachments"]:
                        path = attachment_handler.save_attachment(
                            att, parsed["sender"], parsed["date"]
                        )
                        if path:
                            parsed.setdefault("saved_path", path)
                            saved_count += 1
                else:
                    # אין קובץ מצורף — חילוץ טקסט מגוף ההודעה
                    text = parser.extract_text(parsed["body_text"], parsed["body_html"])
                    if parser.looks_like_invoice(text):
                        logger.debug("גוף ההודעה נראה כחשבונית — UID=%s", uid)
                        parsed["notes"] = "חשבונית בגוף ההודעה"

                exporter.add_from_parsed(parsed)

    except ConnectionError as exc:
        logger.error("כשל בחיבור לשרת הדואר: %s", exc)
        sys.exit(1)
    except Exception as exc:
        logger.error("שגיאה בלתי צפויה: %s", exc)
        sys.exit(1)

    log_separator(logger)

    # ── שלב 4: ייצוא נתונים ──────────────────────────────────────────
    logger.info("שלב 4/5 — מייצא נתונים ל-CSV ו-JSON ...")
    csv_path = json_path = "לא יוצא"
    try:
        csv_path = exporter.export_csv()
        json_path = exporter.export_json()
    except Exception as exc:
        logger.error("שגיאה בייצוא: %s", exc)

    log_separator(logger)

    # ── שלב 5: סיכום ─────────────────────────────────────────────────
    logger.info("שלב 5/5 — הסתיים.")
    logger.info(exporter.get_summary())
    _print_summary(len(uids), saved_count, csv_path, json_path)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
        print("⚠  הפעולה הופסקה על ידי המשתמש. יוצא בצורה מסודרת.")
        sys.exit(0)
