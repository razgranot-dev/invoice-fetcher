import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * One-time fix: re-associate ALL invoices to scans based on createdAt timestamps.
 * Restricted to authenticated org owners in non-production environments.
 *
 * POST /api/debug/fix-scans
 *
 * SECURITY: Disabled in production to prevent accidental data manipulation.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = (session as any).role;
  if (role !== "OWNER") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  // Only fix scans belonging to the caller's organization (capped at 100)
  const scans = await db.scan.findMany({
    where: { organizationId: orgId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 100,
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
