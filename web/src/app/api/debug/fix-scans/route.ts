import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * One-time fix: re-associate ALL invoices to scans based on createdAt timestamps.
 * No auth — temporary endpoint, delete after use.
 *
 * POST /api/debug/fix-scans
 */
export async function POST() {
  // Fix ALL organizations at once
  const scans = await db.scan.findMany({
    where: { status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      organizationId: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
  });

  if (scans.length === 0) {
    return NextResponse.json({ message: "No completed scans found", fixes: [] });
  }

  const fixes: Array<{
    scanId: string;
    orgId: string;
    createdAt: Date;
    windowStart: Date;
    windowEnd: Date;
    updatedCount: number;
  }> = [];

  // Process scans from OLDEST to NEWEST so the newest scan "wins"
  const sorted = [...scans].reverse();

  for (const scan of sorted) {
    const windowStart = new Date(
      (scan.startedAt ?? scan.createdAt).getTime() - 60_000
    );
    const windowEnd = new Date(
      (scan.completedAt ?? scan.createdAt).getTime() + 5 * 60_000
    );

    const result = await db.invoice.updateMany({
      where: {
        organizationId: scan.organizationId,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      data: { scanId: scan.id },
    });

    fixes.push({
      scanId: scan.id,
      orgId: scan.organizationId,
      createdAt: scan.createdAt,
      windowStart,
      windowEnd,
      updatedCount: result.count,
    });
  }

  const totalUpdated = fixes.reduce((sum, f) => sum + f.updatedCount, 0);

  return NextResponse.json({
    message: `Re-associated ${totalUpdated} invoices across ${fixes.length} scans`,
    fixes,
  });
}
