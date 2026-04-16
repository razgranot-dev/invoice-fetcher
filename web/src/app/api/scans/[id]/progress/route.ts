import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getScanProgress } from "@/lib/data/scans";

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

  const scan = await getScanProgress(orgId, id);

  if (!scan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(scan, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
