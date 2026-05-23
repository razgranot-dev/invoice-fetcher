import { db } from "@/lib/db";
import { canonicalSupplierKey } from "@/lib/supplier-canonical";

/**
 * Auto-creates supplier records using canonical brand logic from
 * web/src/lib/supplier-canonical.ts. The SAME canonical resolution
 * runs at invoice persistence, supplier-list derivation, the
 * exclusion sweep, and here — guaranteeing that "Anthropic, PBC",
 * "Anthropic", and "Claude Team" all collapse to one supplier row
 * with aggregated counts.
 *
 * Returns all suppliers with accurate invoice counts.
 *
 * Performance: groupBy on (company, senderDomain) so the DB does the
 * heavy aggregation; we then collapse the rows to canonical keys in
 * JavaScript (cheap, O(unique brand pairs)).
 */
export async function getSuppliers(organizationId: string) {
  const groups = await db.invoice.groupBy({
    by: ["company", "senderDomain"],
    where: { organizationId },
    _count: true,
  });

  // Collapse to canonical brand keys.
  const brandCounts = new Map<string, number>();
  for (const row of groups) {
    const key = canonicalSupplierKey({
      company: row.company,
      senderDomain: row.senderDomain,
    });
    if (!key) continue;
    brandCounts.set(key, (brandCounts.get(key) ?? 0) + row._count);
  }

  // Create supplier records for all discovered brands (idempotent)
  if (brandCounts.size > 0) {
    await db.supplier.createMany({
      data: Array.from(brandCounts.keys()).map((name) => ({
        organizationId,
        name,
      })),
      skipDuplicates: true,
    });

    // Migrate isRelevant from old mixed-case suppliers to new lowercase names,
    // then clean up stale suppliers that no longer match any invoice brand.
    const validNames = new Set(brandCounts.keys());
    const existingSuppliers = await db.supplier.findMany({
      where: { organizationId },
    });
    const stale = existingSuppliers.filter((s) => !validNames.has(s.name));

    // Batch migrate isRelevant in a single transaction instead of N individual updates
    if (stale.length > 0) {
      const migrations = stale
        .filter((s) => {
          const lower = s.name.toLowerCase();
          return lower !== s.name && validNames.has(lower);
        })
        .map((s) =>
          db.supplier.updateMany({
            where: { organizationId, name: s.name.toLowerCase() },
            data: { isRelevant: s.isRelevant },
          })
        );

      if (migrations.length > 0) {
        await db.$transaction(migrations);
      }

      await db.supplier.deleteMany({
        where: { id: { in: stale.map((s) => s.id) } },
      });
    }
  }

  const suppliers = await db.supplier.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });

  return suppliers.map((s) => ({
    ...s,
    invoiceCount: brandCounts.get(s.name) ?? 0,
  }));
}

/**
 * Find all raw senderDomain values that DIRECTLY normalize to a given brand name.
 * Does NOT fall back to company-based domain lookup — those domains may be shared
 * by multiple vendors (e.g., paypal.co.il serves Meta, Shopify, etc.).
 *
 * Performance: Only queries invoices with company=null since invoices with a
 * company field use company-based brand logic (not domain-based).
 */
export async function getDomainsForBrand(
  organizationId: string,
  brandName: string
): Promise<string[]> {
  const domains = await db.invoice.groupBy({
    by: ["senderDomain"],
    where: { organizationId, company: null, senderDomain: { not: null } },
  });

  return domains
    .filter(
      (d) => d.senderDomain && normalizeDomain(d.senderDomain) === brandName
    )
    .map((d) => d.senderDomain!);
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
