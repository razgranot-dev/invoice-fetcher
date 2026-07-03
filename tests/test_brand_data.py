"""M28/S2 — core.brand_data loads the shared web/src/lib/brand-data.json and
its frozen deploy fallback cannot drift from the JSON (parity is enforced
here instead of by 'MUST stay in sync' comments)."""

from __future__ import annotations

import json

import pytest

from core import brand_data
from core.brand_data import BRAND_DATA_PATH, _FALLBACK


def test_shared_json_exists_and_loads():
    assert BRAND_DATA_PATH.is_file(), f"missing shared brand data at {BRAND_DATA_PATH}"
    with open(BRAND_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    for key in ("noiseWords", "compoundTlds", "businessSuffixes",
                "aliasGroups", "displayNames", "queryBrandTokens"):
        assert key in data, f"brand-data.json missing key: {key}"


@pytest.mark.parametrize("key", ["noiseWords", "compoundTlds",
                                 "businessSuffixes", "queryBrandTokens"])
def test_fallback_matches_json(key: str):
    """The deploy fallback (used when web/ is absent) must equal the JSON —
    if you edit brand-data.json, update core/brand_data.py's snapshot."""
    with open(BRAND_DATA_PATH, encoding="utf-8") as f:
        data = json.load(f)
    assert _FALLBACK[key] == data[key], (
        f"core.brand_data._FALLBACK[{key!r}] drifted from brand-data.json"
    )


def test_accessors_return_expected_content():
    assert "invoice" in brand_data.noise_words()
    assert "קבלה" in brand_data.noise_words()
    assert "co.il" in brand_data.compound_tlds()
    assert "inc" in brand_data.business_suffixes()
    assert 'בע"מ' in brand_data.business_suffixes()
    # The Gmail query builder asserts on these anchors.
    for tok in ("stripe", "apple", "openai", "anthropic", "higgsfield", "bezeq"):
        assert tok in brand_data.query_brand_tokens()


def test_paypal_provider_suffix_regex_uses_shared_data():
    """The merchant cleaner strips the shared suffix list (EN + HE) but never
    eats letters INSIDE a word (Monaco keeps its 'co')."""
    from core import paypal_provider as pp

    assert pp._clean_merchant("Shopify International Limited") == "Shopify"
    assert pp._clean_merchant("Some Company Ltd.") == "Some Company"
    assert pp._clean_merchant("Acme S.A.") == "Acme"
    assert pp._clean_merchant('אקמי בע"מ') == "אקמי"
    assert pp._clean_merchant("Monaco") == "Monaco"
    assert pp._clean_merchant("Legit Brandco") == "Legit Brandco"


def test_gmail_connector_brand_tokens_come_from_shared_data():
    from core.gmail_connector import GmailConnector

    assert GmailConnector._QUERY_BRAND_FROM_TOKENS == brand_data.query_brand_tokens()
