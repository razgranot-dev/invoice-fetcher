import { db } from "@/lib/db";

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
  },
  take = 500
) {
  const where: any = { organizationId };

  if (filters?.scanId) {
    where.scanId = filters.scanId;
  }
  if (filters?.tier) {
    where.classificationTier = filters.tier;
  }
  if (filters?.company) {
    where.company = filters.company;
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
    where.OR = [
      { subject: { contains: filters.search, mode: "insensitive" } },
      { sender: { contains: filters.search, mode: "insensitive" } },
      { company: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  return db.invoice.findMany({
    where,
    orderBy: { date: "desc" },
    take,
  });
}

export async function updateReportStatus(
  organizationId: string,
  invoiceIds: string[],
  reportStatus: "INCLUDED" | "EXCLUDED"
) {
  return db.invoice.updateMany({
    where: { id: { in: invoiceIds }, organizationId },
    data: { reportStatus },
  });
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
  return db.invoice.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
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

/** Lightweight scan list for the Invoices page dropdown */
export async function getScanListForFilter(organizationId: string) {
  return db.scan.findMany({
    where: { organizationId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      createdAt: true,
      totalMessages: true,
      invoiceCount: true,
      daysBack: true,
    },
  });
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
