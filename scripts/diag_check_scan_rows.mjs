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
if (!scanId) process.exit(1);

const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r1 = (await c.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE "scanId" = $1`, [scanId])).rows[0].n;
const r2 = (await c.query(
  `SELECT COUNT(*)::int AS n FROM invoices WHERE "scanId" = $1 AND sender ILIKE '%invoice+statements@mail.anthropic.com%'`,
  [scanId],
)).rows[0].n;
console.log(`rows for scan ${scanId}: ${r1}, of which Anthropic receipts: ${r2}`);
await c.end();
