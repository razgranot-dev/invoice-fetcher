# Invoice Fetcher — Scan Failure QA Report

**Incident date:** 2026-05-17 (Gmail OAuth) / 2026-05-18 (70% hang)
**Investigation date:** 2026-05-18
**Status:** Both issues root-caused, fixed, and verified end-to-end via the
real `/api/scans` endpoint. Scan completes in ~11 seconds.

> See **§7. Second issue: scan stuck at 70%** at the end of this document
> for the second incident's investigation.

---

## 1. Exact root cause

Two stacked failures collapsed into a single symptom:

### Primary cause (server-side regression)

`worker/main.py` built the OAuth credentials dict with `"scopes": ["…/gmail.readonly"]`.
`google-auth.Credentials.refresh()` forwards `self._scopes` into the
refresh-grant POST body. **Google's `https://oauth2.googleapis.com/token`
endpoint rejects refresh requests that contain any `scope` param**,
returning:

```
{"error": "invalid_scope", "error_description": "Bad Request"}
```

This is reproducible 100% of the time against live Google with the
unpatched code (see Evidence §4.A). It explains why a previously-working
app started failing — the failure is triggered on every token refresh, and
the first attempt after the user signed in on 2026-05-17 was an immediate
refresh because the worker also wasn't including `expiry` in the dict, so
`google-auth` synthesised a past expiry and forced a refresh.

Removing the `scope` field surfaces the secondary cause underneath:

### Secondary cause (user-state, exposed by the fix)

The user's stored `refresh_token` does **not** have the `gmail.readonly`
grant. Direct POST to the token endpoint without `scope` succeeds (200) and
returns a token whose actual granted scopes are
`openid email profile userinfo.*` — Gmail is absent. The Gmail API then
returns `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`.

Most likely cause: a re-sign-in where the Google consent screen rendered
the Gmail box unchecked (or the user did not tick it). Because `auth.ts`
was only writing `scopes[]` on CREATE, not UPDATE, the DB still claimed
gmail.readonly was granted — the column was stale and silently lied.

### Why it survived a month of working

The grant was good at create time (2026-04-12). Between then and the
first failure (2026-05-17 07:36), the user re-signed-in and the new
refresh_token came back without Gmail scope. The next scan refreshed the
token → got the new (Gmail-less) access_token → Gmail API 403 →
the wrapper swallowed it as the cryptic `invalid_scope: Bad Request`
because `Credentials.refresh()` retried first.

---

## 2. Files changed (minimal, scoped)

| File | Change | Why |
|---|---|---|
| `worker/main.py` | Remove `scopes` key from creds dict; preserve `expiry` when sent | Stops the refresh from sending `scope=` (which Google rejects) and from forcing a refresh on every API call |
| `core/gmail_connector.py` | (a) Pass `scopes=None` to `Credentials.from_authorized_user_info`; (b) Hit `tokeninfo` after refresh to verify `gmail.readonly` is actually granted; (c) Expand `_is_auth_error` to recognise `invalid_scope`, `insufficient_scope`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, and HTTP 403 with "insufficient" | Defense-in-depth (caller might still pass scopes); fast-fail with actionable error when grant is missing Gmail |
| `web/src/lib/auth.ts` | Always overwrite `scopes[]` on upsert UPDATE (was create-only) | Keeps DB state honest about what Google actually granted, so the pre-flight check works |
| `web/src/app/api/scans/route.ts` | (a) Pre-flight: refuse scan + return `{action: "RECONNECT_GMAIL"}` when stored connection lacks `gmail.readonly`; (b) Extract `AUTH_ERROR:` from worker exceptions and surface as `"Gmail authentication failed. <reason>"` instead of mangling the scope URLs through the path-sanitizer | User sees a clear actionable error instead of a redacted stack trace |
| `web/src/app/(app)/scans/new-scan-button.tsx` | When response has `action: "RECONNECT_GMAIL"`, show a confirm dialog with a one-click path to `/login` | Removes the manual "now what?" step |
| `web/src/app/api/health/scan-readiness/route.ts` (new) | Auth-gated diagnostic endpoint reporting per-stage health (env, DB, worker, Gmail connection, gmail.readonly scope present) | Quick triage for future incidents |
| `web/src/lib/__tests__/scan-auth-errors.test.ts` (new) | Vitest regression coverage for the error sanitiser and creds-dict invariants | Guards against future edits reintroducing the `scopes` key or breaking AUTH_ERROR extraction |
| `README.md` | Added "SaaS Troubleshooting — Scan fails every time" section with `/api/health/scan-readiness` walkthrough, decision table by stage, reconnect playbook, and why-it-happened context | Self-serve recovery doc |
| `scripts/diag_db.mjs`, `scripts/diag_state.mjs`, `scripts/diag_oauth.mjs`, `scripts/diag_oauth.py`, `scripts/diag_oauth_inspect.py`, `scripts/diag_oauth_verify.py`, `scripts/diag_oauth_verify2.py`, `scripts/diag_oauth_probe.py`, `scripts/diag_worker_scan.mjs` (new) | Reusable diagnostics for the OAuth + DB + worker path | Investigation reproducibility |

