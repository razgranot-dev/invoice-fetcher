import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";
import { createExport, getExports, updateExportStatus, updateExportProgress } from "@/lib/data/exports";
import { dispatchWordExport, dispatchScreenshotZip } from "@/lib/worker";
import { db } from "@/lib/db";
import { normalizeDomain } from "@/lib/utils";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  const exports = await getExports(orgId);
  return NextResponse.json({ exports }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return NextResponse.json({ error: "No organization" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const format = body.format as string;
  const filters = (body.filters && typeof body.filters === "object") ? body.filters : {};
  const includeScreenshots = body.includeScreenshots === true;

  if (format !== "WORD" && format !== "ZIP_SCREENSHOTS") {
    return NextResponse.json(
      { error: "Supported formats: WORD, ZIP_SCREENSHOTS" },
      { status: 400 }
    );
  }

  // Query invoices matching filters — default to INCLUDED only for exports
  if (!filters.reportStatus) filters.reportStatus = "INCLUDED";
  const invoices = await getInvoices(orgId, {
    search: filters.search,
    tier: filters.tier,
    company: filters.company,
    scanId: filters.scanId,
    reportStatus: filters.reportStatus,
  }, 10000);

  // Enforce supplier relevance — the DB reportStatus cascade can miss invoices
  // when company names don't exactly match the supplier brand name. Apply the
  // same brand-based filter the page uses to guarantee consistency.
  const excludedSuppliers = await db.supplier.findMany({
    where: { organizationId: orgId, isRelevant: false },
    select: { name: true },
  });
  const excludedBrands = new Set(
    excludedSuppliers.map((s) => s.name.toLowerCase())
  );
  const included = excludedBrands.size > 0
    ? invoices.filter((inv) => {
        const brand =
          inv.company?.trim().toLowerCase() ||
          (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null);
        return !(brand && excludedBrands.has(brand));
      })
    : invoices;

  // For Word exports: only confirmed + likely invoices.
  // For screenshot ZIP: include all tiers so every invoice gets a screenshot.
  const EXPORT_TIERS = new Set(["confirmed_invoice", "likely_invoice"]);
  const exportable =
    format === "ZIP_SCREENSHOTS"
      ? included
      : included.filter((inv) => EXPORT_TIERS.has(inv.classificationTier));

  if (exportable.length === 0) {
    return NextResponse.json(
      { error: "No invoices match the current filters" },
      { status: 400 }
    );
  }

  // Get org name for the report header
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  // Create export record
  const exp = await createExport(orgId, {
    format,
    invoiceCount: exportable.length,
  });

  // Process async — response returns immediately
  after(async () => {
    try {
      // Check if already cancelled before starting
      const preCheck = await db.export.findUnique({ where: { id: exp.id }, select: { status: true } });
      if (preCheck?.status === "CANCELLED") return;

      await updateExportStatus(orgId, exp.id, { status: "PROCESSING" });

      const progressCb = async (progress: number, message: string) => {
        await updateExportProgress(orgId, exp.id, progress, message);
      };

      let result: Awaited<ReturnType<typeof dispatchWordExport>>;

      if (format === "ZIP_SCREENSHOTS") {
        result = await dispatchScreenshotZip(
          exportable as unknown as Array<Record<string, unknown>>,
          progressCb,
          exp.id,
        );
      } else {
        result = await dispatchWordExport(
          exportable as unknown as Array<Record<string, unknown>>,
          org?.name ?? "Organization",
          includeScreenshots,
          progressCb,
          exp.id,
        );
      }

      // Build a human-readable failure summary for the UI
      let completionMessage = "Complete";
      if (result.failures && result.failures.length > 0) {
        const byReason = new Map<string, string[]>();
        for (const f of result.failures) {
          const list = byReason.get(f.reason) ?? [];
          list.push(f.supplier);
          byReason.set(f.reason, list);
        }
        const parts: string[] = [];
        for (const [reason, suppliers] of byReason) {
          parts.push(`${suppliers.length}x ${reason} (${suppliers.slice(0, 3).join(", ")}${suppliers.length > 3 ? "..." : ""})`);
        }
        completionMessage = `${result.failures.length} screenshot(s) failed: ${parts.join("; ")}`;
      }

      // Atomically mark complete ONLY if not cancelled — no TOCTOU gap.
      // Progress update is safe (cosmetic), but the status transition must be guarded.
      await updateExportProgress(orgId, exp.id, 100, completionMessage);
      await db.export.updateMany({
        where: { id: exp.id, organizationId: orgId, status: { not: "CANCELLED" } },
        data: {
          status: "COMPLETED",
          fileSize: result.fileSize,
          completedAt: new Date(),
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Export generation failed";
      await updateExportStatus(orgId, exp.id, {
        status: "FAILED",
        errorMessage: msg,
      });
    }
  });

  return NextResponse.json(
    { export: { id: exp.id, status: "PENDING", format } },
    { status: 201 }
  );
}
