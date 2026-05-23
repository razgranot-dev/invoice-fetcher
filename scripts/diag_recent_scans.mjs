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
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = (await c.query(
  `SELECT id, status, progress, "daysBack", "invoiceCount",
          LEFT("progressMessage", 100) AS msg, "createdAt"
   FROM scans
   ORDER BY "createdAt" DESC
   LIMIT 5`
)).rows;
console.table(r);
await c.end();
