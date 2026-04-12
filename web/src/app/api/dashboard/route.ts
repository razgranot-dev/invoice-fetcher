import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDashboardData } from "@/lib/data/dashboard";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const data = await getDashboardData(orgId);
  return NextResponse.json(data);
}
