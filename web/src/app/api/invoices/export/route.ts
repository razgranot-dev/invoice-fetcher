import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { getInvoices } from "@/lib/data/invoices";
import { db } from "@/lib/db";
import { canonicalSupplierKey, UNKNOWN_KEY } from "@/lib/supplier-canonical";
import { validateInvoiceIds, selectExportableInvoices, VALID_TIERS } from "@/lib/export-selection";
import { buildCsvContent } from "@/lib/csv";

function field(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().split("T")[0];
  return String(value);
}

interface CsvFilters {
  search?: string;
  tier?: string;
  company?: string;
  scanId?: string;
  reportStatus?: string;
}

/**
 * Shared CSV generator for both handlers. Selection-mode (`invoiceIds`
 * defined) exports EXACTLY the checked rows — same contract as Word/ZIP;
 * filter-mode mirrors the current view (minus excluded suppliers).
 */
async function generateCsvResponse(
  orgId: string,
  opts: { invoiceIds?: string[]; filters?: CsvFilters }
): Promise<Response> {
  const { invoiceIds, filters = {} } = opts;
  const useExplicitSelection = invoiceIds !== undefined;

  const rawInvoices = useExplicitSelection
    ? await getInvoices(orgId, { invoiceIds }, 10000)
    : await getInvoices(orgId, filters, 10000);

  // Excluded suppliers only apply in filter-mode; selectExportableInvoices
  // short-circuits the brand check when an explicit selection is in play.
  const excludedSuppliers = useExplicitSelection
    ? []
    : await db.supplier.findMany({
        where: { organizationId: orgId, isRelevant: false },
        select: { name: true },
      });
  const excludedBrands = new Set(
    excludedSuppliers.map((s) => s.name.toLowerCase())
  );

  // For CSV, filter-mode keeps ALL tiers (a CSV is a data dump, not the
  // report) — pass ZIP_SCREENSHOTS so the WORD confirmed/likely whitelist is
  // not applied. Selection-mode intersects to exactly the checked rows.
  const invoices = selectExportableInvoices({
    invoices: rawInvoices,
    format: "ZIP_SCREENSHOTS",
    invoiceIds,
    excludedBrands,
    // Same supplier identity as the invoices page: persisted supplierKey
    // first (S1), canonical resolver fallback for legacy rows, "unknown"
    // bucket for unattributable rows (M12) — see api/exports/route.ts.
    // Keeps "what you see is what you export".
    brandResolver: (inv) =>
      inv.supplierKey ||
      canonicalSupplierKey({
        company: inv.company,
        senderDomain: inv.senderDomain,
      }) ||
      UNKNOWN_KEY,
  });

  console.log(
    `[Export CSV] mode=${useExplicitSelection ? "selected" : "filtered"} ` +
    `selectedIdsCount=${invoiceIds?.length ?? 0} exportedInvoicesCount=${invoices.length}`
  );

  const headers = [
    "Invoice ID",
    "Company",
    "Subject",
    "Amount",
    "Currency",
    "Classification",
    "Date",
    "Sender Email",
    "Has Attachment",
    "Scan ID",
  ];

  const rows = invoices.map((inv) => [
    inv.id,
    field(inv.company),
    field(inv.subject),
    inv.amount != null ? String(inv.amount) : "",
    inv.currency,
    inv.classificationTier,
    inv.date ? new Date(inv.date).toISOString().split("T")[0] : "",
    field(inv.sender),
    inv.hasAttachment ? "Yes" : "No",
    inv.scanId,
  ]);

  // buildCsvContent applies the formula-injection guard per field, prepends
  // the UTF-8 BOM for Excel, and joins with CRLF (see web/src/lib/csv.ts).
  const csv = buildCsvContent(headers, rows);

  const date = new Date().toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${date}.csv"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return new Response("No organization", { status: 403 });
  }

  const { searchParams } = req.nextUrl;

  // Validate and sanitize query parameters
  const rawSearch = searchParams.get("search") || undefined;
  const rawTier = searchParams.get("tier") || undefined;
  const rawCompany = searchParams.get("company") || undefined;
  const rawScanId = searchParams.get("scanId") || undefined;
  const rawReportStatus = searchParams.get("reportStatus") || "INCLUDED";

  const search = rawSearch && rawSearch.length <= 500 ? rawSearch : undefined;
  const company = rawCompany && rawCompany.length <= 500 ? rawCompany : undefined;

  // Validate tier enum. Reject rather than drop: silently ignoring an
  // unknown tier would export a WIDER set than the view the user is looking
  // at — the exact failure mode the selection contract exists to prevent.
  if (rawTier && !VALID_TIERS.has(rawTier)) {
    return new Response("Invalid tier value", { status: 400 });
  }
  const tier = rawTier;

  // Validate scanId format (cuid)
  const scanId = rawScanId && /^c[a-z0-9]{20,}$/i.test(rawScanId) && rawScanId.length <= 100
    ? rawScanId : undefined;

  // Validate reportStatus enum
  const reportStatus = rawReportStatus === "INCLUDED" || rawReportStatus === "EXCLUDED"
    ? rawReportStatus : "INCLUDED";

  // Legacy selection-mode via ?ids= is kept for small selections /
  // backward-compat, but the UI now POSTs selections (H9): a select-all of
  // hundreds of CUIDs blows past Node's 16KB header limit as a query string.
  const rawIds = searchParams.get("ids");
  const idsArray = rawIds ? rawIds.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const idsValidation = validateInvoiceIds(idsArray);
  if (!idsValidation.valid) {
    return new Response(idsValidation.error, { status: 400 });
  }

  return generateCsvResponse(orgId, {
    invoiceIds: idsValidation.invoiceIds,
    filters: { search, tier, company, scanId, reportStatus },
  });
}

/**
 * Selection-mode CSV export (H9). The checked ids ride in the JSON body so
 * arbitrarily large selections never hit URL/header size limits. Filter-mode
 * stays on GET so plain link downloads keep working.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = (session as any).organizationId as string | undefined;
  if (!orgId) {
    return new Response("No organization", { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const rawIds =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).ids
      : undefined;

  const idsValidation = validateInvoiceIds(rawIds);
  if (!idsValidation.valid) {
    return new Response(idsValidation.error, { status: 400 });
  }
  if (idsValidation.invoiceIds === undefined) {
    return new Response(
      "ids is required — POST is selection-mode only; use GET for filter exports",
      { status: 400 }
    );
  }

  return generateCsvResponse(orgId, { invoiceIds: idsValidation.invoiceIds });
}
