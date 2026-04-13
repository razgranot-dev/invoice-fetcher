import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getExportById } from "@/lib/data/exports";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { id } = await params;
  const exp = await getExportById(orgId, id);

  if (!exp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ export: exp }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
