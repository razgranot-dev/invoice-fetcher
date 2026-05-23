// Production-aware end-to-end scan: same logic as diag_e2e_scan.mjs but
// uses the HTTPS-secure NextAuth cookie name when BASE_URL is https://.
//
// Usage:  BASE_URL=https://invoice-fetcher.vercel.app node scripts/diag_prod_scan.mjs
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
const DAYS_BACK = Number(process.env.DAYS_BACK || 30);
const cookieName = BASE.startsWith('https://') ? '__Secure-authjs.session-token' : 'authjs.session-token';

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const r = await client.query(`
  SELECT "sessionToken" FROM sessions WHERE expires > NOW() ORDER BY expires DESC LIMIT 1
`);
await client.end();

if (r.rows.length === 0) { console.error('No valid session — sign in via browser first'); process.exit(1); }
const cookie = `${cookieName}=${r.rows[0].sessionToken}`;
console.log(`Cookie name: ${cookieName}  (len=${r.rows[0].sessionToken.length})`);

const t0 = Date.now();
function ts() { return ((Date.now() - t0) / 1000).toFixed(2) + 's'; }

console.log(`[${ts()}] POST ${BASE}/api/scans  daysBack=${DAYS_BACK} unreadOnly=false`);
const postRes = await fetch(`${BASE}/api/scans`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ keywords: [], daysBack: DAYS_BACK, unreadOnly: false }),
});
const postBody = await postRes.json();
console.log(`[${ts()}] HTTP ${postRes.status}`, JSON.stringify(postBody).slice(0, 300));

if (!postRes.ok) {
  process.exit(postBody?.action === 'RECONNECT_GMAIL' ? 0 : 2);
}

const scanId = postBody?.scan?.id;
if (!scanId) { console.error('No scan id in response'); process.exit(3); }

console.log(`[${ts()}] Polling progress for ${scanId} (every 1.5s)...`);
let last = '';
let terminal = null;
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  const pr = await fetch(`${BASE}/api/scans/${scanId}/progress?t=${Date.now()}`, {
    headers: { Cookie: cookie }, cache: 'no-store',
  });
  if (!pr.ok) { console.log(`[${ts()}] poll HTTP ${pr.status}`); continue; }
  const p = await pr.json();
  const line = `progress=${p.progress} status=${p.status} msg="${(p.progressMessage ?? '').slice(0, 80)}"`;
  if (line !== last) { console.log(`[${ts()}] ${line}`); last = line; }
  if (p.status === 'COMPLETED' || p.status === 'FAILED' || p.status === 'CANCELLED') { terminal = p; break; }
}

if (!terminal) { console.log(`[${ts()}] TIMEOUT after 180s`); process.exit(4); }

console.log(`\n[${ts()}] TERMINAL status=${terminal.status} progress=${terminal.progress}`);
console.log(`  totalMessages=${terminal.totalMessages} processedCount=${terminal.processedCount} invoiceCount=${terminal.invoiceCount}`);
console.log(`  Final message: ${terminal.progressMessage}`);

if (terminal.status === 'COMPLETED') {
  console.log(`\n✓ PRODUCTION SCAN COMPLETED IN ${ts()}`);
  process.exit(0);
} else {
  console.log(`\n✗ Scan ended in ${terminal.status}`);
  process.exit(5);
}
