"""
מנוע הסריקה — Gmail API עם פידבק חי ב-Streamlit.
"""

import os

import streamlit as st

from core.attachment_handler import AttachmentHandler
from core.body_parser import BodyParser
from core.data_exporter import DataExporter
from core.gmail_connector import GmailConnector
from core.invoice_classifier import classify_results, TIER_NOT, format_signal_breakdown


def run_email_scan(params: dict) -> list[dict]:
    """
    מריץ סריקת Gmail מלאה עם פידבק חי.

    :param params: מילון עם keys: keywords, days_back, unread_only, output_dir
    :return: רשימת מילוני הודעות מנותחות
    """
    keywords: list[str] = params.get("keywords", [])
    days_back: int = int(params.get("days_back", 30))
    unread_only: bool = bool(params.get("unread_only", True))
    output_dir: str = params.get("output_dir", "output")
    invoices_dir = os.path.join(output_dir, "invoices")

    results: list[dict] = []

    # בדיקת אימות לפני כל דבר
    creds_json = st.session_state.get("_creds_json", "")
    connector = GmailConnector()
    if not connector.is_authenticated():
        st.error("שגיאה: פג תוקף החיבור. אנא התנתק והתחבר מחדש.")
        return []

    ok, updated_creds_json = connector.build_service_from_json(creds_json)
    if not ok:
        if updated_creds_json.startswith(GmailConnector.AUTH_ERROR_PREFIX):
            # Token revoked or expired — clear auth state and ask user to reconnect
            for _key in ("_creds_json", "_pkce_code_verifier", "_oauth_csrf_state"):
                st.session_state.pop(_key, None)
            st.error("\u05e4\u05d2 \u05ea\u05d5\u05e7\u05e3 \u05d4\u05d2\u05d9\u05e9\u05d4 \u05dc-Gmail \u05d0\u05d5 \u05e9\u05d4\u05d9\u05d0 \u05d1\u05d5\u05d8\u05dc\u05d4.")
            st.info("אנא לחץ על 'התנתק מ-Gmail' בסרגל הצד והתחבר מחדש.")
            return []
        st.error(f"שגיאה: לא ניתן לאתחל את שירות Gmail: {updated_creds_json}")
        return []

    # Persist refreshed token back to session (token may have been refreshed)
    st.session_state["_creds_json"] = updated_creds_json

    try:
        with st.status("סורק את תיבת Gmail...", expanded=True) as scan_status:
            progress = st.progress(0, text="מאתחל...")

            # ── חיפוש מזהי הודעות ────────────────────────────────────
            st.write("\u05de\u05d7\u05e4\u05e9 \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea \u05dc\u05e4\u05d9 \u05de\u05d9\u05dc\u05d5\u05ea \u05de\u05e4\u05ea\u05d7...")
            progress.progress(5, text="מחפש הודעות...")

            try:
                msg_ids = connector.list_message_ids(keywords, days_back, unread_only)
            except Exception as exc:
                st.error(f"שגיאה בחיפוש הודעות: {exc}")
                scan_status.update(label="הסריקה נכשלה", state="error")
                return []

            total = len(msg_ids)
            if total == 0:
                st.warning(
                    "לא נמצאו הודעות התואמות לקריטריונים. "
                    "נסה להרחיב את טווח הימים או לשנות מילות מפתח."
                )
                scan_status.update(label="לא נמצאו הודעות", state="complete", expanded=False)
                return []

            st.write(f"\u05e0\u05de\u05e6\u05d0\u05d5 **{total}** \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea. \u05de\u05ea\u05d7\u05d9\u05dc \u05e2\u05d9\u05d1\u05d5\u05d3...")
            progress.progress(10, text=f"עיבוד {total} הודעות...")

            # ── עיבוד כל הודעה ────────────────────────────────────────
            att_handler = AttachmentHandler(base_output_dir=invoices_dir)
            body_parser = BodyParser()
            exporter = DataExporter(output_dir=output_dir)

            for idx, msg_id in enumerate(msg_ids, start=1):
                pct = 10 + int(85 * idx / total)
                progress.progress(min(pct, 95), text=f"מעבד הודעה {idx} מתוך {total}...")

                try:
                    msg = connector.get_message(msg_id)
                    if not msg:
                        st.warning(f"הודעה {idx} לא נטענה — נדלגת.")
                        continue

                    parsed = connector.parse_message(msg)

                    # שמירת קבצים מצורפים
                    saved_path: str | None = None
                    for att in parsed.get("attachments", []):
                        try:
                            if att.get("attachment_id"):
                                att["data"] = connector.fetch_attachment_data(
                                    att["msg_id"], att["attachment_id"]
                                )
                            path = att_handler.save_attachment(
                                att,
                                sender=parsed.get("sender", ""),
                                date_str=parsed.get("date", ""),
                            )
                            if path:
                                saved_path = path
                        except Exception as att_exc:
                            st.warning(f"שגיאה בשמירת קובץ מצורף (הודעה {idx}): {att_exc}")

                    parsed["saved_path"] = saved_path

                    # ניתוח גוף ההודעה
                    try:
                        text = body_parser.extract_text(
                            parsed.get("body_text", ""),
                            parsed.get("body_html", ""),
                        )
                        parsed["notes"] = (
                            "נמצא תוכן חשבונית בגוף ההודעה"
                            if body_parser.looks_like_invoice(text)
                            else ""
                        )
                    except Exception:
                        parsed["notes"] = ""

                    exporter.add_from_parsed(parsed)
                    results.append(parsed)

                except Exception as exc:
                    st.warning(f"שגיאה בעיבוד הודעה {idx}: {exc} — ממשיך...")
                    continue

            # ── סיווג חשבוניות ─────────────────────────────────────────
            progress.progress(93, text="\u05de\u05e1\u05d5\u05d5\u05d2 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea...")
            st.write("\u05de\u05e1\u05d5\u05d5\u05d2 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05dc\u05e4\u05d9 \u05e8\u05de\u05ea \u05d1\u05d9\u05d8\u05d7\u05d5\u05df...")
            classify_results(results)

            # Count tiers
            tier_counts: dict[str, int] = {}
            for r in results:
                t = r.get("classification_tier", "unknown")
                tier_counts[t] = tier_counts.get(t, 0) + 1
            not_invoice_count = tier_counts.get(TIER_NOT, 0)
            invoice_count = len(results) - not_invoice_count

            st.write(
                f"\u05e1\u05d9\u05d5\u05d5\u05d2: **{invoice_count}** "
                f"\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05de\u05ea\u05d5\u05da {len(results)} "
                f"\u05d4\u05d5\u05d3\u05e2\u05d5\u05ea ({not_invoice_count} \u05e1\u05d5\u05e0\u05e0\u05d5)"
            )

            # ── ייצוא ──────────────────────────────────────────────────
            progress.progress(97, text="\u05de\u05d9\u05d9\u05e6\u05d0 \u05e0\u05ea\u05d5\u05e0\u05d9\u05dd...")
            st.write("\u05de\u05d9\u05d9\u05e6\u05d0 \u05dc-CSV \u05d5-JSON...")
            try:
                exporter.export_csv()
                exporter.export_json()
                st.write(f"{exporter.get_summary()}")
            except Exception as exc:
                st.warning(f"\u05e9\u05d2\u05d9\u05d0\u05d4 \u05d1\u05d9\u05d9\u05e6\u05d5\u05d0: {exc}")

            progress.progress(100, text="\u05d4\u05e1\u05e8\u05d9\u05e7\u05d4 \u05d4\u05d5\u05e9\u05dc\u05de\u05d4!")
            scan_status.update(
                label=f"\u05d4\u05e1\u05e8\u05d9\u05e7\u05d4 \u05d4\u05d5\u05e9\u05dc\u05de\u05d4 \u2014 {invoice_count} \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05de\u05ea\u05d5\u05da {len(results)} \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea",
                state="complete",
                expanded=False,
            )

        st.success(f"\u05e1\u05e8\u05d9\u05e7\u05ea Gmail \u05d4\u05e1\u05ea\u05d9\u05d9\u05de\u05d4! {invoice_count} \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05d5\u05ea \u05de\u05ea\u05d5\u05da {total} \u05d4\u05d5\u05d3\u05e2\u05d5\u05ea.")

    except Exception as exc:
        st.error(f"שגיאה בלתי צפויה: {exc}")
        return []

    return results