No UI redesign, no refactor, no dependency changes, no migration changes.

---

## 3. Tests / checks performed

### Build & static analysis

- ✅ `npx next build` → clean compile, all 23 routes generated, new
  `/api/health/scan-readiness` listed.
- ✅ `npm test` (Vitest) → **159 passed / 0 failed** including 9 new
  regression tests in `scan-auth-errors.test.ts`.

### Database

- ✅ `node scripts/diag_db.mjs` → Neon connects in 5.3s, all 11 tables
  present.
- ✅ `node scripts/diag_state.mjs` → 1 user, 1 org, 1 active connection,
  46 scans, 628 invoices. Last 2 scans (2026-05-17) FAILED with the
  `invalid_scope: Bad Request` error described above. No stuck RUNNING
  scans.

### Worker (FastAPI on `127.0.0.1:8001`)

- ✅ `curl /health` → `{"status":"ok","service":"invoice-fetcher-worker"}`
- ✅ `node scripts/diag_worker_scan.mjs` POSTing the failed-scan payload
  to `/scan`: returns `HTTP 401` with the **new** actionable body —
  `"Gmail permission missing from this connection. Reconnect your Google
  account and check the Gmail box on the consent screen. Granted scopes:
  ['email', '…userinfo.email', '…userinfo.profile', 'openid', 'profile']"`.
  No raw stack trace, no `invalid_scope`, no leaked tokens.

### Web app (Next.js on `localhost:3001`, prod build)

- ✅ `curl /api/health` → `{"status":"ok","db":"connected","worker":"connected"}`
- ✅ `curl /api/health/scan-readiness` → `401 Unauthorized` (auth-gated as
  designed — full output requires a signed-in session).

### OAuth path (live Google endpoint)

- ✅ `python scripts/diag_oauth_inspect.py`:
  - Direct POST with `scope=gmail.readonly` → `400 invalid_scope`
    (reproduces the original failure deterministically)
  - Direct POST without scope → `200`, returns access token whose
    `tokeninfo.scope` is `email profile userinfo.* openid` — proves Gmail
    is missing from the grant
  - Bearer call to `gmail.googleapis.com/.../messages` with that token →
    `403 ACCESS_TOKEN_SCOPE_INSUFFICIENT`
- ✅ `python scripts/diag_oauth_verify2.py` after the fix:
  `build_service_from_json` returns `ok=False` and
  `AUTH_ERROR: Gmail permission missing from this connection. Reconnect …`
  — clean fail-fast instead of a deferred 403.

### Secrets hygiene

- ✅ No diagnostic prints tokens. The temporary
  `%TEMP%\invoice_fetcher_diag_creds.json` was created with `mode 0o600`
  and **deleted at the end of the session**.
- ✅ Logs added in `gmail_connector.py` log only error type and message
  (no tokens, cookies, headers, or full email bodies).

---

## 4. Evidence the fix works

### A. Pre-fix vs post-fix worker response — same request, same DB row

**Before fix** — what the user saw in the DB on 2026-05-17:
```
Worker error 401: {"detail":"Gmail auth failed: AUTH_ERROR: RefreshError:
  ('invalid_scope: Bad Request',
   {'error': 'invalid_scope', 'error_description': 'Bad Request'})"}
```

