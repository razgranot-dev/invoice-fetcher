# Design: Multi-User Support, Security Hardening & UI Polish

**Date:** 2026-03-07
**Status:** Approved

---

## Goals

1. Support multiple simultaneous users each with their own Gmail account (true multi-user SaaS)
2. Fix all identified security vulnerabilities
3. Polish the UI — professional look, fix awkward sidebar days control
4. App must work both as a local ZIP download and as a Streamlit Cloud web app

**Language:** Hebrew (UI stays in Hebrew)

---

## Architecture: Session-State Token Storage

### Problem
`GmailConnector` currently reads/writes `token.json` to disk — a single shared file. On Streamlit Cloud, the first user to authenticate "captures" the token and all subsequent visitors operate under that Gmail account.

### Solution
Store the OAuth token as a JSON string in `st.session_state["_creds_json"]`. No file I/O for tokens.

```
Browser Session A → st.session_state["_creds_json"] = "user-A-token"
Browser Session B → st.session_state["_creds_json"] = "user-B-token"
(isolated by Streamlit's session model)
```

### Changes to `core/gmail_connector.py`
- Remove `TOKEN_FILE` constant and `self.token_path`
- `is_authenticated(session_state)` — reads `session_state.get("_creds_json")`
- `exchange_code()` — returns creds JSON string (caller stores in session_state)
- `authenticate(creds_json)` — accepts creds JSON, refreshes if expired, returns updated JSON
- `revoke_token()` — caller deletes `st.session_state["_creds_json"]`
- Remove dead code: `InstalledAppFlow`, `_build_client_config()`, `authenticate()` local-server flow

### Changes to `app.py`
- Pass `st.session_state` to `is_authenticated()` and `authenticate()`
- Store/clear `_creds_json` in session_state on connect/disconnect

### Changes to `dashboard/scanner.py`
- Build `GmailConnector` with creds from `st.session_state["_creds_json"]`
- After token refresh, update `st.session_state["_creds_json"]`

### Changes to `dashboard/welcome_screen.py`
- `exchange_code()` result stored in `st.session_state["_creds_json"]`

---

## Security Fixes

### 🔴 Critical
| # | Issue | Fix |
|---|-------|-----|
| 1 | Shared `token.json` on disk | Session-state storage (see Architecture) |
| 2 | Debug expander visible to all users | Remove entirely |

### 🟡 Medium
| # | Issue | Fix |
|---|-------|-----|
| 3 | Path traversal in attachment filenames | After path construction, assert `resolved.is_relative_to(base_dir)`; skip if not |
| 4 | No attachment file size limit | Reject attachments > 25 MB |
| 5 | PKCE `code_verifier` exposed in `?state=` URL param | Use a random CSRF token in `state`; keep verifier only in `session_state` |
| 6 | `InstalledAppFlow.run_local_server()` dead code on cloud | Remove `authenticate()` local-server path and `InstalledAppFlow` import |

### 🟢 Minor
| # | Issue | Fix |
|---|-------|-----|
| 7 | Hardcoded stale commit hash in debug panel | Panel removed entirely |
| 8 | Redundant `sys.path.insert` in multiple files | Remove from files where not needed |
| 9 | `redirect_uris: []` in web client config | Add inline comment explaining Google Console requirement |

---

## UI / UX Changes

### Sidebar — Days Control
Replace the 7–365 slider with 4 preset buttons:

```
[ 7 ימים ]  [ 30 יום ]  [ 90 יום ]  [ שנה ]
```

- Selected button is visually highlighted (active state via CSS)
- Value stored in `st.session_state["_days_back"]`, default 30

### Sidebar — Cleanup
- Remove double-label pattern (manual markdown label + widget label = awkward duplication)
- Remove debug expander

### Welcome Screen — Button Inside Card
Currently `.welcome-panel` HTML closes before the Streamlit button is rendered, creating a visual gap. Fix: render the link button *inside* the `with center:` column immediately after the panel markdown, then use CSS to visually "attach" it — or restructure to render the entire card including button as one HTML block using `st.link_button` placed directly under the panel with zero margin.

### Other
- Replace page icon 🏊 → 📊
- Remove `time.sleep(1.2)` after OAuth success
- Remove unused `sys.path.insert` calls

---

## Files Changed

| File | Changes |
|------|---------|
| `core/gmail_connector.py` | Session-state token storage, remove dead code, fix PKCE state param, add attachment size limit |
| `core/attachment_handler.py` | Path traversal check, file size limit |
| `app.py` | Pass session_state to connector, remove debug expander, fix page icon |
| `dashboard/components.py` | Replace slider with preset buttons, remove double labels |
| `dashboard/welcome_screen.py` | Fix button placement, update exchange_code to use session_state |
| `dashboard/scanner.py` | Load creds from session_state, update after refresh |

---

## Out of Scope
- Internationalization / multi-language support
- Persistent sessions across browser refreshes (would require DB)
- Analytics enhancements
- Download of raw attachment files from the UI
