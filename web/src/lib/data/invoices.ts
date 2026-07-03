import { db } from "@/lib/db";
import { canonicalSupplierKey, UNKNOWN_KEY } from "@/lib/supplier-canonical";

export async function getInvoices(
  organizationId: string,
  filters?: {
    search?: string;
    tier?: string;
    company?: string;
    reportStatus?: string;
    scanId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    invoiceIds?: string[];
  },
  take = 500
) {
  // Hard cap on take to prevent unbounded result sets
  const safeTake = Math.min(Math.max(1, take), 10000);

  const where: any = { organizationId };

  // Explicit invoice ID list overrides broad filters — when the caller has
  // manually picked rows, never widen the result set beyond that set.
  if (filters?.invoiceIds && filters.invoiceIds.length > 0) {
    where.id = { in: filters.invoiceIds };
  }
  if (filters?.scanId) {
    where.scanId = filters.scanId;
  }
  if (filters?.tier) {
    where.classificationTier = filters.tier;
  }
  if (filters?.company) {
    // The company facet matches the persisted canonical supplierKey DIRECTLY.
    // filters.company is ALREADY that canonical key — the Companies dropdown
    // (filters.tsx: <option value={c.key}>) and the CSV/Word export routes
    // (exports/route.ts + invoices/export/route.ts) pass the STORED key
    // straight through. It must NOT be re-canonicalized here:
    // canonicalSupplierKey is not a fixed point on already-canonical keys —
    // running it on a stored domain-derived hyphenated key collapses it
    // ('my-shop' → 'myshop', 'acme-corp' → 'acme', because cleanCompanyName
    // splits on '-' and 'corp'/'co' are stripped as business suffixes), which
    // filters to zero/wrong rows and silently corrupts the filtered CSV/Word
    // export (M14). Match the key verbatim.
    where.supplierKey = filters.company.toLowerCase();
  }

  // Report inclusion filter
  if (filters?.reportStatus === "INCLUDED" || filters?.reportStatus === "EXCLUDED") {
    where.reportStatus = filters.reportStatus;
  }

  if (filters?.dateFrom || filters?.dateTo) {
    where.date = {};
    if (filters.dateFrom) where.date.gte = filters.dateFrom;
    if (filters.dateTo) where.date.lte = filters.dateTo;
  }
  if (filters?.search) {
    // Truncate search string to prevent abuse via overly long ILIKE patterns
    const safeSearch = filters.search.slice(0, 500);
    where.OR = [
      { subject: { contains: safeSearch, mode: "insensitive" } },
      { sender: { contains: safeSearch, mode: "insensitive" } },
      { company: { contains: safeSearch, mode: "insensitive" } },
    ];
  }

  return db.invoice.findMany({
    where,
    orderBy: { date: "desc" },
    take: safeTake,
  });
}

export async function updateReportStatus(
  organizationId: string,
  invoiceIds: string[],
  reportStatus: "INCLUDED" | "EXCLUDED"
) {
  return db.invoice.updateMany({
    where: { id: { in: invoiceIds }, organizationId },
    // reportStatusManual marks this row as a deliberate user decision —
    // re-scans and the supplier-exclusion sweep must never override it
    // (see buildReassociationUpdates below).
    data: { reportStatus, reportStatusManual: true },
  });
}

/**
 * Build the updateMany argument pairs that re-associate a chunk of scanned
 * gmailMessageIds onto a new scan. Split in two so rows the user manually
 * included/excluded keep their decision on "Run again":
 *   • non-manual rows re-associate AND receive the tier-default reportStatus
 *   • manual rows only re-associate (scanId) — their reportStatus is theirs
 *
 * Pure — unit tested in web/src/lib/__tests__/scan-reassociation.test.ts.
 */
export function buildReassociationUpdates(
  organizationId: string,
  scanId: string,
  gmailMessageIds: string[],
  reportStatus: "INCLUDED" | "EXCLUDED"
): Array<{
  where: {
    organizationId: string;
    gmailMessageId: { in: string[] };
    reportStatusManual: boolean;
  };
  data: { scanId: string; reportStatus?: "INCLUDED" | "EXCLUDED" };
}> {
  return [
    {
      where: {
        organizationId,
        gmailMessageId: { in: gmailMessageIds },
        reportStatusManual: false,
      },
      data: { scanId, reportStatus },
    },
    {
      where: {
        organizationId,
        gmailMessageId: { in: gmailMessageIds },
        reportStatusManual: true,
      },
      data: { scanId },
    },
  ];
}

