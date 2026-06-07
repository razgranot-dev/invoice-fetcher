"""
מחבר Gmail — OAuth2 מבוסס משתני סביבה.
לא נדרש קובץ credentials.json ידני — הכול מנוהל פנימית.
"""

import base64
import hashlib
import json
import logging
import os
import secrets
import time
import traceback
from datetime import datetime, timedelta
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from core import paypal_provider

_log = logging.getLogger(__name__)

_TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds; doubled each attempt
# Upper bound on candidate messages fetched per scan. Bumped from 2000 to 5000
# on 2026-05-23 because users running multi-year archive scans (e.g.,
# days_back=730 for tax purposes) were hitting the previous cap and silently
# missing the oldest receipts. Five years of typical "broad invoice query"
# traffic fits well under 5000 for a normal inbox; pagination is 500 per
# round-trip so the worst case is 10 list-messages calls.
_MAX_MESSAGES = 5000

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def _is_auth_error(exc: Exception) -> bool:
    """Returns True if the exception indicates an auth failure that requires re-login.

    Auth errors: token revoked, expired, invalid_grant, invalid_scope,
    401 Unauthorized, 403 with insufficient permissions (token granted
    without gmail.readonly). These cannot be recovered by retrying — the
    user must re-authenticate AND grant the Gmail permission.
    """
    try:
        from google.auth.exceptions import RefreshError
        if isinstance(exc, RefreshError):
            return True
    except ImportError:
        pass
    try:
        from googleapiclient.errors import HttpError
        if isinstance(exc, HttpError):
            status = exc.resp.status
            if status == 401:
                return True
            # 403 from Gmail means the token doesn't have the gmail.readonly
            # scope — the only fix is to re-grant consent. Treat as auth error
            # so callers prompt the user to reconnect.
            if status == 403 and "insufficient" in str(exc).lower():
                return True
    except (ImportError, AttributeError):
        pass
    msg = str(exc).lower()
    return any(
        sig in msg for sig in (
            "invalid_grant",
            "invalid_scope",
            "token has been expired",
            "token has been revoked",
            "invalid_client",
            "unauthorized_client",
            "access_denied",
            "insufficient_scope",
            "insufficient permission",
            "access_token_scope_insufficient",
        )
    )


