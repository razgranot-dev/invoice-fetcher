# Multi-User, Security & UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the invoice fetcher into a true multi-user app where each browser session authenticates with its own Gmail account, while fixing all security vulnerabilities and polishing the UI.

**Architecture:** OAuth tokens move from `token.json` on disk to `st.session_state["_creds_json"]` in memory, making each Streamlit session independent. `GmailConnector` is refactored to accept/return credentials as JSON strings rather than reading/writing files.

**Tech Stack:** Python 3.10+, Streamlit ≥ 1.32, google-auth-oauthlib, google-api-python-client, Plotly

---

## Task 1: Refactor GmailConnector — session-state token storage

**Files:**
- Modify: `core/gmail_connector.py`

No formal test suite exists; verification is manual via the running app. Each step is self-contained and commitable.

**Step 1: Remove file-based token constants and dead imports**

In `core/gmail_connector.py`, make these changes at the top of the file:

```python
# REMOVE these lines:
from google_auth_oauthlib.flow import Flow, InstalledAppFlow
TOKEN_FILE = "token.json"

# REPLACE with:
from google_auth_oauthlib.flow import Flow
```

Also remove `self.token_path = Path(TOKEN_FILE)` from `__init__`, and remove the `Path` import if unused (check: `Path` is only used for `token_path` — remove it).

Updated `__init__`:
```python
def __init__(self):
    self.service: Any = None
    self._client_id = os.getenv("GOOGLE_CLIENT_ID")
    self._client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
```

**Step 2: Update `is_authenticated()` to accept creds_json**

Replace the existing `is_authenticated()` method:

```python
def is_authenticated(self, creds_json: str | None = None) -> bool:
    """Returns True if creds_json contains valid or refreshable credentials."""
    if not creds_json:
        return False
    try:
        creds = Credentials.from_authorized_user_info(
            json.loads(creds_json), SCOPES
        )
        return creds.valid or (creds.expired and bool(creds.refresh_token))
    except Exception:
        return False
```

Add `import json` at the top of the file.

**Step 3: Update `exchange_code()` to return creds JSON**

Replace the existing `exchange_code()`:

```python
def exchange_code(self, code: str, redirect_uri: str, code_verifier: str) -> tuple[bool, str, str]:
    """Exchange OAuth code for token. Returns (success, creds_json, error_message).
    On success, creds_json is a JSON string to store in st.session_state.
    On failure, creds_json is '' and error_message describes the problem.
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
```

**Step 4: Add `build_service_from_json()` — replaces disk-based authenticate()**

Add this new method and remove the old `authenticate()` method entirely:

```python
def build_service_from_json(self, creds_json: str) -> tuple[bool, str]:
    """Load credentials from JSON string, refresh if needed, build Gmail service.
    Returns (success, updated_creds_json).
    updated_creds_json may differ from input if the token was refreshed.
    """
    try:
        creds = Credentials.from_authorized_user_info(
            json.loads(creds_json), SCOPES
        )
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        self.service = build("gmail", "v1", credentials=creds)
        return True, creds.to_json()
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
```

**Step 5: Update `revoke_token()` — no file to delete**

```python
def revoke_token(self) -> bool:
    """Clears the in-memory service. Caller must clear st.session_state['_creds_json']."""
    self.service = None
    return True
```

**Step 6: Fix PKCE state parameter — use separate CSRF token**

Replace `get_auth_url()`:

```python
def get_auth_url(self, redirect_uri: str) -> tuple[str, str, str]:
    """Returns (auth_url, code_verifier, csrf_state).
    Store code_verifier and csrf_state in st.session_state.
    Do NOT put the code_verifier in the state param (it would be visible in URL logs).
    """
    try:
        code_verifier = secrets.token_urlsafe(96)
        code_challenge = base64.urlsafe_b64encode(
            hashlib.sha256(code_verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")

        csrf_state = secrets.token_urlsafe(32)

        flow = Flow.from_client_config(
            self._build_web_client_config(), scopes=SCOPES, redirect_uri=redirect_uri
        )
        auth_url, _ = flow.authorization_url(
            prompt="consent",
            access_type="offline",
            code_challenge=code_challenge,
            code_challenge_method="S256",
            state=csrf_state,  # opaque CSRF token, NOT the verifier
        )
        return auth_url, code_verifier, csrf_state
    except Exception as e:
        raise RuntimeError(
            f"get_auth_url failed | redirect_uri={redirect_uri!r} | "
            f"client_id_set={bool(self._client_id)} | "
            f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        ) from e
```

