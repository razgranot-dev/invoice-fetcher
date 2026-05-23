"""Regression guard for the 2026-05-22 scan correctness + perf fixes.

Covers:
  1. Gmail query length stays under the practical q-parameter limit, even
     with many user keywords. The previous build_query enumerated ~80
     vendor domains and could push the query past Gmail's ~2KB ceiling,
     where Gmail starts returning empty result sets instead of an error.
  2. Query uses Gmail's high-recall category:purchases operator + broad
     subject/filename/from heuristics. Pinning these prevents a future
     refactor from silently dropping them and breaking coverage for
     vendors not in the explicit domain list.
  3. classify_email truncates very large bodies before regex work, so a
     200-500 KB marketing email cannot pin the worker even if a future
     pattern reintroduces accidental backtracking.
  4. The tier-determining gate still works on representative cases:
     confirmed/likely → real receipt, possible → weak signal, not_invoice
     → no hard evidence.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.gmail_connector import GmailConnector
from core.invoice_classifier import (
    classify_email,
    TIER_NOT,
    TIER_POSSIBLE,
    TIER_LIKELY,
    TIER_CONFIRMED,
)


# ── Gmail query construction ───────────────────────────────────────────────


def test_query_length_under_gmail_limit_with_no_keywords():
    """The base query must be well under Gmail's ~2KB q-parameter limit."""
    c = GmailConnector()
    q = c.build_query([], 30, False)
    assert len(q) < 1500, (
        f"Base query is {len(q)} chars — too close to Gmail's ~2KB limit. "
        "Adding any user keywords could push it over and silently return "
        "no results."
    )


def test_query_length_under_gmail_limit_with_max_keywords():
    """Even with 20 user keywords, the query must stay under the limit."""
    c = GmailConnector()
    # ScanRequest caps keywords at 20 — simulate worst case
    big_keywords = [f"keyword{i}" for i in range(20)]
    q = c.build_query(big_keywords, 30, True)
    assert len(q) < 2000, (
        f"Query with 20 keywords is {len(q)} chars. Gmail's q parameter has "
        "a practical limit around 2KB; longer queries can return empty."
    )


def test_query_uses_category_purchases():
    """Gmail's built-in transactional category is our high-recall anchor —
    losing it would mean missing every new vendor not in the explicit lists."""
    c = GmailConnector()
    q = c.build_query([], 30, False)
    assert "category:purchases" in q, (
        "Query lost category:purchases — vendors not in the keyword lists "
        "will no longer be discovered. Restore the operator."
    )


def test_query_includes_subject_keywords_english_and_hebrew():
    c = GmailConnector()
    q = c.build_query([], 30, False)
    for kw in ("subject:invoice", "subject:receipt"):
        assert kw in q, f"Missing critical English subject keyword: {kw}"
    for kw in ("subject:חשבונית", "subject:קבלה"):
        assert kw in q, f"Missing critical Hebrew subject keyword: {kw}"


def test_query_includes_from_local_part_heuristics():
    """from:invoice / from:billing catch billing@anything.com — far broader
    coverage than enumerating every vendor domain."""
    c = GmailConnector()
    q = c.build_query([], 30, False)
    for kw in ("from:invoice", "from:billing", "from:receipt"):
        assert kw in q, f"Missing from-local-part keyword: {kw}"


def test_query_unread_only_flag():
    c = GmailConnector()
    q_unread = c.build_query([], 30, True)
    q_all = c.build_query([], 30, False)
    assert "is:unread" in q_unread
    assert "is:unread" not in q_all


def test_query_date_range_format():
    c = GmailConnector()
    q = c.build_query([], 7, False)
    # Gmail accepts YYYY/MM/DD only — not ISO-8601 with dashes
    import re
    assert re.search(r"after:\d{4}/\d{2}/\d{2}", q), (
        "Date format must be YYYY/MM/DD — Gmail rejects ISO-8601 dashes."
    )


def test_user_keyword_quotes_preserve_multi_word_phrases():
    c = GmailConnector()
    q = c.build_query(["my project name"], 30, False)
    assert '"my project name"' in q, (
        "Multi-word user keywords must be quoted so Gmail treats them as "
        "a phrase, not three loose tokens."
    )


# ── Classifier body-size guard ─────────────────────────────────────────────


def test_classify_email_truncates_huge_body_within_time_budget():
    """A pathological 500KB body must classify in under 1s even if a future
    pattern introduces accidental backtracking on the body text."""
    big_body = "Some text. " * 50_000  # ~600KB
    email = {
        "subject": "marketing newsletter",
        "sender": "news@example.com",
        "body_text": big_body,
        "body_html": "",
        "attachments": [],
    }
    start = time.perf_counter()
    result = classify_email(email)
    elapsed = time.perf_counter() - start
    assert elapsed < 1.0, (
        f"classify_email took {elapsed:.2f}s on a 600KB body. Body cap "
        "should bound regex work to ~60KB before patterns run."
    )
    # Sanity: marketing body with no hard evidence should still be not_invoice
    assert result["classification_tier"] in (TIER_NOT, TIER_POSSIBLE), (
        f"Unexpected tier on marketing body: {result['classification_tier']}"
    )


def test_classify_email_works_on_truncated_body():
    """Real invoices put the signal near the top — truncation should
    NOT cost us a confirmed receipt."""
    body = "Invoice #INV-12345\nTotal: $99.99\nThank you for your purchase.\n"
    body += "Footer marketing content. " * 5000  # bloat that gets truncated
    email = {
        "subject": "Your receipt from Apple",
        "sender": "noreply@apple.com",
        "body_text": body,
        "body_html": "",
        "attachments": [],
    }
    result = classify_email(email)
    assert result["classification_tier"] in (TIER_CONFIRMED, TIER_LIKELY), (
        f"Expected confirmed/likely for Apple receipt, got "
        f"{result['classification_tier']} (score={result['classification_score']})"
    )


# ── Tier gating still works as the project spec expects ────────────────────


def test_not_invoice_for_security_alert():
    """Security alerts must always be not_invoice — they fund the
    `possible_financial_email default EXCLUDED` UX promise."""
    email = {
        "subject": "Critical security alert",
        "sender": "noreply@accounts.google.com",
        "body_text": "Someone tried to sign in to your account.",
        "body_html": "",
        "attachments": [],
    }
    assert classify_email(email)["classification_tier"] == TIER_NOT


def test_confirmed_for_explicit_invoice():
    email = {
        "subject": "Tax invoice from Acme — #INV-12345",
        "sender": "billing@acme.com",
        "body_text": "Total amount due: $199.00\nVAT: $30",
        "body_html": "",
        "attachments": [{"filename": "invoice-12345.pdf", "content_type": "application/pdf"}],
    }
    result = classify_email(email)
    assert result["classification_tier"] in (TIER_CONFIRMED, TIER_LIKELY), (
        f"Expected confirmed/likely for explicit invoice, got "
        f"{result['classification_tier']} (score={result['classification_score']})"
    )