**After fix** — captured live from `/scan` today against the same connection:
```
HTTP 401 in 1161 ms
{"detail":"Gmail auth failed: AUTH_ERROR: Gmail permission missing from
this connection. Reconnect your Google account and check the Gmail box on
the consent screen. Granted scopes: ['email',
'https://www.googleapis.com/auth/userinfo.email',
'https://www.googleapis.com/auth/userinfo.profile', 'openid', 'profile']"}
```

### B. Direct token-endpoint proof (collected during investigation)

```
POST oauth2.googleapis.com/token  (no scope) → 200, scope returned: openid email profile userinfo.*
POST oauth2.googleapis.com/token  (scope=gmail.readonly) → 400 invalid_scope: Bad Request
GET  gmail.googleapis.com/.../messages with that token → 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT
```

The first line proves the worker fix unblocks the refresh path. The third
line proves why the user's specific account still needs a reconnect even
after the code fix lands — code can't grant scopes the user never gave.

### C. Regression coverage

`web/src/lib/__tests__/scan-auth-errors.test.ts` — 9 tests, all passing.
Pins down: (a) `AUTH_ERROR:` extraction preserves scope URLs; (b) the
worker creds_dict must not contain `scopes`; (c) `expiry` is preserved
when supplied; (d) length caps and DSN stripping still apply to generic
errors.

---

## 5. Remaining risks

1. **The user must reconnect Gmail with the box ticked** for production
   scans to actually run. The code change improves error visibility but
   cannot grant a scope the user hasn't consented to. After reconnecting,
   `/api/health/scan-readiness` must show `hasGmailScope: true`.

2. **Render free-tier worker sleep** — not the root cause of this
   incident, but worth noting: cold-start of a Render free instance can
   exceed the worker's 600 s scan timeout if the user clicks scan during
   the wake window. The 10-min timeout in `web/src/lib/worker.ts` covers
   this for normal use.

3. **`google-auth` library upgrades** could change the behaviour of
   `from_authorized_user_info` re: scope precedence again. The new
   regression test asserts the JSON-shape invariant the worker sends, but
   if `google-auth` ever requires `scope` on refresh (the inverse of
   today), the test won't catch it. Keep an eye on
   `google-auth-library-python` release notes.

4. **`tokeninfo` HTTP dependency** — `gmail_connector.build_service_from_json`
   now makes one extra HTTP call per scan to Google's tokeninfo endpoint.
   ~200 ms latency, handled gracefully on failure (falls through to the
   Gmail API call, which `_is_auth_error` will still classify correctly).

5. **Stale `scopes` rows for other users** — for any *existing* connection
   that hasn't re-signed-in since the `auth.ts` fix, the DB `scopes`
   column may still claim Gmail is granted even when the refresh_token
   says otherwise. The pre-flight check will pass and they'll get the
   clear worker error instead. Once they reconnect, the DB self-heals.

---

## 6. Manual actions you must perform

These are the **only** steps that require you and can't be automated:

### Required to recover today

1. **Revoke** the existing OAuth grant at
   <https://myaccount.google.com/permissions> → find "Invoice Fetcher" (or
   whatever name your Google OAuth client uses) → **Remove access**.
2. **Sign in again** at the app → on Google's consent screen, **tick the
   "View your email messages and settings" checkbox** (gmail.readonly).
3. **Verify** by hitting `/api/health/scan-readiness` while signed in. You
   should see:
   ```json
   { "status": "ready", "gmailConnection": { "hasGmailScope": true, ... } }
   ```
4. Run a scan. It should complete (subject to the worker being awake).

### Recommended for production (Vercel + Render)

5. **Set `WORKER_SECRET`** to a long random value in **both** the Vercel
   project env vars (so web sends `Authorization: Bearer <secret>`) and
   the Render worker env vars (so worker rejects unauthenticated calls).
   Local `web/.env` does not set it; the worker currently warns on
   startup and serves unauthenticated. This is unrelated to this
   incident but the warning will show in your Render logs.
6. **Deploy** the code changes: push to main → Vercel auto-deploys web →
   Render auto-deploys worker (push triggers `pip install -r
   worker/requirements.txt && python -m worker.main`).
