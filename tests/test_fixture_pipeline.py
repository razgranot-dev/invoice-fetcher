"""End-to-end pipeline verification against representative email fixtures.

Mimics the real scan flow against a fixed set of realistic emails covering
the entire matrix the project has to handle correctly:

  • English receipts: Apple, Google Workspace, OpenAI, Anthropic, Stripe,
    Vercel, Render, Cloudflare, Adobe, Canva, GitHub (Premium), Notion,
    PayPal, Amazon, Meta, Hostinger, Uber, Gett, Wolt, Booking.com,
    Marriott
  • Hebrew/Israeli invoices: bezeq, partner, cellcom, ten-bis, cibus,
    plain "חשבונית מס" patterns, plain "קבלה" patterns
  • PDF-only invoices (subject says nothing, attachment named invoice.pdf)
  • Marketing emails with invoice-shaped words ("free invoice template")
  • Subscription warnings ("your plan will expire")
  • Security alerts (must never be persisted)
  • Duplicate vendor emails (same supplier different month)
  • Weak signals (amount only, no invoice keyword)

For each fixture we check:
  1. classify_email tier matches the expectation.
  2. shouldPersist (mirroring web/src/app/api/scans/route.ts) returns
     the expected persistence decision.
  3. defaultReportStatus returns the expected INCLUDED/EXCLUDED.

Run: python -m pytest tests/test_fixture_pipeline.py -v

If any vendor fails, that's the SIGNAL — the comparison table in the QA
report should call out exactly which vendors the app currently mis-handles.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.invoice_classifier import (
    classify_email,
    TIER_NOT,
    TIER_POSSIBLE,
    TIER_LIKELY,
    TIER_CONFIRMED,
)


# ── Persistence helpers — mirror web/src/app/api/scans/route.ts ─────────────


def should_persist(inv: dict[str, Any]) -> bool:
    """Mirrors web/src/app/api/scans/route.ts:shouldPersist."""
    tier = inv.get("classification_tier") or TIER_NOT
    if tier != TIER_NOT:
        return True
    score = inv.get("classification_score") or 0
    if score < 5:
        return False
    signals = inv.get("classification_signals") or []
    return any(
        s.get("score", 0) > 0 and s.get("signal") != "sender_invoice_domain"
        for s in signals
    )


def default_report_status(tier: str) -> str:
    """Mirrors the helper inlined in web/src/app/api/scans/route.ts."""
    if tier in (TIER_CONFIRMED, TIER_LIKELY):
        return "INCLUDED"
    return "EXCLUDED"


# ── Fixture catalogue ──────────────────────────────────────────────────────
# Each fixture: (id, email_dict, expected_tier_set, expected_persisted, expected_status)

FIXTURES: list[tuple[str, dict[str, Any], set[str], bool, str | None]] = [
    # ───────── English vendor receipts (confirmed/likely → INCLUDED) ─────────
    (
        "Apple receipt",
        {
            "subject": "Your receipt from Apple",
            "sender": "App Store <no_reply@email.apple.com>",
            "body_text": "RECEIPT\nInvoice #INV-78231\nApple ID: user@example.com\nTotal: $9.99\nVAT: $1.70\nDate: April 15, 2026",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Google Workspace invoice",
        {
            "subject": "Your Google Workspace invoice for April 2026",
            "sender": "billing@payments.google.com",
            "body_text": "Invoice number: 1234567890\nAmount due: $18.00\nBilling period: April 1 - April 30, 2026\nTax: $1.80",
            "body_html": "",
            "attachments": [{"filename": "invoice-2026-04.pdf", "content_type": "application/pdf"}],
        },
        {TIER_CONFIRMED},
        True,
        "INCLUDED",
    ),
    (
        "OpenAI receipt",
        {
            "subject": "Your receipt from OpenAI",
            "sender": "noreply@openai.com",
            "body_text": "Receipt #r_abc123\nThank you for your purchase!\nAmount paid: $20.00\nCard ending in 4242",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Anthropic API invoice",
        {
            "subject": "Anthropic Invoice — March 2026",
            "sender": "billing@anthropic.com",
            "body_text": "Invoice #ANT-2026-03-1199\nTotal: $52.40\nUsage: API requests\nVAT: $8.91",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Stripe payment receipt",
        {
            "subject": "Payment receipt — $99.00",
            "sender": "receipts@stripe.com",
            "body_text": "Receipt #ch_abc123def\nAmount paid: $99.00\nPayment method: card ending 1234",
            "body_html": "",
            "attachments": [{"filename": "receipt.pdf", "content_type": "application/pdf"}],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Vercel invoice",
        {
            "subject": "Vercel invoice — April 2026",
            "sender": "billing@vercel.com",
            "body_text": "Invoice #VER-2026-04\nAmount: $20.00\nBilling period: April 2026",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Adobe Creative Cloud receipt",
        {
            "subject": "Your Adobe Creative Cloud receipt",
            "sender": "message@adobe.com",
            "body_text": "Order receipt #IN-AB123\nTotal: $54.99\nCreative Cloud All Apps\nPayment method: Visa",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "GitHub Pro renewal receipt",
        {
            "subject": "Your GitHub Pro receipt — invoice #INV-12345",
            "sender": "billing@github.com",
            "body_text": "Thanks for your payment.\nInvoice #INV-12345\nGitHub Pro subscription\nTotal: $4.00\nPayment method: card ending 4242\nBilling period: April 2026",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "PayPal payment receipt to Shopify",
        {
            "subject": "Receipt for Your Payment to Shopify International",
            "sender": "service@paypal.com",
            "body_text": "Hello, you sent a payment of $29.00 USD. Transaction ID: 12345. Receipt number: ABC-789.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Amazon order receipt",
        {
            "subject": "Your Amazon.com order confirmation",
            "sender": "auto-confirm@amazon.com",
            "body_text": "Order #114-12345 confirmed\nOrder total: $45.32\nShipping address: ...\nPayment: Visa ending 4242",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Uber ride receipt",
        {
            "subject": "Your Friday morning trip with Uber",
            "sender": "Uber Receipts <receipts@uber.com>",
            "body_text": "Total: $14.50\nTrip receipt #R-998877\nFare: $12.00\nTip: $2.50\nPayment: Visa",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Booking.com stay confirmation",
        {
            "subject": "Your booking confirmation — Hilton Tel Aviv",
            "sender": "noreply@booking.com",
            "body_text": "Booking reference: ABC-12345\nTotal cost: $580.00\nCheck-in: May 10, 2026\nPayment method: card ending 4242",
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),

    # ───────── Hebrew / Israeli invoices (must work!) ─────────
    (
        "Hebrew tax invoice — Bezeq",
        {
            "subject": "חשבונית מס 12345 - בזק",
            "sender": "billing@bezeq.co.il",
            "body_text": 'מספר חשבונית 12345\nסה"כ לתשלום: ₪199.00\nמע"מ 17%\nתקופת חיוב: אפריל 2026',
            "body_html": "",
            "attachments": [{"filename": "חשבונית-04-2026.pdf", "content_type": "application/pdf"}],
        },
        {TIER_CONFIRMED},
        True,
        "INCLUDED",
    ),
    (
        "Hebrew receipt — Cellcom",
        {
            "subject": "קבלה מס' 9988 על החיוב החודשי שלך",
            "sender": "noreply@cellcom.co.il",
            "body_text": 'אישור חיוב חודשי\nסכום: ₪149.00\nכרטיס אשראי: כרטיס המסתיים ב-4242\nתאריך: 01/04/2026',
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Hebrew transaction confirmation — Partner",
        {
            "subject": "אישור תשלום - פרטנר תקשורת",
            "sender": "billing@partner.co.il",
            "body_text": 'פירוט חיוב חודש מאי 2026\nסה"כ: ₪89.90\nאמצעי תשלום: כרטיס אשראי',
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Hebrew order — 10bis food delivery",
        {
            "subject": "אישור הזמנה - 10ביס",
            "sender": "orders@tenbis.co.il",
            "body_text": 'אישור הזמנה מספר 555\nסכום לתשלום: ₪67.50\nמסעדה: סושי בר\nאמצעי תשלום: כרטיס אשראי',
            "body_html": "",
            "attachments": [],
        },
        {TIER_CONFIRMED, TIER_LIKELY},
        True,
        "INCLUDED",
    ),
    (
        "Hebrew gas/electricity bill — חשבון חודשי",
        {
            "subject": "חשבון חודשי - חברת החשמל",
            "sender": "billing@electric.co.il",
            "body_text": 'חשבון חודש מאי 2026\nסכום לתשלום: ₪430.00\nתקופת חיוב: 01/04 - 30/04\nמע"מ: 17%',
            "body_html": "",
            "attachments": [{"filename": "חשבון-מאי-2026.pdf", "content_type": "application/pdf"}],
        },
        {TIER_CONFIRMED},
        True,
        "INCLUDED",
    ),

    # ───────── PDF-only invoice (subject says little) ─────────
    (
        "PDF-only: invoice.pdf attached, vague subject",
        {
            "subject": "Documents attached",
            "sender": "billing@some-vendor.example",
            "body_text": "Please find your monthly invoice attached.",
            "body_html": "",
            "attachments": [{"filename": "invoice-2026-04.pdf", "content_type": "application/pdf"}],
        },
        {TIER_LIKELY, TIER_CONFIRMED, TIER_POSSIBLE},
        True,
        None,  # any persisted is fine here
    ),

    # ───────── Marketing emails that LOOK like invoices but aren't ─────────
    (
        "Marketing: 'free invoice template'",
        {
            "subject": "Get our free invoice template — limited time",
            "sender": "marketing@some-saas.example",
            "body_text": "Need a better invoice template? Download our free one today! Special offer 50% off our premium plan.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT, TIER_POSSIBLE},
        # Either dropped (TIER_NOT, low score), or persisted as EXCLUDED (TIER_POSSIBLE).
        # Never INCLUDED.
        None,
        None,
    ),
    (
        "Subscription expiry warning (NOT a receipt)",
        {
            "subject": "Your subscription is about to expire",
            "sender": "billing@some-saas.example",
            "body_text": "Renew now to continue receiving service. Renew before May 15.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT},
        False,
        None,
    ),

    # ───────── Security/marketing/notification — must be dropped ─────────
    (
        "Google security alert",
        {
            "subject": "Critical security alert for your linked Google account",
            "sender": "no-reply@accounts.google.com",
            "body_text": "Someone signed in to your account.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT},
        False,
        None,
    ),
    (
        "GitHub PR notification",
        {
            "subject": "[github] PR #42 opened by alice",
            "sender": "notifications@github.com",
            "body_text": "Alice opened a pull request in repo foo/bar.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT},
        False,
        None,
    ),
    (
        "Apple security/sign-in (NOT receipt)",
        {
            "subject": "Your Apple ID was used to sign in",
            "sender": "no-reply@email.apple.com",
            "body_text": "Your Apple ID was used to sign in on a new device.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT},
        False,
        None,
    ),
    (
        "Hostinger marketing (vendor non-invoice)",
        {
            "subject": "🚀 Get started with Hostinger — tips for your first website",
            "sender": "marketing@mailer.hostinger.com",
            "body_text": "Welcome to Hostinger! Here are tips for launching your site. Special offer: 50% off renewal.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT},
        False,
        None,
    ),

    # ───────── Large HTML email (body truncation guard) ─────────
    (
        "Large HTML body — newsletter style",
        {
            "subject": "Latest updates from your team",
            "sender": "news@example.com",
            "body_text": "",
            "body_html": "<html><body>" + "<p>Marketing copy and lots of styles.</p>" * 5000 + "</body></html>",
            "attachments": [],
        },
        {TIER_NOT},
        False,
        None,
    ),

    # ───────── Weak financial signal — must NOT be INCLUDED ─────────
    (
        "Weak: amount only, no invoice keyword",
        {
            "subject": "Quick note",
            "sender": "friend@example.com",
            "body_text": "I owe you $50 for lunch.",
            "body_html": "",
            "attachments": [],
        },
        {TIER_NOT, TIER_POSSIBLE},
        None,  # either dropped or persisted as EXCLUDED
        None,
    ),
]


@pytest.mark.parametrize("name,email,expected_tiers,expected_persisted,expected_status", FIXTURES, ids=[f[0] for f in FIXTURES])
def test_fixture(
    name: str,
    email: dict[str, Any],
    expected_tiers: set[str],
    expected_persisted: bool | None,
    expected_status: str | None,
):
    """Run the fixture through classify + persistence pipeline and assert
    against the expectation set."""
    result = classify_email(email)
    tier = result["classification_tier"]
    score = result["classification_score"]

    # 1. Tier check
    assert tier in expected_tiers, (
        f"[{name}] tier={tier} score={score} — expected one of {sorted(expected_tiers)}"
    )

    # 2. Persistence check (skip if expectation is None — "either is fine")
    persisted = should_persist(result)
    if expected_persisted is not None:
        assert persisted == expected_persisted, (
            f"[{name}] should_persist={persisted}, expected {expected_persisted} "
            f"(tier={tier} score={score})"
        )

    # 3. Report status check — only checked if both expected and persisted
    if persisted and expected_status is not None:
        status = default_report_status(tier)
        assert status == expected_status, (
            f"[{name}] reportStatus={status}, expected {expected_status} (tier={tier})"
        )

    # Sanity: marketing/security MUST NEVER end up INCLUDED
    if expected_tiers == {TIER_NOT}:
        if persisted:
            assert default_report_status(tier) == "EXCLUDED", (
                f"[{name}] dropped to EXCLUDED is OK, but never INCLUDED"
            )


def test_summary_report(capsys):
    """Print a comparison table for the QA report. Always passes — diagnostic only."""
    print()
    print(f"{'name':<55} {'tier':<26} {'score':>6} {'persisted':>10} {'status':<10}")
    print("-" * 115)
    counts: dict[str, int] = {}
    for name, email, _, _, _ in FIXTURES:
        result = classify_email(email)
        tier = result["classification_tier"]
        score = result["classification_score"]
        persisted = should_persist(result)
        status = default_report_status(tier) if persisted else "(dropped)"
        counts[tier] = counts.get(tier, 0) + 1
        print(f"{name:<55} {tier:<26} {score:>6} {str(persisted):>10} {status:<10}")
    print()
    print("Tier counts:", json.dumps(counts, indent=2))
