// Verify the supplier panel-grouping by canonical key matches what the
// invoices page will compute live.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalSupplierKey, canonicalDisplayName } from './_supplier_canonical.mjs';

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
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const rows = (await c.query(
  `SELECT company, "senderDomain", COUNT(*)::int AS n FROM invoices GROUP BY company, "senderDomain"`
)).rows;

const byKey = new Map();
for (const r of rows) {
  const key = canonicalSupplierKey({ company: r.company, senderDomain: r.senderDomain });
  if (!key) continue;
  const cur = byKey.get(key) ?? { key, display: canonicalDisplayName(key), count: 0, variants: new Set() };
  cur.count += r.n;
  if (r.company) cur.variants.add(r.company);
  byKey.set(key, cur);
}

const arr = [...byKey.values()].sort((a, b) => b.count - a.count);
console.log(`Canonical suppliers: ${arr.length}`);
console.table(arr.map((s) => ({
  display: s.display,
  count: s.count,
  variants: [...s.variants].slice(0, 4).join(' | ') + (s.variants.size > 4 ? ` (+${s.variants.size - 4})` : ''),
})));

// Also dump suppliers table
const sup = (await c.query(`SELECT name, "isRelevant" FROM suppliers ORDER BY name`)).rows;
console.log(`\nSuppliers table (canonical keys): ${sup.length}`);
console.table(sup);

await c.end();
