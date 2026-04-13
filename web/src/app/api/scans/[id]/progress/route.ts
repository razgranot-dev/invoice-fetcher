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

  const { id } = await params;
  const scan = await getScanProgress(id);

  if (!scan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(scan, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
