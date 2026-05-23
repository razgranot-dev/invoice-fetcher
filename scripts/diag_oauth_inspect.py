"""Inspect what Google actually returns when we refresh without scope param."""

import json
import sys
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
creds_blob = json.loads(CREDS_PATH.read_text())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials


# Direct HTTP POST to token endpoint, bypassing google-auth library
print("=== DIRECT POST to token endpoint, NO scope param ===")
r = requests.post(
    "https://oauth2.googleapis.com/token",
    data={
        "grant_type": "refresh_token",
        "refresh_token": creds_blob["refresh_token"],
        "client_id": creds_blob["client_id"],
        "client_secret": creds_blob["client_secret"],
    },
    timeout=20,
)
print("status:", r.status_code)
body = r.json()
# Redact tokens
safe = {k: ("<token len=%d>" % len(v) if k in ("access_token", "id_token", "refresh_token") else v) for k, v in body.items()}
print("body:", safe)

if r.status_code == 200 and "access_token" in body:
    at = body["access_token"]
    print("\n=== tokeninfo lookup on the new access_token ===")
    ti = requests.get(
        f"https://www.googleapis.com/oauth2/v3/tokeninfo?access_token={at}",
        timeout=20,
    )
    print("tokeninfo status:", ti.status_code)
    print("tokeninfo body:", ti.json())

    print("\n=== Call Gmail API with the new access_token ===")
    g = requests.get(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=newer_than:1d&maxResults=1",
        headers={"Authorization": f"Bearer {at}"},
        timeout=20,
    )
    print("Gmail status:", g.status_code)
    print("Gmail body:", g.json())

print("\n=== DIRECT POST with WITHOUT-quotes scope (form-encoded) ===")
r2 = requests.post(
    "https://oauth2.googleapis.com/token",
    data={
        "grant_type": "refresh_token",
        "refresh_token": creds_blob["refresh_token"],
        "client_id": creds_blob["client_id"],
        "client_secret": creds_blob["client_secret"],
        "scope": "https://www.googleapis.com/auth/gmail.readonly",
    },
    timeout=20,
)
print("status:", r2.status_code, "body:", r2.text[:300])
