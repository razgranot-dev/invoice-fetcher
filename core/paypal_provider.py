"""PayPal provider adapter — detection, intent classification, and structured
extraction for PayPal receipts / payment confirmations / invoices.

Why this module exists
----------------------
PayPal is a payment *processor*: a single sender (service@paypal.com) covers
dozens of real merchants, ships HTML-only bodies with no PDF attachment, and
uses short, highly localized subjects ("You sent $X to Y", "הקבלה שלך",
"פרטי העסקה"). The generic keyword pipeline missed these because:

  • Discovery: the slim Gmail query (2026-05-22) matches subject word-tokens.
    Hebrew prefixed forms ("הקבלה" ≠ token "קבלה") and amount-only subjects
    ("Transaction details") were only reachable via `category:purchases`,
    which Gmail does not reliably assign to PayPal — so they were never
    fetched. See `discovery_query_tokens()` for the fix (a `from:paypal`
    anchor catches ALL PayPal mail regardless of subject/locale).

  • Classification: genuine PayPal receipts with sparse subjects landed in
    `possible` / `not_invoice` and were excluded from the report.

Keeping all PayPal-specific knowledge here (one bounded module of pure
functions) means the rest of the pipeline stays generic — gmail_connector
and invoice_classifier each call into this adapter at a single, clear seam
rather than scattering PayPal keyword hacks across the codebase.

Everything here is side-effect free and unit-testable in isolation.
"""

from __future__ import annotations

import re
from typing import Any

# ── Document types ──────────────────────────────────────────────────────────
DOC_RECEIPT = "receipt"
DOC_INVOICE = "invoice"
DOC_PAYMENT = "payment_confirmation"

# ── Sender identity ─────────────────────────────────────────────────────────
# Domains PayPal actually sends transactional mail from. Kept here as the
# single source of truth; gmail_connector + invoice_classifier read from it.
PAYPAL_SENDER_DOMAINS: tuple[str, ...] = (
    "paypal.com",
    "intl.paypal.com",
    "mail.paypal.com",
    "e.paypal.com",
    "paypal.co.il",
    "paypal.co.uk",
    "paypal.de",
    "paypal.fr",
)


def is_paypal_sender(sender: str | None) -> bool:
    """True if the From header is a PayPal *address* (any locale / subdomain).

    Matches on the email address only — NOT the display name — so a spoofed
    "PayPal <attacker@evil.com>" is not treated as PayPal. (Discovery may still
    over-fetch such mail via `from:paypal`; classification then decides, and
    is never a security boundary.) The address must end in a known paypal.*
    domain or contain a "paypal" label in the domain.
    """
    if not sender:
        return False
    s = sender.lower()
    m = re.search(r"@([\w.-]+)", s)
    domain = m.group(1) if m else ""
    if not domain:
        return False
    for d in PAYPAL_SENDER_DOMAINS:
        if domain == d or domain.endswith("." + d):
            return True
    # Soft net: a "paypal" label inside the sending domain (e.g. a new
    # paypal regional TLD we haven't enumerated). Domain-scoped, so display
    # names and unrelated TLDs like paypalobjects.com's CDN can't spoof in.
    return any(part == "paypal" for part in domain.split("."))


# ── Subject intent patterns ─────────────────────────────────────────────────
# Substring-matched against a lowercased subject (so Hebrew prefixed forms
# like "הקבלה" match "קבלה"). These mark an email as a real PayPal money
# movement: a payment the user made, a receipt, an invoice, or a subscription.
_TXN_SUBJECT_PATTERNS: tuple[str, ...] = (
    # English — payment made / receipt / invoice / subscription
    "you paid", "you sent a payment", "you sent", "you made a payment",
    "receipt for your payment", "receipt for payment", "your paypal receipt",
    "your receipt", "payment sent", "payment received", "payment to",
    "payment confirmation", "you've paid", "money sent",
    "transaction details", "transaction confirmation", "transaction receipt",
    "order confirmation", "automatic payment", "subscription payment",
    "recurring payment", "preapproved payment", "billing agreement",
    "invoice from", "invoice #", "donation",
    # Hebrew — bare keywords; substring match absorbs ה/ל/ב/מ prefixes
    "שלחת תשלום", "ביצעת תשלום", "שילמת", "תשלום אוטומטי", "תשלום חוזר",
    "קבלה", "אישור תשלום", "אישור עסקה", "פרטי העסקה", "פרטי עסקה",
    "התשלום ששלחת", "חשבונית", "הוראת קבע", "תשלום מראש",
)

