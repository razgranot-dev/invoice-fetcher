"""
סיווג חשבוניות — מודל ניקוד רב-אותות עם שקיפות מלאה.

Classifies emails into tiers:
  - confirmed_invoice:       score >= 70
  - likely_invoice:          score >= 40
  - possible_financial_email: score >= 15
  - not_invoice:             score < 15

Every signal adds or subtracts from the score, and a breakdown is recorded
per email so the user (or developer) can see exactly why it matched.
"""

import re
from typing import Any

# ── Classification tiers ─────────────────────────────────────────────────────

TIER_CONFIRMED = "confirmed_invoice"
TIER_LIKELY = "likely_invoice"
TIER_POSSIBLE = "possible_financial_email"
TIER_NOT = "not_invoice"

THRESHOLD_CONFIRMED = 70
THRESHOLD_LIKELY = 40
THRESHOLD_POSSIBLE = 15

# ── Positive signals (Hebrew + English) ──────────────────────────────────────

# Strong subject keywords — these almost always indicate an invoice/receipt
_SUBJECT_STRONG: list[tuple[str, int]] = [
    # Hebrew
    ("חשבונית מס", 35),
    ("חשבונית מס קבלה", 40),
    ("חשבונית עסקה", 35),
    ("קבלה מס'", 35),
    ("אישור חיוב", 30),
    ("פירוט חיוב", 30),
    ("הודעת תשלום", 25),
    ("אישור הזמנה", 25),
    ("חשבון חודשי", 25),
    ("פירוט חשבון", 20),
    # English
    ("your receipt from", 35),
    ("invoice from", 30),
    ("invoice #", 35),
    ("invoice number", 30),
    ("receipt #", 35),
    ("receipt number", 30),
    ("billing statement", 30),
    ("payment confirmation", 30),
    ("payment received", 25),
    ("order confirmation", 25),
    ("subscription receipt", 30),
    ("tax invoice", 35),
    ("your order", 20),
    ("you paid", 25),
    ("payment to", 20),
]

# Weak subject keywords — present in invoices but also in many other emails
_SUBJECT_WEAK: list[tuple[str, int]] = [
    ("חשבונית", 15),
    ("קבלה", 15),
    ("תשלום", 10),
    ("חיוב", 10),
    ("invoice", 15),
    ("receipt", 15),
    ("payment", 8),
    ("billing", 8),
]

# Body-level signals — weaker than subject but still meaningful
_BODY_STRONG: list[tuple[str, int]] = [
    ("חשבונית מס", 20),
    ("חשבונית מס קבלה", 25),
    ("מספר חשבונית", 20),
    ("מספר קבלה", 20),
    ('סה"כ לתשלום', 20),
    ("סכום לתשלום", 18),
    ('מע"מ', 15),
    ("tax invoice", 20),
    ("invoice number", 18),
    ("receipt number", 18),
    ("amount due", 15),
    ("total amount", 15),
    ("subtotal", 12),
    ("vat", 12),
]

_BODY_WEAK: list[tuple[str, int]] = [
    ("סכום", 5),
    ("לתשלום", 5),
    ("total", 5),
    ("amount", 3),
    ("payment", 3),
]

# ── Currency / amount patterns ───────────────────────────────────────────────

_AMOUNT_PATTERNS = [
    (re.compile(r'₪\s?[\d,]+\.?\d{0,2}'), 15),
    (re.compile(r'[\d,]+\.?\d{0,2}\s?₪'), 15),
    (re.compile(r'[\d,]+\.?\d{0,2}\s?ש"ח'), 15),
    (re.compile(r'\$\s?[\d,]+\.?\d{0,2}'), 12),
    (re.compile(r'[\d,]+\.?\d{0,2}\s?\$'), 12),
    (re.compile(r'€\s?[\d,]+\.?\d{0,2}'), 12),
    (re.compile(r'(?:USD|ILS|EUR|GBP)\s?[\d,]+\.?\d{0,2}', re.IGNORECASE), 10),
]

# Invoice/receipt number patterns
_INVOICE_NUMBER_PATTERNS = [
    (re.compile(r'(?:invoice|inv|receipt|rcpt)\s*#?\s*:?\s*\d{3,}', re.IGNORECASE), 20),
    (re.compile(r'(?:חשבונית|קבלה)\s*(?:מס[\'.]?\s*)?:?\s*\d{3,}'), 20),
    (re.compile(r'(?:order|הזמנה)\s*#?\s*:?\s*[A-Z0-9]{5,}', re.IGNORECASE), 15),
    (re.compile(r'(?:transaction|עסקה)\s*(?:id|מספר)?\s*:?\s*[A-Z0-9]{6,}', re.IGNORECASE), 12),
]

