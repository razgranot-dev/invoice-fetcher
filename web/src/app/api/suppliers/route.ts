import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { toggleSupplierRelevance, getSuppliers, getDomainsForBrand } from "@/lib/data/suppliers";
import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const suppliers = await getSuppliers(orgId);
  return NextResponse.json({ suppliers });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const body = await req.json();
  const { name, isRelevant } = body;

  if (typeof name !== "string" || typeof isRelevant !== "boolean") {
    return NextResponse.json(
      { error: "name (string) and isRelevant (boolean) required" },
      { status: 400 }
    );
  }

  // 1. Update the supplier record
  const supplier = await toggleSupplierRelevance(orgId, name, isRelevant);

  // 2. Find ALL raw senderDomains that map to this brand
  const matchingDomains = await getDomainsForBrand(orgId, name);

  // 3. Cascade to all invoices across all matching domains
  let invoicesUpdated = 0;
  if (matchingDomains.length > 0) {
    const result = await db.invoice.updateMany({
      where: { organizationId: orgId, senderDomain: { in: matchingDomains } },
      data: { reportStatus: isRelevant ? "INCLUDED" : "EXCLUDED" },
    });
    invoicesUpdated = result.count;
  }

  // 4. Also cascade to invoices matched by company name (for vendors
  //    without a matching senderDomain, e.g. "FLYSTORE", "Gett").
  //    Match both exact brand name AND all company names that normalize
  //    to this brand (e.g. "Meta for Business" → company contains "meta").
  const companyResult = await db.invoice.updateMany({
    where: {
      organizationId: orgId,
      company: { equals: name, mode: "insensitive" },
      // Don't re-update invoices already covered by domain match
      ...(matchingDomains.length > 0
        ? { senderDomain: { notIn: matchingDomains } }
        : {}),
    },
    data: { reportStatus: isRelevant ? "INCLUDED" : "EXCLUDED" },
  });
  invoicesUpdated += companyResult.count;

  // 5. Catch remaining invoices by company normalization — handles cases
  //    like company="Meta for Business" when supplier name is "meta".
  //    Fetch all uncovered invoices and check via normalizeDomain/company.
  const remaining = await db.invoice.findMany({
    where: {
      organizationId: orgId,
      reportStatus: isRelevant ? "EXCLUDED" : "INCLUDED",
      ...(matchingDomains.length > 0
        ? { senderDomain: { notIn: matchingDomains } }
        : {}),
      company: { not: name },
    },
    select: { id: true, company: true, senderDomain: true },
  });
  const nameLower = name.toLowerCase();
  const extraIds = remaining
    .filter((inv) => {
      const brand =
        inv.company?.trim().toLowerCase() ||
        (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
      return brand === nameLower;
    })
    .map((inv) => inv.id);
  if (extraIds.length > 0) {
    const extra = await db.invoice.updateMany({
      where: { id: { in: extraIds } },
      data: { reportStatus: isRelevant ? "INCLUDED" : "EXCLUDED" },
    });
    invoicesUpdated += extra.count;
  }

  // Invalidate the cached /invoices page so navigation back shows fresh data
  revalidatePath("/invoices");

  return NextResponse.json({ supplier, invoicesUpdated });
}