# Subjects that look transactional-ish but are NOT money movements (or are
# money flowing the WRONG way / failed) — these must never be boosted. The
# classifier's own _VENDOR_NON_INVOICE_SUBJECTS already disqualifies many of
# these; we keep a parallel guard so the provider is correct on its own and
# usable independently of the classifier. Failure/refund phrasing is matched
# generously because a substring blocklist is the last line of defence before
# the +35 boost (see classify_intent).
_NON_TXN_SUBJECT_PATTERNS: tuple[str, ...] = (
    # Security / account
    "security", "suspicious", "unusual activity", "unusual sign", "log in",
    "logged in", "login", "sign-in", "sign in", "verify your", "confirm your",
    "update your", "account limitation", "account limited", "account restricted",
    "policy update", "user agreement", "password", "two-factor", "2fa",
    "verification code", "we noticed", "action required", "we're holding",
    # Failed / declined / reversed — NOT a receipt
    "declined", "was declined", "payment failed", "failed", "unsuccessful",
    "couldn't process", "could not process", "could not be completed",
    "couldn't complete", "unable to", "we couldn't", "we were unable",
    "on hold", "problem with your", "issue with your",
    # Refunds / reversals — money back to the user, not a payable invoice/receipt
    "refund", "refunded", "reversed", "reversal", "money request",
    "requested money", "requests money", "chargeback", "dispute",
    # Statements / summaries (not an invoice)
    "statement is ready", "monthly statement", "your statement",
    # Marketing
    "off your next", "cashback", "earn ", "introducing", "new way to pay",
    "special offer", "limited time", "promo", "% off", "save on",
    # Hebrew non-txn
    "התראת אבטחה", "פעילות חשודה", "אימות", "סיסמה", "כניסה לחשבון",
    "עדכן את", "אמת את", "הצעה", "מבצע", "נכשל", "נדחה", "נדחתה",
    "בוטל", "בוטלה", "החזר כספי", "הוחזר", "בקשת תשלום", "לא הושלם",
)


def is_non_transactional_subject(subject: str | None) -> bool:
    """True for PayPal security / marketing / account subjects (never a receipt)."""
    s = (subject or "").lower()
    return any(p in s for p in _NON_TXN_SUBJECT_PATTERNS)


def is_transactional_subject(subject: str | None) -> bool:
    """True if the subject names a real PayPal money movement."""
    s = (subject or "").lower()
    if is_non_transactional_subject(s):
        return False
    return any(p in s for p in _TXN_SUBJECT_PATTERNS)


# ── Structured extraction patterns ──────────────────────────────────────────
# PayPal transaction IDs: 17-char uppercase alphanumeric (e.g. 8AB12345CD678901E).
_TXN_ID_LABELLED = re.compile(
    r"(?:transaction\s*id|transaction\s*number|מספר\s*עסקה|מזהה\s*עסקה)\s*[:#]?\s*([A-Z0-9]{10,20})",
    re.IGNORECASE,
)
_TXN_ID_BARE = re.compile(r"\b([0-9A-Z]{17})\b")
_INVOICE_ID = re.compile(
    r"(?:invoice\s*(?:id|number|#)|מספר\s*חשבונית)\s*[:#]?\s*([A-Za-z0-9\-]{3,})",
    re.IGNORECASE,
)
_RECEIPT_NO = re.compile(
    r"(?:receipt\s*(?:no\.?|number|#)|מספר\s*קבלה)\s*[:#]?\s*([A-Za-z0-9\-]{3,})",
    re.IGNORECASE,
)
_RECEIPT_URL = re.compile(
    r"https?://(?:www\.)?paypal\.[\w.]+/[^\s\"'<>]*", re.IGNORECASE
)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_STATUS = re.compile(
    r"\b(completed|pending|refunded|reversed|on hold|cleared)\b|"
    r"(הושלם|ממתין|הוחזר|בהמתנה)",
    re.IGNORECASE,
)

# Largest body we will run regex over. Mirrors invoice_classifier's
# _BODY_REGEX_BUDGET — defence against hostile/huge HTML bodies blowing the
# serverless timeout (receipt signals always sit near the top).
_BODY_BUDGET = 60_000

