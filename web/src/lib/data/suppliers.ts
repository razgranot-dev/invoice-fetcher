import { db } from "@/lib/db";
import { canonicalSupplierKey } from "@/lib/supplier-canonical";
import { getSupplierKeyCounts } from "@/lib/data/invoices";

/**
 * Supplier identity: Supplier.name rows are CANONICAL brand keys produced by
 * canonicalSupplierKey (web/src/lib/supplier-canonical.ts). The same resolver
 * runs at invoice persistence (Invoice.supplierKey), the supplier-list
 * derivation, the exclusion sweep, and the chip-toggle cascade — so
 * "Anthropic, PBC", "Anthropic", and "Claude Team" all collapse to one
 * supplier row with aggregated counts.
 */

export type SupplierWithCount = {
  id: string;
  organizationId: string;
  name: string;
  isRelevant: boolean;
  createdAt: Date;
  updatedAt: Date;
  invoiceCount: number;
};

/**
 * Pure READ (M13): returns persisted supplier rows merged with brands derived
 * from the org's invoices. Performs ZERO writes — reconciliation of stale /
 * legacy rows happens in reconcileSuppliers(), which mutation paths call
 * (scan finalization). Brands with invoices but no persisted row are returned
 * as derived entries (id "derived-<key>") — toggleSupplierRelevance upserts a
 * real row on the first user toggle.
 */
export async function getSuppliers(organizationId: string): Promise<SupplierWithCount[]> {
  const [keyCounts, persisted] = await Promise.all([
    getSupplierKeyCounts(organizationId),
    db.supplier.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
    }),
  ]);

  const persistedNames = new Set(persisted.map((s) => s.name));
  const result: SupplierWithCount[] = persisted.map((s) => ({
    ...s,
    invoiceCount: keyCounts.get(s.name) ?? 0,
  }));

  const now = new Date();
  for (const [key, count] of keyCounts) {
    if (persistedNames.has(key)) continue;
    result.push({
      id: `derived-${key}`,
      organizationId,
      name: key,
      isRelevant: true,
      createdAt: now,
      updatedAt: now,
      invoiceCount: count,
    });
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Reconcile persisted supplier rows with the current canonical key set.
 * Called from MUTATION paths only (end of scan finalization) — never during
 * a page-render read (M13).
 *
 * Preference-safe by construction:
 *   • A stale row holding a user exclusion (isRelevant=false) is RE-KEYED
 *     ONLY when doing so is provably safe: its canonical key must be a
 *     currently-valid key (has invoices) AND no supplier row may already
 *     exist at that key. canonicalSupplierKey is NOT inverse-safe — run on a
 *     stored key it can map onto an UNRELATED brand ("acme-corp" → "acme") or
 *     onto a key the user already set a preference for; migrating blindly
 *     would resurrect the exclusion on the wrong vendor or overwrite an
 *     existing include. When it IS safe, the preference is upserted onto the
 *     new key before the old row is deleted (an alias-map change like
 *     "bird rides" → "bird" keeps the exclusion).
 *   • Any stale excluded row that can't be safely re-keyed is KEPT (dormant)
 *     rather than deleted — user exclusions are never destroyed, never
 *     migrated onto a wrong key, and never downgrade an existing preference.
 *   • Only stale rows carrying no preference (isRelevant=true, the default)
 *     are cleaned up.
 */
export async function reconcileSuppliers(organizationId: string): Promise<void> {
  const keyCounts = await getSupplierKeyCounts(organizationId);
  const validNames = new Set(keyCounts.keys());

  const existing = await db.supplier.findMany({ where: { organizationId } });
  const stale = existing.filter((s) => !validNames.has(s.name));
  if (stale.length === 0) return;

  const deletableIds: string[] = [];
  for (const s of stale) {
    const newKey = canonicalSupplierKey({ company: s.name });

    if (s.isRelevant) {
      // No user preference to preserve — safe to drop the stale row.
      deletableIds.push(s.id);
      continue;
    }

    // Excluded supplier: re-key the exclusion onto its current canonical key,
    // but ONLY when that is provably safe. canonicalSupplierKey is NOT
    // inverse-safe, so guard both directions:
    //   • newKey must be a CURRENTLY-VALID key (present in validNames — i.e.
    //     backed by real invoices right now); otherwise it's a phantom /
    //     hyphen-collapsed brand ("acme-corp" → "acme" with no acme rows) and
    //     migrating would resurrect the exclusion on the wrong vendor.
    //   • no supplier row may ALREADY exist at newKey; otherwise the upsert
    //     would overwrite/downgrade an existing user preference there (e.g.
    //     flip a deliberate include at "bird" to excluded).
    // Fail either guard → keep the stale excluded row DORMANT (do not migrate,
    // do not delete): the exclusion is preserved, never destroyed.
    const conflictAtNewKey = existing.some((e) => e.name === newKey);
    if (newKey && newKey !== s.name && validNames.has(newKey) && !conflictAtNewKey) {
      await db.supplier.upsert({
        where: { organizationId_name: { organizationId, name: newKey } },
        create: { organizationId, name: newKey, isRelevant: false },
        update: { isRelevant: false },
      });
      deletableIds.push(s.id);
    }
    // else: unsafe/absent re-key target — keep the stale exclusion dormant.
  }

  if (deletableIds.length > 0) {
    await db.supplier.deleteMany({ where: { id: { in: deletableIds } } });
  }
}

export async function toggleSupplierRelevance(
  organizationId: string,
  name: string,
  isRelevant: boolean
) {
  return db.supplier.upsert({
    where: { organizationId_name: { organizationId, name } },
    create: { organizationId, name, isRelevant },
    update: { isRelevant },
  });
}

export async function getSupplierNamesByRelevance(
  organizationId: string,
  isRelevant: boolean
): Promise<string[]> {
  const suppliers = await db.supplier.findMany({
    where: { organizationId, isRelevant },
    select: { name: true },
  });
  return suppliers.map((s) => s.name);
}
