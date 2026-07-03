"""M22 regression — explicit selection is the source of truth for ZIP exports.

is_screenshot_worthy used to return (False, "skipped: not an invoice") for
every not_invoice row, silently dropping invoices the user had explicitly
checkbox-selected for export. Explicit selection (signalled either by the
``explicitly_selected`` keyword arg or an ``explicitly_selected`` flag on the
invoice dict — the flag rides the worker payload untouched, since
ExportRequest.invoices is list[dict]) now bypasses the tier gate entirely.
Filter-mode exports never carry the flag, so their behavior is unchanged.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.invoice_classifier import (
    TIER_CONFIRMED,
    TIER_LIKELY,
    TIER_NOT,
    TIER_POSSIBLE,
    is_screenshot_worthy,
)


class TestExplicitSelectionBypassesTierGate:
    def test_not_invoice_with_dict_flag_is_worthy(self):
        inv = {"classification_tier": TIER_NOT, "explicitly_selected": True}
        assert is_screenshot_worthy(inv) == (True, "")

    def test_not_invoice_with_param_is_worthy(self):
        inv = {"classification_tier": TIER_NOT}
        assert is_screenshot_worthy(inv, explicitly_selected=True) == (True, "")

    def test_selected_row_never_reports_skip_reason(self):
        _, reason = is_screenshot_worthy(
            {"classification_tier": TIER_NOT, "explicitly_selected": True}
        )
        assert reason == ""


class TestFilterModeUnchanged:
    """Without the flag (filter-mode payloads), the old tier gate holds."""

    def test_not_invoice_without_flag_is_skipped(self):
        worthy, reason = is_screenshot_worthy({"classification_tier": TIER_NOT})
        assert worthy is False
        assert reason == "skipped: not an invoice"

    @pytest.mark.parametrize("falsy", [False, None, "", 0])
    def test_falsy_flag_values_do_not_bypass(self, falsy):
        inv = {"classification_tier": TIER_NOT, "explicitly_selected": falsy}
        worthy, _ = is_screenshot_worthy(inv)
        assert worthy is False

    @pytest.mark.parametrize("tier", [TIER_CONFIRMED, TIER_LIKELY, TIER_POSSIBLE])
    def test_qualifying_tiers_still_worthy(self, tier):
        assert is_screenshot_worthy({"classification_tier": tier}) == (True, "")

    def test_missing_tier_still_worthy(self):
        assert is_screenshot_worthy({}) == (True, "")