# Amount + currency. Ordered: symbol-prefixed, code-suffixed, symbol-suffixed.
# Digit runs are BOUNDED ({1,15}) — an unbounded `[\d,]+` followed by an
# optional group is a classic super-linear-backtracking trap on adversarial
# input (measured at multiple seconds on 20k-char digit strings).
_CUR_SYMBOL = {"$": "USD", "₪": "ILS", "€": "EUR", "£": "GBP"}
_DIGITS = r"\d{1,3}(?:,\d{3})*|\d{1,15}"
_AMOUNT_PATTERNS: tuple[tuple[re.Pattern, str | None], ...] = (
    # US$29.00 / $29.00 USD / $29.00
    (re.compile(rf"(?:US)?\$\s?((?:{_DIGITS})\.\d{{2}})\s*(USD|CAD|AUD)?", re.IGNORECASE), "USD"),
    (re.compile(rf"₪\s?((?:{_DIGITS})\.\d{{2}})"), "ILS"),
    (re.compile(rf"((?:{_DIGITS})\.\d{{2}})\s?₪"), "ILS"),
    (re.compile(rf'((?:{_DIGITS})\.\d{{2}})\s?(?:ש"ח|שקל)'), "ILS"),
    (re.compile(rf"€\s?((?:{_DIGITS})\.\d{{2}})"), "EUR"),
    (re.compile(rf"£\s?((?:{_DIGITS})\.\d{{2}})"), "GBP"),
    # 29.00 USD / 29.00 ILS (code suffix, no symbol)
    (re.compile(rf"((?:{_DIGITS})\.\d{{2}})\s?(USD|ILS|EUR|GBP|CAD|AUD)\b", re.IGNORECASE), None),
)

