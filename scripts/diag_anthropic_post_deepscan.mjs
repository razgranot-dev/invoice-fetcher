// After running a deep (daysBack=365 or 730) production scan, verify all the
// previously-missed Anthropic receipts now exist in the DB with the correct
// tier and reportStatus.

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
const gmailReceipts = audit.filter((r) =>
  /your receipt from anthropic/i.test(r.subject || '') &&
  /invoice\+statements@mail\.anthropic\.com/i.test(r.sender || '')
);

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const dbAnthropic = await client.query(`
  SELECT "gmailMessageId", subject, sender, date, "classificationTier",
         "classificationScore", "reportStatus", company
  FROM invoices
  WHERE sender ILIKE '%invoice+statements@mail.anthropic.com%'
     AND subject ILIKE '%Your receipt from Anthropic%'
  ORDER BY date DESC NULLS LAST
`);
const dbByMid = new Map(dbAnthropic.rows.map((r) => [r.gmailMessageId, r]));

console.log(`Gmail receipts: ${gmailReceipts.length}`);
console.log(`DB anthropic receipts: ${dbAnthropic.rows.length}`);

let included = 0, missing = 0, wrongStatus = 0;
const lines = [];
for (const g of gmailReceipts) {
  const db = dbByMid.get(g.id);
  if (!db) {
    missing++;
    lines.push({ id: g.id, date: g.date, subject: g.subject.slice(0, 50), inDB: '--- MISSING ---', tier: '', status: '' });
  } else {
    if (db.reportStatus !== 'INCLUDED' || db.classificationTier !== 'confirmed_invoice') wrongStatus++;
    else included++;
    lines.push({
      id: g.id, date: g.date, subject: g.subject.slice(0, 50),
      inDB: 'YES', tier: db.classificationTier, status: db.reportStatus,
    });
  }
}
console.table(lines);

console.log(`\nResult: ${included} INCLUDED confirmed, ${wrongStatus} present but wrong tier/status, ${missing} still MISSING`);
process.exit(missing === 0 && wrongStatus === 0 ? 0 : 1);

await client.end();
