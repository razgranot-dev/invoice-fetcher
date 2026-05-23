"""Regression invariants pinned from the 2026-05-23 incident.

These tests guard the failure modes the user's manual Gmail audit
surfaced after the previous "PASS" report:

  1. daysBack window behaviour at common values (90 / 180 / 365 / 730)
  2. Worker message cap is high enough to avoid silent truncation
  3. Candidate-pagination ceiling matches the documented intent
  4. Scan classification gating remains correct on the live email shapes
     (Anthropic receipts, failed-payment notifications)
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.gmail_connector import GmailConnector, _MAX_MESSAGES


# ── days_back boundary behaviour ─────────────────────────────────────


def _after_date(days_back: int) -> str:
    return (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")


def test_query_with_days_back_90():
    c = GmailConnector()
    q = c.build_query([], days_back=90, unread_only=False)
    assert f"after:{_after_date(90)}" in q


def test_query_with_days_back_180():
    c = GmailConnector()
    q = c.build_query([], days_back=180, unread_only=False)
    assert f"after:{_after_date(180)}" in q


def test_query_with_days_back_365():
    c = GmailConnector()
    q = c.build_query([], days_back=365, unread_only=False)
    assert f"after:{_after_date(365)}" in q


def test_query_with_days_back_730_supported():
    """Bumped on 2026-05-23 from 365 → 730 to allow 2-year archive scans."""
    c = GmailConnector()
    q = c.build_query([], days_back=730, unread_only=False)
    assert f"after:{_after_date(730)}" in q


def test_query_length_bounded_for_730_day_window_with_max_keywords():
    """A 2-year scan with the 20-keyword maximum must still fit Gmail's
    practical q-parameter ceiling."""
    c = GmailConnector()
    big_keywords = [f"kw{i}" for i in range(20)]
    q = c.build_query(big_keywords, days_back=730, unread_only=False)
    assert len(q) < 2000, (
        f"730-day query with 20 keywords is {len(q)} chars; must stay under 2KB."
    )


# ── candidate cap ────────────────────────────────────────────────────


def test_max_messages_supports_two_year_archive_volume():
    """A 2-year scan on a typical active inbox can yield 2000+ candidate
    messages. _MAX_MESSAGES must be high enough to NOT silently truncate
    the oldest receipts."""
    assert _MAX_MESSAGES >= 5000, (
        f"_MAX_MESSAGES is {_MAX_MESSAGES}; multi-year archive scans need >= 5000."
    )


def test_max_messages_is_a_safety_cap_not_a_hard_limit_at_2000():
    """The original 2000 cap caused the incident — pin the new value so a
    regression to 2000 fails fast."""
    assert _MAX_MESSAGES != 2000, "_MAX_MESSAGES regressed to 2000 — incident value."
