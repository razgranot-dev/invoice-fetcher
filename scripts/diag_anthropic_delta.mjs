// Phase-1 evidence: cross-reference Anthropic receipts found in Gmail with
// what's currently persisted in the DB. Prints both lists side by side and
// flags exact misses.

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
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

const auditPath = path.join(os.tmpdir(), 'invoice_fetcher_anthropic_audit.json');
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));

// Filter audit to ACTUAL Anthropic receipts (subject contains "Your receipt from Anthropic")
const gmailReceipts = audit.filter((r) =>
  /your receipt from anthropic/i.test(r.subject || '') &&
  /invoice\+statements@mail\.anthropic\.com/i.test(r.sender || '')
);
console.log(`Anthropic receipts in Gmail: ${gmailReceipts.length}`);

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const dbRows = await client.query(`
  SELECT "gmailMessageId", subject, sender, date, "classificationTier",
         "classificationScore", "reportStatus", "scanId"
  FROM invoices
  WHERE sender ILIKE '%anthropic%' OR subject ILIKE '%anthropic%'
  ORDER BY date DESC NULLS LAST
`);
console.log(`Anthropic invoices in DB: ${dbRows.rows.length}`);

const dbByMid = new Map(dbRows.rows.map((r) => [r.gmailMessageId, r]));
const gmailByMid = new Map(gmailReceipts.map((r) => [r.id, r]));

console.log('\n=== Cross-reference (Gmail receipt × DB row) ===');
const lines = [];
let inDbCount = 0, missingCount = 0;
for (const g of gmailReceipts) {
  const db = dbByMid.get(g.id);
  if (db) {
    inDbCount++;
    lines.push({
      id: g.id,
      date: g.date,
      subject: (g.subject || '').slice(0, 50),
      inDB: 'YES',
      tier: db.classificationTier,
      status: db.reportStatus,
    });
  } else {
    missingCount++;
    lines.push({
      id: g.id,
      date: g.date,
      subject: (g.subject || '').slice(0, 50),
      inDB: '--- MISSING ---',
      tier: g.tier,
      status: '(not persisted)',
    });
  }
}
console.table(lines);

console.log(`\nSummary: ${inDbCount} in DB / ${missingCount} MISSING from DB`);

console.log('\n=== Anthropic rows in DB without a current Gmail match (orphans) ===');
const orphans = dbRows.rows.filter((r) => !gmailByMid.has(r.gmailMessageId));
console.log(`${orphans.length} rows`);
for (const r of orphans.slice(0, 20)) {
  console.log(`  - ${r.gmailMessageId}  ${r.date}  tier=${r.classificationTier} status=${r.reportStatus}  ${(r.subject || '').slice(0, 60)}`);
}

await client.end();
