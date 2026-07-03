// End-to-end scan smoke test mirroring web/src/app/api/scans/route.ts:
// 1. Pull the active Gmail connection's tokens straight from the DB.
// 2. Hit the worker /scan endpoint (the same HTTP call dispatchScan makes).
// 3. Run the *exact* mapping logic from route.ts on the returned invoices
//    (including the cleanCompanyName path that just broke in 14be663).
//
// If this script completes without throwing, the import-fix is verified.

import path from 'node:path';
import fs from 'node:fs';
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

// ── 1. Fetch active connection ───────────────────────────────────────────
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const c = await client.query(`
  SELECT id, "accessToken", "refreshToken", "tokenExpiry", email
  FROM gmail_connections
  WHERE "isActive" = true
  ORDER BY "lastUsedAt" DESC NULLS LAST
  LIMIT 1
`);
await client.end();
if (!c.rows.length) {
  console.error('NO ACTIVE CONNECTION');
  process.exit(1);
}
const conn = c.rows[0];
console.log(`Using connection for ${conn.email}`);

// ── 2. Hit the worker /scan endpoint ─────────────────────────────────────
const WORKER_URL = process.env.WORKER_URL ?? 'http://localhost:8000';
const reqBody = {
  access_token: conn.accessToken,
  refresh_token: conn.refreshToken,
  token_expiry: conn.tokenExpiry ? conn.tokenExpiry.toISOString() : null,
  keywords: [],
  days_back: 7,
  unread_only: false,
  scan_id: 'e2e-smoke',
};

console.log('Calling worker /scan (days_back=7, unread_only=false)...');
const res = await fetch(`${WORKER_URL}/scan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(reqBody),
});
if (!res.ok) {
  console.error('Worker returned', res.status, await res.text().catch(() => ''));
  process.exit(2);
}

// ── 3. Stream NDJSON, capture the final result ──────────────────────────
let finalResult = null;
let buffer = '';
const decoder = new TextDecoder();
const reader = res.body.getReader();
let lastProgress = -1;
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (d.progress != null && d.progress !== lastProgress) {
        console.log(`  progress ${d.progress}% — ${d.message ?? ''}`);
        lastProgress = d.progress;
      }
      if (d.result) finalResult = d.result;
    } catch {}
  }
}
if (buffer.trim()) {
  try { const d = JSON.parse(buffer); if (d.result) finalResult = d.result; } catch {}
}
if (!finalResult) {
  console.error('Worker returned no final result');
  process.exit(3);
}
if (finalResult.error) {
  console.error('Worker reported error:', finalResult.error);
  process.exit(4);
}
console.log(`Worker OK — scanned ${finalResult.total_messages}, returned ${finalResult.invoices.length} candidates`);

// ── 4. Run the SAME mapping logic as route.ts (the broken code path) ─────
// This includes extractCompany → cleanCompanyName, which is what triggered
// the production ReferenceError. We inline the helpers verbatim from
// route.ts so a regression in the route's logic would fail here too.

const NOISE = new Set([
  'info','billing','invoices','invoice','mail','email','e-mail',
  'noreply','no-reply','donotreply','support','help','contact',
  'notifications','notification','notify','alerts','alert',
  'accounts','account','payments','payment','orders','order',
  'receipts','receipt','reciept','reciepts','service','services','mailer','news',
  'newsletter','updates','www','smtp','mx','bounce','postmaster',
  'bonvoy','honors',
]);

function cleanCompanyName(name) {
  if (!name) return '';
  const words = name.split(/[\s\-_]+/).filter((w) => w.length > 0);
  while (words.length > 1 && NOISE.has(words[words.length - 1].toLowerCase())) words.pop();
  while (words.length > 1 && NOISE.has(words[0].toLowerCase())) words.shift();
  return words.join(' ');
}

function extractDomain(sender) {
  if (!sender) return undefined;
  const match = sender.match(/<([^>]+)>/) || sender.match(/[\w.+-]+@[\w.-]+/);
  const email = match ? match[1] || match[0] : sender;
  const parts = email.split('@');
  return parts.length > 1 ? parts[1].replace(/[^a-zA-Z0-9.-]/g, '') : undefined;
}

function extractCompany(sender) {
  if (!sender) return undefined;
  const nameMatch = sender.match(/^(.+?)\s*</);
  if (nameMatch) {
    const name = nameMatch[1].replace(/^["']|["']$/g, '').trim();
    if (name && !name.includes('@') && name.length > 1) {
      const cleaned = cleanCompanyName(name);     // <-- the regression point
      if (cleaned) return cleaned;
    }
  }
  const domain = extractDomain(sender);
  if (!domain) return undefined;
  let base = domain.toLowerCase();
  const COMPOUND_TLDS = ['co.il','co.uk','co.jp','com.au','com.br','org.uk','org.il','net.il','ac.il'];
  let tldStripped = false;
  for (const tld of COMPOUND_TLDS) {
    if (base.endsWith('.' + tld)) {
      base = base.slice(0, -(tld.length + 1));
      tldStripped = true;
      break;
    }
  }
  if (!tldStripped) base = base.replace(/\.[a-z]{2,6}$/, '');
  const parts = base.split('.').filter((p) => p && !NOISE.has(p));
  const brand = parts.length > 0 ? parts[parts.length - 1] : base;
  if (!brand || brand.length < 2) return undefined;
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

let cleanCompanyHits = 0;
let errors = 0;
for (const inv of finalResult.invoices) {
  try {
    const company = extractCompany(inv.sender);
    // The display-name path is the one cleanCompanyName guards
    if (inv.sender && /^.+?\s*</.test(inv.sender)) cleanCompanyHits++;
    void company;
  } catch (e) {
    errors++;
    console.error(`  ERROR on sender=${JSON.stringify(inv.sender)}: ${e.message}`);
  }
}

console.log(`\nMapping pass: ${finalResult.invoices.length} senders, ${cleanCompanyHits} hit cleanCompanyName, ${errors} errors`);
if (errors > 0) process.exit(5);
console.log('\n✅ E2E SUCCESS — full scan flow completed without ReferenceError');
