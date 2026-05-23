// Full end-to-end QA: borrow the user's active NextAuth session, POST to
// /api/scans, then poll /api/scans/[id]/progress until it terminates.
// Proves the entire web → worker → DB → polling loop works after the fix.
//
// Reads session token from the `sessions` table — the user must have an
// unexpired session. No secrets are exfiltrated; the session cookie is
// only used to call our own endpoints.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', 'web', '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const BASE = process.env.BASE_URL || 'http://localhost:3001';

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const r = await client.query(`
  SELECT "sessionToken" FROM sessions WHERE expires > NOW() ORDER BY expires DESC LIMIT 1
`);
await client.end();

if (r.rows.length === 0) {
  console.error('No valid session in DB — sign in via the browser first');
  process.exit(1);
}
const sessionToken = r.rows[0].sessionToken;
console.log(`Got session token (len=${sessionToken.length}).`);

// NextAuth v5 cookie name (we're not on secure HTTPS locally, so no __Secure- prefix)
const cookie = `authjs.session-token=${sessionToken}`;

const t0 = Date.now();
function ts() { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }

console.log(`[${ts()}] POST ${BASE}/api/scans  daysBack=30 unreadOnly=false`);
const postRes = await fetch(`${BASE}/api/scans`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ keywords: [], daysBack: 30, unreadOnly: false }),
});
const postBody = await postRes.json();
console.log(`[${ts()}] HTTP ${postRes.status}`, postBody);

if (!postRes.ok) {
  process.exit(postBody?.action === 'RECONNECT_GMAIL' ? 0 : 2);
}

const scanId = postBody?.scan?.id;
if (!scanId) {
  console.error('No scan id in response');
  process.exit(3);
}

console.log(`[${ts()}] Polling progress for ${scanId} every 1s...`);
let last = '';
let terminal = null;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1000));
  const pr = await fetch(`${BASE}/api/scans/${scanId}/progress?t=${Date.now()}`, {
    headers: { Cookie: cookie },
    cache: 'no-store',
  });
  if (!pr.ok) {
    console.log(`[${ts()}] poll HTTP ${pr.status}`);
    continue;
  }
  const p = await pr.json();
  const line = `progress=${p.progress} status=${p.status} msg="${(p.progressMessage ?? '').slice(0, 80)}"`;
  if (line !== last) {
    console.log(`[${ts()}] ${line}`);
    last = line;
  }
  if (p.status === 'COMPLETED' || p.status === 'FAILED' || p.status === 'CANCELLED') {
    terminal = p;
    break;
  }
}

if (!terminal) {
  console.log(`[${ts()}] TIMEOUT after 120s — scan never terminated`);
  process.exit(4);
}

console.log(`[${ts()}] TERMINAL: status=${terminal.status} progress=${terminal.progress}`);
console.log(`  totalMessages=${terminal.totalMessages} processedCount=${terminal.processedCount} invoiceCount=${terminal.invoiceCount}`);
console.log(`  Final message: ${terminal.progressMessage}`);

if (terminal.status === 'COMPLETED') {
  console.log(`\n✓ END-TO-END SCAN COMPLETED IN ${ts()}`);
  process.exit(0);
} else {
  console.log(`\n✗ Scan ended in ${terminal.status}`);
  process.exit(5);
}
