"""
חילוץ סכומים ותיאורים מתוכן אימייל — regex-based עם רמות ביטחון.
"""

import re
from typing import Any


# ── Amount patterns (ordered by specificity) ───────────────────────────────
_PATTERNS: list[tuple[str, str, str]] = [
    # ₪XX.XX or ₪XX,XXX.XX
    (r"₪\s?([\d,]+\.?\d*)", "ILS", "high"),
    # XX.XX ₪
    (r"([\d,]+\.?\d*)\s?₪", "ILS", "high"),
    # XX.XX ש"ח / שקל
    (r'([\d,]+\.?\d*)\s?(?:ש"ח|שקל)', "ILS", "high"),
    # $XX.XX or XX.XX$
    (r"\$\s?([\d,]+\.?\d*)", "USD", "high"),
    (r"([\d,]+\.?\d*)\s?\$", "USD", "high"),
    # Labeled: סכום/סה"כ/לתשלום/Total/Amount Due: XX.XX
    (r'(?:סכום|סה"כ|לתשלום|total|amount\s*due|sum)\s*:?\s*([\d,]+\.?\d*)', "ILS", "medium"),
]

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
    """
    if not text:
        return {"amount": None, "currency": "ILS", "confidence": "low", "raw_match": ""}

    found: list[tuple[float, str, str, str]] = []  # (value, currency, confidence, raw)

    for pattern, currency, confidence in _PATTERNS:
        for match in re.finditer(pattern, text, re.IGNORECASE):
            raw_num = match.group(1) if match.lastindex else match.group(0)
            try:
                value = _parse_number(raw_num)
                if value > 0:
                    found.append((value, currency, confidence, match.group(0)))
            except (ValueError, IndexError):
                continue

    if not found:
        return {"amount": None, "currency": "ILS", "confidence": "low", "raw_match": ""}

    # Take the largest amount (likely the total)
    best = max(found, key=lambda x: x[0])
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
