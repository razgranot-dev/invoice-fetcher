"""
חילוץ סכומים ותיאורים מתוכן אימייל — regex-based עם רמות ביטחון.
"""

import re
from typing import Any


# ── Symbol/currency patterns (unlabeled, high confidence) ──────────────────
_SYMBOL_PATTERNS: list[tuple[str, str, str]] = [
    # ₪XX.XX or ₪XX,XXX.XX
    (r"₪\s?([\d,]+\.?\d*)", "ILS", "high"),
    # XX.XX ₪
    (r"([\d,]+\.?\d*)\s?₪", "ILS", "high"),
    # XX.XX ש"ח / שקל
    (r'([\d,]+\.?\d*)\s?(?:ש"ח|שקל)', "ILS", "high"),
    # $XX.XX or XX.XX$
    (r"\$\s?([\d,]+\.?\d*)", "USD", "high"),
    (r"([\d,]+\.?\d*)\s?\$", "USD", "high"),
    # €XX.XX or XX.XX€
    (r"€\s?([\d,]+\.?\d*)", "EUR", "high"),
    (r"([\d,]+\.?\d*)\s?€", "EUR", "high"),
    # £XX.XX or XX.XX£
    (r"£\s?([\d,]+\.?\d*)", "GBP", "high"),
    (r"([\d,]+\.?\d*)\s?£", "GBP", "high"),
    # ISO codes: EUR 12.99 / 12.99 EUR (also GBP, USD)
    (r"\bEUR\b\s?([\d,]+\.?\d*)", "EUR", "high"),
    (r"([\d,]+\.?\d*)\s?\bEUR\b", "EUR", "high"),
    (r"\bGBP\b\s?([\d,]+\.?\d*)", "GBP", "high"),
    (r"([\d,]+\.?\d*)\s?\bGBP\b", "GBP", "high"),
    (r"\bUSD\b\s?([\d,]+\.?\d*)", "USD", "high"),
    (r"([\d,]+\.?\d*)\s?\bUSD\b", "USD", "high"),
]

# ── Labeled patterns (total/amount due/סכום/סה"כ/לתשלום/sum) ────────────────
_LABEL = r'(?:סכום|סה"כ|לתשלום|שולם|לחיוב|total|amount\s*due|amount\s*paid|you\s*paid|paid|sum)'
_SYMBOL_TO_CURRENCY = {"₪": "ILS", "$": "USD", "€": "EUR", "£": "GBP"}
# Label followed by a currency symbol → that symbol's currency, high confidence.
_LABELED_WITH_SYMBOL = re.compile(
    _LABEL + r'\s*:?\s*([₪$€£])\s*([\d,]+\.?\d*)', re.IGNORECASE
)
# Label with no symbol → ILS, medium confidence. Require a decimal part so bare
# integers ("Total items: 2026") are not mistaken for amounts.
_LABELED_NO_SYMBOL = re.compile(
    _LABEL + r'\s*:?\s*([\d,]+\.\d{1,2})', re.IGNORECASE
)

# Ranking of confidence levels — used to break ties on equal amounts.
_CONFIDENCE_RANK = {"high": 2, "medium": 1, "low": 0}

# ── Subject cleaning patterns ──────────────────────────────────────────────
_SUBJECT_PREFIXES = re.compile(
    r"^(?:Re|Fwd|FW|השב|העבר)\s*:\s*", re.IGNORECASE
)


def _parse_number(raw: str) -> float:
    """Parse a number string, removing commas."""
    return float(raw.replace(",", ""))


def extract_amount(text: str) -> dict[str, Any]:
    """Extract the primary monetary amount from email text.

    Returns dict with: amount (float|None), currency (str), confidence (str),
    raw_match (str).

    Selection: a labeled amount (after total/סה"כ/לתשלום…) wins outright — this
    is the charged amount even when a larger number (a discount, an item count,
    a marketing "save $X") appears elsewhere. Only when no labeled amount exists
    do we fall back to the largest currency-symbol match.
    """
    if not text:
        return {"amount": None, "currency": "ILS", "confidence": "low", "raw_match": ""}

    # (value, currency, confidence, raw, labeled)
    found: list[tuple[float, str, str, str, bool]] = []

    for pattern, currency, confidence in _SYMBOL_PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            try:
                value = _parse_number(match.group(1))
            except (ValueError, IndexError):
                continue
            if value > 0:
                found.append((value, currency, confidence, match.group(0), False))

    for match in _LABELED_WITH_SYMBOL.finditer(text):
        currency = _SYMBOL_TO_CURRENCY[match.group(1)]
        try:
            value = _parse_number(match.group(2))
        except ValueError:
            continue
        if value > 0:
            found.append((value, currency, "high", match.group(0), True))

    for match in _LABELED_NO_SYMBOL.finditer(text):
        try:
            value = _parse_number(match.group(1))
        except ValueError:
            continue
        if value > 0:
            found.append((value, "ILS", "medium", match.group(0), True))

    if not found:
        return {"amount": None, "currency": "ILS", "confidence": "low", "raw_match": ""}

    labeled = [f for f in found if f[4]]
    # The amount is the largest labeled value when any label is present, else the
    # largest overall. Among all matches sharing that value, keep the most
    # confident one (a symbol match confirms and upgrades a labeled amount).
    target = max(f[0] for f in (labeled or found))
    candidates = [f for f in found if f[0] == target]
    best = max(candidates, key=lambda x: _CONFIDENCE_RANK.get(x[2], 0))
    return {
        "amount": best[0],
        "currency": best[1],
        "confidence": best[2],
        "raw_match": best[3],
    }


def extract_description(subject: str, sender: str) -> str:
    """Extract a clean description from subject line, fallback to sender name.

    Removes Re:/Fwd:/השב:/העבר: prefixes. Falls back to sender display name
    if subject is empty.
    """
    cleaned = _SUBJECT_PREFIXES.sub("", subject).strip()
    if cleaned:
        return cleaned

    if not sender:
        return ""

    # Extract display name from "Name <email>" format
    name_match = re.match(r"^(.+?)\s*<", sender)
    if name_match:
        return name_match.group(1).strip().strip('"')

    return sender.strip()


def enrich_results(results: list[dict]) -> list[dict]:
    """Enrich scan results with extracted amounts and descriptions.

    Adds to each result dict: amount, currency, description, confidence, raw_match.
    Does NOT mutate the originals — returns new dicts.
    """
    enriched = []
    for r in results:
        text = r.get("body_text", "") or r.get("body_html", "") or ""
        amount_info = extract_amount(text)
        description = extract_description(r.get("subject", ""), r.get("sender", ""))

        enriched.append({
            **r,
            "amount": amount_info["amount"],
            "currency": amount_info["currency"],
            "description": description,
            "confidence": amount_info["confidence"],
            "raw_match": amount_info["raw_match"],
        })
    return enriched
