"""Diagnostic: does the Gmail search query actually DISCOVER PayPal emails?

build_query() (rewritten 2026-05-22) dropped the enumerated sender-domain list
in favour of category:purchases + subject/from keyword clauses. This simulates
Gmail's matching for realistic PayPal subjects/senders to show which PayPal
emails would only be found via category:purchases (unreliable for PayPal) and
which would be MISSED entirely.

Gmail tokenization (approx): subject:/from: match whole word-tokens,
case-insensitive. We cannot simulate category:purchases offline, so we flag
emails whose ONLY possible match is category:purchases as "fragile".

Run: .venv/Scripts/python.exe scripts/diagnostics/diag_paypal_discovery.py
"""
from __future__ import annotations
import os, re, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from core.gmail_connector import GmailConnector

gc = GmailConnector()
query = gc.build_query(keywords=[], days_back=90, unread_only=False)
print("QUERY:\n", query, "\n")
print("len:", len(query), "\n")

# Extract clause tokens from the query
subject_tokens = [t.strip("()") for t in re.findall(r"subject:(\S+)", query)]
from_tokens = [t.strip("()") for t in re.findall(r"from:(\S+)", query)]
has_purchases = "category:purchases" in query
print("subject: tokens =", subject_tokens)
print("from: tokens     =", from_tokens)
print("category:purchases present =", has_purchases, "\n")

def tokenize(s: str) -> set[str]:
    # crude word tokenization mirroring Gmail (split on non-alnum, keep hebrew)
    return set(re.findall(r"[\w֐-׿]+", s.lower()))

def matches_subject(subject: str) -> list[str]:
    toks = tokenize(subject)
    return [t for t in subject_tokens if t.lower() in toks]

def matches_from(sender: str) -> list[str]:
    # from: matches tokens in the whole From header (display name + address)
    toks = tokenize(sender)
    return [t for t in from_tokens if t.lower() in toks]

# Realistic PayPal emails actually seen in mailboxes (EN + HE locales).
PAYPAL_EMAILS = [
    ("PayPal <service@paypal.com>", "Receipt for your payment to Shopify"),
    ("PayPal <service@paypal.com>", "You sent a payment of $29.00 USD to Shopify"),
    ("PayPal <service@paypal.com>", "You paid $29.00 USD to Shopify"),
    ("PayPal <service@paypal.com>", "You sent $29.00 USD to John Smith"),  # P2P, no 'payment'
    ("PayPal <service@paypal.com>", "Transaction details"),                # bare
    ("PayPal <service@paypal.com>", "Your automatic payment to Spotify"),
    ("PayPal <service@paypal.com>", "Your preapproved payment to Adobe"),
    ("PayPal <service@intl.paypal.com>", "Receipt for your payment"),
    ("PayPal <member@paypal.com>", "You've got a money request reminder"),
    ("PayPal <paypal@mail.paypal.com>", "שלחת תשלום של ‎49.90 ₪‎ ל-Apple"),   # HE 'sent payment'
    ("PayPal <service@paypal.com>", "הקבלה שלך"),                            # HE 'your receipt'
    ("PayPal <service@paypal.com>", "אישור עסקה"),                           # HE 'transaction confirmation'
    ("PayPal <service@paypal.com>", "ביצעת תשלום ל-Wix"),                    # HE 'you made a payment'
    ("PayPal <service@paypal.com>", "פרטי העסקה שלך"),                       # HE 'your transaction details'
]

print("=" * 96)
print(f"{'SENDER':<34}{'SUBJECT':<40}{'MATCH?':<22}")
print("=" * 96)
fragile, missed = [], []
for sender, subject in PAYPAL_EMAILS:
    sm = matches_subject(subject)
    fm = matches_from(sender)
    direct = sm or fm
    if direct:
        status = "subject:" + ",".join(sm) if sm else ""
        if fm:
            status += (" from:" + ",".join(fm))
    else:
        status = "ONLY category:purchases" if has_purchases else "*** MISSED ***"
        (fragile if has_purchases else missed).append((sender, subject))
    print(f"{sender:<34}{subject[:38]:<40}{status:<22}")
print("=" * 96)
print(f"Directly matched by subject/from: {len(PAYPAL_EMAILS) - len(fragile) - len(missed)}")
print(f"Fragile (depend ONLY on category:purchases, unreliable for PayPal): {len(fragile)}")
for s, sub in fragile:
    print(f"   - {sub}  <{s}>")
print(f"Missed entirely: {len(missed)}")
for s, sub in missed:
    print(f"   - {sub}  <{s}>")
