# -*- coding: utf-8 -*-
"""Tests for _extract_company sender normalization."""

import pytest
from dashboard.components import _extract_company


class TestExtractCompany:
    """Sender → company label normalization."""

    def test_display_name_used(self):
        # "Corp" is stripped as a noise suffix, leaving "Acme"
        assert _extract_company("Acme Corp <billing@acme.com>") == "Acme"

    def test_strips_ltd_suffix(self):
        assert _extract_company('Mega Ltd <info@mega.co.il>') == "Mega"

    def test_strips_baam(self):
        # בע"מ is common Hebrew corporate suffix
        result = _extract_company('חברת בדיקות בע"מ <test@example.com>')
        assert result == "חברת בדיקות"

    def test_domain_fallback_when_no_display_name(self):
        result = _extract_company("billing@acme-corp.com")
        assert result == "Acme Corp"

    def test_domain_fallback_co_il(self):
        result = _extract_company("invoices@bezeq.co.il")
        assert result == "Bezeq"

    def test_free_email_returns_full_address(self):
        result = _extract_company("john.doe@gmail.com")
        assert result == "john.doe@gmail.com"

    def test_noreply_display_name_uses_domain(self):
        result = _extract_company("noreply <noreply@megastore.com>")
        assert result == "Megastore"

    def test_empty_sender(self):
        assert _extract_company("") != ""

    def test_none_like_sender(self):
        assert _extract_company("") == "\u05dc\u05d0 \u05d9\u05d3\u05d5\u05e2"

    def test_hebrew_display_name_preserved(self):
        result = _extract_company("חשמל ישראל <info@iec.co.il>")
        assert "חשמל" in result
        assert "ישראל" in result

    def test_multiple_senders_same_company_normalize(self):
        a = _extract_company("Acme Inc <sales@acme.com>")
        b = _extract_company("Acme Inc <billing@acme.com>")
        assert a == b

    def test_quoted_display_name(self):
        result = _extract_company('"My Company" <info@myco.com>')
        assert result == "My Company"
