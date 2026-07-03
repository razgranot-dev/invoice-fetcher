// One-off: does the live DB already have the new invoice columns + scan index?
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
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}
const { default: pg } = await import('pg');
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const cols = await c.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name='invoices' AND column_name IN ('reportStatusManual','supplierKey')`
);
console.log('invoice cols present:', JSON.stringify(cols.rows.map((x) => x.column_name)));
const idx = await c.query(
  `SELECT indexname FROM pg_indexes WHERE tablename='scans' AND indexname='one_active_scan_per_org'`
);
console.log('partial unique index present:', idx.rows.length > 0);
await c.end();
