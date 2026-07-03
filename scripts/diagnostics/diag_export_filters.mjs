// Live verification of QA-report export bugs (H1, H2, M18, H9-path):
// 1. CSV with tier=possible filter must honor the filter (was: silently exported everything)
// 2. CSV with an INVALID tier must be rejected, not ignored
// 3. Word export with tier=possible must not 400 "Invalid tier value"
// 4. Supplier-exclusion consistency: /api/invoices report-count vs filtered CSV row count
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = 'C:/Users/razg/Desktop/invoice-fetcher/web/.env';
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}
const BASE = 'http://localhost:3001';
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const r = await client.query(`SELECT "sessionToken" FROM sessions WHERE expires > NOW() ORDER BY expires DESC LIMIT 1`);
if (r.rows.length === 0) { console.error('NO SESSION'); process.exit(1); }
const cookie = `authjs.session-token=${r.rows[0].sessionToken}`;

// DB ground truth
const tierCounts = await client.query(`SELECT "classificationTier", COUNT(*) FROM invoices GROUP BY 1 ORDER BY 2 DESC`);
console.log('DB tiers:', tierCounts.rows.map(x => `${x.classificationTier}=${x.count}`).join(' '));
const possibleReport = await client.query(
  `SELECT COUNT(*) FROM invoices WHERE "classificationTier"='possible_financial_email' AND "reportStatus"='INCLUDED'`);
const inReport = await client.query(`SELECT COUNT(*) FROM invoices WHERE "reportStatus"='INCLUDED'`);
console.log(`DB: possible+INCLUDED=${possibleReport.rows[0].count}  total INCLUDED=${inReport.rows[0].count}`);
await client.end();

function csvRows(text) {
  // count data rows (naive: lines minus header; exported CSV has no embedded newlines in our data check context)
  const lines = text.replace(/^﻿/, '').trim().split('\n');
  return lines.length - 1;
}

// 1. CSV with possible tier filter
let res = await fetch(`${BASE}/api/invoices/export?tier=possible_financial_email`, { headers: { Cookie: cookie } });
let body = await res.text();
console.log(`\n[1] CSV tier=possible_financial_email -> HTTP ${res.status}, rows=${res.ok ? csvRows(body) : body.slice(0, 200)}`);

// 2. CSV with invalid tier -> must be 400, not ignored
res = await fetch(`${BASE}/api/invoices/export?tier=possible_invoice`, { headers: { Cookie: cookie } });
body = await res.text();
console.log(`[2] CSV tier=possible_invoice (invalid) -> HTTP ${res.status} body=${body.slice(0, 150)}`);

// 3. Word export with possible tier filter (filter mode)
res = await fetch(`${BASE}/api/exports`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ format: 'WORD', filters: { tier: 'possible_financial_email' } }),
});
body = await res.text();
console.log(`[3] Word export tier=possible -> HTTP ${res.status} body=${body.slice(0, 200)}`);

// 4. Filtered CSV (no filters = report scope) row count vs DB INCLUDED count
res = await fetch(`${BASE}/api/invoices/export`, { headers: { Cookie: cookie } });
body = await res.text();
console.log(`[4] CSV default (report scope) -> HTTP ${res.status}, rows=${res.ok ? csvRows(body) : body.slice(0, 200)} (DB INCLUDED=${inReport.rows[0].count})`);
