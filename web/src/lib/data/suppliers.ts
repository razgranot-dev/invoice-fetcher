import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/utils";

/**
 * Auto-creates supplier records from invoice senderDomains, merging
 * variants (info.hostinger.com, billing.hostinger.com → "hostinger").
 * Returns all suppliers with merged invoice counts.
 */
export async function getSuppliers(organizationId: string) {
  // Gather distinct sender domains from invoices
  const domains = await db.invoice.groupBy({
    by: ["senderDomain"],
    where: { organizationId, senderDomain: { not: null } },
    _count: true,
  });

  // Merge by normalized brand name
  const merged = new Map<string, { rawDomains: string[]; count: number }>();
  for (const d of domains) {
    if (!d.senderDomain) continue;
    const brand = normalizeDomain(d.senderDomain);
    if (!brand) continue;
    const existing = merged.get(brand);
    if (existing) {
      existing.rawDomains.push(d.senderDomain);
      existing.count += d._count;
    } else {
      merged.set(brand, { rawDomains: [d.senderDomain], count: d._count });
    }
  }

  // Create supplier records for merged brands (idempotent)
  if (merged.size > 0) {
    await db.supplier.createMany({
      data: Array.from(merged.keys()).map((name) => ({ organizationId, name })),
      skipDuplicates: true,
    });

    // Clean up old duplicate suppliers that used raw domains instead of brands
    const validNames = Array.from(merged.keys());
    const stale = await db.supplier.findMany({
      where: { organizationId, name: { notIn: validNames } },
    });
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
    invoiceCount: merged.get(s.name)?.count ?? 0,
  }));
}

/**
 * Find all raw senderDomain values that normalize to a given brand name.
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
    .filter((d) => d.senderDomain && normalizeDomain(d.senderDomain) === brandName)
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