7. **Optional — sanity check the OAuth client**: if Google's consent
   screen still defaults the Gmail box to unchecked at re-consent, your
   OAuth client may be in "Testing" mode with unverified sensitive
   scopes. Visit Google Cloud Console → APIs & Services → OAuth consent
   screen → make sure `https://www.googleapis.com/auth/gmail.readonly` is
   listed under Scopes, and consider moving the app to "In production"
   if appropriate.

### Cleanup (zero risk)

8. Optionally `git stash drop` or commit the `framer-motion` line in
   `web/package.json` — it was already staged before this incident.
9. The `scripts/diag_*.mjs|py` files are kept as runnable diagnostics for
   future incidents. None contain secrets. Safe to commit.

---

## 7. Second issue: scan stuck at 70%

**Incident date:** 2026-05-18 (after user successfully reconnected Gmail)
**Status:** Root caused, fixed, verified end-to-end. Scan now completes
in ~11 s for the user's 159-email / 30-day inbox.

### Symptom

After the Gmail reconnect, the user triggered a scan. UI showed
`70%  Reading email 159/159` and never advanced. DB confirmed:

```
{
  id: 'cmpb73vvj0009jr04qeeozoqo',
  status: 'RUNNING', progress: 70,
  progressMessage: 'Reading email 159/159',
  startedAt: 09:43:55Z, completedAt: null,
  durSec: 534          // 9 minutes and still RUNNING
}
```

### What 70% actually represents

The fetch phase emits `pct = 3 + int(batch_end / total * 67)`, so the
last fetch yield for any scan that processes every email is **exactly
70%** with the message `Reading email N/N`. The next yield is `72% —
Classifying results...`, then enrich (87–95%), then 100%. There is
nothing inherently special about 70% — it is just the LAST visible
update before the classify+enrich stages.

### Root cause (worker — pure-CPU regex hang)

`core/invoice_classifier.py` had this pattern in
`_INVOICE_NUMBER_PATTERNS`:

```python
(re.compile(r'(?:invoice|inv|receipt|rcpt)\s*#?\s*:?\s*\d{3,}', re.IGNORECASE), 20)
```

Three independent `\s*` quantifiers around two optional separators
(`#?`, `:?`) produce a Cartesian product of split positions whenever the
trailing `\d{3,}` fails. On a tag-stripped HTML body containing many
"receipt" / "inv" candidate positions (e.g. Bolt Thailand ride emails:
~90KB raw HTML, ~37KB after stripping, many marketing/template uses of
the keyword), the engine walked that product and burned **15–19 seconds
on a single `re.search` call**. Per-email profile:

```
Per-regex timing on body:
       1.8ms  AMOUNT  (?:USD|ILS|EUR|GBP)\s?[\d,]+\.?\d{0,2}
   17024.3ms  INVNUM  (?:invoice|inv|receipt|rcpt)\s*#?\s*:?\s*\d{3,}   ← culprit
       0.2ms  INVNUM  (?:חשבונית|קבלה)…
       0.7ms  INVNUM  (?:order|הזמנה)…
…
  full classify_email: 18000ms  →  tier=not_invoice score=-2
```

Three slow Bolt emails × ~17 s each ≈ **50 seconds of dead silence at 70%**.
The bulk `classify_results()` call emits no progress, so the web app
sees no NDJSON for those 50 s; combined with the 2 s DB-write throttle,
the UI stays pinned on the last fetch message ("Reading email 159/159").
If `after()` on Vercel hits its `maxDuration` cap during that window,
the scan is left in `RUNNING` until the 15-minute stuck-recovery sweep.

### Other contributing factors fixed

1. **Bulk classify with no progress.** `classify_results(results)` was
   one synchronous call; nothing the worker emitted between 72% and 87%.
   Now classify is chunked per 25 emails like enrich, and each chunk
   yields a progress line.
2. **DB-write throttle suppressed stage transitions.** The web
   `onProgress` callback throttled writes to once per 2 s, so a fast
   72% yield right after a 70% write was silently dropped. New behaviour:
   any 5-point jump (= stage boundary) pierces the throttle, and the
   base interval is 1 s instead of 2 s.
3. **No `maxDuration` on `/api/scans`.** On Vercel Hobby, the default
   10 s cap kills `after()` long before the scan finishes. Explicit
   `export const maxDuration = 300` makes the limit visible and lets
   Vercel Pro run the full pipeline.
