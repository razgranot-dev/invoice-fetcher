// When Vercel's after() callback dies between bulkCreate and the final
// scan-status update, the scan stays RUNNING with progress=100 but
// status=RUNNING. Reconcile from the actually-persisted rows.

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

const scanId = process.argv[2];
if (!scanId) { console.error('Usage: node diag_finalize_scan.mjs <scanId>'); process.exit(1); }

const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const counts = (await c.query(
  `SELECT
     COUNT(*)::int AS total,
     COUNT(*) FILTER (WHERE "reportStatus" = 'INCLUDED')::int AS included,
     COUNT(*) FILTER (WHERE "reportStatus" = 'EXCLUDED')::int AS excluded,
     COUNT(*) FILTER (WHERE "classificationTier" = 'confirmed_invoice')::int AS confirmed,
     COUNT(*) FILTER (WHERE "classificationTier" = 'likely_invoice')::int AS likely
   FROM invoices WHERE "scanId" = $1`,
  [scanId],
)).rows[0];

const updated = await c.query(
  `UPDATE scans
   SET status = 'COMPLETED', progress = 100,
       "processedCount" = $2,
       "invoiceCount" = $3,
       "progressMessage" = $4,
       "completedAt" = NOW()
   WHERE id = $1 AND status = 'RUNNING'
   RETURNING id, status`,
  [
    scanId,
    counts.total,
    counts.included,
    `Complete — ${counts.total} saved (${counts.included} in report · ${counts.excluded} for review · ${counts.confirmed} confirmed · ${counts.likely} likely)`,
  ],
);

console.log('Counts:', counts);
console.log('Updated:', updated.rows[0] || 'no change');
await c.end();