export async function getInvoiceStats(organizationId: string) {
  const [total, thisMonth, companies, byTier] = await Promise.all([
    db.invoice.count({ where: { organizationId } }),
    db.invoice.count({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    }),
    db.invoice.groupBy({
      by: ["company"],
      where: { organizationId, company: { not: null } },
    }),
    db.invoice.groupBy({
      by: ["classificationTier"],
      where: { organizationId },
      _count: true,
    }),
  ]);

  return {
    total,
    thisMonth,
    uniqueCompanies: companies.length,
    byTier: Object.fromEntries(
      byTier.map((t) => [t.classificationTier, t._count])
    ),
  };
}

export async function getRecentInvoices(organizationId: string, limit = 10) {
  // Hard cap on limit to prevent abuse
  const safeLimit = Math.min(Math.max(1, limit), 100);
  return db.invoice.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: safeLimit,
  });
}

/**
 * Uncapped canonical-supplier-key counts, optionally scoped to the current
 * view's DB-level facets (scan / tier / report status) so chip counts match
 * the list the user is looking at (M14).
 *
 * The supplier panel + Companies filter MUST be derived from this, not from
 * the capped invoice list — otherwise an org with >500 invoices loses every
 * supplier whose rows fall outside the visible window (the "missing
 * suppliers" regression).
 *
 * Primary source is the persisted Invoice.supplierKey column (S1, indexed on
 * [organizationId, supplierKey]); rows not yet backfilled fall back to
 * computing canonicalSupplierKey from (company, senderDomain). Empty keys
 * bucket under UNKNOWN_KEY so unattributable rows stay visible/excludable.
 */
export async function getSupplierKeyCounts(
  organizationId: string,
  scope?: { scanId?: string; tier?: string; reportStatus?: string }
): Promise<Map<string, number>> {
  const where: any = { organizationId };
  if (scope?.scanId) where.scanId = scope.scanId;
  if (scope?.tier) where.classificationTier = scope.tier;
  if (scope?.reportStatus === "INCLUDED" || scope?.reportStatus === "EXCLUDED") {
    where.reportStatus = scope.reportStatus;
  }

  const [keyed, legacy] = await Promise.all([
    db.invoice.groupBy({
      by: ["supplierKey"],
      where: { ...where, supplierKey: { not: null } },
      _count: true,
    }),
    // Transition fallback for rows created before the supplierKey column /
    // not yet touched by scripts/backfill-supplier-key.ts.
    db.invoice.groupBy({
      by: ["company", "senderDomain"],
      where: { ...where, supplierKey: null },
      _count: true,
    }),
  ]);

  const counts = new Map<string, number>();
  const add = (key: string, n: number) => counts.set(key, (counts.get(key) ?? 0) + n);
  for (const row of keyed) {
    const n = typeof row._count === "number" ? row._count : 1;
    add(row.supplierKey || UNKNOWN_KEY, n);
  }
  for (const row of legacy) {
    const n = typeof row._count === "number" ? row._count : 1;
    const key =
      canonicalSupplierKey({ company: row.company, senderDomain: row.senderDomain }) ||
      UNKNOWN_KEY;
    add(key, n);
  }
  return counts;
}

export async function getCompanyList(organizationId: string) {
  const companies = await db.invoice.groupBy({
    by: ["company"],
    where: { organizationId, company: { not: null } },
    _count: true,
    orderBy: { _count: { company: "desc" } },
  });

  return companies.map((c) => ({
    name: c.company!,
    count: c._count,
  }));
}

/** Lightweight scan list for the Invoices page dropdown.
 *  Uses _count.invoices for the real DB count (not the Scan model's
 *  invoiceCount which reflects how many passed the quality filter,
 *  not how many DB rows actually belong to this scan).
 */
export async function getScanListForFilter(organizationId: string) {
  const scans = await db.scan.findMany({
    where: { organizationId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      createdAt: true,
      totalMessages: true,
      daysBack: true,
      _count: { select: { invoices: true } },
    },
  });
  return scans.map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    totalMessages: s.totalMessages,
    invoiceCount: s._count.invoices,
    daysBack: s.daysBack,
  }));
}

export async function bulkCreateInvoices(
  organizationId: string,
  scanId: string,
  invoices: Array<{
    gmailMessageId: string;
    subject: string;
    sender: string;
    senderDomain?: string;
    company?: string;
    date?: Date;
    amount?: number;
    currency?: string;
    classificationTier: string;
    classificationScore: number;
    classificationSignals?: any;
    bodyText?: string;
    bodyHtml?: string;
    hasAttachment: boolean;
    attachmentPath?: string;
    notes?: string;
    reportStatus?: "INCLUDED" | "EXCLUDED";
    // Canonical supplier identity — MUST be produced by canonicalSupplierKey
    // (the single resolver); every read-side consumer groups/filters on it.
    supplierKey?: string;
  }>
) {
  return db.invoice.createMany({
    data: invoices.map((inv) => ({
      organizationId,
      scanId,
      ...inv,
    })),
    skipDuplicates: true,
  });
}
