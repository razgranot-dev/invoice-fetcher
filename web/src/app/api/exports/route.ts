import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";
import { createExport, getExports, updateExportStatus, updateExportProgress } from "@/lib/data/exports";
import { dispatchWordExport, dispatchScreenshotZip } from "@/lib/worker";
import { db } from "@/lib/db";

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

  const body = await req.json();
  const format = body.format as "WORD" | "ZIP_SCREENSHOTS";
  const filters = body.filters ?? {};
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

  // Only confirmed + likely invoices go into the main export.
  // possible_financial_email and not_invoice stay in review flows only.
  const EXPORT_TIERS = new Set(["confirmed_invoice", "likely_invoice"]);
  const exportable = invoices.filter(
    (inv) => EXPORT_TIERS.has(inv.classificationTier)
  );

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

      await updateExportProgress(orgId, exp.id, 100, completionMessage);
      await updateExportStatus(orgId, exp.id, {
        status: "COMPLETED",
        fileSize: result.fileSize,
        completedAt: new Date(),
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