**Step 7: Remove `_build_client_config()` (desktop flow, dead code)**

Delete the `_build_client_config()` method entirely. Keep `_build_web_client_config()`.

**Step 8: Add comment to `_build_web_client_config()`**

```python
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
```

**Step 9: Commit**

```bash
git add core/gmail_connector.py
git commit -m "refactor(auth): store OAuth tokens in session_state, not token.json

- Remove TOKEN_FILE and disk-based token read/write
- exchange_code() returns creds JSON string (caller stores in session_state)
- build_service_from_json() replaces authenticate() file-based flow
- get_auth_url() uses separate CSRF token in state param (not code_verifier)
- Remove InstalledAppFlow and dead desktop-app auth code

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Fix attachment_handler.py — path traversal + size limit

**Files:**
- Modify: `core/attachment_handler.py`

**Step 1: Add size limit constant**

At the top of the file, after the existing constants:

```python
_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024  # 25 MB
```

**Step 2: Add size check in `save_attachment()`**

After the `if not data:` check, add:

```python
if len(data) > _MAX_ATTACHMENT_BYTES:
    logger.warning(
        "קובץ '%s' גדול מדי (%d בייטים) — מדלג", filename, len(data)
    )
    return None
```

**Step 3: Add path traversal check**

After `dest = self._unique_path(target_dir / safe_name)`, add:

```python
# Safety: ensure the resolved path is inside base_dir (prevents path traversal)
try:
    dest.resolve().relative_to(self.base_dir.resolve())
except ValueError:
    logger.error(
        "ניסיון path traversal זוהה בקובץ '%s' — מדלג", filename
    )
    return None
```

**Step 4: Commit**

```bash
git add core/attachment_handler.py
git commit -m "fix(security): add path traversal check and 25MB size limit for attachments

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Update welcome_screen.py — session_state token + CSRF + button inside card

**Files:**
- Modify: `dashboard/welcome_screen.py`

**Step 1: Update `exchange_code` call to handle new 3-tuple return**

Replace the OAuth callback handling block (starting at `if "code" in st.query_params:`):

```python
if "code" in st.query_params:
    # Validate CSRF state
    returned_state = st.query_params.get("state", "")
    expected_state = st.session_state.get("_oauth_csrf_state", "")
    code_verifier = st.session_state.get("_pkce_code_verifier", "")

    if not expected_state or returned_state != expected_state:
        st.session_state["_oauth_error"] = "CSRF state mismatch — החיבור בוטל מסיבות אבטחה"
        st.error("שגיאת אבטחה: החיבור בוטל. אנא נסה שוב.")
        st.query_params.clear()
        return False

    with st.spinner("מחבר לגוגל..."):
        success, creds_json, err = connector.exchange_code(
            st.query_params["code"], redirect_uri, code_verifier
        )
    st.query_params.clear()
    if success:
        st.session_state["_creds_json"] = creds_json
        st.session_state.pop("_pkce_code_verifier", None)
        st.session_state.pop("_oauth_csrf_state", None)
        st.success("מחובר בהצלחה! טוען את הדשבורד...")
        st.balloons()
        return True
    else:
        st.session_state["_oauth_error"] = err
        st.error(f"החיבור נכשל:\n\n```\n{err}\n```")
```

Note: Remove `import time` and `time.sleep(1.2)` — they are no longer needed.

**Step 2: Update `get_auth_url` call to handle new 3-tuple return**

Replace:
```python
auth_url, code_verifier = connector.get_auth_url(redirect_uri)
st.session_state["_pkce_code_verifier"] = code_verifier
```

With:
```python
auth_url, code_verifier, csrf_state = connector.get_auth_url(redirect_uri)
st.session_state["_pkce_code_verifier"] = code_verifier
st.session_state["_oauth_csrf_state"] = csrf_state
```

