import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { toggleSupplierRelevance, getSuppliers } from "@/lib/data/suppliers";
import { db } from "@/lib/db";
import { canonicalSupplierKey, UNKNOWN_KEY } from "@/lib/supplier-canonical";

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

  // 2. Cascade to all invoices matching this brand. Supplier names in the DB
  //    are canonical keys and every invoice persists the SAME key in
  //    supplierKey (written exclusively by canonicalSupplierKey at scan
  //    time — S1), so the cascade is one indexed updateMany instead of the
  //    previous O(all-org-invoices) in-memory scan. The "unknown" chip works
  //    too: unattributable rows persist supplierKey="unknown" (M12).
  const nameLower = name.toLowerCase();
  const newStatus = isRelevant ? "INCLUDED" : "EXCLUDED";

  let invoicesUpdated = 0;
  const direct = await db.invoice.updateMany({
    where: {
      organizationId: orgId,
      supplierKey: nameLower,
      // A row-level manual include/exclude beats this brand-level toggle — the
      // user explicitly decided that invoice. Matches the scan sweep guard in
      // scans/route.ts ("row-level manual beats brand-level"); without it,
      // toggling a supplier silently reverts a manual per-invoice decision.
      reportStatusManual: false,
    },
    data: { reportStatus: newStatus as any },
  });
  invoicesUpdated += direct.count;

  // Transition fallback: rows created before the supplierKey column existed
  // (and not yet backfilled) still resolve through the same canonical
  // resolver in memory. Post-backfill this findMany returns zero rows.
  const legacy = await db.invoice.findMany({
    where: { organizationId: orgId, supplierKey: null },
    select: { id: true, company: true, senderDomain: true },
  });
  const legacyIds = legacy
    .filter(
      (inv) =>
        (canonicalSupplierKey({
          company: inv.company,
          senderDomain: inv.senderDomain,
        }) || UNKNOWN_KEY) === nameLower
    )
    .map((inv) => inv.id);
  for (let i = 0; i < legacyIds.length; i += 500) {
    const result = await db.invoice.updateMany({
      where: {
        id: { in: legacyIds.slice(i, i + 500) },
        // Same manual guard as the primary cascade above — a legacy row the
        // user manually included/excluded keeps its decision on a brand toggle.
        reportStatusManual: false,
      },
      data: { reportStatus: newStatus as any },
    });
    invoicesUpdated += result.count;
  }

  // Invalidate the cached /invoices page so navigation back shows fresh data
  revalidatePath("/invoices");

  return NextResponse.json({ supplier, invoicesUpdated });
}
