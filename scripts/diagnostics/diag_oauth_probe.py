"""Probe what google-auth Credentials stores after a refresh."""
import json
import sys
import tempfile
from pathlib import Path

CREDS_PATH = Path(tempfile.gettempdir()) / "invoice_fetcher_diag_creds.json"
creds_blob = json.loads(CREDS_PATH.read_text())

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

dct = {
    "token": creds_blob["access_token"],
    "refresh_token": creds_blob["refresh_token"],
    "client_id": creds_blob["client_id"],
    "client_secret": creds_blob["client_secret"],
    "token_uri": "https://oauth2.googleapis.com/token",
    "expiry": creds_blob["token_expiry"].rstrip("Z").split(".")[0],
}

c = Credentials.from_authorized_user_info(dct, None)
print("Before refresh:")
print("  scopes:", c.scopes)
print("  granted_scopes:", getattr(c, "granted_scopes", "ATTR MISSING"))
print("  _granted_scopes:", getattr(c, "_granted_scopes", "ATTR MISSING"))
print("  valid:", c.valid, "expired:", c.expired)

c.refresh(Request())
print("\nAfter refresh:")
print("  scopes:", c.scopes)
print("  granted_scopes:", getattr(c, "granted_scopes", "ATTR MISSING"))
print("  _granted_scopes:", getattr(c, "_granted_scopes", "ATTR MISSING"))
print("  has_scopes(['gmail.readonly']):", c.has_scopes(["https://www.googleapis.com/auth/gmail.readonly"]))
print("  token len:", len(c.token))

# Get the actual granted scopes via tokeninfo
import requests
ti = requests.get(f"https://www.googleapis.com/oauth2/v3/tokeninfo?access_token={c.token}", timeout=10)
print("  tokeninfo scope:", ti.json().get("scope"))
