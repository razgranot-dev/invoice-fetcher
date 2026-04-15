/**
 * One-time fix: re-associate invoices to their correct scan by timestamp.
 *
 * Usage:
 *   node scripts/fix-scans.mjs
 *
 * Reads DATABASE_URL from web/.env or web/.env.local (same as Next.js).
 * Uses raw pg queries — no Prisma client needed.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ── Load DATABASE_URL from .env files ──────────────────────────────────

function loadEnv() {
  const candidates = [
    resolve(root, "web", ".env.local"),
    resolve(root, "web", ".env"),
    resolve(root, ".env.local"),
    resolve(root, ".env"),
  ];

  for (const path of candidates) {
    try {
      const content = readFileSync(path, "utf-8");
      const match = content.match(/^DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
      if (match) {
        console.log(`Loaded DATABASE_URL from ${path}`);
        return match[1].trim();
      }
    } catch {}
  }

  // Fall back to environment variable
  if (process.env.DATABASE_URL) {
    console.log("Using DATABASE_URL from environment");
    return process.env.DATABASE_URL;
  }

  console.error("ERROR: DATABASE_URL not found in any .env file or environment");
  process.exit(1);
}

const databaseUrl = loadEnv();

// ── Connect to Postgres ────────────────────────────────────────────────

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
console.log("Connected to database\n");

// ── Step 1: Diagnostics ────────────────────────────────────────────────

const { rows: scans } = await client.query(`
  SELECT id, "organizationId", status, "createdAt", "startedAt", "completedAt",
         "totalMessages", "invoiceCount"
  FROM scans
  WHERE status = 'COMPLETED'
  ORDER BY "createdAt" ASC
`);

console.log(`Found ${scans.length} completed scan(s)\n`);

const { rows: [{ count: totalInvoices }] } = await client.query(
  `SELECT count(*) FROM invoices`
);
console.log(`Total invoices in DB: ${totalInvoices}`);

const { rows: distribution } = await client.query(`
  SELECT "scanId", count(*) as cnt
  FROM invoices
  GROUP BY "scanId"
  ORDER BY cnt DESC
`);

console.log(`\nInvoice distribution by scanId:`);
const scanIdSet = new Set(scans.map(s => s.id));
for (const row of distribution) {
  const exists = scanIdSet.has(row.scanId) ? "OK" : "ORPHANED";
  console.log(`  ${row.scanId} → ${row.cnt} invoices [${exists}]`);
}

// ── Step 2: Link ALL invoices to the latest completed scan ─────────────

const latest = scans[scans.length - 1]; // sorted ASC, so last = newest
console.log(`\nLatest scan: ${latest.id} (completed ${latest.completedAt?.toISOString() ?? "?"})`);
console.log(`\n--- Running fix: set ALL invoices → ${latest.id} ---\n`);

const result = await client.query(
  `UPDATE invoices
   SET "scanId" = $1
   WHERE "organizationId" = $2`,
  [latest.id, latest.organizationId]
);

const totalUpdated = parseInt(result.rowCount, 10);
console.log(`Updated ${totalUpdated} invoices → scanId = ${latest.id}`);

// ── Step 3: Verify ─────────────────────────────────────────────────────

console.log(`\n--- Verification ---\n`);

const { rows: afterDist } = await client.query(`
  SELECT "scanId", count(*) as cnt
  FROM invoices
  GROUP BY "scanId"
  ORDER BY cnt DESC
`);

for (const row of afterDist) {
  const exists = scanIdSet.has(row.scanId) ? "OK" : "ORPHANED";
  console.log(`  ${row.scanId} → ${row.cnt} invoices [${exists}]`);
}

console.log(`\nDone. ${totalUpdated} total invoice rows updated.`);

await client.end();
