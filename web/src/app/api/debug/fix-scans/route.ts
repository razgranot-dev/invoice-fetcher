import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * One-time fix: re-associate invoices to scans based on createdAt timestamps.
 *
 * For each completed scan, finds invoices created during that scan's time
 * window (startedAt → completedAt) and updates their scanId.
 *
 * POST /api/debug/fix-scans
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  // Get all completed scans, newest first
  const scans = await db.scan.findMany({
    where: { organizationId: orgId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
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
    createdAt: Date;
    windowStart: Date;
    windowEnd: Date;
    updatedCount: number;
  }> = [];

  // Process scans from OLDEST to NEWEST so the newest scan "wins"
  // for invoices that fall in overlapping time windows
  const sorted = [...scans].reverse();

  for (const scan of sorted) {
    // Time window: 1 minute before scan created → 5 minutes after completed
    const windowStart = new Date(
      (scan.startedAt ?? scan.createdAt).getTime() - 60_000
    );
    const windowEnd = new Date(
      (scan.completedAt ?? scan.createdAt).getTime() + 5 * 60_000
    );

    const result = await db.invoice.updateMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      data: { scanId: scan.id },
    });

    fixes.push({
      scanId: scan.id,
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
