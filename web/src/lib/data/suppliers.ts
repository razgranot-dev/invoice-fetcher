import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/utils";

/**
 * Auto-creates supplier records using company-first brand logic:
 * each invoice's brand = company (lowercased) || normalizeDomain(senderDomain).
 * This ensures PayPal receipts with company="Meta" are grouped under "meta",
 * not under the shared "paypal" domain brand.
 * Returns all suppliers with accurate invoice counts.
 *
 * Performance: Uses two GROUP BY queries instead of fetching all invoices.
 * - groupBy(company) for invoices with a company field
 * - groupBy(senderDomain) for invoices without a company field
 * This reduces data transfer from O(n) rows to O(unique_brands) rows.
 */
export async function getSuppliers(organizationId: string) {
  // GROUP BY company for invoices that have a company name set.
  // This avoids fetching all invoice rows — the DB aggregates for us.
  const [companyGroups, domainGroups] = await Promise.all([
    db.invoice.groupBy({
      by: ["company"],
      where: { organizationId, company: { not: null } },
      _count: true,
    }),
    // GROUP BY senderDomain for invoices WITHOUT a company name.
    // These fall back to domain-based brand logic.
    db.invoice.groupBy({
      by: ["senderDomain"],
      where: { organizationId, company: null, senderDomain: { not: null } },
      _count: true,
    }),
  ]);

  // Compute brand counts from the two aggregated result sets
  const brandCounts = new Map<string, number>();

  for (const row of companyGroups) {
    const brand = row.company?.trim().toLowerCase();
    if (!brand) continue;
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + row._count);
  }

  for (const row of domainGroups) {
    if (!row.senderDomain) continue;
    const brand = normalizeDomain(row.senderDomain);
    if (!brand) continue;
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + row._count);
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
