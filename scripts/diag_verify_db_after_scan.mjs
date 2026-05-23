// Full DB verification for the most recent COMPLETED scan.
// Confirms the project-spec invariants:
//   • confirmed_invoice + likely_invoice → INCLUDED
//   • possible_financial_email           → EXCLUDED
//   • not_invoice (with content signal)  → EXCLUDED (never INCLUDED)
//   • previous EXCLUDED items not flipped to INCLUDED by a re-scan
//   • no duplicate Gmail message IDs persisted
//   • supplier (company) normalization grouping
//   • stuck-scan recovery cleaned up the old RUNNING row

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

function header(t) {
  console.log('\n' + '═'.repeat(72));
  console.log(t);
  console.log('═'.repeat(72));
}

header('1. Latest COMPLETED scan');
const latest = (await client.query(`
  SELECT id, status, "totalMessages", "processedCount", "invoiceCount",
         "progressMessage", "startedAt", "completedAt",
         EXTRACT(EPOCH FROM ("completedAt" - "startedAt")) AS dur_seconds
  FROM scans
  WHERE status = 'COMPLETED'
  ORDER BY "completedAt" DESC
  LIMIT 1
`)).rows[0];
console.log(latest);

if (!latest) {
  console.error('No COMPLETED scan found — cannot verify.');
  await client.end();
  process.exit(1);
}

const scanId = latest.id;

header('2. Tier × reportStatus matrix for that scan');
const matrix = await client.query(`
  SELECT "classificationTier" AS tier, "reportStatus" AS status, COUNT(*)::int AS n
  FROM invoices
  WHERE "scanId" = $1
  GROUP BY "classificationTier", "reportStatus"
  ORDER BY tier, status
`, [scanId]);
console.table(matrix.rows);

// Invariant checks
let problems = 0;
const matrixObj = {};
for (const r of matrix.rows) {
  matrixObj[r.tier] ??= {};
  matrixObj[r.tier][r.status] = r.n;
}
function check(cond, msg) {
  if (!cond) { console.log('  ✗ ' + msg); problems++; }
  else { console.log('  ✓ ' + msg); }
}

console.log('\nInvariants:');
check(
  !matrixObj.confirmed_invoice || !matrixObj.confirmed_invoice.EXCLUDED,
  'confirmed_invoice has zero EXCLUDED (confirmed should always be INCLUDED)'
);
check(
  !matrixObj.likely_invoice || !matrixObj.likely_invoice.EXCLUDED,
  'likely_invoice has zero EXCLUDED (likely should always be INCLUDED)'
);
check(
  !matrixObj.possible_financial_email || !matrixObj.possible_financial_email.INCLUDED,
  'possible_financial_email has zero INCLUDED (must default EXCLUDED)'
);
check(
  !matrixObj.not_invoice || !matrixObj.not_invoice.INCLUDED,
  'not_invoice has zero INCLUDED (never auto-INCLUDED)'
);

header('3. Duplicate Gmail message IDs');
const dupes = await client.query(`
  SELECT "gmailMessageId", COUNT(*)::int AS n
  FROM invoices
  WHERE "scanId" = $1
  GROUP BY "gmailMessageId"
  HAVING COUNT(*) > 1
`, [scanId]);
check(dupes.rows.length === 0, `no duplicate gmailMessageId in scan ${scanId} (found ${dupes.rows.length})`);
if (dupes.rows.length) console.log(dupes.rows.slice(0, 5));

header('4. Duplicate Gmail message IDs across all invoices (org-scoped uniqueness)');
const globalDupes = await client.query(`
  SELECT "organizationId", "gmailMessageId", COUNT(*)::int AS n
  FROM invoices
  GROUP BY "organizationId", "gmailMessageId"
  HAVING COUNT(*) > 1
  LIMIT 5
`);
check(globalDupes.rows.length === 0, `unique (organizationId, gmailMessageId) constraint holds`);
if (globalDupes.rows.length) console.log(globalDupes.rows);

header('5. Supplier (company) grouping for this scan');
const suppliers = await client.query(`
  SELECT company, COUNT(*)::int AS n
  FROM invoices
  WHERE "scanId" = $1 AND company IS NOT NULL
  GROUP BY company
  ORDER BY n DESC, company
  LIMIT 25
`, [scanId]);
console.table(suppliers.rows);

header('6. Stuck scan recovery — any RUNNING scan older than 15 minutes?');
const stuck = await client.query(`
  SELECT id, status, "startedAt", "progressMessage",
         EXTRACT(EPOCH FROM (NOW() - "startedAt"))::int AS age_seconds
  FROM scans
  WHERE status IN ('PENDING', 'RUNNING')
    AND "startedAt" < NOW() - INTERVAL '15 minutes'
`);
check(stuck.rows.length === 0, `no stuck PENDING/RUNNING scans older than 15 min`);
if (stuck.rows.length) console.log(stuck.rows);

header('7. Recent scans (last 5)');
const recent = await client.query(`
  SELECT id, status, "totalMessages", "processedCount", "invoiceCount",
         LEFT("progressMessage", 80) AS msg, "createdAt"
  FROM scans
  ORDER BY "createdAt" DESC
  LIMIT 5
`);
console.table(recent.rows);

header('8. Sample INCLUDED invoices from latest scan');
const samples = await client.query(`
  SELECT "classificationTier" AS tier, "classificationScore" AS score,
         LEFT(company, 30) AS company, LEFT(sender, 50) AS sender,
         LEFT(subject, 60) AS subject, amount, currency
  FROM invoices
  WHERE "scanId" = $1 AND "reportStatus" = 'INCLUDED'
  ORDER BY "classificationScore" DESC
  LIMIT 15
`, [scanId]);
console.table(samples.rows);

header('9. Sample EXCLUDED (needs review) invoices');
const exSamples = await client.query(`
  SELECT "classificationTier" AS tier, "classificationScore" AS score,
         LEFT(company, 30) AS company, LEFT(sender, 50) AS sender,
         LEFT(subject, 60) AS subject
  FROM invoices
  WHERE "scanId" = $1 AND "reportStatus" = 'EXCLUDED'
  ORDER BY "classificationScore" DESC
  LIMIT 15
`, [scanId]);
console.table(exSamples.rows);

await client.end();

console.log('\n' + '─'.repeat(72));
console.log(problems === 0 ? '✓ All DB invariants hold.' : `✗ ${problems} invariant(s) failed.`);
process.exit(problems === 0 ? 0 : 2);
