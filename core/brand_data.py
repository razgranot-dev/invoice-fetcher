"""Shared brand/alias data loader.

The SINGLE SOURCE OF TRUTH for brand data (noise words, compound TLDs,
business suffixes, alias groups, Gmail brand-anchor tokens) lives in
``web/src/lib/brand-data.json`` — the TS web app imports it at build time and
the Python worker loads it here by path.

For deploys where ``web/`` is not on disk (the worker image ships only
``worker/`` + ``core/``), a frozen fallback snapshot below keeps the worker
functional. Parity between the fallback and the JSON is enforced by
``tests/test_brand_data.py`` — if you change the JSON, that test tells you to
update the snapshot here (a test failure, not a silent drift).
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

BRAND_DATA_PATH = (
    Path(__file__).resolve().parent.parent / "web" / "src" / "lib" / "brand-data.json"
)

# Frozen snapshot of the JSON fields the Python worker consumes. Kept in sync
# with web/src/lib/brand-data.json by tests/test_brand_data.py.
_FALLBACK: dict[str, Any] = {
    "noiseWords": [
        "info", "billing", "invoices", "invoice", "mail", "email", "e-mail",
        "noreply", "no-reply", "donotreply", "support", "help", "contact",
        "notifications", "notification", "notify", "alerts", "alert",
        "accounts", "account", "payments", "payment", "orders", "order",
        "receipts", "receipt", "reciept", "reciepts", "service", "services", "mailer", "news",
        "newsletter", "updates", "www", "smtp", "mx", "bounce", "postmaster",
        "bonvoy", "honors",
        "קבלה", "קבלות", "לקוחות", "חשבוניות",
    ],
    "compoundTlds": [
        "co.il", "co.uk", "co.jp", "co.kr", "co.in", "co.za", "co.nz",
        "com.au", "com.br", "com.mx", "com.ar", "com.tw", "com.sg",
        "org.uk", "org.il", "net.il", "ac.il", "ac.uk", "gov.il",
    ],
    "businessSuffixes": [
        "inc", "llc", "ltd", "pbc", "gmbh", "sa", "bv", "pvt", "pte",
        "corp", "co", "limited", "international", "ag", "ab", "holdings",
        "technologies", "platforms",
        'בע"מ', "בעמ", 'ע"ר', 'חל"צ',
    ],
    "queryBrandTokens": [
        "stripe", "apple", "openai", "anthropic", "vercel", "render",
        "hostinger", "shopify", "canva", "higgsfield", "wix", "squarespace",
        "notion", "linkedin", "microsoft", "adobe", "spotify", "netflix",
        "zoom", "namecheap", "godaddy", "digitalocean", "heroku", "dropbox",
        "google", "amazon", "facebookmail",
        "uber", "lyft", "gett", "bolt", "wolt", "doordash", "booking",
        "airbnb", "expedia", "agoda",
        "aliexpress", "ebay", "etsy", "temu",
        "cibus", "tenbis", "cellcom", "bezeq", "partner", "pelephone",
        "hot.net.il", "greeninvoice", "icount",
    ],
}


@lru_cache(maxsize=1)
def _data() -> dict[str, Any]:
    try:
        with open(BRAND_DATA_PATH, encoding="utf-8") as f:
            loaded = json.load(f)
        if not isinstance(loaded, dict):
            raise ValueError("brand-data.json root is not an object")
        return loaded
    except (OSError, ValueError) as e:
        _log.warning(
            "brand-data.json unavailable at %s (%s) — using frozen fallback",
            BRAND_DATA_PATH, e,
        )
        return _FALLBACK


def _list(key: str) -> list[str]:
    value = _data().get(key)
    if isinstance(value, list) and value:
        return [str(v) for v in value]
    return list(_FALLBACK[key])


def noise_words() -> list[str]:
    """Noise sender/subdomain words shared with the web brand pipeline."""
    return _list("noiseWords")


def compound_tlds() -> list[str]:
    """Compound TLDs that must be stripped as a unit (paypal.co.il → paypal)."""
    return _list("compoundTlds")


def business_suffixes() -> list[str]:
    """Legal/business suffix tokens stripped from merchant names (EN + HE)."""
    return _list("businessSuffixes")


def query_brand_tokens() -> list[str]:
    """Known-vendor `from:` brand anchors for the Gmail discovery query."""
    return _list("queryBrandTokens")
