"""Verify the FULL worker-side fix: build creds_dict the way worker/main.py
now does it (no scopes, preserve expiry), then ensure refresh succeeds."""

import json
import sys
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
creds_blob = json.loads(CREDS_PATH.read_text())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.gmail_connector import GmailConnector

# Mirror the NEW worker/main.py creds_dict build (no scopes, normalized expiry)
token_expiry = creds_blob.get("token_expiry")
creds_dict = {
    "token": creds_blob["access_token"],
    "refresh_token": creds_blob["refresh_token"],
    "client_id": creds_blob["client_id"],
    "client_secret": creds_blob["client_secret"],
    "token_uri": "https://oauth2.googleapis.com/token",
}
if token_expiry:
    creds_dict["expiry"] = token_expiry.rstrip("Z").split(".")[0]

print("creds_dict keys:", sorted(creds_dict.keys()))

print("\n=== TEST: build_service_from_json (worker simulation) ===")
connector = GmailConnector()
ok, result = connector.build_service_from_json(json.dumps(creds_dict))
print("ok =", ok)
print("result preview:", (result[:120] + "...") if ok else result)

if ok:
    print("\n=== TEST: real Gmail API call after refresh ===")
    try:
        resp = connector.service.users().messages().list(userId="me", q="newer_than:1d", maxResults=1).execute()
        print("API CALL OK — message count:", len(resp.get("messages", [])))
        print("  → Fix verified end-to-end against live Google API.")
    except Exception as e:
        print("API CALL FAILED:", type(e).__name__, str(e))
