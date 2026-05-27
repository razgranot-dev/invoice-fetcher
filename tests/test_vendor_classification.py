"""Vendor receipt classification regression tests.

Pins that real receipts from the vendors the user actually receives invoices
from are classified as INCLUDED-worthy (confirmed/likely), and that the
look-alike NON-receipts from the same vendors stay not_invoice. Modelled on
the real subject/sender/body shapes (dummy amounts + numbers).

Added 2026-05-27 alongside fixes for:
  • _SUBJECT_WEAK first-match shadowing (a weak word like "billing" hid the
    hard-evidence "invoice" keyword → real invoices dropped)
  • Render/Netlify/Fly/Railway missing from the invoice sender-domain list
  • "payment receipt" not being a strong subject keyword
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.invoice_classifier import (
    classify_email,
    TIER_CONFIRMED,
    TIER_LIKELY,
    TIER_POSSIBLE,
    TIER_NOT,
)

INCLUDED_TIERS = (TIER_CONFIRMED, TIER_LIKELY)
PERSISTED_TIERS = (TIER_CONFIRMED, TIER_LIKELY, TIER_POSSIBLE)


def _classify(sender, subject, body="", attachments=None):
    return classify_email({
        "sender": sender,
        "subject": subject,
        "body_text": body,
        "body_html": "",
        "attachments": attachments or [],
    })


# ── Real receipts that MUST land in the report (confirmed/likely) ──────────

REAL_RECEIPTS = [
    (
        "OpenAI receipt",
        "noreply@openai.com",
        "Your receipt from OpenAI",
        "Amount paid: $20.00\nPayment method: Visa ending 4242\nReceipt #1234567",
        [],
    ),
    (
        "Stripe payment receipt",
        "receipts@stripe.com",
        "Payment receipt — $99.00",
        "Amount paid: $99.00\nPayment method: card ending 4242",
        [],
    ),
    (
        "PayPal payment to vendor",
        "service@paypal.com",
        "Receipt for your payment to Shopify International",
        "You sent a payment of $29.00\nTransaction ID: 8AB12345\nReceipt number: R-789",
        [],
    ),
    (
        "Uber trip receipt",
        "Uber Receipts <noreply@uber.com>",
        "Your Thursday evening trip with Uber",
        "Total: $14.50\nTrip fare: $12.00\nReceipt #R-998877",
        [],
    ),
    (
        "Vercel invoice",
        "billing@vercel.com",
        "Vercel Invoice — April 2026",
        "Invoice number INV-2026-04-001\nAmount due: $20.00\nBilling period: April 2026",
        [],
    ),
    (
        "Render invoice",
        "billing@render.com",
        "Your Render invoice for March 2026",
        "Invoice number 88123\nAmount due: $7.00\nBilling period: March 2026",
        [],
    ),
    (
        "GitHub Pro receipt (billing@github.com)",
        "billing@github.com",
        "Your GitHub Pro receipt — invoice #INV-12345",
        "Invoice #INV-12345\nGitHub Pro\nTotal: $4.00\nBilling period: April 2026",
        [],
    ),
    (
        "GitHub receipt (noreply@github.com)",
        "GitHub <noreply@github.com>",
        "Invoice from GitHub for GitHub Pro",
        "Invoice number 998877\nTotal: $4.00",
        [],
    ),
    (
        "Hebrew tax invoice/receipt",
        "billing@some-vendor.co.il",
        "חשבונית מס/קבלה מספר 12345",
        'מספר חשבונית 12345\nסה"כ לתשלום: ₪199.00\nמע"מ 17%',
        [],
    ),
    (
        "Hebrew Wolt purchase receipt (construct form)",
        "receipts@wolt.com",
        "קבלת רכישה מ-Wolt",
        "אישור הזמנה\nסכום לתשלום: ₪67.50\nאמצעי תשלום: כרטיס אשראי",
        [],
    ),
]


@pytest.mark.parametrize(
    "name,sender,subject,body,atts",
    REAL_RECEIPTS,
    ids=[r[0] for r in REAL_RECEIPTS],
)
def test_real_receipt_is_included(name, sender, subject, body, atts):
    res = _classify(sender, subject, body, atts)
    assert res["classification_tier"] in INCLUDED_TIERS, (
        f"{name}: classified {res['classification_tier']} "
        f"(score={res['classification_score']}) — expected confirmed/likely (INCLUDED). "
        f"Real invoice would be EXCLUDED from the report."
    )


# ── _SUBJECT_WEAK shadowing regression: a weak word before the hard keyword ──

def test_billing_invoice_subject_not_dropped():
    """'billing' (weak, 5pts) used to shadow 'invoice' (hard evidence). The
    email then had no hard evidence and was dropped as not_invoice. It must
    now be persisted (at least possible)."""
    res = _classify(
        "billing@someapp.example",
        "Monthly billing invoice for March 2026",
        "Amount due: $49.00",
    )
    assert res["classification_tier"] in PERSISTED_TIERS, (
        f"'billing invoice' dropped as {res['classification_tier']} "
        f"(score={res['classification_score']}) — the _SUBJECT_WEAK shadowing bug regressed."
    )


# ── Look-alike NON-receipts from the same vendors must stay not_invoice ─────

NON_RECEIPTS = [
    ("OpenAI action-required (not a receipt)", "noreply@openai.com",
     "Action required: update your payment method",
     "Your payment method needs updating to keep your subscription."),
    ("GitHub PR notification", "notifications@github.com",
     "[GitHub] Pull request #42 merged",
     "Alice merged pull request #42 into main."),
    ("PayPal security alert", "service@paypal.com",
     "Unusual activity detected on your account",
     "We noticed a new login. Please verify your identity."),
    ("Anthropic failed payment", '"Anthropic, PBC" <billing@mail.anthropic.com>',
     "$20.00 payment to Anthropic, PBC was unsuccessful",
     "Your $20.00 payment was unsuccessful. Please update your payment method."),
]


@pytest.mark.parametrize(
    "name,sender,subject,body",
    NON_RECEIPTS,
    ids=[r[0] for r in NON_RECEIPTS],
)
def test_lookalike_non_receipt_is_not_invoice(name, sender, subject, body):
    res = _classify(sender, subject, body)
    assert res["classification_tier"] == TIER_NOT, (
        f"{name}: classified {res['classification_tier']} — expected not_invoice. "
        f"A non-receipt would pollute the report."
    )
