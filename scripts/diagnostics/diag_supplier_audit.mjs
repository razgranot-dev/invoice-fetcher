// Audit current supplier duplicates in the production DB.
// Goal: find pairs/groups of supplier labels that should be unified.

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
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Companies (raw)
console.log('═══ Top raw company labels (with counts) ═══');
const companies = (await c.query(`
  SELECT company, "senderDomain", COUNT(*)::int AS n
  FROM invoices
  WHERE company IS NOT NULL
  GROUP BY company, "senderDomain"
  ORDER BY company
`)).rows;
console.table(companies);

// Sender domains
console.log('\n═══ Sender domains used (with counts) ═══');
const domains = (await c.query(`
  SELECT "senderDomain", COUNT(*)::int AS n
  FROM invoices
  WHERE "senderDomain" IS NOT NULL
  GROUP BY "senderDomain"
  ORDER BY "senderDomain"
`)).rows;
console.table(domains);

// Suppliers table
console.log('\n═══ Suppliers in suppliers table ═══');
const suppliers = (await c.query(`
  SELECT name, "isRelevant"
  FROM suppliers
  ORDER BY name
`)).rows;
console.table(suppliers);

await c.end();