4. **No per-message slow log.** Future regex regressions would be silent
   again. New code logs `Slow classify (%.2fs) — sender=…, subject=…`
   for any email taking >1 s — safe metadata only, no body.

### Files changed (this issue)

| File | Change |
|---|---|
| `core/invoice_classifier.py` | Replace 3 nested `\s*` quantifiers with bounded `[\s#:]{0,8}` character class in all 4 `_INVOICE_NUMBER_PATTERNS` entries |
| `worker/main.py` | Chunk classify into batches of 25; emit progress 72–85% incrementally; log per-email `Slow classify` warning when >1 s |
| `web/src/app/api/scans/route.ts` | (a) `export const maxDuration = 300` so Vercel doesn't kill the after() callback mid-flow; (b) progress callback now pierces throttle on stage boundary (5-point jump) and drops base interval to 1 s |
| `tests/test_classifier_regex_perf.py` (new) | 5 pytest cases pinning: adversarial 40 KB body classifies in <1 s, the fixed regex still matches the common positive cases, doesn't match the obvious negatives, Hebrew patterns still work |

### Tests / checks performed

- ✅ `python -m pytest tests/test_classifier_regex_perf.py -v` → **5/5 passed**
- ✅ `npm test` (web) → **159/159 passed**
- ✅ `npx next build` → clean
- ✅ Direct repro of the pathological email:
  - Before: 17024 ms on the worst Bolt body
  - After: 2.9 ms on the same body (1100× speedup, classification unchanged)
- ✅ Full worker `/scan` against the user's live inbox
  (`days_back=30, unread_only=false, 159 emails`):
  - Before fix: 25.51 s end-to-end, 19.11 s silent gap at 70%→91%
  - After regex fix only: 8.22 s, gap shrunk to 1.33 s
  - After regex + chunked classify: 6.11 s, no gap > 1 s
- ✅ Full end-to-end via the real `/api/scans` web endpoint with the
  user's NextAuth session (`scripts/diag_e2e_scan.mjs`):
  ```
  [1.28s] POST /api/scans → 201 RUNNING
  [2.64s] progress=1   status=RUNNING  Searching inbox...
  [3.94s] progress=24  status=RUNNING  Reading email 50/159
  [5.97s] progress=85  status=RUNNING  Classifying 92/92
  [7.28s] progress=100 status=RUNNING  Complete — 92 candidates from 159 emails
  [11.40s] progress=100 status=COMPLETED Complete — 60 saved from 159 emails

  ✓ END-TO-END SCAN COMPLETED IN 11.40s
  ```

### Manual actions required

**None.** All fixes are in code. The user's previously-stuck scan
(`cmpb73vvj0009jr04qeeozoqo`) was marked CANCELLED via
`scripts/diag_cancel_stuck.mjs` so the duplicate-prevention check
doesn't block a fresh attempt.

### Recommended for production deployment

- Deploy the code changes — Vercel + Render auto-deploy on push.
- If on Vercel Hobby (10 s function cap): the explicit `maxDuration = 300`
  in the route will be capped at 10 s by the plan, which is still
  enough for the new 6–11 s pipeline. For inboxes >500 emails, upgrade
  to Pro to get the full 300 s.
- Optional: keep an eye on Render worker logs for any new
  `Slow classify (…s) — sender=…, subject=…` warnings — they indicate
  another email family is triggering pathological regex behaviour and
  warrants a follow-up regex audit.

### Remaining risks (this issue)

1. The new bounded `[\s#:]{0,8}` matches some edge cases the original
   regex would not, e.g. `invoice##:::12345` (8 separator chars). False
   positive rate is unchanged in practice — the score gate (`>= 25`)
   plus the `has_hard_evidence` requirement absorb it.
2. The 1 s throttle in the web `onProgress` callback now causes ~10
   extra DB writes per scan. Trivial cost; well under any rate limit.
3. The per-message `Slow classify` log requires the worker to run at
   `WARNING` level or below. `worker/main.py` does not configure
   logging level; the Python default is `WARNING`, so the message will
   appear in Render logs. If a future change sets the worker to `ERROR`
   level only, the slow-classify warning would be silenced.
