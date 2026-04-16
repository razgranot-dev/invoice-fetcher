import { db } from "@/lib/db";

export async function getExports(organizationId: string) {
  return db.export.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      format: true,
      status: true,
      invoiceCount: true,
      progress: true,
      progressMessage: true,
      fileSize: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
      // Intentionally omit filePath — internal filesystem detail
    },
  });
}

export async function getExportById(
  organizationId: string,
  exportId: string
) {
  return db.export.findFirst({
    where: { id: exportId, organizationId },
    select: {
      id: true,
      organizationId: true,
      format: true,
      status: true,
      invoiceCount: true,
      progress: true,
      progressMessage: true,
      fileSize: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
      // Intentionally omit filePath — internal filesystem detail
    },
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

/** Terminal export states — once reached, status must not change. */
const TERMINAL_EXPORT_STATES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

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
  // Guard: never overwrite a terminal state. A stale worker callback must not
  // change a COMPLETED/FAILED/CANCELLED export.
  return db.export.updateMany({
    where: {
      id: exportId,
      organizationId,
      status: { notIn: [...TERMINAL_EXPORT_STATES] },
    },
    data,
  });
}

export async function updateExportProgress(
  organizationId: string,
  exportId: string,
  progress: number,
  progressMessage: string
) {
  // Guard: do not update progress on terminal-state exports.
  return db.export.updateMany({
    where: {
      id: exportId,
      organizationId,
      status: { notIn: [...TERMINAL_EXPORT_STATES] },
    },
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
 *
 * Uses atomic updateMany with a status guard to prevent TOCTOU races:
 * between a findFirst and a separate update, the background worker could
 * complete the export, and our cancel would silently overwrite it.
 */
export async function cancelExport(organizationId: string, exportId: string) {
  const result = await db.export.updateMany({
    where: {
      id: exportId,
      organizationId,
      status: { in: ["PENDING", "PROCESSING"] },
    },
    data: {
      status: "CANCELLED",
      progress: 100,
      progressMessage: "Cancelled by user",
    },
  });
  return result.count > 0;
}
