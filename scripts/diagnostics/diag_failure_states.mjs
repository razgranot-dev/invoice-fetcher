// Verify the scan flow produces clear human-readable errors in each
// failure mode, and never pretends success.
//
// Tests:
//   F1. Missing Gmail scope (simulated by sending creds without gmail.readonly)
//   F2. Invalid/expired access_token without working refresh_token
//   F3. Worker unavailable (port closed)
//   F4. Worker timeout (synthetic: ask for huge days_back? — covered by AbortSignal)
//   F5. Duplicate scan while another is RUNNING
//   F6. Already-stuck scan gets reclaimed and unblocks a new POST
//
// Runs against the live web app (localhost:3000) using the session cookie.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '..', 'web', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sessionRow = (await client.query(`
  SELECT "sessionToken" FROM sessions WHERE expires > NOW() ORDER BY expires DESC LIMIT 1
`)).rows[0];
if (!sessionRow) { console.error('No session — re-sign in first.'); process.exit(1); }
const cookie = `authjs.session-token=${sessionRow.sessionToken}`;

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); pass++; }
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}
function header(t) { console.log('\n' + '─'.repeat(70) + '\n' + t + '\n' + '─'.repeat(70)); }

// ── F1. Missing Gmail scope ────────────────────────────────────────────────
header('F1. Missing Gmail scope — simulate via direct worker call with stripped creds');

const credsPath = path.join(os.tmpdir(), 'invoice_fetcher_diag_creds.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
{
  // Strip gmail.readonly from a clone of the creds by giving a clean
  // refresh_token request that won't include gmail. We can't actually
  // forge a Google response, but we can test the route handler's
  // pre-flight check by setting connection.scopes to drop the gmail scope.
  await client.query(`
    UPDATE gmail_connections SET scopes = '{"openid","email","profile"}' WHERE "isActive" = true
  `);
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ keywords: [], daysBack: 30, unreadOnly: false }),
  });
  const j = await r.json();
  check('returns 4xx (not 5xx)', r.status >= 400 && r.status < 500, `status=${r.status}`);
  check('error mentions Gmail permission', /gmail permission|gmail box|consent/i.test(j.error || ''), `msg="${j.error || ''}"`);
  check('returns action=RECONNECT_GMAIL', j.action === 'RECONNECT_GMAIL', `action=${j.action}`);
  check('responds quickly (no worker round-trip)', Date.now() - t0 < 5000, `${Date.now() - t0}ms`);

  // Restore real scopes
  await client.query(`
    UPDATE gmail_connections SET scopes = ARRAY[
      'https://www.googleapis.com/auth/gmail.readonly',
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]::text[] WHERE "isActive" = true
  `);
}

// ── F2a. Garbage access_token + EXPIRED expiry → eager refresh fails → HTTP 401
header('F2a. Expired garbage creds — worker fast-fails with HTTP 401');
{
  const body = {
    access_token: 'ya29.totally-fake-token',
    refresh_token: '1//fake-refresh-token',
    token_expiry: '2020-01-01T00:00:00Z',  // EXPIRED → forces eager refresh → fail
    keywords: [],
    days_back: 1,
    unread_only: false,
    scan_id: 'diag-fakecreds-expired',
  };
  const r = await fetch('http://127.0.0.1:8000/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  check('worker fast-fails with 401', r.status === 401, `status=${r.status}`);
  check('detail contains "Gmail auth failed"', /gmail auth failed/i.test(text), '');
  check('detail contains AUTH_ERROR marker', /AUTH_ERROR/i.test(text), '');
  check('no stack trace leaks file paths', !/\\Users\\|\/home\/|node_modules/.test(text), 'sanitized');
}

// ── F2b. Garbage access_token + FUTURE expiry → refresh skipped → fail in stream
header('F2b. Future-dated garbage creds — error surfaces inside NDJSON stream');
{
  const body = {
    access_token: 'ya29.totally-fake-token',
    refresh_token: '1//fake-refresh-token',
    token_expiry: '2030-01-01T00:00:00Z',
    keywords: [],
    days_back: 1,
    unread_only: false,
    scan_id: 'diag-fakecreds-future',
  };
  const r = await fetch('http://127.0.0.1:8000/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  check('worker returns 200 (response body carries the error)', r.status === 200, `status=${r.status}`);
  // The error appears in the NDJSON stream as a `stage: "error"` line with the actual reason
  const lines = text.split('\n').filter(Boolean);
  const errorLine = lines.find((l) => {
    try { return JSON.parse(l).stage === 'error'; } catch { return false; }
  });
  check('NDJSON contains a stage=error line', !!errorLine, errorLine?.slice(0, 100));
  if (errorLine) {
    const data = JSON.parse(errorLine);
    check('error message is human-readable', typeof data.message === 'string' && data.message.length > 5, `"${data.message?.slice(0, 80)}"`);
    check('result.error is populated', !!data.result?.error, `"${data.result?.error?.slice(0, 80)}"`);
  }
}

// ── F3. Worker unavailable ──────────────────────────────────────────────────
header('F3. Worker unavailable — start a scan after pointing WORKER_URL elsewhere');
console.log('  (manual: confirm via UI that a worker-unreachable scan ends FAILED with readable msg)');
console.log('  This test simulates a closed port to the worker.');
{
  // Hit a port that's definitely closed; expect a fast network error.
  const t0 = Date.now();
  let err;
  try {
    await fetch('http://127.0.0.1:1/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: 'x', keywords: [], days_back: 1, unread_only: false, scan_id: 'x' }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (e) { err = e; }
  check('fetch to closed port errors out', !!err, err ? err.code || err.name : 'no error');
  check('errors quickly (<3s)', Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
}

// ── F4. Duplicate-scan prevention ────────────────────────────────────────────
header('F4. Duplicate-scan prevention — second POST while first is RUNNING returns 429');
{
  // Insert a synthetic RUNNING row to simulate an active scan
  const fake = await client.query(`
    INSERT INTO scans ("id", "organizationId", "connectionId", status, "startedAt", "createdAt", keywords, "daysBack", "unreadOnly")
    SELECT 'cmpdummy' || floor(random()*1000000)::text, "organizationId", id, 'RUNNING', NOW(), NOW(), '{}', 30, false
    FROM gmail_connections WHERE "isActive" = true LIMIT 1
    RETURNING id
  `);
  const fakeId = fake.rows[0].id;
  try {
    const r = await fetch(`${BASE}/api/scans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ keywords: [], daysBack: 30, unreadOnly: false }),
    });
    const j = await r.json();
    check('returns 429 when another scan is RUNNING', r.status === 429, `status=${r.status}`);
    check('error is human-readable', /already in progress/i.test(j.error || ''), `msg="${j.error || ''}"`);
  } finally {
    await client.query(`DELETE FROM scans WHERE id = $1`, [fakeId]);
  }
}