# ── Attachment signals ───────────────────────────────────────────────────────

_ATTACHMENT_INVOICE_NAMES = [
    (re.compile(r'(?:invoice|receipt|tax.?invoice|חשבונית|קבלה|חשבון)', re.IGNORECASE), 40),
    (re.compile(r'(?:order.?summary|הזמנה|פירוט)', re.IGNORECASE), 25),
    (re.compile(r'(?:billing|statement|פירוט.?חשבון)', re.IGNORECASE), 20),
]

# ── Sender reputation ───────────────────────────────────────────────────────

# Domains known to send actual invoices/receipts
_INVOICE_SENDER_DOMAINS: dict[str, int] = {
    "apple.com": 20, "em.apple.com": 20,
    "anthropic.com": 20,
    "openai.com": 20,
    "payments.google.com": 25,
    "pay.google.com": 25,
    "hostinger.com": 20, "mailer.hostinger.com": 20,
    "paypal.com": 20, "intl.paypal.com": 20, "paypal.co.il": 20,
    "amazon.com": 15, "amazon.co.il": 15,
    "microsoft.com": 12,
    "wix.com": 15,
    "spotify.com": 15,
    "netflix.com": 15,
    "vercel.com": 15,
    "digitalocean.com": 15,
    "heroku.com": 15,
    "namecheap.com": 15,
    "godaddy.com": 15,
    "stripe.com": 20,
    "braintree.com": 20,
    "paddle.com": 20,
}

# ── Negative signals (false positive suppressors) ────────────────────────────

# Subject patterns that STRONGLY indicate non-invoice emails
_NEGATIVE_SUBJECT: list[tuple[str, int]] = [
    # GitHub / dev tools — strong negatives
    ("security alert", -40),
    ("security advisory", -40),
    ("dependabot", -50),
    ("github", -40),
    ("[github]", -50),
    ("pull request", -50),
    ("merge request", -50),
    ("build failed", -50),
    ("build passed", -50),
    ("ci/cd", -50),
    ("pipeline", -40),
    ("deploy", -30),
    ("repository", -40),
    ("commit", -40),
    ("pushed to", -50),
    ("workflow", -40),
    # Google / subscription notifications (NOT invoices)
    ("google ai", -40),
    ("gemini advanced", -40),
    ("google one", -30),
    ("your plan", -25),
    ("plan update", -30),
    ("welcome to", -35),
    ("getting started", -35),
    ("activate your", -30),
    ("your trial", -30),
    ("upgrade your", -25),
    ("you're all set", -35),
    # Newsletters / marketing
    ("newsletter", -40),
    ("unsubscribe", -15),
    ("weekly digest", -40),
    ("monthly update", -30),
    ("product update", -35),
    ("what's new", -35),
    ("new feature", -35),
    ("introducing", -25),
    ("announcement", -25),
    ("webinar", -40),
    ("register now", -40),
    ("join us", -30),
    ("free trial", -30),
    ("limited time", -35),
    ("special offer", -25),
    ("sale", -20),
    ("discount", -15),
    ("promo", -30),
    ("coupon", -20),
    # Account alerts
    ("password reset", -50),
    ("password changed", -50),
    ("verify your email", -50),
    ("confirm your email", -50),
    ("sign-in", -40),
    ("login attempt", -50),
    ("new sign-in", -40),
    ("two-factor", -50),
    ("2fa", -50),
    ("verification code", -50),
    ("account suspended", -30),
    ("account update", -25),
    ("account activity", -25),
    # Social / notifications
    ("commented on", -50),
    ("mentioned you", -50),
    ("shared a", -40),
    ("invited you", -35),
    ("new follower", -50),
    ("liked your", -50),
    # Hebrew negative
    ("איפוס סיסמה", -50),
    ("אימות חשבון", -40),
    ("התראת אבטחה", -40),
    ("עדכון מוצר", -35),
    ("ניוזלטר", -40),
]

