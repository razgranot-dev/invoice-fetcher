"""Drill into ONE pathological Bolt email and time every step of classify_email
to pinpoint which regex/operation explodes."""

import json
import os
import sys
import time
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
creds_blob = json.loads(CREDS_PATH.read_text())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
os.environ.setdefault("GOOGLE_CLIENT_ID", creds_blob["client_id"])
os.environ.setdefault("GOOGLE_CLIENT_SECRET", creds_blob["client_secret"])

from core.gmail_connector import GmailConnector

worker_creds_dict = {
    "token": creds_blob["access_token"],
    "refresh_token": creds_blob["refresh_token"],
    "client_id": creds_blob["client_id"],
    "client_secret": creds_blob["client_secret"],
    "token_uri": "https://oauth2.googleapis.com/token",
    "expiry": creds_blob["token_expiry"].rstrip("Z").split(".")[0],
}

connector = GmailConnector()
ok, _ = connector.build_service_from_json(json.dumps(worker_creds_dict))
assert ok

# Find a Bolt Thailand email
print("Searching for Bolt Thailand emails...")
ids = connector.list_message_ids(keywords=[], days_back=30, unread_only=False)
print(f"  found {len(ids)} candidates")

msgs = []
for i in range(0, len(ids), 50):
    msgs.extend(connector.get_messages_batch(ids[i:i+50]))

bolt_msgs = []
for m in msgs:
    if m is None: continue
    try:
        p = connector.parse_message(m)
        if "bolt.eu" in (p.get("sender") or "").lower():
            bolt_msgs.append(p)
    except Exception:
        pass

print(f"  {len(bolt_msgs)} Bolt emails found")
if not bolt_msgs:
    sys.exit(0)

from core.invoice_classifier import classify_email as _classify_em
print("\nTiming each Bolt message:")
slowest = None
for b in bolt_msgs:
    t = time.perf_counter()
    _classify_em(b)
    dur = (time.perf_counter() - t) * 1000
    print(f"  {dur:8.1f}ms  body_text={len(b.get('body_text') or '')} body_html={len(b.get('body_html') or '')}  {b.get('sender','')[:40]} | {b.get('subject','')[:60]}")
    if slowest is None or dur > slowest[0]:
        slowest = (dur, b)
bolt = slowest[1]
print(f"\nFocus on slowest ({slowest[0]:.1f}ms):")
print(f"Subject: {bolt.get('subject')!r}")
print(f"Sender: {bolt.get('sender')!r}")
print(f"body_text length: {len(bolt.get('body_text') or '')}")
print(f"body_html length: {len(bolt.get('body_html') or '')}")

# Now time each stage of classify
import re
from core.invoice_classifier import (
    _INSTANT_DISQUALIFY_SUBJECT,
    _INSTANT_DISQUALIFY_SENDER,
    _VENDOR_NON_INVOICE_SUBJECTS,
    _SUBJECT_STRONG,
    _SUBJECT_WEAK,
    _BODY_STRONG,
    _BODY_WEAK,
    _AMOUNT_PATTERNS,
    _INVOICE_NUMBER_PATTERNS,
    _ATTACHMENT_INVOICE_NAMES,
    _INVOICE_SENDER_DOMAINS,
    _NEGATIVE_SENDER_DOMAINS,
    _NEGATIVE_SUBJECT,
    _NEGATIVE_BODY,
)

subject = (bolt.get("subject") or "").strip()
sender = (bolt.get("sender") or "").strip()
body_text = (bolt.get("body_text") or "").strip()
body_html = (bolt.get("body_html") or "").strip()

subject_lower = subject.lower()
sender_lower = sender.lower()

t = time.perf_counter()
body = body_text or re.sub(r'<[^>]+>', ' ', body_html)
print(f"\n  re.sub <[^>]+>: {(time.perf_counter()-t)*1000:.1f}ms")
print(f"  body length after strip: {len(body)}")

t = time.perf_counter()
body_lower = body.lower()
print(f"  body.lower(): {(time.perf_counter()-t)*1000:.1f}ms")

# Time each individual regex
print("\n  Per-regex timing on body:")
for pat, pts in _AMOUNT_PATTERNS:
    t = time.perf_counter()
    pat.search(body)
    print(f"    {(time.perf_counter()-t)*1000:8.1f}ms  AMOUNT pat={pat.pattern[:50]!r}")

for pat, pts in _INVOICE_NUMBER_PATTERNS:
    t = time.perf_counter()
    pat.search(body)
    print(f"    {(time.perf_counter()-t)*1000:8.1f}ms  INVNUM pat={pat.pattern[:50]!r}")

for pat, pts in _NEGATIVE_BODY:
    t = time.perf_counter()
    pat.search(body)
    print(f"    {(time.perf_counter()-t)*1000:8.1f}ms  NEGBODY pat={pat.pattern[:50]!r}")

# Time the body_strong/body_weak string-in checks
t = time.perf_counter()
for kw, pts in _BODY_STRONG:
    _ = kw.lower() in body_lower
print(f"\n  _BODY_STRONG all checks: {(time.perf_counter()-t)*1000:.1f}ms")
t = time.perf_counter()
for kw, pts in _BODY_WEAK:
    _ = kw.lower() in body_lower
print(f"  _BODY_WEAK all checks: {(time.perf_counter()-t)*1000:.1f}ms")

# Full classify call
from core.invoice_classifier import classify_email
t = time.perf_counter()
result = classify_email(bolt)
elapsed = (time.perf_counter() - t) * 1000
print(f"\n  full classify_email: {elapsed:.1f}ms → tier={result['classification_tier']} score={result['classification_score']}")

# Save the body for offline analysis
out_path = Path(tempfile.gettempdir()) / "bolt_body.html"
out_path.write_text(body_html, encoding="utf-8")
print(f"\n  body_html saved to {out_path}")
