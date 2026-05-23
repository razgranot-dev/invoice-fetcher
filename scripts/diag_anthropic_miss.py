"""Anthropic miss incident — direct Gmail audit.

Bypasses the app's build_query. Hits Gmail with multiple Anthropic-targeted
searches, enumerates every result, then for each one:

  1. Tests whether our app's build_query would have fetched it
  2. Runs classify_email() and reports the tier + score + signals
  3. Checks whether the row exists in our DB (and with what reportStatus)

Output is the full evidence the QA needs to identify the failure path.
No fixes applied here — pure recon.

Run: python scripts/diag_anthropic_miss.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Set creds env so the connector can build_service_from_json
creds_path = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
if not creds_path.exists():
    print("ERROR: creds file not found at", creds_path)
    print("Run: node scripts/diag_dump_creds.mjs first")
    sys.exit(1)

creds_full = json.loads(creds_path.read_text())
os.environ.setdefault("GOOGLE_CLIENT_ID", creds_full.get("client_id", ""))
os.environ.setdefault("GOOGLE_CLIENT_SECRET", creds_full.get("client_secret", ""))

from core.gmail_connector import GmailConnector
from core.invoice_classifier import classify_email, format_signal_breakdown
from core.body_parser import BodyParser


# ── 1. Build authenticated Gmail service via the same path the worker uses ──
connector = GmailConnector()
creds_dict = {
    "token": creds_full["access_token"],
    "refresh_token": creds_full["refresh_token"],
    "client_id": os.environ["GOOGLE_CLIENT_ID"],
    "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
    "token_uri": "https://oauth2.googleapis.com/token",
}
if creds_full.get("token_expiry"):
    creds_dict["expiry"] = str(creds_full["token_expiry"]).rstrip("Z").split(".")[0]

ok, result = connector.build_service_from_json(json.dumps(creds_dict))
if not ok:
    print("Gmail auth failed:", result)
    sys.exit(2)


# ── 2. Run multiple Anthropic-targeted Gmail searches ──
ANTHROPIC_QUERIES = [
    "from:anthropic.com",
    "from:anthropic",
    "from:claude.ai",
    "from:claude",
    "anthropic receipt",
    "anthropic invoice",
    "claude receipt",
    "claude invoice",
    '"Your receipt from Anthropic"',
    '"Anthropic"',
    '"Claude"',
    "newer_than:24m anthropic",
    "newer_than:24m claude",
    "filename:pdf anthropic",
    "filename:pdf claude",
]

# Use the service directly so we can pass arbitrary queries
service = connector.service
all_ids: set[str] = set()
per_query_ids: dict[str, list[str]] = {}

print("=" * 80)
print("PHASE A — Direct Gmail searches (each query, no filtering)")
print("=" * 80)
for q in ANTHROPIC_QUERIES:
    ids: list[str] = []
    page_token = None
    while True:
        params: dict = {"userId": "me", "q": q, "maxResults": 500}
        if page_token:
            params["pageToken"] = page_token
        resp = service.users().messages().list(**params).execute()
        ids.extend(m["id"] for m in resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token or len(ids) >= 500:
            break
    per_query_ids[q] = ids
    all_ids.update(ids)
    print(f"  {q!r:50s} -> {len(ids):4d} messages")

print(f"\nTotal UNIQUE Anthropic-related message IDs: {len(all_ids)}")


# ── 3. For each unique message, fetch and report ──
print()
print("=" * 80)
print("PHASE B — Full inspection of every Anthropic-related message")
print("=" * 80)

body_parser = BodyParser()
inspected: list[dict[str, Any]] = []

for i, mid in enumerate(sorted(all_ids), 1):
    try:
        raw = connector.get_message(mid)
    except Exception as exc:
        print(f"[{i}] {mid} fetch FAILED: {exc}")
        continue
    parsed = connector.parse_message(raw)
    subject = parsed.get("subject") or "(no subject)"
    sender = parsed.get("sender") or ""
    date = parsed.get("date") or ""
    has_att = bool(parsed.get("attachments"))
    snippet = (raw.get("snippet") or "")[:160]

    # Strip body data, then run the classifier
    body_text = parsed.get("body_text") or ""
    body_html = parsed.get("body_html") or ""
    parsed_for_classify = {
        "subject": subject,
        "sender": sender,
        "body_text": body_text,
        "body_html": body_html,
        "attachments": parsed.get("attachments") or [],
    }
    cls = classify_email(parsed_for_classify)

    inspected.append({
        "id": mid,
        "subject": subject,
        "sender": sender,
        "date": date,
        "has_att": has_att,
        "tier": cls["classification_tier"],
        "score": cls["classification_score"],
        "signals": cls["classification_signals"],
        "snippet": snippet,
    })

    print(f"\n[{i}] id={mid}")
    print(f"     date    : {date}")
    print(f"     sender  : {sender}")
    print(f"     subject : {subject}")
    print(f"     has_att : {has_att}")
    print(f"     snippet : {snippet}")
    print(f"     TIER    : {cls['classification_tier']}   score={cls['classification_score']}")
    print(f"     signals : {format_signal_breakdown(cls['classification_signals'])}")


# ── 4. Now test the APP's build_query and see which of these IDs it would actually fetch ──
print()
print("=" * 80)
print("PHASE C — Would our app's build_query() have fetched these?")
print("=" * 80)

for days_back in (30, 90, 365, 730):
    app_q = connector.build_query([], days_back=days_back, unread_only=False)
    print(f"\n  days_back={days_back}, unread_only=False")
    print(f"  Query length: {len(app_q)} chars")
    fetched_ids: list[str] = []
    page_token = None
    while True:
        params: dict = {"userId": "me", "q": app_q, "maxResults": 500}
        if page_token:
            params["pageToken"] = page_token
        resp = service.users().messages().list(**params).execute()
        fetched_ids.extend(m["id"] for m in resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token or len(fetched_ids) >= 2000:
            break
    fetched_set = set(fetched_ids)
    in_q_anthropic = all_ids & fetched_set
    missing_anthropic = all_ids - fetched_set
    print(f"  Total fetched by app query: {len(fetched_ids)}")
    print(f"  Of {len(all_ids)} Anthropic-related, app query fetched: {len(in_q_anthropic)}")
    print(f"  Of {len(all_ids)} Anthropic-related, app query MISSED : {len(missing_anthropic)}")
    if missing_anthropic:
        print("  Missing IDs (vs app query):")
        for mid in sorted(missing_anthropic):
            row = next((x for x in inspected if x["id"] == mid), None)
            if row:
                print(f"    - {mid}  {row['date']!s:25s}  {row['sender'][:50]:50s}  {row['subject'][:60]}")


# ── 5. Also dump JSON for downstream comparison against DB ──
out_path = Path(tempfile.gettempdir()) / "invoice_fetcher_anthropic_audit.json"
out_path.write_text(json.dumps(inspected, default=str, indent=2, ensure_ascii=False))
print(f"\nFull inspection JSON: {out_path}")
