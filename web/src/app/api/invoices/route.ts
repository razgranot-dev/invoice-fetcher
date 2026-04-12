import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices, getCompanyList } from "@/lib/data/invoices";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? undefined;
  const tier = searchParams.get("tier") ?? undefined;
  const company = searchParams.get("company") ?? undefined;

  const [invoices, companies] = await Promise.all([
    getInvoices(orgId, { search, tier, company }),
    getCompanyList(orgId),
  ]);

  return NextResponse.json({ invoices, companies });
}
