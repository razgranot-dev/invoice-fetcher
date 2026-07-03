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
 *   • A stale row holding a user exclusion (isRelevant=false) is RE-KEYED:
 *     the preference is upserted onto its current canonical key before the
 *     old row is deleted — so an alias-map change ("bird rides" → "bird")
 *     never silently drops the user's exclusion.
 *   • A stale excluded row that yields no usable new key is KEPT (dormant)
 *     rather than deleted — user exclusions are never destroyed.
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

    // Excluded supplier: carry the preference onto the re-keyed name first.
    if (newKey && newKey !== s.name) {
      await db.supplier.upsert({
        where: { organizationId_name: { organizationId, name: newKey } },
        create: { organizationId, name: newKey, isRelevant: false },
        update: { isRelevant: false },
      });
      deletableIds.push(s.id);
    }
    // else: exclusion that fails to re-key — keep it dormant, never delete.
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
