import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";
import { createExport, getExports, updateExportStatus, updateExportProgress } from "@/lib/data/exports";
import { dispatchWordExport, dispatchScreenshotZip } from "@/lib/worker";
import { db } from "@/lib/db";
import { normalizeDomain, cleanCompanyName } from "@/lib/utils";
import {
  selectExportableInvoices,
  validateInvoiceIds,
  type ExportFormat,
} from "@/lib/export-selection";

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
  const rawFilters = (body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)) ? body.filters : {};
  const includeScreenshots = body.includeScreenshots === true;
  const rawInvoiceIds = body.invoiceIds;

  if (format !== "WORD" && format !== "ZIP_SCREENSHOTS") {
    return NextResponse.json(
      { error: "Supported formats: WORD, ZIP_SCREENSHOTS" },
      { status: 400 }
    );
  }

  // Validate explicit invoice ID selection. When the client passes a checked
  // subset of rows, these IDs become the export's source of truth — broad
  // filters and supplier-exclusion are bypassed below so the user's manual
  // checkbox choice is never silently widened.
  const idsValidation = validateInvoiceIds(rawInvoiceIds);
  if (!idsValidation.valid) {
    return NextResponse.json({ error: idsValidation.error }, { status: 400 });
  }
  const invoiceIds = idsValidation.invoiceIds;

  // Validate filter values — prevent injection via overly long or malformed strings
  const filters: Record<string, string | undefined> = {};
  for (const key of ["search", "tier", "company", "scanId", "reportStatus"] as const) {
    const val = rawFilters[key];
    if (val !== undefined && val !== null) {
      if (typeof val !== "string" || val.length > 500) {
        return NextResponse.json(
          { error: `Invalid filter value for ${key}` },
          { status: 400 }
        );
      }
      filters[key] = val;
    }
  }

  // Validate tier enum if provided
  const VALID_TIERS = new Set(["confirmed_invoice", "likely_invoice", "possible_invoice", "not_invoice"]);
  if (filters.tier && !VALID_TIERS.has(filters.tier)) {
    return NextResponse.json({ error: "Invalid tier value" }, { status: 400 });
  }

  // Validate reportStatus enum if provided
  if (filters.reportStatus && filters.reportStatus !== "INCLUDED" && filters.reportStatus !== "EXCLUDED") {
    return NextResponse.json({ error: "Invalid reportStatus value" }, { status: 400 });
  }

  // Duplicate export prevention: block if an export of the same format is already in progress
  const runningExport = await db.export.findFirst({
    where: { organizationId: orgId, format: format as any, status: { in: ["PENDING", "PROCESSING"] } },
    select: { id: true },
  });
  if (runningExport) {
    return NextResponse.json(
      { error: "An export of this format is already in progress. Please wait for it to complete or cancel it." },
      { status: 429 }
    );
  }

  // Resource exhaustion guard: cap total active exports per org (across all formats)
  const MAX_CONCURRENT_EXPORTS = 3;
  const activeExportCount = await db.export.count({
    where: { organizationId: orgId, status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (activeExportCount >= MAX_CONCURRENT_EXPORTS) {
    return NextResponse.json(
      { error: `Too many exports in progress (${activeExportCount}). Please wait for some to complete.` },
      { status: 429 }
    );
  }

  // When the client passes an explicit checkbox selection, that list IS the
  // export. Skip every "smart" widening — supplier exclusion, the
  // INCLUDED-by-default reportStatus filter, and the tier whitelist — so the
  // Word file contains exactly what the user picked and nothing else. The
  // org scope on getInvoices() still prevents cross-tenant leakage.
  const useExplicitSelection = invoiceIds !== undefined;

  let invoices: Awaited<ReturnType<typeof getInvoices>>;
  if (useExplicitSelection) {
    invoices = await getInvoices(orgId, { invoiceIds }, 10000);
  } else {
    // No selection → default broad export of the current filter view.
    if (!filters.reportStatus) filters.reportStatus = "INCLUDED";
    invoices = await getInvoices(orgId, {
      search: filters.search,
      tier: filters.tier,
      company: filters.company,
      scanId: filters.scanId,
      reportStatus: filters.reportStatus,
    }, 10000);
  }

  // Only the filter-mode branch needs the excluded supplier set — but loading
  // it unconditionally keeps the path simple and the query is tiny (org-
  // scoped, name-only). The helper short-circuits the brand check when an
  // explicit selection is in play.
  const excludedSuppliers = useExplicitSelection
    ? []
    : await db.supplier.findMany({
        where: { organizationId: orgId, isRelevant: false },
        select: { name: true },
      });
  const excludedBrands = new Set(
    excludedSuppliers.map((s) => s.name.toLowerCase())
  );

  const exportable = selectExportableInvoices({
    invoices,
    format: format as ExportFormat,
    invoiceIds,
    excludedBrands,
    brandResolver: (inv) =>
      cleanCompanyName(inv.company?.trim().toLowerCase() ?? "") ||
      (inv.senderDomain ? normalizeDomain(inv.senderDomain) : null),
  });

  // ── Selection-contract observability + invariant guard ──────────────────
  // Make the selection vs filter decision auditable from logs, and treat a
  // selection-mode export that contains MORE than the user picked as a hard
  // error (it would mean the "selected IDs are source of truth" contract
  // broke). selectExportableInvoices already intersects against invoiceIds,
  // so this should be impossible — the assert is defense-in-depth.
  const exportMode = useExplicitSelection ? "selected" : "filtered";
  const selectedIdsCount = invoiceIds?.length ?? 0;
  const exportedInvoicesCount = exportable.length;
  console.log(
    `[Export] mode=${exportMode} format=${format} selectedIdsCount=${selectedIdsCount} ` +
    `exportedInvoicesCount=${exportedInvoicesCount} ` +
    `appliedFilters=${JSON.stringify(useExplicitSelection ? {} : filters)}`
  );
  if (useExplicitSelection && exportedInvoicesCount > selectedIdsCount) {
    console.error(
      `[Export] SELECTION INVARIANT VIOLATION — exported ${exportedInvoicesCount} > selected ${selectedIdsCount}. ` +
      `Refusing to widen the user's selection.`
    );
    return NextResponse.json(
      { error: "Export selection integrity check failed. Please retry." },
      { status: 500 }
    );
  }

  if (exportable.length === 0) {
    return NextResponse.json(
      {
        error: useExplicitSelection
          ? "Selected invoices were not found"
          : "No invoices match the current filters",
      },
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

      // Atomically mark complete ONLY if still PROCESSING — no TOCTOU gap.
      // Guards against both user cancellation AND recoverStuckExports race.
      await updateExportProgress(orgId, exp.id, 100, completionMessage);
      await db.export.updateMany({
        where: { id: exp.id, organizationId: orgId, status: "PROCESSING" },
        data: {
          status: "COMPLETED",
          fileSize: result.fileSize,
          completedAt: new Date(),
        },
      });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Export generation failed";
      // Log full error server-side for debugging
      console.error(`[Export ${exp.id}] generation error:`, raw);
      // Sanitize before persisting — this message is returned to the client
      const safeMsg = raw
        .replace(/(?:\/[^\s:]+)+/g, "[path]")
        .replace(/(?:postgres|mysql|redis|mongodb)\S+/gi, "[redacted]")
        .slice(0, 300);
      await updateExportStatus(orgId, exp.id, {
        status: "FAILED",
        errorMessage: safeMsg,
      });
    }
  });

  return NextResponse.json(
    { export: { id: exp.id, status: "PENDING", format } },
    { status: 201 }
  );
}
