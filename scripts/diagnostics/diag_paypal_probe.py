"""Diagnostic: run realistic PayPal email fixtures through the REAL pipeline.

Reproduces the production path exactly:
  parse → BodyParser.extract_text → classify_email → enrich_results
then applies the web-side shouldPersist() gate (ported 1:1 from
web/src/app/api/scans/route.ts) so we can see EXACTLY where PayPal is lost.

Run: .venv/Scripts/python.exe scripts/diagnostics/diag_paypal_probe.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from core.invoice_classifier import classify_email, format_signal_breakdown
from core.amount_extractor import extract_amount
from core.body_parser import BodyParser

# ── shouldPersist() ported from web/src/app/api/scans/route.ts ──────────────
def should_persist(res: dict) -> bool:
    tier = res.get("classification_tier") or "not_invoice"
    if tier != "not_invoice":
        return True
    score = res.get("classification_score") or 0
    if score < 5:
        return False
    signals = res.get("classification_signals") or []
    return any(s["score"] > 0 and s["signal"] != "sender_invoice_domain" for s in signals)


# ── Realistic PayPal fixtures (HTML-heavy, no PDF — as PayPal actually sends) ─
# Amounts/IDs are synthetic. Shapes mirror real PayPal transactional emails.

PAYPAL_HTML_EN = """\
<html><body>
<table><tr><td><img src="paypal-logo.png" alt="PayPal"></td></tr></table>
<h1>You sent a payment</h1>
<p>Hello Raz Granot,</p>
<p>You sent <strong>$29.00 USD</strong> to Shopify International Limited.</p>
<table>
  <tr><td>Transaction ID</td><td>8AB12345CD678901E</td></tr>
  <tr><td>Date</td><td>June 2, 2026</td></tr>
  <tr><td>Payment method</td><td>Visa x-4242</td></tr>
</table>
<a href="https://www.paypal.com/activity/payment/8AB12345CD678901E">View your receipt</a>
</body></html>
"""

PAYPAL_HTML_HE = """\
<html><body dir="rtl">
<table><tr><td><img src="paypal-logo.png" alt="PayPal"></td></tr></table>
<h1>שלחת תשלום</h1>
<p>שלום רז,</p>
<p>שלחת <strong>49.90 ₪</strong> ל-Apple Services.</p>
<table>
  <tr><td>מספר עסקה</td><td>9XY98765ZW432101A</td></tr>
  <tr><td>תאריך</td><td>2 ביוני 2026</td></tr>
</table>
</body></html>
"""

# Modern PayPal "automatic/subscription" payment, HTML-only.
PAYPAL_HTML_AUTO = """\
<html><body>
<h1>Automatic payment sent</h1>
<p>You made an automatic payment of <strong>US$9.99</strong> to Spotify AB.</p>
<table><tr><td>Transaction ID</td><td>5KK00011LM222333N</td></tr>
<tr><td>Date</td><td>Jun 1, 2026</td></tr></table>
</body></html>
"""

FIXTURES = [
    # (name, sender, subject, body_html)
    ("EN: You sent a payment (HTML-only)", "service@paypal.com",
     "You sent a payment of $29.00 USD to Shopify", PAYPAL_HTML_EN),
    ("EN: You paid (modern subject)", "service@paypal.com",
     "You paid $29.00 USD to Shopify", PAYPAL_HTML_EN),
    ("EN: Receipt for your payment", "service@paypal.com",
     "Receipt for your payment to Shopify International", PAYPAL_HTML_EN),
    ("EN: bare 'Transaction details'", "service@paypal.com",
     "Transaction details", PAYPAL_HTML_EN),
    ("EN: Automatic/subscription payment", "service@paypal.com",
     "Automatic payment to Spotify", PAYPAL_HTML_AUTO),
    ("HE: shalacht tashlum (sent payment)", "service@paypal.com",
     "שלחת תשלום של 49.90 ₪ ל-Apple", PAYPAL_HTML_HE),
    ("HE: kabala (receipt)", "service@paypal.com",
     "הקבלה שלך מ-PayPal", PAYPAL_HTML_HE),
    ("HE: bare subject, HE body", "paypal@mail.paypal.com",
     "PayPal", PAYPAL_HTML_HE),
    ("EN: mail.paypal.com sender", "paypal@mail.paypal.com",
     "You sent a payment of $29.00 USD to Shopify", PAYPAL_HTML_EN),
]

bp = BodyParser()
print("=" * 100)
print(f"{'FIXTURE':<42} {'TIER':<26} {'SCORE':>5} {'PERSIST':>8} {'AMOUNT':>10}")
print("=" * 100)
lost = []
for name, sender, subject, body_html in FIXTURES:
    email = {
        "sender": sender,
        "subject": subject,
        "body_text": "",        # PayPal often sends HTML-only
        "body_html": body_html,
        "attachments": [],      # no PDF
    }
    res = classify_email(email)
    text = bp.extract_text("", body_html)
    amt = extract_amount(text)
    persist = should_persist(res)
    tier = res["classification_tier"]
    flag = "OK" if persist else "LOST"
    if not persist:
        lost.append(name)
    print(f"{name:<42} {tier:<26} {res['classification_score']:>5} {flag:>8} "
          f"{str(amt['amount']):>6}{amt['currency']:>4}")
    if not persist:
        print(f"    signals: {format_signal_breakdown(res['classification_signals'])}")

print("=" * 100)
print(f"LOST (dropped before DB): {len(lost)}/{len(FIXTURES)}")
for n in lost:
    print(f"  - {n}")
