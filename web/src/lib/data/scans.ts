import { db } from "@/lib/db";

export async function getScans(organizationId: string) {
  const scans = await db.scan.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      connection: {
        select: { email: true },
      },
      _count: {
        select: { invoices: true },
      },
    },
  });

  // Batch-fetch per-scan INCLUDED/EXCLUDED counts
  const scanIds = scans.map((s) => s.id);
  const counts = await db.invoice.groupBy({
    by: ["scanId", "reportStatus"],
    where: { scanId: { in: scanIds } },
    _count: true,
  });

  const countMap = new Map<string, { included: number; excluded: number }>();
  for (const row of counts) {
    if (!row.scanId) continue;
    const entry = countMap.get(row.scanId) ?? { included: 0, excluded: 0 };
    if (row.reportStatus === "INCLUDED") entry.included = row._count;
    else if (row.reportStatus === "EXCLUDED") entry.excluded = row._count;
    countMap.set(row.scanId, entry);
  }

  return scans.map((s) => ({
    ...s,
    _reportCounts: countMap.get(s.id) ?? { included: 0, excluded: 0 },
  }));
}

export async function getScanById(organizationId: string, scanId: string) {
  return db.scan.findFirst({
    where: { id: scanId, organizationId },
    include: {
      connection: { select: { email: true } },
      invoices: {
        orderBy: { date: "desc" },
      },
    },
  });
}

export async function createScan(
  organizationId: string,
  connectionId: string,
  params: {
    keywords: string[];
    daysBack: number;
    unreadOnly: boolean;
  }
) {
  return db.scan.create({
    data: {
      organizationId,
      connectionId,
      keywords: params.keywords,
      daysBack: params.daysBack,
      unreadOnly: params.unreadOnly,
      status: "PENDING",
    },
  });
}

export async function updateScanStatus(
  organizationId: string,
  scanId: string,
  data: {
    status: "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
    totalMessages?: number;
    processedCount?: number;
    invoiceCount?: number;
    progress?: number;
    progressMessage?: string;
    errorMessage?: string;
    startedAt?: Date;
    completedAt?: Date;
  }
) {
  return db.scan.updateMany({
    where: { id: scanId, organizationId },
    data,
  });
}

export async function updateScanProgress(
  scanId: string,
  progress: number,
  message: string
) {
  return db.scan.update({
    where: { id: scanId },
    data: { progress, progressMessage: message },
  });
}

export async function getScanProgress(scanId: string) {
  return db.scan.findUnique({
    where: { id: scanId },
    select: {
      id: true,
      status: true,
      progress: true,
      progressMessage: true,
      totalMessages: true,
      processedCount: true,
      invoiceCount: true,
    },
  });
}
