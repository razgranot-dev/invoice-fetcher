import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/utils";

/**
 * Auto-creates supplier records from invoice senderDomains AND company names,
 * merging variants (info.hostinger.com, billing.hostinger.com → "hostinger").
 * Also picks up invoices that have a company field but no senderDomain.
 * Returns all suppliers with merged invoice counts.
 */
export async function getSuppliers(organizationId: string) {
  // Gather distinct sender domains from invoices
  const domains = await db.invoice.groupBy({
    by: ["senderDomain"],
    where: { organizationId, senderDomain: { not: null } },
    _count: true,
  });

  // Also gather distinct company names (covers invoices with no senderDomain)
  const companyGroups = await db.invoice.groupBy({
    by: ["company"],
    where: { organizationId, company: { not: null } },
    _count: true,
  });

  // Merge by normalized brand name from domains
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

  // Add company-based suppliers that don't already match a domain brand
  const brandNamesLower = new Set(
    Array.from(merged.keys()).map((k) => k.toLowerCase())
  );
  for (const c of companyGroups) {
    if (!c.company) continue;
    const companyLower = c.company.toLowerCase().trim();
    // Skip if already covered by a domain brand (exact or substring match)
    if (brandNamesLower.has(companyLower)) continue;
    let alreadyCovered = false;
    for (const b of brandNamesLower) {
      if (companyLower.includes(b) || b.includes(companyLower)) {
        alreadyCovered = true;
        break;
      }
    }
    if (!alreadyCovered) {
      merged.set(c.company, { rawDomains: [], count: c._count });
      brandNamesLower.add(companyLower);
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
 * Also matches invoices by company name for suppliers created from the
 * company field (which may not have a matching senderDomain).
 */
export async function getDomainsForBrand(
  organizationId: string,
  brandName: string
): Promise<string[]> {
  const domains = await db.invoice.groupBy({
    by: ["senderDomain"],
    where: { organizationId, senderDomain: { not: null } },
  });

  const matched = domains
    .filter((d) => d.senderDomain && normalizeDomain(d.senderDomain) === brandName)
    .map((d) => d.senderDomain!);

  // If no domain matches, this supplier was created from the company field.
  // Find domains for invoices where company matches the brand name.
  if (matched.length === 0) {
    const companyDomains = await db.invoice.groupBy({
      by: ["senderDomain"],
      where: {
        organizationId,
        company: { equals: brandName, mode: "insensitive" },
        senderDomain: { not: null },
      },
    });
    for (const cd of companyDomains) {
      if (cd.senderDomain) matched.push(cd.senderDomain);
    }
  }

  return matched;
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
