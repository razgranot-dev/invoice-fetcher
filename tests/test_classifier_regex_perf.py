"""Regression guard for the "scan stuck at 70%" incident.

Pins down two invariants that broke and were fixed in scripts/diag_bolt_email.py
investigation:

1. classify_email of a worst-case 90KB body must finish in <1 second.
   The bug was a regex with three independent `\s*` quantifiers
   (`\s*#?\s*:?\s*`) that exhibited Cartesian backtracking against
   tag-stripped HTML bodies containing many "receipt"/"inv" substrings.
   17+ seconds per email turned the whole scan into a hang.

2. The fixed regex must still match the common positive cases the worker
   relies on for "invoice number" hard evidence.
"""

import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.invoice_classifier import _INVOICE_NUMBER_PATTERNS, classify_email


# Adversarial body that triggered the original catastrophic backtracking:
# many "receipt"/"invoice"/"inv" substrings with whitespace runs and no
# trailing digits, on a ~40KB tag-stripped body.
_ADVERSARIAL = (
    "Your Bolt ride receipt\n"
    + ("This is a marketing receipt for inv  invitation receipt " * 600)
    + "  invoice no   payment receipt   "
)


def test_invoice_number_regex_does_not_backtrack_catastrophically():
    pattern = _INVOICE_NUMBER_PATTERNS[0][0]  # English invoice/receipt pattern
    start = time.perf_counter()
    pattern.search(_ADVERSARIAL)
    elapsed = time.perf_counter() - start
    # Pre-fix this took ~17 seconds. Post-fix it must complete in <1s,
    # giving a 10x safety margin over the typical post-fix runtime (<10ms).
    assert elapsed < 1.0, (
        f"INVOICE_NUMBER_PATTERN took {elapsed:.2f}s on adversarial body — "
        "regex backtracking regression. Avoid nested optional quantifiers "
        "between the keyword and the digit class."
    )


def test_classify_email_completes_fast_on_large_body():
    email = {
        "subject": "Your Bolt ride on Friday",
        "sender": "Bolt Thailand <bangkok@bolt.eu>",
        "body_text": "",
        "body_html": _ADVERSARIAL,
        "attachments": [],
    }
    start = time.perf_counter()
    classify_email(email)
    elapsed = time.perf_counter() - start
    assert elapsed < 1.0, (
        f"classify_email took {elapsed:.2f}s on adversarial body. "
        "This causes the scan to appear stuck at 70% in the UI."
    )


def test_invoice_number_pattern_still_matches_common_cases():
    pattern = _INVOICE_NUMBER_PATTERNS[0][0]
    cases = [
        "invoice 12345",
        "invoice #12345",
        "Invoice: 12345",
        "INVOICE #: 12345",
        "Receipt 12345",
        "RECEIPT #12345",
        "Receipt: 12345",
        "rcpt 12345",
        "rcpt #12345",
        "Invoice    12345",          # extra whitespace
        "Invoice#12345",             # no whitespace
    ]
    for s in cases:
        assert pattern.search(s), f"Expected match for: {s!r}"


def test_invoice_number_pattern_rejects_unrelated_text():
    pattern = _INVOICE_NUMBER_PATTERNS[0][0]
    cases = [
        "received your message",                    # "rec" matches start but no \d{3,} follows
        "your invitation is",                       # "inv" but no digits
        "Hello, welcome to our service",            # nothing
        "Receipt for your trip — see app",          # "receipt" but no digits after small gap
    ]
    for s in cases:
        m = pattern.search(s)
        # We don't require strict rejection of every adjacent-digit case,
        # but the regex should not match these particular benign texts.
        assert m is None, f"Unexpected match in {s!r}: {m.group(0)!r}"


def test_hebrew_invoice_number_pattern_still_works():
    pattern = _INVOICE_NUMBER_PATTERNS[1][0]
    assert pattern.search("חשבונית 12345")
    assert pattern.search("חשבונית מס 12345")
    assert pattern.search("קבלה 12345")
