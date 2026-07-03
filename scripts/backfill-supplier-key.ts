/**
 * One-off / re-runnable backfill: populate Invoice.supplierKey (S1) for rows
 * created before the column existed, using the SAME canonical resolver that
 * writes the column at scan time (web/src/lib/supplier-canonical.ts —
 * canonicalSupplierKey is the only writer of supplierKey values).
 *
 * Run from web/ so module resolution + Prisma env loading use web/'s tree:
 *   cd web && npx tsx ../scripts/backfill-supplier-key.ts
 *
 * Re-run after alias-map changes in web/src/lib/brand-data.json with
 * --recompute to refresh ALL rows, not just NULL ones:
 *   cd web && npx tsx ../scripts/backfill-supplier-key.ts --recompute
 *
 * Chunked (500 rows per read), grouped updateMany per computed key, idempotent.
 */

import { readFileSync } from "fs";
import path from "path";
import {
  canonicalSupplierKey,
  UNKNOWN_KEY,
} from "../web/src/lib/supplier-canonical";

/** Load DATABASE_URL (etc.) from web/.env without requiring dotenv. */
function loadWebEnv(): void {
  const envPath = path.resolve(__dirname, "..", "web", ".env");
  let envText: string;
  try {
    envText = readFileSync(envPath, "utf-8");
  } catch {
    return; // No web/.env — rely on the ambient environment.
  }
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const CHUNK = 500;
const recompute = process.argv.includes("--recompute");

async function main(): Promise<void> {
  loadWebEnv();
  // Import the Prisma-backed db only AFTER the env bootstrap (a static import
  // would hoist above it and instantiate the client without DATABASE_URL).
  const { db } = await import("../web/src/lib/db");

  try {
    const where = recompute ? {} : { supplierKey: null };
    const total = await db.invoice.count({ where });
    console.log(
      `[backfill-supplier-key] ${total} invoice(s) to process` +
        (recompute ? " (full recompute)" : " (supplierKey IS NULL only)")
    );

    let processed = 0;
    let updated = 0;
    let cursor: string | undefined;

    for (;;) {
      const rows: Array<{
        id: string;
        company: string | null;
        senderDomain: string | null;
        supplierKey: string | null;
      }> = await db.invoice.findMany({
        where,
        select: { id: true, company: true, senderDomain: true, supplierKey: true },
        orderBy: { id: "asc" },
        take: CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      // Group ids by computed key so each chunk needs one updateMany per key.
      const byKey = new Map<string, string[]>();
      for (const row of rows) {
        const key =
          canonicalSupplierKey({
            company: row.company,
            senderDomain: row.senderDomain,
          }) || UNKNOWN_KEY;
        if (row.supplierKey === key) continue; // already correct — skip write
        const ids = byKey.get(key) ?? [];
        ids.push(row.id);
        byKey.set(key, ids);
      }

      for (const [key, ids] of byKey) {
        const res = await db.invoice.updateMany({
          where: { id: { in: ids } },
          data: { supplierKey: key },
        });
        updated += res.count;
      }

      processed += rows.length;
      console.log(
        `[backfill-supplier-key] processed ${processed}/${total} (updated ${updated})`
      );

      // In NULL-only mode the WHERE shrinks as we write, so restart the cursor
      // (every fetched row was just given a key and left the result set).
      if (!recompute) cursor = undefined;
    }

    const remaining = await db.invoice.count({ where: { supplierKey: null } });
    console.log(
      `[backfill-supplier-key] DONE — updated ${updated} row(s); ${remaining} row(s) still NULL`
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error("[backfill-supplier-key] FAILED:", e);
  process.exitCode = 1;
});
