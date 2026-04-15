import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { toggleSupplierRelevance, getSuppliers, getDomainsForBrand } from "@/lib/data/suppliers";
import { db } from "@/lib/db";

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

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, isRelevant } = body;

  if (typeof name !== "string" || name.length === 0 || name.length > 200 || typeof isRelevant !== "boolean") {
    return NextResponse.json(
      { error: "name (string, 1-200 chars) and isRelevant (boolean) required" },
      { status: 400 }
    );
  }

  // 1. Update the supplier record
  const supplier = await toggleSupplierRelevance(orgId, name, isRelevant);

  // 2. Cascade to all invoices matching this brand using company-first logic.
  //    company field takes priority over senderDomain for brand identification,
  //    so toggling "meta" only affects Meta invoices — not other PayPal vendors.
  //
  //    Performance: Uses two targeted updateMany calls instead of fetching all
  //    invoices into memory. The first handles invoices whose company field
  //    matches the brand; the second handles invoices with no company whose
  //    senderDomain normalizes to the brand (requires a small groupBy lookup).
  const nameLower = name.toLowerCase();
  const newStatus = isRelevant ? "INCLUDED" : "EXCLUDED";

  // Update invoices where the company field matches this brand directly.
  // The company field is indexed (organizationId, company).
  const companyResult = await db.invoice.updateMany({
    where: {
      organizationId: orgId,
      company: { equals: nameLower, mode: "insensitive" },
    },
    data: { reportStatus: newStatus as any },
  });

  // For invoices without a company field, find which senderDomains
  // normalize to this brand, then update those targeted domains.
  const domainsForBrand = await getDomainsForBrand(orgId, nameLower);
  let domainUpdateCount = 0;
  if (domainsForBrand.length > 0) {
    const domainResult = await db.invoice.updateMany({
      where: {
        organizationId: orgId,
        company: null,
        senderDomain: { in: domainsForBrand },
      },
      data: { reportStatus: newStatus as any },
    });
    domainUpdateCount = domainResult.count;
  }

  const invoicesUpdated = companyResult.count + domainUpdateCount;

  // Invalidate the cached /invoices page so navigation back shows fresh data
  revalidatePath("/invoices");

  return NextResponse.json({ supplier, invoicesUpdated });
}