class GmailConnector:
    AUTH_ERROR_PREFIX = "AUTH_ERROR:"
    """
    מנהל חיבור ואימות מול Gmail API.
    פרטי OAuth נטענים ממשתני הסביבה GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET (ממופים מ-GID ו-GSECRET).
    הטוקן נשמר ומתרענן אוטומטית — המשתמש לא רואה שום קובץ.
    """

    def __init__(self):
        self.service: Any = None
        self._client_id = os.getenv("GOOGLE_CLIENT_ID")
        self._client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
        # Per-scan batch-fetch telemetry (a fresh connector is created per scan).
        # Lets the worker report an honest funnel: how many sub-requests the
        # batch endpoint dropped, how many we recovered via individual retry,
        # and which IDs still failed (with a safe reason — no body).
        self.fetch_recovered = 0          # messages refetched individually after a batch drop
        self.fetch_failed_final = 0       # messages still missing after the individual retry
        self.fetch_failed_ids: list[dict] = []  # [{id, reason}] for still-failed (capped)

    # ── בדיקות מצב ───────────────────────────────────────────────────

    def is_configured(self) -> bool:
        """מחזיר True אם GID ו-GSECRET הוגדרו."""
        return bool(self._client_id and self._client_secret)

    def is_authenticated(self) -> bool:
        """Returns True if st.session_state contains valid or refreshable credentials."""
        import streamlit as st
        creds_json = st.session_state.get("_creds_json", "")
        if not creds_json:
            return False
        try:
            creds = Credentials.from_authorized_user_info(
                json.loads(creds_json), SCOPES
            )
            return creds.valid or (creds.expired and bool(creds.refresh_token))
        except Exception:
            return False

    # ── אימות ────────────────────────────────────────────────────────

    def _build_web_client_config(self) -> dict:
        """Client config for web-based OAuth flow.
        NOTE: The redirect URI used at runtime must be registered in Google Cloud Console
        under OAuth 2.0 Client → Authorized redirect URIs, otherwise Google will reject it.
        """
        return {
            "web": {
                "client_id": self._client_id,
                "client_secret": self._client_secret,
                "redirect_uris": [],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }

    def get_auth_url(self, redirect_uri: str) -> tuple[str, str, str]:
        """Returns (auth_url, code_verifier, csrf_state).
        Store both code_verifier and csrf_state in st.session_state.

        The state param carries the code_verifier so it survives the browser
        redirect even if Streamlit's session_state is reset (e.g. redirect
        landed on a different port). The welcome screen uses state as a
        fallback verifier when session_state is empty after redirect.
        """
        try:
            code_verifier = secrets.token_urlsafe(96)
            code_challenge = base64.urlsafe_b64encode(
                hashlib.sha256(code_verifier.encode("ascii")).digest()
            ).rstrip(b"=").decode("ascii")

            csrf_state = code_verifier  # echoed back by Google; used as fallback verifier

            flow = Flow.from_client_config(
                self._build_web_client_config(), scopes=SCOPES, redirect_uri=redirect_uri
            )
            auth_url, _ = flow.authorization_url(
                prompt="consent",
                access_type="offline",
                code_challenge=code_challenge,
                code_challenge_method="S256",
                state=csrf_state,
            )
            return auth_url, code_verifier, csrf_state
        except Exception as e:
            raise RuntimeError(
                f"get_auth_url failed | redirect_uri={redirect_uri!r} | "
                f"client_id_set={bool(self._client_id)} | "
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
            ) from e

    def exchange_code(self, code: str, redirect_uri: str, code_verifier: str) -> tuple[bool, str, str]:
        """Exchange OAuth code for token. Returns (success, creds_json, error_message).
        On success, creds_json is a JSON string to store in st.session_state["_creds_json"].
        On failure, creds_json is '' and error_message describes the problem.
        On redirect_uri_mismatch: error_message will contain 'redirect_uri_mismatch'.
        """
        try:
            flow = Flow.from_client_config(
                self._build_web_client_config(), scopes=SCOPES, redirect_uri=redirect_uri
            )
            flow.fetch_token(code=code, code_verifier=code_verifier)
            creds = flow.credentials
            return True, creds.to_json(), ""
        except Exception as e:
            return False, "", f"{type(e).__name__}: {e}\n{traceback.format_exc()}"

    def build_service_from_json(self, creds_json: str) -> tuple[bool, str]:
        """Load credentials from JSON string, refresh if needed, build Gmail service.
        Returns (success, result):
          - Success:     (True, updated_creds_json)  — caller persists back to session_state
          - Auth error:  (False, "AUTH_ERROR: ...")  — caller must clear session + prompt re-login
          - Other error: (False, "ErrorType: msg")   — transient / config issue
        """
        try:
            # IMPORTANT: pass scopes=None (NOT SCOPES). Google's token endpoint
            # rejects refresh requests that include a `scope` parameter with
            # `invalid_scope: Bad Request`. Credentials.refresh() forwards
            # self._scopes into the refresh POST body, so any non-empty scopes
            # here causes every stale-token refresh to fail. The grant's
            # original scopes remain authoritative server-side; we don't need
            # to re-assert them on refresh.
            #
            # NOTE: google-auth's from_authorized_user_info uses
            # info.get("scopes", scopes), so a "scopes" key in the input dict
            # OVERRIDES the function arg. Callers must omit "scopes" from the
            # dict to actually skip the scope param on refresh.
            creds = Credentials.from_authorized_user_info(
                json.loads(creds_json), None
            )
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())

            # After refresh, verify the token actually has gmail.readonly.
            # google-auth (2.48) does NOT populate Credentials.granted_scopes
            # from the refresh response — both `scopes` and `granted_scopes`
            # stay None when we pass scopes=None. So we hit Google's tokeninfo
            # endpoint (~200ms) to read the real granted scopes.
            #
            # Why we need this check: if the user reconnected and did NOT
            # tick the Gmail box on the Google consent screen, the refresh
            # succeeds and returns a token with only openid/email/profile.
            # The next Gmail API call then fails with a confusing
            # 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT deep in the scan pipeline.
            # Fail fast here with an actionable error.
            try:
                import urllib.request, urllib.error
                req = urllib.request.Request(
                    f"https://oauth2.googleapis.com/tokeninfo?access_token={creds.token}",
                    method="GET",
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    ti = json.loads(resp.read())
                granted = set((ti.get("scope") or "").split())
                required = "https://www.googleapis.com/auth/gmail.readonly"
                if required not in granted:
                    return False, (
                        f"{GmailConnector.AUTH_ERROR_PREFIX} "
                        "Gmail permission missing from this connection. "
                        "Reconnect your Google account and check the Gmail box "
                        "on the consent screen. "
                        f"Granted scopes: {sorted(granted)}"
                    )
            except (urllib.error.URLError, OSError, ValueError) as _ti_err:
                # tokeninfo is best-effort. If unreachable, fall through and
                # let the Gmail API call surface the issue (handled by
                # _is_auth_error's 403 INSUFFICIENT_SCOPES detection).
                _log.warning("tokeninfo verification skipped: %s", _ti_err)

            import httplib2
            import google_auth_httplib2
            http = httplib2.Http(timeout=30)
            authed_http = google_auth_httplib2.AuthorizedHttp(creds, http=http)
            self.service = build("gmail", "v1", http=authed_http)
            return True, creds.to_json()
        except Exception as e:
            if _is_auth_error(e):
                _log.warning("Gmail auth error (token revoked/expired): %s", e)
                return False, f"{GmailConnector.AUTH_ERROR_PREFIX} {type(e).__name__}: {e}"
            _log.warning("Gmail service init error: %s", e)
            return False, f"{type(e).__name__}: {e}"

    def revoke_token(self) -> bool:
        """Clears the in-memory service. Caller must clear st.session_state['_creds_json']."""
        self.service = None
        return True

    # ── בנייה ושליפה ─────────────────────────────────────────────────

    def _exec(self, request) -> dict:
        """Execute a Google API request object with exponential backoff retry.

        Retries on transient HTTP errors (429, 500-504). Does NOT retry auth
        errors (401) — those are surfaced immediately so the caller can clear
        the session and prompt re-login.
        """
        from googleapiclient.errors import HttpError

        for attempt in range(_MAX_RETRIES + 1):
            try:
                return request.execute()
            except HttpError as exc:
                status = int(exc.resp.status)
                if status == 401:
                    raise  # auth error — propagate immediately, no retry
                if status in _TRANSIENT_STATUS_CODES and attempt < _MAX_RETRIES:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    _log.warning(
                        "Gmail API HTTP %d — retry %d/%d in %.1fs",
                        status, attempt + 1, _MAX_RETRIES, delay,
                    )
                    time.sleep(delay)
                    continue
                raise  # non-retryable or exhausted retries

    # Known invoice sender domains — emails from these are always included.
    # MUST stay in sync with _INVOICE_SENDER_DOMAINS in invoice_classifier.py
    # so emails that the classifier can score are actually fetched.
    INVOICE_SENDER_DOMAINS: list[str] = [
        # Tech / SaaS
        "apple.com",
        "em.apple.com",
        "anthropic.com",
        "openai.com",
        "google.com",
        "payments.google.com",
        "hostinger.com",
        "mailer.hostinger.com",
        "microsoft.com",
        "azure.com",
        "wix.com",
        "spotify.com",
        "netflix.com",
        "adobe.com",
        "zoom.us",
        "linkedin.com",
        "vercel.com",
        "digitalocean.com",
        "heroku.com",
        "namecheap.com",
        "godaddy.com",
        "shopify.com",
        "squarespace.com",
        "dropbox.com",
        # Payment processors
        "paypal.com",
        "intl.paypal.com",
        "stripe.com",
        # E-commerce
        "amazon.com",
        "amazon.co.il",
        "aws.amazon.com",
        # Ride-sharing / delivery
        "uber.com",
        "receipts.uber.com",
        "lyft.com",
        "wolt.com",
        "bolt.eu",
        "gett.com",
        # Food delivery
        "tenbis.co.il",
        "10bis.co.il",
        "doordash.com",
        "deliveroo.com",
        "grubhub.com",
        "cibus.co.il",
        # Travel / booking / OTAs
        "booking.com",
        "airbnb.com",
        "expedia.com",
        "hotels.com",
        "agoda.com",
        # Hotel chains
        "hilton.com",
        "marriott.com",
        "ihg.com",
        "hyatt.com",
        "accor.com",
        "radissonhotels.com",
        # E-commerce
        "aliexpress.com",
        "ebay.com",
        "etsy.com",
        "temu.com",
        "shein.com",
        # Israeli telecom / utilities
        "partner.co.il",
        "bezeq.co.il",
        "cellcom.co.il",
        "hot.net.il",
        "pelephone.co.il",
        "electric.co.il",
    ]

    # Subject patterns that indicate invoices/receipts (case-insensitive in Gmail)
    INVOICE_SUBJECT_PATTERNS: list[str] = [
        # English vendor patterns
        "your receipt from apple",
        "invoice from apple",
        "anthropic invoice",
        "your anthropic receipt",
        "openai invoice",
        "your openai bill",
        "google invoice",
        "your google one receipt",
        "google llc",
        "hostinger invoice",
        "order confirmation",
        "paypal receipt",
        "you paid",
        "payment to",
        "invoice from",
        "invoice #",
        "billing statement",
        "payment confirmation",
        "payment received",
        "subscription receipt",
        "your order",
        # Generic receipt patterns
        "your receipt",
        "your bill is ready",
        "your monthly bill",
        # Ride / transport receipt patterns
        "ride receipt",
        "trip receipt",
        "your ride with",
        "trip with uber",
        "trip with lyft",
        # Food delivery / e-commerce order receipts
        "your order from",
        "delivery receipt",
        # Hotel / stay receipt patterns
        "your folio",
        "checkout receipt",
        "stay receipt",
        "your stay at",
        # Hebrew invoice patterns
        "חשבונית מס",
        "אישור חיוב",
        "חשבון חודשי",
        "הודעת תשלום",
        "אישור הזמנה",
        "פירוט חיוב",
    ]

    # Attachment filenames that indicate invoices (searched via Gmail filename: operator)
    INVOICE_FILENAME_KEYWORDS: list[str] = [
        "invoice",
        "receipt",
        "חשבונית",
        "קבלה",
        "חשבון",
    ]

    # Core invoice/receipt subject keywords used to widen the Gmail query.
    # Kept intentionally short so the final query stays well under Gmail's
    # ~2KB practical limit. Tokens are word-tokenized by Gmail so
    # subject:invoice already matches "Invoice", "Invoices", "INVOICE", etc.
    _QUERY_SUBJECT_KEYWORDS: list[str] = [
        # English
        "invoice", "receipt", "bill", "billing", "payment",
        "purchase", "purchased", "order", "subscription", "renewal",
        "charged", "paid",
        # Hebrew
        "חשבונית",
        "קבלה",
        "חיוב",
        "תשלום",
        "הזמנה",
        "חשבון",
    ]

    # Local-part keywords for `from:` — Gmail tokenizes the From field, so
    # `from:invoice` matches "invoice@example.com", "billing@invoices.x.com",
    # "Invoice <noreply@apple.com>" display names, etc. Far broader and
    # safer than listing every vendor domain.
    _QUERY_FROM_KEYWORDS: list[str] = [
        "invoice", "invoices", "receipt", "receipts",
        "billing", "payments", "payment", "noreply", "no-reply",
    ]

    # Brand `from:` anchors for payment PROCESSORS whose transactional subjects
    # are short, opaque, or localized ("You sent $X to Y", "Transaction
    # details", Hebrew "הקבלה שלך") — these slip through the subject-keyword and
    # generic from-local-part anchors above, and Gmail does not reliably tag
    # them `category:purchases`. A single `from:paypal` clause matches the
    # "PayPal" display name AND every paypal.* domain regardless of subject or
    # locale, so EVERY PayPal email is fetched and handed to the classifier.
    # Root-cause fix for "PayPal receipts missing entirely" (see
    # core/paypal_provider.py). Sourced from the provider so there is one
    # source of truth. Kept tiny so the query stays well under Gmail's limit.
    _QUERY_PROCESSOR_FROM_TOKENS: list[str] = [
        *paypal_provider.discovery_query_tokens(),
    ]

    # Brand `from:` anchors for KNOWN vendors. Restores the per-vendor coverage
    # that the 2026-05-22 slim-query rewrite dropped: vendors whose receipts
    # have localized/opaque subjects and non-keyword senders (service@, team@,
    # premium@, orders@) were reachable ONLY via Gmail's category:purchases,
    # which Google does not reliably assign — so their receipts were silently
    # never fetched (the broad "too few receipts / missing suppliers"
    # regression, confirmed across PayPal, Stripe, Wix, Gett, Higgsfield,
    # Shopify, Hebrew vendors, etc.).
    #
    # Brand TOKENS (not full domains): Gmail tokenizes the From header, so
    # `from:hostinger` matches hostinger.com, mailer.hostinger.com, AND the
    # "Hostinger" display name — broader and more robust than `from:domain`.
    # Discovery over-fetch is safe: the classifier still decides per email.
    # Short/ambiguous tokens (e.g. "hot") use the full domain to avoid
    # accidental matches. MUST stay roughly in sync with _INVOICE_SENDER_DOMAINS
    # in invoice_classifier.py (the scoring list). PayPal is added via
    # _QUERY_PROCESSOR_FROM_TOKENS above.
    _QUERY_BRAND_FROM_TOKENS: list[str] = [
        # Payment processors / SaaS
        "stripe", "apple", "openai", "anthropic", "vercel", "render",
        "hostinger", "shopify", "canva", "higgsfield", "wix", "squarespace",
        "notion", "linkedin", "microsoft", "adobe", "spotify", "netflix",
        "zoom", "namecheap", "godaddy", "digitalocean", "heroku", "dropbox",
        "google", "amazon", "facebookmail",
        # Ride / delivery / travel
        "uber", "lyft", "gett", "bolt", "wolt", "doordash", "booking",
        "airbnb", "expedia", "agoda",
        # E-commerce
        "aliexpress", "ebay", "etsy", "temu",
        # Israeli vendors / invoicing SaaS
        "cibus", "tenbis", "cellcom", "bezeq", "partner", "pelephone",
        "hot.net.il", "greeninvoice", "icount",
    ]

    # Hard cap on query length. Gmail's q parameter has a practical upper
    # bound around 2KB; longer queries can silently return empty results
    # or 400 errors. We log a warning if we approach this.
    _QUERY_LENGTH_WARN = 1800
    # Hard ceiling for the assembled query. Brand anchors are trimmed to stay
    # under this so the query never approaches Gmail's ~2KB practical q-param
    # limit (past which it silently returns empty results or 400s).
    _QUERY_HARD_CAP = 1900

    def build_query(self, keywords: list[str], days_back: int, unread_only: bool) -> str:
        """Build a slim, high-recall Gmail search query.

        Strategy (changed 2026-05-22 — see QA report):
          1. Gmail's built-in `category:purchases` catches almost all
             transactional emails Google has already classified, including
             new vendors we'd otherwise miss.
          2. A short list of subject keywords (English + Hebrew) catches
             explicit "Invoice / Receipt / חשבונית" subjects from any sender.
          3. `filename:` clauses catch PDF attachments named invoice.pdf
             even if the body has nothing.
          4. `from:` local-part keywords catch billing@x.com, invoice@y.com,
             receipts@z.com — independent of the specific vendor domain.
          5. User-provided keywords are added verbatim.

        This replaces the previous build_query, which enumerated ~80 sender
        domains and ~30 quoted subject phrases, producing a ~2.5-3KB query
        that could silently truncate against Gmail's q parameter limit and
        miss new vendors. The classifier's per-email scoring (which still
        uses the full sender-domain list) remains unchanged.
        """
        parts = []
        if unread_only:
            parts.append("is:unread")
        since = (datetime.now() - timedelta(days=days_back)).strftime("%Y/%m/%d")
        parts.append(f"after:{since}")

        clauses: list[str] = []

        # 1. User-provided keywords — quoted so multi-word phrases stay intact
        seen_words: set[str] = set()
        for kw in keywords:
            stripped = kw.strip()
            if not stripped or stripped.lower() in seen_words:
                continue
            clauses.append(f'subject:"{stripped}"')
            clauses.append(f'"{stripped}"')
            seen_words.add(stripped.lower())

        # 2. Gmail's built-in purchases category — high recall for transactions
        clauses.append("category:purchases")

        # 3. Core subject keywords (English + Hebrew)
        for kw in self._QUERY_SUBJECT_KEYWORDS:
            clauses.append(f"subject:{kw}")

        # 4. Attachment filename heuristics
        for fname_kw in self.INVOICE_FILENAME_KEYWORDS:
            clauses.append(f"filename:{fname_kw}")

        # 5. Sender local-part heuristics — broader than any domain list
        for kw in self._QUERY_FROM_KEYWORDS:
            clauses.append(f"from:{kw}")

        # 6. Payment-processor brand anchors (PayPal etc.) — guarantees their
        #    localized / opaque-subject receipts are fetched. See
        #    _QUERY_PROCESSOR_FROM_TOKENS.
        for token in self._QUERY_PROCESSOR_FROM_TOKENS:
            clauses.append(f"from:{token}")

        # Assemble the CORE query (clauses 1-6). These are always included.
        prefix = " ".join(parts) + " ("
        suffix = ")"
        query = prefix + " OR ".join(clauses)

        # 7. Known-vendor brand anchors — restores per-vendor coverage dropped
        #    by the 2026-05-22 slim-query rewrite (see _QUERY_BRAND_FROM_TOKENS).
        #    Appended WITHIN a hard length budget: brand anchors are the
        #    trimmable "nice to have", so a large user-keyword set can never
        #    push the query past Gmail's ~2KB practical limit (beyond which it
        #    silently returns empty/400). Core anchors above always survive.
        omitted = 0
        for token in self._QUERY_BRAND_FROM_TOKENS:
            clause = f" OR from:{token}"
            if len(query) + len(clause) + len(suffix) > self._QUERY_HARD_CAP:
                omitted += 1
                continue
            query += clause
        query += suffix

        if omitted:
            _log.warning(
                "Gmail query near hard cap (%d) — %d brand anchors omitted; "
                "core + keyword coverage intact.",
                self._QUERY_HARD_CAP, omitted,
            )
        elif len(query) > self._QUERY_LENGTH_WARN:
            _log.info("Gmail query length %d (soft cap %d).", len(query), self._QUERY_LENGTH_WARN)

        return query

    def list_message_ids(
        self,
        keywords: list[str],
        days_back: int = 30,
        unread_only: bool = True,
    ) -> list[str]:
        """Returns matching message IDs. Caps at _MAX_MESSAGES to prevent unbounded scans."""
        query = self.build_query(keywords, days_back, unread_only)
        ids: list[str] = []
        page_token = None

        while True:
            params: dict = {"userId": "me", "q": query, "maxResults": 500}
            if page_token:
                params["pageToken"] = page_token

            resp = self._exec(self.service.users().messages().list(**params))
            ids.extend(m["id"] for m in resp.get("messages", []))

            if len(ids) >= _MAX_MESSAGES:
                _log.warning(
                    "Message cap reached (%d). Stopping pagination early.", _MAX_MESSAGES
                )
                ids = ids[:_MAX_MESSAGES]
                break

            page_token = resp.get("nextPageToken")
            if not page_token:
                break

        return ids

    def get_message(self, msg_id: str) -> dict:
        """שולף הודעה מלאה מ-Gmail."""
        return self._exec(
            self.service.users().messages().get(userId="me", id=msg_id, format="full")
        )

    def get_messages_batch(self, msg_ids: list[str]) -> list[dict | None]:
        """Fetch multiple messages in a single Gmail batch HTTP call.

        Returns a list aligned with *msg_ids* — each entry is the raw
        message dict on success, or ``None`` if that sub-request failed.
        Caller should pass at most 50 IDs per call (Gmail limit is 100,
        but 50 gives better progress granularity).
        """
        results: list[dict | None] = [None] * len(msg_ids)

        def _make_cb(idx: int, mid: str):
            def _cb(request_id, response, exception):
                if exception:
                    _log.warning("Batch get_message failed for %s: %s", mid, exception)
                else:
                    results[idx] = response
            return _cb

        batch = self.service.new_batch_http_request()
        for i, mid in enumerate(msg_ids):
            batch.add(
                self.service.users().messages().get(
                    userId="me", id=mid, format="full"
                ),
                callback=_make_cb(i, mid),
            )

        from googleapiclient.errors import HttpError
        for attempt in range(_MAX_RETRIES + 1):
            try:
                batch.execute()
                break
            except HttpError as exc:
                status = int(exc.resp.status)
                if status == 401:
                    raise
                if status in _TRANSIENT_STATUS_CODES and attempt < _MAX_RETRIES:
                    delay = _RETRY_BASE_DELAY * (2 ** attempt)
                    _log.warning(
                        "Batch API HTTP %d — retry %d/%d in %.1fs",
                        status, attempt + 1, _MAX_RETRIES, delay,
                    )
                    time.sleep(delay)
                    continue
                raise

        # Recover sub-requests that failed transiently INSIDE the batch. The
        # Gmail batch endpoint frequently returns per-message 429/5xx for a
        # subset of IDs while the overall batch call succeeds (200). Those
        # entries are left None above and, before this pass, were silently
        # dropped by the worker — a real, intermittent "missing invoices" cause
        # (the same inbox skipped 84 then 48 messages on two consecutive runs).
        # Retry the still-missing IDs individually; self.get_message → _exec
        # already applies transient-retry/backoff per request.
        missing = [(i, mid) for i, mid in enumerate(msg_ids) if results[i] is None]
        if missing:
            _log.warning(
                "Batch left %d/%d messages unfetched — retrying individually",
                len(missing), len(msg_ids),
            )
            recovered = 0
            for i, mid in missing:
                try:
                    results[i] = self.get_message(mid)
                    recovered += 1
                except Exception as exc:
                    # Still failed after the individual retry. Record safe
                    # metadata ONLY — the message body was never fetched, so the
                    # most we can name is the Gmail message ID + the error type.
                    self.fetch_failed_final += 1
                    if len(self.fetch_failed_ids) < 100:
                        self.fetch_failed_ids.append({
                            "id": mid,
                            "reason": f"{type(exc).__name__}: {str(exc)[:160]}",
                        })
                    _log.warning(
                        "STILL FAILED after retry — gmail_message_id=%s reason=%s",
                        mid, f"{type(exc).__name__}: {str(exc)[:160]}",
                    )
            self.fetch_recovered += recovered
            _log.info(
                "Batch recovery — recovered=%d still_failed=%d (of %d dropped sub-requests)",
                recovered, len(missing) - recovered, len(missing),
            )

        return results

    def parse_message(self, msg: dict) -> dict:
        """ממיר הודעת Gmail API למילון מובנה."""
        result: dict[str, Any] = {
            "uid": msg.get("id", ""),
            "date": "", "sender": "", "subject": "",
            "body_text": "", "body_html": "",
            "attachments": [], "saved_path": None, "notes": "",
        }
        payload = msg.get("payload", {})
        for h in payload.get("headers", []):
            n = h.get("name", "").lower()
            v = h.get("value", "")
            if n == "date":
                result["date"] = v
            elif n == "from":
                result["sender"] = v
            elif n == "subject":
                result["subject"] = v
        self._extract_parts(payload, result)
        return result

    def _extract_parts(self, payload: dict, result: dict) -> None:
        """חילוץ רקורסיבי של גוף ההודעה וקבצים מצורפים."""
        parts = payload.get("parts")
        if parts:
            for part in parts:
                self._extract_parts(part, result)
            return

        mime = payload.get("mimeType", "")
        filename = payload.get("filename", "")
        body = payload.get("body", {})
        att_id = body.get("attachmentId")
        data = body.get("data", "")

        if att_id or filename:
            result["attachments"].append({
                "filename": filename,
                "content_type": mime,
                "attachment_id": att_id,
                "msg_id": result["uid"],
                "data": None,
            })
        elif mime == "text/plain" and data and not result["body_text"]:
            try:
                result["body_text"] = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            except Exception:
                pass
        elif mime == "text/html" and data and not result["body_html"]:
            try:
                result["body_html"] = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            except Exception:
                pass

    def fetch_attachment_data(self, msg_id: str, attachment_id: str) -> bytes:
        """שולף bytes של קובץ מצורף מ-Gmail."""
        try:
            resp = self._exec(
                self.service.users().messages().attachments().get(
                    userId="me", messageId=msg_id, id=attachment_id
                )
            )
            return base64.urlsafe_b64decode(resp.get("data", "") + "==")
        except Exception:
            return b""
