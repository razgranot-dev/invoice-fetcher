"""Synthetic end-to-end smoke test for the scan classification pipeline.

Feeds representative emails through classify_email and verifies each lands in
the tier the project spec expects. Does NOT hit Gmail — runs entirely against
the in-process classifier and the helper functions. Safe to commit; safe to
run in CI.

Use after any scan-pipeline change to confirm correctness invariants.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.invoice_classifier import (
    classify_email,
    TIER_NOT,
    TIER_POSSIBLE,
    TIER_LIKELY,
    TIER_CONFIRMED,
)


# Representative emails — each one chosen because users commonly receive it.
CASES = [
    # name, expected_tier (or set of accepted), email
    (
        "Apple receipt (confirmed)",
        {TIER_CONFIRMED, TIER_LIKELY},
        {
            "subject": "Your receipt from Apple",
            "sender": "App Store <no_reply@email.apple.com>",
            "body_text": "Invoice #INV-12345\nTotal: $9.99\nVAT: $1.70",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "PayPal receipt to vendor",
        {TIER_CONFIRMED, TIER_LIKELY},
        {
            "subject": "Receipt for Your Payment to Shopify International",
            "sender": "service@paypal.com",
            "body_text": "You sent a payment of $29.00 USD. Invoice #ABC-789. Transaction ID 12345.",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "Uber ride receipt",
        {TIER_CONFIRMED, TIER_LIKELY},
        {
            "subject": "Your trip with Uber",
            "sender": "Uber Receipts <receipts@uber.com>",
            "body_text": "Total: $14.50\nTrip receipt #R-998877\nThanks for riding.",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "Hebrew tax invoice (confirmed)",
        {TIER_CONFIRMED, TIER_LIKELY},
        {
            "subject": "חשבונית מס 12345 - בזק",
            "sender": "billing@bezeq.co.il",
            "body_text": 'מספר חשבונית 12345 סה"כ לתשלום ₪199.00 מע"מ 17%',
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "Google security alert (not_invoice — instant disqualify)",
        {TIER_NOT},
        {
            "subject": "Critical security alert",
            "sender": "no-reply@accounts.google.com",
            "body_text": "Someone tried to sign in to your account.",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "Hostinger marketing (vendor-specific disqualify)",
        {TIER_NOT},
        {
            "subject": "🚀 Get started with Hostinger — tips for your first website",
            "sender": "marketing@mailer.hostinger.com",
            "body_text": "Welcome to Hostinger! Here are some tips to launch your site.",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "OpenAI subscription warning (not yet charged)",
        {TIER_NOT},
        {
            "subject": "Your ChatGPT Plus access will end soon",
            "sender": "no-reply@openai.com",
            "body_text": "Your subscription will expire in 3 days. Renew now.",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "Weak signal — possible (needs review)",
        {TIER_POSSIBLE, TIER_NOT},
        {
            "subject": "Update on your account",
            "sender": "service@example-vendor.com",
            "body_text": "Hi there. Just a note that your account is active. $0",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "PDF attachment named invoice.pdf alone",
        {TIER_CONFIRMED, TIER_LIKELY, TIER_POSSIBLE},
        {
            "subject": "Documents attached",
            "sender": "billing@example.com",
            "body_text": "Please find your invoice attached.",
            "body_html": "",
            "attachments": [
                {"filename": "invoice-2026-04.pdf", "content_type": "application/pdf"}
            ],
        },
    ),
    (
        "Github PR notification (disqualify)",
        {TIER_NOT},
        {
            "subject": "[github] pull request opened by alice",
            "sender": "notifications@github.com",
            "body_text": "Alice opened a pull request.",
            "body_html": "",
            "attachments": [],
        },
    ),
    (
        "Marketing 'limited time' (heavy negative)",
        {TIER_NOT},
        {
            "subject": "🔥 Limited time: 50% off — sale ends Sunday",
            "sender": "marketing@aliexpress.com",
            "body_text": "Get up to 50% off on top picks.",
            "body_html": "",
            "attachments": [],
        },
    ),
]


def main() -> int:
    passed = 0
    failed = 0
    for name, expected, email in CASES:
        result = classify_email(email)
        tier = result["classification_tier"]
        score = result["classification_score"]
        ok = tier in expected
        marker = "PASS" if ok else "FAIL"
        print(f"[{marker}] {name}: tier={tier} score={score} expected={sorted(expected)}")
        if ok:
            passed += 1
        else:
            failed += 1

    print()
    print(f"Result: {passed}/{passed + failed} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
