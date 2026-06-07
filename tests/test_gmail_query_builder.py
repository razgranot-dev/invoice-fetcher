"""Tests for GmailConnector.build_query — verifies filtering catches all invoice patterns.

Rewritten 2026-05-22 to match the slimmer, higher-recall query strategy
(category:purchases + subject keywords + filename keywords + from-local-part).
The prior query enumerated ~80 vendor domains and ~30 quoted subject phrases,
producing a ~2.5–3KB query that could silently truncate against Gmail's q
parameter limit. The new query:
  • is < 700 chars empty, < 2000 even with 20 user keywords
  • uses Gmail's built-in `category:purchases` (catches new vendors for free)
  • word-tokenized `subject:invoice` already matches "Invoice", "INVOICES", etc.
  • `from:invoice` / `from:billing` match billing@anything.com — broader than
    any explicit domain list and adapts to new vendors automatically.

This file keeps the SEMANTIC guarantees that the previous tests asserted
(Hebrew + English coverage, attachment filename detection, multi-word user
keywords preserved as phrases) — only the literal query structure changed.
"""

import os
import pytest

# Set fake credentials before importing GmailConnector
os.environ.setdefault("GOOGLE_CLIENT_ID", "fake_id")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "fake_secret")

from core.gmail_connector import GmailConnector


@pytest.fixture
def connector():
    return GmailConnector()


@pytest.fixture
def default_keywords():
    """Default keywords matching the sidebar defaults."""
    return [
        "חשבונית", "קבלה", "חשבון", "חיוב", "תשלום",
        "אישור תשלום", "invoice", "receipt", "billing", "payment",
    ]


class TestBuildQueryKeywords:
    """Verify user keywords are included in the query."""

    def test_single_keyword_in_subject_and_body(self, connector):
        q = connector.build_query(["invoice"], days_back=30, unread_only=False)
        # User keywords are quoted to preserve any spaces
        assert 'subject:"invoice"' in q
        assert '"invoice"' in q

    def test_hebrew_keyword_in_query(self, connector):
        q = connector.build_query(["חשבונית"], days_back=30, unread_only=False)
        assert 'subject:"חשבונית"' in q
        assert '"חשבונית"' in q

    def test_multi_word_user_keyword_preserved_as_phrase(self, connector):
        """Multi-word user keywords are kept as a single quoted phrase. The
        broad coverage that used to come from splitting them is now provided
        by the always-on subject:תשלום / subject:invoice / category:purchases
        anchors — see TestBuildQueryAnchors."""
        q = connector.build_query(["אישור תשלום"], days_back=30, unread_only=False)
        assert 'subject:"אישור תשלום"' in q
        assert '"אישור תשלום"' in q


class TestBuildQueryDateRange:
    def test_date_range_included(self, connector):
        q = connector.build_query(["invoice"], days_back=30, unread_only=False)
        assert "after:" in q

    def test_unread_only_flag(self, connector):
        q_unread = connector.build_query(["invoice"], days_back=30, unread_only=True)
        q_all = connector.build_query(["invoice"], days_back=30, unread_only=False)
        assert "is:unread" in q_unread
        assert "is:unread" not in q_all


class TestBuildQueryAnchors:
    """Pin the four high-recall anchors in the new query."""

    def test_query_uses_category_purchases(self, connector):
        """Gmail's purchases category catches every transactional email
        Google already classified — including new vendors not in any list."""
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "category:purchases" in q

    def test_query_has_english_subject_anchors(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        for kw in ("subject:invoice", "subject:receipt", "subject:billing", "subject:payment"):
            assert kw in q, f"Missing anchor: {kw}"

    def test_query_has_hebrew_subject_anchors(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        for kw in ("subject:חשבונית", "subject:קבלה", "subject:חיוב", "subject:תשלום"):
            assert kw in q, f"Missing Hebrew anchor: {kw}"

    def test_query_has_from_local_part_anchors(self, connector):
        """from:invoice matches invoice@anything.com — broader than any
        explicit domain list and adapts to new vendors automatically."""
        q = connector.build_query([], days_back=30, unread_only=False)
        for kw in ("from:invoice", "from:billing", "from:receipt", "from:payments"):
            assert kw in q, f"Missing from-local-part anchor: {kw}"

    def test_query_has_paypal_processor_anchor(self, connector):
        """from:paypal matches the 'PayPal' display name AND every paypal.*
        domain regardless of subject/locale. Root-cause fix for PayPal
        receipts with short/opaque/Hebrew subjects that the subject-keyword
        anchors miss and Gmail doesn't reliably tag category:purchases."""
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "from:paypal" in q, "Missing PayPal processor anchor: from:paypal"


class TestBuildQueryFilenameSearch:
    """Verify attachment filename search is included (broader keyword search,
    no longer quoted because Gmail tokenizes filenames anyway)."""

    def test_invoice_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "filename:invoice" in q

    def test_receipt_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "filename:receipt" in q

    def test_hebrew_invoice_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "filename:חשבונית" in q

    def test_hebrew_receipt_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "filename:קבלה" in q


class TestPreviouslyMissedPatterns:
    """
    Regression tests — each describes a real-world invoice email that the
    PRE-2026-05 (very early) query would not find. With the new query these
    are caught either by an explicit subject anchor, a filename anchor, the
    from-local-part anchor, or Gmail's purchases category.
    """

    def test_hebrew_bill_subject(self, connector, default_keywords):
        """'חשבון טלפון' — 'חשבון' (bill) anchor present."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert "subject:חשבון" in q or 'subject:"חשבון"' in q

    def test_hebrew_charge_subject(self, connector, default_keywords):
        """'אישור חיוב' — 'חיוב' anchor present."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert "subject:חיוב" in q or 'subject:"חיוב"' in q

    def test_hebrew_payment_subject(self, connector, default_keywords):
        """'הודעת תשלום' — 'תשלום' anchor present."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert "subject:תשלום" in q or 'subject:"תשלום"' in q

    def test_english_billing_subject(self, connector, default_keywords):
        """'Your billing statement' — 'billing' anchor present."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert "subject:billing" in q or 'subject:"billing"' in q

    def test_english_payment_subject(self, connector, default_keywords):
        """'Payment confirmation' — 'payment' anchor present."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert "subject:payment" in q or 'subject:"payment"' in q

    def test_invoice_attachment_now_found(self, connector):
        """Email with 'invoice.pdf' attachment but no keyword in body."""
        q = connector.build_query([], days_back=90, unread_only=False)
        assert "filename:invoice" in q

    def test_query_uses_or_logic(self, connector, default_keywords):
        """All clauses must be OR'd so any match finds the email."""
        q = connector.build_query(default_keywords, days_back=30, unread_only=False)
        assert " OR " in q


class TestQueryLengthBound:
    """Pin the practical Gmail query-length ceiling. The old build_query
    produced ~2.5-3 KB queries; longer queries silently return empty results."""

    def test_empty_keywords_well_under_limit(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert len(q) < 1000, (
            f"Empty-keyword query is {len(q)} chars; should be ~600. "
            "If this fails, build_query has regrown the vendor list."
        )

    def test_max_user_keywords_under_limit(self, connector):
        q = connector.build_query([f"kw{i}" for i in range(20)], days_back=30, unread_only=True)
        assert len(q) < 2000, (
            f"20-keyword query is {len(q)} chars — too close to Gmail's "
            "~2KB q-parameter limit. Keep user keyword splitting bounded."
        )
