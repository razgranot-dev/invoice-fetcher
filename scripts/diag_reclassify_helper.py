"""Helper for diag_reclassify_all.mjs — reads NDJSON emails from stdin and
writes NDJSON classification results to stdout. Single-process invocation
avoids the per-call Python startup cost for thousands of rows."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.invoice_classifier import classify_email

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        email = json.loads(line)
    except json.JSONDecodeError:
        continue
    res = classify_email({
        "subject": email.get("subject") or "",
        "sender": email.get("sender") or "",
        "body_text": email.get("body_text") or "",
        "body_html": email.get("body_html") or "",
        "attachments": email.get("attachments") or [],
    })
    sys.stdout.write(json.dumps({
        "id": email["id"],
        "tier": res["classification_tier"],
        "score": res["classification_score"],
        "signals": res["classification_signals"],
    }) + "\n")
    sys.stdout.flush()
