"""Tests for GmailConnector.build_query — verifies filtering catches all invoice patterns."""

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
        assert 'subject:"invoice"' in q
        assert '"invoice"' in q

    def test_hebrew_keyword_in_query(self, connector):
        q = connector.build_query(["חשבונית"], days_back=30, unread_only=False)
        assert 'subject:"חשבונית"' in q
        assert '"חשבונית"' in q

    def test_multi_word_keyword_splits_into_individual_terms(self, connector):
        """Multi-word keywords should also search individual words in subject."""
        q = connector.build_query(["אישור תשלום"], days_back=30, unread_only=False)
        # Phrase match preserved
        assert 'subject:"אישור תשלום"' in q
        assert '"אישור תשלום"' in q
        # Individual words also searched in subject
        assert 'subject:"אישור"' in q
        assert 'subject:"תשלום"' in q

    def test_single_word_keyword_not_split(self, connector):
        """Single-word keywords should not produce extra subject split terms."""
        q = connector.build_query(["invoice"], days_back=30, unread_only=False)
        # subject:"invoice" appears once for user keyword; no extra split
        assert q.count('subject:"invoice"') == 1


class TestBuildQueryDateRange:
    def test_date_range_included(self, connector):
        q = connector.build_query(["invoice"], days_back=30, unread_only=False)
        assert "after:" in q

    def test_unread_only_flag(self, connector):
        q_unread = connector.build_query(["invoice"], days_back=30, unread_only=True)
        q_all = connector.build_query(["invoice"], days_back=30, unread_only=False)
        assert "is:unread" in q_unread
        assert "is:unread" not in q_all


class TestBuildQuerySenderDomains:
    """Verify known sender domains are in the query."""

    def test_apple_domain(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "from:apple.com" in q

    def test_paypal_domain(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "from:paypal.com" in q

    def test_amazon_domain(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "from:amazon.com" in q

    def test_microsoft_domain(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "from:microsoft.com" in q

    def test_wix_domain(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert "from:wix.com" in q


class TestBuildQuerySubjectPatterns:
    """Verify subject patterns include both English and Hebrew patterns."""

    def test_english_subject_patterns(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert 'subject:"invoice from"' in q
        assert 'subject:"payment confirmation"' in q
        assert 'subject:"billing statement"' in q

    def test_hebrew_subject_patterns(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert 'subject:"חשבונית מס"' in q
        assert 'subject:"אישור חיוב"' in q
        assert 'subject:"חשבון חודשי"' in q
        assert 'subject:"הודעת תשלום"' in q


class TestBuildQueryFilenameSearch:
    """Verify attachment filename search is included."""

    def test_invoice_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert 'filename:"invoice"' in q

    def test_receipt_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert 'filename:"receipt"' in q

    def test_hebrew_invoice_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert 'filename:"חשבונית"' in q

    def test_hebrew_receipt_filename(self, connector):
        q = connector.build_query([], days_back=30, unread_only=False)
        assert 'filename:"קבלה"' in q


class TestPreviouslyMissedPatterns:
    """
    Regression tests for specific invoice patterns that were previously MISSED.
    Each test describes a real-world invoice email that the old query would not find.
    """

    def test_bill_email_now_found(self, connector, default_keywords):
        """'חשבון טלפון' — the word 'חשבון' (bill) was missing from defaults."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert 'subject:"חשבון"' in q or '"חשבון"' in q

    def test_charge_email_now_found(self, connector, default_keywords):
        """'אישור חיוב' — 'חיוב' (charge) was missing from defaults."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert 'subject:"חיוב"' in q or '"חיוב"' in q

    def test_payment_standalone_now_found(self, connector, default_keywords):
        """'הודעת תשלום' — 'תשלום' was only part of phrase 'אישור תשלום'."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert 'subject:"תשלום"' in q or '"תשלום"' in q

    def test_billing_email_now_found(self, connector, default_keywords):
        """'Your billing statement' — 'billing' was missing from defaults."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert 'subject:"billing"' in q or '"billing"' in q

    def test_payment_english_now_found(self, connector, default_keywords):
        """'Payment confirmation' — 'payment' was missing from defaults."""
        q = connector.build_query(default_keywords, days_back=90, unread_only=False)
        assert 'subject:"payment"' in q or '"payment"' in q

    def test_invoice_attachment_now_found(self, connector):
        """Email with 'invoice.pdf' attachment but no keyword in body."""
        q = connector.build_query([], days_back=90, unread_only=False)
        assert 'filename:"invoice"' in q

    def test_hebrew_tax_invoice_subject_now_found(self, connector):
        """Subject 'חשבונית מס 12345' — Hebrew subject pattern was missing."""
        q = connector.build_query([], days_back=90, unread_only=False)
        assert 'subject:"חשבונית מס"' in q

    def test_multi_word_keyword_individual_words(self, connector):
        """'אישור תשלום' should also match emails with just 'תשלום' in subject."""
        q = connector.build_query(["אישור תשלום"], days_back=30, unread_only=False)
        assert 'subject:"תשלום"' in q
        assert 'subject:"אישור"' in q

    def test_query_uses_or_logic(self, connector, default_keywords):
        """All clauses must be OR'd so any match finds the email."""
        q = connector.build_query(default_keywords, days_back=30, unread_only=False)
        assert " OR " in q
