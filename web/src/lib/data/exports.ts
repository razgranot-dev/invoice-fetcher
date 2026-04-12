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
    status: "PROCESSING" | "COMPLETED" | "FAILED";
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
