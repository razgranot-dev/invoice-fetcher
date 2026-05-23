"""Regression guard for the 2026-05-23 missed Anthropic receipt incident.

A real user manually checked Gmail and found Anthropic receipts the app
had not captured. Cross-referencing the live Gmail audit with the DB showed:

  • 25 real "Your receipt from Anthropic" emails existed in Gmail
  • 14 were in the DB (INCLUDED, confirmed_invoice)
  • 11 were missing from the DB — ALL of them outside the 30-day default
    scan window OR truncated by the worker's _MAX_MESSAGES=2000 cap

This test pins:
  1. Anthropic-receipt fixtures (mirroring real subject / sender / body
     shape, no payment details) classify as confirmed_invoice.
  2. The Gmail query strategy MUST match the Anthropic sender pattern via
     its `from:invoice` heuristic (the receipt local-part contains
     "invoice").
  3. The worker's _MAX_MESSAGES cap is wide enough for multi-year archive
     scans (≥ 5000).
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
)
from core.gmail_connector import GmailConnector, _MAX_MESSAGES


# Fixtures modelled on the real receipts seen in the audit (only structure;
# amounts and receipt numbers are dummy).
ANTHROPIC_RECEIPT_FIXTURES = [
    {
        "name": "Receipt — old style (pre-PBC rename, Jun 2024)",
        "subject": "Your receipt from Anthropic #2184-7562",
        "sender": "Anthropic <invoice+statements@mail.anthropic.com>",
        "body_text": (
            "Your receipt from Anthropic #2184-7562\n"
            "Invoice number 2184-7562\n"
            "Receipt number 2184-7562\n"
            "Total: $20.00\n"
            "Date: June 19, 2024\n"
            "Thank you for your subscription to Claude Pro."
        ),
        "body_html": "",
        "attachments": [{"filename": "invoice-2184-7562.pdf", "content_type": "application/pdf"}],
    },
    {
        "name": "Receipt — current PBC format (May 2026)",
        "subject": "Your receipt from Anthropic, PBC #2269-5040-1611",
        "sender": '"Anthropic, PBC" <invoice+statements@mail.anthropic.com>',
        "body_text": (
            "Your receipt from Anthropic, PBC #2269-5040-1611\n"
            "Invoice number: 2269-5040-1611\n"
            "Receipt number: 2269-5040-1611\n"
            "Total: $100.00\n"
            "Date: May 10, 2026"
        ),
        "body_html": "",
        "attachments": [{"filename": "invoice-faf42fc3-0027.pdf", "content_type": "application/pdf"}],
    },
]


@pytest.mark.parametrize(
    "fixture",
    ANTHROPIC_RECEIPT_FIXTURES,
    ids=[f["name"] for f in ANTHROPIC_RECEIPT_FIXTURES],
)
def test_anthropic_receipt_is_confirmed_or_likely(fixture):
    result = classify_email({
        "subject": fixture["subject"],
        "sender": fixture["sender"],
        "body_text": fixture["body_text"],
        "body_html": fixture["body_html"],
        "attachments": fixture["attachments"],
    })
    assert result["classification_tier"] in (TIER_CONFIRMED, TIER_LIKELY), (
        f"Anthropic receipt classified as {result['classification_tier']} "
        f"(score={result['classification_score']}) — expected confirmed/likely. "
        f"This means the receipt will be EXCLUDED from the report instead of INCLUDED."
    )


def test_anthropic_receipt_payment_unsuccessful_is_NOT_an_invoice():
    """Failed-payment notifications must NEVER classify as a real receipt.
    Historical DB rows had these as likely_invoice INCLUDED — verify the
    current classifier instant-disqualifies them."""
    result = classify_email({
        "subject": "$20.00 payment to Anthropic, PBC was unsuccessful again",
        "sender": '"Anthropic, PBC" <failed-payments@mail.anthropic.com>',
        "body_text": "Your $20.00 payment to Anthropic, PBC was unsuccessful. Please update your payment method.",
        "body_html": "",
        "attachments": [],
    })
    assert result["classification_tier"] == "not_invoice", (
        f"Failed-payment email classified as {result['classification_tier']} — "
        "the disqualify rule for 'was unsuccessful' is not firing."
    )


def test_query_matches_anthropic_sender_via_from_invoice_anchor():
    """Anthropic receipts come from invoice+statements@mail.anthropic.com.
    The query's `from:invoice` heuristic must match this sender pattern so
    the worker actually fetches the receipt — independent of any explicit
    anthropic.com domain list."""
    connector = GmailConnector()
    q = connector.build_query([], days_back=30, unread_only=False)
    assert "from:invoice" in q, (
        "Lost the from:invoice anchor — Anthropic receipts will no longer be fetched."
    )


def test_worker_message_cap_supports_multi_year_archive_scans():
    """A 2-year scan can easily exceed the prior 2000-message cap on an
    active inbox; the cap must be high enough that the OLDEST receipt
    isn't silently truncated."""
    assert _MAX_MESSAGES >= 5000, (
        f"_MAX_MESSAGES is {_MAX_MESSAGES}; multi-year archive scans need >= 5000 "
        "to avoid truncating the oldest receipts."
    )
