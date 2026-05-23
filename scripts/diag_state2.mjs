// Look for scans stuck at high progress (>= 50%) and inspect their final state.
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

console.log('\n=== ALL SCANS FROM TODAY (or last 24h) ===');
const r = await client.query(`
  SELECT id, status, progress, "progressMessage", "totalMessages",
         "processedCount", "invoiceCount",
         "createdAt", "startedAt", "completedAt",
         EXTRACT(EPOCH FROM (COALESCE("completedAt", NOW()) - "startedAt"))::int AS duration_seconds,
         "errorMessage"
  FROM scans
  WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
  ORDER BY "createdAt" DESC
`);
for (const s of r.rows) {
  console.log({
    id: s.id,
    status: s.status,
    progress: s.progress,
    msg: s.progressMessage,
    total: s.totalMessages,
    invoices: s.invoiceCount,
    durSec: s.duration_seconds,
    err: s.errorMessage?.slice(0, 100),
  });
}

console.log('\n=== ANY RUNNING / PENDING ===');
const running = await client.query(`
  SELECT id, status, progress, "progressMessage", "startedAt",
         EXTRACT(EPOCH FROM (NOW() - "startedAt"))::int AS age_seconds
  FROM scans WHERE status IN ('RUNNING','PENDING')
`);
for (const s of running.rows) console.log(s);

console.log('\n=== ALL SCANS THAT EVER STOPPED AT 60-79% ===');
const stuck = await client.query(`
  SELECT id, status, progress, "progressMessage", "totalMessages",
         "createdAt", "completedAt"
  FROM scans
  WHERE progress BETWEEN 60 AND 79
  ORDER BY "createdAt" DESC
  LIMIT 10
`);
for (const s of stuck.rows) console.log(s);

await client.end();
