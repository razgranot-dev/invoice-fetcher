// Show every scan in DB with its daysBack and date range.
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

const { default: pg } = await import('pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const r = await client.query(`
  SELECT id, status, "daysBack", "unreadOnly", "totalMessages", "invoiceCount", "createdAt"
  FROM scans
  WHERE status = 'COMPLETED'
  ORDER BY "createdAt" DESC
  LIMIT 30
`);
console.table(r.rows.map((s) => ({
  id: s.id.slice(0, 10),
  daysBack: s.daysBack,
  unreadOnly: s.unreadOnly,
  totalMessages: s.totalMessages,
  invoiceCount: s.invoiceCount,
  createdAt: s.createdAt.toISOString().slice(0, 10),
})));

// Anthropic invoices summary by date bucket
const aRows = await client.query(`
  SELECT date_trunc('month', date) AS bucket, COUNT(*)::int AS n,
         string_agg(DISTINCT "classificationTier" || ':' || "reportStatus", ', ') AS tiers
  FROM invoices
  WHERE sender ILIKE '%anthropic%' OR subject ILIKE '%anthropic%'
  GROUP BY bucket
  ORDER BY bucket DESC NULLS LAST
`);
console.log('\nAnthropic invoices in DB by month:');
console.table(aRows.rows);

await client.end();
