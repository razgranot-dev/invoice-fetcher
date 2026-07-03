// H2 live consistency check: the invoices page "in report" view and the
// filter-mode CSV export must agree row-for-row now that both resolve
// suppliers through the persisted Invoice.supplierKey.
import fs from 'node:fs';

const envPath = 'C:/Users/razg/Desktop/invoice-fetcher/web/.env';
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2];
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}
const BASE = 'http://localhost:3001';
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const r = await client.query(`SELECT "sessionToken" FROM sessions WHERE expires > NOW() ORDER BY expires DESC LIMIT 1`);
const cookie = `authjs.session-token=${r.rows[0].sessionToken}`;

// Excluded suppliers (page hides these; export must too)
const excl = await client.query(`SELECT name FROM suppliers WHERE "isRelevant" = false`);
console.log('excluded suppliers:', excl.rows.map(x => x.name).join(', ') || '(none)');

// DB truth mirroring the page's report view: INCLUDED && supplierKey not excluded
const dbCount = await client.query(
  `SELECT COUNT(*) FROM invoices
   WHERE "reportStatus" = 'INCLUDED'
     AND COALESCE("supplierKey",'') NOT IN (SELECT name FROM suppliers WHERE "isRelevant" = false)`);
console.log('DB report-view count (INCLUDED minus excluded keys):', dbCount.rows[0].count);
await client.end();

// Page data source
const api = await fetch(`${BASE}/api/invoices?reportStatus=INCLUDED&limit=2000`, { headers: { Cookie: cookie } });
const apiBody = await api.json();
const apiCount = Array.isArray(apiBody?.invoices) ? apiBody.invoices.length : (apiBody?.total ?? 'unknown-shape');
console.log(`/api/invoices reportStatus=INCLUDED -> HTTP ${api.status}, count=${apiCount}`);

// Filter-mode CSV (report scope)
const csv = await fetch(`${BASE}/api/invoices/export`, { headers: { Cookie: cookie } });
const text = await csv.text();
const rows = text.replace(/^﻿/, '').trim().split('\n').length - 1;
console.log(`CSV filter-mode -> HTTP ${csv.status}, rows=${rows}`);
