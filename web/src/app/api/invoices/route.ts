import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices, getCompanyList } from "@/lib/data/invoices";
import { VALID_TIERS } from "@/lib/export-selection";

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
  // `company` accepts a canonical supplier key (preferred; what the UI sends
  // since M14) or a display name — getInvoices resolves either through
  // canonicalSupplierKey and filters the indexed Invoice.supplierKey column.
  const company = rawCompany && rawCompany.length <= 500 ? rawCompany : undefined;

  // Validate tier enum — reject unknown values so a stale caller fails
  // loudly instead of receiving the unfiltered list.
  if (rawTier && !VALID_TIERS.has(rawTier)) {
    return NextResponse.json({ error: "Invalid tier value" }, { status: 400 });
  }
  const tier = rawTier;

  const [invoices, companies] = await Promise.all([
    getInvoices(orgId, { search, tier, company }),
    getCompanyList(orgId),
  ]);

  return NextResponse.json({ invoices, companies });
}
