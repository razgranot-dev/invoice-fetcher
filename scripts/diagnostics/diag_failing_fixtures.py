"""Re-check the failing fixtures with REAL dollar signs (not shell-expanded)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from core.invoice_classifier import classify_email, format_signal_breakdown

CASES = [
    ("Anthropic API invoice", {
        "subject": "Anthropic Invoice — March 2026",
        "sender": "billing@anthropic.com",
        "body_text": "Invoice #ANT-2026-03-1199\nTotal: $52.40\nUsage: API requests\nVAT: $8.91",
        "body_html": "",
        "attachments": [],
    }),
    ("Adobe Creative Cloud receipt", {
        "subject": "Your Adobe Creative Cloud receipt",
        "sender": "message@adobe.com",
        "body_text": "Order receipt #IN-AB123\nTotal: $54.99\nCreative Cloud All Apps\nPayment method: Visa",
        "body_html": "",
        "attachments": [],
    }),
    ("GitHub Premium subscription receipt", {
        "subject": "Receipt from GitHub Premium",
        "sender": "billing@github.com",
        "body_text": "Receipt #abc123\nGitHub Premium\nTotal: $4.00\nThank you for your payment.",
        "body_html": "",
        "attachments": [],
    }),
]

for name, email in CASES:
    r = classify_email(email)
    print(f"=== {name} ===")
    print(f"  tier: {r['classification_tier']}  score: {r['classification_score']}")
    print(f"  signals: {format_signal_breakdown(r['classification_signals'])}")
    print()