**Step 3: Move link button inside the welcome panel**

The current code renders the panel HTML, then the button below it as a separate widget — visually disconnected. Fix by adding a bottom padding section to the panel HTML and placing the Streamlit button immediately after with no extra margin:

After the `st.markdown(...)` call that renders `.welcome-panel`, and after the `st.markdown("<div style='height:16px;'>...</div>")` spacer, keep the button rendering as-is. The visual fix comes from CSS (Task 5) — reduce the gap between panel and button by removing the spacer div:

```python
# Remove this line:
st.markdown("<div style='height:16px;'></div>", unsafe_allow_html=True)
```

And update the welcome panel HTML: change the last `</div>` of the panel to add bottom padding for the button:

Change `padding: 56px 48px 40px 48px;` → `padding: 56px 48px 48px 48px;`

**Step 4: Remove `sys.path.insert` from welcome_screen.py**

Remove these lines (Streamlit runs from the app root, so this is not needed):
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
```

**Step 5: Commit**

```bash
git add dashboard/welcome_screen.py
git commit -m "fix(auth): session_state token storage, CSRF state validation, remove sleep

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Update scanner.py — load creds from session_state

**Files:**
- Modify: `dashboard/scanner.py`

**Step 1: Replace authenticate() call with build_service_from_json()**

Replace the authentication block at the top of `run_email_scan()`:

```python
# REMOVE:
connector = GmailConnector()
if not connector.is_authenticated():
    st.error("שגיאה: לא מחובר לחשבון Gmail...")
    return []
if not connector.authenticate():
    st.error("שגיאה: לא ניתן לאתחל את שירות Gmail...")
    return []

# REPLACE WITH:
creds_json = st.session_state.get("_creds_json", "")
connector = GmailConnector()
if not connector.is_authenticated(creds_json):
    st.error("שגיאה: פג תוקף החיבור. אנא התחבר מחדש.")
    return []

ok, updated_creds_json = connector.build_service_from_json(creds_json)
if not ok:
    st.error(f"שגיאה: לא ניתן לאתחל את שירות Gmail: {updated_creds_json}")
    return []

# Persist refreshed token back to session
st.session_state["_creds_json"] = updated_creds_json
```

**Step 2: Remove `sys.path.insert` from scanner.py**

Remove:
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
```

**Step 3: Commit**

```bash
git add dashboard/scanner.py
git commit -m "fix(scanner): load Gmail creds from session_state, refresh and persist token

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Update app.py — session_state token, remove debug panel, fix icon

**Files:**
- Modify: `app.py`

**Step 1: Replace `_connector.is_authenticated()` call**

The current code at line ~91:
```python
_connector = GmailConnector()
# ══ מצב 1: env vars חסרים
if not _connector.is_configured():
    render_not_configured_screen()
    st.stop()
# ══ מצב 2: לא מחובר
if not _connector.is_authenticated():
    ...
```

Update to:
```python
_connector = GmailConnector()

if not _connector.is_configured():
    render_not_configured_screen()
    st.stop()

_creds_json = st.session_state.get("_creds_json", "")
if not _connector.is_authenticated(_creds_json):
    connected = render_welcome_screen()
    if connected:
        st.rerun()
    st.stop()
```

**Step 2: Update disconnect button**

Replace:
```python
if st.button("🔓 התנתק מ-Gmail", use_container_width=True):
    GmailConnector().revoke_token()
    st.session_state.results = []
    st.session_state.scan_done = False
    st.session_state.connecting = False
    st.rerun()
```

With:
```python
if st.button("🔓 התנתק מ-Gmail", use_container_width=True):
    st.session_state.pop("_creds_json", None)
    st.session_state.results = []
    st.session_state.scan_done = False
    st.rerun()
```

**Step 3: Remove the entire debug expander block**

Delete from `# ── דיבאג: סודות` through the closing `st.markdown("---")` inside the expander — the entire `with st.expander("🔧 Debug: Secrets", ...)` block and the `with st.sidebar:` wrapping it.

**Step 4: Fix page icon**

