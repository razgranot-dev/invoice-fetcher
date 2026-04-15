import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateReportStatus } from "@/lib/data/invoices";

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ids, reportStatus } = body;

  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 10000 ||
    !ids.every((id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 100) ||
    (reportStatus !== "INCLUDED" && reportStatus !== "EXCLUDED")
  ) {
    return NextResponse.json(
      { error: "ids (string[], max 10000) and reportStatus (INCLUDED|EXCLUDED) required" },
      { status: 400 }
    );
  }

  const result = await updateReportStatus(orgId, ids, reportStatus);
  return NextResponse.json({ updated: result.count });
}
