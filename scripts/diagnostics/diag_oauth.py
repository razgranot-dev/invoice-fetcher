"""Reproduce the worker OAuth refresh failure with stored creds.

Loads creds dumped by diag_oauth.mjs from a temp file. Never prints tokens.
Mirrors the EXACT logic in worker/main.py run_scan() so a passing run here
means the worker would pass too.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"

if not CREDS_PATH.exists():
    print("ERROR: run diag_oauth.mjs first to dump creds")
    sys.exit(1)

creds_blob = json.loads(CREDS_PATH.read_text())

print("Stored scopes:", creds_blob.get("scopes"))
print("Token expiry:", creds_blob.get("token_expiry"))
print("Access token len:", len(creds_blob["access_token"]))
print("Refresh token len:", len(creds_blob["refresh_token"]))
print("Client ID len:", len(creds_blob["client_id"]))
print("Client secret len:", len(creds_blob["client_secret"]))

# Mirror worker/main.py:181 exactly
worker_creds_dict = {
    "token": creds_blob["access_token"],
    "refresh_token": creds_blob["refresh_token"],
    "client_id": creds_blob["client_id"],
    "client_secret": creds_blob["client_secret"],
    "token_uri": "https://oauth2.googleapis.com/token",
    "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
}

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

print("\n=== TEST 1: worker-style refresh with narrow scope ===")
try:
    c1 = Credentials.from_authorized_user_info(worker_creds_dict, SCOPES)
    print("creds.valid =", c1.valid, "creds.expired =", c1.expired, "has refresh_token =", bool(c1.refresh_token))
    if c1.expired and c1.refresh_token:
        c1.refresh(Request())
        print("REFRESH OK")
    else:
        print("Refresh not triggered by build_service_from_json")
except Exception as e:
    print("REFRESH FAILED:", type(e).__name__, str(e))

# Force a refresh — what the underlying API call would trigger
print("\n=== TEST 2: forced refresh with narrow scope ===")
try:
    c2 = Credentials.from_authorized_user_info(worker_creds_dict, SCOPES)
    c2.refresh(Request())
    print("FORCED REFRESH OK — new token len:", len(c2.token or ""))
except Exception as e:
    print("FORCED REFRESH FAILED:", type(e).__name__, str(e))

# Now try with the full original scopes from the DB
print("\n=== TEST 3: forced refresh with FULL original scopes ===")
full_scopes = creds_blob["scopes"]
print("Using full scopes:", full_scopes)
try:
    full_dict = {**worker_creds_dict, "scopes": full_scopes}
    c3 = Credentials.from_authorized_user_info(full_dict, full_scopes)
    c3.refresh(Request())
    print("FORCED REFRESH OK — new token len:", len(c3.token or ""))
except Exception as e:
    print("FORCED REFRESH FAILED:", type(e).__name__, str(e))

# Try with NO scopes at all
print("\n=== TEST 4: forced refresh with NO scopes ===")
try:
    no_scope_dict = {**worker_creds_dict}
    c4 = Credentials.from_authorized_user_info(no_scope_dict, [])
    c4.refresh(Request())
    print("FORCED REFRESH OK — new token len:", len(c4.token or ""))
except Exception as e:
    print("FORCED REFRESH FAILED:", type(e).__name__, str(e))

# Try direct Gmail API call
print("\n=== TEST 5: real Gmail API call with current access_token ===")
try:
    import httplib2
    import google_auth_httplib2
    from googleapiclient.discovery import build
    c5 = Credentials.from_authorized_user_info(worker_creds_dict, SCOPES)
    http = httplib2.Http(timeout=30)
    authed_http = google_auth_httplib2.AuthorizedHttp(c5, http=http)
    svc = build("gmail", "v1", http=authed_http, cache_discovery=False)
    resp = svc.users().messages().list(userId="me", q="newer_than:1d", maxResults=1).execute()
    print("API CALL OK — message count:", len(resp.get("messages", [])))
except Exception as e:
    print("API CALL FAILED:", type(e).__name__, str(e))
