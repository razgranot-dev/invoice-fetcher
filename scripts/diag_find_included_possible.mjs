// Find the rogue possible_financial_email that landed as INCLUDED, and
// inspect its history to understand WHY the tier-based reportStatus didn't
// kick in.

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

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Find the rogue row
const latestScan = (await client.query(`
  SELECT id FROM scans WHERE status = 'COMPLETED' ORDER BY "completedAt" DESC LIMIT 1
`)).rows[0].id;

const rogue = await client.query(`
  SELECT id, "gmailMessageId", "scanId", "classificationTier", "classificationScore",
         "reportStatus", company, LEFT(sender, 60) AS sender, LEFT(subject, 80) AS subject,
         "createdAt"
  FROM invoices
  WHERE "scanId" = $1 AND "classificationTier" = 'possible_financial_email' AND "reportStatus" = 'INCLUDED'
`, [latestScan]);
console.log('Rogue rows:', rogue.rowCount);
for (const r of rogue.rows) console.log(r);

if (rogue.rowCount > 0) {
  // History on the same gmailMessageId
  const gmid = rogue.rows[0].gmailMessageId;
  console.log('\nHistory of this gmailMessageId across scans:');
  const hist = await client.query(`
    SELECT id, "scanId", "classificationTier" AS tier, "classificationScore" AS score,
           "reportStatus" AS status, "createdAt"
    FROM invoices
    WHERE "gmailMessageId" = $1
    ORDER BY "createdAt"
  `, [gmid]);
  console.table(hist.rows);

  // Suppliers list (in case manual exclusion is involved)
  const suppliers = await client.query(`
    SELECT name, "isRelevant" FROM suppliers WHERE "isRelevant" = false LIMIT 30
  `);
  console.log('\nExcluded suppliers:', suppliers.rows.map((r) => r.name));
}

await client.end();
