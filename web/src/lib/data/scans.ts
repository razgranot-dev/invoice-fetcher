import { db } from "@/lib/db";

export async function getScans(organizationId: string) {
  return db.scan.findMany({
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
