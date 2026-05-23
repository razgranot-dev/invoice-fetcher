// Hit the local worker /scan endpoint with the stored creds. Mirrors the
// exact request shape that web/src/lib/worker.ts sends. Verifies the
// fix surfaces a clear AUTH_ERROR (no scope) instead of a confusing 401.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credsPath = path.join(os.tmpdir(), 'invoice_fetcher_diag_creds.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const body = {
  access_token: creds.access_token,
  refresh_token: creds.refresh_token,
  token_expiry: creds.token_expiry,
  keywords: [],
  days_back: 1,
  unread_only: false,
  scan_id: 'diagnostic-scan-001',
};

const t0 = Date.now();
const res = await fetch('http://127.0.0.1:8001/scan', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});
console.log('HTTP', res.status, 'in', Date.now() - t0, 'ms');

const text = await res.text();
// Redact any access_token-looking strings before printing
const redacted = text.replace(/ya29\.[A-Za-z0-9_\-.]+/g, 'ya29.<redacted>');
console.log(redacted.slice(0, 1500));
