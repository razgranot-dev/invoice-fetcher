import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getScanById, cancelScan } from "@/lib/data/scans";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { id } = await params;

  // Validate path parameter format (cuid)
  if (!id || typeof id !== "string" || id.length > 100 || !/^c[a-z0-9]{20,}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid scan ID format" }, { status: 400 });
  }

  const scan = await getScanById(orgId, id);

  if (!scan) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  return NextResponse.json({ scan });
}

/**
 * Cancel a running or pending scan.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { id } = await params;

  // Validate path parameter format (cuid)
  if (!id || typeof id !== "string" || id.length > 100 || !/^c[a-z0-9]{20,}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid scan ID format" }, { status: 400 });
  }

  const cancelled = await cancelScan(orgId, id);

  if (!cancelled) {
    return NextResponse.json(
      { error: "Scan not found or already completed" },
      { status: 409 }
    );
  }

  return NextResponse.json({ status: "cancelled" });
}