# Merchant from subject. PayPal subject grammar (EN + HE). The amount may sit
# between the verb and "to" ("sent a payment of $29.00 USD to Shopify"), so the
# `sent ... to` form skips intervening tokens, and any leading amount captured
# by the "you paid" form is stripped in _clean_merchant().
_MERCHANT_SUBJECT = (
    re.compile(r"receipt\s+for\s+your\s+payment\s+to\s+(.+)$", re.IGNORECASE),
    re.compile(r"(?:payment\s+to|paid\s+to|sent\b[^,\n]*?\bto)\s+(.+)$", re.IGNORECASE),
    re.compile(r"(?:invoice|bill|refund)\s+from\s+(.+)$", re.IGNORECASE),
    re.compile(r"you\s+paid\s+(.+)$", re.IGNORECASE),
    # Hebrew: "ל-MERCHANT" (to) or "מ-MERCHANT" (from). REQUIRE the hyphen/maqaf
    # preposition form and a preceding boundary so we don't match the bare 'ל'
    # *inside* a verb like "שילמת" (paid). Anchored to end-of-subject.
    re.compile(r"(?:^|\s)[למ][-־]\s*([^\n,]+)$"),
)
# Merchant from body, e.g. "You sent $29.00 USD to Shopify International Limited."
# or "You received a refund from Acme Studios." Terminators use word boundaries
# so "for"/"on" don't match inside words (e.g. the "on" in "Internati-on-al").
_MERCHANT_BODY = (
    re.compile(r"(?:\bto\b|\bfrom\b|\bpaid\b)\s+([A-Z][\w&.,'\- ]{1,60}?)(?:\.|\n|\bfor\b|\bon\b|$)"),
    # Hebrew "ל-MERCHANT" / "מ-MERCHANT" — same anti-verb guard as the subject.
    re.compile(r"(?:^|\s)[למ][-־]\s*([^\n.,]{2,60})"),
)
_BIZ_SUFFIX = re.compile(
    r"\s*(?:,?\s*(?:international|inc\.?|ltd\.?|llc\.?|gmbh|limited|"
    r"s\.?a\.?|b\.?v\.?|pte\.?|pvt\.?|ab|co\.?))\s*$",
    re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")
_BIDI_RE = re.compile(r"[‎‏‪-‮⁦-⁩]")


def _strip_html(html: str) -> str:
    return _TAG_RE.sub(" ", html)


def _clean_merchant(name: str) -> str:
    name = _BIDI_RE.sub("", name).strip().strip("\"'.,-־ ")
    # Drop a leading amount accidentally captured ("$29.00 USD to X" → "X")
    name = re.sub(r"^(?:US)?[$₪€£]?\s?[\d,]+\.\d{2}\s*(?:USD|ILS|EUR|GBP|CAD|AUD)?\s*(?:to|ל[-־]?)?\s*",
                  "", name, flags=re.IGNORECASE).strip()
    # Strip trailing business suffixes repeatedly: "Shopify International
    # Limited" → "Shopify".
    prev = None
    while prev != name:
        prev = name
        name = _BIZ_SUFFIX.sub("", name).strip().strip(",")
    return name


def _extract_amount(text: str) -> tuple[float | None, str | None, str]:
    """Return (amount, currency, raw_match) — the largest match wins (= total)."""
    best: tuple[float, str, str] | None = None
    for pat, default_cur in _AMOUNT_PATTERNS:
        for m in pat.finditer(text):
            raw_num = m.group(1)
            try:
                val = float(raw_num.replace(",", ""))
            except ValueError:
                continue
            if val <= 0:
                continue
            cur = default_cur
            if cur is None and m.lastindex and m.lastindex >= 2 and m.group(2):
                cur = m.group(2).upper()
            cur = cur or "USD"
            if best is None or val > best[0]:
                best = (val, cur, m.group(0).strip())
    if best is None:
        return None, None, ""
    return best[0], best[1], best[2]


def extract_paypal(email_data: dict[str, Any]) -> dict[str, Any]:
    """Extract structured PayPal transaction data from a parsed email dict.

    Input keys used: subject, sender, body_text, body_html, date, uid, threadId.
    Returns a dict with as many of these as could be found:
      merchant, merchant_email, transaction_date, amount, currency,
      transaction_id, invoice_id, receipt_number, status, description,
      receipt_url, doc_type, gmail_message_id, gmail_thread_id.
    Missing fields are None / "".
    """
    subject = (email_data.get("subject") or "").strip()
    sender = (email_data.get("sender") or "").strip()
    body_text = email_data.get("body_text") or ""
    body_html = email_data.get("body_html") or ""
    # Cap body BEFORE any regex — receipt signals sit near the top; this bounds
    # regex runtime on hostile/huge bodies (see _BODY_BUDGET).
    body_text = body_text[:_BODY_BUDGET]
    body_html = body_html[:_BODY_BUDGET]
    body = body_text if body_text.strip() else _strip_html(body_html)
    body = _BIDI_RE.sub("", body)
    subject_clean = _BIDI_RE.sub("", subject)

    amount, currency, _raw = _extract_amount(f"{subject_clean}\n{body}")

    # Transaction ID — labelled first, then a bare 17-char token.
    txn_id = None
    m = _TXN_ID_LABELLED.search(body) or _TXN_ID_LABELLED.search(subject_clean)
    if m:
        txn_id = m.group(1).upper()
    else:
        bare = _TXN_ID_BARE.search(body)
        if bare:
            txn_id = bare.group(1)

    invoice_id = None
    mi = _INVOICE_ID.search(body) or _INVOICE_ID.search(subject_clean)
    if mi:
        invoice_id = mi.group(1)

    receipt_no = None
    mr = _RECEIPT_NO.search(body)
    if mr:
        receipt_no = mr.group(1)

    receipt_url = None
    mu = _RECEIPT_URL.search(body_html or body)
    if mu:
        receipt_url = mu.group(0)

    status = None
    ms = _STATUS.search(body)
    if ms:
        status = next((g for g in ms.groups() if g), None)

    # Merchant — subject grammar first (most reliable), then body.
    merchant = None
    for pat in _MERCHANT_SUBJECT:
        ms2 = pat.search(subject_clean)
        if ms2:
            cand = _clean_merchant(ms2.group(1))
            if cand and not re.fullmatch(r"[\d,.\s$₪€£A-Z]{0,8}", cand):
                merchant = cand
                break
    if not merchant:
        for pat in _MERCHANT_BODY:
            mb = pat.search(body)
            if mb:
                cand = _clean_merchant(mb.group(1))
                if cand and len(cand) >= 2 and "paypal" not in cand.lower():
                    merchant = cand
                    break

    # Merchant email — first non-PayPal address in the body.
    merchant_email = None
    for em in _EMAIL.finditer(body):
        addr = em.group(0)
        if "paypal" not in addr.lower():
            merchant_email = addr
            break

    # Document type.
    s_low = subject_clean.lower()
    b_low = body.lower()
    if "invoice" in s_low or "חשבונית" in s_low or "invoice" in b_low[:2000]:
        doc_type = DOC_INVOICE
    elif ("receipt" in s_low or "קבלה" in s_low or receipt_no
          or "receipt" in b_low[:2000]):
        doc_type = DOC_RECEIPT
    else:
        doc_type = DOC_PAYMENT

    return {
        "merchant": merchant,
        "merchant_email": merchant_email,
        "transaction_date": (email_data.get("date") or "").strip() or None,
        "amount": amount,
        "currency": currency,
        "transaction_id": txn_id,
        "invoice_id": invoice_id,
        "receipt_number": receipt_no,
        "status": status,
        "description": subject_clean or None,
        "receipt_url": receipt_url,
        "doc_type": doc_type,
        "gmail_message_id": email_data.get("uid") or None,
        "gmail_thread_id": email_data.get("threadId") or None,
    }


def dedup_key(extracted: dict[str, Any]) -> str:
    """Stable dedup key for a PayPal transaction.

    Prefers the PayPal transaction ID. Falls back to a composite of
    gmail_message_id + merchant + date + amount + currency so two unrelated
    PayPal emails never collide and the same email never duplicates.
    """
    txn = extracted.get("transaction_id")
    if txn:
        return f"paypal:txn:{txn}"
    # PayPal invoices / money-requests have no transaction ID but DO have a
    # stable invoice ID — prefer it before the collision-prone composite.
    inv = extracted.get("invoice_id")
    if inv:
        return f"paypal:inv:{inv}"
    parts = [
        str(extracted.get("gmail_message_id") or ""),
        (extracted.get("merchant") or "").lower(),
        str(extracted.get("transaction_date") or "")[:10],
        f"{extracted.get('amount')}",
        (extracted.get("currency") or "").upper(),
    ]
    return "paypal:fallback:" + "|".join(parts)


def classify_intent(email_data: dict[str, Any]) -> dict[str, Any] | None:
    """Decide whether a PayPal email is a financially-relevant transaction.

    Returns None for non-PayPal senders or non-transactional PayPal mail
    (security, marketing, login, password, failed/declined payments).
    Otherwise returns {"is_transaction": True, "doc_type": ...}.
    """
    sender = email_data.get("sender")
    if not is_paypal_sender(sender):
        return None

    subject = email_data.get("subject") or ""
    if is_non_transactional_subject(subject):
        return None

    body_text = (email_data.get("body_text") or "")[:_BODY_BUDGET]
    body_html = (email_data.get("body_html") or "")[:_BODY_BUDGET]
    body = body_text if body_text.strip() else _strip_html(body_html)
    body = _BIDI_RE.sub("", body)

    # A reversal/refund/failure status in the body means this is not a payable
    # receipt/invoice even if the subject looked transactional — withhold the
    # boost (the email can still be persisted for review via generic scoring).
    ms = _STATUS.search(body)
    if ms:
        status = (next((g for g in ms.groups() if g), "") or "").lower()
        if status in ("refunded", "reversed", "on hold", "הוחזר", "ממתין", "בהמתנה"):
            return None

    # Signal 1: subject explicitly names a money movement.
    if is_transactional_subject(subject):
        ex = extract_paypal(email_data)
        return {"is_transaction": True, "doc_type": ex["doc_type"]}

    # Signal 2: amount + LABELLED transaction evidence in body — covers opaque
    # subjects ("PayPal", "Transaction details") that still carry a genuine
    # receipt body. We deliberately require *labelled* evidence (a "Transaction
    # ID:" line, receipt number, or paypal receipt URL) rather than a bare
    # 17-char token — order numbers, tracking IDs, and asset hashes are also
    # 17 chars and would otherwise let marketing/failed-payment mail through.
    amount, _cur, _raw = _extract_amount(body)
    has_labelled_evidence = bool(
        _TXN_ID_LABELLED.search(body)
        or _RECEIPT_NO.search(body)
        or _RECEIPT_URL.search(body_html or body)
    )
    if amount and has_labelled_evidence:
        ex = extract_paypal(email_data)
        return {"is_transaction": True, "doc_type": ex["doc_type"]}

    return None


def discovery_query_tokens() -> list[str]:
    """Gmail `from:` tokens that guarantee ALL PayPal mail is fetched.

    A single `from:paypal` clause matches the "PayPal" display name AND every
    paypal.* domain regardless of subject or locale — the robust fix for the
    discovery gap that dropped localized/opaque-subject PayPal receipts.
    """
    return ["paypal"]