# Sender domains/patterns that rarely send invoices
_NEGATIVE_SENDER_DOMAINS: dict[str, int] = {
    # Dev tools — strong negatives
    "github.com": -40,
    "noreply.github.com": -50,
    "notifications.github.com": -50,
    "gitlab.com": -35,
    "bitbucket.org": -35,
    # Google non-invoice senders
    "notifications.google.com": -30,
    "accounts.google.com": -40,
    "googleplay.google.com": -20,
    # Social / comms
    "linkedin.com": -30,
    "facebook.com": -30,
    "facebookmail.com": -30,
    "twitter.com": -30,
    "x.com": -30,
    "slack.com": -25,
    "discord.com": -30,
    # Tools / SaaS notifications (not billing)
    "notion.so": -25,
    "figma.com": -25,
    "medium.com": -30,
    "substack.com": -35,
    "mailchimp.com": -35,
    "sendgrid.net": -10,
    "hubspot.com": -30,
    "intercom.io": -25,
    "atlassian.com": -25,
    "jira.com": -25,
}

# Body patterns that suggest non-invoice
_NEGATIVE_BODY: list[tuple[str, int]] = [
    (re.compile(r'unsubscribe|הסרה\s*מרשימת\s*תפוצה|opt.out', re.IGNORECASE), -15),
    (re.compile(r'view\s+in\s+browser|צפה\s+בדפדפן', re.IGNORECASE), -10),
    (re.compile(r'forward\s+to\s+a\s+friend', re.IGNORECASE), -15),
    (re.compile(r'manage\s+(your\s+)?preferences', re.IGNORECASE), -10),
]


# ── Core classifier ──────────────────────────────────────────────────────────

def classify_email(email_data: dict[str, Any]) -> dict[str, Any]:
    """Classify a single email and return enriched data with classification.

    Args:
        email_data: dict with keys: subject, sender, body_text, body_html, attachments

    Returns:
        dict with added keys:
            classification_tier: str (TIER_CONFIRMED / TIER_LIKELY / TIER_POSSIBLE / TIER_NOT)
            classification_score: int
            classification_signals: list[dict]  — each with {signal, score, detail}
    """
    subject = (email_data.get("subject") or "").strip()
    sender = (email_data.get("sender") or "").strip()
    body_text = (email_data.get("body_text") or "").strip()
    body_html = (email_data.get("body_html") or "").strip()
    attachments = email_data.get("attachments") or []

    subject_lower = subject.lower()
    sender_lower = sender.lower()
    # Use body_text if available, otherwise strip HTML tags for matching
    body = body_text or re.sub(r'<[^>]+>', ' ', body_html)
    body_lower = body.lower()

    score = 0
    signals: list[dict[str, Any]] = []

    def _add(signal_name: str, points: int, detail: str = ""):
        nonlocal score
        score += points
        signals.append({"signal": signal_name, "score": points, "detail": detail})

    # ── 1. Subject strong keywords ───────────────────────────────────
    for kw, pts in _SUBJECT_STRONG:
        if kw.lower() in subject_lower:
            _add("subject_strong", pts, kw)
            break  # take the strongest match only

    # ── 2. Subject weak keywords (if no strong match found) ──────────
    if not any(s["signal"] == "subject_strong" for s in signals):
        for kw, pts in _SUBJECT_WEAK:
            if kw.lower() in subject_lower:
                _add("subject_weak", pts, kw)
                break

    # ── 3. Body strong keywords ──────────────────────────────────────
    body_strong_hits = 0
    for kw, pts in _BODY_STRONG:
        if kw.lower() in body_lower:
            if body_strong_hits < 2:  # cap at 2 body keyword bonuses
                _add("body_strong", pts, kw)
            body_strong_hits += 1

    # ── 4. Body weak keywords ────────────────────────────────────────
    if body_strong_hits == 0:
        body_weak_hits = 0
        for kw, pts in _BODY_WEAK:
            if kw.lower() in body_lower:
                if body_weak_hits < 2:
                    _add("body_weak", pts, kw)
                body_weak_hits += 1

    # ── 5. Currency / amount patterns ────────────────────────────────
    amount_found = False
    for pat, pts in _AMOUNT_PATTERNS:
        if pat.search(body):
            _add("amount_pattern", pts, pat.pattern[:40])
            amount_found = True
            break

    # ── 6. Invoice/receipt number patterns ───────────────────────────
    for pat, pts in _INVOICE_NUMBER_PATTERNS:
        m = pat.search(body)
        if m:
            _add("invoice_number", pts, m.group(0)[:40])
            break

    # ── 7. Attachment signals ────────────────────────────────────────
    has_pdf = False
    for att in attachments:
        fname = (att.get("filename") or "").lower()
        ctype = (att.get("content_type") or "").lower()

        if "pdf" in ctype or fname.endswith(".pdf"):
            has_pdf = True
            # Check if PDF filename indicates an invoice
            for pat, pts in _ATTACHMENT_INVOICE_NAMES:
                if pat.search(fname):
                    _add("attachment_invoice_name", pts, fname[:50])
                    break
            else:
                # Generic PDF — still a mild positive signal
                _add("attachment_pdf", 10, fname[:50])
            break  # only count first PDF

    # Bonus: if no attachment and only weak signals, penalize
    if not has_pdf and not attachments:
        if score > 0 and score < 30 and body_strong_hits == 0:
            _add("no_attachment_weak_signals", -10, "weak signals without attachment")

    # ── 8. Sender domain reputation ──────────────────────────────────
    sender_domain = ""
    domain_match = re.search(r'@([\w.-]+)', sender_lower)
    if domain_match:
        sender_domain = domain_match.group(1)

    # Check positive sender domains
    for domain, pts in _INVOICE_SENDER_DOMAINS.items():
        if sender_domain == domain or sender_domain.endswith("." + domain):
            _add("sender_invoice_domain", pts, domain)
            break

    # Check negative sender domains
    for domain, pts in _NEGATIVE_SENDER_DOMAINS.items():
        if sender_domain == domain or sender_domain.endswith("." + domain):
            _add("sender_negative_domain", pts, domain)
            break

    # ── 9. Negative subject signals (allow up to 2 hits) ──────────────
    neg_subject_hits = 0
    for kw, pts in _NEGATIVE_SUBJECT:
        if kw.lower() in subject_lower:
            _add("subject_negative", pts, kw)
            neg_subject_hits += 1
            if neg_subject_hits >= 2:
                break

    # ── 10. Negative body signals ────────────────────────────────────
    for pat, pts in _NEGATIVE_BODY:
        if pat.search(body):
            _add("body_negative", pts, pat.pattern[:40])
            break

    # ── Determine tier ───────────────────────────────────────────────
    if score >= THRESHOLD_CONFIRMED:
        tier = TIER_CONFIRMED
    elif score >= THRESHOLD_LIKELY:
        tier = TIER_LIKELY
    elif score >= THRESHOLD_POSSIBLE:
        tier = TIER_POSSIBLE
    else:
        tier = TIER_NOT

    return {
        "classification_tier": tier,
        "classification_score": score,
        "classification_signals": signals,
    }


