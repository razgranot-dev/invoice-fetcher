import { db } from "@/lib/db";

export async function getExports(organizationId: string) {
  return db.export.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function getExportById(
  organizationId: string,
  exportId: string
) {
  return db.export.findFirst({
    where: { id: exportId, organizationId },
  });
}

export async function createExport(
  organizationId: string,
  data: {
    format: "CSV" | "WORD" | "ZIP_SCREENSHOTS";
    invoiceCount: number;
    filePath?: string;
  }
) {
  return db.export.create({
    data: {
      organizationId,
      format: data.format,
      invoiceCount: data.invoiceCount,
      status: "PENDING",
    },
  });
}

export async function updateExportStatus(
  organizationId: string,
  exportId: string,
  data: {
    status: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
    filePath?: string;
    fileSize?: number;
    errorMessage?: string;
    completedAt?: Date;
  }
) {
  return db.export.updateMany({
    where: { id: exportId, organizationId },
    data,
  });
}

export async function updateExportProgress(
  organizationId: string,
  exportId: string,
  progress: number,
  progressMessage: string
) {
  return db.export.updateMany({
    where: { id: exportId, organizationId },
    data: { progress, progressMessage },
  });
}

/**
 * Recover exports stuck in PROCESSING for more than 15 minutes.
 * Called opportunistically from the exports list page.
 */
export async function recoverStuckExports(organizationId: string) {
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
  return db.export.updateMany({
    where: {
      organizationId,
      status: "PROCESSING",
      createdAt: { lt: fifteenMinAgo },
    },
    data: {
      status: "FAILED",
      progress: 100,
      progressMessage: "Timed out — export did not complete",
      errorMessage: "Export timed out after 15 minutes",
      completedAt: new Date(),
    },
  });
}

/**
 * Cancel a pending or processing export. Returns true if cancelled.
 */
export async function cancelExport(organizationId: string, exportId: string) {
  const exp = await db.export.findFirst({
    where: { id: exportId, organizationId, status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (!exp) return false;

  await db.export.update({
    where: { id: exportId },
    data: {
      status: "CANCELLED",
      progress: 100,
      progressMessage: "Cancelled by user",
    },
  });
  return true;
}
