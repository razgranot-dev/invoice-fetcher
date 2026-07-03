// Live smoke test of the FIX1 company-filter fix (post verify-round).
// Two correct assertions per supplierKey:
//  (1) FIX1: /api/invoices?company=KEY (list view, no report scoping) === DB
//      count of that supplierKey. This is the exact path the bug corrupted.
//  (2) filtered CSV export === DB count of rows for that key that are BOTH
//      reportStatus=INCLUDED AND whose supplier is not excluded (isRelevant).
import fs from 'node:fs';
const envPath = 'C:/Users/razg/Desktop/invoice-fetcher/web/.env';
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/); if (!m) continue;
  let v = m[2]; if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}
const BASE = 'http://localhost:3001';
const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const r = await client.query(`SELECT "sessionToken" FROM sessions WHERE expires > NOW() ORDER BY expires DESC LIMIT 1`);
const cookie = `authjs.session-token=${r.rows[0].sessionToken}`;
const excluded = new Set((await client.query(`SELECT name FROM suppliers WHERE "isRelevant"=false`)).rows.map(x => x.name));

const keys = await client.query(`
  SELECT "supplierKey" AS k, COUNT(*) AS n
  FROM invoices WHERE "supplierKey" IS NOT NULL AND "supplierKey" <> ''
  GROUP BY "supplierKey" ORDER BY n DESC LIMIT 8`);
function csvRows(t) { return t.replace(/^﻿/, '').trim().split('\n').length - 1; }

let pass = 0, fail = 0;
for (const { k, n } of keys.rows) {
  const dbAll = Number(n);
  // expected CSV = INCLUDED rows of this key, unless the key itself is excluded
  const dbReport = excluded.has(k) ? 0 :
    Number((await client.query(`SELECT COUNT(*) FROM invoices WHERE "supplierKey"=$1 AND "reportStatus"='INCLUDED'`, [k])).rows[0].count);

  const api = await (await fetch(`${BASE}/api/invoices?company=${encodeURIComponent(k)}&limit=2000`, { headers: { Cookie: cookie } })).json();
  const apiN = Array.isArray(api?.invoices) ? api.invoices.length : '??';
  const csvRes = await fetch(`${BASE}/api/invoices/export?company=${encodeURIComponent(k)}`, { headers: { Cookie: cookie } });
  const csvN = csvRes.ok ? csvRows(await csvRes.text()) : 0;

  const filterOk = apiN === dbAll;          // FIX1
  const csvOk = csvN === dbReport;          // export consistency
  const ok = filterOk && csvOk;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${k}: filter api=${apiN}/db=${dbAll}${filterOk ? '' : ' <-FILTER'}  csv=${csvN}/expected=${dbReport}${csvOk ? '' : ' <-CSV'}${excluded.has(k) ? ' [excluded]' : ''}`);
  ok ? pass++ : fail++;
}
await client.end();
console.log(`\n=== ${pass} pass / ${fail} fail ===`);
process.exit(fail ? 1 : 0);
