import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/utils";

/**
 * Auto-creates supplier records using company-first brand logic:
 * each invoice's brand = company (lowercased) || normalizeDomain(senderDomain).
 * This ensures PayPal receipts with company="Meta" are grouped under "meta",
 * not under the shared "paypal" domain brand.
 * Returns all suppliers with accurate invoice counts.
 */
export async function getSuppliers(organizationId: string) {
  // Get minimal invoice data for brand computation
  const invoices = await db.invoice.findMany({
    where: { organizationId },
    select: { senderDomain: true, company: true },
  });

  // Compute brand counts using company-first logic
  // (same logic as the invoices page and export routes)
  const brandCounts = new Map<string, number>();
  for (const inv of invoices) {
    const brand =
      inv.company?.trim().toLowerCase() ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
    if (!brand) continue;
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
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
    for (const s of stale) {
      const lower = s.name.toLowerCase();
      if (lower !== s.name && validNames.has(lower)) {
        await db.supplier
          .update({
            where: { organizationId_name: { organizationId, name: lower } },
            data: { isRelevant: s.isRelevant },
          })
          .catch(() => {});
      }
    }
    if (stale.length > 0) {
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
 */
export async function getDomainsForBrand(
  organizationId: string,
  brandName: string
): Promise<string[]> {
  const domains = await db.invoice.groupBy({
    by: ["senderDomain"],
    where: { organizationId, senderDomain: { not: null } },
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