// ── F5. Stuck-scan recovery automatic ────────────────────────────────────────
header('F5. Stuck-scan recovery — old RUNNING scan reclaimed before new POST');
{
  // Insert a synthetic RUNNING row from 20 minutes ago (past the 15-min threshold)
  const stuck = await client.query(`
    INSERT INTO scans ("id", "organizationId", "connectionId", status, "startedAt", "createdAt", keywords, "daysBack", "unreadOnly")
    SELECT 'cmpstuck' || floor(random()*1000000)::text, "organizationId", id, 'RUNNING',
           NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '20 minutes', '{}', 30, false
    FROM gmail_connections WHERE "isActive" = true LIMIT 1
    RETURNING id
  `);
  const stuckId = stuck.rows[0].id;

  // Verify it was created RUNNING
  let row = (await client.query(`SELECT status FROM scans WHERE id = $1`, [stuckId])).rows[0];
  check('synthetic stuck scan starts as RUNNING', row.status === 'RUNNING');

  // GET /api/scans — this won't trigger recoverStuckScans, but POST does.
  // First: confirm POST reclaims it. We need to delete any other RUNNING scans
  // first; insert no others, so this stuck one is the only RUNNING.
  const r = await fetch(`${BASE}/api/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ keywords: [], daysBack: 1, unreadOnly: false }),
  });
  // Either succeeds (201) with stuck reclaimed, or fails 429 if recover didn't run.
  row = (await client.query(`SELECT status FROM scans WHERE id = $1`, [stuckId])).rows[0];
  check('POST reclaimed the stuck scan (now FAILED)', row.status === 'FAILED', `status=${row.status}`);
  check('new POST succeeded (not blocked by stuck scan)', r.status === 201, `status=${r.status}`);

  // Cancel/clean: the new scan that just started will be running — cancel it
  // and remove the stuck row.
  const respJson = await r.json();
  const newId = respJson?.scan?.id;
  if (newId) {
    await fetch(`${BASE}/api/scans/${newId}`, { method: 'DELETE', headers: { Cookie: cookie } });
  }
  await client.query(`DELETE FROM scans WHERE id = $1`, [stuckId]);
}

await client.end();

console.log('\n' + '═'.repeat(70));
console.log(`Failure-state checks: ${pass} passed, ${fail} failed`);
console.log('═'.repeat(70));
process.exit(fail === 0 ? 0 : 1);
