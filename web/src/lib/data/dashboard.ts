import { db } from "@/lib/db";

export async function getDashboardData(organizationId: string) {
  const [
    totalInvoices,
    thisMonthInvoices,
    totalScans,
    companies,
    recentInvoices,
    recentScans,
    connections,
    totalAmount,
  ] = await Promise.all([
    // Total invoices
    db.invoice.count({ where: { organizationId } }),

    // This month's invoices
    db.invoice.count({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      },
    }),

    // Total scans
    db.scan.count({ where: { organizationId } }),

    // Unique companies
    db.invoice.groupBy({
      by: ["company"],
      where: { organizationId, company: { not: null } },
    }),

    // Recent invoices
    db.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        company: true,
        subject: true,
        amount: true,
        currency: true,
        date: true,
        classificationTier: true,
        hasAttachment: true,
      },
    }),

    // Recent scans
    db.scan.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: {
        id: true,
        status: true,
        totalMessages: true,
        invoiceCount: true,
        createdAt: true,
        connection: { select: { email: true } },
      },
    }),

    // Active connections count
    db.gmailConnection.count({
      where: { organizationId, isActive: true },
    }),

    // Total amount (confirmed + likely invoices)
    db.invoice.aggregate({
      where: {
        organizationId,
        classificationTier: { in: ["confirmed_invoice", "likely_invoice"] },
        amount: { not: null },
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    stats: {
      totalInvoices,
      thisMonthInvoices,
      totalScans,
      uniqueCompanies: companies.length,
      activeConnections: connections,
      totalAmount: totalAmount._sum.amount ?? 0,
    },
    recentInvoices,
    recentScans,
  };
}