Change:
```python
page_icon="🏊",
```
To:
```python
page_icon="📊",
```

**Step 5: Remove `sys.path.insert` from app.py**

Remove:
```python
sys.path.insert(0, str(Path(__file__).parent))
```

And remove unused `from pathlib import Path` import if `Path` is not used elsewhere in the file.

**Step 6: Commit**

```bash
git add app.py
git commit -m "fix(app): session_state auth check, remove debug panel, fix page icon

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Update components.py — preset day buttons, remove label duplication

**Files:**
- Modify: `dashboard/components.py`

**Step 1: Replace slider with preset buttons in `render_sidebar()`**

Replace this block:
```python
st.markdown('<p style="...">טווח תאריכים</p>', unsafe_allow_html=True)
days_back = st.slider("ימים אחורה", min_value=7, max_value=365, value=30, step=1, ...)
```

With:
```python
st.markdown(
    '<p style="color:#00C8FF; font-size:0.62rem; text-transform:uppercase; '
    'letter-spacing:0.15em; font-weight:700; margin-bottom:10px; opacity:0.8;">טווח תאריכים</p>',
    unsafe_allow_html=True,
)

_DAY_OPTIONS = [("7 ימים", 7), ("30 יום", 30), ("90 יום", 90), ("שנה", 365)]

if "days_back" not in st.session_state:
    st.session_state["days_back"] = 30

cols = st.columns(len(_DAY_OPTIONS))
for col, (label, val) in zip(cols, _DAY_OPTIONS):
    with col:
        is_active = st.session_state["days_back"] == val
        if st.button(
            label,
            key=f"days_btn_{val}",
            use_container_width=True,
            type="primary" if is_active else "secondary",
        ):
            st.session_state["days_back"] = val

days_back = st.session_state["days_back"]
```

**Step 2: Remove duplicate labels above text_area and checkbox**

Remove these manual markdown labels (the widgets themselves have labels via their `label` parameter and `help` tooltip):

```python
# REMOVE:
st.markdown('<div style="height:16px;"></div>', unsafe_allow_html=True)
st.markdown('<p style="color:#00C8FF; font-size:0.62rem; ...">מילות מפתח</p>', unsafe_allow_html=True)
```

The `st.text_area("מילות מפתח (שורה לכל מילה)", ...)` already shows a label. Keep only the widget.

Similarly remove:
```python
st.markdown('<div style="height:8px;"></div>', unsafe_allow_html=True)
```
above the checkbox (the spacing before it).

**Step 3: Commit**

```bash
git add dashboard/components.py
git commit -m "feat(ui): replace days slider with preset buttons, clean up sidebar labels

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Final verification

**Step 1: Run the app locally**

```bash
streamlit run app.py
```

**Checklist:**
- [ ] Page icon is 📊 (not 🏊)
- [ ] No debug expander in sidebar
- [ ] Sidebar shows 4 day-preset buttons; clicking one highlights it and the others go normal
- [ ] Clicking "התחבר לחשבון Google" opens Google OAuth screen
- [ ] After auth, dashboard loads and shows the connected badge
- [ ] Running a scan fetches emails from the authenticated user's Gmail
- [ ] Disconnect button clears session and returns to welcome screen
- [ ] Open app in two different browsers — each can authenticate with a different Gmail account independently
- [ ] After OAuth, a `token.json` file should NOT appear in the project directory

**Step 2: Verify no `token.json` created**

```bash
ls token.json 2>/dev/null && echo "FAIL: token.json exists" || echo "PASS: no token.json"
```

**Step 3: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: final cleanup after multi-user refactor

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Summary of Security Changes

| Vulnerability | Fixed In |
|--------------|----------|
| Shared token.json (all users same Gmail) | Tasks 1, 3, 4, 5 |
| PKCE code_verifier exposed in URL state param | Task 1 |
| No CSRF validation on OAuth callback | Task 3 |
| Path traversal in attachment filenames | Task 2 |
| No attachment file size limit | Task 2 |
| Dead InstalledAppFlow code (would crash on cloud) | Task 1 |
| Debug panel exposes secrets info to all users | Task 5 |
