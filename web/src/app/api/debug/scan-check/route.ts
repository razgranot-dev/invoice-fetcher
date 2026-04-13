import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  // 1. All scans with _count
  const scans = await db.scan.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      totalMessages: true,
      invoiceCount: true,
      _count: { select: { invoices: true } },
    },
  });

  // 2. Total invoices and scanId distribution
  const totalInvoices = await db.invoice.count({
    where: { organizationId: orgId },
  });

  const byScanId = await db.invoice.groupBy({
    by: ["scanId"],
    where: { organizationId: orgId },
    _count: true,
  });

  // 3. Check for orphaned scanIds (invoices pointing to non-existent scans)
  const validScanIds = new Set(scans.map((s) => s.id));
  const orphanedGroups = byScanId.filter((g) => !validScanIds.has(g.scanId));

  // 4. Sample invoices
  const sampleInvoices = await db.invoice.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      scanId: true,
      gmailMessageId: true,
      subject: true,
      sender: true,
      createdAt: true,
      reportStatus: true,
    },
  });

  // 5. For each scan, directly query invoice count to compare with _count
  const directCounts: Record<string, number> = {};
  for (const s of scans) {
    const count = await db.invoice.count({
      where: { organizationId: orgId, scanId: s.id },
    });
    directCounts[s.id] = count;
  }

  return NextResponse.json({
    organizationId: orgId,
    totalInvoices,
    scans: scans.map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      totalMessages: s.totalMessages,
      scanModelInvoiceCount: s.invoiceCount,
      relationCount: s._count.invoices,
      directQueryCount: directCounts[s.id] ?? 0,
    })),
    invoicesByScanId: byScanId.map((g) => ({
      scanId: g.scanId,
      count: g._count,
      scanExists: validScanIds.has(g.scanId),
    })),
    orphanedScanIds: orphanedGroups.map((g) => ({
      scanId: g.scanId,
      count: g._count,
    })),
    sampleInvoices: sampleInvoices.map((inv) => ({
      id: inv.id,
      scanId: inv.scanId,
      gmailMessageId: inv.gmailMessageId.substring(0, 20),
      subject: inv.subject?.substring(0, 50),
      sender: inv.sender?.substring(0, 40),
      createdAt: inv.createdAt,
      reportStatus: inv.reportStatus,
      scanExists: validScanIds.has(inv.scanId),
    })),
  });
}
