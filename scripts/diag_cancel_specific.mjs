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

const scanId = process.argv[2];
if (!scanId) { console.error('Usage: node diag_cancel_specific.mjs <scanId>'); process.exit(1); }

const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `UPDATE scans
   SET status = 'CANCELLED', progress = 100,
       "progressMessage" = 'Cancelled — Vercel maxDuration exceeded on 2-year scan',
       "completedAt" = NOW()
   WHERE id = $1 AND status IN ('PENDING','RUNNING')
   RETURNING id, status`,
  [scanId],
);
console.log(r.rows[0] || 'no row');
await c.end();
