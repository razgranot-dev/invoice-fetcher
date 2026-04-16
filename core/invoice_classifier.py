"""
Invoice/receipt classifier — production-grade, near-zero false positives.

Core principle: An email qualifies as an invoice/receipt ONLY if it represents
a completed or upcoming financial transaction where money was charged, is owed,
or was refunded. Everything else is NOT an invoice.

Architecture:
  1. EARLY DISQUALIFICATION — instant "not_invoice" for security/marketing/social
  2. Score positive signals (subject, body, amounts, attachments, sender)
  3. Apply remaining negative signals
  4. POSITIVE EVIDENCE GATE — require at least ONE hard signal to classify above not_invoice
  5. Determine tier

Tiers:
  - confirmed_invoice:        score >= 70 AND has hard evidence
  - likely_invoice:           score >= 40 AND has hard evidence
  - possible_financial_email: score >= 25 AND has hard evidence
  - not_invoice:              everything else
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
THRESHOLD_POSSIBLE = 25

# ══════════════════════════════════════════════════════════════════════════════
# EARLY DISQUALIFICATION — these patterns IMMEDIATELY classify as not_invoice.
# Checked before ANY positive scoring. Order: subject, then sender.
# ══════════════════════════════════════════════════════════════════════════════

# Subject patterns that can never be invoices — instant disqualification
_INSTANT_DISQUALIFY_SUBJECT: list[str] = [
    # Account & security
    "recovery email", "added you as a recovery",
    "verify your account", "verify your identity", "verify your email",
    "confirm your email", "confirm your identity",
    "security alert", "critical security alert", "security advisory",
    "\u05d4\u05ea\u05e8\u05d0\u05ea \u05d0\u05d1\u05d8\u05d7\u05d4",
    "sign-in attempt", "new sign-in", "suspicious sign-in", "unusual sign-in",
    "login attempt", "new login",
    "unusual activity", "suspicious activity",
    "password reset", "password changed",
    "two-factor", "2fa", "verification code",
    "account suspended", "account restricted", "account limitation",
    "account access", "account activity",
    # Device / Find My notifications
    "find my has been disabled", "has been disabled on",
    "find my iphone", "find my ipad", "find my mac",
    # Failed payments / billing problems — NOT receipts
    "billing problem", "payment problem",
    "was unsuccessful", "payment unsuccessful",
    "please update your payment", "update your payment method",
    "payment method declined", "card declined", "card was declined",
    "payment failed", "charge failed", "transaction failed",
    "past due", "overdue payment",
    # Marketing & newsletters
    "latest updates", "updates across", "this week in",
    "news from", "tips & tricks", "tips and tricks", "tips for",
    "blog post", "we thought you'd like", "check out our",
    "newsletter", "weekly digest", "monthly digest",
    "keep growing", "grow your",
    # Policy / legal updates
    "privacy policy", "terms of service", "terms of use",
    "we've updated our", "we have updated our",
    "user agreement", "policy update",
    # Ride-hailing non-receipts
    "your driver is arriving", "your driver is on the way",
    "rate your trip", "rate your ride",
    "how was your ride", "how was your trip",
    # General notifications
    "someone added you", "you've been mentioned", "mentioned you",
    "you have a new message", "new follower", "friend request",
    "people you may know", "tagged you",
    "commented on", "liked your", "someone liked", "someone commented",
    "someone replied",
    # Dev tools
    "[github]", "pull request", "merge request",
    "build failed", "build passed", "pushed to",
    "dependabot",
    # Service notifications
    "system maintenance", "scheduled maintenance",
    "incident report", "outage",
    # Onboarding / marketing (never invoices)
    "welcome to", "getting started", "you're all set",
    "complete your setup", "set up your", "welcome aboard",
    "onboarding", "get started with",
    # Subscription reminders (NOT yet charged — just warnings)
    "your subscription is expiring", "subscription is about to expire",
    "subscription expiring", "subscription ending",
    "your trial ends", "your trial is ending",
    "don't lose your", "don't lose access",
    # Survey / feedback
    "take our survey", "tell us what you think",
    "feedback request", "review your experience",
    # Social media
    "birthday", "memories", "on this day",
    "marketplace",
]

# Sender domains that NEVER send invoices — instant disqualification
_INSTANT_DISQUALIFY_SENDER: list[str] = [
    "notifications.github.com",
    "noreply.github.com",
    "accounts.google.com",
    "notifications.google.com",
    "gitlab.com",
    "bitbucket.org",
    "twitter.com", "x.com",
    "discord.com",
    "medium.com",
    "substack.com",
    "mailchimp.com",
]


# ══════════════════════════════════════════════════════════════════════════════
# VENDOR NON-INVOICE PATTERNS
# For high-volume senders that send BOTH invoices AND non-invoice emails.
# If subject matches, disqualify even if domain is in the positive list.
# ══════════════════════════════════════════════════════════════════════════════

_VENDOR_NON_INVOICE_SUBJECTS: list[tuple[str, list[str]]] = [
    # Google — security alerts, account notices, service updates
    # NOTE: "google workspace" and "google cloud" are NOT listed here because
    # billing receipts from payments.google.com legitimately contain those terms.
    ("google.com", [
        "security alert", "critical security", "sign-in attempt",
        "new sign-in", "recovery email", "password changed",
        "google one", "google ai", "gemini",
        "storage", "your plan",
        "account update", "verify your", "confirm your",
        "someone added you",
    ]),
    # Hostinger — onboarding, setup, marketing, newsletters
    ("hostinger.com", [
        "welcome to", "getting started", "onboarding", "setup",
        "tutorial", "tip:", "tips for", "tips and", "build your",
        "free domain", "launch your", "hosting plan", "upgrade",
        "renew your", "expires soon", "don't lose", "activate",
        "complete your", "latest updates", "updates across",
        "news", "blog", "what's new", "new feature",
        "check out", "introducing",
    ]),
    # OpenAI — subscription warnings, product updates, marketing
    ("openai.com", [
        "access will end", "will expire", "action required",
        "usage limit", "api usage", "rate limit",
        "plus access", "plan change", "product update",
        "new feature", "introducing", "get updates",
    ]),
    # PayPal — account alerts vs actual receipts
    ("paypal.com", [
        "security", "suspicious activity", "unusual activity",
        "verify your", "confirm your", "update your",
        "account limitation", "account restricted",
        "policy update", "user agreement",
    ]),
    # Apple / iCloud — account/security vs billing
    ("apple.com", [
        "apple id", "verify your", "sign-in",
        "security", "privacy", "two-factor",
        "icloud storage", "storage plan",
    ]),
    # Anthropic — product/API updates vs invoices
    ("anthropic.com", [
        "api update", "product update", "new feature",
        "usage limit", "rate limit", "model update",
        "safety update", "research update",
    ]),
    # Meta / Facebook / Instagram — social notifications vs ad billing
    ("facebookmail.com", [
        "someone commented", "someone liked", "someone replied",
        "new login", "login attempt", "confirm your identity",
        "security code", "update your info", "verify your",
        "birthday", "friend request", "people you may know",
        "new follower", "mentioned you", "tagged you",
        "memories", "on this day", "marketplace",
    ]),
    ("facebook.com", [
        "someone commented", "someone liked", "someone replied",
        "new login", "login attempt", "confirm your identity",
        "security code", "update your info", "verify your",
        "birthday", "friend request", "people you may know",
        "new follower", "mentioned you", "tagged you",
        "memories", "on this day", "marketplace",
    ]),
    ("meta.com", [
        "someone commented", "someone liked", "someone replied",
        "new login", "login attempt", "confirm your identity",
        "security code", "update your info", "verify your",
        "birthday", "friend request", "people you may know",
        "new follower", "mentioned you", "tagged you",
        "memories", "on this day", "marketplace",
    ]),
    ("instagram.com", [
        "new follower", "mentioned you", "tagged you",
        "someone commented", "someone liked",
        "login attempt", "security code",
    ]),
    # Microsoft / Azure
    ("microsoft.com", [
        "security alert", "unusual sign-in", "verify your",
        "account activity", "password changed", "password reset",
        "getting started", "welcome to",
    ]),
    # Amazon
    ("amazon.com", [
        "has been shipped", "out for delivery", "delivered",
        "track your package", "your driver",
        "review your purchase", "rate your",
    ]),
    # LinkedIn — Premium billing is OK, social is not
    ("linkedin.com", [
        "new connection", "people you may know",
        "who viewed your", "job recommendation",
        "new message from", "mentioned you",
        "endorsed you", "congratulate",
    ]),
    # Spotify
    ("spotify.com", [
        "discover weekly", "new releases", "your daily mix",
        "wrapped", "podcast", "what's new",
    ]),
    # Adobe
    ("adobe.com", [
        "getting started", "tips", "tutorial",
        "what's new", "creative cloud", "product update",
    ]),
    # Zoom
    ("zoom.us", [
        "meeting invitation", "meeting reminder",
        "recording available", "join meeting",
        "getting started", "what's new",
    ]),
    # Wix
    ("wix.com", [
        "getting started", "build your", "tips",
        "what's new", "new feature", "tutorial",
    ]),
    # Uber — ride notifications vs receipts
    ("uber.com", [
        "your driver is", "rate your", "how was your",
        "arriving now",
    ]),
    # Bolt — ride/delivery marketing vs trip/order receipts
    ("bolt.eu", [
        "your driver is", "rate your", "how was your",
        "free ride", "promo code", "invite friends",
    ]),
    # Wolt — food delivery marketing vs order receipts
    ("wolt.com", [
        "free delivery", "new restaurants", "order now",
        "your favorites", "promo code",
    ]),
    # DoorDash — delivery marketing vs order receipts
    ("doordash.com", [
        "dashpass", "free delivery", "order now",
        "craving", "promo code",
    ]),
    # Booking.com — travel marketing vs booking/stay receipts
    ("booking.com", [
        "deal of the day", "explore", "recommended for you",
        "save on your next", "homes you might like",
        "discover", "getaway deals", "travel deals",
    ]),
    # Airbnb — travel/experience marketing vs actual stay receipts
    ("airbnb.com", [
        "explore homes", "travel ideas", "experiences near",
        "get inspired", "recommended for you", "places to stay",
    ]),
    # Hotels.com — marketing vs stay receipts
    ("hotels.com", [
        "secret prices", "top deals", "members save",
        "recommended for you", "explore",
    ]),
    # Agoda — marketing vs stay receipts
    ("agoda.com", [
        "flash sale", "deal of the day", "recommended for you",
        "last-minute", "insider deals", "explore",
    ]),
    # AliExpress — heavy promotional marketing vs actual order receipts
    ("aliexpress.com", [
        "flash deal", "flash sale", "% off", "coupon",
        "recommended for you", "items you may like",
        "trending", "new arrivals", "wishlist",
        "sale ends", "last chance", "clearance",
        "top picks", "best seller", "back in stock",
    ]),
    # eBay — deal/browse marketing vs actual purchase receipts
    ("ebay.com", [
        "daily deals", "based on your", "items you might like",
        "saved search", "price drop", "similar items",
        "watching", "make an offer",
    ]),
    # Etsy — marketplace marketing vs purchase receipts
    ("etsy.com", [
        "shop the latest", "items you've been", "favorites for you",
        "has shipped", "is on the way",
    ]),
    # Temu — heavy promotional marketing vs actual order receipts
    ("temu.com", [
        "flash sale", "% off", "coupon", "free shipping",
        "recommended for you", "trending", "new arrivals",
        "last chance", "clearance", "top picks",
    ]),
    # Shein — marketing vs actual order receipts
    ("shein.com", [
        "flash sale", "% off", "coupon", "free shipping",
        "new arrivals", "trending", "sale ends",
        "recommended for you", "style picks",
    ]),
    # ── Hotel chains — loyalty program marketing vs actual stay receipts ──
    # These chains send heavy Honors/Bonvoy/Rewards marketing alongside
    # legitimate folio/checkout/tax receipts. Patterns below are phrases
    # that NEVER appear in receipt subjects.
    ("hilton.com", [
        "explore destinations", "discover new", "flash sale",
        "member exclusive rate", "earn double points", "earn bonus",
        "free night award", "redeem your points", "bonus offer",
    ]),
    ("marriott.com", [
        "explore destinations", "discover new", "flash sale",
        "member exclusive rate", "earn double points", "earn bonus",
        "free night award", "redeem your points", "bonus offer",
        "members save",
    ]),
    ("ihg.com", [
        "explore destinations", "discover new", "flash sale",
        "member exclusive rate", "earn double points", "earn bonus",
        "free night award", "redeem your points", "bonus offer",
    ]),
    ("hyatt.com", [
        "explore destinations", "discover new", "flash sale",
        "member exclusive rate", "earn double points", "earn bonus",
        "free night award", "redeem your points", "bonus offer",
    ]),
    ("accor.com", [
        "explore destinations", "discover new", "flash sale",
        "member exclusive", "earn bonus", "bonus offer",
        "redeem your points",
    ]),
    ("radissonhotels.com", [
        "explore destinations", "discover new", "flash sale",
        "member exclusive", "earn bonus", "bonus offer",
        "redeem your points",
    ]),
]


# ══════════════════════════════════════════════════════════════════════════════
# POSITIVE SIGNALS — scored if the email passes disqualification
# ══════════════════════════════════════════════════════════════════════════════

# Strong subject keywords — almost always indicate an invoice/receipt
_SUBJECT_STRONG: list[tuple[str, int]] = [
    # Hebrew
    ("חשבונית מס קבלה", 40),
    ("חשבונית מס", 35),
    ("חשבונית עסקה", 35),
    ("קבלה מס'", 35),
    ("אישור חיוב", 30),
    ("פירוט חיוב", 30),
    ("הודעת תשלום", 25),
    ("אישור הזמנה", 25),
    ("חשבון חודשי", 25),
    ("פירוט חשבון", 20),
    ("אישור תשלום", 30),
    ("קבלה מ", 25),
    ("חיוב בסך", 25),
    ("פירוט עסקה", 25),
    ("חשבון טלפון", 25),
    ("חשבון חשמל", 25),
    ("חשבון מים", 25),
    ("חשבון ארנונה", 25),
    # English — transaction-complete language
    ("your receipt from", 35),
    ("receipt for your payment", 30),
    ("receipt for your purchase", 30),
    ("you were charged", 30),
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
    ("you paid", 25),
    ("payment processed", 25),
    ("payment successful", 25),
    ("charge receipt", 30),
    ("transaction receipt", 30),
    ("transaction completed", 20),
    ("renewal confirmation", 25),
    ("renewal receipt", 30),
    ("subscription renewed", 25),
    ("has been renewed", 20),
    ("charge successful", 25),
    ("successfully charged", 25),
    ("you sent a payment", 25),
    ("your bill", 25),
    ("monthly bill", 25),
    ("billing summary", 25),
    # Travel / booking receipts
    ("booking confirmation", 25),
    ("reservation confirmation", 25),
    ("travel receipt", 30),
    # Ride-sharing receipts
    ("ride receipt", 30),
    ("trip receipt", 30),
    ("your ride with", 25),
    ("trip with uber", 30),
    ("trip with lyft", 30),
    # Food delivery / e-commerce order receipts
    ("your order from", 25),
    ("delivery receipt", 30),
    # Hotel / stay receipts
    ("your folio", 30),
    ("checkout receipt", 30),
    ("check-out receipt", 30),
    ("stay receipt", 30),
    ("your stay at", 25),
    ("hotel receipt", 30),
    ("hotel invoice", 30),
]

# Weak subject keywords — present in invoices but also in many other emails
_SUBJECT_WEAK: list[tuple[str, int]] = [
    ("חשבונית", 12),
    ("קבלה", 12),
    ("תשלום", 8),
    ("חיוב", 8),
    ("invoice", 12),
    ("receipt", 12),
    ("payment", 5),
    ("billing", 5),
    ("charged", 8),
    ("purchase", 5),
    ("transaction", 5),
    ("חשבון", 5),
]

# Body-level signals
_BODY_STRONG: list[tuple[str, int]] = [
    ("חשבונית מס קבלה", 25),
    ("חשבונית מס", 20),
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
    ("payment method", 12),
    ("credit card", 10),
    ("billing period", 12),
    ("billing address", 10),
    ("order total", 15),
    ("grand total", 15),
    ("אמצעי תשלום", 12),
    ("כרטיס אשראי", 12),
    ("תקופת חיוב", 12),
]

_BODY_WEAK: list[tuple[str, int]] = [
    ("סכום", 3),
    ("לתשלום", 3),
    ("total", 3),
    ("amount", 2),
    ("payment", 2),
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

# Domains known to send actual invoices/receipts.
# Max bonus is 10 — sender domain is a tiebreaker, not proof.
_INVOICE_SENDER_DOMAINS: dict[str, int] = {
    # Payment processors — highest confidence
    "payments.google.com": 10,
    "pay.google.com": 10,
    "stripe.com": 10,
    "braintree.com": 10,
    "paddle.com": 10,
    "receipts.uber.com": 10,
    # Major vendors — mild tiebreaker
    "apple.com": 5, "em.apple.com": 5,
    "anthropic.com": 5,
    "openai.com": 5,
    "facebookmail.com": 5, "facebook.com": 5, "meta.com": 5,
    "instagram.com": 5,
    "hostinger.com": 5, "mailer.hostinger.com": 5,
    "paypal.com": 5, "intl.paypal.com": 5, "paypal.co.il": 5,
    "amazon.com": 5, "amazon.co.il": 5,
    "aws.amazon.com": 5, "amazonaws.com": 5,
    "microsoft.com": 5, "azure.com": 5,
    "wix.com": 5,
    "spotify.com": 5,
    "netflix.com": 5,
    "adobe.com": 5,
    "linkedin.com": 5,
    "zoom.us": 5,
    "vercel.com": 5,
    "digitalocean.com": 5,
    "heroku.com": 5,
    "namecheap.com": 5,
    "godaddy.com": 5,
    "booking.com": 5,
    "airbnb.com": 5,
    "expedia.com": 5,
    "uber.com": 5,
    "lyft.com": 5,
    "wolt.com": 5,
    "bolt.eu": 5,
    "gett.com": 5,
    # Food delivery
    "tenbis.co.il": 5, "10bis.co.il": 5,
    "doordash.com": 5,
    "deliveroo.com": 5,
    "grubhub.com": 5,
    "cibus.co.il": 5,
    "shopify.com": 5,
    "squarespace.com": 5,
    "dropbox.com": 5,
    # Hotels / OTAs
    "hotels.com": 5,
    "agoda.com": 5,
    # Hotel chains
    "hilton.com": 5,
    "marriott.com": 5,
    "ihg.com": 5,
    "hyatt.com": 5,
    "accor.com": 5,
    "radissonhotels.com": 5,
    # E-commerce
    "aliexpress.com": 5,
    "ebay.com": 5,
    "etsy.com": 5,
    "temu.com": 5,
    "shein.com": 5,
    # Israeli telecom / utilities
    "partner.co.il": 5,
    "bezeq.co.il": 5,
    "cellcom.co.il": 5,
    "hot.net.il": 5,
    "pelephone.co.il": 5,
    "electric.co.il": 5,
}

# ── Negative signals (applied AFTER positive scoring) ──────────────────────

_NEGATIVE_SUBJECT: list[tuple[str, int]] = [
    # Subscription reminders (not yet charged)
    ("your plan", -25),
    ("plan update", -25),
    ("plan is", -20),
    ("storage is", -25),
    ("your access", -20),
    ("will end soon", -30),
    ("will expire", -25),
    ("expires soon", -25),
    ("expiring soon", -25),
    ("about to expire", -25),
    ("renew your", -20),
    ("activate your", -35),
    ("your trial", -35),
    ("upgrade your", -30),
    ("free trial", -30),
    # Marketing
    ("limited time", -35),
    ("special offer", -25),
    ("sale", -20),
    ("discount", -15),
    ("promo", -30),
    ("coupon", -20),
    ("webinar", -40),
    ("register now", -40),
    ("join us", -30),
    ("announcement", -25),
    ("introducing", -25),
    ("product update", -35),
    ("what's new", -35),
    ("new feature", -35),
    ("monthly update", -30),
    # Shipping (not financial)
    ("has been shipped", -15),
    ("out for delivery", -20),
    ("delivery update", -15),
    ("track your package", -20),
    ("tracking number", -10),
    # Account lifecycle
    ("your account has been", -20),
    ("account created", -25),
    ("your free", -25),
    # Failed / unsuccessful payments (NOT receipts)
    ("unsuccessful", -60),
    ("was unsuccessful", -60),
    ("payment failed", -60),
    ("charge failed", -60),
    ("billing problem", -60),
    ("payment problem", -60),
    ("please update your payment", -60),
    ("update your payment method", -60),
    ("card declined", -60),
    ("past due", -50),
    # Policy / legal
    ("privacy policy", -50),
    ("terms of service", -50),
    ("terms of use", -50),
    ("we've updated our", -50),
    ("we have updated our", -50),
    # Mild alerts
    ("alert:", -10),
    ("action required", -5),
    ("action needed", -5),
    ("important update", -5),
    ("service notification", -25),
    ("status update", -25),
    ("unsubscribe", -15),
    # Google-specific non-invoice (NOT "google cloud"/"google workspace" —
    # billing receipts from payments.google.com use those terms legitimately)
    ("google ai", -50),
    ("gemini advanced", -50),
    ("google one", -50),
    # Hebrew negative
    ("איפוס סיסמה", -50),
    ("אימות חשבון", -40),
    ("התראת אבטחה", -40),
    ("עדכון מוצר", -35),
    ("ניוזלטר", -40),
    ("עדכון שירות", -25),
    ("תחזוקה מתוכננת", -35),
    ("דרגו את", -30),
    ("משלוח", -15),
]

# Sender domains that rarely send invoices (penalty applied after scoring)
_NEGATIVE_SENDER_DOMAINS: dict[str, int] = {
    "github.com": -15,
    "googlecloud.com": -30,
    # google.com removed — payments.google.com is a legitimate invoice sender
    # and the blanket -15 penalizes it; specific google subdomains are already
    # handled by instant disqualify (accounts.google.com, notifications.google.com)
    "linkedin.com": -10,
    "sendgrid.net": -10,
    "intercom.io": -25,
}

# Body patterns that suggest non-invoice
_NEGATIVE_BODY: list[tuple[re.Pattern, int]] = [
    (re.compile(r'unsubscribe|הסרה\s*מרשימת\s*תפוצה|opt.out', re.IGNORECASE), -15),
    (re.compile(r'view\s+in\s+browser|צפה\s+בדפדפן', re.IGNORECASE), -10),
    (re.compile(r'forward\s+to\s+a\s+friend', re.IGNORECASE), -15),
    (re.compile(r'manage\s+(your\s+)?preferences', re.IGNORECASE), -10),
]


# ══════════════════════════════════════════════════════════════════════════════
# CORE CLASSIFIER
# ══════════════════════════════════════════════════════════════════════════════

def _body_has_billing_detail(body_html: str, body_text: str) -> bool:
    """Check if the email body contains meaningful billing/receipt details.

    Returns True only if the body has at least 2 of:
    - Amount/currency pattern
    - Date pattern
    - Invoice/receipt number
    - Line items / order details keywords
    """
    content = body_text or re.sub(r"<[^>]+>", " ", body_html)
    content_lower = content.lower()
    hits = 0

    for pat, _ in _AMOUNT_PATTERNS:
        if pat.search(content):
            hits += 1
            break

    if re.search(r'\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}', content):
        hits += 1
    elif re.search(r'(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}', content_lower):
        hits += 1

    for pat, _ in _INVOICE_NUMBER_PATTERNS:
        if pat.search(content):
            hits += 1
            break

    billing_keywords = [
        "subtotal", "total", "tax", "vat", "discount",
        "line item", "qty", "quantity", "unit price",
        "billing period", "billing address", "payment method",
        "order details", "order summary", "transaction id",
        'סה"כ', 'מע"מ', "סכום", "פירוט", "אמצעי תשלום",
    ]
    for kw in billing_keywords:
        if kw in content_lower:
            hits += 1
            break

    return hits >= 2


def is_screenshot_worthy(invoice: dict[str, Any]) -> tuple[bool, str]:
    """Determine if an invoice merits a screenshot for export.

    Confirmed and likely invoices ALWAYS get a screenshot — the classifier
    already validated they represent real transactions, so body-length
    or billing-detail checks should not block them.
    """
    tier = invoice.get("classification_tier", "")

    if not tier:
        return True, ""

    if tier == TIER_NOT:
        return False, "skipped: not an invoice"

    # confirmed, likely, AND possible all qualify for screenshots
    return True, ""


def classify_email(email_data: dict[str, Any]) -> dict[str, Any]:
    """Classify a single email with early disqualification and positive evidence gate.

    Returns dict with: classification_tier, classification_score, classification_signals
    """
    subject = (email_data.get("subject") or "").strip()
    sender = (email_data.get("sender") or "").strip()
    body_text = (email_data.get("body_text") or "").strip()
    body_html = (email_data.get("body_html") or "").strip()
    attachments = email_data.get("attachments") or []

    # Normalize smart/curly quotes to straight quotes for matching
    subject_lower = subject.lower().replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    sender_lower = sender.lower()
    body = body_text or re.sub(r'<[^>]+>', ' ', body_html)
    body_lower = body.lower()

    score = 0
    signals: list[dict[str, Any]] = []

    def _add(signal_name: str, points: int, detail: str = ""):
        nonlocal score
        score += points
        signals.append({"signal": signal_name, "score": points, "detail": detail})

    # Extract sender domain for use throughout
    sender_domain = ""
    domain_match = re.search(r'@([\w.-]+)', sender_lower)
    if domain_match:
        sender_domain = domain_match.group(1)

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 1: EARLY DISQUALIFICATION
    # ══════════════════════════════════════════════════════════════════════

    # 1a. Instant disqualification by subject
    for pattern in _INSTANT_DISQUALIFY_SUBJECT:
        if pattern.lower() in subject_lower:
            _add("instant_disqualify_subject", -200, pattern)
            return {
                "classification_tier": TIER_NOT,
                "classification_score": score,
                "classification_signals": signals,
            }

    # 1b. Instant disqualification by sender domain
    for domain in _INSTANT_DISQUALIFY_SENDER:
        if sender_domain == domain or sender_domain.endswith("." + domain):
            _add("instant_disqualify_sender", -200, domain)
            return {
                "classification_tier": TIER_NOT,
                "classification_score": score,
                "classification_signals": signals,
            }

    # 1c. Vendor-specific non-invoice patterns
    for vendor_domain, bad_subjects in _VENDOR_NON_INVOICE_SUBJECTS:
        if sender_domain == vendor_domain or sender_domain.endswith("." + vendor_domain):
            for bad_kw in bad_subjects:
                if bad_kw.lower() in subject_lower:
                    _add("vendor_non_invoice", -200, f"{vendor_domain}: {bad_kw}")
                    return {
                        "classification_tier": TIER_NOT,
                        "classification_score": score,
                        "classification_signals": signals,
                    }
            break  # only check one vendor

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 2: POSITIVE SIGNAL SCORING
    # Track "hard evidence" — at least ONE must be present to classify
    # above not_invoice.
    # Hard evidence = subject_strong, invoice keyword, amount, invoice number,
    #                 or invoice-named attachment.
    # ══════════════════════════════════════════════════════════════════════

    has_hard_evidence = False

    # 2a. Subject strong keywords
    for kw, pts in _SUBJECT_STRONG:
        if kw.lower() in subject_lower:
            _add("subject_strong", pts, kw)
            has_hard_evidence = True
            break

    # 2b. Subject weak keywords (if no strong match)
    if not any(s["signal"] == "subject_strong" for s in signals):
        for kw, pts in _SUBJECT_WEAK:
            if kw.lower() in subject_lower:
                _add("subject_weak", pts, kw)
                # "invoice" and "receipt" in subject count as hard evidence
                if kw.lower() in ("invoice", "receipt", "חשבונית", "קבלה"):
                    has_hard_evidence = True
                break

    # 2c. Body strong keywords
    body_strong_hits = 0
    for kw, pts in _BODY_STRONG:
        if kw.lower() in body_lower:
            if body_strong_hits < 2:
                _add("body_strong", pts, kw)
            body_strong_hits += 1

    # 2d. Body weak keywords
    if body_strong_hits == 0:
        body_weak_hits = 0
        for kw, pts in _BODY_WEAK:
            if kw.lower() in body_lower:
                if body_weak_hits < 2:
                    _add("body_weak", pts, kw)
                body_weak_hits += 1

    # 2e. Currency / amount patterns — this is hard evidence
    amount_found = False
    for pat, pts in _AMOUNT_PATTERNS:
        if pat.search(body):
            _add("amount_pattern", pts, pat.pattern[:40])
            amount_found = True
            has_hard_evidence = True
            break

    # 2f. Invoice/receipt number patterns — this is hard evidence
    for pat, pts in _INVOICE_NUMBER_PATTERNS:
        m = pat.search(body)
        if m:
            _add("invoice_number", pts, m.group(0)[:40])
            has_hard_evidence = True
            break

    # 2g. Attachment signals
    has_pdf = False
    for att in attachments:
        fname = (att.get("filename") or "").lower()
        ctype = (att.get("content_type") or "").lower()

        if "pdf" in ctype or fname.endswith(".pdf"):
            has_pdf = True
            for pat, pts in _ATTACHMENT_INVOICE_NAMES:
                if pat.search(fname):
                    _add("attachment_invoice_name", pts, fname[:50])
                    has_hard_evidence = True
                    break
            else:
                _add("attachment_pdf", 10, fname[:50])
            break

    # Penalty: weak signals without attachment
    if not has_pdf and not attachments:
        if score > 0 and score < 30 and body_strong_hits == 0:
            _add("no_attachment_weak_signals", -10, "weak signals without attachment")

    # 2h. Sender domain reputation (tiebreaker only)
    for domain, pts in _INVOICE_SENDER_DOMAINS.items():
        if sender_domain == domain or sender_domain.endswith("." + domain):
            _add("sender_invoice_domain", pts, domain)
            break

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 3: NEGATIVE SIGNAL ADJUSTMENTS
    # ══════════════════════════════════════════════════════════════════════

    # 3a. Negative sender domains
    for domain, pts in _NEGATIVE_SENDER_DOMAINS.items():
        if sender_domain == domain or sender_domain.endswith("." + domain):
            _add("sender_negative_domain", pts, domain)
            break

    # 3b. Negative subject signals (up to 2 hits)
    neg_subject_hits = 0
    for kw, pts in _NEGATIVE_SUBJECT:
        if kw.lower() in subject_lower:
            _add("subject_negative", pts, kw)
            neg_subject_hits += 1
            if neg_subject_hits >= 2:
                break

    # 3c. Negative body signals
    for pat, pts in _NEGATIVE_BODY:
        if pat.search(body):
            _add("body_negative", pts, pat.pattern[:40])
            break

    # ══════════════════════════════════════════════════════════════════════
    # PHASE 4: POSITIVE EVIDENCE GATE + TIER DETERMINATION
    # Even if score passes a threshold, demote to not_invoice if there
    # is no hard evidence of a financial transaction.
    # ══════════════════════════════════════════════════════════════════════

    if not has_hard_evidence:
        _add("no_hard_evidence", 0, "no invoice keyword, amount, or invoice attachment found")
        return {
            "classification_tier": TIER_NOT,
            "classification_score": score,
            "classification_signals": signals,
        }

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
    """Classify a list of email results in-place."""
    for r in results:
        classification = classify_email(r)
        r.update(classification)
    return results


def format_signal_breakdown(signals: list[dict]) -> str:
    """Format classification signals into a readable string."""
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
        TIER_CONFIRMED: "\u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea \u05de\u05d0\u05d5\u05de\u05ea\u05ea",
        TIER_LIKELY: "\u05db\u05e0\u05e8\u05d0\u05d4 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea",
        TIER_POSSIBLE: "\u05de\u05d9\u05d9\u05dc \u05e4\u05d9\u05e0\u05e0\u05e1\u05d9 \u05dc\u05d1\u05d3\u05d9\u05e7\u05d4",
        TIER_NOT: "\u05dc\u05d0 \u05d7\u05e9\u05d1\u05d5\u05e0\u05d9\u05ea",
    }.get(tier, tier)


def tier_emoji(tier: str) -> str:
    """Return a text indicator for the tier."""
    return {
        TIER_CONFIRMED: "[+++]",
        TIER_LIKELY: "[++]",
        TIER_POSSIBLE: "[+]",
        TIER_NOT: "[-]",
    }.get(tier, "")
