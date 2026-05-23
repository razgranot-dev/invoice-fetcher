// One-time maintenance — re-normalize every invoice's `company` field to
// the canonical display name AND collapse duplicate supplier rows,
// preserving user preferences (any excluded variant → canonical inherits
// excluded). Safe to re-run; idempotent. Does NOT delete any invoice rows.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalSupplierKey, canonicalDisplayName } from './_supplier_canonical.mjs';

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

// ── Step 1: walk every invoice and update its company to canonical display
const invoices = (await c.query(`SELECT id, "organizationId", company, "senderDomain" FROM invoices ORDER BY id`)).rows;
console.log(`Re-normalizing ${invoices.length} invoices ...`);

let updated = 0, unchanged = 0;
for (let i = 0; i < invoices.length; i++) {
  const inv = invoices[i];
  const key = canonicalSupplierKey({ company: inv.company, senderDomain: inv.senderDomain });
  if (!key) { unchanged++; continue; }
  const display = canonicalDisplayName(key);
  if (display && display !== inv.company) {
    await c.query(`UPDATE invoices SET company = $1 WHERE id = $2`, [display, inv.id]);
    updated++;
  } else {
    unchanged++;
  }
  if ((i + 1) % 50 === 0 || i + 1 === invoices.length) {
    process.stdout.write(`  ${i + 1}/${invoices.length}  (updated=${updated})\r`);
  }
}
console.log();

// ── Step 2: rebuild suppliers table from canonical keys
console.log('Rebuilding suppliers table ...');

// orgId|key → count (for sanity)
// orgId|key → isRelevant (false wins over true, default true)
const orgKeyCounts = new Map();
const orgKeyToIsRelevant = new Map();

for (const inv of invoices) {
  const key = canonicalSupplierKey({ company: inv.company, senderDomain: inv.senderDomain });
  if (!key) continue;
  const composite = `${inv.organizationId}|${key}`;
  orgKeyCounts.set(composite, (orgKeyCounts.get(composite) ?? 0) + 1);
}

const oldSuppliers = (await c.query(`SELECT id, "organizationId", name, "isRelevant" FROM suppliers`)).rows;
console.log(`Found ${oldSuppliers.length} existing supplier rows`);

for (const s of oldSuppliers) {
  const key = canonicalSupplierKey({ company: s.name, senderDomain: null });
  if (!key) continue;
  const composite = `${s.organizationId}|${key}`;
  const prior = orgKeyToIsRelevant.get(composite);
  if (prior === false) continue;  // excluded sticks
  orgKeyToIsRelevant.set(composite, s.isRelevant);
}

// Wipe and rebuild — clean slate is the only way to guarantee no stragglers.
console.log('Deleting old supplier rows ...');
await c.query('DELETE FROM suppliers');

const newRows = [];
for (const [composite, _count] of orgKeyCounts.entries()) {
  const [organizationId, key] = composite.split('|');
  const isRelevant = orgKeyToIsRelevant.get(composite);
  newRows.push({
    organizationId,
    name: key,
    isRelevant: isRelevant === false ? false : true,
  });
}
console.log(`Inserting ${newRows.length} canonical supplier rows ...`);
for (const r of newRows) {
  await c.query(
    `INSERT INTO suppliers (id, "organizationId", name, "isRelevant", "createdAt", "updatedAt")
     VALUES ('c' || md5(random()::text || clock_timestamp()::text || $1 || $2), $1, $2, $3, NOW(), NOW())
     ON CONFLICT ("organizationId", name) DO NOTHING`,
    [r.organizationId, r.name, r.isRelevant],
  );
}

console.log('Done.');
console.log(`  Invoices updated: ${updated}`);
console.log(`  Invoices unchanged: ${unchanged}`);
console.log(`  Old supplier rows: ${oldSuppliers.length}`);
console.log(`  New canonical supplier rows: ${newRows.length}`);
console.log(`  Excluded preferences preserved: ${[...orgKeyToIsRelevant.values()].filter(v => v === false).length}`);

await c.end();
