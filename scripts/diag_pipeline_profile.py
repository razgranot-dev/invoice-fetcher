"""Profile what makes the 19-second gap between progress=72 and progress=91.

Walks through the pipeline locally (no HTTP, no Gmail API — just the same
list of parsed message dicts the worker produces) and times every stage so
we can see whether the bottleneck is classify_results, enrich_results, or
something else.
"""

import json
import os
import sys
import time
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
creds_blob = json.loads(CREDS_PATH.read_text())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Match the worker's env bridge so GmailConnector can find creds
os.environ.setdefault("GOOGLE_CLIENT_ID", creds_blob["client_id"])
os.environ.setdefault("GOOGLE_CLIENT_SECRET", creds_blob["client_secret"])

from core.gmail_connector import GmailConnector
from core.body_parser import BodyParser
from core.invoice_classifier import classify_results, classify_email
from core.amount_extractor import enrich_results

worker_creds_dict = {
    "token": creds_blob["access_token"],
    "refresh_token": creds_blob["refresh_token"],
    "client_id": creds_blob["client_id"],
    "client_secret": creds_blob["client_secret"],
    "token_uri": "https://oauth2.googleapis.com/token",
    "expiry": creds_blob["token_expiry"].rstrip("Z").split(".")[0],
}

connector = GmailConnector()
ok, result = connector.build_service_from_json(json.dumps(worker_creds_dict))
if not ok:
    print("AUTH FAIL:", result)
    sys.exit(1)

DAYS_BACK = int(os.environ.get("DAYS_BACK", "30"))

# Fetch the SAME emails the worker would
print("Listing message IDs...")
t = time.time()
msg_ids = connector.list_message_ids([], DAYS_BACK, False)
print(f"  list_message_ids: {time.time()-t:.2f}s, found {len(msg_ids)}")

print("Fetching all messages in batches of 50...")
t = time.time()
all_msgs = []
for i in range(0, len(msg_ids), 50):
    all_msgs.extend(connector.get_messages_batch(msg_ids[i:i+50]))
print(f"  fetch+parse: {time.time()-t:.2f}s")

print("Parsing messages...")
t = time.time()
body_parser = BodyParser()
results = []
for msg in all_msgs:
    if msg is None:
        continue
    try:
        parsed = connector.parse_message(msg)
        parsed["saved_path"] = None
        for att in parsed.get("attachments", []):
            att.pop("data", None)
        text = body_parser.extract_text(parsed.get("body_text", ""), parsed.get("body_html", ""))
        parsed["notes"] = "X" if body_parser.looks_like_invoice(text) else ""
        results.append(parsed)
    except Exception as e:
        print(f"  parse error: {type(e).__name__}: {e}")
print(f"  parse + body_parser: {time.time()-t:.2f}s, results={len(results)}")

# Now profile classify per-email
print("\nProfiling classify_email per message (top 10 slowest)...")
classify_times = []
for r in results:
    t = time.time()
    classify_email(r)
    classify_times.append((time.time() - t, r.get("subject", "")[:50], r.get("sender", "")[:40]))
classify_times.sort(reverse=True)
print(f"  total classify time: {sum(t for t,_,_ in classify_times):.2f}s")
print(f"  avg per email: {sum(t for t,_,_ in classify_times)/len(results)*1000:.1f}ms")
print(f"  top 10 slowest:")
for dur, subj, sender in classify_times[:10]:
    print(f"    {dur*1000:6.1f}ms  {sender:40} | {subj}")

# Re-run classify on all (real call, mutates results)
t = time.time()
classify_results(results)
print(f"  classify_results bulk: {time.time()-t:.2f}s")

# Profile enrich per-email
print("\nProfiling enrich per message (top 10 slowest)...")
from core.amount_extractor import extract_amount, extract_description
enrich_times = []
for r in results:
    text = r.get("body_text", "") or r.get("body_html", "") or ""
    body_len = len(text)
    t = time.time()
    extract_amount(text)
    extract_description(r.get("subject", ""), r.get("sender", ""))
    enrich_times.append((time.time() - t, body_len, r.get("subject", "")[:50], r.get("sender", "")[:40]))
enrich_times.sort(reverse=True)
print(f"  total enrich time: {sum(t for t,_,_,_ in enrich_times):.2f}s")
print(f"  top 10 slowest:")
for dur, bl, subj, sender in enrich_times[:10]:
    print(f"    {dur*1000:7.1f}ms  body={bl:>7}B  {sender:40} | {subj}")

# Run bulk enrich to confirm timing
t = time.time()
enrich_results(results)
print(f"\n  enrich_results bulk total: {time.time()-t:.2f}s")
