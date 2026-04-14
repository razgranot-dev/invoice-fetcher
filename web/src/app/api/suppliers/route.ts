import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { toggleSupplierRelevance, getSuppliers } from "@/lib/data/suppliers";
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

  // 2. Cascade to all invoices matching this brand using company-first logic.
  //    company field takes priority over senderDomain for brand identification,
  //    so toggling "meta" only affects Meta invoices — not other PayPal vendors.
  const allInvoices = await db.invoice.findMany({
    where: { organizationId: orgId },
    select: { id: true, company: true, senderDomain: true },
  });
  const nameLower = name.toLowerCase();
  const matchingIds = allInvoices
    .filter((inv) => {
      const brand =
        inv.company?.trim().toLowerCase() ||
        (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
      return brand === nameLower;
    })
    .map((inv) => inv.id);

  let invoicesUpdated = 0;
  for (let i = 0; i < matchingIds.length; i += 500) {
    const chunk = matchingIds.slice(i, i + 500);
    const result = await db.invoice.updateMany({
      where: { id: { in: chunk } },
      data: { reportStatus: isRelevant ? "INCLUDED" : "EXCLUDED" },
    });
    invoicesUpdated += result.count;
  }

  // Invalidate the cached /invoices page so navigation back shows fresh data
  revalidatePath("/invoices");

  return NextResponse.json({ supplier, invoicesUpdated });
}
