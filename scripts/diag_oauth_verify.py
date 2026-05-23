"""Verify the gmail_connector fix actually works against Google's live token endpoint."""

import json
import sys
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
if not CREDS_PATH.exists():
    print("ERROR: run diag_oauth.mjs first")
    sys.exit(1)

creds_blob = json.loads(CREDS_PATH.read_text())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.gmail_connector import GmailConnector

# Simulate exactly what worker/main.py does
worker_creds_dict = {
    "token": creds_blob["access_token"],
    "refresh_token": creds_blob["refresh_token"],
    "client_id": creds_blob["client_id"],
    "client_secret": creds_blob["client_secret"],
    "token_uri": "https://oauth2.googleapis.com/token",
    "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
}

print("=== TEST: build_service_from_json with patched code ===")
connector = GmailConnector()
ok, result = connector.build_service_from_json(json.dumps(worker_creds_dict))
print("ok =", ok)
print("result preview:", result[:120] if ok else result)

if ok:
    print("\n=== TEST: real Gmail API call after refresh ===")
    try:
        resp = connector.service.users().messages().list(userId="me", q="newer_than:1d", maxResults=1).execute()
        print("API CALL OK — message count:", len(resp.get("messages", [])))
    except Exception as e:
        print("API CALL FAILED:", type(e).__name__, str(e))
