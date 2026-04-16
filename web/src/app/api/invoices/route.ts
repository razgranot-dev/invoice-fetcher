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
  const rawSearch = searchParams.get("search") ?? undefined;
  const rawTier = searchParams.get("tier") ?? undefined;
  const rawCompany = searchParams.get("company") ?? undefined;

  // Validate and sanitize query parameters
  const search = rawSearch && rawSearch.length <= 500 ? rawSearch : undefined;
  const company = rawCompany && rawCompany.length <= 500 ? rawCompany : undefined;

  // Validate tier enum
  const VALID_TIERS = new Set(["confirmed_invoice", "likely_invoice", "possible_invoice", "not_invoice"]);
  const tier = rawTier && VALID_TIERS.has(rawTier) ? rawTier : undefined;

  const [invoices, companies] = await Promise.all([
    getInvoices(orgId, { search, tier, company }),
    getCompanyList(orgId),
  ]);

  return NextResponse.json({ invoices, companies });
}
