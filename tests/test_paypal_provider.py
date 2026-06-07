"""PayPal provider adapter tests.

Covers the requirements that the production bug missed:
  • discovery anchor token exists
  • PayPal sender detection across locales/subdomains
  • transactional vs non-transactional intent (security/marketing rejected)
  • structured extraction from an HTML-only receipt with NO PDF attachment:
    merchant, amount, currency, date, transaction id
  • stable dedup key (txn id preferred, composite fallback otherwise)
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import paypal_provider as pp
from core.paypal_provider import (
    DOC_RECEIPT, DOC_INVOICE, DOC_PAYMENT,
)

# A realistic HTML-only PayPal receipt (no plain text, no PDF attachment) —
# exactly the shape that was being lost in production.
PAYPAL_HTML_EN = """\
<html><body>
<table><tr><td><img src="logo.png" alt="PayPal"></td></tr></table>
<h1>You sent a payment</h1>
<p>You sent <strong>$29.00 USD</strong> to Shopify International Limited.</p>
<table>
  <tr><td>Transaction ID</td><td>8AB12345CD678901E</td></tr>
  <tr><td>Status</td><td>Completed</td></tr>
  <tr><td>Invoice ID</td><td>INV-2026-042</td></tr>
</table>
<a href="https://www.paypal.com/activity/payment/8AB12345CD678901E">View receipt</a>
</body></html>
"""

PAYPAL_HTML_HE = """\
<html><body dir="rtl">
<h1>שלחת תשלום</h1>
<p>שלחת <strong>49.90 ₪</strong> ל-Apple Services.</p>
<table><tr><td>מספר עסקה</td><td>9XY98765ZW432101A</td></tr></table>
</body></html>
"""


# ── Discovery ────────────────────────────────────────────────────────────────
def test_discovery_token_present():
    assert "paypal" in pp.discovery_query_tokens()


# ── Sender detection ─────────────────────────────────────────────────────────
@pytest.mark.parametrize("sender", [
    "service@paypal.com",
    "PayPal <service@paypal.com>",
    "member@paypal.com",
    "paypal@mail.paypal.com",
    "service@intl.paypal.com",
    "service@paypal.co.il",
])
def test_is_paypal_sender_true(sender):
    assert pp.is_paypal_sender(sender) is True


@pytest.mark.parametrize("sender", [
    "billing@stripe.com", "noreply@openai.com", "receipts@uber.com", "", None,
])
def test_is_paypal_sender_false(sender):
    assert pp.is_paypal_sender(sender) is False


# ── Intent: real transactions ────────────────────────────────────────────────
@pytest.mark.parametrize("subject", [
    "You sent a payment of $29.00 USD to Shopify",
    "You paid $29.00 USD to Shopify",
    "Receipt for your payment to Shopify International",
    "Your automatic payment to Spotify",
    "Your preapproved payment to Adobe",
    "שלחת תשלום של 49.90 ₪ ל-Apple",
    "הקבלה שלך מ-PayPal",
    "אישור עסקה",
])
def test_transactional_subjects(subject):
    intent = pp.classify_intent({"sender": "service@paypal.com", "subject": subject,
                                 "body_html": PAYPAL_HTML_EN})
    assert intent and intent["is_transaction"] is True


# ── Intent: NOT transactions (must be rejected) ──────────────────────────────
@pytest.mark.parametrize("subject", [
    "Unusual activity detected on your account",
    "Confirm your identity",
    "Your password was changed",
    "We noticed a new login to your account",
    "Your payment to Acme was declined",
    "התראת אבטחה בחשבון שלך",
    "50% off your next purchase with PayPal",
])
def test_non_transactional_rejected(subject):
    intent = pp.classify_intent({"sender": "service@paypal.com", "subject": subject,
                                 "body_html": "<p>no money moved here</p>"})
    assert intent is None


def test_non_paypal_sender_returns_none():
    assert pp.classify_intent({"sender": "billing@stripe.com",
                               "subject": "You paid $5 to X"}) is None


def test_refund_status_not_boosted():
    """A refund/reversal is money back to the user, not a payable receipt —
    it must not get the transaction boost even with a transactional subject."""
    assert pp.classify_intent({
        "sender": "service@paypal.com",
        "subject": "You sent a payment to Acme",
        "body_html": "<p>Status: Refunded</p><p>$5.00 USD</p>"
                     "<p>Transaction ID: 7XY12345AB678901C</p>",
    }) is None


def test_bare_17char_token_not_sufficient_for_opaque_subject():
    """An order/tracking id (also 17 chars) must NOT, on its own, make an
    opaque-subject email a transaction — only labelled evidence does."""
    # No transactional subject, only a bare 17-char order token → rejected.
    assert pp.classify_intent({
        "sender": "service@paypal.com",
        "subject": "Important information",
        "body_html": "<p>ORDER ABCD1234EFGH5678X total $9.00</p>",
    }) is None
    # Same body but with a LABELLED transaction id → accepted.
    assert pp.classify_intent({
        "sender": "service@paypal.com",
        "subject": "Important information",
        "body_html": "<p>$9.00 USD Transaction ID: 8AB12345CD678901E</p>",
    }) is not None


def test_extract_from_merchant_english():
    ex = pp.extract_paypal({
        "sender": "service@paypal.com",
        "subject": "You received a refund",
        "body_html": "<p>You received a refund of $49.99 from Shopify International.</p>",
    })
    assert ex["merchant"] == "Shopify"


def test_hebrew_verb_not_captured_as_merchant():
    """The bare 'ל' inside the verb 'שילמת' must not be captured — only the
    'ל-MERCHANT' preposition form."""
    ex = pp.extract_paypal({
        "sender": "service@paypal.com",
        "subject": "הקבלה שלך מ-Wolt",
        "body_html": "<p>שילמת 73.50 ₪ ל-Wolt Israel</p>"
                     "<p>מספר עסקה 1AA22233BB445566E</p>",
    })
    assert ex["merchant"] and ex["merchant"].lower().startswith("wolt")
    assert ex["amount"] == 73.50 and ex["currency"] == "ILS"


def test_dedup_prefers_invoice_id_when_no_txn():
    assert pp.dedup_key({"transaction_id": None, "invoice_id": "INV-2026-0042"}) \
        == "paypal:inv:INV-2026-0042"


# ── Structured extraction (HTML-only, no PDF) ────────────────────────────────
def test_extract_en_html_receipt():
    ex = pp.extract_paypal({
        "sender": "service@paypal.com",
        "subject": "You sent a payment of $29.00 USD to Shopify",
        "body_html": PAYPAL_HTML_EN,
        "body_text": "",
        "date": "Mon, 02 Jun 2026 10:00:00 +0000",
        "uid": "msg-123",
    })
    assert ex["amount"] == 29.00
    assert ex["currency"] == "USD"
    assert ex["transaction_id"] == "8AB12345CD678901E"
    assert ex["invoice_id"] == "INV-2026-042"
    assert ex["status"] and ex["status"].lower() == "completed"
    assert ex["merchant"] == "Shopify"          # "International Limited" stripped
    assert ex["doc_type"] in (DOC_RECEIPT, DOC_INVOICE)
    assert ex["receipt_url"].startswith("https://www.paypal.com/")
    assert ex["gmail_message_id"] == "msg-123"


def test_extract_he_html_receipt():
    ex = pp.extract_paypal({
        "sender": "paypal@mail.paypal.com",
        "subject": "שלחת תשלום של 49.90 ₪ ל-Apple",
        "body_html": PAYPAL_HTML_HE,
        "body_text": "",
        "date": "Mon, 02 Jun 2026 10:00:00 +0000",
        "uid": "msg-he-1",
    })
    assert ex["amount"] == 49.90
    assert ex["currency"] == "ILS"
    assert ex["transaction_id"] == "9XY98765ZW432101A"
    assert ex["merchant"] and "apple" in ex["merchant"].lower()


# ── Dedup key ────────────────────────────────────────────────────────────────
def test_dedup_prefers_transaction_id():
    ex = {"transaction_id": "8AB12345CD678901E", "gmail_message_id": "m1"}
    assert pp.dedup_key(ex) == "paypal:txn:8AB12345CD678901E"


def test_dedup_composite_fallback_is_stable_and_distinct():
    a = {"transaction_id": None, "gmail_message_id": "m1", "merchant": "Shopify",
         "transaction_date": "2026-06-02", "amount": 29.0, "currency": "USD"}
    b = dict(a, gmail_message_id="m2")
    ka, kb = pp.dedup_key(a), pp.dedup_key(b)
    assert ka.startswith("paypal:fallback:")
    assert ka == pp.dedup_key(dict(a))   # stable
    assert ka != kb                       # different messages never collide
