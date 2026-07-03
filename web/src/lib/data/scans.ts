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

/**
 * Row cap for the scan detail page. Browsing beyond this happens on the
 * Invoices page (`/invoices?scan={id}`), which owns filtering/pagination —
 * the detail page shows a capped preview plus accurate aggregate counts.
 */
export const SCAN_DETAIL_INVOICE_CAP = 200;

export async function getScanById(organizationId: string, scanId: string) {
  const scan = await db.scan.findFirst({
    where: { id: scanId, organizationId },
    include: {
      connection: { select: { email: true } },
      invoices: {
        orderBy: { date: "desc" },
        take: SCAN_DETAIL_INVOICE_CAP,
        select: {
          id: true,
          scanId: true,
          subject: true,
          sender: true,
          senderDomain: true,
          company: true,
          date: true,
          amount: true,
          currency: true,
          classificationTier: true,
          classificationScore: true,
          hasAttachment: true,
          reportStatus: true,
          createdAt: true,
          // Intentionally omit: bodyHtml, bodyText, classificationSignals,
          // attachmentPath, gmailMessageId, notes — not needed for display
          // and some contain sensitive/internal data.
        },
      },
    },
  });
  if (!scan) return null;

  // Aggregate counts come from the DB, not the (capped) invoice array —
  // otherwise a scan with more than SCAN_DETAIL_INVOICE_CAP rows would
  // silently undercount "in report" / "for review" in the header.
  const [invoiceTotal, statusCounts] = await Promise.all([
    db.invoice.count({ where: { organizationId, scanId } }),
    db.invoice.groupBy({
      by: ["reportStatus"],
      where: { organizationId, scanId },
      _count: true,
    }),
  ]);
  const reportCounts = { included: 0, excluded: 0 };
  for (const row of statusCounts) {
    if (row.reportStatus === "INCLUDED") reportCounts.included = row._count;
    else if (row.reportStatus === "EXCLUDED") reportCounts.excluded = row._count;
  }

  return { ...scan, _invoiceTotal: invoiceTotal, _reportCounts: reportCounts };
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

/** Terminal scan states — once reached, status must not change. */
const TERMINAL_SCAN_STATES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

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
  // Guard: never overwrite a terminal state. A stale worker callback must not
  // change a COMPLETED/FAILED/CANCELLED scan back to RUNNING or FAILED.
  return db.scan.updateMany({
    where: {
      id: scanId,
      organizationId,
      status: { notIn: [...TERMINAL_SCAN_STATES] },
    },
    data,
  });
}

export async function updateScanProgress(
  scanId: string,
  progress: number,
  message: string
) {
  // Use updateMany with organizationId-free filter because this is called
  // from the background after() callback which already verified org ownership.
  // The scanId is server-generated (not user-supplied) so this is safe.
  // Guard: do not update progress on terminal-state scans (e.g. cancelled mid-run).
  return db.scan.updateMany({
    where: { id: scanId, status: { notIn: [...TERMINAL_SCAN_STATES] } },
    data: { progress, progressMessage: message },
  });
}

export async function getScanProgress(organizationId: string, scanId: string) {
  return db.scan.findFirst({
    where: { id: scanId, organizationId },
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

/**
 * Cancel a running or pending scan. Returns true if cancelled, false if not found/not cancellable.
 *
 * Uses atomic updateMany with a status guard to prevent TOCTOU races:
 * between a findFirst and a separate update, the background worker could
 * complete/fail the scan, and our update would silently overwrite it.
 */
export async function cancelScan(organizationId: string, scanId: string) {
  const result = await db.scan.updateMany({
    where: {
      id: scanId,
      organizationId,
      status: { in: ["PENDING", "RUNNING"] },
    },
    data: {
      status: "CANCELLED",
      progress: 100,
      progressMessage: "Cancelled by user",
      completedAt: new Date(),
    },
  });
  return result.count > 0 ? true : null;
}

/** A RUNNING scan whose last progress write (Scan.updatedAt is @updatedAt,
 *  auto-touched on every updateScanProgress) is older than this is dead —
 *  the worker streams progress at least every second while alive. */
export const STALE_PROGRESS_MS = 3 * 60 * 1000;
/** Fallback for scans that never wrote a single progress line. */
export const SCAN_HARD_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Pure where-clause for stuck-scan recovery — extracted so the cutoff
 * arithmetic is unit-testable (web/src/lib/__tests__/scan-timeouts.test.ts).
 */
export function stuckScanWhere(organizationId: string, now: Date) {
  return {
    organizationId,
    status: "RUNNING" as const,
    OR: [
      { updatedAt: { lt: new Date(now.getTime() - STALE_PROGRESS_MS) } },
      { startedAt: { lt: new Date(now.getTime() - SCAN_HARD_TIMEOUT_MS) } },
    ],
  };
}

/**
 * Recover scans stuck in RUNNING. Keys primarily on Scan.updatedAt going
 * stale (> 3 min without a progress write — progress writes are throttled
 * to 1s, so a live scan touches it constantly), with the original
 * startedAt > 15 min rule kept as a fallback for scans that died before
 * their first progress write. Called opportunistically from the scan list
 * and from POST /api/scans before the duplicate-scan guard.
 */
export async function recoverStuckScans(organizationId: string) {
  return db.scan.updateMany({
    where: stuckScanWhere(organizationId, new Date()),
    data: {
      status: "FAILED",
      progress: 100,
      progressMessage: "Timed out — scan did not complete",
      errorMessage: "Scan stopped making progress and was marked failed",
      completedAt: new Date(),
    },
  });
}