def classify_results(results: list[dict]) -> list[dict]:
    """Classify a list of email results in-place, adding classification fields.

    Returns the same list with each dict enriched with:
        classification_tier, classification_score, classification_signals
    """
    for r in results:
        classification = classify_email(r)
        r.update(classification)
    return results


def format_signal_breakdown(signals: list[dict]) -> str:
    """Format classification signals into a readable string for logging/display."""
    if not signals:
        return "no signals"
    parts = []
    for s in signals:
        sign = "+" if s["score"] >= 0 else ""
        detail = f" ({s['detail']})" if s.get("detail") else ""
        parts.append(f"{s['signal']}: {sign}{s['score']}{detail}")
    return " | ".join(parts)


def tier_display_name(tier: str) -> str:
    """Return a Hebrew display name for a classification tier."""
    return {
        TIER_CONFIRMED: "\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05de\u05ea\u05ea",     # חשבונית מאומתת
        TIER_LIKELY: "\u05db\u05e0\u05e8\u05d0\u05d4 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea",               # כנראה חשבונית
        TIER_POSSIBLE: "\u05d0\u05d5\u05dc\u05d9 \u05e4\u05d9\u05e0\u05e0\u05e1\u05d9",                          # אולי פיננסי
        TIER_NOT: "\u05dc\u05d0 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea",                                     # לא חשבונית
    }.get(tier, tier)


def tier_emoji(tier: str) -> str:
    """Return a color indicator for the tier (no actual emoji — just a text marker)."""
    return {
        TIER_CONFIRMED: "[+++]",
        TIER_LIKELY: "[++]",
        TIER_POSSIBLE: "[+]",
        TIER_NOT: "[-]",
    }.get(tier, "")
